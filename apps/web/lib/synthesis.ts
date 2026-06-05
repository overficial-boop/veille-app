import type { Fact } from '@veille/core';
import { eq, and, inArray } from 'drizzle-orm';
import { dossiers, facts as factsTable, documents as documentsTable } from './db/schema';
import { selectLlmClient, mapWithConcurrency } from '@veille/core';
import { hostOf } from './host';
import type { BriefRef } from './citations';
export type { BriefRef };

// How many kept documents to enrich (core + facts) at once during brief generation. Each doc is a
// few sequential LLM calls; documents are independent, so a small pool slashes wall-clock without
// hammering the LLM provider's rate limits. Override with BRIEF_DOC_CONCURRENCY.
const BRIEF_DOC_CONCURRENCY = Math.max(1, Number(process.env.BRIEF_DOC_CONCURRENCY) || 5);

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

// --- Article-level citations -------------------------------------------------
// The brief cites SPECIFIC articles by number ([1], [2, 5]) rather than whole publications.
// A numbered reference list (BriefRef[]) is built server-side, embedded in the prompt, and
// persisted, so each superscript maps to the exact source article (provenance).

export type ArticleGroup = { url: string; facts: Fact[] };

/** Group facts by source article (URL), preserving first-appearance order. */
export function groupFactsByArticle(facts: Fact[]): ArticleGroup[] {
  const map = new Map<string, Fact[]>();
  for (const f of facts) {
    const arr = map.get(f.sourceUrl); if (arr) arr.push(f); else map.set(f.sourceUrl, [f]);
  }
  return [...map.entries()].map(([url, facts]) => ({ url, facts }));
}

/** Number the article groups (1..N), attaching the document's id/title when known. */
export function buildBriefRefs(
  groups: ArticleGroup[],
  meta: Map<string, { docId: string | null; title: string | null }>,
): BriefRef[] {
  return groups.map((g, i) => {
    const m = meta.get(g.url);
    const host = hostOf(g.url);
    return { n: i + 1, url: g.url, docId: m?.docId ?? null, title: (m?.title ?? '').trim() || host, host };
  });
}

/** Serialize numbered article groups for the prompt: `## [n] <title> — <host>` + bare facts. */
export function renderArticleGroups(groups: ArticleGroup[], refs: BriefRef[]): string {
  return groups.map((g, i) => {
    const r = refs[i]!;
    return `## [${r.n}] ${r.title} — ${r.host}\n` + g.facts.map((f) => `- ${f.text}`).join('\n');
  }).join('\n\n');
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

export function buildBriefPrompt(subject: string, language: string, groups: ArticleGroup[], refs: BriefRef[]): string {
  return [
    'You write an intelligence dossier brief — clear, well-structured editorial prose.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output GitHub-flavored Markdown in the "brief" field.`,
    'STRUCTURE: open with a lead paragraph stating the current situation, then write 2 to 5 short thematic paragraphs (each a distinct angle — what happened, the reactions, the context, what comes next). Separate EVERY paragraph with a blank line. Write flowing prose in full sentences; do NOT use bullet lists or headings.',
    'CITATIONS: cite each claim with the bracketed NUMBER(S) of the source article(s) shown in the "## [n]" headers under FACTS BY ARTICLE — e.g. "selon Le Figaro [2]" or, when several articles back a point, "[2, 5]". Use ONLY those exact numbers; never invent a number, write a URL, or put a publication name in brackets.',
    'Also return, for each article below, a one-sentence "summary" of what that publication is / its angle, keyed by its host.',
    'Be factual and concrete. No preamble, no title. Return JSON only: { brief, sources: [{host, summary}] }.',
    '',
    'FACTS BY ARTICLE:',
    renderArticleGroups(groups, refs),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type SynthesisProgress =
  | { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' }
  | { type: 'brief-doc'; index: number; total: number; title: string }
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
    let targetDocs: { id: string; url: string; title: string | null; content: string | null; siteName: string | null; review: unknown }[];
    if (opts.scope && opts.scope.length > 0) {
      targetDocs = await db
        .select({ id: documentsTable.id, url: documentsTable.url, title: documentsTable.title, content: documentsTable.content, siteName: documentsTable.siteName, review: documentsTable.review })
        .from(documentsTable)
        .where(and(eq(documentsTable.dossierId, dossierId), inArray(documentsTable.id, opts.scope)));
    } else {
      targetDocs = await db
        .select({ id: documentsTable.id, url: documentsTable.url, title: documentsTable.title, content: documentsTable.content, siteName: documentsTable.siteName, review: documentsTable.review })
        .from(documentsTable)
        .where(and(eq(documentsTable.dossierId, dossierId), eq(documentsTable.status, 'kept')));
    }

    // Idempotently ensure core + facts for each target document. Run several documents at once:
    // each doc is 2–3 sequential LLM calls, but documents are independent, so a concurrency pool
    // turns the old N×(serial) wall-clock into ~N/limit. Counter is bumped on completion so the
    // "Analyse i/N" progress still climbs monotonically despite out-of-order finishes.
    if (targetDocs.length > 0) {
      const { extractFactsForDocument, ensureDocumentCore } = await import('./documents');
      let done = 0;
      await mapWithConcurrency(targetDocs, BRIEF_DOC_CONCURRENCY, async (doc) => {
        await ensureDocumentCore({ id: dossier.id, language: dossier.language ?? null }, doc);
        await extractFactsForDocument(dossier, doc);
        done += 1;
        onProgress({ type: 'brief-doc', index: done, total: targetDocs.length, title: doc.title ?? doc.url });
      });
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
    const articleGroups = groupFactsByArticle(scopedRows.map(toFact));
    const metaMap = new Map(targetDocs.map((d) => [d.url, { docId: d.id, title: d.title }]));
    const refs = buildBriefRefs(articleGroups, metaMap);
    const res = await client.complete(buildBriefPrompt(subject, language, articleGroups, refs), { jsonSchema: BRIEF_SCHEMA });
    const { brief, sourceNotes } = parseBrief(res.text);
    const allowedUrls = new Set(scopedRows.map((r) => r.sourceUrl));
    const safeBrief = brief ? stripUnknownLinks(brief, allowedUrls) : brief;
    if (safeBrief) await setBrief(dossierId, safeBrief, sourceNotes, refs);
    onProgress({ type: 'synthesis', phase: 'brief', state: 'done' });
    return { wrote: 'brief' };
  }

  // mode !== 'brief' — currently unreachable; brief is the only supported mode.
  return { wrote: 'none' };
}
