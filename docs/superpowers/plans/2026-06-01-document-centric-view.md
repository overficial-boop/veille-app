# Document-Centric View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each analyzed URL a first-class, browsable **document** with its own review / bullet summary / "aller plus loin" / facts (+ on-demand fact-checks), surfaced via a **Documents** tab beside **Synthèse** — mirroring the old Veille prototype.

**Architecture:** New `documents` table (one row per analyzed URL/dossier); `facts` gain `documentId`. Extraction surfaces cleaned content via a new additive `onContent` hint in `@veille/core`'s shared `runFactExtraction`. A new `apps/web/lib/document/` module ports the old prompts (review/resume/elaborate/fact-check) and generates blocks: auto (résumé court + review + bullets) during extraction, on-demand (elaborate + fact-checks) via JSON endpoints. The dossier page becomes two tabs; documents open at a dedicated fiche route. The old `BySource` evidence section is removed (its channel/host identity moves onto the document).

**Tech Stack:** Next.js 15 / React 19, Drizzle + Postgres, vitest, `@veille/core` (extraction), Gemini via `selectLlmClient`, Tavily client.

**Spec:** `docs/superpowers/specs/2026-06-01-document-centric-view-design.md`
**Old-app prompt source:** `D:\Projects\CODING\veille\apps\android\assets\prompts\{review,resume,elaborate-llm-only,elaborate-with-tavily,fact-check}.md`

---

## Setup

- [ ] **Branch:** `git checkout -b feat/document-centric` (from `main`). SSH tunnel up on :15432 for migrations. Dev server hot-reloads — never `next build` while it runs.

## Shared types (defined in Task 2, referenced everywhere)

```ts
// apps/web/lib/document/types.ts
export type TokenCost = { model: string; inputTokens: number; outputTokens: number };
export type BlockMeta = { model: string; promptHash: string; generatedAt: string; cost: TokenCost };
export type ReviewBlock = { markdown: string } & BlockMeta;
export type BulletsBlock = { markdown: string } & BlockMeta;
export type ElaborationResource = { name: string; kind?: 'book'|'paper'|'talk'|'person'|'other'; note?: string };
export type ElaborationLink = { url: string; title: string; siteName?: string; excerpt?: string };
export type ElaborationTopic = { name: string; summary: string; resources?: ElaborationResource[]; links?: ElaborationLink[] };
export type ElaborationBlock = { topics: ElaborationTopic[]; withTavily: boolean } & BlockMeta;
export type FactCheck = { factId: string; note: string };
export type FactChecksBlock = { checks: FactCheck[] } & BlockMeta;
export type DocKind = 'web' | 'youtube';
```

---

## File Structure

- `apps/web/lib/db/app-schema.ts` — add `documents` table + `facts.documentId` (modify).
- `apps/web/lib/document/types.ts` — shared types (create).
- `apps/web/lib/document/prompts.ts` — ported prompt builders + JSON schemas (create).
- `apps/web/lib/document/prompts.test.ts` — prompt/parse unit tests (create).
- `apps/web/lib/document/analyze.ts` — `analyzeDocument`/`elaborateDocument`/`factCheckDocument` + parsers (create).
- `apps/web/lib/documents.ts` — DB helpers (create).
- `packages/core/src/extract.ts` + `pipeline.ts` — add `onContent` hint (modify, additive).
- `apps/web/lib/refresh.ts` — capture content/summary, upsert document, auto-analyze, link facts (modify).
- `apps/web/app/api/dossiers/[slug]/documents/[docId]/elaborate/route.ts` (create).
- `apps/web/app/api/dossiers/[slug]/documents/[docId]/factcheck/route.ts` (create).
- `apps/web/components/documents-grid.tsx` (create) + `apps/web/components/dossier-tabs.tsx` (create).
- `apps/web/app/dossier/[slug]/d/[docId]/page.tsx` (create) + `apps/web/components/document-fiche.tsx` (create).
- `apps/web/app/dossier/[slug]/page.tsx` — tabs, drop `BySource` (modify).
- Backfill: one-off script (Task 8).

---

## Task 1: `documents` table + `facts.documentId` + migration

**Files:** Modify `apps/web/lib/db/app-schema.ts`; generate migration.

