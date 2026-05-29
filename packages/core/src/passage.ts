import type { Segment } from './chunk.js';

/**
 * Reconstruct the verbatim source passage for a fact from content segments,
 * given a locator range produced by the LLM.
 *
 * Default semantics treat the range as half-open `[startVal, endVal)` and
 * include any segment whose own half-open `[start, end)` overlaps it — the
 * right choice for continuous locators like seconds.
 *
 * When `opts.inclusive` is true, both the request and the segment are treated
 * as closed `[start, end]` ranges. This is required for discrete locators
 * (paragraph indices) where a single-element fact is emitted as `[3, 3]` and
 * each segment has `start === end`.
 *
 * Returns an empty string if nothing matches — that absence is itself a
 * useful audit signal.
 */
export function reconstructPassage(
  segments: Segment[],
  startVal: number,
  endVal: number,
  opts?: { inclusive?: boolean },
): string {
  const overlapping = opts?.inclusive
    ? segments.filter((s) => s.end >= startVal && s.start <= endVal)
    : segments.filter((s) => s.end > startVal && s.start < endVal);
  return overlapping
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
