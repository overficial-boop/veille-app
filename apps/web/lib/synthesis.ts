import type { Fact } from '@veille/core';
import { eq, desc } from 'drizzle-orm';
import { dossiers, facts as factsTable, dossierUpdates } from './db/schema';
import { selectLlmClient } from '@veille/core';
import { hostOf } from './host';

export type SourceGroup = { host: string; facts: Fact[] };

export { hostOf } from './host';

/** Group facts by publication host, preserving first-appearance order. */
export function groupFactsByHost(facts: Fact[]): SourceGroup[] {
  const map = new Map<string, Fact[]>();
  for (const f of facts) {
    const h = hostOf(f.sourceUrl);
    const arr = map.get(h); if (arr) arr.push(f); else map.set(h, [f]);
  }
  return [...map.entries()].map(([host, facts]) => ({ host, facts }));
}

export type ComposeKind = 'none' | 'brief' | 'update';
export function decideCompose(s: { hasFacts: boolean; hasBrief: boolean; hasNewFacts: boolean }): ComposeKind {
  if (!s.hasFacts) return 'none';
  if (!s.hasBrief) return 'brief';
  if (s.hasNewFacts) return 'update';
  return 'none';
}

function parseJson(text: string): Record<string, unknown> {
  try { return JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return {};
  }
}
function notesFrom(arr: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(arr)) for (const s of arr) {
    if (s && typeof s.host === 'string' && typeof s.summary === 'string') out[s.host.trim()] = s.summary.trim();
  }
  return out;
}

export function parseBrief(text: string): { brief: string; sourceNotes: Record<string, string> } {
  const raw = parseJson(text);
  return { brief: typeof raw.brief === 'string' ? raw.brief : '', sourceNotes: notesFrom(raw.sources) };
}
export function parseUpdate(text: string): { body: string; sourceNotes: Record<string, string> } {
  const raw = parseJson(text);
  return { body: typeof raw.update === 'string' ? raw.update : '', sourceNotes: notesFrom(raw.newSources) };
}

/** Serialize grouped facts for a synthesis prompt. */
export function renderGroups(groups: SourceGroup[]): string {
  return groups.map((g) =>
    `## ${g.host}\n` + g.facts.map((f) => `- ${f.text}`).join('\n')
  ).join('\n\n');
}

const BRIEF_SCHEMA = {
  type: 'OBJECT',
  properties: {
    brief: { type: 'STRING' },
    sources: { type: 'ARRAY', items: { type: 'OBJECT',
      properties: { host: { type: 'STRING' }, summary: { type: 'STRING' } },
      required: ['host', 'summary'], propertyOrdering: ['host', 'summary'] } },
  },
  required: ['brief', 'sources'], propertyOrdering: ['brief', 'sources'],
} as const;

const UPDATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    update: { type: 'STRING' },
    newSources: { type: 'ARRAY', items: { type: 'OBJECT',
      properties: { host: { type: 'STRING' }, summary: { type: 'STRING' } },
      required: ['host', 'summary'], propertyOrdering: ['host', 'summary'] } },
  },
  required: ['update'], propertyOrdering: ['update', 'newSources'],
} as const;

export { BRIEF_SCHEMA, UPDATE_SCHEMA };

export function buildBriefPrompt(subject: string, language: string, groups: SourceGroup[]): string {
  return [
    'You write a concise intelligence dossier brief.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output Markdown prose in the "brief" field.`,
    'Write a tight "current situation" brief: what is the state of things, the significant facts, who/what/when.',
    'Attribute claims to their publication by name in-line (e.g. "selon lemonde.fr…"). Group related points; do not just list facts.',
    'Also return, for each publication host below, a one-sentence "summary" of what that source is / its angle.',
    'Be factual and concise. No preamble. Return JSON only: { brief, sources: [{host, summary}] }.',
    '',
    'FACTS BY PUBLICATION:',
    renderGroups(groups),
  ].join('\n');
}