- [ ] **Step 1: Add the table + column.** In `app-schema.ts`, after `facts`, add:

```ts
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  siteName: text('site_name'),                 // host, or YouTube channel name
  kind: text('kind').notNull().default('web'), // 'web' | 'youtube'
  publishedAt: timestamp('published_at', { withTimezone: true }),
  shortSummary: text('short_summary'),
  review: jsonb('review'),                      // ReviewBlock | null
  bullets: jsonb('bullets'),                    // BulletsBlock | null
  elaboration: jsonb('elaboration'),            // ElaborationBlock | null
  factChecks: jsonb('fact_checks'),             // FactChecksBlock | null
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('documents_dossier_url_idx').on(t.dossierId, t.url)]);
```

And add to the `facts` table definition a nullable FK:

```ts
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
```

(Place it after `sourceId`. `set null` so deleting a document doesn't delete its facts.)

- [ ] **Step 2: Generate migration.** Run `pnpm --filter @veille/web db:generate`. Confirm the new `.sql` creates `documents`, the unique index, and `ALTER TABLE "facts" ADD COLUMN "document_id"`. (Drizzle may order the FK after both tables exist — verify no forward-reference error.)

- [ ] **Step 3: Apply.** Run `pnpm --filter @veille/web db:migrate` (tunnel up). Expect exit 0.

- [ ] **Step 4: Verify + typecheck.** Read the generated `.sql` to confirm the statements. Run `pnpm --filter @veille/web typecheck` (clean) and `pnpm test -- app-schema` (passes).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(db): documents table + facts.documentId"
```

---

## Task 2: Ported prompts + parsers (TDD)

**Files:** Create `apps/web/lib/document/types.ts` (the shared types block above), `apps/web/lib/document/prompts.ts`, `apps/web/lib/document/prompts.test.ts`.

Port faithfully from the old `.md` prompts (paths in the header). Keep their wording; change "YouTube video"/transcript framing to a neutral "document/content", drive language via a `lang` param, and emit JSON where the old prompt did.

- [ ] **Step 1: Write failing tests** (`prompts.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, buildResumePrompt, buildElaboratePrompt, buildFactCheckPrompt, parseElaboration } from './prompts';

describe('prompt builders', () => {
  it('review prompt: prose-only, in language, includes content + title', () => {
    const p = buildReviewPrompt({ content: 'CORPS', title: 'T', siteName: 'lemonde.fr', lang: 'fr' });
    expect(p).toMatch(/fr/); expect(p).toContain('CORPS'); expect(p).toContain('T');
    expect(p).toMatch(/prose/i); expect(p).toMatch(/pas de puces|no bullet|paragraph/i);
  });
  it('resume prompt: 3-7 bullets from the review', () => {
    const p = buildResumePrompt({ review: 'REVIEW', title: 'T', lang: 'fr' });
    expect(p).toContain('REVIEW'); expect(p).toMatch(/3.*7|3 à 7|3 to 7/);
  });
  it('elaborate prompt (llm-only): asks for 3-5 topics + resources as JSON', () => {
    const p = buildElaboratePrompt({ review: 'R', title: 'T', lang: 'fr', withTavily: false });
    expect(p).toMatch(/topics/); expect(p).toMatch(/resources/); expect(p).toMatch(/3.*5|3 à 5|3 to 5/);
  });
  it('factcheck prompt: background-knowledge-only, 1-3 sentences', () => {
    const p = buildFactCheckPrompt({ factText: 'CLAIM', title: 'T', lang: 'fr' });
    expect(p).toContain('CLAIM'); expect(p).toMatch(/background|independent|indépendant/i);
  });
});

