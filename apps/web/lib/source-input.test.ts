import { describe, it, expect } from 'vitest';
import { youtubeFeedFromInput, sourceSpecToRow } from './source-input';

describe('youtubeFeedFromInput', () => {
  const feed = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  it('maps a bare UC id to its feed', () => {
    expect(youtubeFeedFromInput('UCABCDEFGHIJKLMNOPQRSTUV')).toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('maps a /channel/UC… URL to its feed', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/channel/UCABCDEFGHIJKLMNOPQRSTUV/videos'))
      .toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('passes a channel feed URL through (normalized)', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/feeds/videos.xml?channel_id=UCABCDEFGHIJKLMNOPQRSTUV'))
      .toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('returns null for an @handle (needs network) and for non-YouTube text', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/@mkbhd')).toBeNull();
    expect(youtubeFeedFromInput('@mkbhd')).toBeNull();
    expect(youtubeFeedFromInput('le procès du siècle')).toBeNull();
  });
});

describe('sourceSpecToRow', () => {
  it('web → item/web', () => {
    expect(sourceSpecToRow('web', '  https://lemonde.fr/x  ')).toEqual({
      connector: 'web', kind: 'item', input: { url: 'https://lemonde.fr/x' }, label: 'https://lemonde.fr/x',
    });
  });
  it('search → standing/tavily', () => {
    expect(sourceSpecToRow('search', 'gabriel attal')).toEqual({
      connector: 'tavily', kind: 'standing', input: { query: 'gabriel attal' }, label: 'gabriel attal',
    });
  });
  it('rss → standing/rss with resolved label, falling back to the value', () => {
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed', { feedUrl: 'https://blog.fr/feed', label: 'Le Blog' })).toEqual({
      connector: 'rss', kind: 'standing', input: { feedUrl: 'https://blog.fr/feed' }, label: 'Le Blog',
    });
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed').label).toBe('https://blog.fr/feed');
  });
  it('youtube → standing/rss carrying the feed + source hint', () => {
    expect(sourceSpecToRow('youtube', '@mkbhd', { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', label: 'MKBHD' })).toEqual({
      connector: 'rss', kind: 'standing',
      input: { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', source: 'youtube' },
      label: 'MKBHD',
    });
  });
});
