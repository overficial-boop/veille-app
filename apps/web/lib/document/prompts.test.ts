import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, buildResumePrompt, buildElaboratePrompt, buildFactCheckPrompt, parseElaboration } from './prompts';

describe('prompt builders', () => {
  it('review prompt: prose, in language, includes content + title', () => {
    const p = buildReviewPrompt({ content: 'CORPS', title: 'T', siteName: 'lemonde.fr', lang: 'fr' });
    expect(p).toContain('fr'); expect(p).toContain('CORPS'); expect(p).toContain('T');
    expect(p).toMatch(/prose/i); expect(p).toMatch(/bullet|puces|paragraph/i);
  });
  it('resume prompt: 3-7 bullets from the review', () => {
    const p = buildResumePrompt({ review: 'REVIEW', title: 'T', lang: 'fr' });
    expect(p).toContain('REVIEW'); expect(p).toMatch(/3 to 7|3 à 7|3-7/);
  });
  it('elaborate prompt: 3-5 topics + resources as JSON', () => {
    const p = buildElaboratePrompt({ review: 'R', title: 'T', lang: 'fr', withTavily: false });
    expect(p).toContain('topics'); expect(p).toContain('resources'); expect(p).toMatch(/3 to 5|3 à 5|3-5/);
  });
  it('factcheck prompt: background-knowledge-only', () => {
    const p = buildFactCheckPrompt({ factText: 'CLAIM', title: 'T', lang: 'fr' });
    expect(p).toContain('CLAIM'); expect(p).toMatch(/background|independent/i);
  });
});

describe('parseElaboration', () => {
  it('parses topics + resources, tolerates code fences', () => {
    const raw = '```json\n{"topics":[{"name":"N","summary":"S","resources":[{"name":"R","kind":"book"}]}]}\n```';
    const r = parseElaboration(raw);
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0]).toMatchObject({ name: 'N', summary: 'S' });
  });
  it('returns empty topics on garbage', () => {
    expect(parseElaboration('not json').topics).toEqual([]);
  });
});
