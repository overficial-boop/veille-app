import type { Adapter, ExtractHints, ExtractInput, Fact } from '@veille/core';
import { loadPrompt, selectLlmClient, runFactExtraction } from '@veille/core';
import { isWebUrl } from './url.js';
import { fetchHtml, WebFetchError } from './fetch.js';
import { extractArticle, WebContentEmptyError } from './segment.js';
import type { WebProvenance } from './provenance.js';

export async function extractFromUrl(url: string, hints?: ExtractHints): Promise<Fact[]> {
  hints?.onProgress?.(`fetching ${url}`);
  const html = await fetchHtml(url);

  hints?.onProgress?.('extracting article content');
  const article = extractArticle(html, url);

  const targetLanguage = hints?.language ?? article.lang ?? 'en';

  const prompt = await loadPrompt();
  const client = selectLlmClient(process.env);

  const sourceProvenance: Omit<WebProvenance, 'paragraphStart' | 'paragraphEnd'> = {
    pageUrl: url,
    fetchedAt: new Date().toISOString(),
    title: article.title,
    ...(article.byline !== null ? { author: article.byline } : {}),
    ...(article.publishedTime !== null ? { publishedAt: article.publishedTime } : {}),
  };

  const result = await runFactExtraction({
    sourceUrl: url,
    language: targetLanguage,
    sourceProvenance,
    adapterName: 'web',
    segments: article.segments,
    locator: {
      contentType: 'article',
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
      (a.provenance as WebProvenance).paragraphStart -
      (b.provenance as WebProvenance).paragraphStart,
  );

  return result.facts;
}

export const webAdapter: Adapter = {
  name: 'web',
  matches: (input: ExtractInput) => input.kind === 'url' && isWebUrl(input.url),
  extract: async (input: ExtractInput, hints?: ExtractHints) => {
    if (input.kind !== 'url') throw new Error('Web adapter only accepts URL input');
    return extractFromUrl(input.url, hints);
  },
};

export type { WebProvenance } from './provenance.js';
export { WebFetchError, fetchHtml } from './fetch.js';
export { WebContentEmptyError, extractArticle } from './segment.js';
export type { ExtractedArticle } from './segment.js';
export { isWebUrl } from './url.js';
// Re-export LlmExtractionError from core for the CLI's catch-block backward compat
export { LlmExtractionError } from '@veille/core';
