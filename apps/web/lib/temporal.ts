/**
 * Temporal helpers. Pure (no db/env) so they're unit-testable
 * and safe to import from synthesis.ts without triggering env validation.
 */

/** Parse an ISO-ish date string to a Date, or null if absent/unparseable. */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || s.trim() === '') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A fact's PUBLICATION date from provenance.publishedAt — or null if unknown.
 *  Unlike factDate() (display), this does NOT fall back to extractedAt: an unknown
 *  publication date must stay unknown so recency filtering treats it conservatively. */
export function factPublishedAt(fact: { provenance: unknown }): Date | null {
  const p = fact.provenance as { publishedAt?: unknown } | null;
  return p ? parseDate(p.publishedAt) : null;
}

/** Backfill a fact's provenance.publishedAt from a discovery candidate's date when the
 *  adapter didn't capture one and the candidate date is parseable. Returns a new fact
 *  (provenance shallow-cloned); never overwrites an existing publishedAt. */
export function backfillPublishedAt<T extends { provenance: unknown }>(
  fact: T,
  candidatePublishedAt: string | undefined,
): T {
  if (factPublishedAt(fact) !== null) return fact;
  const d = parseDate(candidatePublishedAt);
  if (!d) return fact;
  const prov = fact.provenance && typeof fact.provenance === 'object' ? fact.provenance : {};
  return { ...fact, provenance: { ...prov, publishedAt: d.toISOString() } };
}

/** A refresh candidate is "recent" if it has no usable date (unseen + recency-biased
 *  search ⇒ likely new) or it was published after the last refresh. */
export function isRecentCandidate(publishedAt: string | undefined, lastRefresh: Date | null): boolean {
  if (!lastRefresh) return true;
  const d = parseDate(publishedAt);
  return d === null || d > lastRefresh;
}

/** A refresh candidate is "within the recency window" if it has no usable date (kept, benefit of
 *  the doubt) or it was published within the last `days` (relative to `now`). Anchoring recency to
 *  a rolling window — NOT the last-refresh timestamp — means re-refreshing the same day still pulls
 *  recent articles (dedup against already-seen URLs prevents re-pulling). */
export function isWithinDays(publishedAt: string | undefined, now: Date, days: number): boolean {
  const d = parseDate(publishedAt);
  if (d === null) return true;
  const cutoff = now.getTime() - days * 86_400_000;
  return d.getTime() > cutoff;
}

