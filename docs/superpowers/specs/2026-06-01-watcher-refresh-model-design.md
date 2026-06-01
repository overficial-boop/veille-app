# Refresh model: new-publication watcher (deep first run, recent-only refresh)

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Scope:** Reframe the refresh model so Veille **watches for new publications** rather than continuously rebuilding the brief. Go **deep** on the first run (assemble); on refresh, surface only **recently-published** documents (since last refresh) + manual entries. Drop the two-stream journal's **Compléments** half and the **brief-rebuild proposal** (Spec B). Depth knobs become an **adjustable config**.
- **Reverses:** parts of Q1+Q2 (the Compléments stream + `classify`) and all of Spec B (the rebuild-proposal banner). Keeps: the document-centric view, the brief + its Q4 citations, the single-stream journal (now "nouveautés").

## Motivation

The Compléments / Découvertes stream existed only because the first run's shallow search (top-6 per query, ~3 queries) missed documents that later refreshes surfaced as "old." The right fix is to **not miss them**: search deep on the first run. Then refresh becomes a true watcher — only genuinely new publications since last time, plus anything the user adds manually. Veille's identity is **following new publications over time, not perfecting a brief**. With this, the old-missed problem disappears, so the Compléments stream and the brief-rebuild proposal (built to handle old-missed) are unnecessary.

A secondary win: the journal's inline-citation rendering (hidden superscripts replacing `[source]` link text → "selon …nothing") goes away — the journal becomes clean prose; sources live in the Documents tab.

## Decisions (from brainstorming)

1. **Two phases**, same `refreshDossier`: assemble = **deep**, refresh = **recent-only**.
2. **Deep first run**: planner makes up to **5** queries (was 3); assemble mines **10** docs/query, refresh **6**. All depth knobs configurable (admin via env now, per-user later).
3. **Recency on refresh**: Tavily `days` ≈ days since last refresh; keep candidates published after last refresh, **keep undated**; seen-URL dedup prevents repeats. **Manual** (item) sources always extracted. Assemble = no recency filter.
4. **Journal = single clean stream**: drop Compléments; one dated "nouveautés" entry per refresh, **clean prose with no inline citations**; new sources appear in the Documents tab.
5. **Remove the brief-rebuild proposal (Spec B)** entirely.
6. **Vestigial columns** `dossier_updates.kind` and `dossiers.briefSuggestionDismissedAt` are **left in place** (code removed; no DROP migration).

## Design

### 1. Depth config — `apps/web/lib/refresh-config.ts` (new)
```ts
export type RefreshConfig = {
  plannerMaxQueries: number;          // default 5
  assembleCandidatesPerSource: number; // default 10
  refreshCandidatesPerSource: number;  // default 6
  candidateScoreFloor: number;         // default 0.4
  factRelevanceFloor: number;          // default 0.5
  maxFactsPerUrl: number;              // default 20
};
```
A `getRefreshConfig(): RefreshConfig` reads defaults, overridden by env (e.g. `VEILLE_PLANNER_MAX_QUERIES`, `VEILLE_ASSEMBLE_CANDIDATES`, …) parsed/validated in `lib/env.ts`. Structured so a future per-user/per-dossier source can replace the env read. `refresh.ts` replaces its hardcoded `MAX_CANDIDATES_PER_SOURCE` / floor constants with values from this config.

### 2. Phase-gated `refreshDossier`
`refreshDossier(dossierId, { phase: 'assemble' | 'refresh', language?, onProgress? })`.
- The **assemble** route passes `phase:'assemble'`; the **refresh** route passes `phase:'refresh'`.
- `candidatesPerSource = phase === 'assemble' ? cfg.assembleCandidatesPerSource : cfg.refreshCandidatesPerSource` (replaces the fixed cap in the standing-source ranking `slice`).
- Recency filter applies only when `phase === 'refresh'` (see §3).

