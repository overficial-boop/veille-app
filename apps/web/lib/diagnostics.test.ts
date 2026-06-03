import { describe, it, expect } from 'vitest';
import { classifyDiscovery, bucket } from './diagnostics';

const c = (url: string, score?: number, publishedAt?: string) => ({ url, title: url, score, publishedAt });

describe('classifyDiscovery', () => {
  it('stages candidates: score floor, low-rank, recency, seen → and returns survivors to process', () => {
    const cands = [
      c('https://a/1', 0.9, '2026-06-03'),
      c('https://a/2', 0.3, '2026-06-03'),
      c('https://a/3', 0.8, '2020-01-01'),
      c('https://a/seen', 0.7, '2026-06-03'),
      c('https://a/4', 0.6, '2026-06-03'),
    ];
    const seen = new Set(['https://a/seen']);
    const { funnel, toProcess } = classifyDiscovery(cands, {
      query: 'q', candidateScoreFloor: 0.4, perSource: 2,
      isRecent: (p) => p !== '2020-01-01', seenUrls: seen,
    });
    const verdict = (u: string) => funnel.find((f) => f.url === u)?.verdict;
    expect(verdict('https://a/2')).toBe('rejected:score');
    expect(verdict('https://a/4')).toBe('rejected:low-rank');
    expect(verdict('https://a/3')).toBe('rejected:recency');
    expect(toProcess.map((x) => x.url)).toEqual(['https://a/1']);
  });
});

describe('bucket', () => {
  const knobs = { recencyDays: 7, candidateScoreFloor: 0.4, relevanceKeepFloor: 0.5 };
  const now = new Date('2026-06-03T12:00:00Z');
  it('rejects on provider score floor', () => {
    expect(bucket({ providerScore: 0.2, relevance: 0.9, publishedAt: '2026-06-03' }, knobs, now)).toBe('rejected:score');
  });
  it('rejects on recency window', () => {
    expect(bucket({ relevance: 0.9, publishedAt: '2026-05-01' }, knobs, now)).toBe('rejected:recency');
  });
  it('keeps when relevance ≥ keep floor, suggestion when below', () => {
    expect(bucket({ relevance: 0.8, publishedAt: '2026-06-03' }, knobs, now)).toBe('kept');
    expect(bucket({ relevance: 0.3, publishedAt: '2026-06-03' }, knobs, now)).toBe('suggestion');
  });
  it('null relevance → suggestion (not kept)', () => {
    expect(bucket({ relevance: null, publishedAt: '2026-06-03' }, knobs, now)).toBe('suggestion');
  });
  it('recencyDays 0 disables the window (undated/old still pass to relevance)', () => {
    expect(bucket({ relevance: 0.9, publishedAt: '2020-01-01' }, { ...knobs, recencyDays: 0 }, now)).toBe('kept');
  });
});
