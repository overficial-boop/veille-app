import { describe, it, expect } from 'vitest';
import { isYouTubeUrl, extractVideoId } from '../src/url.js';

describe('isYouTubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc', true],
    ['https://youtube.com/watch?v=abc', true],
    ['https://m.youtube.com/watch?v=abc', true],
    ['https://music.youtube.com/watch?v=abc', true],
    ['https://youtu.be/abc', true],
    ['https://example.com/watch?v=abc', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isYouTubeUrl(url)).toBe(expected);
  });
});

describe('extractVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=tracking', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/abc12345678', 'abc12345678'],
    ['https://www.youtube.com/live/xyz67890123', 'xyz67890123'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
  ])('%s → %s', (url, expected) => {
    expect(extractVideoId(url)).toBe(expected);
  });

  it('returns null for non-video URLs', () => {
    expect(extractVideoId('https://www.youtube.com/')).toBeNull();
    expect(extractVideoId('not a url')).toBeNull();
  });
});
