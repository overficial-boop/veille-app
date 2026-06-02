# Journal — Refresh-Driven Novelty Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Rafraîchir" extracts facts from newly-found documents, runs an LLM novelty/importance gate, and promotes the survivors to a journal displayed above the brief.

**Architecture:** Two nullable columns on `facts` (`journal_at`, `journal_reason`) mark promoted facts — the fact *is* the journal entry. A db-free `lib/journal.ts` builds the gate prompt and parses the selection; `refreshDossier` (refresh phase only) collects newly-kept docs, extracts their facts, calls the gate, and promotes the chosen facts. A `JournalFeed` renders them at the top of the brief column. No new table.

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle ORM (Postgres), `@veille/core` (Gemini flash), vitest. Spec: [docs/superpowers/specs/2026-06-02-journal-novelty-gate-design.md](../specs/2026-06-02-journal-novelty-gate-design.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `apps/web/lib/db/app-schema.ts` | `facts` table | add `journalAt` + `journalReason` |
| `apps/web/drizzle/0012_*.sql` | migration | generated |
| `apps/web/lib/refresh-config.ts` | tunable knobs | add `journalEnabled` + `journalMaxPerRefresh` |
| `apps/web/lib/refresh-config.test.ts` | config test | assert new knobs |
| `apps/web/lib/journal.ts` | the LLM gate (db-free) | **new** — prompt, parse, `selectJournalWorthy`, `journalTextsOf` |
| `apps/web/lib/journal.test.ts` | gate unit tests | **new** |
| `apps/web/lib/dossiers.ts` | journal DB ops | add `listJournal`, `promoteFactsToJournal` |
| `apps/web/lib/refresh.ts` | refresh flow | collect newly-kept → extract facts → gate → promote; `journal` progress event |
| `apps/web/components/journal-feed.tsx` | the journal UI | **new** |
| `apps/web/app/dossier/[slug]/page.tsx` | page | load + render `JournalFeed` above the brief |
| `apps/web/components/dossier-runtime.tsx` | progress line | show "Analyse des nouveautés…" |
| `apps/web/app/globals.css` | journal styles | `.journal-*` block |

---

## Task 1: Schema — `facts.journal_at` + `journal_reason`

**Files:**
- Modify: `apps/web/lib/db/app-schema.ts` (the `facts` table)
- Create: `apps/web/drizzle/0012_*.sql` (generated)

- [ ] **Step 1: Add the columns**

In `apps/web/lib/db/app-schema.ts`, in the `facts` table, add after `confidence: real('confidence'),`:

```ts
  confidence: real('confidence'),
  // Journal: set when a fact is promoted to the "what's new" feed by the refresh novelty gate.
  journalAt: timestamp('journal_at', { withTimezone: true }),
  journalReason: text('journal_reason'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter "@veille/web" db:generate`
Expected: creates `apps/web/drizzle/0012_<name>.sql` with
`ALTER TABLE "facts" ADD COLUMN "journal_at" timestamp with time zone;` and
`ALTER TABLE "facts" ADD COLUMN "journal_reason" text;` (+ a `meta/` snapshot). (Migration applied to the DB in Task 7 — generation is offline.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(db): facts.journal_at + journal_reason for the journal"
```

---

## Task 2: Journal knobs in `RefreshConfig`

**Files:**
- Modify: `apps/web/lib/refresh-config.ts`
- Modify: `apps/web/lib/refresh-config.test.ts`

- [ ] **Step 1: Write the failing assertions**

In `apps/web/lib/refresh-config.test.ts`, find the test that checks defaults (it calls `resolveRefreshConfig({})`). Add a new test after the existing ones:

```ts
describe('journal knobs', () => {
  it('defaults journalEnabled true and journalMaxPerRefresh 5', () => {
    const cfg = resolveRefreshConfig({});
    expect(cfg.journalEnabled).toBe(true);
    expect(cfg.journalMaxPerRefresh).toBe(5);
  });
  it('honours env overrides', () => {
    const cfg = resolveRefreshConfig({ VEILLE_JOURNAL_ENABLED: 'false', VEILLE_JOURNAL_MAX: '3' });
    expect(cfg.journalEnabled).toBe(false);
    expect(cfg.journalMaxPerRefresh).toBe(3);
  });
});
```

Ensure `resolveRefreshConfig` is imported at the top of the test file (it already is).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/refresh-config.test.ts`
Expected: FAIL — `journalEnabled`/`journalMaxPerRefresh` undefined.

- [ ] **Step 3: Add the knobs**

In `apps/web/lib/refresh-config.ts`, extend the `RefreshConfig` type:

```ts
export type RefreshConfig = {
  plannerMaxQueries: number;
  assembleCandidatesPerSource: number;
  refreshCandidatesPerSource: number;
  candidateScoreFloor: number;
  relevanceKeepFloor: number;
  relevanceContentBudget: number;
  journalEnabled: boolean;
  journalMaxPerRefresh: number;
};
```

Add to `DEFAULTS`:

```ts
  relevanceContentBudget: 6000,
  journalEnabled: true,
  journalMaxPerRefresh: 5,
```

In `resolveRefreshConfig`, add (the `num` helper is already defined; add a small bool parse inline):

```ts
    relevanceContentBudget: num(env.VEILLE_RELEVANCE_CONTENT_BUDGET, DEFAULTS.relevanceContentBudget),
    journalEnabled: env.VEILLE_JOURNAL_ENABLED === undefined ? DEFAULTS.journalEnabled : env.VEILLE_JOURNAL_ENABLED !== 'false',
    journalMaxPerRefresh: num(env.VEILLE_JOURNAL_MAX, DEFAULTS.journalMaxPerRefresh),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/web" exec vitest run lib/refresh-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/refresh-config.ts apps/web/lib/refresh-config.test.ts
git commit -m "feat(web): journalEnabled + journalMaxPerRefresh config knobs"
```

---

## Task 3: The novelty gate — `lib/journal.ts` (db-free)

**Files:**
- Create: `apps/web/lib/journal.ts`
- Create: `apps/web/lib/journal.test.ts`

This module must NOT import `./db` (so its pure helpers are unit-testable without the env chain). It imports `selectLlmClient` from `@veille/core` only (called at runtime, not import).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/journal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildJournalGatePrompt, parseJournalSelection, journalTextsOf } from './journal';

describe('buildJournalGatePrompt', () => {
  const p = buildJournalGatePrompt({
    subject: 'Affaire X',
    brief: 'Le brief actuel.',
    journalTexts: ['Déjà connu A'],
    candidates: [{ id: 'f1', text: 'Nouveau fait 1' }, { id: 'f2', text: 'Nouveau fait 2' }],
    max: 5,
  });
  it('includes the subject, brief, journal, candidates, and the cap', () => {
    expect(p).toMatch(/Affaire X/);
    expect(p).toMatch(/Le brief actuel\./);
    expect(p).toMatch(/Déjà connu A/);
    expect(p).toMatch(/f1/);
    expect(p).toMatch(/Nouveau fait 2/);
    expect(p).toMatch(/\b5\b/);
  });
  it('asks for genuinely new developments, not restatements', () => {
    expect(p).toMatch(/new development|nouveau|not.*restate|already/i);
  });
});

describe('parseJournalSelection', () => {
  const ids = ['f1', 'f2', 'f3'];
  it('keeps only in-candidate ids, preserves order, attaches reason, caps at max', () => {
    const text = JSON.stringify({ keep: [
      { id: 'f2', reason: 'développement majeur' },
      { id: 'zzz', reason: 'hallucinated' },
      { id: 'f1', reason: 'inédit' },
    ] });
    expect(parseJournalSelection(text, ids, 5)).toEqual([
      { factId: 'f2', reason: 'développement majeur' },
      { factId: 'f1', reason: 'inédit' },
    ]);
  });
  it('dedups repeated ids and caps at max', () => {
    const text = JSON.stringify({ keep: [
      { id: 'f1', reason: 'a' }, { id: 'f1', reason: 'b' }, { id: 'f2', reason: 'c' }, { id: 'f3', reason: 'd' },
    ] });
    expect(parseJournalSelection(text, ids, 2)).toEqual([
      { factId: 'f1', reason: 'a' },
      { factId: 'f2', reason: 'c' },
    ]);
  });
  it('returns [] on garbage', () => {
    expect(parseJournalSelection('not json', ids, 5)).toEqual([]);
  });
});

describe('journalTextsOf', () => {
  it('maps entries to their text', () => {
    expect(journalTextsOf([{ text: 'a' }, { text: 'b' }])).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/journal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/journal.ts`**

Create `apps/web/lib/journal.ts`:

```ts
import { selectLlmClient } from '@veille/core';
import type { LlmClient } from '@veille/core';

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
    `From the CANDIDATE facts below, keep ONLY those that report a NEW development that is NOT already covered by the current brief or by the journal entries already shown, AND that matters to someone tracking this subject. Drop restatements, near-duplicates of what is already known, background, and trivia.`,
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/web" exec vitest run lib/journal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/journal.ts apps/web/lib/journal.test.ts
git commit -m "feat(web): journal novelty/importance gate (prompt + parse + selectJournalWorthy)"
```

---

## Task 4: Journal DB ops — `listJournal` + `promoteFactsToJournal`

**Files:**
- Modify: `apps/web/lib/dossiers.ts`

- [ ] **Step 1: Add the queries**

In `apps/web/lib/dossiers.ts`, add `isNotNull` to the drizzle import if not present, then append:

```ts
export type JournalEntry = {
  id: string;
  text: string;
  sourceUrl: string;
  documentId: string | null;
  journalReason: string | null;
  journalAt: Date;
};

/** Facts promoted to the journal, newest first. */
export async function listJournal(dossierId: string): Promise<JournalEntry[]> {
  const rows = await db
    .select({
      id: facts.id,
      text: facts.text,
      sourceUrl: facts.sourceUrl,
      documentId: facts.documentId,
      journalReason: facts.journalReason,
      journalAt: facts.journalAt,
    })
    .from(facts)
    .where(and(eq(facts.dossierId, dossierId), isNotNull(facts.journalAt)))
    .orderBy(desc(facts.journalAt));
  return rows.map((r) => ({ ...r, journalAt: r.journalAt as Date }));
}

/** Stamp the selected facts (this dossier, not already promoted) as journal entries. */
export async function promoteFactsToJournal(
  dossierId: string,
  selections: { factId: string; reason: string }[],
): Promise<void> {
  const now = new Date();
  for (const s of selections) {
    await db
      .update(facts)
      .set({ journalAt: now, journalReason: s.reason })
      .where(and(eq(facts.id, s.factId), eq(facts.dossierId, dossierId), isNull(facts.journalAt)));
  }
}
```

The top-of-file drizzle import currently is `import { eq, desc, and, count, inArray } from 'drizzle-orm';` — change it to add `isNull, isNotNull`:

```ts
import { eq, desc, and, count, inArray, isNull, isNotNull } from 'drizzle-orm';
```

`facts` is already imported from `./db/schema` in this file.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dossiers.ts
git commit -m "feat(web): listJournal + promoteFactsToJournal"
```

---

## Task 5: Refresh extracts new facts, gates, promotes

**Files:**
- Modify: `apps/web/lib/refresh.ts`

- [ ] **Step 1: Extend the progress union + imports**

In `apps/web/lib/refresh.ts`, add a `journal` frame to `RefreshProgress`:

```ts
export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'document'; sourceLabel: string; title: string; status: 'kept' | 'suggestion'; kept: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'journal'; state: 'start' | 'done'; promoted: number }
  | { type: 'done'; total: number };
```

Update the schema import to include `facts` and add the new lib imports near the other `./` imports:

```ts
import { dossiers, sources, documents, facts } from './db/schema';
```
Change the drizzle import `import { eq } from 'drizzle-orm';` to:
```ts
import { eq, and, inArray } from 'drizzle-orm';
```
Add `extractFactsForDocument` to the existing `import { upsertDocument } from './documents';` line:
```ts
import { upsertDocument, extractFactsForDocument } from './documents';
```
And add the new lib imports near the other `./` imports:
```ts
import { listJournal, promoteFactsToJournal } from './dossiers';
import { selectJournalWorthy, journalTextsOf } from './journal';
```

- [ ] **Step 2: Collect newly-kept URLs in the loop**

In `refreshDossier`, declare a collector next to `kept`/`suggested`:

```ts
  let kept = 0;
  let suggested = 0;
  const newKeptUrls: string[] = [];
```

In BOTH `processCandidate` call sites inside the loop, record kept URLs. Standing branch — change:

```ts
            const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);
            if (status === 'kept') kept++; else suggested++;
```
to:
```ts
            const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);
            if (status === 'kept') { kept++; newKeptUrls.push(c.url); } else suggested++;
```

Item branch — change:
```ts
          const status = await processCandidate(ctx, url, undefined, title);
          if (status === 'kept') kept++; else suggested++;
```
to:
```ts
          const status = await processCandidate(ctx, url, undefined, title);
          if (status === 'kept') { kept++; newKeptUrls.push(url); } else suggested++;
```

- [ ] **Step 3: After the loop, extract facts → gate → promote (refresh phase only)**

Replace the tail (the `await db.update(dossiers).set({ refreshedAt … })` block + `done`) with:

```ts
  // Journal: on refresh, extract facts from the docs newly kept this run, then let the LLM gate
  // promote the genuinely-new + important ones (vs the brief + existing journal).
  if (phase === 'refresh' && cfg.journalEnabled && newKeptUrls.length > 0 && dossier) {
    const newDocs = await db
      .select({ id: documents.id, url: documents.url, title: documents.title, content: documents.content })
      .from(documents)
      .where(and(eq(documents.dossierId, dossierId), inArray(documents.url, newKeptUrls)));
    const dossierForFacts = { id: dossier.id, name: dossier.name, intent: dossier.intent, language: dossier.language };
    for (const doc of newDocs) {
      try { await extractFactsForDocument(dossierForFacts, doc); } catch { /* skip a doc that won't extract */ }
    }
    const candidates = newDocs.length
      ? await db
          .select({ id: facts.id, text: facts.text })
          .from(facts)
          .where(and(eq(facts.dossierId, dossierId), inArray(facts.documentId, newDocs.map((d) => d.id))))
      : [];
    if (candidates.length > 0) {
      onProgress({ type: 'journal', state: 'start', promoted: 0 });
      try {
        const journalTexts = journalTextsOf(await listJournal(dossierId));
        const selections = await selectJournalWorthy({
          subject: subjectHint || dossier.intent || dossier.name,
          brief: dossier.brief ?? '',
          journalTexts,
          candidates,
          max: cfg.journalMaxPerRefresh,
        });
        await promoteFactsToJournal(dossierId, selections);
        onProgress({ type: 'journal', state: 'done', promoted: selections.length });
      } catch {
        onProgress({ type: 'journal', state: 'done', promoted: 0 });
      }
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total: kept + suggested });
  return { kept, suggested, total: kept + suggested };
```

(`and` + `inArray` were added to the drizzle import in Step 1.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS. (`extractFactsForDocument` accepts `{ id, name, intent, language }` dossier + `{ id, url, title, content }` doc — both provided.)

- [ ] **Step 5: Run the engine helper tests (no regression)**

Run: `pnpm --filter "@veille/web" exec vitest run lib/source-phase.test.ts lib/journal.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): refresh extracts new facts, gates novelty, promotes to journal"
```

---

## Task 6: UI — `JournalFeed` above the brief

**Files:**
- Create: `apps/web/components/journal-feed.tsx`
- Modify: `apps/web/app/dossier/[slug]/page.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/components/dossier-runtime.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/components/journal-feed.tsx`:

```tsx
import Link from 'next/link';
import { hostOf } from '@/lib/host';
import { formatDateFr } from '@/components/templates/types';
import { Eyebrow } from '@/components/veille-ui';
import type { JournalEntry } from '@/lib/dossiers';

/**
 * The journal — a feed of genuinely new, vetted facts surfaced by refresh, newest first.
 * Each entry is the fact itself (text), with its publication (→ the document's fiche), the date it
 * was surfaced, and the gate's one-line reason. Rendered above the brief; hidden when empty.
 */
export function JournalFeed({ entries, slug }: { entries: JournalEntry[]; slug: string }) {
  if (entries.length === 0) return null;
  return (
    <section className="section journal" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Nouveautés</h2>
        </div>
      </div>
      <ol className="journal-list">
        {entries.map((e) => {
          const host = hostOf(e.sourceUrl);
          return (
            <li key={e.id} className="journal-entry">
              <div className="journal-date">{formatDateFr(new Date(e.journalAt))}</div>
              <div className="journal-body">
                <p className="journal-text">{e.text}</p>
                {e.journalReason ? <p className="journal-reason">{e.journalReason}</p> : null}
                <div className="journal-meta">
                  {e.documentId ? (
                    <Link href={`/dossier/${slug}/d/${e.documentId}`}>{host}</Link>
                  ) : (
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{host}</a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 2: Wire the page**

In `apps/web/app/dossier/[slug]/page.tsx`:

Add imports:
```ts
import { listJournal } from '@/lib/dossiers';
import { JournalFeed } from '@/components/journal-feed';
```

Add `listJournal` to the parallel load — change the `Promise.all` that loads `[sources, facts, { kept, suggestions }]`:
```ts
  const [sources, facts, { kept, suggestions }, journal] = await Promise.all([
    listSources(dossier.id),
    listFacts(dossier.id),
    listDocumentsByStatus(dossier.id),
    listJournal(dossier.id),
  ]);
```

In the brief column (`<main className="dossier-main">`), render the journal ABOVE the brief block — insert as the first child:
```tsx
          <main className="dossier-main" style={{ minWidth: 0 }}>
            <JournalFeed entries={journal} slug={dossier.slug} />
            {dossier.brief ? (
```

(The `.dossier-main > :first-child { margin-top: 0 }` rule already aligns the top — the journal section uses `marginTop: 0` too.)

- [ ] **Step 3: Add styles**

In `apps/web/app/globals.css`, after the `.sources-list` / brief styles (search for `.brief-prose`), add:

```css
/* Journal — vetted novelties above the brief. */
.journal { }
.journal-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1.1rem; }
.journal-entry { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .9rem; align-items: baseline;
  padding-left: 1rem; border-left: 2px solid var(--accent); }
.journal-date { font-family: var(--font-mono); font-size: var(--t-mono); letter-spacing: .03em; color: var(--ink-3); white-space: nowrap; }
.journal-text { font-size: 1.02rem; line-height: 1.5; color: var(--ink); margin: 0; }
.journal-reason { font-family: var(--font-serif); font-style: italic; font-size: var(--t-sm); color: var(--ink-2); margin: .25rem 0 0; }
.journal-meta { margin-top: .3rem; font-family: var(--font-mono); font-size: var(--t-mono); letter-spacing: .03em; }
.journal-meta a { color: var(--accent); text-decoration: none; }
.journal-meta a:hover { text-decoration: underline; }
@media (max-width: 560px) { .journal-entry { grid-template-columns: 1fr; gap: .3rem; } }
```

- [ ] **Step 4: Show the gate step in the runtime progress**

In `apps/web/components/dossier-runtime.tsx`, the `Progress` type mirrors the server union (around line 84-93). Add the `journal` frame to it:

```ts
  | { type: 'journal'; state: 'start' | 'done'; promoted: number }
```

In the `es.onmessage` handler (the `if (p.type === …)` chain), add a branch before the `else if (p.type === 'done')`:

```ts
        } else if (p.type === 'journal') {
          setSynth(p.state === 'start' ? { state: 'running', phase: 'update' } : null);
```

(Reuses the existing `synth` line; "phase: 'update'" renders "Rédaction de la mise à jour…". If you prefer a distinct label, that's optional polish — the reused line is acceptable.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/journal-feed.tsx "apps/web/app/dossier/[slug]/page.tsx" apps/web/app/globals.css apps/web/components/dossier-runtime.tsx
git commit -m "feat(web): JournalFeed above the brief + refresh progress line"
```

---

## Task 7: Gate — full suite, build, migration, live

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run: `pnpm -r typecheck && pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite from the repo root**

Run: `pnpm test`
Expected: PASS — including `journal.test.ts` + `refresh-config.test.ts`.

- [ ] **Step 3: Apply the migration to `veille_dev`**

Ensure the SSH tunnel is up (port 15432), then:
```bash
pnpm --filter "@veille/web" db:migrate
```
Expected: migration `0012_*` applies; `facts.journal_at` + `facts.journal_reason` exist (nullable).

- [ ] **Step 4: Production build (ensure `next dev` stopped first)**

Stop any `next dev` on :3000 (kill by port), then:
```bash
pnpm --filter "@veille/web" build
```
Expected: build succeeds.

- [ ] **Step 5: Live smoke (manual, with `next dev`)**

- Open a dossier that already has a brief. Click **Rafraîchir**. If it finds new documents, the progress shows "Rédaction de la mise à jour…" (the gate step), and after `router.refresh()` a **Journal** section appears at the top of the brief column with a few dated entries (fact text · reason · publication → fiche).
- Re-run Rafraîchir with nothing new → journal unchanged (no duplicate entries).
- A dossier with no new docs → no journal change; no errors.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: journal verification fixups"
```

---

## Self-Review

**Spec coverage:**
- §1 storage (facts.journal_at + journal_reason, migration) → Task 1. ✓
- §2 gate module (buildJournalGatePrompt, parseJournalSelection, selectJournalWorthy, journalTextsOf, db-free, JournalConfig) → Task 3 + knobs in Task 2. ✓
- §3 refresh flow (collect newly-kept → extract facts → gate → promote → progress frame, refresh phase only, not assemble/pullAdHoc) → Task 5. ✓
- §4 queries (listJournal, promoteFactsToJournal) → Task 4. ✓
- §5 UI (JournalFeed above brief, entry shape, hidden when empty, styles, runtime progress) → Task 6. ✓
- Edge cases: no brief → `brief ?? ''` → "(none yet)"; no fresh facts → gate skipped; gate returns nothing → nothing promoted; hallucinated/dup ids → `parseJournalSelection` filter; already-promoted skipped via `isNull(journalAt)` in the UPDATE. ✓

**Type consistency:** `JournalSelection = { factId; reason }` used by the gate (Task 3) + `promoteFactsToJournal` (Task 4) + refresh (Task 5); `JournalEntry` from `dossiers.ts` (Task 4) consumed by `JournalFeed` (Task 6); `journalEnabled`/`journalMaxPerRefresh` on `RefreshConfig` (Task 2) read in refresh (Task 5); `{ type:'journal'; state; promoted }` identical in `RefreshProgress` (Task 5) and the runtime `Progress` (Task 6). ✓

**Notes:** First refresh on a dossier with no brief uses "(none yet)" as the baseline — the importance criterion + the `journalMaxPerRefresh` cap keep it from flooding. The journal date is `journal_at` (when surfaced), not the article date — intentional ("what's new now").
