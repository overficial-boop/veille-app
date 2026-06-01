import type { AdapterName, Fact } from './types.js';
import type { CostInfo } from './pricing.js';

export type ExtractHints = {
  language?: string;
  subjectHint?: string;
  onProgress?: (message: string) => void;
  /** Per-chunk text stream from the model (live, for stderr streaming). */
  onSummaryChunk?: (chunk: string) => void;
  /** Final assembled summary, fired once after extraction completes. */
  onSummary?: (summary: string) => void;
  /** Final cost (tokens + model), fired once after extraction completes. */
  onCost?: (cost: CostInfo) => void;
  /** Fired once with the joined cleaned source text (for downstream per-document analysis). */
  onContent?: (content: string) => void;
  concurrency?: number;
  model?: string;
  withSummary?: boolean;
};

export type ExtractInput =
  | { kind: 'url'; url: string }
  | { kind: 'text'; content: string; label?: string }
  | { kind: 'file'; path: string; mimeType?: string };

export type Adapter = {
  name: AdapterName;
  matches: (input: ExtractInput) => boolean;
  extract: (input: ExtractInput, hints?: ExtractHints) => Promise<Fact[]>;
};

export class UnsupportedInputError extends Error {
  constructor(input: ExtractInput) {
    super(`No adapter registered for input: ${JSON.stringify(input)}`);
    this.name = 'UnsupportedInputError';
  }
}

/** Backward-compat alias — callers that catch UnsupportedUrlError keep working. */
export const UnsupportedUrlError = UnsupportedInputError;

const adapters: Adapter[] = [];

export function registerAdapter(adapter: Adapter): void {
  adapters.push(adapter);
}

export function resetAdapters(): void {
  adapters.length = 0;
}

/** Look up which registered adapter would handle a given input, without extracting. */
export function findAdapter(input: ExtractInput): Adapter | undefined {
  return adapters.find((a) => a.matches(input));
}

/** Canonical entry point — accepts the full ExtractInput discriminated union. */
export async function extractInput(input: ExtractInput, hints?: ExtractHints): Promise<Fact[]> {
  const adapter = adapters.find((a) => a.matches(input));
  if (!adapter) throw new UnsupportedInputError(input);
  return adapter.extract(input, hints);
}

/** Backward-compat wrapper — url string → { kind: 'url', url } dispatch. */
export async function extract(url: string, hints?: ExtractHints): Promise<Fact[]> {
  return extractInput({ kind: 'url', url }, hints);
}
