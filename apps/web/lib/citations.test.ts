import { describe, it, expect } from 'vitest';
import { buildCitationNumbers } from './citations';

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
