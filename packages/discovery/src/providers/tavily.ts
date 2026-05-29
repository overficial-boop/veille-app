import type { TavilyConfig } from '@veille/core';
import type { Candidate } from '../types.js';
import { DiscoveryProviderError, TavilyKeyMissingError } from '../types.js';

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_DAYS = 30;

function hostnameFrom(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function clipExcerpt(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.length > 300 ? cleaned.slice(0, 300) + '…' : cleaned;
}

type TavilyResponseItem = {
  url?: string;
  title?: string;
  published_date?: string;
  content?: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResponseItem[];
};

export async function discoverTavily(config: TavilyConfig): Promise<Candidate[]> {
  const apiKey = process.env['VEILLE_TAVILY_KEY'];
  if (!apiKey) throw new TavilyKeyMissingError();

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: config.query,
    search_depth: 'basic',
    max_results: Math.min(20, config.maxResults ?? DEFAULT_MAX_RESULTS),
    days: config.days ?? DEFAULT_DAYS,
  };
  if (config.topic) body['topic'] = config.topic;
  if (config.includeDomains && config.includeDomains.length > 0) {
    body['include_domains'] = config.includeDomains;
  }

  let res: Response;
  try {
    res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DiscoveryProviderError(
      `Tavily request failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) detail += `: ${text.slice(0, 200)}`;
    } catch {
      // ignore
    }
    throw new DiscoveryProviderError(`Tavily API error: ${detail}`);
  }

  let data: TavilyResponse;
  try {
    data = (await res.json()) as TavilyResponse;
  } catch (err) {
    throw new DiscoveryProviderError(
      `Tavily response not JSON: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const items = data.results ?? [];
  const out: Candidate[] = [];
  for (const item of items) {
    if (!item.url) continue;
    const cand: Candidate = { url: item.url };
    if (item.title) cand.title = item.title;
    if (item.published_date) cand.publishedAt = item.published_date;
    const site = hostnameFrom(item.url);
    if (site) cand.siteName = site;
    const excerpt = clipExcerpt(item.content);
    if (excerpt) cand.excerpt = excerpt;
    out.push(cand);
  }
  return out;
}
