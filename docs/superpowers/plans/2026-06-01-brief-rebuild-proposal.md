# Brief-Rebuild Proposal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a refresh surfaces older-than-the-brief material, show a quiet banner in the Synthèse tab offering to rebuild the brief (with a "Plus tard" snooze) — the brief's only confirmation step.

**Architecture:** A derived count (`countPendingRebuild`) of un-briefed, old-published facts drives a `RebuildProposal` banner above the brief. "Reconstruire" reuses the existing `regenerateBriefAction`; "Plus tard" sets a new `dossiers.briefSuggestionDismissedAt` and the banner hides until newer old facts arrive. Two-stream journal + documents unchanged.

**Tech Stack:** Next.js 15 (server actions + `useTransition`), Drizzle + Postgres, vitest, `classify` from `@/lib/temporal`.

**Spec:** `docs/superpowers/specs/2026-06-01-refresh-brief-rebuild-proposal-design.md`

---

## Setup
- [ ] **Branch:** `git checkout -b feat/brief-rebuild-proposal` (from `main`). Tunnel up on :15432 for the migration. Dev server hot-reloads — never `next build` while it runs.

## File Structure
- `apps/web/lib/db/app-schema.ts` — add `dossiers.briefSuggestionDismissedAt` (modify) + migration.
- `apps/web/lib/temporal.ts` — add pure `countPendingRebuild` (modify); test in `temporal.test.ts`.
- `apps/web/lib/dossiers.ts` — `pendingRebuildCount` (DB wrapper) + `dismissBriefSuggestion` (modify).
- `apps/web/app/dossier/[slug]/actions.ts` — `dismissBriefSuggestionAction` (modify).
- `apps/web/components/rebuild-proposal.tsx` — banner (create).
- `apps/web/app/dossier/[slug]/page.tsx` — compute count + render banner in the `synthese` slot (modify).
- `apps/web/app/globals.css` — banner styles (modify).

---

## Task 1: Migration — `dossiers.briefSuggestionDismissedAt`

**Files:** Modify `apps/web/lib/db/app-schema.ts`; generate migration.

- [ ] **Step 1: Add the column.** In `app-schema.ts`, in the `dossiers` table (after `briefGeneratedAt`), add:

```ts
  briefSuggestionDismissedAt: timestamp('brief_suggestion_dismissed_at', { withTimezone: true }),
```

- [ ] **Step 2: Generate.** Run `pnpm --filter @veille/web db:generate`. Confirm the new `.sql` is `ALTER TABLE "dossiers" ADD COLUMN "brief_suggestion_dismissed_at" timestamp with time zone;`.

- [ ] **Step 3: Apply.** Run `pnpm --filter @veille/web db:migrate` (tunnel up). Expect exit 0.

- [ ] **Step 4: Verify + typecheck.** Read the generated `.sql`. Run `pnpm --filter @veille/web typecheck` (clean) and `pnpm test -- app-schema` (passes).

- [ ] **Step 5: Commit.**
```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(db): add dossiers.briefSuggestionDismissedAt"
```

---

## Task 2: `countPendingRebuild` (TDD) + DB helpers

**Files:** Modify `apps/web/lib/temporal.ts` + `apps/web/lib/temporal.test.ts`; modify `apps/web/lib/dossiers.ts`.

- [ ] **Step 1: Write the failing test.** Append to `apps/web/lib/temporal.test.ts`:

```ts
import { countPendingRebuild } from './temporal';

describe('countPendingRebuild', () => {
  const brief = new Date('2026-05-29T00:00:00Z');
  const mk = (createdAt: string, publishedAt?: string) => ({ createdAt: new Date(createdAt), provenance: publishedAt ? { publishedAt } : {} });

  it('returns 0 when no brief yet', () => {
    expect(countPendingRebuild([mk('2026-05-30', '2020-01-01')], null, null)).toBe(0);
  });
  it('counts old-published facts created after the brief', () => {
    // published 2025-08 (before brief) AND created after brief → pending
    expect(countPendingRebuild([mk('2026-05-30', '2025-08-15')], brief, null)).toBe(1);
  });
  it('ignores recent-published facts (they belong to the journal, not a rebuild)', () => {
    // published after brief → actualite → not pending
    expect(countPendingRebuild([mk('2026-05-30', '2026-05-30')], brief, null)).toBe(0);
  });
  it('counts undated facts (conservative: brief may have missed them)', () => {
    expect(countPendingRebuild([mk('2026-05-30')], brief, null)).toBe(1);
  });
  it('excludes facts created on/before the brief (already in it)', () => {
    expect(countPendingRebuild([mk('2026-05-28', '2025-08-15')], brief, null)).toBe(0);
  });
  it('snooze: excludes facts created on/before dismissedAt, counts newer ones', () => {
    const dismissed = new Date('2026-05-31T00:00:00Z');
    const facts = [mk('2026-05-30', '2025-08-15'), mk('2026-06-01', '2025-08-16')];
    expect(countPendingRebuild(facts, brief, dismissed)).toBe(1); // only the 2026-06-01 one
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm test -- temporal` → the new cases fail (`countPendingRebuild` not exported).

