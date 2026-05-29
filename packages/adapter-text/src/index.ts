import type { Adapter, ExtractHints, ExtractInput, Fact } from '@veille/core';
import { loadPrompt, selectLlmClient, runFactExtraction } from '@veille/core';
import { segmentByParagraph } from './segment.js';
import type { TextProvenance } from './provenance.js';

/** Synthetic source identifier for text-input Facts. Not a real URL. */
export function textSourceUrl(label: string): string {
  return `text:${label}`;
}

export async function extractFromText(
  content: string,
  label: string,
  hints?: ExtractHints,
): Promise<Fact[]> {
  hints?.onProgress?.(`segmenting ${content.length.toLocaleString()} chars`);
  const segments = segmentByParagraph(content);

  const targetLanguage = hints?.language ?? 'en';

  const prompt = await loadPrompt();
  const client = selectLlmClient(process.env);

  const sourceUrl = textSourceUrl(label);
  const sourceProvenance: Omit<TextProvenance, 'paragraphStart' | 'paragraphEnd'> = {
    label,
    length: content.length,
  };

  const result = await runFactExtraction({
    sourceUrl,
    language: targetLanguage,
    sourceProvenance,
    adapterName: 'text',
    segments,
    locator: {
      contentType: 'text',
      formatMarker: (i) => `[P${i}]`,
      locatorUnit: 'paragraph index',
      inclusiveEnd: true,
    },
    markerExample: '[P0]',
    singleCall: true,
    buildFactProvenance: ({ locatorStart, locatorEnd }) => ({
      paragraphStart: locatorStart,
      paragraphEnd: locatorEnd,
    }),
    prompt,
    client,
    ...(hints !== undefined ? { hints } : {}),
  });

  result.facts.sort(
    (a, b) =>
      (a.provenance as TextProvenance).paragraphStart -
      (b.provenance as TextProvenance).paragraphStart,
  );

  return result.facts;
}

export const textAdapter: Adapter = {
  name: 'text',
  matches: (input: ExtractInput) => input.kind === 'text',
  extract: async (input: ExtractInput, hints?: ExtractHints) => {
    if (input.kind !== 'text') throw new Error('Text adapter only accepts text input');
    const label = input.label ?? 'unnamed';
    return extractFromText(input.content, label, hints);
  },
};

export type { TextProvenance } from './provenance.js';
export { segmentByParagraph } from './segment.js';
export { LlmExtractionError } from '@veille/core';
