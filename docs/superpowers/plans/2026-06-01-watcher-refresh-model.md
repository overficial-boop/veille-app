# Watcher Refresh Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Veille a new-publication watcher: go deep on the first run (assemble), surface only recently-published documents on refresh, drop the Compléments stream + the brief-rebuild proposal, and make depth knobs configurable.

**Architecture:** A typed `RefreshConfig` (env-overridable) feeds `refreshDossier`, which now takes a `phase` ('assemble' deep / 'refresh' recent-only). Refresh applies a recency filter to standing-source candidates; the planner makes more queries on first run. The journal becomes a single clean-prose stream (no inline citations); Spec B and `classify` are removed.

**Tech Stack:** Next.js 15, Drizzle, vitest, `@veille/core`, `@veille/discovery` (Tavily), Gemini.

**Spec:** `docs/superpowers/specs/2026-06-01-watcher-refresh-model-design.md`

**Resolved integration points:** planner called at `apps/web/app/api/dossiers/route.ts:15` (`planDossier({ intent, language })`); `discoverTavily(cfg)` reads `cfg.days`, so override via `discoverTavily({ ...source.input, days })`.

---

## Setup
- [ ] **Branch:** `git checkout -b feat/watcher-refresh` (from `main`). Tunnel up. Dev hot-reloads — never `next build` while it runs. **Read the current** `apps/web/lib/refresh.ts`, `synthesis.ts`, `temporal.ts`, `components/journal.tsx`, `app/dossier/[slug]/page.tsx` before editing — they've been modified several times.

## File Structure
- Create `apps/web/lib/refresh-config.ts` (+ test) — depth config.
- Modify `apps/web/lib/temporal.ts` (+ test) — add `isRecentCandidate`, remove `classify`/`countPendingRebuild`.
- Modify `apps/web/lib/refresh.ts` — `phase` param, config knobs, recency filter.
- Modify `apps/web/app/api/dossiers/[slug]/{assemble,refresh}/route.ts` — pass `phase`.
- Modify `packages/discovery/src/plan-dossier.ts` — `maxQueries` param; `apps/web/app/api/dossiers/route.ts` — pass it.
- Modify `apps/web/lib/synthesis.ts` (+ test) — clean-prose update prompt, single update.
- Modify `apps/web/components/journal.tsx` + `app/dossier/[slug]/page.tsx` — single clean stream.
- Remove Spec B: `components/rebuild-proposal.tsx`, `lib/dossiers.ts` helpers, `actions.ts` action, page wiring.

---

## Task 1: `refresh-config.ts` (TDD)

**Files:** Create `apps/web/lib/refresh-config.ts`, `apps/web/lib/refresh-config.test.ts`.

