import { Innertube } from 'youtubei.js';
import type { YouTubeChannelConfig } from '@veille/core';
import { fetchVideoInfo } from '@veille/adapter-youtube';
import type { Candidate } from '../types.js';
import { DiscoveryProviderError } from '../types.js';

const DEFAULT_MAX_VIDEOS = 10;
/** Limit on parallel getInfo() calls per discovery run. */
const METADATA_CONCURRENCY = 5;

let _yt: Innertube | null = null;
async function client(): Promise<Innertube> {
  if (!_yt) _yt = await Innertube.create({ retrieve_player: false });
  return _yt;
}

function videoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

const UCID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** Accept any of the common channel identifier forms the user might paste and
 *  return a canonical UCID (UC...). The bare getChannel() call only works on
 *  UCIDs, so handles and URLs have to go through resolveURL first. */
async function resolveChannelId(yt: Innertube, input: string): Promise<string> {
  const trimmed = input.trim();
  if (UCID_RE.test(trimmed)) return trimmed;
  let resolveTarget: string;
  if (/^https?:\/\//i.test(trimmed)) {
    resolveTarget = trimmed;
  } else if (trimmed.startsWith('@')) {
    resolveTarget = `https://www.youtube.com/${trimmed}`;
  } else {
    // Bare handle without @ — assume it's a handle.
    resolveTarget = `https://www.youtube.com/@${trimmed}`;
  }
  let endpoint;
  try {
    endpoint = await yt.resolveURL(resolveTarget);
  } catch (err) {
    throw new DiscoveryProviderError(
      `Could not resolve YouTube channel "${input}" via ${resolveTarget}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  const browseId = (endpoint as { payload?: { browseId?: string } })?.payload?.browseId;
  if (typeof browseId === 'string' && UCID_RE.test(browseId)) return browseId;
  throw new DiscoveryProviderError(
    `Resolved "${input}" to a non-channel endpoint (no UC… id found). ` +
      `Try the canonical channel id (starts with UC) or a /channel/UC… URL.`,
  );
}

// Two shapes seen from youtubei.js v17.x channel.getVideos():
//   - Older: tab.videos[] with { id|video_id, title, published }
//   - Newer: tab.current_tab.content.contents[] of RichItem wrapping
//     LockupView with { content_id, content_type: 'VIDEO',
//     metadata: { title: { text } } }
// We try both and pick whichever produces video IDs.

type LegacyVideoItem = {
  id?: string;
  video_id?: string;
  title?: { text?: string } | string;
  published?: { text?: string };
};

type RichItemContent = {
  type?: string;
  content_id?: string;
  content_type?: string;
  metadata?: {
    title?: { text?: string };
  };
};

type RichItem = {
  type?: string;
  content?: RichItemContent;
};

type TabShape = {
  videos?: LegacyVideoItem[];
  current_tab?: {
    content?: {
      contents?: RichItem[];
    };
  };
};

type Extracted = { videoId: string; title?: string; relativeDate?: string };

function extractFromTab(tab: TabShape): Extracted[] {
  const legacy = tab.videos;
  if (Array.isArray(legacy) && legacy.length > 0) {
    const out: Extracted[] = [];
    for (const v of legacy) {
      const id = v.video_id ?? v.id;
      if (!id) continue;
      const title = typeof v.title === 'string' ? v.title : v.title?.text;
      const ex: Extracted = { videoId: id };
      if (title) ex.title = title;
      if (v.published?.text) ex.relativeDate = v.published.text;
      out.push(ex);
    }
    if (out.length > 0) return out;
  }
  const items = tab.current_tab?.content?.contents;
  if (Array.isArray(items)) {
    const out: Extracted[] = [];
    for (const item of items) {
      const c = item.content;
      if (!c) continue;
      // content_type === 'VIDEO' filters out Shorts / playlists / channel headers
      if (c.content_type && c.content_type !== 'VIDEO') continue;
      if (!c.content_id) continue;
      const title = c.metadata?.title?.text;
      const ex: Extracted = { videoId: c.content_id };
      if (title) ex.title = title;
      out.push(ex);
    }
    return out;
  }
  return [];
}

function readChannelName(channel: unknown): string | undefined {
  const obj = channel as {
    metadata?: { title?: string };
    header?: { author?: { name?: string }; title?: { text?: string } };
  };
  return obj.metadata?.title ?? obj.header?.author?.name ?? obj.header?.title?.text;
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

export async function discoverYouTubeChannel(
  config: YouTubeChannelConfig,
): Promise<Candidate[]> {
  let yt: Innertube;
  try {
    yt = await client();
  } catch (err) {
    throw new DiscoveryProviderError(
      `Failed to start YouTube client: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const channelId = await resolveChannelId(yt, config.channelId);

  let channel;
  try {
    channel = await yt.getChannel(channelId);
  } catch (err) {
    throw new DiscoveryProviderError(
      `Channel fetch failed for ${config.channelId} (resolved to ${channelId}): ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const channelName = readChannelName(channel);

  let videosTab;
  try {
    videosTab = await channel.getVideos();
  } catch (err) {
    throw new DiscoveryProviderError(
      `Could not list videos for ${config.channelId}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const max = config.maxVideos ?? DEFAULT_MAX_VIDEOS;
  const extracted = extractFromTab(videosTab as TabShape).slice(0, max);

  type Working = { videoId: string; candidate: Candidate };
  const working: Working[] = extracted.map((ex) => {
    const candidate: Candidate = { url: videoUrl(ex.videoId) };
    if (ex.title) candidate.title = ex.title;
    if (ex.relativeDate) candidate.publishedAt = ex.relativeDate;
    if (channelName) {
      candidate.author = channelName;
      candidate.siteName = channelName;
    }
    return { videoId: ex.videoId, candidate };
  });

  // Enrich each candidate with the canonical ISO publishedAt from getInfo's
  // microformat.publish_date. Parallel with a small concurrency cap so we
  // don't hammer YouTube on large maxVideos values. Failures fall back to
  // whatever the channel-list page provided.
  await mapWithConcurrency(working, METADATA_CONCURRENCY, async ({ videoId, candidate }) => {
    try {
      const info = await fetchVideoInfo(videoId);
      candidate.publishedAt = info.metadata.publishedAt;
      if (info.metadata.channelName) {
        candidate.author = info.metadata.channelName;
        candidate.siteName = info.metadata.channelName;
      }
    } catch {
      // Keep whatever channel-page data we already attached; private/deleted
      // videos slip through without blocking the discovery run.
    }
  });

  return working.map((w) => w.candidate);
}
