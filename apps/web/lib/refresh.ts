import { eq } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import type { Fact } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { dedupKey, filterNewFacts, freshCandidates } from './dedup';
import { backfillPublishedAt } from './temporal';
import { insertFacts } from './dossiers';
import type { SynthesisProgress } from './synthesis';
import { upsertDocument, linkFacts, setDocumentCore } from './documents';
import { analyzeDocumentCore } from './document/analyze';
import { hostOf } from './host';
import { getRefreshConfig } from './refresh-config';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number };

export type StreamProgress = RefreshProgress | SynthesisProgress;

type SourceRow = typeof sources.$inferSelect;

async function candidatesFor(source: SourceRow): Promise<Candidate[]> {
  if (source.connector === 'tavily') return discoverTavily(source.input as never);
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}

/** Keep at most `n` facts from one page, ranked by relevance × confidence (best first). */
function topFactsPerUrl(urlFacts: Fact[], n: number): Fact[] {
  if (urlFacts.length <= n) return urlFacts;
  const score = (f: Fact): number => {
    const r = (f.provenance as { relevance?: number } | null)?.relevance;
    return (typeof r === 'number' ? r : 1) * (f.confidence ?? 0.5);
  };
  return [...urlFacts].sort((a, b) => score(b) - score(a)).slice(0, n);
}

