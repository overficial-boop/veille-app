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
 *  publication date must stay unknown so the fact classifies as a "complément". */
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

