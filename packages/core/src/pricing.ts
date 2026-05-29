// LAST_VERIFIED: 2026-05-14 — keep in sync with anthropic.com/pricing and ai.google.dev/pricing
// All prices are USD per 1M tokens. Verify before committing major changes.
export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
  'claude-sonnet-4-6': { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
  'claude-haiku-4-5': { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 },
  'gemini-2.5-flash': { inputUsdPerMillionTokens: 0.30, outputUsdPerMillionTokens: 2.50 },
  'gemini-2.5-flash-lite': { inputUsdPerMillionTokens: 0.10, outputUsdPerMillionTokens: 0.40 },
  'gemini-2.5-pro': { inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 10.00 },
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type CostInfo = {
  model: string;
} & TokenUsage;

export function estimateUsd(model: string, usage: TokenUsage): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (usage.inputTokens / 1_000_000) * p.inputUsdPerMillionTokens +
    (usage.outputTokens / 1_000_000) * p.outputUsdPerMillionTokens
  );
}
