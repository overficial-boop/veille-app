import { describe, it, expect } from 'vitest';
import {
  chunkSegments,
  CHUNK_DURATION_SECONDS,
  CHUNK_OVERLAP_SECONDS,
} from '../src/chunk.js';
import type { Segment } from '../src/chunk.js';

const seg = (start: number, end: number, text = ''): Segment => ({ start, end, text });

describe('chunkSegments', () => {
  it('returns empty array for empty input', () => {
    expect(chunkSegments([])).toEqual([]);
  });

  it('puts all segments in one chunk when total duration < window', () => {
    const segs = [seg(0, 30), seg(30, 60), seg(60, 90)];
    const chunks = chunkSegments(segs);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.segments).toHaveLength(3);
    expect(chunks[0]?.startSeconds).toBe(0);
    expect(chunks[0]?.endSeconds).toBe(CHUNK_DURATION_SECONDS);
  });

  it('default window is 1 hour with 30s overlap', () => {
    expect(CHUNK_DURATION_SECONDS).toBe(60 * 60);
    expect(CHUNK_OVERLAP_SECONDS).toBe(30);
  });

  it('splits on hour boundaries with logical (unpadded) startSeconds', () => {
    // 3 hr 1 min of segments, one every 10 minutes.
    const segs: Segment[] = [];
    for (let t = 0; t < 3 * 60 * 60 + 60; t += 600) {
      segs.push(seg(t, t + 30));
    }
    const chunks = chunkSegments(segs);
    expect(chunks.map((c) => c.startSeconds)).toEqual([0, 3600, 7200, 10800]);
    expect(chunks.map((c) => c.endSeconds)).toEqual([3600, 7200, 10800, 14400]);
  });

  it('places a segment near a window boundary into both neighboring chunks (bidirectional overlap)', () => {
    // Default window 3600s; overlap 30s.
    const boundarySegment = seg(3590, 3605); // straddles the 3600 boundary
    const padding = [seg(0, 30), seg(7100, 7130)]; // ensure chunks 0 and 1 both exist
    const segs = [...padding.slice(0, 1), boundarySegment, ...padding.slice(1)];
    const chunks = chunkSegments(segs);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The boundary segment should appear in both chunk 0 and chunk 1.
    const inChunk0 = chunks[0]!.segments.some((s) => s === boundarySegment);
    const inChunk1 = chunks[1]!.segments.some((s) => s === boundarySegment);
    expect(inChunk0).toBe(true);
    expect(inChunk1).toBe(true);
  });

  it('places a segment fully inside the pad zone into both chunks too', () => {
    // Segment at 3580-3590: ends *before* the 3600 boundary but inside chunk 1's pre-pad [3570, 3600).
    const padded = seg(3580, 3590);
    const padding = [seg(0, 30), seg(7100, 7130)];
    const segs = [padding[0]!, padded, padding[1]!];
    const chunks = chunkSegments(segs);
    expect(chunks[0]!.segments).toContain(padded);
    expect(chunks[1]!.segments).toContain(padded);
  });

  it('drops empty windows (no segments in their padded range)', () => {
    // Only one segment near time 0; second hour-window would be empty → not emitted.
    const chunks = chunkSegments([seg(0, 30)]);
    expect(chunks).toHaveLength(1);
  });

  it('accepts a custom window size', () => {
    // 5-min windows, three segments spanning 10 minutes.
    const segs = [seg(0, 30), seg(290, 310), seg(601, 620)];
    const chunks = chunkSegments(segs, 300);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.startSeconds).toBe(0);
    expect(chunks[0]!.endSeconds).toBe(300);
  });

  it('overlap parameter controls how far past the window edge to include', () => {
    // Segment 3500–3550 ends 50s before the boundary — not straddling, but
    // close. With small overlap it appears in chunk 0 only; with overlap
    // large enough to reach back from chunk 1's window, it also appears in
    // chunk 1.
    const segs = [seg(0, 30), seg(3500, 3550), seg(7100, 7130)];

    const tight = chunkSegments(segs, 3600, 0);
    expect(tight[1]!.segments.some((s) => s.start === 3500)).toBe(false);

    const generous = chunkSegments(segs, 3600, 200);
    expect(generous[1]!.segments.some((s) => s.start === 3500)).toBe(true);
  });
});
