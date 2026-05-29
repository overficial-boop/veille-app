/**
 * A generic transcript/content segment.
 * `start` and `end` are locator values — in YouTube context they are seconds
 * into the video, but other adapters may use different units (paragraph index,
 * line number, byte offset, etc.).
 */
export type Segment = {
  start: number;
  end: number;
  text: string;
};

/**
 * Default window size when chunking. The YouTube adapter sends videos at or
 * below 90 min in single-call mode (no chunking); chunking only applies when a
 * video is longer than that. 60-minute windows mean a 3-hour video splits into
 * 3 chunks instead of 36, which is the right scale for long-form content.
 */
export const CHUNK_DURATION_SECONDS = 60 * 60;

/**
 * Bidirectional overlap added to each chunk on both ends. A fact whose
 * supporting passage straddles a window boundary is therefore visible in BOTH
 * neighboring chunks; the pipeline dedups identical-range facts at merge.
 * 30s is generous for transcript-speed content and adds ~1% overhead at the
 * 60-min default window.
 */
export const CHUNK_OVERLAP_SECONDS = 30;

export type Chunk = {
  /** Logical start of this chunk's primary window (excludes the overlap pad). */
  startSeconds: number;
  /** Logical end of this chunk's primary window (excludes the overlap pad). */
  endSeconds: number;
  segments: Segment[];
};

/**
 * Chunk segments into overlapping windows of `windowSize` seconds. Each chunk's
 * `segments` field includes any segment whose `[start, end)` interval overlaps
 * the *padded* window `[windowStart - overlap, windowEnd + overlap]`. The
 * chunk's `startSeconds`/`endSeconds` reflect the *unpadded* logical bounds.
 *
 * Windows whose padded range contains no segments are dropped entirely.
 */
export function chunkSegments(
  segments: Segment[],
  windowSize: number = CHUNK_DURATION_SECONDS,
  overlap: number = CHUNK_OVERLAP_SECONDS,
): Chunk[] {
  if (segments.length === 0) return [];
  const totalEnd = segments[segments.length - 1]!.end;
  const chunks: Chunk[] = [];
  for (let windowStart = 0; windowStart < totalEnd; windowStart += windowSize) {
    const windowEnd = windowStart + windowSize;
    const padStart = Math.max(0, windowStart - overlap);
    const padEnd = windowEnd + overlap;
    const included = segments.filter((s) => s.end > padStart && s.start < padEnd);
    if (included.length === 0) continue;
    chunks.push({ startSeconds: windowStart, endSeconds: windowEnd, segments: included });
  }
  return chunks;
}