- [ ] **Step 3: Implement.** Append to `apps/web/lib/temporal.ts` (it already exports `classify`):

```ts
/** Count facts that should prompt a brief rebuild: published before the brief was built
 *  (classify → 'complement', incl. unknown dates) AND found since the brief / since the
 *  last snooze. Returns 0 when no brief exists yet. Pure (testable). */
export function countPendingRebuild(
  facts: { createdAt: Date; provenance: unknown }[],
  briefGeneratedAt: Date | null,
  dismissedAt: Date | null,
): number {
  if (!briefGeneratedAt) return 0;
  const floor = dismissedAt && dismissedAt > briefGeneratedAt ? dismissedAt : briefGeneratedAt;
  return facts.filter((f) => f.createdAt > floor && classify(f, briefGeneratedAt) === 'complement').length;
}
```

- [ ] **Step 4: Run → pass.** `pnpm test -- temporal` → all pass.

- [ ] **Step 5: DB helpers in `apps/web/lib/dossiers.ts`.** Add (near the other dossier helpers; `db`, `dossiers`, `facts`, `eq`, `and` are already imported — verify and add any missing):

```ts
import { countPendingRebuild } from './temporal';

/** Derived count of older-than-brief facts found since the brief / last snooze. */
export async function pendingRebuildCount(dossierId: string): Promise<number> {
  const [d] = await db
    .select({ briefGeneratedAt: dossiers.briefGeneratedAt, dismissedAt: dossiers.briefSuggestionDismissedAt })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId));
  if (!d?.briefGeneratedAt) return 0;
  const rows = await db
    .select({ createdAt: facts.createdAt, provenance: facts.provenance })
    .from(facts)
    .where(eq(facts.dossierId, dossierId));
  return countPendingRebuild(rows, d.briefGeneratedAt, d.dismissedAt ?? null);
}

/** Owner-scoped: snooze the rebuild proposal (banner returns when newer old facts arrive). */
export async function dismissBriefSuggestion(ownerId: string, slug: string): Promise<void> {
  const dossier = await getDossier(ownerId, slug);
  if (!dossier) return;
  await db.update(dossiers).set({ briefSuggestionDismissedAt: new Date() }).where(eq(dossiers.id, dossier.id));
}
```

- [ ] **Step 6: Typecheck + commit.**
```bash
git add apps/web/lib/temporal.ts apps/web/lib/temporal.test.ts apps/web/lib/dossiers.ts
git commit -m "feat(web): countPendingRebuild + pendingRebuildCount + dismissBriefSuggestion"
```

---

## Task 3: `dismissBriefSuggestionAction` server action

**Files:** Modify `apps/web/app/dossier/[slug]/actions.ts`.

- [ ] **Step 1: Add the action.** Append to `actions.ts` (it already has `regenerateBriefAction`, the `ownerId()` helper, and imports `revalidatePath`; add `dismissBriefSuggestion` to the `@/lib/dossiers` import):

```ts
export async function dismissBriefSuggestionAction(slug: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await dismissBriefSuggestion(id, slug);
  revalidatePath(`/dossier/${slug}`);
}
```

- [ ] **Step 2: Typecheck + commit.**
```bash
git add apps/web/app/dossier/[slug]/actions.ts
git commit -m "feat(web): dismissBriefSuggestionAction server action"
```

---

## Task 4: `RebuildProposal` banner + wire into the Synthèse slot

**Files:** Create `apps/web/components/rebuild-proposal.tsx`; modify `apps/web/app/dossier/[slug]/page.tsx` + `apps/web/app/globals.css`.

- [ ] **Step 1: Banner component** (`apps/web/components/rebuild-proposal.tsx`):

