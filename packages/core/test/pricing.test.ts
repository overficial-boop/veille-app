import { describe, it, expect } from 'vitest';
import { estimateUsd, PRICING } from '../src/pricing.js';

describe('estimateUsd', () => {
  it('returns 0 for unknown models', () => {
    expect(estimateUsd('not-a-model', { inputTokens: 1000, outputTokens: 1000 })).toBe(0);
  });

  it('computes USD from per-million-token rates', () => {
    const usd = estimateUsd('claude-opus-4-7', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const expected =
      PRICING['claude-opus-4-7']!.inputUsdPerMillionTokens +
      PRICING['claude-opus-4-7']!.outputUsdPerMillionTokens;
    expect(usd).toBeCloseTo(expected, 6);
  });

  it('scales linearly with token counts', () => {
    const half = estimateUsd('claude-opus-4-7', { inputTokens: 500_000, outputTokens: 500_000 });
    const full = estimateUsd('claude-opus-4-7', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(half).toBeCloseTo(full / 2, 6);
  });

  it('handles Gemini model pricing', () => {
    const usd = estimateUsd('gemini-2.5-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(usd).toBeCloseTo(0.30 + 2.50, 6);
  });
});
