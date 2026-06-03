import { describe, it, expect } from 'vitest';
import { groundingChunksToUrls } from '../src/providers/grounded-search.js';

describe('groundingChunksToUrls', () => {
  it('extracts web uris + titles from grounding chunks', () => {
    const meta = { groundingChunks: [
      { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A1', title: 'atlantico.fr' } },
      { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A2', title: 'lemonde.fr' } },
      { other: {} },
    ] };
    expect(groundingChunksToUrls(meta)).toEqual([
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A1', title: 'atlantico.fr' },
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A2', title: 'lemonde.fr' },
    ]);
  });
  it('returns [] when metadata is missing', () => {
    expect(groundingChunksToUrls(undefined)).toEqual([]);
    expect(groundingChunksToUrls({})).toEqual([]);
  });
});
