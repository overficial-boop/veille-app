import { describe, it, expect } from 'vitest';
import { buildDecodeBody, extractDecodedUrl, articleIdFrom } from '../src/providers/google-news-decode.js';

describe('articleIdFrom', () => {
  it('takes the path segment after /articles/, dropping query', () => {
    expect(articleIdFrom('https://news.google.com/rss/articles/CBMiABC123?oc=5&hl=fr')).toBe('CBMiABC123');
  });
  it('returns null when not an articles URL', () => {
    expect(articleIdFrom('https://news.google.com/rss/search?q=x')).toBeNull();
  });
});

describe('buildDecodeBody', () => {
  it('embeds id, ts, sig in the Fbv4je garturlreq payload', () => {
    const body = buildDecodeBody('ID123', 1700000000, 'SIG456');
    expect(body.startsWith('f.req=')).toBe(true);
    const decoded = decodeURIComponent(body.slice('f.req='.length));
    expect(decoded).toContain('Fbv4je');
    expect(decoded).toContain('garturlreq');
    expect(decoded).toContain('ID123');
    expect(decoded).toContain('1700000000');
    expect(decoded).toContain('SIG456');
  });
});

describe('extractDecodedUrl', () => {
  it('pulls the first non-google https URL from a batchexecute response', () => {
    const resp = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"https://www.lemonde.fr/article/x\\"]",null,null,null,"generic"]]`;
    expect(extractDecodedUrl(resp)).toBe('https://www.lemonde.fr/article/x');
  });
  it('returns null when no publisher url present', () => {
    expect(extractDecodedUrl(')]}\'\n[["wrb.fr","Fbv4je","[]"]]')).toBeNull();
  });
});
