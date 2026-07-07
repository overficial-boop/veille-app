export type BlockScope = 'page' | 'item';

/** A prerequisite a block declares. Uniform: primitives, another block's output, or cross-scope aggregation. */
export type BlockInput =
  | { kind: 'fact-pool' }
  | { kind: 'raw-content' }                 // item scope only — documents.content
  | { kind: 'item-metadata' }               // item scope only — title/url/siteName/publishedAt
  | { kind: 'block'; blockId: string }      // same-scope cached output of another block
  | { kind: 'all-items'; blockId: string }; // page scope only — every item's cached output of blockId

export type BlockCitation = { factId?: string; url: string };

/** What the resolver hands a generator. Only the declared inputs are populated. */
export type ResolvedInputs = {
  factPool?: { facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[]; version: string };
  rawContent?: { text: string; title: string; url: string };
  itemMetadata?: { title: string; url: string; siteName?: string; publishedAt?: string };
  blocks?: Record<string, string>;                                  // blockId → cached content
  allItems?: Record<string, { targetKey: string; content: string }[]>; // blockId → outputs across items
};

export type BlockDef = {
  id: string;
  name: string; // user-facing, French
  scope: BlockScope | 'both';
  prerequisites: BlockInput[];
  staleness: 'auto-on-refresh' | 'on-demand';
  generate: (inputs: ResolvedInputs, ctx: { language: string }) => Promise<{ content: string; citations: BlockCitation[] }>;
};
