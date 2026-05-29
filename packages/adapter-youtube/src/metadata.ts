import { Innertube } from 'youtubei.js';

export class VideoUnavailableError extends Error {
  constructor(public videoId: string) {
    super(`Video ${videoId} is not accessible (private, deleted, or region-blocked)`);
    this.name = 'VideoUnavailableError';
  }
}

export class VideoStateNotSupportedError extends Error {
  constructor(public videoId: string, public state: 'live' | 'upcoming') {
    super(`Video ${videoId} is ${state}; v0 does not support extracting from ${state} videos`);
    this.name = 'VideoStateNotSupportedError';
  }
}

export class NoCaptionsError extends Error {
  constructor(public videoId: string) {
    super(`Video ${videoId} has no captions`);
    this.name = 'NoCaptionsError';
  }
}

export type VideoMetadata = {
  title: string;
  channelId: string;
  channelName: string;
  duration: number;
  publishedAt: string;
};

export type CaptionTrack = {
  languageCode: string;
  kind: 'manual' | 'asr';
  name: string;
};

export type VideoInfo = {
  metadata: VideoMetadata;
  captionTracks: CaptionTrack[];
  primaryLanguage: string;
};

let _innertube: Innertube | null = null;
async function getInnertube(): Promise<Innertube> {
  if (!_innertube) _innertube = await Innertube.create();
  return _innertube;
}

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo> {
  const yt = await getInnertube();

  let info;
  try {
    info = await yt.getInfo(videoId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unavailable|not available|does not exist/i.test(msg)) {
      throw new VideoUnavailableError(videoId);
    }
    throw err;
  }

  const b = info.basic_info;
  if (b.is_live) throw new VideoStateNotSupportedError(videoId, 'live');
  if (b.is_upcoming) throw new VideoStateNotSupportedError(videoId, 'upcoming');
  if (info.captions == null) throw new NoCaptionsError(videoId);

  const microformat = (info as unknown as { page?: Array<{ microformat?: { publish_date?: string } }> })
    .page?.[0]?.microformat;
  const publishedAt = microformat?.publish_date ?? new Date().toISOString();

  const rawTracks = info.captions.caption_tracks ?? [];
  const captionTracks: CaptionTrack[] = rawTracks.map((t) => ({
    languageCode: t.language_code,
    kind: t.kind === 'asr' ? 'asr' : 'manual',
    name: typeof t.name === 'string' ? t.name : (t.name?.text ?? ''),
  }));

  if (captionTracks.length === 0) throw new NoCaptionsError(videoId);

  return {
    metadata: {
      title: b.title ?? '',
      channelId: b.channel_id ?? '',
      channelName: b.author ?? '',
      duration: b.duration ?? 0,
      publishedAt,
    },
    captionTracks,
    primaryLanguage: captionTracks[0]!.languageCode,
  };
}
