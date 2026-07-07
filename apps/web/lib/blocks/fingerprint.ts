import { createHash } from 'node:crypto';

/** Short stable hash of arbitrary content (cache keys, not security). */
export function contentFingerprint(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Fact-pool version: changes whenever a refresh lands or the pool size moves. */
export function factPoolFingerprint(refreshedAtIso: string | null, factCount: number): string {
  return `fp:${refreshedAtIso ?? 'never'}:${factCount}`;
}

/** Combine prerequisite fingerprints into one instance-target fingerprint. Order-sensitive by design. */
export function combineFingerprints(parts: string[]): string {
  return contentFingerprint(parts.join('|'));
}
