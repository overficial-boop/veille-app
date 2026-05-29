import { describe, it, expect } from 'vitest';
import { segmentByParagraph } from '../src/segment.js';

describe('segmentByParagraph', () => {
  it('returns empty array for empty input', () => {
    expect(segmentByParagraph('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(segmentByParagraph('   \n\n  \t\n  ')).toEqual([]);
  });

  it('returns one segment for a single paragraph', () => {
    const result = segmentByParagraph('Hello world.');
    expect(result).toEqual([{ start: 0, end: 0, text: 'Hello world.' }]);
  });

  it('splits on blank lines and assigns sequential paragraph indices', () => {
    const result = segmentByParagraph('First.\n\nSecond.\n\nThird.');
    expect(result).toEqual([
      { start: 0, end: 0, text: 'First.' },
      { start: 1, end: 1, text: 'Second.' },
      { start: 2, end: 2, text: 'Third.' },
    ]);
  });

  it('treats multiple blank lines as a single separator', () => {
    const result = segmentByParagraph('A.\n\n\n\nB.');
    expect(result).toEqual([
      { start: 0, end: 0, text: 'A.' },
      { start: 1, end: 1, text: 'B.' },
    ]);
  });

  it('trims and collapses whitespace inside a paragraph', () => {
    const result = segmentByParagraph('  Multi   spaces\n  and a wrapped line.  ');
    expect(result).toEqual([{ start: 0, end: 0, text: 'Multi spaces and a wrapped line.' }]);
  });

  it('ignores empty paragraphs at the start or end', () => {
    const result = segmentByParagraph('\n\nReal paragraph.\n\n');
    expect(result).toEqual([{ start: 0, end: 0, text: 'Real paragraph.' }]);
  });

  it('handles paragraphs separated only by blank-with-spaces lines', () => {
    const result = segmentByParagraph('A.\n   \nB.');
    expect(result).toEqual([
      { start: 0, end: 0, text: 'A.' },
      { start: 1, end: 1, text: 'B.' },
    ]);
  });
});
