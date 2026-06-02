import type { Fact } from '@veille/core';
import { eq, and, inArray } from 'drizzle-orm';
import { dossiers, facts as factsTable, documents as documentsTable } from './db/schema';
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

export type ComposeKind = 'none' | 'brief';

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
/** Serialize grouped facts for a synthesis prompt. */
export function renderGroups(groups: SourceGroup[]): string {
  return groups.map((g) =>
    `## ${g.host}\n` + g.facts.map((f) => `- ${f.text} [source: ${f.sourceUrl}]`).join('\n')
  ).join('\n\n');
}

/** Anti-hallucination guard: unlink any Markdown link whose URL isn't a known source URL
 *  (keep the link text as plain prose). Ignores a trailing "/" and a "#fragment" when comparing,
 *  but preserves query strings so different YouTube watch?v= videos stay distinct. */
export function stripUnknownLinks(markdown: string, allowedUrls: Iterable<string>): string {
  const norm = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/$/, '');
  const allowed = new Set([...allowedUrls].map(norm));
  return markdown.replace(
    /\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g,
    (_m, text: string, url: string) => (allowed.has(norm(url)) ? `[${text}](${url})` : text),
  );
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

export { BRIEF_SCHEMA };

export function buildBriefPrompt(subject: string, language: string, groups: SourceGroup[]): string {
  return [
    'You write a concise intelligence dossier brief.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output Markdown prose in the "brief" field.`,
    'Write a tight "current situation" brief: what is the state of things, the significant facts, who/what/when.',
    'Cite each claim with its source publication tag(s) in square brackets, using the EXACT "## " publication headers listed under FACTS BY PUBLICATION below — e.g. "selon Le Figaro [lefigaro.fr]" or, when several back a point, "[lefigaro.fr, apnews.com]". Use ONLY those exact tags; never invent a tag or write a URL. Group related points; do not just list facts.',
    'Also return, for each publication host below, a one-sentence "summary" of what that source is / its angle.',
    'Be factual and concise. No preamble. Return JSON only: { brief, sources: [{host, summary}] }.',
    '',
    'FACTS BY PUBLICATION:',
    renderGroups(groups),
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

export async function composeDossier(
  dossierId: string,
  opts: { mode: 'brief'; language?: string; scope?: string[]; onProgress?: (p: SynthesisProgress) => void } = { mode: 'brief' },
): Promise<{ wrote: ComposeKind }> {
  const onProgress = opts.onProgress ?? (() => {});

  // lazy: ./db eagerly validates env at module load — keep this module's pure helpers test-loadable
  const { db } = await import('./db');

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return { wrote: 'none' };

  const language = opts.language ?? dossier.language ?? 'fr';

  // In brief mode: determine target documents (scope or all kept), ensure facts exist for each.
  if (opts.mode === 'brief') {
    let targetDocs: { id: string; url: string; title: string | null; content: string | null }[];
    if (opts.scope && opts.scope.length > 0) {
      targetDocs = await db
        .select({ id: documentsTable.id, url: documentsTable.url, title: documentsTable.title, content: documentsTable.content })
        .from(documentsTable)
        .where(and(eq(documentsTable.dossierId, dossierId), inArray(documentsTable.id, opts.scope)));
    } else {
      targetDocs = await db
        .select({ id: documentsTable.id, url: documentsTable.url, title: documentsTable.title, content: documentsTable.content })
        .from(documentsTable)
        .where(and(eq(documentsTable.dossierId, dossierId), eq(documentsTable.status, 'kept')));
    }

    // Idempotently ensure facts for each target document that has none yet.
    if (targetDocs.length > 0) {
      const { extractFactsForDocument } = await import('./documents');
      for (const doc of targetDocs) {
        await extractFactsForDocument(dossier, doc);
      }
    }

    const targetDocIds = new Set(targetDocs.map((d) => d.id));

    // Load all facts for the dossier, then filter to scope if set.
    const allRows = await db.select().from(factsTable).where(eq(factsTable.dossierId, dossierId));
    const scopedRows = opts.scope && opts.scope.length > 0
      ? allRows.filter((r) => r.documentId != null && targetDocIds.has(r.documentId))
      : allRows;

    const hasFacts = scopedRows.length > 0;
    const briefExists = !!dossier.brief;

    const kind = hasFacts ? 'brief' : 'none';

    if (kind === 'none') {
      onProgress({ type: 'synthesis', phase: briefExists ? 'update' : 'brief', state: 'skip' });
      return { wrote: 'none' };
    }

    const { setBrief } = await import('./dossiers');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const subject = [dossier.name, dossier.intent].filter(Boolean).join(' — ');

    onProgress({ type: 'synthesis', phase: 'brief', state: 'start' });
    const groups = groupFactsByHost(scopedRows.map(toFact));
    const res = await client.complete(buildBriefPrompt(subject, language, groups), { jsonSchema: BRIEF_SCHEMA });
    const { brief, sourceNotes } = parseBrief(res.text);
    const allowedUrls = new Set(scopedRows.map((r) => r.sourceUrl));
    const safeBrief = brief ? stripUnknownLinks(brief, allowedUrls) : brief;
    if (safeBrief) await setBrief(dossierId, safeBrief, sourceNotes);
    onProgress({ type: 'synthesis', phase: 'brief', state: 'done' });
    return { wrote: 'brief' };
  }

  // mode !== 'brief' — currently unreachable; brief is the only supported mode.
  return { wrote: 'none' };
}
