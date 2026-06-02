import { describe, it, expect } from 'vitest';
import { buildCitationNumbers } from './citations';
import {
  hostTagGroups,
  buildHostCitations,
  renderHostCitations,
  renderNumberedCitations,
  buildSourceRows,
} from './citations';

describe('buildCitationNumbers', () => {
  it('numbers brief-cited URLs first, in first-appearance order', () => {
    const brief = 'See [this](https://a.com/1) and [also](https://b.com/2) for details.';
    const map = buildCitationNumbers(brief, []);
    expect(map['https://a.com/1']).toBe(1);
    expect(map['https://b.com/2']).toBe(2);
  });

  it('assigns extra fact URLs not in the brief after brief URLs', () => {
    const brief = 'See [this](https://a.com/1).';
    const map = buildCitationNumbers(brief, ['https://a.com/1', 'https://c.com/3', 'https://d.com/4']);
    expect(map['https://a.com/1']).toBe(1);
    expect(map['https://c.com/3']).toBe(2);
    expect(map['https://d.com/4']).toBe(3);
  });

  it('keeps the brief number for a URL that appears in both brief and factUrls', () => {
    const brief = 'See [source](https://a.com/1) and [another](https://b.com/2).';
    const map = buildCitationNumbers(brief, ['https://b.com/2', 'https://c.com/3']);
    expect(map['https://a.com/1']).toBe(1);
    expect(map['https://b.com/2']).toBe(2);
    expect(map['https://c.com/3']).toBe(3);
  });

  it('deduplicates: same URL cited multiple times in the brief only gets one number', () => {
    const brief = '[first](https://a.com/1) and [again](https://a.com/1).';
    const map = buildCitationNumbers(brief, []);
    expect(map['https://a.com/1']).toBe(1);
    expect(Object.keys(map)).toHaveLength(1);
  });

  it('numbers purely from factUrls when brief is undefined', () => {
    const map = buildCitationNumbers(undefined, ['https://x.com/1', 'https://y.com/2']);
    expect(map['https://x.com/1']).toBe(1);
    expect(map['https://y.com/2']).toBe(2);
  });

  it('numbers purely from factUrls when brief is null', () => {
    const map = buildCitationNumbers(null, ['https://x.com/1', 'https://y.com/2']);
    expect(map['https://x.com/1']).toBe(1);
    expect(map['https://y.com/2']).toBe(2);
  });

  it('returns an empty map when both brief and factUrls are empty', () => {
    expect(buildCitationNumbers(undefined, [])).toEqual({});
    expect(buildCitationNumbers('', [])).toEqual({});
  });

  it('tolerates one level of balanced parens in URLs', () => {
    const brief = '[link](https://en.wikipedia.org/wiki/France_(country))';
    const map = buildCitationNumbers(brief, []);
    expect(map['https://en.wikipedia.org/wiki/France_(country)']).toBe(1);
  });
});

describe('hostTagGroups', () => {
  it('extracts comma-split tokens from [..] groups, ignoring real [text](url) links', () => {
    const md = 'a [lefigaro.fr, apnews.com] b [Le Monde](https://lemonde.fr) c [ouest-france.fr]';
    expect(hostTagGroups(md)).toEqual([['lefigaro.fr', 'apnews.com'], ['ouest-france.fr']]);
  });
});

describe('buildHostCitations', () => {
  it('numbers brief-cited hosts first (appearance order), then remaining fact hosts', () => {
    const brief = 'x [b.fr] y [a.fr, b.fr] z';
    const map = buildHostCitations(brief, ['a.fr', 'b.fr', 'c.fr']);
    expect(map).toEqual({ 'b.fr': 1, 'a.fr': 2, 'c.fr': 3 });
  });
  it('ignores brief tags that are not known fact hosts', () => {
    expect(buildHostCitations('q [unknown.fr] w', ['a.fr'])).toEqual({ 'a.fr': 1 });
  });
  it('empty brief → fact hosts in given order', () => {
    expect(buildHostCitations(null, ['a.fr', 'b.fr'])).toEqual({ 'a.fr': 1, 'b.fr': 2 });
  });
});

describe('renderHostCitations', () => {
  const nums = { 'a.fr': 1, 'b.fr': 2 };
  it('rewrites a known-host group into anchor links (one per host)', () => {
    expect(renderHostCitations('hi [a.fr, b.fr] x', nums))
      .toBe('hi [a.fr](#cite-a.fr)[b.fr](#cite-b.fr) x');
  });
  it('leaves a group with no known host untouched', () => {
    expect(renderHostCitations('see [note] end', nums)).toBe('see [note] end');
  });
  it('does not touch real [text](url) links', () => {
    expect(renderHostCitations('[Le Monde](https://lemonde.fr)', nums)).toBe('[Le Monde](https://lemonde.fr)');
  });
});

describe('buildSourceRows', () => {
  it('orders by number; representative url = first fact url for the host; attaches note', () => {
    const rows = buildSourceRows(
      { 'a.fr': 1, 'b.fr': 2 },
      ['https://a.fr/1', 'https://a.fr/2', 'https://b.fr/x'],
      { 'a.fr': 'note A' },
    );
    expect(rows).toEqual([
      { host: 'a.fr', n: 1, url: 'https://a.fr/1', note: 'note A' },
      { host: 'b.fr', n: 2, url: 'https://b.fr/x', note: undefined },
    ]);
  });
});

describe('renderNumberedCitations', () => {
  const refs = [
    { n: 1, url: 'https://a.fr/1' },
    { n: 2, url: 'https://b.fr/2' },
  ];
  it('rewrites [n] and [n, m] into per-article links', () => {
    expect(renderNumberedCitations('hi [1] and [1, 2] x', refs))
      .toBe('hi [1](https://a.fr/1) and [1](https://a.fr/1)[2](https://b.fr/2) x');
  });
  it('leaves out-of-range numbers and prose brackets untouched', () => {
    expect(renderNumberedCitations('see [9] and [note] end', refs)).toBe('see [9] and [note] end');
  });
  it('does not touch real [text](url) links or host tags', () => {
    expect(renderNumberedCitations('[Le Monde](https://lemonde.fr) [lefigaro.fr]', refs))
      .toBe('[Le Monde](https://lemonde.fr) [lefigaro.fr]');
  });
});
