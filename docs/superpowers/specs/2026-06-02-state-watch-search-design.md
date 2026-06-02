# State-vs-Watch search + "mode recherche" (③) — design

- **Date:** 2026-06-02
- **Status:** Approved (design); pending implementation plan
- **Milestone:** Curation reframe — phase ③ of ④ (① layout `f7624c6`, ② curation core `1d952a7` shipped; ④ journal-as-curated-list + optional note remains).
- **Scope:** Split discovery into a **state** query set (broad, builds the initial corpus on assemble) and a **watch** set (news-flavored, recent, drives refresh), tagged on `sources`. Add a **"mode recherche"** — a one-off manual query that pulls candidates into the Suggestions tray without saving a source.

## Motivation

A query that finds the best *overview* sources for a subject is not the query that finds *this week's developments*. ② already biases refresh with a recency window, but reuses the same planned queries. ③ makes the two purposes first-class: the planner writes distinct state + watch queries, the right set runs in the right phase, and the user can fire ad-hoc searches to grow the curated set.

## Decisions (from brainstorming)
1. **Two distinct tagged query sets** — `sources.purpose: 'state' | 'watch'`; the planner produces both; assemble uses state, refresh uses watch; editable/visible.
2. **Mode recherche = one-off pull → Suggestions** — runs the content+relevance pull on a single ad-hoc query; results land in Suggestions (not saved as a source).
3. Feeds (RSS / YouTube-channel) are **watch** by nature.

## Design

### 1. `sources.purpose` ('state' | 'watch')
- New column on `sources`: `purpose text not null default 'state'`.
- The planner's Tavily **state** queries → `purpose='state'`; **watch** queries → `purpose='watch'` (stored with `topic:'news'` + a `days` default in their jsonb `input`).
- Feeds added via "Ajouter une source": RSS / YouTube-channel default `purpose='watch'`; a "web" item URL is an `item` source (unaffected — items always extract). "Recherche" (Tavily) added manually defaults `purpose='watch'`.
- Migration backfills existing sources to `'state'` (the default); the refresh fallback (below) keeps legacy refresh working.

### 2. Planner produces both sets — `@veille/discovery` `plan-dossier.ts`
- `planDossier({intent, language, maxQueries})` returns, in addition to `template`/`cadence`, **two query arrays**: `stateQueries` (broad, comprehensive — today's behavior) and `watchQueries` (recency/news-framed — "dernières actualités / annonces / {year}" style phrasings). The prompt asks for both, **each up to `maxQueries`** — since state runs only on assemble and watch only on refresh, the per-phase query count is unchanged from today (≈5), not doubled. *(Integration point: read the current `DossierPlan` return shape; extend it additively — keep `queries`/back-compat if other code reads it, or migrate the single caller.)*
- The new-dossier route (`apps/web/app/api/dossiers/route.ts`) stores state queries as `purpose='state'` Tavily sources and watch queries as `purpose='watch'` Tavily sources (the latter with `input.topic='news'` + `input.days` default).

### 3. Phase → purpose mapping — `apps/web/lib/refresh.ts`
- In `refreshDossier`, filter `srcRows` by phase: **assemble** processes `purpose='state'` standing sources (+ item sources as today); **refresh** processes `purpose='watch'` standing sources (+ items). The existing `needs` gate (standing always; item if `!lastExtractedAt || force`) still applies within the filtered set.
- **Fallback:** on refresh, if there are **no** `purpose='watch'` standing sources (legacy dossier, or none planned), fall back to the `purpose='state'` standing sources (with the existing recency window) — so legacy dossiers keep refreshing. (assemble has no fallback — state-only is the corpus build.)

### 4. Mode recherche — one-off ad-hoc pull
- A server action `adHocPullAction(slug, query)` (or an SSE endpoint, matching the assemble/refresh pattern): runs the ② pull-curate pipeline over a **single ad-hoc Tavily query** — `discoverTavily({query})` → cap/score-floor → for each candidate `processCandidate` (content-only fetch → `scoreRelevance` → `upsertDocument` with status). Documents land in the feed/suggestions by the usual `relevanceKeepFloor`. **No source is created.**
- Reuses `refreshDossier`'s per-candidate logic. Cleanest: extract the candidate-processing into a reusable path so the ad-hoc pull and the standing pull share it (avoid duplicating fetch+score+upsert). Dedup against existing document URLs (the `seenUrls` seed) so it doesn't re-pull.
- **UI:** a search input on the unified dossier page (in the rail, near the actions, or above the Suggestions tray) → calls the action via `useTransition` (or opens an SSE for progress) → `router.refresh()`/revalidate so new suggestions appear. A pending state ("Recherche…").

### 5. Editable / visible
- The rail's source list (in `dossier-runtime.tsx`'s SourcesPanel) shows each standing source's **purpose** (a small "état"/"veille" badge). Add/edit/remove unchanged. "Ajouter une source → Recherche" sets `purpose='watch'` by default (a future toggle could let the user choose; not required now).

### 6. Backfill
- Migration: `ALTER TABLE sources ADD COLUMN purpose text NOT NULL DEFAULT 'state'`. Existing sources → 'state'. Combined with the §3 refresh fallback, legacy dossiers keep working (refresh falls back to their state sources). New dossiers get proper state/watch tagging.

## Edge cases
- **Refresh with no watch sources** → fallback to state sources + recency window (§3).
- **Ad-hoc query returns nothing / all below threshold** → all land in suggestions (or none); a quiet "aucun résultat" state.
- **Ad-hoc pull dedup** → seed seenUrls from existing documents so it doesn't re-pull/re-score already-curated URLs.
- **assemble with no state sources** (shouldn't happen — planner always produces state) → nothing pulled; the empty-state CTA applies.

## Testing & verification
- **Unit (vitest):** the planner's two-set output parsing (if a parser is added); a pure helper for the phase→purpose source filter (e.g. `sourcesForPhase(srcRows, phase)` → which sources run, incl. the watch-fallback) — TDD it.
- **Live:** new dossier → state queries build the corpus on assemble; refresh surfaces recent items via the watch queries; "mode recherche" with a manual query adds suggestions; legacy dossier still refreshes (fallback).
- **Gate:** typecheck · `pnpm test` · build (dev stopped) · migration applied to veille_dev.

## Out of scope
- ④ (journal-as-curated-list + optional note).
- A per-source purpose toggle in the add-source dialog (default watch for manual searches; revisit later).
- Cadence/scheduling (M2).

## Integration points to resolve in the plan
1. The `DossierPlan` return shape + `planDossier`'s single call site (extend to two sets, rebuild `@veille/discovery`).
2. `refreshDossier`'s `srcRows` selection + the cleanest way to share the per-candidate pull logic between standing pulls and the ad-hoc pull.
3. Where the mode-recherche input lives on the unified page + action vs SSE (transition+revalidate is simplest; SSE if progress matters).
