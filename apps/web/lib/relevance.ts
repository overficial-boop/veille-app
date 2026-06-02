import { selectLlmClient } from '@veille/core';

export type Relevance = { score: number; reason: string };

const SCHEMA = {
  type: 'OBJECT',
  properties: { score: { type: 'NUMBER' }, reason: { type: 'STRING' } },
  required: ['score', 'reason'], propertyOrdering: ['score', 'reason'],
} as const;

export function buildRelevancePrompt(a: { title: string; content: string; intent: string; language: string }): string {
  return [
    'You judge how relevant a document is to a tracking intent.',
    `Intent: ${a.intent}`,
    `Document title: ${a.title}`,
    `Answer in ${a.language}. Return JSON only: { score, reason }.`,
    'score = 0..1 (1 = squarely on the intent; 0 = unrelated). reason = ONE short sentence.',
    '',
    'DOCUMENT:',
    a.content,
  ].join('\n');
}

export function parseRelevance(text: string): Relevance {
  let raw: { score?: unknown; reason?: unknown } = {};
  try { raw = JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { raw = JSON.parse(m[0]); } catch { /* fall through */ } }
  }
  const n = typeof raw.score === 'number' ? raw.score : Number(raw.score);
  const score = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  return { score, reason };
}

/** Score one document's relevance to the intent (one light LLM call). */
export async function scoreRelevance(a: { title: string; content: string; intent: string; language: string; contentBudget: number }): Promise<Relevance> {
  const client = selectLlmClient(process.env as Record<string, string | undefined>);
  const content = a.content.slice(0, a.contentBudget);
  const res = await client.complete(buildRelevancePrompt({ ...a, content }), { jsonSchema: SCHEMA });
  return parseRelevance(res.text);
}
