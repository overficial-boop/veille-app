# Curation Core (②) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert the pipeline to curation-first — pull discovers documents + scores relevance (no facts); facts/brief generate on demand; the dossier becomes one full-screen workspace.

**Architecture:** The pull fetches content-only + scores relevance → `documents.status` (kept/suggestion). Facts come from the stored content on demand (text-adapter path, sourceUrl patched). The brief is a button (extracts facts for selected docs, then composes). One unified full-width dossier page replaces the tabs.

**Tech Stack:** Next 15 App Router, Drizzle/Postgres, `@veille/core` (extract pipeline), Tavily/Gemini, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-curation-core-design.md`

**Resolved integration points:**
- Extract-from-stored-content → `extractInput({ kind: 'text', content, label }, { language, subjectHint })` (text adapter; then map each fact's `sourceUrl` to the document URL). No core change.
- Content-only fetch → add `contentOnly?: boolean` to `ExtractHints` (`packages/core/src/extract.ts`) and an early return in `runFactExtraction` (`packages/core/src/pipeline.ts`, right after the `onContent` call) that returns an empty result without running the per-chunk LLM calls.

---

## Setup
- [ ] `git checkout -b feat/curation-core` (from `main`). Tunnel up. Dev hot-reloads — never `next build` while it runs. **Read current** `apps/web/lib/refresh.ts`, `app/api/dossiers/[slug]/assemble/route.ts`, `app/dossier/[slug]/page.tsx`, `components/dossier-runtime.tsx`, `components/document-fiche.tsx` before editing them.

## File Structure
- Modify `apps/web/lib/db/app-schema.ts` (+ migration) — document status/relevance, dossier autoBrief.
- Modify `apps/web/lib/refresh-config.ts` (+ test) — relevance knobs.
- Modify `packages/core/src/{extract.ts,pipeline.ts}` — `contentOnly` hint.
- Create `apps/web/lib/relevance.ts` (+ test) — relevance scoring.
- Modify `apps/web/lib/refresh.ts` — pull-curate `processCandidate`.
- Create `apps/web/app/api/dossiers/[slug]/documents/[docId]/facts/route.ts` — on-demand facts.
- Modify `apps/web/components/document-fiche.tsx` + its page — auto-extract facts on open.
- Create `apps/web/lib/synthesis.ts` scope param + `generateBriefAction`; modify the new-dossier form + assemble route — brief button + autoBrief.
- Rebuild `apps/web/app/dossier/[slug]/page.tsx` + curation components — unified page.

---

## Task 1: Schema + config knobs

**Files:** `apps/web/lib/db/app-schema.ts`, `apps/web/lib/refresh-config.ts` (+ `.test.ts`), `apps/web/drizzle/*` (generated).

- [ ] **Step 1: Add columns.** In `app-schema.ts`, `documents` table — add after `content`:
```ts
  status: text('status').notNull().default('kept'),       // 'kept' | 'suggestion' | 'rejected'
  relevance: real('relevance'),                            // 0..1 vs the dossier intent (null if unscored)
  relevanceReason: text('relevance_reason'),
```
In `dossiers` table — add after `briefSuggestionDismissedAt`:
```ts
  autoBrief: boolean('auto_brief').notNull().default(false),
```
Ensure `boolean` + `real` are imported from `drizzle-orm/pg-core` at the top (real already is; add `boolean` if missing).

In `facts` table — **make `source_id` nullable.** On-demand facts now come from documents, not standing sources, so `insertFacts` will pass `null`. Change `sourceId: uuid('source_id').notNull().references(() => sources.id, …)` → drop the `.notNull()` (keep the `.references`). Then in `apps/web/lib/dossiers.ts`, change `insertFacts(dossierId: string, sourceId: string, newFacts: Fact[])` → `sourceId: string | null`, and ensure `factToRow(f, dossierId, sourceId)` writes `sourceId` (null is fine now). (The pull no longer calls `insertFacts`; only the on-demand paths do, always with `null`.)

- [ ] **Step 2: Generate + apply migration.** `pnpm --filter @veille/web db:generate` → creates `0009_*.sql` (should be 4 `ADD COLUMN`s). Verify it's only additive, then `pnpm --filter @veille/web db:migrate`. The `NOT NULL DEFAULT` columns backfill existing rows automatically (`status='kept'`, `auto_brief=false`); `relevance`/`relevance_reason` stay null on existing rows.

- [ ] **Step 3: Config knobs (TDD).** In `refresh-config.test.ts`, extend the defaults assertion + add an override case:
```ts
expect(resolveRefreshConfig({}).relevanceKeepFloor).toBe(0.5);
expect(resolveRefreshConfig({}).relevanceContentBudget).toBe(6000);
expect(resolveRefreshConfig({ VEILLE_RELEVANCE_KEEP_FLOOR: '0.7' }).relevanceKeepFloor).toBe(0.7);
```
In `refresh-config.ts`: add `relevanceKeepFloor: number` and `relevanceContentBudget: number` to `RefreshConfig` + `DEFAULTS` (`0.5`, `6000`), and in `resolveRefreshConfig`: `relevanceKeepFloor: num(env.VEILLE_RELEVANCE_KEEP_FLOOR, DEFAULTS.relevanceKeepFloor)`, `relevanceContentBudget: num(env.VEILLE_RELEVANCE_CONTENT_BUDGET, DEFAULTS.relevanceContentBudget)`. Run `pnpm test -- refresh-config` → PASS.

- [ ] **Step 4: Typecheck + commit.** `pnpm --filter @veille/web typecheck` clean.
```bash
git add apps/web/lib/db/app-schema.ts apps/web/lib/refresh-config.ts apps/web/lib/refresh-config.test.ts apps/web/drizzle
git commit -m "feat(web): documents.status/relevance + dossiers.autoBrief + relevance config knobs"
```

---

## Task 2: `contentOnly` fetch in `@veille/core`

**Files:** `packages/core/src/extract.ts`, `packages/core/src/pipeline.ts`.

- [ ] **Step 1: Add the hint.** In `extract.ts`, add to `ExtractHints` (after `withSummary?`):
```ts
  /** Fetch + clean the source, fire onContent, and return NO facts (skip the extraction LLM calls). */
  contentOnly?: boolean;
