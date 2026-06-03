import { describe, it, expect } from 'vitest';
import { youtubeFeedFromInput, sourceSpecToRow, extractFeedTitle, sourceTargetField, sourceTarget } from './source-input';

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

describe('extractFeedTitle', () => {
  it('returns the feed/channel title (first <title>), not an item title', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Le Monde — Une</title><item><title><![CDATA[EN DIRECT : actu]]></title></item></channel></rss>`;
    expect(extractFeedTitle(xml)).toBe('Le Monde — Une');
  });
  it('strips a CDATA wrapper on the feed title', () => {
    const xml = `<feed><title><![CDATA[The Studio]]></title><entry><title>vid</title></entry></feed>`;
    expect(extractFeedTitle(xml)).toBe('The Studio');
  });
  it('keeps square brackets in the title', () => {
    const xml = `<rss><channel><title>[Podcast] Tech</title></channel></rss>`;
    expect(extractFeedTitle(xml)).toBe('[Podcast] Tech');
  });
  it('returns undefined when there is no title', () => {
    expect(extractFeedTitle('<rss><channel></channel></rss>')).toBeUndefined();
  });
});

describe('sourceTargetField', () => {
  it('maps connectors to their editable field', () => {
    expect(sourceTargetField('web')).toBe('url');
    expect(sourceTargetField('tavily')).toBe('query');
    expect(sourceTargetField('rss')).toBe('feedUrl');
    expect(sourceTargetField('unknown')).toBeNull();
  });
});
describe('sourceTarget', () => {
  it('reads the primary value, else empty string', () => {
    expect(sourceTarget('web', { url: 'https://x.fr' })).toBe('https://x.fr');
    expect(sourceTarget('tavily', { query: 'attal' })).toBe('attal');
    expect(sourceTarget('rss', { feedUrl: 'https://f', source: 'youtube' })).toBe('https://f');
    expect(sourceTarget('rss', {})).toBe('');
    expect(sourceTarget('unknown', { url: 'x' })).toBe('');
  });
});
describe('sourceSpecToRow', () => {
  it('web → item/web', () => {
    expect(sourceSpecToRow('web', '  https://lemonde.fr/x  ')).toEqual({
      connector: 'web', kind: 'item', purpose: 'state', input: { url: 'https://lemonde.fr/x' }, label: 'https://lemonde.fr/x',
    });
  });
  it('search → standing/google-news watch', () => {
    expect(sourceSpecToRow('search', 'gabriel attal')).toEqual({
      connector: 'google-news', kind: 'standing', purpose: 'watch', input: { query: 'gabriel attal' }, label: 'gabriel attal',
    });
  });
  it('rss → standing/rss with resolved label, falling back to the value', () => {
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed', { feedUrl: 'https://blog.fr/feed', label: 'Le Blog' })).toEqual({
      connector: 'rss', kind: 'standing', purpose: 'watch', input: { feedUrl: 'https://blog.fr/feed' }, label: 'Le Blog',
    });
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed').label).toBe('https://blog.fr/feed');
  });
  it('youtube → standing/rss carrying the feed + source hint', () => {
    expect(sourceSpecToRow('youtube', '@mkbhd', { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', label: 'MKBHD' })).toEqual({
      connector: 'rss', kind: 'standing', purpose: 'watch',
      input: { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', source: 'youtube' },
      label: 'MKBHD',
    });
  });
});

describe('sourceSpecToRow purpose', () => {
  it('tags manual search/rss/youtube as watch, web item as state', () => {
    expect(sourceSpecToRow('web', 'https://x.fr/a').purpose).toBe('state');
    expect(sourceSpecToRow('search', 'requête').purpose).toBe('watch');
    expect(sourceSpecToRow('rss', 'https://x.fr/feed', { feedUrl: 'https://x.fr/feed' }).purpose).toBe('watch');
    expect(sourceSpecToRow('youtube', '@chan', { feedUrl: 'https://f', label: 'C' }).purpose).toBe('watch');
  });
});
