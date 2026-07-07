import { describe, it, expect } from 'vitest';
import { buildTldrPrompt, tldrBlock } from './tldr';

describe('tldr', () => {
  it('prompt embeds the parent summary and asks for one sentence', () => {
    const p = buildTldrPrompt({ summary: 'A long executive summary.', language: 'fr' });
    expect(p).toContain('A long executive summary.');
    expect(p).toMatch(/une seule phrase|one sentence/i);
  });

  it('is a pure derivation: prerequisite is the exec-summary block output', () => {
    expect(tldrBlock.prerequisites).toEqual([{ kind: 'block', blockId: 'exec-summary' }]);
    expect(tldrBlock.scope).toBe('item');
  });
});
