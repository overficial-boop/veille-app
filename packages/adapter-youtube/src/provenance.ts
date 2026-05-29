export type YouTubeProvenance = {
  videoId: string;
  channelId: string;
  channelName: string;
  publishedAt: string;
  timestampStart: number;
  timestampEnd: number;
  captionTrack: {
    languageCode: string;
    kind: 'manual' | 'asr';
  };
};
