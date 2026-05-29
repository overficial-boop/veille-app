import { selectLlmClient } from '@veille/core';
import type {
  LlmClient,
  RssConfig,
  TavilyConfig,
  YouTubeChannelConfig,
} from '@veille/core';
import { discoverRss } from './providers/rss.js';
import { discoverTavily } from './providers/tavily.js';
import { planTavilyQueries } from './plan-queries.js';
import type { PlanQueriesInput, PlanQueriesResult } from './plan-queries.js';
import { Innertube } from 'youtubei.js';
import { isYouTubeUrl } from '@veille/adapter-youtube';
import { isLikelyPdfUrl } from '@veille/adapter-pdf';
import {
  fetchHtml,
  extractArticle,
  WebContentEmptyError,
  WebFetchError,
} from '@veille/adapter-web';

// ---------- Types ----------

export type SuggestionStatus = 'verified' | 'broken' | 'unchecked';

export type SeedSourceSuggestion = {
  url: string;
  title?: string;
  rationale: string;
  status: SuggestionStatus;
  validationError?: string;
};

export type TavilySuggestion = {
  kind: 'tavily';
  config: TavilyConfig;
  rationale: string;
  status: SuggestionStatus;
  validationError?: string;
};

export type RssSuggestion = {
  kind: 'rss';
  config: RssConfig;
  rationale: string;
  status: SuggestionStatus;
  validationError?: string;
};

export type YouTubeChannelSuggestion = {
  kind: 'youtube-channel';
  config: YouTubeChannelConfig;
  rationale: string;
  status: SuggestionStatus;
  validationError?: string;
};

export type DiscoveryToolSuggestion =
  | TavilySuggestion
  | RssSuggestion
  | YouTubeChannelSuggestion;

export type SubjectSetupSuggestions = {
  seedSources: SeedSourceSuggestion[];
  discoveryTools: DiscoveryToolSuggestion[];
  model: string;
};

export type SuggestSubjectSetupInput = {
  /** The user's request — describes what kinds of seed sources and discovery
   *  tools they want the LLM to propose for THIS round of suggestions. This
   *  is the only content signal the LLM sees. The subject's name and
   *  description are intentionally NOT passed — they describe the dossier,
   *  not the immediate request. Users iterate the dossier by running multiple
   *  Suggest rounds with different queries (e.g. "RSS feeds for Spanish
   *  padel coverage", then "Tavily queries about Premier Padel transfers").
   *  Must be non-empty after trim. */
  query: string;
  language?: string;
  model?: string;
  /** Injectable LLM client for testing; defaults to selectLlmClient(process.env). */
  client?: LlmClient;
  /** Existing subject content to dedup suggestions against (omit = no dedup). */
  existing?: ExistingSubjectContent;
};

/** Identifiers of what a subject already has, so suggestions don't repeat them. */
export type ExistingSubjectContent = {
  /** Existing source URLs (and accepted seed URLs). Dedups seed + RSS suggestions. */
  sourceUrls?: string[];
  /** Existing RSS discovery-tool feed URLs. */
  rssFeedUrls?: string[];
  /** Existing youtube-channel discovery-tool channel IDs. */
  youtubeChannelIds?: string[];
  /** Existing tavily discovery-tool queries. */
  tavilyQueries?: string[];
};

export class EmptyQueryError extends Error {
  constructor() {
    super(
      'Suggestion request is empty. Enter a precise request (e.g. "RSS feeds for pro padel ' +
        'news in French" or "Tavily queries about Premier Padel transfers in 2025") so the ' +
        'AI knows what kind of sources / tools to propose.',
    );
    this.name = 'EmptyQueryError';
  }
}

// ---------- Prompt + schema ----------

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    seedSources: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING' },
          title: { type: 'STRING' },
          rationale: { type: 'STRING' },
        },
        required: ['url', 'rationale'],
        propertyOrdering: ['url', 'title', 'rationale'],
      },
    },
    rss: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          feedUrl: { type: 'STRING' },
          rationale: { type: 'STRING' },
        },
        required: ['feedUrl', 'rationale'],
        propertyOrdering: ['feedUrl', 'rationale'],
      },
    },
    youtubeChannels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          channelId: { type: 'STRING' },
          rationale: { type: 'STRING' },
        },
        required: ['channelId', 'rationale'],
        propertyOrdering: ['channelId', 'rationale'],
      },
    },
  },
  required: ['seedSources', 'rss', 'youtubeChannels'],
  propertyOrdering: ['seedSources', 'rss', 'youtubeChannels'],
} as const;