```

- [ ] **Step 2: Early return in the pipeline.** In `pipeline.ts`, read `runFactExtraction` + the `RunFactExtractionResult` type. Immediately AFTER the existing `hints?.onContent?.(...)` line (~102), add:
```ts
  if (hints?.contentOnly) {
    // RunFactExtractionResult is { facts: Fact[]; summary: string; cost: { model; inputTokens; outputTokens } }
    return { facts: [], summary: '', cost: { model: 'content-only', inputTokens: 0, outputTokens: 0 } };
  }
```
The adapter has already fetched + built `segments` before this point, so `onContent` fires the real text and we skip the per-chunk model calls. (Confirmed shape from `pipeline.ts`'s `RunFactExtractionResult`.)

- [ ] **Step 3: Build + sanity test.** `pnpm -r --filter "./packages/*" build` (Windows: double-quote the glob). Then a quick vitest sanity (optional) or rely on Task 4's live use. Confirm `pnpm test` still green.

- [ ] **Step 4: Commit.**
```bash
git add packages/core/src/extract.ts packages/core/src/pipeline.ts
git commit -m "feat(core): contentOnly hint — fetch + onContent without fact extraction"
```

---

## Task 3: Relevance scoring — `apps/web/lib/relevance.ts` (TDD)

**Files:** Create `apps/web/lib/relevance.ts`, `apps/web/lib/relevance.test.ts`.

- [ ] **Step 1: Failing test** (`relevance.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { parseRelevance, buildRelevancePrompt } from './relevance';

