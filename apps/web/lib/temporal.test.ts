import { describe, it, expect } from 'vitest';
import { parseDate, factPublishedAt, classify, backfillPublishedAt, countPendingRebuild } from './temporal';

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate('2025-08-15')?.toISOString().slice(0, 10)).toBe('2025-08-15');
  });
  it('returns null for missing/empty/garbage', () => {
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('factPublishedAt', () => {
  it('reads provenance.publishedAt', () => {
    const d = factPublishedAt({ provenance: { publishedAt: '2026-05-30' } });
    expect(d?.toISOString().slice(0, 10)).toBe('2026-05-30');
  });
  it('does NOT fall back to extractedAt (unknown stays null)', () => {
    expect(factPublishedAt({ provenance: { extractedAt: '2026-05-30' } })).toBeNull();
    expect(factPublishedAt({ provenance: null })).toBeNull();
  });
});

describe('classify', () => {
  const cutoff = new Date('2026-05-29T00:00:00Z');
  it('after cutoff => actualite', () => {
    expect(classify({ provenance: { publishedAt: '2026-05-30' } }, cutoff)).toBe('actualite');
  });
  it('on/before cutoff => complement', () => {
    expect(classify({ provenance: { publishedAt: '2025-08-15' } }, cutoff)).toBe('complement');
    expect(classify({ provenance: { publishedAt: '2026-05-29T00:00:00Z' } }, cutoff)).toBe('complement');
  });
  it('unknown date => complement', () => {
    expect(classify({ provenance: {} }, cutoff)).toBe('complement');
  });
  it('null cutoff (first update) => actualite', () => {
    expect(classify({ provenance: {} }, null)).toBe('actualite');
  });
});

describe('backfillPublishedAt', () => {
  it('fills publishedAt from candidate when missing', () => {
    const f = backfillPublishedAt({ provenance: { foo: 1 } }, '2026-05-30');
    expect((f.provenance as { publishedAt?: string }).publishedAt?.slice(0, 10)).toBe('2026-05-30');
    expect((f.provenance as { foo?: number }).foo).toBe(1); // preserves existing provenance
  });
  it('does not overwrite an existing publishedAt', () => {
    const f = backfillPublishedAt({ provenance: { publishedAt: '2024-01-01' } }, '2026-05-30');
    expect((f.provenance as { publishedAt: string }).publishedAt).toBe('2024-01-01');
  });
  it('leaves fact unchanged when candidate date is unusable', () => {
    const orig = { provenance: {} };
    expect(backfillPublishedAt(orig, undefined)).toBe(orig);
    expect(backfillPublishedAt(orig, 'garbage')).toBe(orig);
  });
});

describe('countPendingRebuild', () => {
  const brief = new Date('2026-05-29T00:00:00Z');
  const mk = (createdAt: string, publishedAt?: string) => ({ createdAt: new Date(createdAt), provenance: publishedAt ? { publishedAt } : {} });

  it('returns 0 when no brief yet', () => {
    expect(countPendingRebuild([mk('2026-05-30', '2020-01-01')], null, null)).toBe(0);
  });
  it('counts old-published facts created after the brief', () => {
    expect(countPendingRebuild([mk('2026-05-30', '2025-08-15')], brief, null)).toBe(1);
  });
  it('ignores recent-published facts (they belong to the journal)', () => {
    expect(countPendingRebuild([mk('2026-05-30', '2026-05-30')], brief, null)).toBe(0);
  });
  it('counts undated facts (conservative)', () => {
    expect(countPendingRebuild([mk('2026-05-30')], brief, null)).toBe(1);
  });
  it('excludes facts created on/before the brief', () => {
    expect(countPendingRebuild([mk('2026-05-28', '2025-08-15')], brief, null)).toBe(0);
  });
  it('snooze: counts only facts created after dismissedAt', () => {
    const dismissed = new Date('2026-05-31T00:00:00Z');
    const facts = [mk('2026-05-30', '2025-08-15'), mk('2026-06-01', '2025-08-16')];
    expect(countPendingRebuild(facts, brief, dismissed)).toBe(1);
  });
});
