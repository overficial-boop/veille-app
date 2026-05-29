import type { Adapter, ExtractHints, ExtractInput, Fact } from '@veille/core';
import {
  loadPrompt,
  selectLlmClient,
  runFactExtraction,
} from '@veille/core';
import { isYouTubeUrl, extractVideoId } from './url.js';
import { fetchVideoInfo } from './metadata.js';
import { pickTrack } from './track-ranking.js';
import { fetchTranscript } from './transcript.js';
import type { YouTubeProvenance } from './provenance.js';

/** Videos at or below this duration are sent in one LLM call (no chunking). */
const SINGLE_CALL_DURATION_THRESHOLD_SECONDS = 90 * 60;

export async function extractFromUrl(url: string, hints?: ExtractHints): Promise<Fact[]> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract video ID from URL: ${url}`);
  }

  const info = await fetchVideoInfo(videoId);
  const targetLanguage = hints?.language ?? info.primaryLanguage;
  const chosenTrack = pickTrack(info.captionTracks, targetLanguage, info.primaryLanguage);
  const segments = await fetchTranscript(videoId, chosenTrack.languageCode);

  const duration = info.metadata.duration;
  const useSingleCall =
    duration > 0 && duration <= SINGLE_CALL_DURATION_THRESHOLD_SECONDS;

  const prompt = await loadPrompt();
  const client = selectLlmClient(process.env);

  const sourceProvenance: Omit<YouTubeProvenance, 'timestampStart' | 'timestampEnd'> = {
    videoId,
    channelId: info.metadata.channelId,
    channelName: info.metadata.channelName,
    publishedAt: info.metadata.publishedAt,
    captionTrack: {
      languageCode: chosenTrack.languageCode,
      kind: chosenTrack.kind,
    },
  };

  const result = await runFactExtraction({
    sourceUrl: url,
    language: targetLanguage,
    sourceProvenance,
    adapterName: 'youtube',
    segments,
    locator: {
      contentType: 'transcript',
      formatMarker: (s) => `[${s.toFixed(1)}s]`,
      locatorUnit: 'seconds within the video',
    },
    markerExample: '[Xs]',
    singleCall: useSingleCall,
    buildFactProvenance: ({ locatorStart, locatorEnd }) => ({
      timestampStart: locatorStart,
      timestampEnd: locatorEnd,
    }),
    prompt,
    client,
    ...(hints !== undefined ? { hints } : {}),
  });

  // YouTube-specific post-sort by timestamp (pipeline returns Facts in chunk order).
  result.facts.sort((a, b) =>
    (a.provenance as YouTubeProvenance).timestampStart -
    (b.provenance as YouTubeProvenance).timestampStart,
  );

  return result.facts;
}

export const youtubeAdapter: Adapter = {
  name: 'youtube',
  matches: (input: ExtractInput) => input.kind === 'url' && isYouTubeUrl(input.url),
  extract: async (input: ExtractInput, hints?: ExtractHints) => {
    if (input.kind !== 'url') throw new Error('YouTube adapter only accepts URL input');
    return extractFromUrl(input.url, hints);
  },
};

export type { YouTubeProvenance } from './provenance.js';
export { isYouTubeUrl, extractVideoId } from './url.js';
export {
  VideoUnavailableError,
  VideoStateNotSupportedError,
  NoCaptionsError,
  fetchVideoInfo,
} from './metadata.js';
export type { VideoInfo, CaptionTrack } from './metadata.js';
export { pickTrack } from './track-ranking.js';
export { TranscriptFetchError, fetchTranscript } from './transcript.js';
// Re-export LlmExtractionError from core for the CLI's catch-block backward compat
export { LlmExtractionError } from '@veille/core';