function buildPrompt(input: SuggestSubjectSetupInput): string {
  const language = input.language ?? 'en';
  return [
    'You are helping a researcher / journalist build a monitoring dossier.',
    'The user has written a precise request describing what they want suggested for THIS round.',
    "Treat the request as the authoritative signal — do not second-guess scope or substitute",
    'topics from elsewhere. The request may ask for a single category (e.g. "just RSS feeds")',
    'or a mix; honour what it asks for and skip the rest.',
    '',
    'USER REQUEST:',
    input.query.trim(),
    '',
    `Output language: ${language}`,
    '',
    '========================',
    'How the system works downstream — read carefully:',
    '========================',
    '',
    'A "seed source" is a SINGLE PAGE that is extracted ONCE and folded into the dossier as facts.',
    'Good fit: stable canonical pages — Wikipedia entries, foundational reports/papers, definitive',
    'explainers, or a specific landmark article. Each seed must yield substantive prose when passed',
    'through Readability (jsdom + @mozilla/readability). Homepages, listings, category/tag pages,',
    'social profiles and channel pages return navigation text and are rejected automatically.',
    '',
    'A "discovery tool" runs repeatedly and proposes new URLs for the user to triage. TWO shapes:',
    '  - RSS: an Atom/RSS feed URL from a site you want to track.',
    '  - YouTube channel: a canonical channel id (UC...) or handle (@name).',
    '  (Tavily web-search queries are planned by a separate step — do NOT propose them here.)',
    'Accepted proposals become sources and go through the same extraction pipeline.',
    '',
    '========================',
    'Examples of GOOD seed sources:',
    '  - https://en.wikipedia.org/wiki/Padel_(sport)            (canonical Wikipedia)',
    '  - https://www.itftennis.com/.../2024-rules-of-tennis.pdf (foundational report/paper)',
    '  - A landmark explainer article on a stable URL (datapath like /2023/06/long-title)',
    '',
    'Examples of BAD seed sources (rejected — do NOT suggest):',
    '  - https://padelmagazine.fr/                  (homepage → use as RSS)',
    '  - https://premierpadel.com/                   (homepage → use as RSS)',
    '  - https://www.reddit.com/r/padel/             (listing)',
    '  - https://twitter.com/PremierPadel            (social profile)',
    '  - https://www.youtube.com/@SomeChannel        (channel page → use youtubeChannels)',
    '  - https://example.com/news                    (section index → use as RSS)',
    '',
    '========================',
    'Rules of thumb:',
    '========================',
    '- Be SPECIFIC. Give exact URLs you believe exist. Do not invent paths to plausible-but-unverified articles.',
    "  When in doubt, OMIT a seed source rather than guess — better 1 verified Wikipedia entry than 4 hallucinated URLs.",
    '- Each suggestion includes a one-sentence rationale explaining its value.',
    '- Variety matters: do not stack 4 Wikipedia pages if a richer mix exists; do not over-list Tavily queries that paraphrase each other.',
    '- For RSS, prefer paths you have actually seen at that publication. Common patterns: /feed/, /rss, /atom.xml, /feeds/posts/default.',
    '- For YouTube channels, prefer canonical UC… ids when you know them; otherwise @handle.',
    '- Empty categories are OK. Do not pad to hit a quota.',
    "- If the user request asks specifically for one category, fill that category and leave the others empty.",
    '',
    'Suggested counts (treat as upper bounds, not quotas):',
    '- seedSources: 0-6',
    '- rss: 0-5',
    '- youtubeChannels: 0-4',
    '',
    'Return JSON only — no preamble, no markdown.',
  ].join('\n');
}

// ---------- Validation ----------

const VALIDATION_TIMEOUT_MS = 8_000;

