import { eq } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import type { Fact } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { dedupKey, filterNewFacts, freshCandidates } from './dedup';
import { insertFacts } from './dossiers';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number };

type SourceRow = typeof sources.$inferSelect;

async function candidatesFor(source: SourceRow): Promise<Candidate[]> {
  if (source.connector === 'tavily') return discoverTavily(source.input as never);
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}

export async function refreshDossier(
  dossierId: string,
  opts: { force?: boolean; language?: string; onProgress?: (p: RefreshProgress) => void } = {},
): Promise<{ total: number }> {
  registerAllAdapters();
  const onProgress = opts.onProgress ?? (() => {});
  const lang = opts.language ?? 'fr';

  const srcRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const existing = await db.select({ sourceUrl: facts.sourceUrl, text: facts.text }).from(facts).where(eq(facts.dossierId, dossierId));
  const seen = new Set(existing.map((e) => dedupKey(e)));
  const seenUrls = new Set(existing.map((e) => e.sourceUrl));
  let total = seen.size;

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
    try {
      let extracted: Fact[] = [];
      if (src.kind === 'standing') {
        const candidates = await candidatesFor(src);
        // skip candidate URLs already extracted on a prior refresh (spec §5); the
        // (sourceUrl,text) dedup below is the secondary, fact-level guard.
        for (const c of freshCandidates(candidates, seenUrls)) {
          const adapter = findAdapter({ kind: 'url', url: c.url });
          if (!adapter) continue;
          try { extracted = extracted.concat(await extract(c.url, { language: lang, withSummary: false })); }
          catch { /* skip a bad candidate URL, keep going */ }
        }
      } else {
        const url = (src.input as { url: string }).url;
        extracted = await extract(url, { language: lang, withSummary: false });
      }
      const fresh = filterNewFacts(extracted, seen);
      // group fresh facts by their real sourceUrl is unnecessary — store under this source row
      await insertFacts(dossierId, src.id, fresh);
      total += fresh.length;
      await db.update(sources).set({ lastExtractedAt: new Date() }).where(eq(sources.id, src.id));
      onProgress({ type: 'facts', sourceLabel: src.label ?? src.connector, added: fresh.length, total });
    } catch (e) {
      // leave lastExtractedAt unset so it retries next refresh
      onProgress({ type: 'source-error', label: src.label ?? src.connector, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total });
  return { total };
}
