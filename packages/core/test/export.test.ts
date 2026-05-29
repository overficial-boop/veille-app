import { describe, it, expect } from 'vitest';
import {
  exportSubjectAsMarkdown,
  exportSubjectAsJson,
  exportSubjectFilename,
  exportSubjectMimeType,
} from '../src/export.js';
import type { Subject } from '../src/types.js';

const subject = (overrides: Partial<Subject> = {}): Subject => ({
  id: 'subj',
  slug: 'pro-padel',
  name: 'Pro padel',
  description: 'The competitive padel circuit',
  language: 'en',
  sources: [
    {
      id: 'src-1',
      adapter: 'web',
      input: { kind: 'url', url: 'https://en.wikipedia.org/wiki/Padel' },
      lastExtractedAt: '2026-05-15T10:00:00.000Z',
    },
  ],
  facts: [
    {
      id: 'f1',
      text: 'Padel had 30 million players in 2025.',
      sourceUrl: 'https://en.wikipedia.org/wiki/Padel',
      sourcePassage: 'Padel had 30 million players across 130 countries in 2025.',
      language: 'en',
      extractedAt: '2026-05-15T10:00:00.000Z',
      provenance: { paragraphStart: 3, paragraphEnd: 3 },
      extractedBy: { model: 'gemini-2.5-flash', promptHash: 'abc', adapter: 'web' },
      confidence: 0.95,
    },
  ],
  createdAt: '2026-05-15T09:00:00.000Z',
  refreshedAt: '2026-05-15T10:00:00.000Z',
  ...overrides,
});

describe('exportSubjectAsMarkdown', () => {
  it('renders header with name, description, and metadata', () => {
    const md = exportSubjectAsMarkdown(subject());
    expect(md).toContain('# Pro padel');
    expect(md).toContain('The competitive padel circuit');
    expect(md).toContain('**Slug:** `pro-padel`');
    expect(md).toContain('**Language:** en');
    expect(md).toContain('**Sources:** 1');
    expect(md).toContain('**Facts:** 1');
  });

  it('lists sources with adapter + brief + extracted status', () => {
    const md = exportSubjectAsMarkdown(subject());
    expect(md).toContain('## Sources');
    expect(md).toContain('**web**');
    expect(md).toContain('https://en.wikipedia.org/wiki/Padel');
    expect(md).toContain('extracted 2026-05-15');
  });

  it('shows "not yet extracted" for pending sources', () => {
    const s = subject();
    delete s.sources[0]!.lastExtractedAt;
    const md = exportSubjectAsMarkdown(s);
    expect(md).toContain('not yet extracted');
  });

  it('groups facts by sourceUrl with text, blockquote passage, and metadata', () => {
    const md = exportSubjectAsMarkdown(subject());
    expect(md).toContain('## Facts');
    expect(md).toContain('### Source: https://en.wikipedia.org/wiki/Padel');
    expect(md).toContain('**Padel had 30 million players in 2025.**');
    expect(md).toContain('> Padel had 30 million players across 130 countries in 2025.');
    expect(md).toContain('paragraph 3');
    expect(md).toContain('confidence 0.95');
    expect(md).toContain('model `gemini-2.5-flash`');
  });

  it('renders an empty-facts placeholder', () => {
    const md = exportSubjectAsMarkdown(subject({ facts: [] }));
    expect(md).toContain('*No facts yet.*');
  });

  it('renders timestamp ranges for video-style provenance', () => {
    const s = subject({
      facts: [
        {
          ...subject().facts[0]!,
          provenance: { timestampStart: 12.3, timestampEnd: 18.7 },
        },
      ],
    });
    const md = exportSubjectAsMarkdown(s);
    expect(md).toMatch(/12–19s|12–19s/);
  });
});

describe('exportSubjectAsJson', () => {
  it('emits valid JSON that round-trips back to the subject', () => {
    const json = exportSubjectAsJson(subject());
    const parsed = JSON.parse(json);
    expect(parsed.slug).toBe('pro-padel');
    expect(parsed.facts).toHaveLength(1);
  });
});

describe('exportSubjectFilename / exportSubjectMimeType', () => {
  it('uses the slug as the base name with extension per format', () => {
    expect(exportSubjectFilename(subject(), 'markdown')).toBe('pro-padel.md');
    expect(exportSubjectFilename(subject(), 'json')).toBe('pro-padel.json');
  });
  it('returns the right MIME type per format', () => {
    expect(exportSubjectMimeType('markdown')).toBe('text/markdown; charset=utf-8');
    expect(exportSubjectMimeType('json')).toBe('application/json; charset=utf-8');
  });
});
