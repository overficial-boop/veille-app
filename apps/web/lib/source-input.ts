// "Ajouter une source": interpret user input into a `sources` row.
// Server-only (uses fetch). A YouTube channel becomes an RSS feed — no youtubei.js,
// so it survives deployment to the VPS (datacenter IPs are blocked from InnerTube).

export type AddSourceType = 'web' | 'search' | 'rss' | 'youtube';

export type SourceInput = { url?: string; query?: string; feedUrl?: string; source?: string };

/** The editable "target" field for a connector: web→url, tavily→query, rss→feedUrl, else none. */
export function sourceTargetField(connector: string): 'url' | 'query' | 'feedUrl' | null {
  if (connector === 'web') return 'url';
  if (connector === 'tavily' || connector === 'google-news') return 'query';
  if (connector === 'rss') return 'feedUrl';
  return null;
}

/** The current target value of a source (its url/query/feed), or '' if none. */
export function sourceTarget(connector: string, input: SourceInput | null | undefined): string {
  const field = sourceTargetField(connector);
  if (!field || !input) return '';
  const v = input[field];
  return typeof v === 'string' ? v : '';
}

export type SourceRow = {
  connector: string;
  kind: 'item' | 'standing';
  purpose: 'state' | 'watch';
  input: Record<string, unknown>;
  label: string;
};

const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const UA = 'Mozilla/5.0 (compatible; VeilleBot/1.0; +https://veille.app)';

/** PURE. Map a known YouTube form (channel feed URL, bare UC id, or /channel/UC… URL) to its feed URL.
 *  Returns null when the input needs a network lookup (e.g. an @handle) or isn't a known YouTube form. */
export function youtubeFeedFromInput(input: string): string | null {
  const s = input.trim();
  const feed = s.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]+)/i);
  if (feed) return `${FEED_BASE}${feed[1]}`;
  if (/^UC[\w-]{20,}$/.test(s)) return `${FEED_BASE}${s}`;
  const chan = s.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (chan) return `${FEED_BASE}${chan[1]}`;
  return null;
}

/** PURE. Build the sources row for an add-source spec. For 'rss'/'youtube', pass the resolved
 *  { feedUrl, label } (from resolveYouTubeFeed / fetchFeedTitle); falls back to the raw value. */
export function sourceSpecToRow(
  type: AddSourceType,
  value: string,
  resolved?: { feedUrl: string; label?: string },
): SourceRow {
  const v = value.trim();
  switch (type) {
    case 'web':
      return { connector: 'web', kind: 'item', purpose: 'state', input: { url: v }, label: v };
    case 'search':
      return { connector: 'google-news', kind: 'standing', purpose: 'watch', input: { query: v }, label: v };
    case 'rss':
      return { connector: 'rss', kind: 'standing', purpose: 'watch', input: { feedUrl: resolved?.feedUrl ?? v }, label: resolved?.label?.trim() || v };
    case 'youtube':
      return { connector: 'rss', kind: 'standing', purpose: 'watch', input: { feedUrl: resolved?.feedUrl ?? v, source: 'youtube' }, label: resolved?.label?.trim() || v };
    default: {
      const _e: never = type;
      return _e;
    }
  }
}

/** PURE. The feed/channel title = the first <title> element (precedes item titles in RSS & Atom),
 *  with an optional CDATA wrapper stripped. Returns undefined if absent/empty. */
export function extractFeedTitle(xml: string): string | undefined {
  const m = xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const inner = m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
  const t = inner.trim();
  return t || undefined;
}

/** Fetch a feed URL, confirm it parses as a feed, and return its <title> for labelling. Server-safe. */
export async function fetchFeedTitle(feedUrl: string): Promise<{ ok: true; title?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(feedUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) return { ok: false, error: `Le flux a répondu ${res.status}.` };
    const xml = await res.text();
    if (!/<(rss|feed|channel)[\s>]/i.test(xml)) return { ok: false, error: 'Ce lien ne ressemble pas à un flux RSS/Atom.' };
    return { ok: true, title: extractFeedTitle(xml) };
  } catch {
    return { ok: false, error: 'Impossible de lire ce flux.' };
  }
}

/** Resolve a YouTube channel (UC id / channel URL / @handle / handle / video URL) to its RSS feed + name.
 *  Server-safe: known forms are pure; otherwise fetch the channel page HTML and read the channel_id. */
export async function resolveYouTubeFeed(input: string): Promise<{ feedUrl: string; title?: string } | { error: string }> {
  const known = youtubeFeedFromInput(input);
  if (known) {
    const meta = await fetchFeedTitle(known);
    // Known form: also confirm the feed is actually reachable before we store it.
    return meta.ok ? { feedUrl: known, title: meta.title } : { error: meta.error };
  }
  const pageUrl = toChannelUrl(input);
  if (!pageUrl) return { error: 'Chaîne YouTube introuvable.' };
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': UA, 'accept-language': 'en' },
    });
    if (!res.ok) return { error: `La page de la chaîne a répondu ${res.status}.` };
    const html = await res.text();
    const id = html.match(/"(?:channelId|externalId)":"(UC[\w-]+)"/)?.[1]
      ?? html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]+)/)?.[1];
    if (!id) return { error: 'Chaîne YouTube introuvable.' };
    const feedUrl = `${FEED_BASE}${id}`;
    const meta = await fetchFeedTitle(feedUrl);
    return { feedUrl, title: meta.ok ? meta.title : undefined };
  } catch {
    return { error: 'Impossible de résoudre la chaîne YouTube.' };
  }
}

/** Best-effort: a handle / channel URL / bare handle / video URL → a fetchable youtube.com URL. */
function toChannelUrl(input: string): string | null {
  const s = input.trim();
  if (/^https?:\/\/(?:www\.)?youtube\.com\//i.test(s)) return s;
  if (/^@[\w.-]+$/.test(s)) return `https://www.youtube.com/${s}`;
  if (/^[\w.-]+$/.test(s)) return `https://www.youtube.com/@${s}`;
  return null;
}
