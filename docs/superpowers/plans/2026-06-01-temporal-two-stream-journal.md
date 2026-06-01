# Temporal Model — Two-Stream Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the dossier journal into two recency-based streams — **Actualité** (published since the last refresh) and **Compléments / Découvertes** (older or undated, newly found) — so old articles stop masquerading as breaking news.

**Architecture:** Capture publication dates earlier (backfill `provenance.publishedAt` from discovery candidates), classify each newly-found fact against the previous-refresh cutoff, and have the synthesis update path emit up to two `kind`-tagged `dossier_updates` rows that the journal UI renders as two labelled streams. Retrieval (candidate scoring/floors/caps) and the brief are untouched.

**Tech Stack:** Next.js 15 / React 19, Drizzle ORM + Postgres (drizzle-kit migrations), vitest, `@veille/core` Fact type, Gemini via `selectLlmClient`.

**Spec:** `docs/superpowers/specs/2026-06-01-temporal-model-two-stream-journal-design.md`

---

## Setup

- [ ] **Create a feature branch** (solo workflow merges to `main` at the end)

```bash
git checkout -b feat/temporal-two-stream
```

The SSH tunnel must be up for the migration step (Task 1): `localhost:15432` should be LISTENING. The dev server hot-reloads; **never run `next build` while it runs.**

---

## File Structure

- `apps/web/lib/db/app-schema.ts` — add `kind` column to `dossierUpdates` (modify).
- `apps/web/drizzle/<generated>.sql` + `drizzle/meta/*` — generated migration (create, via drizzle-kit).
- `apps/web/lib/temporal.ts` — pure date/classification helpers (create).
- `apps/web/lib/temporal.test.ts` — unit tests (create).
- `apps/web/lib/refresh.ts` — backfill fact dates from candidates (modify).
- `apps/web/lib/dossiers.ts` — `addUpdate` accepts `kind` (modify).
- `apps/web/lib/synthesis.ts` — `buildUpdatePrompt` framing param + update path splits into two streams (modify).
- `apps/web/lib/synthesis.test.ts` — add framing test (modify).
- `apps/web/components/journal.tsx` — render two labelled streams (modify).
- `apps/web/app/dossier/[slug]/page.tsx` — thread `kind` into `JournalEntry` (modify).

---

## Task 1: Add `kind` column to `dossier_updates`

**Files:**
- Modify: `apps/web/lib/db/app-schema.ts` (the `dossierUpdates` table, ~lines 36-42)
- Create: `apps/web/drizzle/<generated>.sql` (drizzle-kit output)

- [ ] **Step 1: Add the column to the schema**

In `apps/web/lib/db/app-schema.ts`, change the `dossierUpdates` definition to include `kind` (after `body`):

```ts
export const dossierUpdates = pgTable('dossier_updates', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  kind: text('kind').notNull().default('actualite'), // 'actualite' | 'complement'
  factCount: integer('fact_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @veille/web db:generate`
Expected: a new file `apps/web/drizzle/NNNN_*.sql` containing `ALTER TABLE "dossier_updates" ADD COLUMN "kind" text DEFAULT 'actualite' NOT NULL;` (or equivalent). Confirm the SQL adds the column with the default.

- [ ] **Step 3: Apply the migration to the dev DB** (tunnel must be up)

Run: `pnpm --filter @veille/web db:migrate`
Expected: applies cleanly, no error. (Existing rows get `'actualite'` via the default.)

- [ ] **Step 4: Verify the migration**

Open the newest `.sql` file in `apps/web/drizzle/` and confirm it contains:
`ALTER TABLE "dossier_updates" ADD COLUMN "kind" text DEFAULT 'actualite' NOT NULL;` (or equivalent).
Step 3 (`db:migrate`) applied it; existing rows take the default. (`db:migrate` exiting 0 is the authoritative check.)

- [ ] **Step 5: Typecheck + run schema test**

Run: `pnpm --filter @veille/web typecheck` → clean.
Run: `pnpm test -- app-schema` → the existing `apps/web/lib/db/app-schema.test.ts` still passes (adjust it only if it snapshots columns).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(db): add kind column to dossier_updates (actualite|complement)"
```

---

## Task 2: `temporal.ts` — date parsing + classification (TDD)

**Files:**
- Create: `apps/web/lib/temporal.ts`
- Test: `apps/web/lib/temporal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/temporal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDate, factPublishedAt, classify, backfillPublishedAt } from './temporal';