### 3. Recency filter (refresh phase, standing sources only)
- Compute `daysSince = max(1, ceil((now - lastRefresh) / 1 day))` where `lastRefresh = dossier.refreshedAt ?? briefGeneratedAt`. Pass `days: daysSince` into `discoverTavily` (override the source's stored `days`) so Tavily biases recent. (RSS/YouTube-channel: no `days`; rely on the post-filter + dedup.)
- After discovery, keep a candidate iff: `candidate.publishedAt` is **absent** (undated → keep) **or** `parseDate(candidate.publishedAt) > lastRefresh`. Drop candidates clearly published on/before `lastRefresh`.
- Existing `freshCandidates` (skip already-seen URLs) + the score floor still apply.
- **Item (manual) sources** bypass the recency filter entirely — always extracted (gated only by the existing `!lastExtractedAt || force`).
- Assemble phase: no recency filter; the source's planned `days`/`topic` are used as-is.

### 4. Deeper planner
`@veille/discovery` planner (`plan-dossier.ts`) currently asks for "up to 3" queries. Accept a `maxQueries` param (default from config) and reflect it in the prompt ("up to N sharp queries"). The new-dossier creation flow passes `getRefreshConfig().plannerMaxQueries`. *(Integration point: locate the planner call site in the new-dossier action; the array schema already allows N items — only the prompt wording + a param change. Package change is additive; rebuild `@veille/discovery`.)*

### 5. Journal — single clean stream
- `synthesis.ts` update path: **no actualite/complement split** — one `addUpdate` over the run's new facts. `buildUpdatePrompt` **drops** the "Attribute each claim with a Markdown link…" instruction and the `stream` param; it asks for a short, clean "what's new" note in prose, **no links/citations**. (Sources are the documents.)
- `journal.tsx`: render a **single** section ("Journal" / "Nouveautés"), entries via plain `Prose` (proseComponents) — **no** `citeComponents`, no superscripts, no `SourcesToggle`, no `CitationsProvider` dependency for the journal. (The brief still uses `CitationsProvider` + Q4 citations.) The `kind` field is ignored (all entries shown together, newest-first).
- `page.tsx`: `<Journal>` no longer needs `citations`; keep the brief inside `CitationsProvider`.

### 6. Remove the brief-rebuild proposal (Spec B)
Delete `components/rebuild-proposal.tsx`; remove its render + `pendingRebuildCount` import/usage in `page.tsx`; remove `pendingRebuildCount` + `dismissBriefSuggestion` from `lib/dossiers.ts`; remove `dismissBriefSuggestionAction` from `actions.ts`; remove `countPendingRebuild` from `temporal.ts` + its tests. The `.rebuild-proposal` CSS can stay or be removed (harmless). `briefSuggestionDismissedAt` column left vestigial.

### 7. Cleanup
- Remove `classify` from `temporal.ts` + its tests (no longer used: the split is gone, `countPendingRebuild` is gone). **Keep** `parseDate`, `factPublishedAt`, `backfillPublishedAt` (used for document dates + the recency filter).
- `dossier_updates.kind` left vestigial (the journal ignores it; new entries default `'actualite'`).

## Edge cases
- **Existing dossiers** (e.g. Attal): keep their 3 planned queries (already assembled). Depth applies to **new** dossiers / future assembles. The current malformed Compléments entry renders fine under the single-stream journal (its `[Le Monde](url)` links become plain source-name links via `proseComponents`); it can be deleted as a test artifact.
- **First refresh with no `refreshedAt`**: use `briefGeneratedAt` as `lastRefresh`; if neither exists (no brief yet), treat as assemble depth (shouldn't happen — refresh implies a prior assemble).
- **All-undated recent results**: kept (benefit of the doubt); dedup prevents re-surfacing seen URLs.
- **Env override invalid/absent**: fall back to defaults.

## Testing & verification
- **Unit (vitest):** `getRefreshConfig` (defaults + env overrides + invalid→default); a pure recency-predicate helper `isRecentCandidate(publishedAt, lastRefresh)` (undated→true, after→true, on/before→false); updated `synthesis.test.ts` (update prompt = clean prose, no link instruction, no `stream` param); remove `classify`/`countPendingRebuild` tests.
- **Visual:** the single-stream journal renders clean prose (preview); the brief banner is gone.
- **Gate:** typecheck, `pnpm test`, production build (dev stopped). Live: create a **new** dossier → confirm ~5 standing queries + a deeper first run; a refresh surfaces only recent docs into the journal.

## Out of scope
- The brief's own citation model (unchanged — keeps Q4 superscripts + toggle).
- The documents/fiche view (unchanged).
- A settings UI for the config (env-only for now; per-user is future).

## Integration points to resolve in the plan
- The planner call site in the new-dossier creation flow (to pass `plannerMaxQueries`).
- Whether `discoverTavily` accepts a `days` override cleanly (it reads `config.days`; pass the computed `daysSince`).
