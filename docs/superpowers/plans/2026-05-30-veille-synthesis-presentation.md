# Veille — Synthesis Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn a dossier's facts into a living written dossier — a source-attributed "current situation" brief + a dated "what's new" update log — with the facts demoted to cited evidence grouped by source.

**Architecture:** A new `apps/web/lib/synthesis.ts` (`composeDossier`) generates prose from the dossier's facts via the existing `selectLlmClient`, writing into new Postgres columns/table. It's woven into the SSE assemble/refresh loop (refresh gathers facts → compose writes brief/update), streamed. The dossier page becomes prose-first; facts move into a collapsible "by source" evidence zone rendered with the existing templates.

**Tech Stack:** TypeScript (ESM, strict), Next 15 App Router (server components + server actions + SSE `ReadableStream`), Drizzle + pg, `@veille/core` (`selectLlmClient`, `Fact`), vitest, `react-markdown` (new).

**Spec:** `docs/superpowers/specs/2026-05-30-veille-synthesis-presentation-design.md` (§ references below).

---

## ⚠️ Refinement vs the spec — confirm before/at Task 1 (flagged for the morning review)

The spec §4 stored a one-line blurb on `sources.summary` (per **sources-table row** = a Tavily query). While planning, a better model emerged: a fact's meaningful "source" is its **publication** (`fact.sourceUrl` host: `lemonde.fr`, `rtl.fr`), not the query that found it. So this plan:
- **Groups evidence by publication host** (`fact.sourceUrl` → host), not by the sources-table row. A reader sees "Le Monde said X, Y" — the intent of "group facts by their source."
- Stores the per-publication blurbs in **`dossiers.source_notes` (jsonb map: host → one-line blurb)** instead of `sources.summary`.

Everything else matches the spec. If you'd rather keep per-query grouping, say so and Task 1/2/7 adjust. The rest of the plan assumes group-by-host.

---

## File structure

```
apps/web/lib/db/app-schema.ts      MODIFY — dossiers.brief, brief_generated_at, source_notes (jsonb); new dossier_updates table
apps/web/drizzle/                  CREATE — migration 0004
apps/web/lib/dossiers.ts           MODIFY — listUpdates, setBrief, addUpdate
apps/web/lib/synthesis.ts          CREATE — pure helpers + composeDossier (the only place prose is generated)
apps/web/lib/synthesis.test.ts     CREATE — unit tests for the pure helpers
apps/web/lib/refresh.ts            MODIFY — return { total, added }; add 'synthesis' RefreshProgress variant
apps/web/app/api/dossiers/[slug]/assemble/route.ts  MODIFY — refresh → compose, stream both
apps/web/app/api/dossiers/[slug]/refresh/route.ts   MODIFY — same
apps/web/app/dossier/[slug]/actions.ts              MODIFY — regenerateBriefAction
apps/web/components/prose.tsx                        CREATE — react-markdown safe-subset wrapper
apps/web/components/templates/by-source.tsx          CREATE — evidence grouped by publication host
apps/web/app/dossier/[slug]/page.tsx                 MODIFY — prose-first layout (brief + updates + evidence)
apps/web/components/dossier-runtime.tsx              MODIFY — "Réécrire la synthèse" + synthesis progress phase
apps/web/package.json                                MODIFY — add react-markdown
```

---

## Task 1: Schema + migration + store helpers

**Files:** Modify `apps/web/lib/db/app-schema.ts`, `apps/web/lib/dossiers.ts`; create migration under `apps/web/drizzle/`.

- [ ] **Step 1: Add columns + table to `app-schema.ts`**

Add to the `dossiers` table definition: `brief: text('brief')`, `briefGeneratedAt: timestamp('brief_generated_at', { withTimezone: true })`, `sourceNotes: jsonb('source_notes')`. Add a new table after `sources`:
```ts
export const dossierUpdates = pgTable('dossier_updates', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  factCount: integer('fact_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```
Add `integer` to the `drizzle-orm/pg-core` import. (`text`, `timestamp`, `jsonb`, `uuid` already imported.)

- [ ] **Step 2: Generate + apply migration (needs the SSH tunnel open)**