```tsx
'use client';

import * as React from 'react';
import { regenerateBriefAction, dismissBriefSuggestionAction } from '@/app/dossier/[slug]/actions';

/** Quiet banner proposing a brief rebuild when older-than-brief material has been found. */
export function RebuildProposal({ count, slug }: { count: number; slug: string }) {
  const [pending, start] = React.useTransition();
  if (count <= 0) return null;
  return (
    <div className="rebuild-proposal">
      <span className="rebuild-msg">
        <b>{count}</b> élément{count > 1 ? 's' : ''} plus ancien{count > 1 ? 's' : ''} à intégrer au brief.
      </span>
      <span className="rebuild-actions">
        <button
          type="button"
          className="btn btn-soft btn-sm"
          disabled={pending}
          onClick={() => start(() => { void regenerateBriefAction(slug); })}
        >
          {pending ? 'Réécriture…' : 'Reconstruire le brief'}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={pending}
          onClick={() => start(() => { void dismissBriefSuggestionAction(slug); })}
        >
          Plus tard
        </button>
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `page.tsx`.** Read `apps/web/app/dossier/[slug]/page.tsx`. It builds a `synthese` slot for `<DossierTabs>` containing a `<CitationsProvider>` wrapping `<Brief>`/empty + `<Journal>`. Do:
  1. Import `RebuildProposal` and `pendingRebuildCount`.
  2. In the data load, compute the count — add to the `Promise.all` or after it: `const pendingRebuild = await pendingRebuildCount(dossier.id);`
  3. Render `<RebuildProposal count={pendingRebuild} slug={slug} />` as the **first child inside the `CitationsProvider`**, immediately before the `<Brief>`/empty-brief block in the `synthese` slot.

Example shape (match the actual current JSX):
```tsx
synthese={
  <CitationsProvider>
    <RebuildProposal count={pendingRebuild} slug={slug} />
    {dossier.brief ? <Brief brief={dossier.brief} citations={citations} /> : (/* empty brief section */)}
    <Journal entries={/* … */} citations={citations} />
  </CitationsProvider>
}
```

- [ ] **Step 3: CSS** — append to `apps/web/app/globals.css` (near the `.section`/journal rules):

```css
/* brief-rebuild proposal banner */
.rebuild-proposal {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  margin: 0 0 1.4rem; padding: .7rem 1rem;
  background: var(--accent-soft); border: 1px solid color-mix(in oklch, var(--accent) 22%, var(--line));
  border-radius: var(--radius-sm);
}
.rebuild-msg { font-size: var(--t-sm); color: var(--ink); }
.rebuild-actions { display: inline-flex; gap: .5rem; flex: none; }
```

- [ ] **Step 4: Typecheck + visual check.** `pnpm --filter @veille/web typecheck` → clean. Then a throwaway preview route rendering `<RebuildProposal count={5} slug="x" />` inside a `.page.dossier` `main` — screenshot, confirm the banner reads well, delete the preview + `rm -rf apps/web/.next/types/app/<preview>` + screenshot. (The buttons call server actions; in the preview they'll no-op/redirect — only the layout is being checked.)

- [ ] **Step 5: Commit.**
```bash
git add apps/web/components/rebuild-proposal.tsx "apps/web/app/dossier/[slug]/page.tsx" apps/web/app/globals.css
git commit -m "feat(web): brief-rebuild proposal banner in the Synthèse tab"
```

---

## Task 5: Gate + merge

- [ ] **Step 1: Stop the dev server** — tree-kill the PID on :3000:
```powershell
$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($p) { taskkill /PID $p /T /F }
```
Confirm :3000 is free.

- [ ] **Step 2: Full gate (dev stopped).**
```bash
rm -rf apps/web/.next
pnpm --filter @veille/web typecheck && pnpm test && pnpm --filter @veille/web build
```
Expect: typecheck clean, all tests pass (incl. the new `countPendingRebuild` cases), build compiles.

- [ ] **Step 3: Restart dev clean.** `rm -rf apps/web/.next && pnpm --filter @veille/web dev` (background).

- [ ] **Step 4: Live check (optional).** On the Attal dossier (Synthèse tab): its backfilled older facts should make the banner appear with a count. "Reconstruire" rewrites the brief and the banner disappears; "Plus tard" hides it. (Both call existing/added actions.)

- [ ] **Step 5: Merge.**
```bash
git checkout main
git merge --no-ff feat/brief-rebuild-proposal -m "Merge feat/brief-rebuild-proposal: brief-rebuild proposal banner (Spec B)"
git branch -d feat/brief-rebuild-proposal
```

- [ ] **Step 6: Memory.** Note Spec B shipped in `presentation-q-series.md` / the index.

---

## Notes
- The count is purely derived (`countPendingRebuild`); only `briefSuggestionDismissedAt` is persisted.
- Recent facts go to the journal, not a rebuild; a manual "Réécrire" still folds everything (incl. recent) into the brief.
- After "Reconstruire" or "Plus tard", `revalidatePath` re-renders; the recomputed count is 0 so the banner vanishes — no client cache to manage.
