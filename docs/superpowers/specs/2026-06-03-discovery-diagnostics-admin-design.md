# Discovery diagnostics + tuning admin — design

- **Date:** 2026-06-03
- **Status:** Approved (design); pending implementation plan
- **Scope:** A standalone `/admin` tool to (1) **see** the discovery funnel of every refresh (what was found, why each candidate was kept / suggested / rejected) and (2) **fine-tune** the knobs (recency window, candidate score floor, relevance keep floor) against a live run.

## Motivation

Discovery is a black box: a refresh keeps "1 document" and the user can't see what was found or why the rest was dropped. The throwaway probe scripts already produce the funnel; this productizes them into an auditable, tunable tool. Two halves (both requested): **persist** each refresh's funnel (history) + a **live re-run with knob sliders** (tuning).

## Design

### 1. Storage — `refresh_runs` (migration)

New table:
- `id` uuid pk · `dossier_id` uuid FK→dossiers (cascade) · `created_at` timestamptz default now
- `params` jsonb — `{ recencyDays, relevanceKeepFloor, candidateScoreFloor }` (what this run used)
- `counts` jsonb — `{ raw, kept, suggestion, rejected }`
- `funnel` jsonb — `FunnelEntry[]`

```ts
type FunnelVerdict =
  | 'kept' | 'suggestion'
  | 'rejected:score' | 'rejected:low-rank' | 'rejected:recency' | 'rejected:seen' | 'rejected:no-content';
type FunnelEntry = {
  query: string; url: string; title?: string; publishedAt?: string; siteName?: string;
  providerScore?: number;          // Tavily score (google-news/rss are unscored)
  verdict: FunnelVerdict;
  relevance?: number;              // LLM relevance (only for candidates that were fetched + scored)
  relevanceReason?: string;
};
```

### 2. Instrument `refreshDossier` to record the funnel

- `processCandidate` returns `{ status, relevance, reason }` (was just `status`) so the loop can record the relevance score.
- In the standing-source branch, replace the silent filter chain with a **tagging** pass that pushes a `FunnelEntry` for every raw candidate (post-shorts) at the stage it exits:
  - below `candidateScoreFloor` → `rejected:score`
  - beyond `candidatesPerSource` after the score-sort → `rejected:low-rank`
  - fails the recency window → `rejected:recency`
  - already in `seenUrls` → `rejected:seen`
  - no URL adapter → `rejected:no-content`
  - fetched + scored → `kept` / `suggestion` (+ relevance/reason)
- Accumulate across all sources into a `runFunnel`, then `insertRefreshRun(dossierId, { params, counts, funnel })` at the end of a refresh (only `phase === 'refresh'`). No extra LLM calls — it records decisions already being made.
- Funnel size is bounded (~maxResults × #sources ≈ tens of entries); store as one jsonb row.

### 3. Live probe API — `POST /api/admin/discovery`

`{ slug }` → owner check (session user owns the dossier) → run a **dry** discovery for the dossier's standing sources:
- For each source, discover candidates; for the top `maxResults` per source (a generous cap, e.g. 10 — wider than a normal refresh so lowering a slider can reveal more), **fetch content + score relevance** but **do NOT upsert documents** (dry run).
- Return `{ candidates: ProbeCandidate[] }` where `ProbeCandidate = { query, url, title, publishedAt, siteName, providerScore, relevance, relevanceReason }` — **unbucketed** (no thresholds applied), so the client can re-bucket as the sliders move.
- A shared `runDiscoveryProbe(dossier, sources, { perSource })` in `lib/diagnostics.ts` holds this (reuses `candidatesFor` + `extract` + `scoreRelevance`). Slow (~60s) — it's an explicit, user-triggered action.

### 4. `/admin` page

- `app/admin/page.tsx` (server, auth-gated): lists the session user's dossiers; pick one → `/admin/[slug]`.
- `app/admin/[slug]/page.tsx`: loads the dossier + its `refresh_runs`; renders a client `DiagnosticsView` with two tabs:
  - **Historique** — each `refresh_run` (newest first): the params used + a funnel table (`verdict · query · publication · date · providerScore · relevance · title`), color-coded by verdict. Answers "why only 1 kept".
  - **Tester** — a **"Lancer"** button → `POST /api/admin/discovery` → the unbucketed candidates. Three **sliders** (recency days · candidate score floor · relevance keep floor) **re-bucket the fetched candidates instantly** client-side (pure function `bucket(candidate, knobs) → verdict`), showing live kept/suggestion/rejected counts + the table. A footer shows the **`VEILLE_*` env values** for the chosen knob settings (to make them permanent).
- **Auth:** owner-scoped to the logged-in user's dossiers; no role system (fine for now). A small "Admin" link in the top bar.

### Shared pure helper

`bucket(c: { providerScore?: number; publishedAt?: string; relevance?: number }, knobs: { recencyDays; candidateScoreFloor; relevanceKeepFloor }, now: Date) → FunnelVerdict` — the single source of truth for verdict, used by the Tester re-bucketing (and mirrors the refresh loop's logic). Unit-tested.

## Edge cases

- **No refresh_runs yet** → Historique shows "aucun rafraîchissement enregistré".
- **Probe returns nothing** (sources empty / all decode-fail) → Tester shows "aucun candidat".
- **Funnel for non-standing item sources** → only standing sources are probed/recorded (items extract once; not part of discovery tuning).
- **Large funnel** → cap stored entries per run (e.g. 200) to keep the jsonb bounded; note if truncated.
- **Relevance unavailable** (content fetch failed) → `relevance` null; bucket treats null as below keep-floor (suggestion/rejected).

## Testing & verification

- **Unit (vitest, pure):** `bucket(candidate, knobs, now)` across the verdict branches (score floor, recency, relevance keep floor, undated). The funnel-tagging logic if extracted into a pure `classifyCandidates(...)` helper.
- **Live:** refresh a dossier → a `refresh_runs` row appears; `/admin/[slug]` Historique shows the funnel matching reality (e.g. the "kept 1" run shows the recency/relevance drops). Tester → Lancer → move sliders → counts re-bucket; env hints update.
- **Gate:** typecheck · `pnpm test` · build · migration applied to `veille_dev`.

## Out of scope

- A role-based admin system (owner-scoped is enough).
- Writing knob changes back to env from the UI (it only *shows* the values to set).
- Tuning the planner / brief / journal from here (discovery only).
- Persisting the live-probe results (the Tester is ephemeral; Historique is the persisted half).

## Build order

1. `refresh_runs` table + migration; `processCandidate` returns relevance; instrument `refreshDossier`; `insertRefreshRun`. (The persisted half.)
2. `bucket` pure helper + test.
3. `/admin` + `/admin/[slug]` Historique view.
4. `runDiscoveryProbe` + `POST /api/admin/discovery`.
5. Tester tab (Lancer + sliders + re-bucket + env hints).
6. Gate.

## Integration points to resolve in the plan

1. The cleanest tagging refactor of `refreshDossier`'s standing branch (keep it readable; consider a `classifyCandidates` pure helper fed the raw cands + knobs + seenUrls + perSource).
2. `processCandidate` signature change + its two call sites (standing + item) + `pullAdHoc`.
3. `runDiscoveryProbe` reusing `candidatesFor` (needs the dossier language) + `extract`/`scoreRelevance` without upserting.
4. Admin route auth + the top-bar link.
