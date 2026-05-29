import { describe, it, expect } from 'vitest';
import { reconstructPassage } from '../src/passage.js';
import type { Segment } from '../src/chunk.js';

const seg = (start: number, end: number, text: string): Segment => ({ start, end, text });

describe('reconstructPassage', () => {
  it('returns empty string when no segments overlap the range', () => {
    const segs = [seg(0, 5, 'a'), seg(5, 10, 'b')];
    expect(reconstructPassage(segs, 100, 110)).toBe('');
  });

  it('returns empty string for empty segment list', () => {
    expect(reconstructPassage([], 0, 100)).toBe('');
  });

  it('joins fully-contained segments with single spaces', () => {
    const segs = [seg(0, 5, 'hello'), seg(5, 10, 'world'), seg(10, 15, '!')];
    expect(reconstructPassage(segs, 0, 10)).toBe('hello world');
  });

  it('includes a segment whose start is before the range but end is inside', () => {
    const segs = [seg(0, 8, 'hello'), seg(8, 15, 'world')];
    expect(reconstructPassage(segs, 5, 10)).toBe('hello world');
  });

  it('includes a segment whose end is after the range but start is inside', () => {
    const segs = [seg(0, 5, 'a'), seg(5, 20, 'b')];
    expect(reconstructPassage(segs, 0, 10)).toBe('a b');
  });

  it('collapses internal whitespace from segment text', () => {
    const segs = [seg(0, 5, '  hello  '), seg(5, 10, '\tworld\n')];
    expect(reconstructPassage(segs, 0, 10)).toBe('hello world');
  });

  describe('inclusive mode', () => {
    it('matches a point-segment with a point-range (paragraph index)', () => {
      const segs = [seg(2, 2, 'two'), seg(3, 3, 'three'), seg(4, 4, 'four')];
      expect(reconstructPassage(segs, 3, 3, { inclusive: true })).toBe('three');
    });

    it('includes both endpoints in a multi-point range', () => {
      const segs = [seg(0, 0, 'a'), seg(1, 1, 'b'), seg(2, 2, 'c'), seg(3, 3, 'd'), seg(4, 4, 'e')];
      expect(reconstructPassage(segs, 1, 3, { inclusive: true })).toBe('b c d');
    });

    it('returns empty when range falls outside the segment list', () => {
      const segs = [seg(0, 0, 'a'), seg(1, 1, 'b')];
      expect(reconstructPassage(segs, 5, 5, { inclusive: true })).toBe('');
    });
  });
});