If the tunnel is down: `ssh -L 15432:localhost:5432 root@178.104.52.131 -N` (background). Then:
```bash
pnpm --filter @veille/web db:generate
```
Inspect `apps/web/drizzle/0004_*.sql` — it should `ALTER TABLE "dossiers" ADD COLUMN "brief"...`, `ADD COLUMN "brief_generated_at"...`, `ADD COLUMN "source_notes" jsonb`, and `CREATE TABLE "dossier_updates"`. All additive/nullable (no NOT NULL on existing rows except the new table) → safe on populated `dossiers`. Then:
```bash
pnpm --filter @veille/web db:migrate
```
Confirm "migrations applied successfully".

- [ ] **Step 3: Add store helpers to `dossiers.ts`**

Extend the existing schema import to include `dossierUpdates`. Append:
```ts
export async function listUpdates(dossierId: string) {
  return db.select().from(dossierUpdates).where(eq(dossierUpdates.dossierId, dossierId)).orderBy(desc(dossierUpdates.createdAt));
}

export async function setBrief(dossierId: string, brief: string, sourceNotes: Record<string, string>) {
  await db.update(dossiers).set({ brief, sourceNotes, briefGeneratedAt: new Date() }).where(eq(dossiers.id, dossierId));
}

export async function addUpdate(dossierId: string, body: string, factCount: number, newSourceNotes: Record<string, string>) {
  await db.insert(dossierUpdates).values({ id: uuidv7(), dossierId, body, factCount });
  if (Object.keys(newSourceNotes).length > 0) {
    const [d] = await db.select({ notes: dossiers.sourceNotes }).from(dossiers).where(eq(dossiers.id, dossierId));
    const merged = { ...((d?.notes as Record<string, string> | null) ?? {}), ...newSourceNotes };
    await db.update(dossiers).set({ sourceNotes: merged }).where(eq(dossiers.id, dossierId));
  }
}
```
(`uuidv7`, `eq`, `desc`, `db`, `dossiers` already imported.)

- [ ] **Step 4: Typecheck** — `pnpm --filter @veille/web typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/db/app-schema.ts apps/web/lib/dossiers.ts apps/web/drizzle
git commit -m "feat(web): synthesis schema (brief, source_notes, dossier_updates) + store helpers"
```

---

## Task 2: Synthesis pure helpers + unit tests (TDD)

**Files:** Create `apps/web/lib/synthesis.ts` (helpers only this task), `apps/web/lib/synthesis.test.ts`.

These are pure (no DB/LLM) → testable. The `composeDossier` orchestration is Task 3.