export async function refreshDossier(
  dossierId: string,
  opts: { phase?: 'assemble' | 'refresh'; force?: boolean; language?: string; onProgress?: (p: RefreshProgress) => void } = {},
): Promise<{ total: number; added: number }> {
  registerAllAdapters();
  // Depth knobs come from config. Only the candidate cap varies by phase — assemble goes
  // deep (more URLs per source), refresh stays shallow; the floors + max-facts-per-url are
  // phase-independent (read directly from cfg).
  const cfg = getRefreshConfig();
  const phase = opts.phase ?? 'refresh';
  const candidatesPerSource = phase === 'assemble' ? cfg.assembleCandidatesPerSource : cfg.refreshCandidatesPerSource;
  const onProgress = opts.onProgress ?? (() => {});
  const lang = opts.language ?? 'fr';

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  const subjectHint = dossier
    ? [dossier.name, dossier.intent].filter(Boolean).join(' — ')
    : '';

  const srcRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const existing = await db.select({ sourceUrl: facts.sourceUrl, text: facts.text }).from(facts).where(eq(facts.dossierId, dossierId));
  const seen = new Set(existing.map((e) => dedupKey(e)));
  const seenUrls = new Set(existing.map((e) => e.sourceUrl));
  let total = seen.size; // running tally of all facts in the dossier (pre-existing + newly added)
  let added = 0; // facts inserted during this refresh run only — gates synthesis in the SSE routes

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
    try {
      let extracted: Fact[] = [];
      const pendingDocs: { docId: string; url: string; content: string; title: string; siteName?: string; needsCore: boolean }[] = [];
      if (src.kind === 'standing') {
        const cands = await candidatesFor(src);
        // Drop YouTube Shorts — datacenter IPs rarely get usable transcripts for them.
        const candidates = cands.filter((c) => !/youtube\.com\/shorts\//i.test(c.url));
        // Narrow by Tavily relevance score + cap BEFORE freshCandidates: freshCandidates
        // mutates seenUrls (marks what it returns as seen). Filtering first means only the
        // URLs we actually mine get marked seen; weaker ones can resurface on a later refresh.
        // Unscored candidates (RSS / YouTube-channel set no score) pass the floor;
        // only scored (Tavily) candidates must clear it. The cap still bounds all.
        const ranked = [...candidates]
          .filter((c) => c.score === undefined || c.score >= cfg.candidateScoreFloor)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, candidatesPerSource);
        // skip candidate URLs already extracted on a prior refresh (spec §5); the
        // (sourceUrl,text) dedup below is the secondary, fact-level guard.
        for (const c of freshCandidates(ranked, seenUrls)) {
          const adapter = findAdapter({ kind: 'url', url: c.url });
          if (!adapter) continue;
          try {
            let captured = '';
            const top = topFactsPerUrl(
              await extract(c.url, { language: lang, withSummary: false, subjectHint, onContent: (t) => { captured = t; } }),
              cfg.maxFactsPerUrl,
            );
            // Backfill publication date from the discovery candidate (Tavily published_date /
            // RSS pubDate) when the adapter didn't find one — improves stream classification.
            const withDates = top.map((f) => backfillPublishedAt(f, c.publishedAt));
            extracted = extracted.concat(withDates);
            const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(c.url);
            const prov0 = withDates[0]?.provenance as { channelName?: string; publishedAt?: string } | undefined;
            const siteName = yt ? (prov0?.channelName || 'youtube.com') : hostOf(c.url);
            const publishedAt = prov0?.publishedAt
              ? new Date(prov0.publishedAt)
              : c.publishedAt ? new Date(c.publishedAt) : null;
            const title = c.title ?? c.url;
            const { id: docId, needsCore } = await upsertDocument(dossierId, {
              url: c.url,
              title,
              siteName,
              kind: yt ? 'youtube' : 'web',
              publishedAt,
            });
            pendingDocs.push({ docId, url: c.url, content: captured, title, siteName, needsCore });
          } catch {
            /* skip a bad candidate URL, keep going */
          }
        }
      } else {
        const url = (src.input as { url: string }).url;
        let captured = '';
        extracted = topFactsPerUrl(
          await extract(url, { language: lang, withSummary: false, subjectHint, onContent: (t) => { captured = t; } }),
          cfg.maxFactsPerUrl,
        );
        const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
        const prov0 = extracted[0]?.provenance as { channelName?: string; publishedAt?: string } | undefined;
        const siteName = yt ? (prov0?.channelName || 'youtube.com') : hostOf(url);
        const publishedAt = prov0?.publishedAt ? new Date(prov0.publishedAt) : null;
        const { id: docId, needsCore } = await upsertDocument(dossierId, {
          url,
          title: src.label ?? url,
          siteName,
          kind: yt ? 'youtube' : 'web',
          publishedAt,
        });
        pendingDocs.push({ docId, url, content: captured, title: src.label ?? url, siteName, needsCore });
      }
      // Drop facts the model scored as weakly-relevant to the subject (only when we have a
      // subjectHint; unscored facts are KEPT). Applied BEFORE dedup so `seen` tracks only
      // facts we actually keep.
      const relevantExtracted =
        subjectHint.length > 0
          ? extracted.filter((f) => {
              const r = (f.provenance as { relevance?: number } | null)?.relevance;
              return typeof r !== 'number' || r >= cfg.factRelevanceFloor; // keep if unscored or above floor
            })
          : extracted;
      const fresh = filterNewFacts(relevantExtracted, seen);
      // group fresh facts by their real sourceUrl is unnecessary — store under this source row
      await insertFacts(dossierId, src.id, fresh);
      total += fresh.length;
      added += fresh.length;
      // Link facts to their documents and auto-analyze (review + bullets) for each new document.
      for (const d of pendingDocs) {
        await linkFacts(dossierId, d.docId, d.url);
        if (!d.content || !d.needsCore) continue;
        try {
          const core = await analyzeDocumentCore({ content: d.content, title: d.title, siteName: d.siteName, lang });
          await setDocumentCore(d.docId, core);
        } catch (e) {
          onProgress({ type: 'source-error', label: d.url, message: e instanceof Error ? e.message : String(e) });
        }
      }
      await db.update(sources).set({ lastExtractedAt: new Date() }).where(eq(sources.id, src.id));
      onProgress({ type: 'facts', sourceLabel: src.label ?? src.connector, added: fresh.length, total });
    } catch (e) {
      // leave lastExtractedAt unset so it retries next refresh
      onProgress({ type: 'source-error', label: src.label ?? src.connector, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total });
  return { total, added };
}