describe('parseDate', () => {
  it('parses ISO dates', () => {
    expect(parseDate('2025-08-15')?.toISOString().slice(0, 10)).toBe('2025-08-15');
  });
  it('returns null for missing/empty/garbage', () => {
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('factPublishedAt', () => {
  it('reads provenance.publishedAt', () => {
    const d = factPublishedAt({ provenance: { publishedAt: '2026-05-30' } });
    expect(d?.toISOString().slice(0, 10)).toBe('2026-05-30');
  });
  it('does NOT fall back to extractedAt (unknown stays null)', () => {
    expect(factPublishedAt({ provenance: { extractedAt: '2026-05-30' } })).toBeNull();
    expect(factPublishedAt({ provenance: null })).toBeNull();
  });
});

describe('classify', () => {
  const cutoff = new Date('2026-05-29T00:00:00Z');
  it('after cutoff => actualite', () => {
    expect(classify({ provenance: { publishedAt: '2026-05-30' } }, cutoff)).toBe('actualite');
  });
  it('on/before cutoff => complement', () => {
    expect(classify({ provenance: { publishedAt: '2025-08-15' } }, cutoff)).toBe('complement');
    expect(classify({ provenance: { publishedAt: '2026-05-29T00:00:00Z' } }, cutoff)).toBe('complement');
  });
  it('unknown date => complement', () => {
    expect(classify({ provenance: {} }, cutoff)).toBe('complement');
  });
  it('null cutoff (first update) => actualite', () => {
    expect(classify({ provenance: {} }, null)).toBe('actualite');
  });
});

describe('backfillPublishedAt', () => {
  it('fills publishedAt from candidate when missing', () => {
    const f = backfillPublishedAt({ provenance: { foo: 1 } }, '2026-05-30');
    expect((f.provenance as { publishedAt?: string }).publishedAt?.slice(0, 10)).toBe('2026-05-30');
    expect((f.provenance as { foo?: number }).foo).toBe(1); // preserves existing provenance
  });
  it('does not overwrite an existing publishedAt', () => {
    const f = backfillPublishedAt({ provenance: { publishedAt: '2024-01-01' } }, '2026-05-30');
    expect((f.provenance as { publishedAt: string }).publishedAt).toBe('2024-01-01');
  });
  it('leaves fact unchanged when candidate date is unusable', () => {
    const orig = { provenance: {} };
    expect(backfillPublishedAt(orig, undefined)).toBe(orig);
    expect(backfillPublishedAt(orig, 'garbage')).toBe(orig);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- temporal`
Expected: FAIL — `Cannot find module './temporal'`.

- [ ] **Step 3: Implement `temporal.ts`**

Create `apps/web/lib/temporal.ts`:

```ts
/**
 * Temporal helpers for the two-stream journal. Pure (no db/env) so they're unit-testable
 * and safe to import from synthesis.ts without triggering env validation.
 */

/** Parse an ISO-ish date string to a Date, or null if absent/unparseable. */
export function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || s.trim() === '') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A fact's PUBLICATION date from provenance.publishedAt — or null if unknown.
 *  Unlike factDate() (display), this does NOT fall back to extractedAt: an unknown
 *  publication date must stay unknown so the fact classifies as a "complément". */
export function factPublishedAt(fact: { provenance: unknown }): Date | null {
  const p = fact.provenance as { publishedAt?: unknown } | null;
  return p ? parseDate(p.publishedAt) : null;
}

export type Stream = 'actualite' | 'complement';

/** Classify a newly-found fact as recent news ("actualite") vs older backfill ("complement"),
 *  relative to the cutoff (previous refresh/update boundary). Unknown date → complement.
 *  Null cutoff (first update) → actualite (nothing prior to compare against). */
export function classify(fact: { provenance: unknown }, cutoff: Date | null): Stream {
  if (cutoff === null) return 'actualite';
  const pub = factPublishedAt(fact);
  return pub !== null && pub > cutoff ? 'actualite' : 'complement';
}

/** Backfill a fact's provenance.publishedAt from a discovery candidate's date when the
 *  adapter didn't capture one and the candidate date is parseable. Returns a new fact
 *  (provenance shallow-cloned); never overwrites an existing publishedAt. */
export function backfillPublishedAt<T extends { provenance: unknown }>(
  fact: T,
  candidatePublishedAt: string | undefined,
): T {
  if (factPublishedAt(fact) !== null) return fact;
  const d = parseDate(candidatePublishedAt);
  if (!d) return fact;
  const prov = fact.provenance && typeof fact.provenance === 'object' ? fact.provenance : {};
  return { ...fact, provenance: { ...prov, publishedAt: d.toISOString() } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- temporal`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/temporal.ts apps/web/lib/temporal.test.ts
git commit -m "feat(web): temporal helpers — factPublishedAt + classify + candidate date backfill"
```

---

## Task 3: Backfill fact dates from candidates in `refresh.ts`

**Files:**
- Modify: `apps/web/lib/refresh.ts` (import + the standing-source extraction loop, ~lines 9, 87-92)

- [ ] **Step 1: Import the helper**

In `apps/web/lib/refresh.ts`, add to the imports near the top (next to the `./dedup` import):

```ts
import { backfillPublishedAt } from './temporal';
```

- [ ] **Step 2: Backfill each candidate's extracted facts**

Replace the `freshCandidates` loop body (currently concatenating `topFactsPerUrl(...)`) with:

```ts
        for (const c of freshCandidates(ranked, seenUrls)) {
          const adapter = findAdapter({ kind: 'url', url: c.url });
          if (!adapter) continue;
          try {
            const top = topFactsPerUrl(
              await extract(c.url, { language: lang, withSummary: false, subjectHint }),
              MAX_FACTS_PER_URL,
            );
            // Backfill publication date from the discovery candidate (Tavily published_date /
            // RSS pubDate) when the adapter didn't find one — improves stream classification.
            extracted = extracted.concat(top.map((f) => backfillPublishedAt(f, c.publishedAt)));
          } catch {
            /* skip a bad candidate URL, keep going */
          }
        }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @veille/web typecheck`
Expected: clean. (`Candidate.publishedAt` is `string | undefined`; `backfillPublishedAt` accepts that.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): backfill fact publishedAt from discovery candidate dates on refresh"
```

---

## Task 4: Split the synthesis update path into two streams

**Files:**
- Modify: `apps/web/lib/dossiers.ts` (`addUpdate`, ~lines 159-162)
- Modify: `apps/web/lib/synthesis.ts` (import, `buildUpdatePrompt` ~line 111, update path ~lines 215-227)
- Modify: `apps/web/lib/synthesis.test.ts` (add a framing test)

- [ ] **Step 1: `addUpdate` accepts a `kind`**

In `apps/web/lib/dossiers.ts`, change `addUpdate` (keep the rest of the transaction body unchanged):

```ts
export async function addUpdate(
  dossierId: string,
  body: string,
  factCount: number,
  newSourceNotes: Record<string, string>,
  kind: 'actualite' | 'complement' = 'actualite',
) {
  await db.transaction(async (tx) => {
    await tx.insert(dossierUpdates).values({ id: uuidv7(), dossierId, body, factCount, kind });
    // ... existing sourceNotes merge unchanged ...
```

- [ ] **Step 2: `buildUpdatePrompt` gains a stream-framing param — write the failing test**

Add to `apps/web/lib/synthesis.test.ts`:

```ts
import { buildUpdatePrompt } from './synthesis';

describe('buildUpdatePrompt framing', () => {
  const g = [{ host: 'lemonde.fr', facts: [] }];
  it('actualite framing mentions recent developments', () => {
    expect(buildUpdatePrompt('X', 'fr', 'b', g, 'actualite')).toMatch(/RECENT developments/);
  });
  it('complement framing mentions older items', () => {
    expect(buildUpdatePrompt('X', 'fr', 'b', g, 'complement')).toMatch(/OLDER items/);
  });
});
```

Run: `pnpm test -- synthesis` → the two new cases FAIL (framing strings absent / param ignored).

- [ ] **Step 3: Implement the framing param**

In `apps/web/lib/synthesis.ts`, replace `buildUpdatePrompt` with:

```ts
export function buildUpdatePrompt(
  subject: string,
  language: string,
  brief: string,
  newGroups: SourceGroup[],
  stream: 'actualite' | 'complement' = 'actualite',
): string {
  const framing =
    stream === 'complement'
      ? 'These are OLDER items newly added to the dossier — background/context discovered since last time, NOT breaking news. Summarize what context they add.'
      : 'These are RECENT developments since the last update.';
  return [
    'You write a short dated "what\'s new" update to an existing dossier.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output Markdown prose in the "update" field.`,
    framing,
    'Below is the EXISTING brief (context) and only the NEW facts since the last update.',
    'Write a brief note describing what these new facts add or change relative to the brief. Attribute each new claim with a Markdown link to its EXACT source URL from the [source: …] tags below; use only those URLs, never invent one. If nothing material, keep it to a sentence.',
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

Run: `pnpm test -- synthesis` → PASS (new + existing cases; the 4-arg call sites still type-check via the default).

- [ ] **Step 4: Split the update path in `composeDossier`**

In `apps/web/lib/synthesis.ts`, add the top-level import (temporal is pure — safe, no env):

```ts
import { classify } from './temporal';
```

Replace the `// update` block (from `onProgress({ type: 'synthesis', phase: 'update', state: 'start' });` through the `return { wrote: 'update' };`) with:

```ts
  // update — split the run's new facts into two recency streams; one row per non-empty stream.
  const buckets: Array<[ 'actualite' | 'complement', typeof newRows ]> = [
    ['actualite', newRows.filter((r) => classify(r, cutoff) === 'actualite')],
    ['complement', newRows.filter((r) => classify(r, cutoff) === 'complement')],
  ];
  let wroteAny = false;
  for (const [stream, rows] of buckets) {
    if (rows.length === 0) continue;
    onProgress({ type: 'synthesis', phase: 'update', state: 'start' });
    const groups = groupFactsByHost(rows.map(toFact));
    const res = await client.complete(
      buildUpdatePrompt(subject, language, dossier.brief ?? '', groups, stream),
      { jsonSchema: UPDATE_SCHEMA },
    );
    const { body, sourceNotes } = parseUpdate(res.text);
    const allowedUrls = new Set(rows.map((r) => r.sourceUrl));
    const safeBody = body ? stripUnknownLinks(body, allowedUrls) : body;
    if (safeBody) {
      await addUpdate(dossierId, safeBody, rows.length, sourceNotes, stream);
      wroteAny = true;
    }
    onProgress({ type: 'synthesis', phase: 'update', state: 'done' });
  }
  return { wrote: wroteAny ? 'update' : 'none' };
```

(`classify` takes the DB row directly — its `provenance` field satisfies `{ provenance: unknown }`. `cutoff` here is the same value already computed at line ~184.)

- [ ] **Step 5: Typecheck + full synthesis test**

Run: `pnpm --filter @veille/web typecheck` → clean.
Run: `pnpm test -- synthesis temporal` → all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/dossiers.ts apps/web/lib/synthesis.ts apps/web/lib/synthesis.test.ts
git commit -m "feat(web): synthesis emits two recency streams (actualite/complement) as kind-tagged updates"
```

---

## Task 5: Journal UI — two labelled streams

**Files:**
- Modify: `apps/web/components/journal.tsx`
- Modify: `apps/web/app/dossier/[slug]/page.tsx` (the `<Journal entries=...>` mapping)

- [ ] **Step 1: Render two streams in `journal.tsx`**

Replace `apps/web/components/journal.tsx` with:

```tsx
'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { useCitations, SourcesToggle } from './citations-context';

export type JournalEntry = { id: string; when: string; body: string; kind: 'actualite' | 'complement' };

/**
 * The dossier journal — two recency streams. "Actualité" = developments published since the
 * last refresh; "Compléments / Découvertes" = older or undated material newly found. Citations
 * render as numbered superscripts (shared map + toggle with the brief).
 */
export function Journal({
  entries,
  citations,
}: {
  entries: JournalEntry[];
  citations: Record<string, number>;
}) {
  const { show } = useCitations();
  const components = React.useMemo(() => citeComponents(citations), [citations]);
  if (entries.length === 0) return null;

  const actu = entries.filter((e) => e.kind === 'actualite');
  const comp = entries.filter((e) => e.kind === 'complement');

  const stream = (items: JournalEntry[]) => (
    <div className="journal">
      {items.map((u) => (
        <div key={u.id} className="update fade">
          <div className="when">{u.when}</div>
          <div className={'body' + (show ? ' show-src' : '')}>
            <ReactMarkdown components={components}>{prepareCiteMd(u.body)}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {actu.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div className="ttl">
              <Eyebrow>Journal</Eyebrow>
              <h2 style={{ marginTop: '.1rem' }}>Actualité</h2>
            </div>
            <SourcesToggle />
          </div>
          {stream(actu)}
        </section>
      )}
      {comp.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div className="ttl">
              <Eyebrow>Journal</Eyebrow>
              <h2 style={{ marginTop: '.1rem' }}>Compléments / Découvertes</h2>
            </div>
            {actu.length === 0 && <SourcesToggle />}
          </div>
          {stream(comp)}
        </section>
      )}
    </>
  );
}
```

- [ ] **Step 2: Thread `kind` through in `page.tsx`**

In `apps/web/app/dossier/[slug]/page.tsx`, update the `<Journal entries=...>` mapping to pass `kind`:

```tsx
              <Journal
                entries={updates.map((u) => ({
                  id: u.id,
                  when: formatDateFr(new Date(u.createdAt)),
                  body: u.body,
                  kind: u.kind === 'complement' ? 'complement' : 'actualite',
                }))}
                citations={citations}
              />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @veille/web typecheck` → clean. (`listUpdates` returns rows incl. `kind`; the mapping narrows it to the union.)

- [ ] **Step 4: Visual check via a throwaway preview route**

Create `apps/web/app/journal-preview/page.tsx`:

```tsx
// TEMP preview — delete after.
import { CitationsProvider } from '@/components/citations-context';
import { Journal } from '@/components/journal';

const citations = { 'https://www.lemonde.fr/x': 1, 'https://www.youtube.com/watch?v=abc': 2 };
const entries = [
  { id: '1', when: '31 mai 2026', body: 'Développement récent [lemonde.fr](https://www.lemonde.fr/x).', kind: 'actualite' as const },
  { id: '2', when: '30 mai 2026', body: 'Autre actualité [youtube.com](https://www.youtube.com/watch?v=abc).', kind: 'actualite' as const },
  { id: '3', when: '29 mai 2026', body: 'Élément plus ancien retrouvé [lemonde.fr](https://www.lemonde.fr/x).', kind: 'complement' as const },
];

export default function JournalPreview() {
  return (
    <div className="shell">
      <div className="page dossier">
        <main style={{ minWidth: 0, maxWidth: 720, margin: '2rem auto' }}>
          <CitationsProvider>
            <Journal entries={entries} citations={citations} />
          </CitationsProvider>
        </main>
      </div>
    </div>
  );
}
```

Navigate to `http://localhost:3000/journal-preview`, screenshot, and confirm: two labelled sections — "Actualité" (2 entries) and "Compléments / Découvertes" (1 entry) — and that one toggle reveals superscripts in both. Then clean up:
`rm -rf apps/web/app/journal-preview apps/web/.next/types/app/journal-preview` + delete the screenshot.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/journal.tsx "apps/web/app/dossier/[slug]/page.tsx"
git commit -m "feat(web): journal renders two recency streams (Actualité / Compléments)"
```

---

## Task 6: Full gate + live verification + merge

- [ ] **Step 1: Stop the dev server**

Tree-kill whatever listens on :3000 (a concurrent build corrupts `.next`):

```powershell
$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($p) { taskkill /PID $p /T /F }
```
Confirm `Get-NetTCPConnection -LocalPort 3000 -State Listen` returns nothing.

- [ ] **Step 2: Full gate (dev stopped)**

```bash
rm -rf apps/web/.next
pnpm --filter @veille/web typecheck && pnpm test && pnpm --filter @veille/web build
```
Expected: typecheck clean; **all tests pass** (includes temporal + synthesis); build compiles (6 routes).

- [ ] **Step 3: Restart the dev server clean**

```bash
rm -rf apps/web/.next
pnpm --filter @veille/web dev   # background
```

- [ ] **Step 4: Live verification (optional, costs Tavily/Gemini credits)**

With the dev server + tunnel up, sign in and click **Rafraîchir** on the Gabriel Attal dossier. Confirm new facts land in the right journal section (Actualité vs Compléments) with appropriate framing. (If skipped, note it — the unit tests already cover classification.)

- [ ] **Step 5: Merge to main + delete branch** (solo workflow)

```bash
git checkout main
git merge --no-ff feat/temporal-two-stream -m "Merge feat/temporal-two-stream: two-stream journal (Actualité / Compléments)"
git branch -d feat/temporal-two-stream
```

- [ ] **Step 6: Update memory** — mark the temporal model done in `presentation-q-series.md` (Q1+Q2 shipped) + the MEMORY.md index.

---

## Notes / edge cases (from spec)

- Unknown publication date → Compléments (deliberate).
- First update (null cutoff) → all Actualité; in practice the update path always has a non-null cutoff because a brief implies `briefGeneratedAt`.
- The pre-existing Gabriel Attal journal entry stays `actualite` (default); not retro-split.
- Item sources (single URL, no candidate) rely on adapter provenance only.
- Out of scope: recency-aware candidate ranking, source-exhaustion detection, storing YouTube video titles.