async function timeoutFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Detect URLs that are clearly site indexes rather than extractable articles.
 *  Readability returns navigation/menu text for these, so they're useless as
 *  seed sources. The user should add them as RSS / Tavily tools instead. */
function isLikelyIndexPage(url: string): { hit: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { hit: false };
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/') {
    return { hit: true, reason: 'Looks like a homepage — extraction returns navigation/menu text. Add the site as an RSS or Tavily tool instead.' };
  }
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 1) {
    const seg = segments[0]!.toLowerCase();
    // Locale roots: /fr, /en, /pt-br, /en-us
    if (/^[a-z]{2,3}(-[a-z]{2,3})?$/i.test(seg)) {
      return { hit: true, reason: 'Looks like a locale-root homepage — add the site as an RSS or Tavily tool instead.' };
    }
    // Common listing/index keywords
    const indexWords = new Set([
      'home', 'index', 'news', 'blog', 'articles', 'article',
      'actualites', 'actualite', 'category', 'categories', 'tag', 'tags',
      'topics', 'topic', 'rubrique', 'rubriques', 'feed', 'feeds',
    ]);
    if (indexWords.has(seg)) {
      return { hit: true, reason: `Looks like a "${seg}" listing page — extraction returns links, not facts. Add the site as an RSS or Tavily tool instead.` };
    }
  }
  return { hit: false };
}

/** Lightweight reachability probe — used for URLs we can't run through Readability
 *  (YouTube watch pages, PDFs). HEAD first, GET-range fallback. */
async function probeReachable(url: string): Promise<{ status: SuggestionStatus; validationError?: string }> {
  try {
    const res = await timeoutFetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      const r2 = await timeoutFetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1024' },
        redirect: 'follow',
      });
      if (!r2.ok) return { status: 'broken', validationError: `HTTP ${r2.status}` };
    }
    return { status: 'verified' };
  } catch (err) {
    return {
      status: 'broken',
      validationError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Strict probe for web pages — actually fetches and runs Readability. A page
 *  that returns 200 but only yields a couple of nav links is not a valid seed
 *  source (extraction will produce nothing useful). */
async function probeArticle(url: string): Promise<{ status: SuggestionStatus; validationError?: string }> {
  let html: string;
  try {
    html = await fetchHtml(url, VALIDATION_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof WebFetchError) {
      return { status: 'broken', validationError: err.message };
    }
    return { status: 'broken', validationError: err instanceof Error ? err.message : String(err) };
  }
  try {
    const article = extractArticle(html, url);
    // Real articles produce many paragraph blocks. Listing/category pages
    // produce a handful at most (often zero after Readability filters nav).
    if (article.segments.length < 3) {
      return {
        status: 'broken',
        validationError: `Only ${article.segments.length} paragraph${article.segments.length === 1 ? '' : 's'} extracted — looks like a listing or section page, not an article. Add the site as an RSS or Tavily tool instead.`,
      };
    }
    const totalChars = article.segments.reduce((n, s) => n + s.text.length, 0);
    if (totalChars < 400) {
      return {
        status: 'broken',
        validationError: `Only ${totalChars} chars of extractable text — likely not a real article body.`,
      };
    }
    return { status: 'verified' };
  } catch (err) {
    if (err instanceof WebContentEmptyError) {
      return {
        status: 'broken',
        validationError: 'No readable article body — likely a homepage, listing, or login wall. Add the site as an RSS or Tavily tool instead.',
      };
    }
    return { status: 'broken', validationError: err instanceof Error ? err.message : String(err) };
  }
}

async function validateUrl(url: string): Promise<{ status: SuggestionStatus; validationError?: string }> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { status: 'broken', validationError: 'Non-http(s) URL' };
    }
  } catch {
    return { status: 'broken', validationError: 'Invalid URL' };
  }
  // Fast-fail for obvious index-shaped URLs — avoids the HTTP round trip.
  const indexCheck = isLikelyIndexPage(url);
  if (indexCheck.hit) {
    return { status: 'broken', validationError: indexCheck.reason ?? 'Looks like an index page' };
  }
  // YouTube watch pages and PDFs aren't articles — Readability can't probe
  // them. Use a plain reachability check instead.
  if (isYouTubeUrl(url) || isLikelyPdfUrl(url)) {
    return probeReachable(url);
  }
  // Everything else goes through the web adapter's extraction pipeline (the
  // same one that will run if the user accepts the suggestion).
  return probeArticle(url);
}