describe('parseElaboration', () => {
  it('parses topics + resources, tolerates fences', () => {
    const raw = '```json\n{"topics":[{"name":"N","summary":"S","resources":[{"name":"R","kind":"book"}]}]}\n```';
    const r = parseElaboration(raw);
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0]).toMatchObject({ name: 'N', summary: 'S' });
    expect(r.topics[0].resources?.[0]).toMatchObject({ name: 'R', kind: 'book' });
  });
  it('returns empty topics on garbage', () => {
    expect(parseElaboration('not json').topics).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm test -- prompts` → `Cannot find module './prompts'`.

- [ ] **Step 3: Implement `prompts.ts`.** Read the five old `.md` files and port them. Structure (fill the prose from the source files, keep their constraints verbatim-in-spirit):

```ts
import { ELABORATE_SCHEMA } from './schemas'; // inline below if preferred
import type { ElaborationTopic } from './types';

const LANG = (lang: string) => `Write everything in: ${lang}.`;

export function buildReviewPrompt(a: { content: string; title: string; siteName?: string; lang: string }): string {
  // PORT of review.md — detailed reader's review, continuous PROSE (no bullets/headings),
  // length scales to content, no meta-praise, no "in this document…" filler.
  return [
    "You write a detailed reader's review of a document for someone who has not read/watched it,",
    'so engaging with the original becomes optional.',
    LANG(a.lang),
    'Write as continuous prose. Open with one or two orienting sentences, then move through the',
    "document's substance in order. Cover main ideas, claims, examples, tensions. Quote sparingly.",
    'Avoid: bullet lists, headings, tables, generic praise/criticism, filler openers.',
    'Length: scale to the source — short piece = 3-5 short paragraphs; long = 8-15. Density over length.',
    `Document: "${a.title}"${a.siteName ? ` — ${a.siteName}` : ''}`,
    'Content:',
    a.content,
    'Return only the review prose. No preamble, no title line, no markdown headings.',
  ].join('\n');
}

export function buildResumePrompt(a: { review: string; title: string; lang: string }): string {
  // PORT of resume.md
  return [
    'You distill a detailed review into the takeaways a reader should remember in a week.',
    LANG(a.lang),
    'Output 3 to 7 bullets. Each bullet one sentence (two only if needed). Lead with substance —',
    'the claim, the fact, the surprising connection. No filler verbs, no re-titling, no closing remark.',
    'If the review covers multiple independent threads, group bullets under a one-line bold label; else no labels.',
    `Document: "${a.title}"`,
    'Review to distill:',
    a.review,
    'Return only the bulleted markdown. No preamble.',
  ].join('\n');
}

export function buildElaboratePrompt(a: { review: string; title: string; lang: string; withTavily: boolean }): string {
  // PORT of elaborate-llm-only.md (and note: with-tavily variant adds the web results;
  // for v1 we keep the LLM-only resources shape; links are attached from Tavily results post-hoc).
  return [
    'You identify 3 to 5 distinct topics from a document review and, for each, name specific resources to explore further.',
    LANG(a.lang),
    'Return a JSON object exactly: {"topics":[{"name":"<short>","summary":"<1-2 sentences>",',
    '"resources":[{"name":"<specific real work/person>","kind":"book|paper|talk|person|other","note":"<optional>"}]}]}',
    'Resources must be specific named items you are confident exist; omit doubtful ones (2 solid beats 5 shaky).',
    `Document: "${a.title}"`,
    'Review:',
    a.review,
    'Return ONLY the JSON object. No preamble, no markdown fences.',
  ].join('\n');
}

export function buildFactCheckPrompt(a: { factText: string; title: string; lang: string }): string {
  // PORT of fact-check.md — external corroboration using background knowledge ONLY.
  return [
    'You assess a single factual claim using ONLY your background knowledge from sources OTHER than the one it came from.',
    'Do NOT verify against the original source. The task is external corroboration.',
    `Source context (to disambiguate only, NOT evidence): "${a.title}"`,
    'Claim to assess:',
    a.factText,
    `Write 1 to 3 sentences. ${LANG(a.lang)} Be direct: corroborated (name the kind of evidence) / contested / contradicts established facts / cannot verify independently.`,
    'Never say "the source confirms". No hedging filler. Return only the assessment text.',
  ].join('\n');
}

export function parseElaboration(text: string): { topics: ElaborationTopic[] } {
  let raw: unknown;
  try { raw = JSON.parse(text.trim()); }
  catch { const m = text.match(/\{[\s\S]*\}/); raw = m ? safeJson(m[0]) : null; }
  const topics = (raw as { topics?: unknown })?.topics;
  if (!Array.isArray(topics)) return { topics: [] };
  return { topics: topics.filter((t): t is ElaborationTopic => !!t && typeof (t as ElaborationTopic).name === 'string') };
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
```

The `ELABORATE_SCHEMA` (Gemini `responseSchema`) mirrors the JSON above — define it inline in `prompts.ts` and export it for `analyze.ts`.

- [ ] **Step 4: Run → pass.** `pnpm test -- prompts`. Typecheck clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/lib/document/types.ts apps/web/lib/document/prompts.ts apps/web/lib/document/prompts.test.ts
git commit -m "feat(web): ported per-document prompts (review/resume/elaborate/factcheck) + parsers"
```

---

## Task 3: Surface cleaned content from extraction (`onContent` hint)

**Files:** Modify `packages/core/src/extract.ts` (ExtractHints) + `packages/core/src/pipeline.ts` (fire it).

- [ ] **Step 1: Add the hint.** In `packages/core/src/extract.ts`, add to `ExtractHints`:

```ts
  /** Fired once with the joined cleaned source text (for downstream analysis). */
  onContent?: (content: string) => void;
```

- [ ] **Step 2: Fire it in the pipeline.** In `packages/core/src/pipeline.ts`, in `runFactExtraction`, after `const chunks = buildChunks(...)` (segments are available), assemble + emit the content once:

```ts
  const content = segments.map((s) => s.text).join('\n');
  hints?.onContent?.(content);
```

(Place near the top of the function, right after `segments` is in scope. All adapters route through `runFactExtraction`, so this surfaces content uniformly.)

- [ ] **Step 3: Build the packages + typecheck.** Run `pnpm -r --filter "./packages/*" build` then `pnpm --filter @veille/web typecheck`. Expect clean. (Do NOT `next build`.)

- [ ] **Step 4: Commit.**
```bash
git add packages/core/src/extract.ts packages/core/src/pipeline.ts
git commit -m "feat(core): add onContent hint surfacing cleaned source text (additive)"
```

---

## Task 4: `analyze.ts` (generation) + `documents.ts` (DB helpers)

**Files:** Create `apps/web/lib/document/analyze.ts`, `apps/web/lib/documents.ts`. Test: `apps/web/lib/document/analyze.test.ts` (pure parts only).

- [ ] **Step 1: DB helpers `documents.ts`** (mirror `dossiers.ts` style; eager `db` import is fine here — it's a server module):

```ts
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { documents, facts } from './db/schema';
import type { ReviewBlock, BulletsBlock, ElaborationBlock, FactChecksBlock, DocKind } from './document/types';

export async function upsertDocument(dossierId: string, m: { url: string; title?: string; siteName?: string; kind: DocKind; publishedAt?: Date | null }): Promise<string> {
  const [existing] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.dossierId, dossierId), eq(documents.url, m.url)));
  if (existing) {
    await db.update(documents).set({ title: m.title, siteName: m.siteName, kind: m.kind, publishedAt: m.publishedAt ?? null }).where(eq(documents.id, existing.id));
    return existing.id;
  }
  const id = uuidv7();
  await db.insert(documents).values({ id, dossierId, url: m.url, title: m.title, siteName: m.siteName, kind: m.kind, publishedAt: m.publishedAt ?? null });
  return id;
}

export async function setDocumentCore(id: string, core: { shortSummary: string; review: ReviewBlock; bullets: BulletsBlock }) {
  await db.update(documents).set(core).where(eq(documents.id, id));
}
export async function setElaboration(id: string, block: ElaborationBlock) { await db.update(documents).set({ elaboration: block }).where(eq(documents.id, id)); }
export async function setFactChecks(id: string, block: FactChecksBlock) { await db.update(documents).set({ factChecks: block }).where(eq(documents.id, id)); }

/** Link this dossier's facts for `url` to the document. */
export async function linkFacts(dossierId: string, documentId: string, url: string) {
  await db.update(facts).set({ documentId }).where(and(eq(facts.dossierId, dossierId), eq(facts.sourceUrl, url), isNull(facts.documentId)));
}

export async function listDocuments(dossierId: string) {
  return db.select().from(documents).where(eq(documents.dossierId, dossierId)).orderBy(documents.createdAt);
}
export async function getDocument(dossierId: string, id: string) {
  const [d] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.dossierId, dossierId)));
  return d ?? null;
}
export async function listFactsForDocument(documentId: string) {
  return db.select().from(facts).where(eq(facts.documentId, documentId));
}
```

- [ ] **Step 2: `analyze.ts`.** Pure-ish orchestration over `selectLlmClient`. Functions: `analyzeDocumentCore`, `elaborate`, `factCheck`. Use the prompt builders from Task 2. Each returns its block with `{model, promptHash, generatedAt, cost}` (compute `promptHash` via a small sha256 of the prompt string — reuse the project's hashing if present, else `crypto.createHash`).

```ts
import { createHash } from 'node:crypto';
import { selectLlmClient } from '@veille/core';
import { buildReviewPrompt, buildResumePrompt, buildElaboratePrompt, buildFactCheckPrompt, parseElaboration } from './prompts';
import type { ReviewBlock, BulletsBlock, ElaborationBlock, FactChecksBlock, TokenCost } from './types';

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const now = () => new Date().toISOString();
function client() { return selectLlmClient(process.env as Record<string, string | undefined>); }

export async function analyzeDocumentCore(a: { content: string; title: string; siteName?: string; lang: string }): Promise<{ shortSummary: string; review: ReviewBlock; bullets: BulletsBlock }> {
  const c = client();
  const reviewPrompt = buildReviewPrompt(a);
  const r = await c.complete(reviewPrompt, {});
  const reviewMd = r.text.trim();
  const reviewBlock: ReviewBlock = { markdown: reviewMd, model: r.model ?? 'gemini-2.5-flash', promptHash: hash(reviewPrompt), generatedAt: now(), cost: toCost(r) };
  const resumePrompt = buildResumePrompt({ review: reviewMd, title: a.title, lang: a.lang });
  const b = await c.complete(resumePrompt, {});
  const bulletsBlock: BulletsBlock = { markdown: b.text.trim(), model: b.model ?? 'gemini-2.5-flash', promptHash: hash(resumePrompt), generatedAt: now(), cost: toCost(b) };
  const shortSummary = firstSentences(reviewMd, 2);
  return { shortSummary, review: reviewBlock, bullets: bulletsBlock };
}
export async function elaborate(a: { review: string; title: string; lang: string; withTavily: boolean }): Promise<ElaborationBlock> {
  const c = client();
  const prompt = buildElaboratePrompt(a);
  const r = await c.complete(prompt, { jsonSchema: ELABORATE_SCHEMA }); // import ELABORATE_SCHEMA from './prompts'
  const { topics } = parseElaboration(r.text);
  // if a.withTavily: for each topic, query the existing Tavily client and attach `links` (url/title/siteName/excerpt).
  return { topics, withTavily: a.withTavily, model: r.model ?? 'gemini-2.5-flash', promptHash: hash(prompt), generatedAt: now(), cost: toCost(r) };
}

export async function factCheck(facts: { id: string; text: string }[], title: string, lang: string): Promise<FactChecksBlock> {
  const c = client();
  let model = 'gemini-2.5-flash', inputTokens = 0, outputTokens = 0;
  const checks = await mapWithConcurrency(facts, 4, async (f) => {  // import mapWithConcurrency from '@veille/core'
    const prompt = buildFactCheckPrompt({ factText: f.text, title, lang });
    const r = await c.complete(prompt, {});
    model = r.model ?? model; inputTokens += r.usage?.inputTokens ?? 0; outputTokens += r.usage?.outputTokens ?? 0;
    return { factId: f.id, note: r.text.trim() };
  });
  return { checks, model, promptHash: hash('factcheck-v1'), generatedAt: now(), cost: { model, inputTokens, outputTokens } };
}
```

(Verify `c.complete`'s return shape — `text`, `model`, `usage` — against `synthesis.ts`'s usage and adapt `toCost`/the `r.usage` reads to match it exactly. `mapWithConcurrency` is exported by `@veille/core` (`pipeline.ts`).)

`toCost(r)` adapts the LLM client's returned usage to `TokenCost`; `firstSentences(md, n)` is a tiny helper (split on `. `). Verify the exact `client.complete` return shape (text/model/usage) against `synthesis.ts`'s usage and match it. `shortSummary` falls back to the first ~2 sentences of the review (no extra call).

- [ ] **Step 3: Unit-test the pure helpers** (`analyze.test.ts`): `firstSentences`, and `parseElaboration` integration (already in Task 2). Don't unit-test the LLM calls (integration-level). Run `pnpm test -- analyze` → pass.

- [ ] **Step 4: Typecheck + commit.**
```bash
git add apps/web/lib/documents.ts apps/web/lib/document/analyze.ts apps/web/lib/document/analyze.test.ts
git commit -m "feat(web): document DB helpers + analyze module (review/bullets/elaborate/factcheck)"
```

---

## Task 5: Wire auto-generation into extraction (`refresh.ts`)

**Files:** Modify `apps/web/lib/refresh.ts`.

- [ ] **Step 1: Capture content + create document per extracted URL.** In the standing-source loop (and the item-source branch), for each URL: pass `onContent` to capture the cleaned text, then after extraction upsert the document, link facts, and auto-analyze. Concretely, replace the per-candidate extraction with:

```ts
let captured = '';
const top = topFactsPerUrl(
  await extract(c.url, { language: lang, withSummary: false, subjectHint, onContent: (t) => { captured = t; } }),
  MAX_FACTS_PER_URL,
);
const withDates = top.map((f) => backfillPublishedAt(f, c.publishedAt));
extracted = extracted.concat(withDates);
// document: identity from provenance (Q3 channel/host) + candidate date
const kind = /youtube\.com|youtu\.be/i.test(c.url) ? 'youtube' : 'web';
const prov0 = withDates[0]?.provenance as { channelName?: string; publishedAt?: string } | undefined;
const docId = await upsertDocument(dossierId, {
  url: c.url, kind,
  siteName: kind === 'youtube' ? prov0?.channelName : hostOf(c.url),
  publishedAt: prov0?.publishedAt ? new Date(prov0.publishedAt) : (c.publishedAt ? new Date(c.publishedAt) : null),
});
pendingDocs.push({ docId, url: c.url, content: captured, title: c.title ?? c.url, siteName: kind === 'youtube' ? prov0?.channelName : hostOf(c.url) });
```

(Collect `pendingDocs` during the loop; `hostOf` import from `./host`. `upsertDocument` from `./documents`.)

- [ ] **Step 2: After facts are inserted, link + analyze.** After the existing `insertFacts(...)` for the source, link each pending doc's facts and run core analysis (bounded concurrency):

```ts
for (const d of pendingDocs) {
  await linkFacts(dossierId, d.docId, d.url);
  if (d.content) {
    try {
      const core = await analyzeDocumentCore({ content: d.content, title: d.title, siteName: d.siteName, lang });
      await setDocumentCore(d.docId, core);
    } catch (e) { onProgress({ type: 'source-error', label: d.url, message: e instanceof Error ? e.message : String(e) }); }
  }
}
```

(Emit a progress frame per analyzed doc if desired. Keep `pendingDocs` scoped per source or per run consistently — define it before the source loop and clear per source, or collect across the run and process at the end. Match the existing structure; the simplest is to process each source's docs right after its `insertFacts`.)

- [ ] **Step 3: Typecheck.** `pnpm --filter @veille/web typecheck` (clean). The `RefreshProgress`/`StreamProgress` types are unchanged.

- [ ] **Step 4: Commit.**
```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): create + auto-analyze documents during extraction (review/bullets), link facts"
```

---

## Task 6: On-demand endpoints (elaborate + fact-check, JSON)

**Files:** Create `apps/web/app/api/dossiers/[slug]/documents/[docId]/elaborate/route.ts` and `.../factcheck/route.ts`.

- [ ] **Step 1: Elaborate route.** POST → generate + persist + return the block:

```ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, setElaboration } from '@/lib/documents';
import { elaborate } from '@/lib/document/analyze';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; docId: string }> }) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });
  const doc = await getDocument(dossier.id, docId);
  if (!doc || !doc.review) return new Response('no review', { status: 409 });
  const body = await req.json().catch(() => ({}));
  const block = await elaborate({ review: (doc.review as { markdown: string }).markdown, title: doc.title ?? doc.url, lang: dossier.language ?? 'fr', withTavily: !!body.withTavily });
  await setElaboration(docId, block);
  return Response.json(block);
}
```

- [ ] **Step 2: Fact-check route.** POST → load the doc's facts (`listFacts` filtered to `documentId`), run `factCheck`, persist, return:

```ts
// mirror the elaborate route; load facts for this document, call factCheck(facts, doc.title, lang),
// setFactChecks(docId, block), return Response.json(block).
```

(Add a `listFactsForDocument(documentId)` helper to `documents.ts` if not present: `select from facts where documentId = …`.)

- [ ] **Step 3: Typecheck + commit.**
```bash
git add "apps/web/app/api/dossiers/[slug]/documents"
git commit -m "feat(web): on-demand elaborate + factcheck endpoints (JSON)"
```

---

## Task 7: UI — Documents tab, grid, and fiche page

**Files:** Create `apps/web/components/dossier-tabs.tsx`, `apps/web/components/documents-grid.tsx`, `apps/web/components/document-fiche.tsx`, `apps/web/app/dossier/[slug]/d/[docId]/page.tsx`; modify `apps/web/app/dossier/[slug]/page.tsx`.

Follow existing patterns: server components for data + Ardoise classes (see `templates/by-source.tsx`, `brief.tsx`); a small client island for tabs + on-demand buttons. Reuse `pubHue`/`pubMono` (move them from `by-source.tsx` into a shared `lib/publication.ts` in Task 8, or duplicate minimally now).

- [ ] **Step 1: Tabs island** (`dossier-tabs.tsx`, client): renders two buttons (Synthèse | Documents), syncs `?tab=` via `useSearchParams`/`router.replace`, shows the active panel. Accepts `synthese` and `documents` as `ReactNode` children/slots.

- [ ] **Step 2: Documents grid** (`documents-grid.tsx`, server): takes `documents` rows + slug; renders a responsive grid of cards — monogram (channel/host), title, date (`factDate`-style), `shortSummary`, fact count, small badges for which blocks exist; each card is a `<Link href={`/dossier/${slug}/d/${doc.id}`}>`. Empty state: "Aucun document analysé."

- [ ] **Step 3: Fiche page** (`app/dossier/[slug]/d/[docId]/page.tsx`, server): auth + `getDossier` + `getDocument`; `notFound()` if missing; load its facts (`listFactsForDocument`). Renders `TopBar`, a back link to `/dossier/[slug]?tab=documents`, header (title, siteName, date, ↗ url), then `<DocumentFiche document={...} facts={...} slug={slug} />`.

- [ ] **Step 4: Fiche component** (`document-fiche.tsx`, client island): renders résumé court, review (markdown via `Prose`/`react-markdown`), bullets (markdown), elaboration (topics → resources/links) with a "Générer / ↻ (+ recherche web)" button calling the elaborate endpoint, and facts (each: text, verbatim `<details>`, confidence bars via `ConfBars`, a "Vérifier" button calling factcheck → shows the note). Buttons set a loading state, POST to the endpoints, then update local state with the returned block. Show each block's `model` + token cost in small mono text.

- [ ] **Step 5: Wire tabs into the dossier page.** In `app/dossier/[slug]/page.tsx`: load `documents` via `listDocuments(dossier.id)`; wrap the main column in `<DossierTabs>` with the existing Synthèse content (Brief + Journal, inside `CitationsProvider`) as the first slot and `<DocumentsGrid>` as the second. **Remove** the `<section className="evidence">…<BySource/></section>` block and the `BySource` import.

- [ ] **Step 6: Typecheck + visual check.** `pnpm --filter @veille/web typecheck`. Then a throwaway preview route rendering `DocumentsGrid` + `DocumentFiche` with mock data (like prior previews); screenshot; confirm; delete the preview + `rm -rf apps/web/.next/types/app/<preview>`.

- [ ] **Step 7: Commit.**
```bash
git add apps/web/components/dossier-tabs.tsx apps/web/components/documents-grid.tsx apps/web/components/document-fiche.tsx "apps/web/app/dossier/[slug]/d" "apps/web/app/dossier/[slug]/page.tsx"
git commit -m "feat(web): Documents tab + grid + fiche page; drop BySource evidence section"
```

---

## Task 8: Shared publication identity, backfill, gate + merge

**Files:** Create `apps/web/lib/publication.ts` (move `pubHue`/`pubMono`/host-vs-channel from `by-source.tsx`); delete `apps/web/components/templates/by-source.tsx`; one-off backfill script.

- [ ] **Step 1: Extract `publication.ts`.** Move `pubHue`, `pubMono`, and the host/channel identity helper into `apps/web/lib/publication.ts`; update `documents-grid.tsx`/`document-fiche.tsx` to import from it. Delete `templates/by-source.tsx` (and its `types.ts` `TemplateProps` if now unused — verify no other importer). Typecheck.

- [ ] **Step 2: Backfill the existing dossier.** Create `apps/web/_backfill-docs.cjs`, run `node apps/web/_backfill-docs.cjs` (tunnel up), verify the printed count, then `rm -f apps/web/_backfill-docs.cjs`. (`pg` + `uuid` resolve from `apps/web`; the env path is relative to the script.)

```js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { v7: uuidv7 } = require('uuid');
fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split(/\r?\n/).forEach((l) => {
  const m = l.match(/^DATABASE_URL=(.*)$/); if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
});
const c = new Client({ connectionString: process.env.DATABASE_URL });
(async () => {
  await c.connect();
  const { rows: [d] } = await c.query("select id from dossiers where slug='gabriel-attal'");
  const facts = (await c.query('select id, source_url, provenance from facts where dossier_id=$1', [d.id])).rows;
  const byUrl = new Map();
  for (const f of facts) { if (!byUrl.has(f.source_url)) byUrl.set(f.source_url, []); byUrl.get(f.source_url).push(f); }
  for (const [url, group] of byUrl) {
    const yt = /youtube\.com|youtu\.be/i.test(url);
    const prov = group[0].provenance || {};
    const site = yt ? (prov.channelName || 'youtube.com') : new URL(url).hostname.replace(/^www\./, '');
    await c.query(
      "insert into documents (id,dossier_id,url,kind,site_name,published_at) values ($1,$2,$3,$4,$5,$6) on conflict (dossier_id,url) do nothing",
      [uuidv7(), d.id, url, yt ? 'youtube' : 'web', site, prov.publishedAt || null],
    );
    const { rows: [doc] } = await c.query('select id from documents where dossier_id=$1 and url=$2', [d.id, url]);
    await c.query('update facts set document_id=$1 where dossier_id=$2 and source_url=$3 and document_id is null', [doc.id, d.id, url]);
  }
  console.log('backfilled', byUrl.size, 'documents from', facts.length, 'facts');
  await c.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
```

Leaves review/bullets null (generated on demand or on the next refresh).

- [ ] **Step 3: Full gate (dev stopped).** Stop the dev server (tree-kill the PID on :3000). Then:
```bash
rm -rf apps/web/.next
pnpm --filter @veille/web typecheck && pnpm test && pnpm --filter @veille/web build
```
Expect: typecheck clean, all tests pass, build compiles (new route `/dossier/[slug]/d/[docId]` listed).

- [ ] **Step 4: Restart dev + live check.** `rm -rf apps/web/.next && pnpm --filter @veille/web dev` (background). Sign in, open Attal → Documents tab → open a fiche → confirm review/bullets (post-refresh) or facts (backfilled), and that "Générer aller plus loin" + "Vérifier" work.

- [ ] **Step 5: Merge.**
```bash
git checkout main
git merge --no-ff feat/document-centric -m "Merge feat/document-centric: per-document view (review/bullets/aller plus loin/facts)"
git branch -d feat/document-centric
```

- [ ] **Step 6: Memory.** Note the document-centric view shipped in `presentation-q-series.md` + the index; note Spec B (refresh semantics) is the next piece.

---

## Notes / decisions baked in

- Content for review/resume comes from the new `onContent` hint (no double-fetch). YouTube transcripts are Supadata-cached anyway.
- `shortSummary` = first ~2 sentences of the review (no extra LLM call).
- On-demand endpoints are plain JSON (loading state in the fiche island), not SSE.
- Existing Attal facts are backfilled into documents (facts-only; review/bullets on demand or next refresh).
- Out of scope (→ Spec B): refresh semantics (old-missed → propose brief rebuild; recent → journal). The brief + two-stream journal are unchanged; they now live in the Synthèse tab.
