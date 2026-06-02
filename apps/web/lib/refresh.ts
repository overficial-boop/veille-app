import { eq } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import type { Fact } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { dedupKey, filterNewFacts, freshCandidates } from './dedup';
import { backfillPublishedAt, isRecentCandidate } from './temporal';
import { insertFacts } from './dossiers';
import type { SynthesisProgress } from './synthesis';
import { upsertDocument, linkFacts } from './documents';
import { hostOf } from './host';
import { getRefreshConfig } from './refresh-config';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number };

export type StreamProgress = RefreshProgress | SynthesisProgress;

type SourceRow = typeof sources.$inferSelect;

async function candidatesFor(source: SourceRow, daysOverride?: number): Promise<Candidate[]> {
  if (source.connector === 'tavily') {
    const input = daysOverride ? { ...(source.input as object), days: daysOverride } : source.input;
    return discoverTavily(input as never);
  }
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

  // Recency window: only meaningful on refresh (not assemble). Uses the most recent timestamp
  // available — refreshedAt first, falling back to briefGeneratedAt — as the "last seen" mark.
  const lastRefresh = phase === 'refresh' && dossier
    ? (dossier.refreshedAt ?? dossier.briefGeneratedAt ?? null)
    : null;
  // daysSince tells Tavily how far back to search. Minimum 1 day so we never ask for 0 days.
  // undefined when assemble (no window) or when no prior timestamp exists (first run).
  const daysSince = lastRefresh
    ? Math.max(1, Math.ceil((Date.now() - lastRefresh.getTime()) / 86_400_000))
    : undefined;

  const srcRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const existing = await db.select({ sourceUrl: facts.sourceUrl, text: facts.text }).from(facts).where(eq(facts.dossierId, dossierId));
  const seen = new Set(existing.map((e) => dedupKey(e)));
  const seenUrls = new Set(existing.map((e) => e.sourceUrl));
  let total = seen.size; // running tally of all facts in the dossier (pre-existing + newly added)
  let added = 0; // facts inserted during this refresh run only — gates synthesis in the SSE routes

  // Extract one URL, persist its facts + the document (keeping the raw content for on-demand
  // review generation), dedup against what we've already seen, and return how many NEW facts were
  // stored. Review/bullets are intentionally NOT generated here — they're produced on demand when
  // a document is opened, so the assemble stays fast and surfaces facts immediately.
  async function processCandidate(
    sourceId: string,
    url: string,
    candPublishedAt: string | undefined,
    candTitle: string | undefined,
  ): Promise<number> {
    let captured = '';
    const top = topFactsPerUrl(
      await extract(url, { language: lang, withSummary: false, subjectHint, onContent: (t) => { captured = t; } }),
      cfg.maxFactsPerUrl,
    );
    // Backfill publication date from the discovery candidate when the adapter didn't find one.
    const withDates = top.map((f) => backfillPublishedAt(f, candPublishedAt));
    // Drop facts the model scored as weakly-relevant (keep unscored); applied BEFORE dedup so
    // `seen` only tracks facts we actually keep.
    const relevant =
      subjectHint.length > 0
        ? withDates.filter((f) => {
            const r = (f.provenance as { relevance?: number } | null)?.relevance;
            return typeof r !== 'number' || r >= cfg.factRelevanceFloor;
          })
        : withDates;
    const fresh = filterNewFacts(relevant, seen);
    const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
    const prov0 = withDates[0]?.provenance as { channelName?: string; publishedAt?: string } | undefined;
    const siteName = yt ? (prov0?.channelName || 'youtube.com') : hostOf(url);
    const publishedAt = prov0?.publishedAt
      ? new Date(prov0.publishedAt)
      : candPublishedAt ? new Date(candPublishedAt) : null;
    const { id: docId } = await upsertDocument(dossierId, {
      url,
      title: candTitle ?? url,
      siteName,
      kind: yt ? 'youtube' : 'web',
      publishedAt,
      content: captured,
    });
    if (fresh.length) await insertFacts(dossierId, sourceId, fresh);
    await linkFacts(dossierId, docId, url);
    return fresh.length;
  }

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
    let srcAdded = 0;
    try {
      if (src.kind === 'standing') {
        const cands = await candidatesFor(src, daysSince);
        // Drop YouTube Shorts — datacenter IPs rarely get usable transcripts for them.
        const candidates = cands.filter((c) => !/youtube\.com\/shorts\//i.test(c.url));
        // Narrow by Tavily relevance score + cap BEFORE freshCandidates: freshCandidates mutates
        // seenUrls (marks what it returns as seen). Filtering first means only the URLs we actually
        // mine get marked seen; weaker ones can resurface on a later refresh. Unscored candidates
        // (RSS / YouTube-channel) pass the floor; only scored (Tavily) ones must clear it.
        const ranked = [...candidates]
          .filter((c) => c.score === undefined || c.score >= cfg.candidateScoreFloor)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, candidatesPerSource);
        // On refresh: drop candidates published on/before the last refresh; keep undated ones
        // (benefit of the doubt). On assemble (lastRefresh=null) every candidate passes.
        const recencyFiltered = phase === 'refresh'
          ? ranked.filter((c) => isRecentCandidate(c.publishedAt, lastRefresh))
          : ranked;
        // Process candidates one at a time, surfacing facts as we go so the UI count climbs live
        // instead of waiting for the whole source to finish.
        for (const c of freshCandidates(recencyFiltered, seenUrls)) {
          if (!findAdapter({ kind: 'url', url: c.url })) continue;
          try {
            const n = await processCandidate(src.id, c.url, c.publishedAt, c.title);
            total += n;
            added += n;
            srcAdded += n;
            onProgress({ type: 'facts', sourceLabel: src.label ?? src.connector, added: srcAdded, total });
          } catch {
            /* skip a bad candidate URL, keep going */
          }
        }
      } else {
        const url = (src.input as { url: string }).url;
        const n = await processCandidate(src.id, url, undefined, src.label ?? undefined);
        total += n;
        added += n;
        srcAdded += n;
      }
      await db.update(sources).set({ lastExtractedAt: new Date() }).where(eq(sources.id, src.id));
      // Final settle for this source — also resolves sources that yielded nothing new.
      onProgress({ type: 'facts', sourceLabel: src.label ?? src.connector, added: srcAdded, total });
    } catch (e) {
      // leave lastExtractedAt unset so it retries next refresh
      onProgress({ type: 'source-error', label: src.label ?? src.connector, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total });
  return { total, added };
}
