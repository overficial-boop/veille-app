import { v7 as uuidv7 } from 'uuid';
import type { Fact } from './types.js';
import type { ExtractHints } from './extract.js';
import type { Segment, Chunk } from './chunk.js';
import { chunkSegments, CHUNK_DURATION_SECONDS } from './chunk.js';
import type { LocatorConfig } from './prompt.js';
import { renderPrompt } from './prompt.js';
import type { LlmClient, ExtractionResult, RawFact } from './llm.js';
import { extractFromChunk } from './llm.js';
import { reconstructPassage } from './passage.js';
import { createSummaryStreamParser } from './summary-stream-parser.js';

export type RunFactExtractionInput = {
  /** Identifier for this extraction (URL or label) — populates Fact.sourceUrl. */
  sourceUrl: string;
  /** Output language for fact text and summary. */
  language: string;
  /** Source-level provenance fields, copied unchanged onto every Fact's provenance. */
  sourceProvenance: Record<string, unknown>;
  /** Adapter name → Fact.extractedBy.adapter. */
  adapterName: string;
  /** Segments to extract from. */
  segments: Segment[];
  /** Locator config (contentType, formatMarker, locatorUnit). */
  locator: LocatorConfig;
  /** Marker example to show the LLM (e.g. "[Xs]" or "[P0]"). */
  markerExample: string;
  /** If true, send all segments in one LLM call (no chunking). */
  singleCall: boolean;
  /** Chunk window size in locator units (only used when !singleCall). Defaults to CHUNK_DURATION_SECONDS. */
  chunkSize?: number;
  /** Build per-fact provenance fields from the LLM-emitted locator range. Merged with sourceProvenance. */
  buildFactProvenance: (raw: { locatorStart: number; locatorEnd: number }) => Record<string, unknown>;
  /** Already-loaded prompt template + hash (caller controls which prompt file to load). */
  prompt: { template: string; hash: string };
  /** LLM client (caller controls which provider). */
  client: LlmClient;
  /** Hints from the user. */
  hints?: ExtractHints;
};

export type RunFactExtractionResult = {
  facts: Fact[];
  summary: string;
  cost: { model: string; inputTokens: number; outputTokens: number };
};

export async function mapWithConcurrency<T, R>(
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
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function buildChunks(segments: Segment[], singleCall: boolean, chunkSize?: number): Chunk[] {
  if (singleCall) {
    // Single call: all segments in one "chunk" spanning 0 to last segment's end.
    const lastEnd = segments.length > 0 ? (segments[segments.length - 1]?.end ?? 0) : 0;
    return [{ startSeconds: 0, endSeconds: lastEnd, segments }];
  }
  return chunkSegments(segments, chunkSize ?? CHUNK_DURATION_SECONDS);
}

export async function runFactExtraction(
  input: RunFactExtractionInput,
): Promise<RunFactExtractionResult> {
  const {
    sourceUrl,
    language,
    sourceProvenance,
    adapterName,
    segments,
    locator,
    markerExample,
    singleCall,
    chunkSize,
    buildFactProvenance,
    prompt,
    client,
    hints,
  } = input;

  const chunks = buildChunks(segments, singleCall, chunkSize);

  // Surface the cleaned source text once, for downstream analysis (additive, opt-in).
  hints?.onContent?.(segments.map((s) => s.text).join('\n'));

  const extractedAt = new Date().toISOString();

  const perChunk = async (
    chunk: Chunk,
    idx: number,
  ): Promise<{ chunk: Chunk; result: ExtractionResult }> => {
    const startS = Math.round(chunk.startSeconds);
    const endS = Math.round(chunk.endSeconds);
    hints?.onProgress?.(
      `processing chunk ${idx + 1}/${chunks.length} (${startS}–${endS}s)…`,
    );

    const serializedChunk = chunk.segments
      .map((s) => `${locator.formatMarker(s.start)} ${s.text}`)
      .join('\n');

    const renderedPrompt = renderPrompt(prompt.template, {
      language,
      subjectHint: hints?.subjectHint ?? '',
      chunk: serializedChunk,
      contentType: locator.contentType,
      locatorUnit: locator.locatorUnit,
      markerExample,
    });

    const callOpts: { onTextChunk?: (text: string) => void; model?: string } = {};

    // Only stream summary in single-call mode.
    if (singleCall && hints?.onSummaryChunk) {
      const parser = createSummaryStreamParser(hints.onSummaryChunk);
      callOpts.onTextChunk = (text) => parser.feed(text);
    }
    if (hints?.model !== undefined) callOpts.model = hints.model;

    const result = await extractFromChunk(client, renderedPrompt, callOpts);
    return { chunk, result };
  };

  const chunkResults = await mapWithConcurrency(
    chunks,
    hints?.concurrency ?? 4,
    perChunk,
  );

  let totalInput = 0;
  let totalOutput = 0;
  let modelUsed = '';
  const allFacts: Fact[] = [];
  // Dedup only runs when chunking produced multiple windows. Boundary-overlap
  // means the same fact can be extracted twice; we drop later duplicates of
  // identical (range, text) triples — same range alone might be two distinct
  // facts in the same passage, so we keep both unless the text matches too.
  const willDedup = chunkResults.length > 1;
  const seenFactKeys = new Set<string>();

  for (const { chunk, result } of chunkResults) {
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    modelUsed = result.model;

    for (const raw of result.facts) {
      if (willDedup) {
        const key = `${raw.timestampStart}|${raw.timestampEnd}|${raw.text}`;
        if (seenFactKeys.has(key)) continue;
        seenFactKeys.add(key);
      }
      const factProvenance = {
        ...sourceProvenance,
        ...buildFactProvenance({ locatorStart: raw.timestampStart, locatorEnd: raw.timestampEnd }),
        ...(raw.relevance !== undefined ? { relevance: raw.relevance } : {}),
      };
      allFacts.push({
        id: uuidv7(),
        text: raw.text,
        sourceUrl,
        sourcePassage: reconstructPassage(
          chunk.segments,
          raw.timestampStart,
          raw.timestampEnd,
          locator.inclusiveEnd ? { inclusive: true } : undefined,
        ),
        language,
        extractedAt,
        provenance: factProvenance,
        extractedBy: {
          model: result.model,
          promptHash: prompt.hash,
          adapter: adapterName,
        },
        confidence: raw.confidence,
      });
    }
  }

  // Summary: only meaningful in single-call mode (first and only chunk).
  const summary = singleCall ? (chunkResults[0]?.result.summary ?? '') : '';
  const cost = { model: modelUsed, inputTokens: totalInput, outputTokens: totalOutput };

  hints?.onSummary?.(summary);
  hints?.onCost?.(cost);

  return { facts: allFacts, summary, cost };
}
