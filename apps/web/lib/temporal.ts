/**
 * Temporal helpers for the two-stream journal. Pure (no db/env) so they're unit-testable
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

export type Stream = 'actualite' | 'complement';

/** Classify a newly-found fact as recent news ("actualite") vs older backfill ("complement"),
 *  relative to the cutoff (previous refresh/update boundary). Unknown date → complement.
 *  Null cutoff (first update) → actualite (nothing prior to compare against). */
export function classify(fact: { provenance: unknown }, cutoff: Date | null): Stream {
  if (cutoff === null) return 'actualite';
  const pub = factPublishedAt(fact);
  return pub !== null && pub > cutoff ? 'actualite' : 'complement';
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

/** Count facts that should prompt a brief rebuild: published before the brief was built
 *  (classify → 'complement', incl. unknown dates) AND found since the brief / since the
 *  last snooze. Returns 0 when no brief exists yet. Pure (testable). */
export function countPendingRebuild(
  facts: { createdAt: Date; provenance: unknown }[],
  briefGeneratedAt: Date | null,
  dismissedAt: Date | null,
): number {
  if (!briefGeneratedAt) return 0;
  const floor = dismissedAt && dismissedAt > briefGeneratedAt ? dismissedAt : briefGeneratedAt;
  return facts.filter((f) => f.createdAt > floor && classify(f, briefGeneratedAt) === 'complement').length;
}
