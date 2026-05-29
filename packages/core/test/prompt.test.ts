import { describe, it, expect } from 'vitest';
import { renderPrompt, loadPrompt } from '../src/prompt.js';

describe('renderPrompt', () => {
  it('replaces all variables', () => {
    const tpl = '[{{language}}] [{{subjectHint}}] [{{chunk}}] [{{contentType}}] [{{locatorUnit}}] [{{markerExample}}]';
    const out = renderPrompt(tpl, {
      language: 'fr',
      subjectHint: 'pro padel',
      chunk: 'hello',
      contentType: 'transcript',
      locatorUnit: 'seconds within the video',
      markerExample: '[Xs]',
    });
    expect(out).toBe('[fr] [pro padel] [hello] [transcript] [seconds within the video] [[Xs]]');
  });

  it('substitutes empty subjectHint with "(none)"', () => {
    const tpl = 'hint: {{subjectHint}}';
    expect(renderPrompt(tpl, {
      language: 'en',
      subjectHint: '',
      chunk: '',
      contentType: 'transcript',
      locatorUnit: 'seconds',
      markerExample: '[Xs]',
    })).toBe('hint: (none)');
  });

  it('replaces multiple occurrences of same variable', () => {
    const tpl = '{{language}} and {{language}}';
    expect(renderPrompt(tpl, {
      language: 'en',
      subjectHint: '',
      chunk: '',
      contentType: 'transcript',
      locatorUnit: 'seconds',
      markerExample: '[Xs]',
    })).toBe('en and en');
  });

  it('replaces contentType and locatorUnit in template', () => {
    const tpl = 'you analyze a {{contentType}}. markers give {{locatorUnit}}. example: {{markerExample}}';
    expect(renderPrompt(tpl, {
      language: 'en',
      subjectHint: '',
      chunk: '',
      contentType: 'article',
      locatorUnit: 'paragraph index',
      markerExample: '[P0]',
    })).toBe('you analyze a article. markers give paragraph index. example: [P0]');
  });
});

describe('loadPrompt', () => {
  it('returns the template body and a 16-char hex hash', async () => {
    const { template, hash } = await loadPrompt();
    expect(template).toContain('{{language}}');
    expect(template).toContain('{{chunk}}');
    expect(template).toContain('{{contentType}}');
    expect(template).toContain('{{locatorUnit}}');
    expect(template).toContain('{{markerExample}}');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns the same hash on repeated calls (cached)', async () => {
    const a = await loadPrompt();
    const b = await loadPrompt();
    expect(a.hash).toBe(b.hash);
  });
});
