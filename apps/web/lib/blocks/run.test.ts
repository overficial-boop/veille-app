import { describe, it, expect, vi } from 'vitest';
import { executeBlocks, type ExecDeps } from './run';
import type { BlockDef } from './types';

const mk = (id: string, prereqs: BlockDef['prerequisites'] = []): BlockDef => ({
  id, name: id, scope: 'item', prerequisites: prereqs, staleness: 'on-demand',
  generate: vi.fn(async () => ({ content: `out:${id}`, citations: [] })),
});

const deps = (defs: BlockDef[], over: Partial<ExecDeps> = {}): ExecDeps => ({
  getDef: (id) => defs.find((d) => d.id === id),
  resolve: vi.fn(async (def) => ({ inputs: {}, fingerprint: `fp-${def.id}` })),
  existing: vi.fn(async () => null),
  save: vi.fn(async () => {}),
  unstale: vi.fn(async () => {}),
  narrate: vi.fn(),
  ...over,
});

describe('executeBlocks', () => {
  it('runs instances in DAG order and saves each output', async () => {
    const a = mk('a'); const b = mk('b', [{ kind: 'block', blockId: 'a' }]);
    const d = deps([a, b]);
    const res = await executeBlocks(
      [{ instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }, { instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual(['a', 'b']); // a before b despite input order
    expect(d.save).toHaveBeenCalledTimes(2);
  });

  it('skips when the cached output is fresh (same fingerprint, not stale)', async () => {
    const a = mk('a');
    const d = deps([a], { existing: vi.fn(async () => ({ fingerprint: 'fp-a', stale: false })) });
    const res = await executeBlocks([{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }], { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual([]);
    expect(res.skipped).toEqual(['a']);
    expect(a.generate).not.toHaveBeenCalled();
  });

  it('stale but fingerprint-identical output is re-verified: unstaled and skipped, no regeneration', async () => {
    const a = mk('a');
    const unstale = vi.fn(async () => {});
    const d = deps([a], { existing: vi.fn(async () => ({ fingerprint: 'fp-a', stale: true })), unstale });
    const res = await executeBlocks([{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }], { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual([]);
    expect(res.skipped).toEqual(['a']);
    expect(unstale).toHaveBeenCalledWith('ia', 'doc1');
    expect(a.generate).not.toHaveBeenCalled();
  });

  it('stale output with changed fingerprint regenerates', async () => {
    const a = mk('a');
    const d = deps([a], { existing: vi.fn(async () => ({ fingerprint: 'old-fp', stale: true })) });
    const res = await executeBlocks([{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }], { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual(['a']);
  });

  it('records a miss (and continues) when prerequisites are unsatisfiable', async () => {
    const a = mk('a'); const b = mk('b');
    const d = deps([a, b], {
      resolve: vi.fn(async (def) => def.id === 'a' ? { missing: 'no content' } : { inputs: {}, fingerprint: 'fp-b' }),
    });
    const res = await executeBlocks(
      [{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }, { instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.missed).toEqual([{ blockId: 'a', reason: 'no content' }]);
    expect(res.ran).toEqual(['b']);
  });

  it('a generator failure does not abort the batch', async () => {
    const a = mk('a'); (a.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('llm down'));
    const b = mk('b');
    const d = deps([a, b]);
    const res = await executeBlocks(
      [{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }, { instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.failed).toEqual([{ blockId: 'a', error: 'llm down' }]);
    expect(res.ran).toEqual(['b']);
  });
});
