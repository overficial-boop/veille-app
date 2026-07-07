import { describe, it, expect } from 'vitest';
import { contentFingerprint, factPoolFingerprint, combineFingerprints } from './fingerprint';

describe('fingerprint', () => {
  it('contentFingerprint is deterministic and short', () => {
    expect(contentFingerprint('hello')).toBe(contentFingerprint('hello'));
    expect(contentFingerprint('hello')).toHaveLength(16);
    expect(contentFingerprint('hello')).not.toBe(contentFingerprint('hello!'));
  });

  it('factPoolFingerprint encodes refresh time and count', () => {
    expect(factPoolFingerprint('2026-07-07T10:00:00Z', 42)).toBe('fp:2026-07-07T10:00:00Z:42');
    expect(factPoolFingerprint(null, 0)).toBe('fp:never:0');
  });

  it('combineFingerprints is order-sensitive', () => {
    expect(combineFingerprints(['a', 'b'])).not.toBe(combineFingerprints(['b', 'a']));
    expect(combineFingerprints(['a', 'b'])).toBe(combineFingerprints(['a', 'b']));
  });
});