- [ ] **Step 1: Write the failing test** (`apps/web/lib/synthesis.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { hostOf, groupFactsByHost, decideCompose, parseBrief, parseUpdate } from './synthesis';
import type { Fact } from '@veille/core';

const f = (sourceUrl: string, text: string, extractedAt = '2026-05-30T00:00:00.000Z'): Fact =>
  ({ id: 'x', text, sourceUrl, sourcePassage: 'p', language: 'fr', extractedAt,
     provenance: { title: 'T' }, extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' } });

describe('hostOf', () => {
  it('strips www and scheme', () => {
    expect(hostOf('https://www.lemonde.fr/article/x')).toBe('lemonde.fr');
    expect(hostOf('not a url')).toBe('not a url');
  });
});

describe('groupFactsByHost', () => {
  it('groups facts under their publication host, preserving order of first appearance', () => {
    const groups = groupFactsByHost([f('https://lemonde.fr/a', '1'), f('https://rtl.fr/b', '2'), f('https://lemonde.fr/c', '3')]);
    expect(groups.map((g) => g.host)).toEqual(['lemonde.fr', 'rtl.fr']);
    expect(groups[0]!.facts.map((x) => x.text)).toEqual(['1', '3']);
  });
});

describe('decideCompose', () => {
  it('none when no facts; brief when facts but no brief; update when brief + new facts', () => {
    expect(decideCompose({ hasFacts: false, hasBrief: false, hasNewFacts: false })).toBe('none');
    expect(decideCompose({ hasFacts: true, hasBrief: false, hasNewFacts: true })).toBe('brief');
    expect(decideCompose({ hasFacts: true, hasBrief: true, hasNewFacts: true })).toBe('update');
    expect(decideCompose({ hasFacts: true, hasBrief: true, hasNewFacts: false })).toBe('none');
  });
});

describe('parseBrief', () => {
  it('parses JSON brief + source notes, tolerating fences', () => {
    const r = parseBrief('```json\n{"brief":"# B","sources":[{"host":"lemonde.fr","summary":"quotidien"}]}\n```');
    expect(r.brief).toBe('# B');
    expect(r.sourceNotes).toEqual({ 'lemonde.fr': 'quotidien' });
  });
  it('returns empty brief on garbage', () => {
    expect(parseBrief('not json').brief).toBe('');
  });
});

describe('parseUpdate', () => {
  it('parses update body + new source notes', () => {
    const r = parseUpdate('{"update":"news","newSources":[{"host":"rtl.fr","summary":"radio"}]}');
    expect(r.body).toBe('news');
    expect(r.sourceNotes).toEqual({ 'rtl.fr': 'radio' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm exec vitest run apps/web/lib/synthesis.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the helpers** (`apps/web/lib/synthesis.ts`)

```ts
import type { Fact } from '@veille/core';

export type SourceGroup = { host: string; facts: Fact[] };

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

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
```

- [ ] **Step 4: Run tests, verify pass** — `pnpm exec vitest run apps/web/lib/synthesis.test.ts` → 6 pass. `pnpm --filter @veille/web typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add apps/web/lib/synthesis.ts apps/web/lib/synthesis.test.ts
git commit -m "feat(web): synthesis pure helpers (group-by-host, prompts, parse) + tests"
```

---

## Task 3: `composeDossier` orchestration

**Files:** Modify `apps/web/lib/synthesis.ts` (append the orchestrator + imports).

- [ ] **Step 1: Add imports + `composeDossier`**

Prepend imports to `synthesis.ts`:
```ts
import { and, eq, gt, desc } from 'drizzle-orm';
import { db } from './db';
import { dossiers, facts as factsTable, dossierUpdates } from './db/schema';
import { selectLlmClient } from '@veille/core';
import { listFacts, setBrief, addUpdate } from './dossiers';
```
Append:
```ts
export type SynthesisProgress = { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' };

function toFact(row: typeof factsTable.$inferSelect): Fact {
  return { id: row.id, text: row.text, sourceUrl: row.sourceUrl, sourcePassage: row.sourcePassage,
    language: row.language, extractedAt: row.extractedAt.toISOString(), provenance: row.provenance,
    extractedBy: row.extractedBy as Fact['extractedBy'], confidence: row.confidence ?? undefined };
}

/** Returns the cutoff time for "new" facts in an update: latest update, else brief time. */
async function newFactsCutoff(dossierId: string, briefGeneratedAt: Date | null): Promise<Date | null> {
  const [u] = await db.select({ at: dossierUpdates.createdAt }).from(dossierUpdates)
    .where(eq(dossierUpdates.dossierId, dossierId)).orderBy(desc(dossierUpdates.createdAt)).limit(1);
  return u?.at ?? briefGeneratedAt ?? null;
}

export async function composeDossier(
  dossierId: string,
  opts: { mode: 'auto' | 'brief'; language?: string; onProgress?: (p: SynthesisProgress) => void } = { mode: 'auto' },
): Promise<{ wrote: ComposeKind }> {
  const onProgress = opts.onProgress ?? (() => {});
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return { wrote: 'none' };
  const language = opts.language ?? dossier.language ?? 'fr';

  const allRows = await db.select().from(factsTable).where(eq(factsTable.dossierId, dossierId));
  const hasFacts = allRows.length > 0;
  const hasBrief = !!dossier.brief && opts.mode === 'auto'; // mode 'brief' forces regeneration

  // new facts since last update/brief (for an update)
  const cutoff = await newFactsCutoff(dossierId, dossier.briefGeneratedAt ?? null);
  const newRows = cutoff ? allRows.filter((r) => r.createdAt > cutoff) : allRows;
  const hasNewFacts = newRows.length > 0;

  const kind = opts.mode === 'brief' ? (hasFacts ? 'brief' : 'none') : decideCompose({ hasFacts, hasBrief, hasNewFacts });
  if (kind === 'none') { onProgress({ type: 'synthesis', phase: 'brief', state: 'skip' }); return { wrote: 'none' }; }

  const client = selectLlmClient(process.env);
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
  const res = await client.complete(buildUpdatePrompt(subject, language, dossier.brief ?? '', groups), { jsonSchema: UPDATE_SCHEMA });
  const { body, sourceNotes } = parseUpdate(res.text);
  if (body) await addUpdate(dossierId, body, newRows.length, sourceNotes);
  onProgress({ type: 'synthesis', phase: 'update', state: 'done' });
  return { wrote: 'update' };
}
```
Note: `selectLlmClient` + `Fact` come from `@veille/core` (already a dep). `gt`/`and` may be unused → keep only what's used (`eq`, `desc`). The `toFact` mapper converts a DB row back to the in-memory `Fact` shape the helpers expect.

- [ ] **Step 2: Typecheck** — `pnpm --filter @veille/web typecheck` → clean. (No unit test for the orchestration — it's thin glue over tested helpers + LLM + store; verified by the live calibration in Task 9.)

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/synthesis.ts
git commit -m "feat(web): composeDossier — generate brief/update from facts, write to store"
```

---

## Task 4: `refresh` returns `added` + synthesis progress variant

**Files:** Modify `apps/web/lib/refresh.ts`.

- [ ] **Step 1: Add `added` to the return + the union**

In `refresh.ts`: change the return type of `refreshDossier` to `Promise<{ total: number; added: number }>`; track `let added = 0;` initialized to 0, and `added += fresh.length;` right where `total += fresh.length;` is. Return `{ total, added }`. Add to `RefreshProgress` (re-exported for the routes) a new variant by importing+re-exporting `SynthesisProgress`:
```ts
import type { SynthesisProgress } from './synthesis';
export type StreamProgress = RefreshProgress | SynthesisProgress;
```
(Keep `RefreshProgress` as-is; add `StreamProgress` as the union the SSE routes use.)

- [ ] **Step 2: Typecheck** — clean.

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): refresh returns added count; StreamProgress union incl. synthesis"
```

---

## Task 5: SSE routes compose after refresh + on-demand brief action

**Files:** Modify both SSE routes + `apps/web/app/dossier/[slug]/actions.ts`.

- [ ] **Step 1: Update both `assemble/route.ts` and `refresh/route.ts`**

In each route's `ReadableStream.start`, after the `refreshDossier` call, add a compose step. Replace the `try { await refreshDossier(...) }` body with:
```ts
const send = (p: StreamProgress) => controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
try {
  const { added } = await refreshDossier(dossier.id, { language: dossier.language ?? 'fr', onProgress: send });
  if (added > 0 || !dossier.brief) {
    await composeDossier(dossier.id, { mode: 'auto', language: dossier.language ?? 'fr', onProgress: send });
  }
} catch (e) {
  send({ type: 'source-error', label: 'refresh', message: e instanceof Error ? e.message : String(e) });
} finally {
  controller.close();
}
```
Update imports: `import { refreshDossier, type StreamProgress } from '@/lib/refresh';` and `import { composeDossier } from '@/lib/synthesis';`. (Synthesis failure is caught here → a `source-error` frame; facts are already saved, so it's non-fatal per spec §7.) Wrap the `composeDossier` in its own try/catch if you want refresh errors and compose errors distinguished — optional; the outer catch suffices.

- [ ] **Step 2: Add `regenerateBriefAction` to `actions.ts`**
```ts
import { composeDossier } from '@/lib/synthesis';
import { getDossier } from '@/lib/dossiers';
// ...
export async function regenerateBriefAction(slug: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const dossier = await getDossier(id, slug);
  if (!dossier) return;
  await composeDossier(dossier.id, { mode: 'brief' });
  revalidatePath(`/dossier/${slug}`);
}
```
(`ownerId()` helper + `revalidatePath` already in the file.)

- [ ] **Step 3: Typecheck** — `pnpm --filter @veille/web typecheck` → clean.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/app/api/dossiers/[slug]" "apps/web/app/dossier/[slug]/actions.ts"
git commit -m "feat(web): SSE routes compose after refresh; regenerateBriefAction"
```

---

## Task 6: `react-markdown` + safe `<Prose>` component

**Files:** Modify `apps/web/package.json`; create `apps/web/components/prose.tsx`.

- [ ] **Step 1: Add the dependency**
```bash
pnpm --filter @veille/web add react-markdown
```
(Verify it lands in `apps/web/package.json` dependencies.)

- [ ] **Step 2: Create `components/prose.tsx`**
```tsx
import ReactMarkdown from 'react-markdown';

/** Renders trusted-ish LLM markdown as a safe subset (no raw HTML — react-markdown ignores it by default). */
export function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          p: (p) => <p className="leading-relaxed mb-3" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 mb-3 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...p} />,
          strong: (p) => <strong className="font-semibold" {...p} />,
          a: (p) => <a className="underline underline-offset-4 hover:text-foreground text-muted-foreground" target="_blank" rel="noopener noreferrer" {...p} />,
          h1: (p) => <h2 className="font-display text-xl mt-4 mb-2" {...p} />,
          h2: (p) => <h3 className="font-display text-lg mt-4 mb-2" {...p} />,
          h3: (p) => <h4 className="font-medium mt-3 mb-1" {...p} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```
react-markdown does not render raw HTML unless `rehype-raw` is added — we deliberately don't add it (XSS-safe by default).

- [ ] **Step 3: Typecheck** — clean. (May need `pnpm --filter @veille/web build` once so the new dep resolves in the editor, but typecheck should pass.)

- [ ] **Step 4: Commit**
```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/components/prose.tsx ../../pnpm-lock.yaml
git commit -m "feat(web): add react-markdown + safe Prose component"
```
(The lockfile is at the repo root — `git add` the actual changed lockfile path shown by `git status`.)

---

## Task 7: Evidence-by-source view component

**Files:** Create `apps/web/components/templates/by-source.tsx`.

- [ ] **Step 1: Create the component** — groups facts by publication host, shows the per-host blurb (from `dossier.sourceNotes`) + the fact rows (reuse the existing `FactRow`).
```tsx
import { groupFactsByHost } from '@/lib/synthesis';
import { FactRow } from './fact-row';
import type { TemplateProps } from './types';

export function BySource({ dossier, facts }: TemplateProps) {
  if (facts.length === 0) return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  const groups = groupFactsByHost(facts as Parameters<typeof groupFactsByHost>[0]);
  const notes = (dossier.sourceNotes as Record<string, string> | null) ?? {};
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.host}>
          <h3 className="font-display text-lg">{g.host}</h3>
          {notes[g.host] && <p className="text-muted-foreground text-sm mb-2">{notes[g.host]}</p>}
          <div className="divide-y divide-border">
            {g.facts.map((f) => <FactRow key={f.id} fact={f as Parameters<typeof FactRow>[0]['fact']} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
```
Note: `groupFactsByHost` is typed over `Fact`; the DB `FactRow` type is structurally compatible (has `sourceUrl`, `text`, etc.). If TS complains about the `extractedAt: Date` vs `string` mismatch between the DB row and `Fact`, add a tiny local `host` grouping over the DB rows instead of reusing `groupFactsByHost` — duplicate the ~6-line group logic typed for `FactRow[]`. (Prefer reuse; fall back to a local grouper only if the types fight.)

- [ ] **Step 2: Typecheck** — clean.

- [ ] **Step 3: Commit**
```bash
git add apps/web/components/templates/by-source.tsx
git commit -m "feat(web): evidence-by-source (by publication host) view"
```

---

## Task 8: Dossier page prose-first + runtime controls

**Files:** Modify `apps/web/app/dossier/[slug]/page.tsx`, `apps/web/components/dossier-runtime.tsx`.

- [ ] **Step 1: Restructure `page.tsx`**

Load updates + render prose-first. Add `listUpdates` to the dossiers import and to the `Promise.all`. Render order:
1. Header (existing).
2. `dossier.brief` ? `<Prose>{dossier.brief}</Prose>` in a card : a muted "Synthèse en attente — lancez l'assemblage." (the runtime island shows live progress during assembly).
3. Update log: `updates.map((u) => <article><time>{fr date}</time><Prose>{u.body}</Prose></article>)` (newest-first; `listUpdates` already orders desc).
4. Collapsible **Sources & evidence** (`<details>` or a section): render `<BySource dossier={dossier} facts={facts} />` by default; keep the existing Fil/Profil/Chronologie switcher (the `dossier-runtime` template control) as alternate lenses **inside** this zone. Simplest: render `<BySource>` here; leave the existing template switcher wired to render `TEMPLATES[key]` below or behind a toggle. (Minimal: default to BySource; the switcher remains available.)

Keep the `DossierRuntime` island mounted (it owns streaming + controls).

- [ ] **Step 2: Extend `dossier-runtime.tsx`**

- Add a **"Réécrire la synthèse"** button → `startTransition(() => regenerateBriefAction(slug))` (import the action), with a pending label "Réécriture…". Disable while pending.
- Extend the progress `Progress` type to also accept `{ type: 'synthesis'; phase; state }` and render a calm line during assembly/refresh: phase `brief` → "Rédaction de la synthèse…", `update` → "Rédaction de la mise à jour…", `state: 'done'` resolves it. (Same `animate-fact-in` treatment.)
- The existing template switcher stays; it now switches the evidence-zone lens (BySource / Fil / Profil / Chronologie). If that rewiring is fiddly, leave the switcher as-is (it controls the `template` server value) and let the page render BySource as the evidence default — the switcher can be a Task-9 follow-up.

- [ ] **Step 3: Typecheck** — `pnpm --filter @veille/web typecheck` → clean.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/app/dossier/[slug]/page.tsx" apps/web/components/dossier-runtime.tsx
git commit -m "feat(web): prose-first dossier page (brief + update log + by-source evidence) + controls"
```

---

## Task 9: Integration build + live calibration

**Files:** none (verification) — plus any small fixes surfaced.

- [ ] **Step 1: Full static gates**
```bash
pnpm test && pnpm --filter @veille/web typecheck && pnpm --filter @veille/web build
```
Expected: tests green (prior + the new synthesis helper tests); typecheck clean; build compiles; `/dossier/[slug]` still listed.

- [ ] **Step 2: Live calibration (Supadata OFF — protect quota)**

Throwaway `tsx` script (like the relevance calibrations): `delete process.env.SUPADATA_API_KEY`; reuse the existing `gabriel-attal` dossier (it has facts) OR a fresh small press dossier. Call `composeDossier(id, { mode: 'brief', onProgress: console.log })` → read back `dossiers.brief` + `source_notes`; print them. Then simulate an update: not strictly needed — instead, do a fresh tiny dossier: plan→create→`refreshDossier`→`composeDossier('auto')` for the brief, then a second `refreshDossier`+`composeDossier('auto')` to confirm an update note is written (or note that with no new facts on an immediate re-run, `decideCompose` returns 'none' — which is correct). Delete the script after.

Assess: is the brief coherent, source-attributed, and concise? Are `source_notes` sensible one-liners? Eyeball cost (≤2 LLM calls). Report numbers + a sample of the brief.

- [ ] **Step 3: Visual check (dev server)**

Restart the dev server (`pnpm --filter @veille/web dev`) **only after** all `next build` runs are done (running build against a live dev server corrupts `.next` — clear `.next` + restart if it happens). Open `/dossier/gabriel-attal`: confirm the brief renders as prose at top, the evidence is grouped by publication host with blurbs, facts expand to passages. Sign-off.

- [ ] **Step 4: Commit any fixes**
```bash
git add -A && git commit -m "chore(web): synthesis presentation verified end-to-end"
```

---

## Self-Review

**Spec coverage:** §3 brief+update-log → Tasks 1,3,8. §4 data model → Task 1 (with the host-grouping refinement flagged at top — `dossiers.source_notes` instead of `sources.summary`). §5 generation → Tasks 2,3; woven into loop → Tasks 4,5; on-demand regen → Task 5. §6 presentation + markdown → Tasks 6,7,8. §7 error handling (non-fatal synthesis) → Task 5's catch. §10 testing → Task 2 (unit) + Task 9 (calibration/integration).

**Placeholder scan:** none — every code step is complete. The one explicit decision deferred to the implementer (template-switcher rewiring vs BySource-default in Task 8) is bounded with a concrete fallback.

**Type consistency:** `SourceGroup`/`groupFactsByHost`/`parseBrief`/`parseUpdate`/`decideCompose` (Task 2) consumed by `composeDossier` (Task 3). `SynthesisProgress` (Task 3) re-exported in `StreamProgress` (Task 4) used by the routes (Task 5) + runtime (Task 8). `setBrief`/`addUpdate`/`listUpdates` (Task 1) used by Task 3/8. `dossiers.sourceNotes` (Task 1) read by `BySource` (Task 7) + page (Task 8). `composeDossier` (Task 3) called by routes (Task 5) + action (Task 5).

**Open risks flagged:** (1) the host-grouping refinement vs the spec (top of plan — confirm in the morning). (2) `Fact` (string `extractedAt`) vs DB row (`Date`) — `toFact` mapper (Task 3) + the `as` note in Task 7 handle it. (3) react-markdown lockfile path in the commit (Task 6) — `git add` what `git status` shows.
