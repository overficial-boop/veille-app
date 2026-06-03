import Parser from 'rss-parser';
import { mapWithConcurrency } from '@veille/core';
import type { Candidate } from '../types.js';
import { decodeGoogleNewsUrl } from './google-news-decode.js';

export type GoogleNewsConfig = { query: string; language?: string; maxItems?: number };

const DEFAULT_MAX_ITEMS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LOCALES: Record<string, { hl: string; gl: string }> = {
  fr: { hl: 'fr', gl: 'FR' },
  en: { hl: 'en', gl: 'US' },
  es: { hl: 'es', gl: 'ES' },
  de: { hl: 'de', gl: 'DE' },
  it: { hl: 'it', gl: 'IT' },
  pt: { hl: 'pt', gl: 'BR' },
};

/** Map a dossier language to a Google News {hl, gl}. Defaults to en/US. */
export function localeFor(language: string | undefined): { hl: string; gl: string } {
  return LOCALES[(language ?? 'en').toLowerCase()] ?? LOCALES.en!;
}

/** Google News titles are "Headline - Publisher"; drop the trailing publisher segment. */
export function cleanTitle(title: string): string {
  const i = title.lastIndexOf(' - ');
  return i > 0 ? title.slice(0, i).trim() : title.trim();
}

/** Localized Google News search RSS URL. */
export function buildFeedUrl(query: string, language: string | undefined): string {
  const { hl, gl } = localeFor(language);
  const ceid = encodeURIComponent(`${gl}:${hl}`);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

const parser = new Parser({ timeout: 30_000, headers: { 'User-Agent': UA } });

type GItem = { title?: string; link?: string; isoDate?: string; pubDate?: string; source?: { title?: string } | string };

/** Fresh, localized news for a query. Each item's google-redirect link is decoded to its publisher
 *  URL; items whose link can't be decoded are skipped. Candidates are UNSCORED (the app's relevance
 *  scorer is the gate). */
export async function discoverGoogleNews(config: GoogleNewsConfig): Promise<Candidate[]> {
  const feed = await parser.parseURL(buildFeedUrl(config.query, config.language));
  const items = ((feed.items ?? []) as GItem[]).filter((i) => typeof i.link === 'string' && i.link.length > 0);
  const top = items.slice(0, config.maxItems ?? DEFAULT_MAX_ITEMS);

  const resolved = await mapWithConcurrency(top, 4, async (item) => {
    const url = await decodeGoogleNewsUrl(item.link!);
    if (!url) return null;
    const cand: Candidate = { url };
    if (item.title) cand.title = cleanTitle(item.title);
    const date = item.isoDate ?? item.pubDate;
    if (date) cand.publishedAt = date;
    const src = typeof item.source === 'string' ? item.source : item.source?.title;
    if (src) cand.siteName = src;
    return cand;
  });
  return resolved.filter((c): c is Candidate => c !== null);
}
