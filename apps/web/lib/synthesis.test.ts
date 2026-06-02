import { describe, it, expect } from 'vitest';
import { hostOf, groupFactsByHost, parseBrief, renderGroups, stripUnknownLinks, buildBriefPrompt, groupFactsByArticle, buildBriefRefs, renderArticleGroups } from './synthesis';
import type { Fact } from '@veille/core';

const f = (sourceUrl: string, text: string, extractedAt = '2026-05-30T00:00:00.000Z'): Fact =>
  ({ id: 'x', text, sourceUrl, sourcePassage: 'p', language: 'fr', extractedAt,
     provenance: { title: 'T' }, extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' } });

describe('hostOf', () => {
  it('strips www and scheme', () => {
    expect(hostOf('https://www.lemonde.fr/article/x')).toBe('lemonde.fr');
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('groupFactsByHost', () => {
  it('groups facts under their publication host, preserving order of first appearance', () => {
    const groups = groupFactsByHost([f('https://lemonde.fr/a', '1'), f('https://rtl.fr/b', '2'), f('https://lemonde.fr/c', '3')]);
    expect(groups.map((g) => g.host)).toEqual(['lemonde.fr', 'rtl.fr']);
    expect(groups[0]!.facts.map((x) => x.text)).toEqual(['1', '3']);
  });
});

describe('parseBrief', () => {
  it('parses JSON brief + source notes, tolerating fences', () => {
    const r = parseBrief('```json\n{"brief":"# B","sources":[{"host":"lemonde.fr","summary":"quotidien"}]}\n```');
    expect(r.brief).toBe('# B');
    expect(r.sourceNotes).toEqual({ 'lemonde.fr': 'quotidien' });
  });
  it('returns empty brief on garbage', () => {
    expect(parseBrief('not json').brief).toBe('');
  });
});

describe('renderGroups', () => {
  it('renders groups as markdown sections with source URL tags', () => {
    expect(renderGroups([{ host: 'lemonde.fr', facts: [f('https://lemonde.fr/a', 'fact1')] }]))
      .toBe('## lemonde.fr\n- fact1 [source: https://lemonde.fr/a]');
  });
  it('renders an empty groups array as an empty string', () => {
    expect(renderGroups([])).toBe('');
  });
});

describe('stripUnknownLinks', () => {
  const allowed = ['https://lemonde.fr/a', 'https://www.youtube.com/watch?v=ABC'];
  it('keeps links to known source URLs', () => {
    expect(stripUnknownLinks('selon [Le Monde](https://lemonde.fr/a) et [v](https://www.youtube.com/watch?v=ABC).', allowed))
      .toBe('selon [Le Monde](https://lemonde.fr/a) et [v](https://www.youtube.com/watch?v=ABC).');
  });
  it('unlinks unknown URLs, keeping the text', () => {
    expect(stripUnknownLinks('voir [ailleurs](https://evil.com/x) ici', allowed)).toBe('voir ailleurs ici');
  });
  it('tolerates a trailing slash / fragment difference', () => {
    expect(stripUnknownLinks('[x](https://lemonde.fr/a/) et [y](https://lemonde.fr/a#frag)', allowed))
      .toBe('[x](https://lemonde.fr/a/) et [y](https://lemonde.fr/a#frag)');
  });
  it('keeps distinct youtube videos distinct (query preserved)', () => {
    expect(stripUnknownLinks('[a](https://www.youtube.com/watch?v=ABC) [b](https://www.youtube.com/watch?v=XYZ)', allowed))
      .toBe('[a](https://www.youtube.com/watch?v=ABC) b');
  });
  it('keeps a known URL that contains balanced parens (e.g. Wikipedia)', () => {
    const a = ['https://fr.wikipedia.org/wiki/Pi_(mathématiques)'];
    expect(stripUnknownLinks('voir [Pi](https://fr.wikipedia.org/wiki/Pi_(mathématiques)) ici', a))
      .toBe('voir [Pi](https://fr.wikipedia.org/wiki/Pi_(mathématiques)) ici');
  });
});

describe('groupFactsByArticle', () => {
  it('groups facts by source URL, preserving first-appearance order', () => {
    const groups = groupFactsByArticle([f('https://lemonde.fr/a', '1'), f('https://rtl.fr/b', '2'), f('https://lemonde.fr/a', '3')]);
    expect(groups.map((g) => g.url)).toEqual(['https://lemonde.fr/a', 'https://rtl.fr/b']);
    expect(groups[0]!.facts.map((x) => x.text)).toEqual(['1', '3']);
  });
});

describe('buildBriefRefs', () => {
  it('numbers articles 1..N, taking title/docId from meta, host from the url, falling back to host', () => {
    const groups = groupFactsByArticle([f('https://lemonde.fr/a', '1'), f('https://rtl.fr/b', '2')]);
    const meta = new Map([['https://lemonde.fr/a', { docId: 'd1', title: 'Titre A' }]]);
    expect(buildBriefRefs(groups, meta)).toEqual([
      { n: 1, url: 'https://lemonde.fr/a', docId: 'd1', title: 'Titre A', host: 'lemonde.fr' },
      { n: 2, url: 'https://rtl.fr/b', docId: null, title: 'rtl.fr', host: 'rtl.fr' },
    ]);
  });
});

describe('renderArticleGroups', () => {
  it('renders numbered "## [n] title — host" headers with bare facts', () => {
    const groups = groupFactsByArticle([f('https://lemonde.fr/a', 'fact1')]);
    const refs = buildBriefRefs(groups, new Map([['https://lemonde.fr/a', { docId: 'd1', title: 'Titre A' }]]));
    expect(renderArticleGroups(groups, refs)).toBe('## [1] Titre A — lemonde.fr\n- fact1');
  });
});

describe('buildBriefPrompt article numbers', () => {
  it('instructs citing with bracketed article numbers, multi-paragraph prose, not URLs/tags', () => {
    const groups = groupFactsByArticle([f('https://lefigaro.fr/a', 'fact1')]);
    const refs = buildBriefRefs(groups, new Map([['https://lefigaro.fr/a', { docId: 'd1', title: 'Titre' }]]));
    const p = buildBriefPrompt('Sujet', 'fr', groups, refs);
    expect(p).toMatch(/\[2, 5\]/);
    expect(p).toMatch(/## \[1\] Titre — lefigaro\.fr/);
    expect(p).toMatch(/thematic paragraphs/i);
    expect(p).not.toMatch(/Markdown link/i);
  });
});