describe('parseRelevance', () => {
  it('parses score + reason', () => {
    expect(parseRelevance('{"score":0.8,"reason":"traite directement le sujet"}')).toEqual({ score: 0.8, reason: 'traite directement le sujet' });
  });
  it('clamps score to [0,1] and tolerates fences', () => {
    expect(parseRelevance('```json\n{"score":1.7,"reason":"x"}\n```').score).toBe(1);
    expect(parseRelevance('{"score":-2,"reason":"x"}').score).toBe(0);
  });
  it('falls back to score 0 + empty reason on garbage', () => {
    expect(parseRelevance('not json')).toEqual({ score: 0, reason: '' });
  });
});
describe('buildRelevancePrompt', () => {
  it('includes the intent and the content', () => {
    const p = buildRelevancePrompt({ title: 'T', content: 'CORPUS', intent: 'suivre X', language: 'fr' });
    expect(p).toContain('suivre X');
    expect(p).toContain('CORPUS');
  });
});
```
Run `pnpm test -- relevance` → FAIL.

- [ ] **Step 2: Implement** `relevance.ts`:
```ts
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
```
Run `pnpm test -- relevance` → PASS; `pnpm --filter @veille/web typecheck` clean.

- [ ] **Step 3: Commit.**
```bash
git add apps/web/lib/relevance.ts apps/web/lib/relevance.test.ts
git commit -m "feat(web): relevance scoring (content vs intent)"
```

---

## Task 4: Pull-curate `processCandidate`

**Files:** Modify `apps/web/lib/refresh.ts`.

Read the current `refreshDossier` + `processCandidate` (the watcher fix). The pull no longer extracts facts; it fetches content-only, scores relevance, and upserts a document with a status.

- [ ] **Step 1: Rework `processCandidate`.** Replace its body so it (a) fetches content-only, (b) scores relevance, (c) upserts the document with `relevance`/`relevanceReason`/`status`, (d) returns whether it was kept (for progress). Target shape (adapt to the real signatures around it):
```ts
import { scoreRelevance } from './relevance';
// ...
  async function processCandidate(sourceId: string, url: string, candPublishedAt: string | undefined, candTitle: string | undefined): Promise<'kept' | 'suggestion'> {
    let captured = '';
    // content-only: fetch + clean, no fact LLM calls
    await extract(url, { language: lang, contentOnly: true, onContent: (t) => { captured = t; } });
    const intent = subjectHint || (dossier?.intent ?? '');
    const rel = captured
      ? await scoreRelevance({ title: candTitle ?? url, content: captured, intent, language: lang, contentBudget: cfg.relevanceContentBudget })
      : { score: 0, reason: 'contenu indisponible' };
    const status: 'kept' | 'suggestion' = rel.score >= cfg.relevanceKeepFloor ? 'kept' : 'suggestion';
    const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
    const siteName = yt ? 'youtube.com' : hostOf(url);
    const publishedAt = candPublishedAt ? new Date(candPublishedAt) : null;
    await upsertDocument(dossierId, {
      url, title: candTitle ?? url, siteName, kind: yt ? 'youtube' : 'web',
      publishedAt, content: captured, status, relevance: rel.score, relevanceReason: rel.reason,
    });
    return status;
  }
```
Update `upsertDocument` (in `documents.ts`) to accept + persist `status`/`relevance`/`relevanceReason` (extend `m`, set them on insert + update). Note: the YouTube `channelName`/`publishedAt` enrichment that previously came from extracted facts' provenance is gone (no facts now) — siteName falls back to `youtube.com`; that's acceptable for ② (channel naming can be revisited).

- [ ] **Step 2: Update the source loop.** In the standing + item branches, `processCandidate` now returns a status, not a fact count. Replace the per-candidate fact counting/emitting: track `srcKept`/`srcSuggested`; after each candidate emit a progress frame (see Task 4 Step 3). Remove the `total`/`added` fact tallies tied to fact insertion; instead count documents. Keep `freshCandidates`/dedup, the score-floor, recency filter (refresh), `lastExtractedAt` update.

- [ ] **Step 3: Progress frames.** Change the `RefreshProgress` `facts` frame usage to a document frame. Add to the union in `refresh.ts`:
```ts
  | { type: 'document'; sourceLabel: string; title: string; status: 'kept' | 'suggestion'; kept: number; total: number }
```
Emit one per candidate with running `kept`/`total` counts; keep `source-start`/`source-error`/`done`. (The runtime island, Task 7, renders these; until then it will ignore unknown frames harmlessly.)

- [ ] **Step 4: Typecheck + commit.** `pnpm --filter @veille/web typecheck` clean (the routes/UI referencing the old `facts` frame may need a transitional tweak — if the SSE routes pass `total`/`added`, keep returning a `{ kept, total }` shape from `refreshDossier`). Run `pnpm test`.
```bash
git add apps/web/lib/refresh.ts apps/web/lib/documents.ts
git commit -m "feat(web): pull-curate — content-only fetch + relevance + status (no facts)"
```

---

## Task 5: On-demand facts endpoint + fiche wiring

**Files:** Create `apps/web/app/api/dossiers/[slug]/documents/[docId]/facts/route.ts`; modify `apps/web/components/document-fiche.tsx` + `app/dossier/[slug]/d/[docId]/page.tsx`.

- [ ] **Step 1: Shared helper** in `apps/web/lib/documents.ts` (used by both the endpoint and the brief action — DRY). `linkFacts` + `listFactsForDocument` already live here; lazily import `insertFacts` from `dossiers.ts` to avoid a documents↔dossiers circular import (synthesis.ts uses the same `await import('./dossiers')` trick):
```ts
import { extractInput } from '@veille/core';
import { registerAllAdapters } from './adapters';

