import { describe, it, expect } from 'vitest';
import { parseDate, factPublishedAt, backfillPublishedAt, isRecentCandidate, isWithinDays } from './temporal';

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

describe('isRecentCandidate', () => {
  const last = new Date('2026-05-29T00:00:00Z');
  it('undated → recent (benefit of the doubt)', () => {
    expect(isRecentCandidate(undefined, last)).toBe(true);
  });
  it('published after last refresh → recent', () => {
    expect(isRecentCandidate('2026-05-30', last)).toBe(true);
  });
  it('published on/before last refresh → not recent', () => {
    expect(isRecentCandidate('2025-08-15', last)).toBe(false);
    expect(isRecentCandidate('2026-05-29T00:00:00Z', last)).toBe(false);
  });
  it('null lastRefresh → recent', () => {
    expect(isRecentCandidate('2020-01-01', null)).toBe(true);
  });
});

describe('isWithinDays', () => {
  const now = new Date('2026-06-03T12:00:00Z');
  it('undated → within (benefit of the doubt)', () => {
    expect(isWithinDays(undefined, now, 7)).toBe(true);
  });
  it('published within the window → true (this morning passes even after a same-day refresh)', () => {
    expect(isWithinDays('2026-06-03T06:38:00Z', now, 7)).toBe(true);
    expect(isWithinDays('2026-05-30T20:00:00Z', now, 7)).toBe(true);
  });
  it('published before the window → false', () => {
    expect(isWithinDays('2026-05-20T00:00:00Z', now, 7)).toBe(false);
    expect(isWithinDays('2024-01-01', now, 7)).toBe(false);
  });
});