export function buildUpdatePrompt(subject: string, language: string, brief: string, newGroups: SourceGroup[]): string {
  return [
    'You write a short dated "what\'s new" update to an existing dossier.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output Markdown prose in the "update" field.`,
    'Below is the EXISTING brief (context) and only the NEW facts since the last update.',
    'Write a brief note describing what these new facts add or change relative to the brief. Attribute to publications by name. If nothing material, keep it to a sentence.',
    'For any publication host not implied by the existing brief, include it in "newSources" with a one-sentence summary.',
    'Return JSON only: { update, newSources: [{host, summary}] }.',
    '',
    'EXISTING BRIEF:', brief || '(none)',
    '',
    'NEW FACTS BY PUBLICATION:',
    renderGroups(newGroups),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type SynthesisProgress =
  | { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' }
  | { type: 'synthesis-error'; message: string };

// jsonb columns (provenance, extractedBy) are typed `unknown` by Drizzle; cast back to the Fact shape the insert path guarantees.
function toFact(row: typeof factsTable.$inferSelect): Fact {
  return {
    id: row.id,
    text: row.text,
    sourceUrl: row.sourceUrl,
    sourcePassage: row.sourcePassage,
    language: row.language,
    extractedAt: row.extractedAt.toISOString(),
    provenance: row.provenance as Fact['provenance'],
    extractedBy: row.extractedBy as Fact['extractedBy'],
    confidence: row.confidence ?? undefined,
  };
}

/** Returns the cutoff time for "new" facts in an update: latest update, else brief time. */
async function newFactsCutoff(dossierId: string, briefGeneratedAt: Date | null): Promise<Date | null> {
  // lazy: ./db eagerly validates env at module load — keep this module's pure helpers test-loadable
  const { db } = await import('./db');
  const [u] = await db
    .select({ at: dossierUpdates.createdAt })
    .from(dossierUpdates)
    .where(eq(dossierUpdates.dossierId, dossierId))
    .orderBy(desc(dossierUpdates.createdAt))
    .limit(1);
  return u?.at ?? briefGeneratedAt ?? null;
}

export async function composeDossier(
  dossierId: string,
  opts: { mode: 'auto' | 'brief'; language?: string; onProgress?: (p: SynthesisProgress) => void } = { mode: 'auto' },
): Promise<{ wrote: ComposeKind }> {
  const onProgress = opts.onProgress ?? (() => {});

  // lazy: ./db eagerly validates env at module load — keep this module's pure helpers test-loadable
  const { db } = await import('./db');

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return { wrote: 'none' };

  const language = opts.language ?? dossier.language ?? 'fr';

  const allRows = await db.select().from(factsTable).where(eq(factsTable.dossierId, dossierId));
  const hasFacts = allRows.length > 0;
  const briefExists = !!dossier.brief;
  // In 'brief' mode we force regeneration, so treat the brief as absent for the decision.
  const hasBrief = briefExists && opts.mode === 'auto';

  const cutoff = opts.mode !== 'brief' ? await newFactsCutoff(dossierId, dossier.briefGeneratedAt ?? null) : null;
  const newRows = cutoff ? allRows.filter((r) => r.createdAt > cutoff) : allRows;
  const hasNewFacts = newRows.length > 0;

  const kind =
    opts.mode === 'brief'
      ? hasFacts ? 'brief' : 'none'
      : decideCompose({ hasFacts, hasBrief, hasNewFacts });

  if (kind === 'none') {
    onProgress({ type: 'synthesis', phase: briefExists ? 'update' : 'brief', state: 'skip' });
    return { wrote: 'none' };
  }

  const { setBrief, addUpdate } = await import('./dossiers');

  const client = selectLlmClient(process.env as Record<string, string | undefined>);
  const subject = [dossier.name, dossier.intent].filter(Boolean).join(' — ');

  if (kind === 'brief') {
    onProgress({ type: 'synthesis', phase: 'brief', state: 'start' });
    const groups = groupFactsByHost(allRows.map(toFact));
    const res = await client.complete(buildBriefPrompt(subject, language, groups), { jsonSchema: BRIEF_SCHEMA });
    const { brief, sourceNotes } = parseBrief(res.text);
    if (brief) await setBrief(dossierId, brief, sourceNotes);
    onProgress({ type: 'synthesis', phase: 'brief', state: 'done' });
    return { wrote: 'brief' };
  }

  // update
  onProgress({ type: 'synthesis', phase: 'update', state: 'start' });
  const groups = groupFactsByHost(newRows.map(toFact));
  const res = await client.complete(
    buildUpdatePrompt(subject, language, dossier.brief ?? '', groups),
    { jsonSchema: UPDATE_SCHEMA },
  );
  const { body, sourceNotes } = parseUpdate(res.text);
  if (body) await addUpdate(dossierId, body, newRows.length, sourceNotes);
  onProgress({ type: 'synthesis', phase: 'update', state: 'done' });
  return { wrote: 'update' };
}
