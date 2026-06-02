import { selectLlmClient } from '@veille/core';
import type { LlmClient } from '@veille/core';

// The novelty/importance gate for the journal. Kept DB-free so the pure helpers (prompt + parse)
// are unit-testable without the env/db chain. selectLlmClient is read at call time, not import.

export type JournalCandidate = { id: string; text: string };
export type JournalSelection = { factId: string; reason: string };

/** Texts already shown in the journal, for the gate's "already known" baseline. */
export function journalTextsOf(entries: { text: string }[]): string[] {
  return entries.map((e) => e.text);
}

const GATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    keep: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['id', 'reason'],
        propertyOrdering: ['id', 'reason'],
      },
    },
  },
  required: ['keep'],
  propertyOrdering: ['keep'],
} as const;

export function buildJournalGatePrompt(input: {
  subject: string;
  brief: string;
  journalTexts: string[];
  candidates: JournalCandidate[];
  max: number;
}): string {
  const { subject, brief, journalTexts, candidates, max } = input;
  return [
    'You curate a subject-tracking "journal" — a feed of genuinely NEW developments.',
    `Subject: ${subject}`,
    'From the CANDIDATE facts below, keep ONLY those that report a NEW development that is NOT already covered by the current brief or by the journal entries already shown, AND that matters to someone tracking this subject. Drop restatements, near-duplicates of what is already known, background, and trivia.',
    `Keep at most ${max}, the most important. For each kept fact return its id and a one-sentence reason (why it is notable / new), in the subject's language.`,
    'Return JSON only: { keep: [{ id, reason }] }. If nothing qualifies, return { keep: [] }.',
    '',
    'CURRENT BRIEF (already synthesized — do not re-promote what it covers):',
    brief.trim() || '(none yet)',
    '',
    'ALREADY IN THE JOURNAL (do not repeat these):',
    journalTexts.length ? journalTexts.map((t) => `- ${t}`).join('\n') : '(empty)',
    '',
    'CANDIDATE FACTS (id — text):',
    candidates.map((c) => `${c.id} — ${c.text}`).join('\n'),
  ].join('\n');
}

function parseJson(text: string): Record<string, unknown> {
  try { return JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return {};
  }
}

/** Keep only ids that were candidates, de-duplicated, in first-appearance order, capped at max. */
export function parseJournalSelection(text: string, candidateIds: string[], max: number): JournalSelection[] {
  const allowed = new Set(candidateIds);
  const raw = parseJson(text);
  const keep = Array.isArray(raw.keep) ? raw.keep : [];
  const out: JournalSelection[] = [];
  const seen = new Set<string>();
  for (const k of keep) {
    if (!k || typeof k.id !== 'string') continue;
    const id = k.id.trim();
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ factId: id, reason: typeof k.reason === 'string' ? k.reason.trim() : '' });
    if (out.length >= max) break;
  }
  return out;
}

/** Run the gate over the candidate facts. One LLM call. Returns the facts to promote. */
export async function selectJournalWorthy(input: {
  subject: string;
  brief: string;
  journalTexts: string[];
  candidates: JournalCandidate[];
  max: number;
  client?: LlmClient;
}): Promise<JournalSelection[]> {
  if (input.candidates.length === 0 || input.max <= 0) return [];
  const client = input.client ?? selectLlmClient(process.env as Record<string, string | undefined>);
  const res = await client.complete(buildJournalGatePrompt(input), { jsonSchema: GATE_SCHEMA });
  return parseJournalSelection(res.text, input.candidates.map((c) => c.id), input.max);
}
