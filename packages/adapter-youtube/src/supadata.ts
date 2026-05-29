import type { Segment } from '@veille/core';

const BASE = 'https://api.supadata.ai/v1';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

export class SupadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupadataError';
  }
}

/** True when SUPADATA_API_KEY is set (server-side transcript fallback path). */
export function supadataConfigured(): boolean {
  return !!process.env['SUPADATA_API_KEY'];
}

type RawSegment = { text?: unknown; offset?: unknown; duration?: unknown };
type TranscriptResponse = {
  status?: string;
  jobId?: string;
  content?: unknown;
  error?: string;
};

function mapSegments(content: RawSegment[]): Segment[] {
  return content
    .filter(
      (s): s is { text: string; offset: number; duration: number } =>
        typeof s.text === 'string' &&
        typeof s.offset === 'number' &&
        typeof s.duration === 'number',
    )
    .map((s) => ({
      start: s.offset / 1000,
      end: (s.offset + s.duration) / 1000,
      text: s.text,
    }));
}

export type SupadataDeps = {
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
};

/** Fetch a YouTube transcript via Supadata. Handles the synchronous 200 path
 *  and the async 202 + jobId polling path (videos > ~20 min). Returns segments
 *  in the same `{ start, end, text }` shape (seconds) as the scraper path. */
export async function fetchTranscriptViaSupadata(
  videoId: string,
  lang: string,
  deps: SupadataDeps = {},
): Promise<Segment[]> {
  const key = process.env['SUPADATA_API_KEY'];
  if (!key) throw new SupadataError('SUPADATA_API_KEY not set');
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  // Supadata's `url` param rejects a bare ID ("Invalid url"); `videoId` accepts it.
  const url = `${BASE}/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}`;
  const res = await doFetch(url, { headers: { 'x-api-key': key } });

  if (res.status === 202) {
    const body = (await res.json()) as TranscriptResponse;
    if (!body.jobId) throw new SupadataError('async response missing jobId');
    return pollJob(body.jobId, key, doFetch, sleep, now);
  }
  if (!res.ok) throw new SupadataError(await errText(res));

  const data = (await res.json()) as TranscriptResponse;
  if (!Array.isArray(data.content)) {
    throw new SupadataError('response missing transcript content');
  }
  return mapSegments(data.content as RawSegment[]);
}

async function pollJob(
  jobId: string,
  key: string,
  doFetch: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): Promise<Segment[]> {
  const url = `${BASE}/youtube/transcript/${encodeURIComponent(jobId)}`;
  const deadline = now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await doFetch(url, { headers: { 'x-api-key': key } });
    if (res.ok) {
      const data = (await res.json()) as TranscriptResponse;
      if (data.status === 'completed' && Array.isArray(data.content)) {
        return mapSegments(data.content as RawSegment[]);
      }
      if (data.status === 'failed') {
        throw new SupadataError(`transcript job failed: ${data.error ?? 'unknown'}`);
      }
      // queued / active → keep polling
    }
    if (now() >= deadline) {
      throw new SupadataError(`transcript job timed out after ${POLL_TIMEOUT_MS}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function errText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return `Supadata HTTP ${res.status}: ${t.slice(0, 200)}`;
  } catch {
    return `Supadata HTTP ${res.status}`;
  }
}
