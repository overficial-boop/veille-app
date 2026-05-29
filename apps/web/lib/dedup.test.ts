import { describe, it, expect } from 'vitest';
import { dedupKey, filterNewFacts } from './dedup';
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
