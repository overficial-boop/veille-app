import { eq, and, inArray } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, documents, facts } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel, discoverWatch } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { freshCandidates } from './dedup';
import { isRecentCandidate } from './temporal';
import { upsertDocument, extractFactsForDocument } from './documents';
import { listJournal, promoteFactsToJournal } from './dossiers';
import { selectJournalWorthy, journalTextsOf } from './journal';
import { hostOf } from './host';
import { getRefreshConfig, type RefreshConfig } from './refresh-config';
import { sourcesForPhase } from './source-phase';
import { scoreRelevance } from './relevance';
import type { SynthesisProgress } from './synthesis';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'document'; sourceLabel: string; title: string; status: 'kept' | 'suggestion'; kept: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'journal'; state: 'start' | 'done'; promoted: number }
  | { type: 'done'; total: number };

export type StreamProgress = RefreshProgress | SynthesisProgress;

type SourceRow = typeof sources.$inferSelect;

async function candidatesFor(source: SourceRow, language: string, daysOverride?: number): Promise<Candidate[]> {
  if (source.connector === 'google-news') {
    return discoverWatch({ query: (source.input as { query: string }).query, language });
  }
  if (source.connector === 'tavily') {
    const input = daysOverride ? { ...(source.input as object), days: daysOverride } : source.input;
    return discoverTavily(input as never);
  }
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}

/** Everything a single-candidate pull needs, independent of phase/source. */
type PullCtx = { dossierId: string; intent: string; language: string; cfg: RefreshConfig };

/** Fetch content-only, score relevance, upsert a curated document (no fact extraction).
 *  Returns the curation status for progress reporting. Shared by the refresh loop and the
 *  ad-hoc pull (mode recherche). */
async function processCandidate(
  ctx: PullCtx,
  url: string,
  candPublishedAt: string | undefined,
  candTitle: string | undefined,
): Promise<'kept' | 'suggestion'> {
  let captured = '';
  await extract(url, { language: ctx.language, contentOnly: true, onContent: (t) => { captured = t; } });
  const rel = captured
    ? await scoreRelevance({ title: candTitle ?? url, content: captured, intent: ctx.intent, language: ctx.language, contentBudget: ctx.cfg.relevanceContentBudget })
    : { score: 0, reason: 'contenu indisponible' };
  const status: 'kept' | 'suggestion' = rel.score >= ctx.cfg.relevanceKeepFloor ? 'kept' : 'suggestion';
  const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
  const siteName = yt ? 'youtube.com' : hostOf(url);
  const publishedAt = candPublishedAt ? new Date(candPublishedAt) : null;
  await upsertDocument(ctx.dossierId, {
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

  const allRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const srcRows = sourcesForPhase(allRows, phase);
  // Seed seen-URLs from documents already pulled, so re-runs (refresh / re-assemble) skip them
  // instead of re-fetching + re-scoring (each candidate costs a fetch + a relevance LLM call).
  const existingDocs = await db.select({ url: documents.url }).from(documents).where(eq(documents.dossierId, dossierId));
  const seenUrls = new Set(existingDocs.map((d) => d.url));
  // Shared per-candidate context (richer "name — intent" hint preferred for relevance scoring).
  const ctx: PullCtx = { dossierId, intent: subjectHint || dossier?.intent || '', language: lang, cfg };
  let kept = 0;
  let suggested = 0;
  const newKeptUrls: string[] = [];

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
    try {
      if (src.kind === 'standing') {
        const cands = await candidatesFor(src, lang, daysSince);
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
            const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);
            if (status === 'kept') { kept++; newKeptUrls.push(c.url); } else suggested++;
            onProgress({ type: 'document', sourceLabel: src.label ?? src.connector, title: c.title ?? c.url, status, kept, total: kept + suggested });
          } catch {
            /* skip a bad candidate URL, keep going */
          }
        }
      } else {
        const url = (src.input as { url: string }).url;
        const title = src.label ?? undefined;
        try {
          const status = await processCandidate(ctx, url, undefined, title);
          if (status === 'kept') { kept++; newKeptUrls.push(url); } else suggested++;
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

  // Journal: on refresh, extract facts from the docs newly kept this run, then let the LLM gate
  // promote the genuinely-new + important ones (vs the brief + existing journal).
  if (phase === 'refresh' && cfg.journalEnabled && newKeptUrls.length > 0 && dossier) {
    const newDocs = await db
      .select({ id: documents.id, url: documents.url, title: documents.title, content: documents.content })
      .from(documents)
      .where(and(eq(documents.dossierId, dossierId), inArray(documents.url, newKeptUrls)));
    const dossierForFacts = { id: dossier.id, name: dossier.name, intent: dossier.intent, language: dossier.language };
    for (const doc of newDocs) {
      try { await extractFactsForDocument(dossierForFacts, doc); } catch { /* skip a doc that won't extract */ }
    }
    const candidates = newDocs.length
      ? await db
          .select({ id: facts.id, text: facts.text })
          .from(facts)
          .where(and(eq(facts.dossierId, dossierId), inArray(facts.documentId, newDocs.map((d) => d.id))))
      : [];
    if (candidates.length > 0) {
      onProgress({ type: 'journal', state: 'start', promoted: 0 });
      try {
        const journalTexts = journalTextsOf(await listJournal(dossierId));
        const selections = await selectJournalWorthy({
          subject: subjectHint || dossier.intent || dossier.name,
          brief: dossier.brief ?? '',
          journalTexts,
          candidates,
          max: cfg.journalMaxPerRefresh,
        });
        await promoteFactsToJournal(dossierId, selections);
        onProgress({ type: 'journal', state: 'done', promoted: selections.length });
      } catch {
        onProgress({ type: 'journal', state: 'done', promoted: 0 });
      }
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total: kept + suggested });
  return { kept, suggested, total: kept + suggested };
}

/** One-off ad-hoc pull (mode recherche): runs the curate pipeline over a single Tavily query and
 *  lands documents in the feed/suggestions by the usual relevance floor. Creates NO source and does
 *  NOT advance refreshedAt — it only grows the curated set. Dedups against existing document URLs. */
export async function pullAdHoc(
  dossierId: string,
  query: string,
  opts: { language?: string } = {},
): Promise<{ kept: number; suggested: number; total: number }> {
  registerAllAdapters();
  const q = query.trim();
  if (!q) return { kept: 0, suggested: 0, total: 0 };
  const cfg = getRefreshConfig();
  const lang = opts.language ?? 'fr';

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return { kept: 0, suggested: 0, total: 0 };
  const subjectHint = [dossier.name, dossier.intent].filter(Boolean).join(' — ');
  const ctx: PullCtx = { dossierId, intent: subjectHint || dossier.intent || '', language: lang, cfg };

  const existingDocs = await db.select({ url: documents.url }).from(documents).where(eq(documents.dossierId, dossierId));
  const seenUrls = new Set(existingDocs.map((d) => d.url));

  const cands = (await discoverTavily({ query: q })).filter((c) => !/youtube\.com\/shorts\//i.test(c.url));
  const ranked = [...cands]
    .filter((c) => c.score === undefined || c.score >= cfg.candidateScoreFloor)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, cfg.assembleCandidatesPerSource);

  let kept = 0;
  let suggested = 0;
  for (const c of freshCandidates(ranked, seenUrls)) {
    if (!findAdapter({ kind: 'url', url: c.url })) continue;
    try {
      const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);
      if (status === 'kept') kept++; else suggested++;
    } catch {
      /* skip a bad candidate URL, keep going */
    }
  }
  return { kept, suggested, total: kept + suggested };
}