async function validateRss(feedUrl: string): Promise<{ status: SuggestionStatus; validationError?: string }> {
  try {
    const candidates = await discoverRss({ feedUrl, maxItems: 1 });
    if (candidates.length === 0) {
      return { status: 'broken', validationError: 'Feed parsed but contained no items' };
    }
    return { status: 'verified' };
  } catch (err) {
    return {
      status: 'broken',
      validationError: err instanceof Error ? err.message : String(err),
    };
  }
}

const UCID_RE = /^UC[A-Za-z0-9_-]{22}$/;

let _yt: Innertube | null = null;
async function ytClient(): Promise<Innertube> {
  if (!_yt) _yt = await Innertube.create({ retrieve_player: false });
  return _yt;
}

async function validateYouTubeChannel(channelId: string): Promise<{ status: SuggestionStatus; validationError?: string }> {
  const trimmed = channelId.trim();
  try {
    if (UCID_RE.test(trimmed)) return { status: 'verified' };
    const yt = await ytClient();
    const target = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : trimmed.startsWith('@')
        ? `https://www.youtube.com/${trimmed}`
        : `https://www.youtube.com/@${trimmed}`;
    const endpoint = await yt.resolveURL(target);
    const browseId = (endpoint as { payload?: { browseId?: string } })?.payload?.browseId;
    if (typeof browseId === 'string' && UCID_RE.test(browseId)) return { status: 'verified' };
    return { status: 'broken', validationError: 'Did not resolve to a channel' };
  } catch (err) {
    return {
      status: 'broken',
      validationError: err instanceof Error ? err.message : String(err),
    };
  }
}

const TAVILY_MIN_RESULTS = 3;

async function verifyTavilyQuery(
  config: TavilyConfig,
): Promise<{ status: SuggestionStatus; validationError?: string }> {
  if (!process.env['VEILLE_TAVILY_KEY']) {
    // No key — can't dry-run. Leave unchecked for the user to accept at their discretion.
    return { status: 'unchecked' };
  }
  try {
    const first = await discoverTavily(config);
    if (first.length >= TAVILY_MIN_RESULTS) return { status: 'verified' };
    // Relax once: drop recency + domain restrictions and retry.
    const relaxed: TavilyConfig = { query: config.query };
    if (config.topic) relaxed.topic = config.topic;
    if (config.maxResults) relaxed.maxResults = config.maxResults;
    const second = await discoverTavily(relaxed);
    if (second.length >= 1) return { status: 'verified' };
    return {
      status: 'broken',
      validationError: 'Query returned no results, even after relaxing recency/domain filters.',
    };
  } catch (err) {
    return { status: 'broken', validationError: err instanceof Error ? err.message : String(err) };
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return results;
}

// ---------- LLM response parsing ----------

type RawResponse = {
  seedSources?: Array<{ url?: string; title?: string; rationale?: string }>;
  rss?: Array<{ feedUrl?: string; rationale?: string }>;
  youtubeChannels?: Array<{ channelId?: string; rationale?: string }>;
};

function parseResponse(text: string): RawResponse {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as RawResponse;
  } catch {
    // Fallback: extract first {...} block from possibly-wrapped output.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawResponse;
      } catch {
        // fall through
      }
    }
    return {};
  }
}

function normUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    url.hash = '';
    let s = url.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function normQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------- Main entry point ----------