/** Idempotently extract facts from a document's STORED content (no re-fetch), attribute them to
 *  the document's URL, insert + link them. Returns the fact count. */
export async function extractFactsForDocument(
  dossier: { id: string; name: string; intent: string; language: string | null },
  doc: { id: string; url: string; title: string | null; content: string | null },
): Promise<number> {
  const existing = await listFactsForDocument(doc.id);
  if (existing.length > 0) return existing.length;
  if (!doc.content) return 0;
  registerAllAdapters();
  const raw = await extractInput(
    { kind: 'text', content: doc.content, label: doc.title ?? doc.url },
    { language: dossier.language ?? 'fr', subjectHint: [dossier.name, dossier.intent].filter(Boolean).join(' — ') },
  );
  const facts = raw.map((f) => ({ ...f, sourceUrl: doc.url })); // text adapter doesn't know the URL
  const { insertFacts } = await import('./dossiers');           // lazy → avoid circular import
  await insertFacts(dossier.id, null, facts);                   // source_id nullable now (Task 1)
  await linkFacts(dossier.id, doc.id, doc.url);
  return facts.length;
}
```

- [ ] **Step 2: Endpoint** (slim — mirror the `analyze` route, delegates to the helper):
```ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, extractFactsForDocument } from '@/lib/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string; docId: string }> }) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });
  const doc = await getDocument(dossier.id, docId);
  if (!doc) return new Response('not found', { status: 404 });
  if (!doc.content) return new Response('no stored content', { status: 409 });
  const count = await extractFactsForDocument(dossier, doc);
  return Response.json({ count });
}
```

- [ ] **Step 3: Fiche auto-extract.** In `document-fiche.tsx`, mirror the on-demand review pattern: add `facts` state seeded from props; if `canAnalyze` (content present) and `facts.length === 0` and not triggered, POST to `…/documents/${doc.id}/facts` on mount, show "Extraction des faits…" in the Faits section, then `router.refresh()` (or refetch) so the facts render. (The page already passes `facts` + `canAnalyze`.)

- [ ] **Step 4: Typecheck + commit.** Clean.
```bash
git add apps/web/lib/documents.ts "apps/web/app/api/dossiers/[slug]/documents/[docId]/facts/route.ts" apps/web/components/document-fiche.tsx "apps/web/app/dossier/[slug]/d/[docId]/page.tsx"
git commit -m "feat(web): on-demand fact extraction from stored content (per document)"
```

---

## Task 6: Brief button + autoBrief

**Files:** `apps/web/lib/synthesis.ts`, `apps/web/app/dossier/[slug]/actions.ts`, `apps/web/components/new-dossier-form.tsx`, `apps/web/app/api/dossiers/route.ts`, `apps/web/app/api/dossiers/[slug]/assemble/route.ts`.

- [ ] **Step 1: Brief scope + ensure facts.** In `synthesis.ts` `composeDossier`, add an optional `scope?: string[]` (document ids) to the options; when present, build the brief only from facts whose `documentId` is in scope (filter `allRows`). When absent, behave as today (all facts). Before composing in `mode:'brief'`, **ensure facts exist** for the target kept documents: load them and call `extractFactsForDocument(dossier, doc)` (the helper created in Task 5, lazily imported to avoid the circular dep) for each that has none. So "Générer le brief" works even on documents never opened.

- [ ] **Step 2: `generateBriefAction`.** In `actions.ts`:
```ts
export async function generateBriefAction(slug: string, scope?: string[]) {
  'use server';
  const session = await getSession(); if (!session) return;
  const dossier = await getDossier(session.user.id, slug); if (!dossier) return;
  // ensure facts exist for in-scope (or all kept) docs, then compose
  await composeDossier(dossier.id, { mode: 'brief', scope });
  revalidatePath(`/dossier/${slug}`);
}
```
(Mirror `regenerateBriefAction`'s session/revalidate pattern; the fact-ensuring lives in composeDossier per Step 1.)

- [ ] **Step 3: autoBrief toggle.** In `new-dossier-form.tsx`, add a checkbox "Générer un brief automatiquement" (default unchecked) and POST its value to `/api/dossiers`. In `api/dossiers/route.ts`, accept `autoBrief` and pass it to `createDossier` (extend `createDossier` + the insert to set `dossiers.autoBrief`).

- [ ] **Step 4: autoBrief hook.** In `assemble/route.ts`, after `refreshDossier(... phase:'assemble')` completes (and after the existing synthesis, if any), read the dossier's `autoBrief`; if true, run `composeDossier(dossier.id, { mode: 'brief' })` and stream a synthesis frame. (Read the route to place it correctly; the current route may already call composeDossier — gate that call on `autoBrief` now that the brief is optional.)

- [ ] **Step 5: Typecheck + commit.** Clean; `pnpm test`.
```bash
git add apps/web/lib/synthesis.ts apps/web/app/dossier apps/web/components/new-dossier-form.tsx apps/web/app/api/dossiers
git commit -m "feat(web): on-demand brief (scope) + autoBrief creation toggle"
```

---

## Task 7: Unified full-screen dossier page

**Files:** `apps/web/app/dossier/[slug]/page.tsx`, `apps/web/components/dossier-runtime.tsx`, new `apps/web/components/curation.tsx` (kept feed + suggestions), `apps/web/lib/dossiers.ts` (status queries), `apps/web/app/dossier/[slug]/actions.ts` (`setDocumentStatus`), `apps/web/app/globals.css`.

Read the current tabbed page first. This task is the largest; keep changes additive where possible.

- [ ] **Step 1: Status helpers + action.** In `documents.ts`: `listDocumentsByStatus(dossierId)` returning `{ kept: Doc[], suggestions: Doc[] }` (exclude `rejected`). In `actions.ts`: `setDocumentStatus(slug, docId, status)` (`'use server'`, owner-checked, revalidatePath).

- [ ] **Step 2: Curation components.** Create `curation.tsx`: a `KeptFeed` (cards: titre · source · date · relevance indicator (score + reason tooltip) · reject button → `setDocumentStatus(...,'rejected')`) and a `SuggestionsTray` (collapsible; each suggestion: promote → `'kept'`, dismiss → `'rejected'`). Use existing `.doc-grid`/card styles; add minimal CSS for the relevance indicator + tray.

- [ ] **Step 3: Rebuild the page.** Replace the tabbed layout with one full-width page: `<Brief>` (or a "Générer le brief" CTA calling `generateBriefAction`) on top; `<KeptFeed>`; `<SuggestionsTray>`; the journal (new documents since last refresh — reuse/repoint the existing `Journal` to render new kept docs, or a simple dated list); the rail (`DossierRuntime` — sources + progress + Rafraîchir + Générer le brief). Remove the tab switch. Keep `CitationsProvider` around the brief.

- [ ] **Step 4: Runtime island.** Update `dossier-runtime.tsx` to handle the `document` progress frame (Task 4 Step 3) — show documents appearing with their relevance/status during a pull — and add a "Générer le brief" button wired to `generateBriefAction`.

- [ ] **Step 5: Typecheck + commit.** Clean; visual check (preview or user).
```bash
git add apps/web/app apps/web/components apps/web/lib/dossiers.ts apps/web/app/globals.css
git commit -m "feat(web): unified full-screen dossier workspace (kept feed + suggestions + brief CTA)"
```

---

## Task 8: Gate + migrate + merge

- [ ] **Step 1: Stop dev** — tree-kill :3000.
- [ ] **Step 2: Gate.** `rm -rf apps/web/.next && pnpm --filter @veille/web typecheck && pnpm test && pnpm --filter @veille/web build` → all green. (Migration already applied to `veille_dev` in Task 1.)
- [ ] **Step 3: Restart dev** (`rm -rf apps/web/.next && pnpm --filter @veille/web dev`, background).
- [ ] **Step 4: Live check.** New dossier → documents stream in with relevance; kept vs suggestions split; promote/reject works; open a fiche → facts + review generate on demand; "Générer le brief" → cited brief; autoBrief on → brief after first pull.
- [ ] **Step 5: Merge.** `git checkout main && git merge --no-ff feat/curation-core && git branch -d feat/curation-core`.
- [ ] **Step 6: Memory.** Update `curation-reframe-design.md` — ② shipped; ③/④ remain.

---

## Notes
- ② intentionally drops the watcher fix's per-candidate **fact** streaming (facts are on-demand now) but KEEPS content storage. The journal's fact-based prose note is gone; the journal lists new kept documents.
- The Fact schema/extraction is unchanged — facts are extracted the same way, just from stored text on demand (sourceUrl patched to the document).
- ③ (state/watch search + mode recherche) and ④ (optional journal note) are separate.
