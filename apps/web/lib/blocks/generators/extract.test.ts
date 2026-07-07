import { describe, it, expect } from 'vitest';
import { makeExtractionBlock, EXTRACTION_BLOCKS } from './extract';
import type { ResolvedInputs } from '../types';

const bundleContent = JSON.stringify({
  sections: {
    executive_summary: 'sum [1]', key_themes: '- t', detailed_breakdown: 'd', arguments_evidence: 'a',
    notable_quotes: 'q', strengths_weaknesses: 's', actionable_takeaways: 'act', open_questions: 'o',
  },
  refs: [{ n: 1, factId: 'f-1', url: 'https://yt/x' }],
});
const inputs: ResolvedInputs = { blocks: { 'item-analysis': bundleContent } };

describe('extraction blocks', () => {
  it('extracts its section and inherits the refs as citations — zero LLM', async () => {
    const b = makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions');
    const out = await b.generate(inputs, { language: 'fr' });
    expect(out.content).toBe('o');
    expect(out.citations).toEqual([{ factId: 'f-1', url: 'https://yt/x' }]);
  });

  it('throws (fail-soft upstream) when the bundle is absent or the section missing', async () => {
    const b = makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions');
    await expect(b.generate({}, { language: 'fr' })).rejects.toThrow(/item-analysis/);
    const bad: ResolvedInputs = { blocks: { 'item-analysis': JSON.stringify({ sections: {}, refs: [] }) } };
    await expect(b.generate(bad, { language: 'fr' })).rejects.toThrow(/open_questions/);
  });

  it('declares the seven visible catalog blocks, all item-scope extractions of item-analysis', () => {
    expect(EXTRACTION_BLOCKS.map((b) => b.id).sort()).toEqual([
      'actionable-takeaways', 'arguments-evidence', 'detailed-breakdown', 'key-themes',
      'notable-quotes', 'open-questions', 'strengths-weaknesses',
    ]);
    for (const b of EXTRACTION_BLOCKS) {
      expect(b.scope).toBe('item');
      expect(b.hidden).toBeUndefined();
      expect(b.prerequisites).toEqual([{ kind: 'block', blockId: 'item-analysis' }]);
    }
  });
});
