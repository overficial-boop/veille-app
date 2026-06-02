import { eq } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, documents } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { freshCandidates } from './dedup';
import { isRecentCandidate } from './temporal';
import { upsertDocument } from './documents';
import { hostOf } from './host';
import { getRefreshConfig } from './refresh-config';
import { scoreRelevance } from './relevance';
import type { SynthesisProgress } from './synthesis';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'document'; sourceLabel: string; title: string; status: 'kept' | 'suggestion'; kept: number; total: number }
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

export async function refreshDossier(
  dossierId: string,
  opts: { phase?: 'assemble' | 'refresh'; force?: boolean; language?: string; onProgress?: (p: RefreshProgress) => void } = {},
): Promise<{ kept: number; suggested: number; total: number }> {
  registerAllAdapters();
  // Depth knobs come from config. Only the candidate cap varies by phase — assemble goes
  // deep (more URLs per source), refresh stays shallow; the floors + content budget are
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
  // Seed seen-URLs from documents already pulled, so re-runs (refresh / re-assemble) skip them
  // instead of re-fetching + re-scoring (each candidate costs a fetch + a relevance LLM call).
  const existingDocs = await db.select({ url: documents.url }).from(documents).where(eq(documents.dossierId, dossierId));
  const seenUrls = new Set(existingDocs.map((d) => d.url));
  let kept = 0;
  let suggested = 0;

  // Fetch content-only, score relevance, and upsert a curated document (no fact extraction).
  // Facts are on-demand (a later task). Returns the curation status for progress reporting.
  async function processCandidate(
    url: string,
    candPublishedAt: string | undefined,
    candTitle: string | undefined,
  ): Promise<'kept' | 'suggestion'> {
    let captured = '';
    await extract(url, { language: lang, contentOnly: true, onContent: (t) => { captured = t; } });
    const intent = subjectHint || dossier?.intent || ''; // prefer the richer "name — intent" hint
    const rel = captured
      ? await scoreRelevance({ title: candTitle ?? url, content: captured, intent, language: lang, contentBudget: cfg.relevanceContentBudget })
      : { score: 0, reason: 'contenu indisponible' };
    const status: 'kept' | 'suggestion' = rel.score >= cfg.relevanceKeepFloor ? 'kept' : 'suggestion';
    const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
    const siteName = yt ? 'youtube.com' : hostOf(url);
    const publishedAt = candPublishedAt ? new Date(candPublishedAt) : null;
    await upsertDocument(dossierId, {
      url,
      title: candTitle ?? url,
      siteName,
      kind: yt ? 'youtube' : 'web',
      publishedAt,
      content: captured,
      status,
      relevance: rel.score,
      relevanceReason: rel.reason,
    });
    return status;
  }

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
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
        // Process candidates one at a time, emitting a document frame per candidate.
        for (const c of freshCandidates(recencyFiltered, seenUrls)) {
          if (!findAdapter({ kind: 'url', url: c.url })) continue;
          try {
            const status = await processCandidate(c.url, c.publishedAt, c.title);
            if (status === 'kept') kept++; else suggested++;
            onProgress({ type: 'document', sourceLabel: src.label ?? src.connector, title: c.title ?? c.url, status, kept, total: kept + suggested });
          } catch {
            /* skip a bad candidate URL, keep going */
          }
        }
      } else {
        const url = (src.input as { url: string }).url;
        const title = src.label ?? undefined;
        try {
          const status = await processCandidate(url, undefined, title);
          if (status === 'kept') kept++; else suggested++;
          onProgress({ type: 'document', sourceLabel: src.label ?? src.connector, title: title ?? url, status, kept, total: kept + suggested });
        } catch {
          /* bad item URL: skip; lastExtractedAt is still set below, so it isn't retried forever */
        }
      }
      await db.update(sources).set({ lastExtractedAt: new Date() }).where(eq(sources.id, src.id));
    } catch (e) {
      // leave lastExtractedAt unset so it retries next refresh
      onProgress({ type: 'source-error', label: src.label ?? src.connector, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total: kept + suggested });
  return { kept, suggested, total: kept + suggested };
}