- [ ] **Step 1: Failing test** (`refresh-config.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { resolveRefreshConfig } from './refresh-config';

describe('resolveRefreshConfig', () => {
  it('uses defaults with empty env', () => {
    const c = resolveRefreshConfig({});
    expect(c).toMatchObject({ plannerMaxQueries: 5, assembleCandidatesPerSource: 10, refreshCandidatesPerSource: 6, candidateScoreFloor: 0.4, factRelevanceFloor: 0.5, maxFactsPerUrl: 20 });
  });
  it('applies valid env overrides', () => {
    const c = resolveRefreshConfig({ VEILLE_PLANNER_MAX_QUERIES: '8', VEILLE_ASSEMBLE_CANDIDATES: '15' });
    expect(c.plannerMaxQueries).toBe(8);
    expect(c.assembleCandidatesPerSource).toBe(15);
  });
  it('ignores invalid/zero/negative overrides → default', () => {
    expect(resolveRefreshConfig({ VEILLE_PLANNER_MAX_QUERIES: 'abc' }).plannerMaxQueries).toBe(5);
    expect(resolveRefreshConfig({ VEILLE_REFRESH_CANDIDATES: '0' }).refreshCandidatesPerSource).toBe(6);
  });
});
```
Run `pnpm test -- refresh-config` → FAIL (module missing).

- [ ] **Step 2: Implement** `refresh-config.ts`:
```ts
/** Tunable depth/recency knobs. Defaults below; env overrides for admins now,
 *  structured so a per-user/per-dossier source can replace `process.env` later. */
export type RefreshConfig = {
  plannerMaxQueries: number;
  assembleCandidatesPerSource: number;
  refreshCandidatesPerSource: number;
  candidateScoreFloor: number;
  factRelevanceFloor: number;
  maxFactsPerUrl: number;
};

const DEFAULTS: RefreshConfig = {
  plannerMaxQueries: 5,
  assembleCandidatesPerSource: 10,
  refreshCandidatesPerSource: 6,
  candidateScoreFloor: 0.4,
  factRelevanceFloor: 0.5,
  maxFactsPerUrl: 20,
};

/** Positive finite number from an env string, else the default. */
function num(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function resolveRefreshConfig(env: Record<string, string | undefined>): RefreshConfig {
  return {
    plannerMaxQueries: num(env.VEILLE_PLANNER_MAX_QUERIES, DEFAULTS.plannerMaxQueries),
    assembleCandidatesPerSource: num(env.VEILLE_ASSEMBLE_CANDIDATES, DEFAULTS.assembleCandidatesPerSource),
    refreshCandidatesPerSource: num(env.VEILLE_REFRESH_CANDIDATES, DEFAULTS.refreshCandidatesPerSource),
    candidateScoreFloor: num(env.VEILLE_CANDIDATE_SCORE_FLOOR, DEFAULTS.candidateScoreFloor),
    factRelevanceFloor: num(env.VEILLE_FACT_RELEVANCE_FLOOR, DEFAULTS.factRelevanceFloor),
    maxFactsPerUrl: num(env.VEILLE_MAX_FACTS_PER_URL, DEFAULTS.maxFactsPerUrl),
  };
}

/** Resolved config from the live environment (admin overrides via VEILLE_* env). */
export function getRefreshConfig(): RefreshConfig {
  return resolveRefreshConfig(process.env as Record<string, string | undefined>);
}
```
(Reads `process.env` directly — these are optional admin overrides, not required env, so they don't belong in `lib/env.ts`'s required-key zod schema. Floors are expected > 0; a `0` override falls back to default, which is fine.)

Run `pnpm test -- refresh-config` → PASS.

- [ ] **Step 3: Commit.**
```bash
git add apps/web/lib/refresh-config.ts apps/web/lib/refresh-config.test.ts
git commit -m "feat(web): RefreshConfig — env-overridable depth/recency knobs"
```

---

## Task 2: `isRecentCandidate` helper (TDD, additive)

**Files:** Modify `apps/web/lib/temporal.ts`, `apps/web/lib/temporal.test.ts`.

This task is **purely additive** — it adds `isRecentCandidate` and keeps `classify`/`countPendingRebuild` untouched so typecheck/tests stay green. Their removal (and the deletion of their test blocks + the `Stream` type) happens in **Task 6**, after their callers are gone. `parseDate(s: unknown)` already returns `null` for `undefined`, so the call below type-checks.

- [ ] **Step 1: Failing test** — add `isRecentCandidate` to the existing `import { … } from './temporal'` line in `temporal.test.ts`, then append:
```ts
describe('isRecentCandidate', () => {
  const last = new Date('2026-05-29T00:00:00Z');
  it('undated → recent (benefit of the doubt)', () => {
    expect(isRecentCandidate(undefined, last)).toBe(true);
  });
  it('published after last refresh → recent', () => {
    expect(isRecentCandidate('2026-05-30', last)).toBe(true);
  });
  it('published on/before last refresh → not recent', () => {
    expect(isRecentCandidate('2025-08-15', last)).toBe(false);
    expect(isRecentCandidate('2026-05-29T00:00:00Z', last)).toBe(false);
  });
  it('null lastRefresh → recent', () => {
    expect(isRecentCandidate('2020-01-01', null)).toBe(true);
  });
});
```
Run `pnpm test -- temporal` → FAIL (`isRecentCandidate` is not exported).

- [ ] **Step 2: Implement.** In `temporal.ts`, add (do NOT remove anything else this task):
```ts
/** A refresh candidate is "recent" if it has no usable date (unseen + recency-biased
 *  search ⇒ likely new) or it was published after the last refresh. */
export function isRecentCandidate(publishedAt: string | undefined, lastRefresh: Date | null): boolean {
  if (!lastRefresh) return true;
  const d = parseDate(publishedAt);
  return d === null || d > lastRefresh;
}
```
Run `pnpm test -- temporal` → PASS. `pnpm --filter @veille/web typecheck` → clean (additive only).

- [ ] **Step 3: Commit.**
```bash
git add apps/web/lib/temporal.ts apps/web/lib/temporal.test.ts
git commit -m "feat(web): isRecentCandidate recency predicate"
```

---

## Task 3: `refreshDossier` phase + config knobs

**Files:** Modify `apps/web/lib/refresh.ts`, `apps/web/app/api/dossiers/[slug]/assemble/route.ts`, `.../refresh/route.ts`.

- [ ] **Step 1: Config + phase in `refreshDossier`.** Read the current `refresh.ts`. Replace the top-of-file constants (`MAX_CANDIDATES_PER_SOURCE`, `CANDIDATE_SCORE_FLOOR`, `FACT_RELEVANCE_FLOOR`, `MAX_FACTS_PER_URL`) usage with config. Add the import + read config at the top of `refreshDossier`:
```ts
import { getRefreshConfig } from './refresh-config';
// …
export async function refreshDossier(
  dossierId: string,
  opts: { phase?: 'assemble' | 'refresh'; force?: boolean; language?: string; onProgress?: (p: RefreshProgress) => void } = {},
): Promise<{ total: number; added: number }> {
  const cfg = getRefreshConfig();
  const phase = opts.phase ?? 'refresh';
  const candidatesPerSource = phase === 'assemble' ? cfg.assembleCandidatesPerSource : cfg.refreshCandidatesPerSource;
  // …
```
Then: in the standing-source ranking, replace `.slice(0, MAX_CANDIDATES_PER_SOURCE)` → `.slice(0, candidatesPerSource)`; replace `CANDIDATE_SCORE_FLOOR` → `cfg.candidateScoreFloor`; `FACT_RELEVANCE_FLOOR` → `cfg.factRelevanceFloor`; `MAX_FACTS_PER_URL` → `cfg.maxFactsPerUrl` (both branches). Delete the now-unused `const` declarations.

- [ ] **Step 2: Routes pass phase.** In `assemble/route.ts`: `refreshDossier(dossier.id, { phase: 'assemble', language: dossier.language ?? 'fr', onProgress: send })`. In `refresh/route.ts`: `{ phase: 'refresh', … }`.

- [ ] **Step 3: Typecheck.** `pnpm --filter @veille/web typecheck` → clean. Commit:
```bash
git add apps/web/lib/refresh.ts "apps/web/app/api/dossiers/[slug]/assemble/route.ts" "apps/web/app/api/dossiers/[slug]/refresh/route.ts"
git commit -m "feat(web): refreshDossier phase (assemble deep / refresh) + config-driven depth"
```

---

## Task 4: Recency filter on refresh

**Files:** Modify `apps/web/lib/refresh.ts`.

- [ ] **Step 1: Compute lastRefresh + days, filter candidates.** Add `import { isRecentCandidate } from './temporal';` at the top of `refresh.ts`. In `refreshDossier`, after loading `dossier`, compute (only meaningful for refresh phase):
```ts
const lastRefresh = phase === 'refresh' ? (dossier.refreshedAt ?? dossier.briefGeneratedAt ?? null) : null;
const daysSince = lastRefresh ? Math.max(1, Math.ceil((Date.now() - lastRefresh.getTime()) / 86_400_000)) : undefined;
```
Update `candidatesFor` to accept a `days` override for Tavily:
```ts
async function candidatesFor(source: SourceRow, daysOverride?: number): Promise<Candidate[]> {
  if (source.connector === 'tavily') {
    const input = daysOverride ? { ...(source.input as object), days: daysOverride } : source.input;
    return discoverTavily(input as never);
  }
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}
```
Call it with `candidatesFor(src, daysSince)` in the standing branch. Then, in the standing branch, after building `ranked` (and before/within the candidate loop), drop non-recent candidates **when** `phase === 'refresh'`:
```ts
const recencyFiltered = phase === 'refresh'
  ? ranked.filter((c) => isRecentCandidate(c.publishedAt, lastRefresh))
  : ranked;
// then iterate freshCandidates(recencyFiltered, seenUrls)
```
(Item/manual sources: untouched — they bypass the recency filter.)

- [ ] **Step 2: Typecheck + commit.** `pnpm --filter @veille/web typecheck` → clean.
```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): recency filter on refresh (Tavily days + publishedAt; keep undated; manual bypass)"
```

---

## Task 5: Journal — single clean stream (drop links + split)

**Files:** Modify `apps/web/lib/synthesis.ts` (+ `synthesis.test.ts`), `apps/web/components/journal.tsx`, `apps/web/app/dossier/[slug]/page.tsx`.

- [ ] **Step 1: `buildUpdatePrompt` — clean prose, no links, no `stream`.** Replace the function (drop the `stream` param + the framing + the markdown-link line):
```ts
export function buildUpdatePrompt(subject: string, language: string, brief: string, newGroups: SourceGroup[]): string {
  return [
    'You write a short dated "what\'s new" note for an existing dossier.',
    `Subject: ${subject}`,
    `Write in: ${language}. Output Markdown prose in the "update" field.`,
    'Below is the EXISTING brief (context) and only the NEW facts since the last update.',
    'Write a brief, clean note describing what these new facts add or change. Plain prose — do NOT add Markdown links, URLs, or citations (sources are shown separately). If nothing material, keep it to a sentence.',
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

- [ ] **Step 2: `composeDossier` update path — one entry, no split.** Replace the `buckets` loop with a single update (remove the `classify` import):
```ts
  // update — one clean "nouveautés" entry over the run's new facts (no recency split here;
  // the refresh phase already constrained extraction to recent docs).
  onProgress({ type: 'synthesis', phase: 'update', state: 'start' });
  const groups = groupFactsByHost(newRows.map(toFact));
  const res = await client.complete(buildUpdatePrompt(subject, language, dossier.brief ?? '', groups), { jsonSchema: UPDATE_SCHEMA });
  const { body, sourceNotes } = parseUpdate(res.text);
  const allowedUrls = new Set(newRows.map((r) => r.sourceUrl));
  const safeBody = body ? stripUnknownLinks(body, allowedUrls) : body; // guard: unlink any stray hallucinated link
  if (safeBody) await addUpdate(dossierId, safeBody, newRows.length, sourceNotes);
  onProgress({ type: 'synthesis', phase: 'update', state: 'done' });
  return { wrote: 'update' };
```
(`addUpdate` keeps its `kind` param defaulting to `'actualite'` — the vestigial column gets a harmless value. Remove the top-level `import { classify } from './temporal'`. `stripUnknownLinks` stays imported/used — it's already in this file and acts as a guard if the model emits a stray link despite the prompt.)

- [ ] **Step 3: `synthesis.test.ts`** — replace the `buildUpdatePrompt framing` describe block with:
```ts
describe('buildUpdatePrompt', () => {
  const g = [{ host: 'lemonde.fr', facts: [] }];
  it('asks for clean prose with no links/citations', () => {
    const p = buildUpdatePrompt('X', 'fr', 'b', g);
    expect(p).toMatch(/do NOT add Markdown links/);
    expect(p).toContain('lemonde.fr');
  });
});
```
Run `pnpm test -- synthesis` → PASS.

- [ ] **Step 4: `journal.tsx` — single clean stream.** Replace the file:
```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { proseComponents } from './prose';

export type JournalEntry = { id: string; when: string; body: string };

/** Dossier journal — a single dated "nouveautés" stream of clean prose. Sources live in the
 *  Documents tab; the journal carries no inline citations. */
export function Journal({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Nouveautés</h2>
        </div>
      </div>
      <div className="journal">
        {entries.map((u) => (
          <div key={u.id} className="update fade">
            <div className="when">{u.when}</div>
            <div className="body">
              <ReactMarkdown components={proseComponents}>{u.body}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```
(Keep `'use client'` — `ReactMarkdown` + `proseComponents` render client-side, matching the current journal. No hooks/citations now, so the component is otherwise trivial.)

- [ ] **Step 5: `page.tsx`** — `<Journal entries={updates.map((u) => ({ id: u.id, when: formatDateFr(new Date(u.createdAt)), body: u.body }))} />` (drop `kind` + `citations` props). The brief stays inside `CitationsProvider`.

- [ ] **Step 6: Typecheck + commit.** `pnpm --filter @veille/web typecheck` → clean.
```bash
git add apps/web/lib/synthesis.ts apps/web/lib/synthesis.test.ts apps/web/components/journal.tsx "apps/web/app/dossier/[slug]/page.tsx"
git commit -m "feat(web): journal as a single clean-prose stream (no inline citations); drop two-stream split"
```

---

## Task 6: Deeper planner + remove Spec B + `classify`/`countPendingRebuild`

**Files:** `packages/discovery/src/plan-dossier.ts`, `apps/web/app/api/dossiers/route.ts`, `apps/web/components/rebuild-proposal.tsx` (delete), `apps/web/lib/dossiers.ts`, `apps/web/app/dossier/[slug]/actions.ts`, `apps/web/lib/temporal.ts` (+ test).

- [ ] **Step 1: Planner `maxQueries`.** In `packages/discovery/src/plan-dossier.ts`, add a `maxQueries` param (default 3 for back-compat) to `planDossier`'s options and interpolate it into the prompt line ("up to 3 sharp Tavily web-search queries" → ``up to ${maxQueries} sharp Tavily web-search queries``). Rebuild: `pnpm -r --filter "./packages/*" build`.

- [ ] **Step 2: New-dossier passes config.** In `apps/web/app/api/dossiers/route.ts` (line ~15), `import { getRefreshConfig } from '@/lib/refresh-config';` and `const plan = await planDossier({ intent, language: 'fr', maxQueries: getRefreshConfig().plannerMaxQueries });`.

- [ ] **Step 3: Remove the rebuild proposal.** Delete `apps/web/components/rebuild-proposal.tsx`. In `page.tsx`: remove the `RebuildProposal` import, the `pendingRebuildCount` import + its `Promise.all` entry + the `<RebuildProposal …/>` render. In `lib/dossiers.ts`: remove `pendingRebuildCount` and `dismissBriefSuggestion` (+ the `countPendingRebuild` import). In `actions.ts`: remove `dismissBriefSuggestionAction` (+ the `dismissBriefSuggestion` import).

- [ ] **Step 4: Remove `classify` + `countPendingRebuild`.** In `temporal.ts`: delete `classify`, `countPendingRebuild`, and the `Stream` type (now unused). In `temporal.test.ts`: delete the `classify` + `countPendingRebuild` describe blocks and drop them from the import (keep `parseDate`/`factPublishedAt`/`backfillPublishedAt`/`isRecentCandidate`). Grep to confirm no remaining importers of `classify`/`countPendingRebuild`/`dismissBriefSuggestion`/`pendingRebuildCount`.

- [ ] **Step 5: Typecheck + tests + commit.** `pnpm --filter @veille/web typecheck` → clean; `pnpm test` → all pass.
```bash
git add -A packages/discovery apps/web/lib apps/web/app apps/web/components
git commit -m "feat: deeper planner (maxQueries) + remove brief-rebuild proposal, classify, two-stream remnants"
```

---

## Task 7: Gate + merge

- [ ] **Step 1: Stop dev** — tree-kill :3000 (`Get-NetTCPConnection -LocalPort 3000 … | taskkill /PID <pid> /T /F`); confirm free.
- [ ] **Step 2: Gate.** `rm -rf apps/web/.next && pnpm --filter @veille/web typecheck && pnpm test && pnpm --filter @veille/web build` → all green.
- [ ] **Step 3: Restart dev** — `rm -rf apps/web/.next && pnpm --filter @veille/web dev` (background).
- [ ] **Step 4: Live check.** Create a NEW dossier → confirm ~5 standing queries + a deeper first run (more documents); a refresh surfaces only recent docs into a single clean "Nouveautés" journal; no Compléments section, no rebuild banner. (Existing Attal: delete its stale Compléments entry if desired.)
- [ ] **Step 5: Merge.**
```bash
git checkout main
git merge --no-ff feat/watcher-refresh -m "Merge feat/watcher-refresh: new-publication watcher model (deep assemble, recent-only refresh)"
git branch -d feat/watcher-refresh
```
- [ ] **Step 6: Memory.** Note the watcher reframe in `presentation-q-series.md` / the index (supersedes Q1+Q2 Compléments + Spec B).

---

## Notes
- Vestigial columns `dossier_updates.kind` + `dossiers.briefSuggestionDismissedAt` are **left** (no DROP migration); the code no longer reads/writes them meaningfully (`addUpdate` still sets `kind='actualite'` harmlessly).
- Applies to new dossiers / future assembles; existing dossiers keep their planned queries.
- The recency filter is candidate-level (standing sources); manual item sources always extract.
