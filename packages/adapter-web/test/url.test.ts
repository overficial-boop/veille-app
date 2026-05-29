import { describe, it, expect } from 'vitest';
import { isWebUrl } from '../src/url.js';

describe('isWebUrl', () => {
  it.each([
    ['https://en.wikipedia.org/wiki/Padel', true],
    ['https://example.com/article', true],
    ['http://example.com/', true],
    ['https://www.lemonde.fr/sport/article/2026/05/14/foo.html', true],
    ['https://www.youtube.com/watch?v=abc', false],
    ['https://youtu.be/abc', false],
    ['https://m.youtube.com/watch?v=abc', false],
    ['https://music.youtube.com/watch?v=abc', false],
    ['ftp://example.com/file', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isWebUrl(url)).toBe(expected);
  });
});
