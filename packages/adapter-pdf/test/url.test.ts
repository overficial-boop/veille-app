import { describe, it, expect } from 'vitest';
import { isLikelyPdfUrl } from '../src/url.js';

describe('isLikelyPdfUrl', () => {
  it.each([
    ['https://example.com/paper.pdf', true],
    ['https://example.com/papers/2024.pdf', true],
    ['http://example.com/x.PDF', true],
    ['https://example.com/x.pdf?download=1', true],
    ['https://example.com/article', false],
    ['https://example.com/x.pdf.html', false],
    ['ftp://example.com/x.pdf', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isLikelyPdfUrl(url)).toBe(expected);
  });
});