export async function suggestSubjectSetup(
  input: SuggestSubjectSetupInput,
): Promise<SubjectSetupSuggestions> {
  if (!input.query || input.query.trim().length === 0) {
    throw new EmptyQueryError();
  }
  const client = input.client ?? selectLlmClient(process.env);
  const prompt = buildPrompt(input);
  const opts: { jsonSchema: object; model?: string } = { jsonSchema: RESPONSE_SCHEMA };
  if (input.model !== undefined) opts.model = input.model;

  // Seeds / RSS / YouTube come from the main suggestion call; Tavily queries
  // come from the dedicated Query Planner (normalization, decomposition,
  // includeDomains). Run both in parallel. A planner failure degrades to
  // "no Tavily suggestions" rather than failing the whole request.
  const plannerInput: PlanQueriesInput = { intent: input.query, client };
  if (input.language !== undefined) plannerInput.language = input.language;
  if (input.model !== undefined) plannerInput.model = input.model;
  const [response, plannerResult] = await Promise.all([
    client.complete(prompt, opts),
    planTavilyQueries(plannerInput).catch((): PlanQueriesResult => ({ queries: [], model: '' })),
  ]);

  const parsed = parseResponse(response.text);

  // Dedup sets from what the subject already has (all empty when no `existing`,
  // so the default behaviour is unchanged).
  const ex = input.existing;
  const seedSet = new Set((ex?.sourceUrls ?? []).map(normUrl));
  const rssSet = new Set(
    [...(ex?.rssFeedUrls ?? []), ...(ex?.sourceUrls ?? [])].map(normUrl),
  );
  const ytSet = new Set((ex?.youtubeChannelIds ?? []).map((c) => c.trim()));
  const querySet = new Set((ex?.tavilyQueries ?? []).map(normQuery));

  // Normalize raw response into typed suggestions (without validation yet).
  const seedSources: SeedSourceSuggestion[] = (parsed.seedSources ?? [])
    .filter((s): s is { url: string; rationale: string; title?: string } =>
      typeof s.url === 'string' && typeof s.rationale === 'string',
    )
    .map((s) => {
      const out: SeedSourceSuggestion = {
        url: s.url,
        rationale: s.rationale,
        status: 'unchecked',
      };
      if (s.title) out.title = s.title;
      return out;
    })
    .filter((s) => !seedSet.has(normUrl(s.url)));

  const tavilySuggestions: TavilySuggestion[] = plannerResult.queries
    .map((q) => ({
      kind: 'tavily' as const,
      config: q.config,
      rationale: q.rationale,
      status: 'unchecked' as const,
    }))
    .filter((t) => !querySet.has(normQuery(t.config.query)));

  const rssSuggestions: RssSuggestion[] = (parsed.rss ?? [])
    .filter((s): s is { feedUrl: string; rationale: string } =>
      typeof s.feedUrl === 'string' && typeof s.rationale === 'string',
    )
    .map((s) => ({
      kind: 'rss' as const,
      config: { feedUrl: s.feedUrl },
      rationale: s.rationale,
      status: 'unchecked' as const,
    }))
    .filter((s) => !rssSet.has(normUrl(s.config.feedUrl)));

  const ytSuggestions: YouTubeChannelSuggestion[] = (parsed.youtubeChannels ?? [])
    .filter((s): s is { channelId: string; rationale: string } =>
      typeof s.channelId === 'string' && typeof s.rationale === 'string',
    )
    .map((s) => ({
      kind: 'youtube-channel' as const,
      config: { channelId: s.channelId },
      rationale: s.rationale,
      status: 'unchecked' as const,
    }))
    .filter((s) => !ytSet.has(s.config.channelId.trim()));

  // Validate everything in parallel with a small concurrency cap.
  await Promise.all([
    mapWithConcurrency(seedSources, 5, async (s) => {
      const result = await validateUrl(s.url);
      s.status = result.status;
      if (result.validationError) s.validationError = result.validationError;
    }),
    mapWithConcurrency(rssSuggestions, 4, async (s) => {
      const result = await validateRss(s.config.feedUrl);
      s.status = result.status;
      if (result.validationError) s.validationError = result.validationError;
    }),
    mapWithConcurrency(ytSuggestions, 3, async (s) => {
      const result = await validateYouTubeChannel(s.config.channelId);
      s.status = result.status;
      if (result.validationError) s.validationError = result.validationError;
    }),
    mapWithConcurrency(tavilySuggestions, 3, async (s) => {
      const result = await verifyTavilyQuery(s.config);
      s.status = result.status;
      if (result.validationError) s.validationError = result.validationError;
    }),
  ]);

  return {
    seedSources,
    discoveryTools: [...tavilySuggestions, ...rssSuggestions, ...ytSuggestions],
    model: response.model,
  };
}
