import { describe, it, expect } from 'vitest';
import { buildItemAnalysisPrompt, parseBundle, SECTION_KEYS, itemAnalysisBlock, CONTENT_CAP } from './item-analysis';

const args = {
  title: 'Rome Final', url: 'https://yt/x', content: 'transcript here', language: 'fr',
  facts: [{ id: 'f-1', text: 'Galán won', sourceUrl: 'https://yt/x', sourcePassage: 'passage' }],
};

describe('item-analysis', () => {
  it('prompt numbers facts and embeds metadata, content, language', () => {
    const p = buildItemAnalysisPrompt(args);
    expect(p).toContain('Rome Final');
    expect(p).toContain('transcript here');
    expect(p).toMatch(/\bfr\b/);
    expect(p).toMatch(/\[1\]|^1\./m); // fact numbered 1
    expect(p).toContain('Galán won');
    expect(p).not.toContain('f-1'); // raw fact ids never reach the model
  });

  it('caps long content', () => {
    const p = buildItemAnalysisPrompt({ ...args, content: 'x'.repeat(CONTENT_CAP + 5000) });
    expect(p.length).toBeLessThan(CONTENT_CAP + 3000);
  });

  it('declares hidden item scope with raw-content + item-metadata + item-facts', () => {
    expect(itemAnalysisBlock.hidden).toBe(true);
    expect(itemAnalysisBlock.scope).toBe('item');
    expect(itemAnalysisBlock.prerequisites).toEqual([
      { kind: 'raw-content' }, { kind: 'item-metadata' }, { kind: 'item-facts' },
    ]);
  });

  it('parseBundle returns sections and refs, and throws on invalid JSON', () => {
    const good = JSON.stringify({
      executive_summary: 'sum [1]', key_themes: '- t', detailed_breakdown: 'd', arguments_evidence: 'a',
      notable_quotes: 'q', strengths_weaknesses: 's', actionable_takeaways: 'act', open_questions: 'o',
      refs: [{ n: 1, factId: 'f-1', url: 'https://yt/x' }],
    });
    const b = parseBundle(good);
    expect(b.sections.executive_summary).toBe('sum [1]');
    expect(b.refs).toEqual([{ n: 1, factId: 'f-1', url: 'https://yt/x' }]);
    expect(SECTION_KEYS).toHaveLength(8);
    expect(() => parseBundle('not json')).toThrow(/bundle/i);
  });
});
