import { createHash } from 'node:crypto';
import { selectLlmClient, mapWithConcurrency } from '@veille/core';
import {
  buildReviewPrompt,
  buildResumePrompt,
  buildElaboratePrompt,
  buildFactCheckPrompt,
  parseElaboration,
  ELABORATE_SCHEMA,
} from './prompts';
import type { ReviewBlock, BulletsBlock, ElaborationBlock, FactChecksBlock, TokenCost } from './types';

// LlmResponse shape (from packages/core/src/llm.ts):
//   { text: string; inputTokens: number; outputTokens: number; model: string }
// All fields are top-level — no nested .cost or .usage.

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const now = () => new Date().toISOString();
function client() {
  return selectLlmClient(process.env as Record<string, string | undefined>);
}

/** First ~n sentences of markdown prose (for the résumé court). Pure, exported for testing. */
export function firstSentences(md: string, n: number): string {
  const flat = md.replace(/\s+/g, ' ').trim();
  const parts = (flat.match(/[^.!?]+[.!?]+/g) ?? [flat]).map((s) => s.trim());
  return parts.slice(0, n).join(' ').trim();
}

function costFrom(r: { text: string; inputTokens: number; outputTokens: number; model: string }): TokenCost {
  return { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
}

function meta(prompt: string, cost: TokenCost) {
  return { model: cost.model, promptHash: hash(prompt), generatedAt: now(), cost };
}

export async function analyzeDocumentCore(a: {
  content: string;
  title: string;
  siteName?: string;
  lang: string;
}): Promise<{ shortSummary: string; review: ReviewBlock; bullets: BulletsBlock }> {
  const c = client();

  const reviewPrompt = buildReviewPrompt(a);
  const r = await c.complete(reviewPrompt, {});
  const reviewMd = r.text.trim();
  const review: ReviewBlock = { markdown: reviewMd, ...meta(reviewPrompt, costFrom(r)) };

  const resumePrompt = buildResumePrompt({ review: reviewMd, title: a.title, lang: a.lang });
  const b = await c.complete(resumePrompt, {});
  const bullets: BulletsBlock = { markdown: b.text.trim(), ...meta(resumePrompt, costFrom(b)) };

  return { shortSummary: firstSentences(reviewMd, 2), review, bullets };
}

export async function elaborate(a: {
  review: string;
  title: string;
  lang: string;
  withTavily: boolean;
}): Promise<ElaborationBlock> {
  const c = client();
  const prompt = buildElaboratePrompt(a);
  const r = await c.complete(prompt, { jsonSchema: ELABORATE_SCHEMA });
  const { topics } = parseElaboration(r.text);
  return { topics, withTavily: a.withTavily, ...meta(prompt, costFrom(r)) };
}

export async function factCheck(
  items: { id: string; text: string }[],
  title: string,
  lang: string,
): Promise<FactChecksBlock> {
  const c = client();
  let cost: TokenCost = { model: 'gemini-2.5-flash', inputTokens: 0, outputTokens: 0 };

  const checks = await mapWithConcurrency(items, 4, async (f) => {
    const prompt = buildFactCheckPrompt({ factText: f.text, title, lang });
    const r = await c.complete(prompt, {});
    const k = costFrom(r);
    cost = { model: k.model, inputTokens: cost.inputTokens + k.inputTokens, outputTokens: cost.outputTokens + k.outputTokens };
    return { factId: f.id, note: r.text.trim() };
  });

  return { checks, ...meta('factcheck-v1', cost) };
}
