import { YoutubeTranscript } from 'youtube-transcript';
import { fetchTranscriptViaSupadata, supadataConfigured } from './supadata.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Segment } from '@veille/core';

export type { Segment } from '@veille/core';

export class TranscriptFetchError extends Error {
  constructor(public videoId: string, public languageCode: string, cause: unknown) {
    super(`Failed to fetch transcript for ${videoId} (${languageCode}): ${String(cause)}`);
    this.name = 'TranscriptFetchError';
  }
}

const CACHE_DIR = path.join(os.homedir(), '.veille', 'cache', 'transcripts');

export async function fetchTranscript(
  videoId: string,
  languageCode: string,
): Promise<Segment[]> {
  const cachePath = path.join(CACHE_DIR, `${videoId}-${languageCode}.json`);

  try {
    const cached = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(cached) as Segment[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  let segments: Segment[];
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: languageCode });
    segments = raw.map((s) => ({
      start: s.offset / 1000,
      end: (s.offset + s.duration) / 1000,
      text: s.text,
    }));
  } catch (err: unknown) {
    // The scraper fails from datacenter IPs (YouTube LOGIN_REQUIRED). Fall back
    // to Supadata when configured — the server-side (VPS) path.
    if (!supadataConfigured()) {
      throw new TranscriptFetchError(videoId, languageCode, err);
    }
    try {
      segments = await fetchTranscriptViaSupadata(videoId, languageCode);
    } catch (supaErr: unknown) {
      throw new TranscriptFetchError(videoId, languageCode, supaErr);
    }
  }

  // Best-effort cache write. A sandboxed service (read-only filesystem → EROFS)
  // must not break transcript fetching — caching is an optimization, not
  // required. Failure here previously surfaced as an opaque "unknown" error.
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(segments));
  } catch {
    // ignore — couldn't persist the cache; the transcript is still returned
  }

  return segments;
}
