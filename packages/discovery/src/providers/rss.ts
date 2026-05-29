import Parser from 'rss-parser';
import type { RssConfig } from '@veille/core';
import type { Candidate } from '../types.js';
import { DiscoveryProviderError } from '../types.js';

const parser = new Parser({
  timeout: 30_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

const DEFAULT_MAX_ITEMS = 20;

function clipExcerpt(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > 300 ? cleaned.slice(0, 300) + '…' : cleaned;
}

export async function discoverRss(config: RssConfig): Promise<Candidate[]> {
  let feed;
  try {
    feed = await parser.parseURL(config.feedUrl);
  } catch (err) {
    throw new DiscoveryProviderError(
      `RSS fetch failed for ${config.feedUrl}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const siteName =
    typeof feed.title === 'string' && feed.title.trim().length > 0
      ? feed.title.trim()
      : undefined;

  const max = config.maxItems ?? DEFAULT_MAX_ITEMS;
  const items = (feed.items ?? []).filter((i) => typeof i.link === 'string' && i.link.length > 0);

  return items.slice(0, max).map((item) => {
    const candidate: Candidate = { url: item.link! };
    if (item.title) candidate.title = item.title;
    if (item.isoDate) candidate.publishedAt = item.isoDate;
    else if (item.pubDate) candidate.publishedAt = item.pubDate;
    const meta = item as { creator?: string; author?: string; contentSnippet?: string };
    const author = meta.creator ?? meta.author;
    if (author && typeof author === 'string') candidate.author = author;
    if (siteName) candidate.siteName = siteName;
    const excerpt = clipExcerpt(meta.contentSnippet ?? item.content);
    if (excerpt) candidate.excerpt = excerpt;
    return candidate;
  });
}
