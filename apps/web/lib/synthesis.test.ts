import { describe, it, expect } from 'vitest';
import { hostOf, groupFactsByHost, decideCompose, parseBrief, parseUpdate, renderGroups } from './synthesis';
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

describe('decideCompose', () => {
  it('none when no facts; brief when facts but no brief; update when brief + new facts', () => {
    expect(decideCompose({ hasFacts: false, hasBrief: false, hasNewFacts: false })).toBe('none');
    expect(decideCompose({ hasFacts: true, hasBrief: false, hasNewFacts: true })).toBe('brief');
    expect(decideCompose({ hasFacts: true, hasBrief: true, hasNewFacts: true })).toBe('update');
    expect(decideCompose({ hasFacts: true, hasBrief: true, hasNewFacts: false })).toBe('none');
    expect(decideCompose({ hasFacts: true, hasBrief: false, hasNewFacts: false })).toBe('brief');
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

describe('parseUpdate', () => {
  it('parses update body + new source notes', () => {
    const r = parseUpdate('{"update":"news","newSources":[{"host":"rtl.fr","summary":"radio"}]}');
    expect(r.body).toBe('news');
    expect(r.sourceNotes).toEqual({ 'rtl.fr': 'radio' });
  });
});

describe('renderGroups', () => {
  it('renders groups as markdown sections', () => {
    expect(renderGroups([{ host: 'lemonde.fr', facts: [f('https://lemonde.fr/a', 'fact1')] }]))
      .toBe('## lemonde.fr\n- fact1');
  });
  it('renders an empty groups array as an empty string', () => {
    expect(renderGroups([])).toBe('');
  });
});
