import type { ExtractInput } from './extract.js';

export type AdapterName = 'youtube' | 'web' | 'text' | 'pdf';

export type ProvenanceData = unknown;

export type ExtractedBy = {
  model: string;
  promptHash: string;
  adapter: string;
};

export type Fact = {
  id: string;
  text: string;
  sourceUrl: string;
  sourcePassage: string;
  language: string;
  extractedAt: string;
  provenance: ProvenanceData;
  extractedBy: ExtractedBy;
  confidence?: number;
};

export type SourceConfig = {
  id: string;
  adapter: AdapterName;
  input: ExtractInput;
  /** Set to the ISO timestamp once a refresh extracts from this source. Absent
   *  means "needs extraction". Cleared when the user wants a re-extract. */
  lastExtractedAt?: string;
  /** Reserved for cron-driven refresh; unused in Phase 1.5. */
  schedule?: string;
};

// ---------- Discovery: tools and proposals (Phase 3) ----------

export type DiscoveryToolKind = 'tavily' | 'rss' | 'youtube-channel';

export type TavilyConfig = {
  query: string;
  days?: number;
  topic?: 'general' | 'news' | 'finance';
  maxResults?: number;
  /** Restrict results to these domains (forwarded to Tavily `include_domains`). */
  includeDomains?: string[];
};

export type RssConfig = {
  feedUrl: string;
  maxItems?: number;
};

export type YouTubeChannelConfig = {
  channelId: string;
  maxVideos?: number;
};

export type DiscoveryTool =
  | { id: string; kind: 'tavily'; config: TavilyConfig; lastDiscoveredAt?: string; schedule?: string }
  | { id: string; kind: 'rss'; config: RssConfig; lastDiscoveredAt?: string; schedule?: string }
  | { id: string; kind: 'youtube-channel'; config: YouTubeChannelConfig; lastDiscoveredAt?: string; schedule?: string };

export type ProposalStatus = 'pending' | 'accepted' | 'hidden';

export type Proposal = {
  id: string;
  toolId: string;
  url: string;
  title?: string;
  /** ISO 8601 for RSS / Tavily; opaque human-readable string ("2 days ago")
   *  for YouTube where we don't fetch each video's full metadata. */
  publishedAt?: string;
  /** Byline — RSS item creator, YouTube channel name, web article author. */
  author?: string;
  /** Site / publication name — RSS feed title, URL hostname for Tavily. */
  siteName?: string;
  /** Short description / snippet preview. */
  excerpt?: string;
  discoveredAt: string;
  summary?: string;
  status: ProposalStatus;
  acceptedAt?: string;
  acceptedSourceId?: string;
  hiddenAt?: string;
};

export type Subject = {
  id: string;
  slug: string;
  name: string;
  description: string;
  language?: string;
  sources: SourceConfig[];
  facts: Fact[];
  /** Discovery tools attached to this subject. Default `[]`. */
  discoveryTools: DiscoveryTool[];
  /** Proposals surfaced by discovery tools, awaiting user triage. Default `[]`. */
  proposals: Proposal[];
  createdAt: string;
  refreshedAt: string;
};
