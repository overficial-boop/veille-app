/** A candidate URL surfaced by a discovery provider. The orchestration layer
 *  converts these into Proposals, deduping by URL against the Subject's
 *  existing proposals and sources. */
export type Candidate = {
  url: string;
  title?: string;
  publishedAt?: string;
  /** Byline — RSS creator, YouTube channel name, web article author. */
  author?: string;
  /** Site / publication name — RSS feed title, URL hostname for Tavily. */
  siteName?: string;
  /** Short description / snippet preview. */
  excerpt?: string;
  /** Raw provider payload for debugging / future use. */
  raw?: Record<string, unknown>;
};

export class DiscoveryProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DiscoveryProviderError';
  }
}

export class TavilyKeyMissingError extends Error {
  constructor() {
    super('VEILLE_TAVILY_KEY is not set');
    this.name = 'TavilyKeyMissingError';
  }
}
