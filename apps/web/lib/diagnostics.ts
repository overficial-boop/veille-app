// Pure discovery-funnel logic. DB-free so it's unit-testable and reusable by the refresh
// instrumentation, the live probe, and the admin Tester re-bucketing.
import { isWithinDays } from './temporal';

export type FunnelVerdict =
  | 'kept' | 'suggestion'
  | 'rejected:score' | 'rejected:low-rank' | 'rejected:recency' | 'rejected:seen' | 'rejected:no-content';

export type FunnelEntry = {
  query: string;
  url: string;
  title?: string;
  publishedAt?: string;
  siteName?: string;
  providerScore?: number;
  verdict: FunnelVerdict;
  relevance?: number | null;
  relevanceReason?: string;
};

type RawCand = { url: string; title?: string; publishedAt?: string; siteName?: string; score?: number };

/** Stage raw candidates (post-shorts) through score-floor → rank-cut → recency → seen, recording a
 *  funnel entry for each dropped one and returning the survivors to fetch + relevance-score. PURE. */
export function classifyDiscovery(
  cands: RawCand[],
  opts: { query: string; candidateScoreFloor: number; perSource: number; isRecent: (publishedAt?: string) => boolean; seenUrls: Set<string> },
): { funnel: FunnelEntry[]; toProcess: RawCand[] } {
  const funnel: FunnelEntry[] = [];
  const e = (c: RawCand, verdict: FunnelVerdict): FunnelEntry => ({
    query: opts.query, url: c.url, title: c.title, publishedAt: c.publishedAt, siteName: c.siteName, providerScore: c.score, verdict,
  });
  const scored: RawCand[] = [];
  for (const c of cands) {
    if (c.score !== undefined && c.score < opts.candidateScoreFloor) funnel.push(e(c, 'rejected:score'));
    else scored.push(c);
  }
  const ranked = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = ranked.slice(0, opts.perSource);
  for (const c of ranked.slice(opts.perSource)) funnel.push(e(c, 'rejected:low-rank'));
  const recent: RawCand[] = [];
  for (const c of top) { if (opts.isRecent(c.publishedAt)) recent.push(c); else funnel.push(e(c, 'rejected:recency')); }
  const toProcess: RawCand[] = [];
  for (const c of recent) { if (opts.seenUrls.has(c.url)) funnel.push(e(c, 'rejected:seen')); else toProcess.push(c); }
  return { funnel, toProcess };
}

/** Verdict for a probe candidate under a set of knobs — the single source of truth for the Tester's
 *  instant re-bucketing. PURE. recencyDays 0 = window disabled. */
export function bucket(
  c: { providerScore?: number; publishedAt?: string; relevance?: number | null },
  knobs: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number },
  now: Date,
): FunnelVerdict {
  if (c.providerScore !== undefined && c.providerScore < knobs.candidateScoreFloor) return 'rejected:score';
  if (knobs.recencyDays > 0 && !isWithinDays(c.publishedAt, now, knobs.recencyDays)) return 'rejected:recency';
  if (c.relevance == null) return 'suggestion';
  return c.relevance >= knobs.relevanceKeepFloor ? 'kept' : 'suggestion';
}
