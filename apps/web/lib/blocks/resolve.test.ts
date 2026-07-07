import { describe, it, expect } from 'vitest';
import { topoOrder, resolveInputs, type BlockLoaders } from './resolve';
import type { BlockDef } from './types';

const gen: BlockDef['generate'] = async () => ({ content: 'x', citations: [] });
const def = (over: Partial<BlockDef>): BlockDef => ({
  id: 'a', name: 'A', scope: 'item', prerequisites: [], staleness: 'on-demand', generate: gen, ...over,
});

const loaders = (over: Partial<BlockLoaders> = {}): BlockLoaders => ({
  factPool: async () => ({ facts: [{ id: 'f1', text: 't', sourceUrl: 'u', sourcePassage: 'p' }], version: 'fp:now:1' }),
  document: async () => ({ content: 'transcript text', title: 'T', url: 'https://x', siteName: 'X', publishedAt: null }),
  cachedOutput: async () => ({ content: 'cached summary', fingerprint: 'abc' }),
  allOutputs: async () => [{ targetKey: 'doc1', content: 'sum1' }],
  ...over,
});

describe('topoOrder', () => {
  it('orders prerequisites before dependents', () => {
    const a = def({ id: 'a' });
    const b = def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] });
    const c = def({ id: 'c', prerequisites: [{ kind: 'block', blockId: 'b' }] });
    expect(topoOrder([c, a, b]).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores edges to blocks outside the set', () => {
    const b = def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'not-here' }] });
    expect(topoOrder([b]).map((d) => d.id)).toEqual(['b']);
  });
});

describe('resolveInputs', () => {
  it('resolves raw-content + item-metadata for an item target', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.rawContent?.text).toBe('transcript text');
    expect(r.inputs.itemMetadata?.title).toBe('T');
    expect(r.fingerprint).toHaveLength(16);
  });

  it('reports missing when the document has no content', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' },
      loaders({ document: async () => ({ content: null, title: 'T', url: 'u', siteName: undefined, publishedAt: null }) }));
    expect(r).toEqual({ missing: expect.stringContaining('raw-content') });
  });

  it('resolves a block prerequisite from cache and folds its fingerprint', async () => {
    const d = def({ id: 'tldr', prerequisites: [{ kind: 'block', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.blocks?.['exec-summary']).toBe('cached summary');
  });

  it('reports missing when a block prerequisite has no cached output', async () => {
    const d = def({ id: 'tldr', prerequisites: [{ kind: 'block', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders({ cachedOutput: async () => null }));
    expect(r).toEqual({ missing: expect.stringContaining('exec-summary') });
  });

  it('resolves fact-pool and all-items for a page target', async () => {
    const d = def({ id: 'themes', scope: 'page',
      prerequisites: [{ kind: 'fact-pool' }, { kind: 'all-items', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.factPool?.facts).toHaveLength(1);
    expect(r.inputs.allItems?.['exec-summary']).toEqual([{ targetKey: 'doc1', content: 'sum1' }]);
  });

  it('reports missing for item primitives on a page target', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }] });
    const r = await resolveInputs(d, { dossierId: 'D' }, loaders());
    expect(r).toEqual({ missing: expect.stringContaining('raw-content') });
  });
});
