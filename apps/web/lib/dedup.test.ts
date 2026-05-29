import { describe, it, expect } from 'vitest';
import { dedupKey, filterNewFacts, freshCandidates } from './dedup';
import type { Fact } from '@veille/core';

const f = (sourceUrl: string, text: string): Fact =>
  ({ id: 'x', text, sourceUrl, sourcePassage: '', language: 'fr', extractedAt: '', provenance: {}, extractedBy: { model: '', promptHash: '', adapter: '' } });

describe('dedup', () => {
  it('keeps only facts whose (sourceUrl,text) is not already seen', () => {
    const seen = new Set<string>([dedupKey(f('u1', 'a'))]);
    const incoming = [f('u1', 'a'), f('u1', 'b'), f('u2', 'a')];
    const fresh = filterNewFacts(incoming, seen);
    expect(fresh.map((x) => x.text)).toEqual(['b', 'a']);
    expect(seen.size).toBe(3); // seen is mutated with the kept ones
  });

  it('dedupes duplicates within the same batch', () => {
    const fresh = filterNewFacts([f('u', 'a'), f('u', 'a')], new Set());
    expect(fresh).toHaveLength(1);
  });
});

describe('freshCandidates', () => {
  const c = (url: string) => ({ url });

  it('drops items whose URL is already in seenUrls, and adds kept URLs to the set', () => {
    const seenUrls = new Set<string>(['https://a.com']);
    const fresh = freshCandidates([c('https://a.com'), c('https://b.com')], seenUrls);
    expect(fresh.map((x) => x.url)).toEqual(['https://b.com']);
    expect(seenUrls.has('https://b.com')).toBe(true); // mutated with the kept one
  });

  it('collapses duplicate URLs within the same batch', () => {
    const fresh = freshCandidates([c('https://a.com'), c('https://a.com')], new Set());
    expect(fresh).toHaveLength(1);
  });
});
