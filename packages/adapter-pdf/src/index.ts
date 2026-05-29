import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { Adapter, ExtractHints, ExtractInput, Fact } from '@veille/core';
import { loadPrompt, selectLlmClient, runFactExtraction } from '@veille/core';
import { isLikelyPdfUrl } from './url.js';
import { fetchPdfBytes, PdfFetchError } from './fetch.js';
import { extractPdfSegments, PdfEmptyError } from './extract-text.js';
import type { PdfProvenance } from './provenance.js';

export class PdfFileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfFileReadError';
  }
}

function isPdfFileInput(input: ExtractInput): input is { kind: 'file'; path: string; mimeType?: string } {
  if (input.kind !== 'file') return false;
  const ext = path.extname(input.path).toLowerCase();
  return ext === '.pdf' || input.mimeType === 'application/pdf';
}

async function readBytes(sourceRef: string, fetcher: () => Promise<Uint8Array>): Promise<Uint8Array> {
  try {
    return await fetcher();
  } catch (err) {
    if (err instanceof PdfFetchError) throw err;
    throw new PdfFileReadError(
      `Could not read PDF (${sourceRef}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function extractFromBytes(
  bytes: Uint8Array,
  sourceUrl: string,
  hints?: ExtractHints,
): Promise<Fact[]> {
  hints?.onProgress?.('extracting PDF text');
  const { segments, pageCount } = await extractPdfSegments(bytes);

  const targetLanguage = hints?.language ?? 'en';
  const prompt = await loadPrompt();
  const client = selectLlmClient(process.env);

  const sourceProvenance: Omit<PdfProvenance, 'pageStart' | 'pageEnd'> = {
    pageUrl: sourceUrl,
    fetchedAt: new Date().toISOString(),
    pageCount,
  };

  const result = await runFactExtraction({
    sourceUrl,
    language: targetLanguage,
    sourceProvenance,
    adapterName: 'pdf',
    segments,
    locator: {
      contentType: 'PDF',
      formatMarker: (p) => `[p.${p}]`,
      locatorUnit: 'page number',
      inclusiveEnd: true,
    },
    markerExample: '[p.1]',
    singleCall: true,
    buildFactProvenance: ({ locatorStart, locatorEnd }) => ({
      pageStart: locatorStart,
      pageEnd: locatorEnd,
    }),
    prompt,
    client,
    ...(hints !== undefined ? { hints } : {}),
  });

  result.facts.sort(
    (a, b) =>
      (a.provenance as PdfProvenance).pageStart - (b.provenance as PdfProvenance).pageStart,
  );

  return result.facts;
}

export async function extractFromPdfUrl(url: string, hints?: ExtractHints): Promise<Fact[]> {
  hints?.onProgress?.(`fetching PDF ${url}`);
  const bytes = await fetchPdfBytes(url);
  return extractFromBytes(bytes, url, hints);
}

export async function extractFromPdfFile(filePath: string, hints?: ExtractHints): Promise<Fact[]> {
  const abs = path.resolve(filePath);
  hints?.onProgress?.(`reading PDF ${abs}`);
  let bytes: Uint8Array;
  try {
    const buf = await fs.readFile(abs);
    bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PdfFileReadError(`PDF file not found: ${abs}`);
    }
    throw new PdfFileReadError(
      `Could not read PDF (${abs}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return extractFromBytes(bytes, pathToFileURL(abs).href, hints);
}

export const pdfAdapter: Adapter = {
  name: 'pdf',
  matches: (input: ExtractInput) => {
    if (input.kind === 'url') return isLikelyPdfUrl(input.url);
    if (input.kind === 'file') return isPdfFileInput(input);
    return false;
  },
  extract: async (input: ExtractInput, hints?: ExtractHints) => {
    if (input.kind === 'url') return extractFromPdfUrl(input.url, hints);
    if (input.kind === 'file') return extractFromPdfFile(input.path, hints);
    throw new Error('PDF adapter only accepts URL or file input');
  },
};

export { isLikelyPdfUrl } from './url.js';
export { PdfFetchError, fetchPdfBytes } from './fetch.js';
export { PdfEmptyError, extractPdfSegments } from './extract-text.js';
export type { ExtractedPdf } from './extract-text.js';
export type { PdfProvenance } from './provenance.js';
