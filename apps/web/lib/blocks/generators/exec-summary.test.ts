import { describe, it, expect } from 'vitest';
import { execSummaryBlock } from './exec-summary';

describe('exec-summary', () => {
  it('is an item-scope extraction of the item-analysis bundle', () => {
    expect(execSummaryBlock.scope).toBe('item');
    expect(execSummaryBlock.prerequisites).toEqual([{ kind: 'block', blockId: 'item-analysis' }]);
  });

  it('extracts executive_summary with inherited citations', async () => {
    const bundle = JSON.stringify({ sections: { executive_summary: 'sum [1]' }, refs: [{ n: 1, factId: 'f1', url: 'u' }] });
    const out = await execSummaryBlock.generate({ blocks: { 'item-analysis': bundle } }, { language: 'fr' });
    expect(out.content).toBe('sum [1]');
    expect(out.citations).toEqual([{ factId: 'f1', url: 'u' }]);
  });
});
