import { describe, it, expect } from 'vitest';
import { parseDate, factPublishedAt, classify, backfillPublishedAt } from './temporal';

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
