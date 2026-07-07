import { describe, it, expect, beforeEach } from 'vitest';
import { registerBlock, getBlock, listBlocks, validateRegistry, __clearRegistryForTests } from './registry';
import type { BlockDef } from './types';

const gen: BlockDef['generate'] = async () => ({ content: 'x', citations: [] });
const def = (over: Partial<BlockDef>): BlockDef => ({
  id: 'a', name: 'A', scope: 'item', prerequisites: [], staleness: 'on-demand', generate: gen, ...over,
});

beforeEach(() => __clearRegistryForTests());

describe('registry', () => {
  it('registers and lists blocks', () => {
    registerBlock(def({ id: 'a' }));
    expect(getBlock('a')?.id).toBe('a');
    expect(listBlocks().map((b) => b.id)).toEqual(['a']);
  });

  it('rejects duplicate ids', () => {
    registerBlock(def({ id: 'a' }));
    expect(() => registerBlock(def({ id: 'a' }))).toThrow(/duplicate/i);
  });

  it('validate: flags unknown block prerequisite', () => {
    registerBlock(def({ id: 'a', prerequisites: [{ kind: 'block', blockId: 'ghost' }] }));
    expect(validateRegistry()).toEqual([expect.stringMatching(/a.*ghost/)]);
  });

  it('validate: flags a cycle', () => {
    registerBlock(def({ id: 'a', prerequisites: [{ kind: 'block', blockId: 'b' }] }));
    registerBlock(def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] }));
    expect(validateRegistry().some((e) => /cycle/i.test(e))).toBe(true);
  });

  it('validate: raw-content only on item-capable blocks', () => {
    registerBlock(def({ id: 'p', scope: 'page', prerequisites: [{ kind: 'raw-content' }] }));
    expect(validateRegistry().some((e) => /raw-content/.test(e))).toBe(true);
  });

  it('validate: item-facts only on item-capable blocks', () => {
    registerBlock(def({ id: 'p', scope: 'page', prerequisites: [{ kind: 'item-facts' }] }));
    expect(validateRegistry().some((e) => /item-facts/.test(e))).toBe(true);
  });

  it('validate: all-items only on page-capable blocks, referencing an item-capable block', () => {
    registerBlock(def({ id: 'leaf', scope: 'item' }));
    registerBlock(def({ id: 'agg', scope: 'page', prerequisites: [{ kind: 'all-items', blockId: 'leaf' }] }));
    registerBlock(def({ id: 'bad', scope: 'item', prerequisites: [{ kind: 'all-items', blockId: 'leaf' }] }));
    const errors = validateRegistry();
    expect(errors.some((e) => /bad/.test(e))).toBe(true);
    expect(errors.some((e) => /agg/.test(e))).toBe(false);
  });

  it('validate: clean graph returns no errors', () => {
    registerBlock(def({ id: 'a' }));
    registerBlock(def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] }));
    expect(validateRegistry()).toEqual([]);
  });
});
