import { describe, it, expect } from 'vitest';
import { firstSentences, mergeFactChecks } from './analyze';
import type { FactChecksBlock } from './types';

describe('firstSentences', () => {
  it('takes the first n sentences', () => {
    expect(firstSentences('Un. Deux. Trois.', 2)).toBe('Un. Deux.');
  });
  it('collapses whitespace and handles no terminal punctuation', () => {
    expect(firstSentences('  bloc\nsans\nponctuation  ', 2)).toBe('bloc sans ponctuation');
  });
});

describe('mergeFactChecks', () => {
  const block = (model: string, checks: { factId: string; note: string }[]): FactChecksBlock =>
    ({ checks, model, promptHash: 'h', generatedAt: 't', cost: { model, inputTokens: 1, outputTokens: 1 } });

  it('upserts checks by factId (latest wins), keeping existing, stamping incoming meta', () => {
    const out = mergeFactChecks(block('m1', [{ factId: 'a', note: 'A' }, { factId: 'b', note: 'B' }]), block('m2', [{ factId: 'b', note: 'B2' }]));
    expect(out.checks).toEqual([{ factId: 'a', note: 'A' }, { factId: 'b', note: 'B2' }]);
    expect(out.model).toBe('m2');
  });

  it('handles a null existing block', () => {
    expect(mergeFactChecks(null, block('m', [{ factId: 'a', note: 'A' }])).checks).toEqual([{ factId: 'a', note: 'A' }]);
  });
});
