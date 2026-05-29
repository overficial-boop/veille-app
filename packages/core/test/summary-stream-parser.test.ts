import { describe, it, expect } from 'vitest';
import { createSummaryStreamParser } from '../src/summary-stream-parser.js';

function captured(): { emit: (s: string) => void; out: () => string } {
  let acc = '';
  return { emit: (s) => { acc += s; }, out: () => acc };
}

describe('createSummaryStreamParser', () => {
  it('emits nothing before the summary value starts', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    p.feed('{"summary"');
    expect(c.out()).toBe('');
  });

  it('emits summary characters as they arrive in chunks', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    p.feed('{"summary": "Hello, ');
    p.feed('world!", "facts": [');
    p.done();
    expect(c.out()).toBe('Hello, world!');
    expect(p.isComplete()).toBe(true);
  });

  it('decodes basic escape sequences', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    p.feed('{"summary": "line1\\nline2 \\"quoted\\" \\\\done", "facts": []}');
    p.done();
    expect(c.out()).toBe('line1\nline2 "quoted" \\done');
  });

  it('tolerates whitespace around colon and quote', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    p.feed('{   "summary"   :    "abc", "facts": []}');
    p.done();
    expect(c.out()).toBe('abc');
  });

  it('stops emitting after the closing quote of summary', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    p.feed('{"summary": "x"');
    p.feed(', "facts": [{"text":"y"}]}');
    p.done();
    expect(c.out()).toBe('x');
  });

  it('handles char-by-char feeds (single-character chunks)', () => {
    const c = captured();
    const p = createSummaryStreamParser(c.emit);
    for (const ch of '{"summary": "abc", "facts": []}') p.feed(ch);
    p.done();
    expect(c.out()).toBe('abc');
  });
});
