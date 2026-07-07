import { describe, it, expect } from 'vitest';
import { buildExecSummaryPrompt, CONTENT_CAP, execSummaryBlock } from './exec-summary';

describe('exec-summary', () => {
  it('prompt embeds title, url, language instruction and content', () => {
    const p = buildExecSummaryPrompt({ title: 'Rome Final', url: 'https://yt/x', content: 'transcript here', language: 'fr' });
    expect(p).toContain('Rome Final');
    expect(p).toContain('https://yt/x');
    expect(p).toContain('transcript here');
    expect(p).toMatch(/français|French|fr\b/i);
  });

  it('caps very long content', () => {
    const long = 'x'.repeat(CONTENT_CAP + 5000);
    const p = buildExecSummaryPrompt({ title: 't', url: 'u', content: long, language: 'fr' });
    expect(p.length).toBeLessThan(CONTENT_CAP + 2000);
  });

  it('declares item scope with raw-content + item-metadata prerequisites', () => {
    expect(execSummaryBlock.scope).toBe('item');
    expect(execSummaryBlock.prerequisites).toEqual([{ kind: 'raw-content' }, { kind: 'item-metadata' }]);
  });
});
