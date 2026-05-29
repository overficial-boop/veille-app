# Veille — Synthesis Presentation (the dossier as living written brief)

- **Date:** 2026-05-30
- **Status:** **Approved in brainstorm** (5 design decisions settled with the user 2026-05-30, §9). Pending the user's morning read-through of this spec before implementation.
- **Builds on:** M1 "The Body" (merged to `main`) + the relevance pass (subject-aware extraction, Tavily score filter, per-page cap — knobs `0.4 / 6 / 20 / 0.5`). Facts are now fewer and on-subject.

---

## 1. Goal

Stop showing dossiers as raw fact lists. Turn a dossier's facts into a **living written dossier**: a synthesized **"current situation" brief**, joined over time by **dated "what's new" update notes**, with the **facts demoted to cited evidence grouped by source**. The writing is the product; the facts are its audit trail.

This is the payoff of the relevance work: facts feed prose, prose is what the user reads.

## 2. Scope

**In:**
- A generated **brief** (current-situation synthesis) per dossier, source-attributed prose.
- A **dated update log** — each refresh that finds new facts auto-writes a "what's new" note.
- **On-demand brief regeneration** ("rewrite the brief" action).
- New **presentation**: dossier page is prose-first (brief + update log) with a collapsible **Sources & evidence** zone (facts grouped by source, each source with a one-line blurb + verbatim passages).
- Generation woven into the existing SSE assemble/refresh loop (you watch it compose), streamed.

**Out (explicitly):**
- **Temporal stance** (current/future/both classification) — deferred to when automatic cadence (M2) lands. Every dossier gets the same brief + update-log treatment.
- **Per-fact inline citations** — we use **source-level attribution** ("selon Le Monde…"), not per-claim fact-ID links. (Per-fact linking is a possible later refinement.)
- **Auto-rewriting the brief on every refresh** — the brief regenerates only on demand (cost choice); refreshes only append update notes.
- Automatic/scheduled refresh (M2), domain connectors (M3), shared library (M4).

## 3. The model (what the user reads)

1. **Brief** — the current-situation synthesis, written at first assembly from the (relevance-filtered) facts. Markdown prose, attributing to sources by name. Regenerated only when the user clicks **"Réécrire la synthèse."**
2. **Update log** — beneath the brief, dated notes newest-first. Each refresh that adds ≥1 new fact auto-writes one note: a short "what's new" delta, written with the existing brief as context + only the new facts.
3. **Sources & evidence** — collapsible, secondary. Facts **grouped by source**; each source shows a one-line "what it is / its angle" blurb + host, then its fact rows (text, date, confidence, expandable verbatim passage). The existing **Fil / Profil / Chronologie** switcher is retained here as alternate lenses on the facts; **"by source" is the new default grouping.**

## 4. Data model (migration `0004`, all additive)

- `dossiers.brief` — text, nullable. The current brief markdown.
- `dossiers.brief_generated_at` — timestamptz, nullable.
- **`dossier_updates`** (new table): `id` uuid pk, `dossier_id` uuid fk → dossiers (cascade), `body` text (markdown), `fact_count` int, `created_at` timestamptz default now().
- `sources.summary` — text, nullable. The one-line source blurb for the evidence panel.
- `facts` — unchanged (the evidence; relevance + provenance already present).

Store functions (in `apps/web/lib/dossiers.ts`, owner-scoped where user-facing): `listUpdates(dossierId)`, `setBrief(dossierId, markdown)`, `addUpdate(dossierId, body, factCount)`, `setSourceSummaries(updates: {sourceId, summary}[])`. (Owner scoping applies to the on-demand brief action via the route/action; engine-internal writes take a dossierId.)

## 5. Generation pipeline

New module **`apps/web/lib/synthesis.ts`** (uses `selectLlmClient` from core; no new LLM plumbing).

- **`composeDossier(dossierId, { mode, onProgress }) → { wrote: 'brief' | 'update' | 'none' }`**, `mode ∈ 'auto' | 'brief'`:
  1. Load the dossier, its facts (grouped by source — `sourceId → { source row, facts[] }`), and the existing brief.
  2. If **no facts** → `none`.
  3. If **`mode === 'brief'`** OR (**`auto`** and `dossier.brief` is null) → **generate the brief**: one LLM call over all facts grouped by source → write `dossiers.brief` + `brief_generated_at`, and fill `sources.summary` for each source. Returns `brief`.
  4. Else (**`auto`** with an existing brief): **generate an update note** from the facts **created since the last update note** (or since the brief, if there are no updates yet) — `composeDossier` derives this set by timestamp (`facts.created_at` vs the latest `dossier_updates.created_at` / `dossiers.brief_generated_at`), so it needs no fact-threading from the engine — plus the existing brief as context → insert a `dossier_updates` row (`fact_count` = that set's size) + fill `summary` for any newly-added sources. Returns `update`.
- **One LLM call per compose**, and only when there is something to write (empty refresh = zero synthesis spend).

**Prompts** (new, in `apps/web/lib/synthesis.ts` or `packages/core/prompts/` if shared): French markdown, concise, source-attributed.
- *Brief prompt:* given subject + facts grouped by source (with source labels, hosts, dates), write a tight current-situation brief in prose, attributing claims to sources by name; also emit a one-line blurb per source. Output **JSON** `{ brief: string, sources: { sourceId: string; summary: string }[] }` (markdown in `brief`, one blurb per source), parsed with the same defensive `parse()` fallback used by the planner/extractor.
- *Update prompt:* given subject + the existing brief (context) + only the new facts grouped by source, write a short dated "what's new" note describing what these facts add or change relative to the brief; attribute to sources. Output **JSON** `{ update: string, newSources?: { sourceId: string; summary: string }[] }`, same defensive parse.

**Woven into the loop:**
- `refreshDossier` returns **`{ total, added }`** (`added` = count of new facts persisted this run) — small additive change to `apps/web/lib/refresh.ts`.
- The SSE routes (`assemble`, `refresh`) run `refreshDossier(…, { onProgress })`, then if `added > 0` (or it's a first assembly with facts) call `composeDossier(id, { mode: 'auto', onProgress })`. Both stream through the **same SSE channel** — `RefreshProgress` gains a variant `{ type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' }` (or similar) so the client shows *"Rédaction de la synthèse…"*.
- **On-demand brief regen:** a server action `regenerateBriefAction(slug)` (owner-scoped) → `composeDossier(id, { mode: 'brief' })` → `revalidatePath`. (Synchronous action with a pending state is fine; or stream it — synchronous is simpler and acceptable.)

## 6. Presentation

- **`app/dossier/[slug]/page.tsx`** restructured to prose-first. Server loads dossier (with `brief`), `listUpdates`, `listSources` (with `summary`), `listFacts`. Render: header → **brief** (markdown) → **update log** (dated markdown notes, newest-first) → collapsible **Sources & evidence** (facts grouped by source: blurb + host + fact rows; the Fil/Profil/Chronologie switcher retained as alternate fact lenses).
- **Markdown rendering:** add **`react-markdown`**, rendered as a **restricted safe subset** (paragraphs, emphasis, lists, links; **no raw HTML**) to neutralize injection from model output. A small shared `<Prose>` component wraps it.
- **Controls** (extend `components/dossier-runtime.tsx`):
  - **Rafraîchir** (existing) now also auto-composes; the live progress panel gains the synthesis phase.
  - **Réécrire la synthèse** (new) — calls `regenerateBriefAction`, pending state, then `router.refresh()`.
  - Early states: assembling → live compose progress; facts-but-no-brief → a quiet compose affordance; empty update log → hidden.

## 7. Error handling

- **Synthesis failure is non-fatal.** Facts are already persisted by `refreshDossier`. A failed `composeDossier` emits a `synthesis-error` progress event and leaves the brief/update unwritten — retried on the next refresh or via the on-demand button. A refresh never fails because writing failed.
- **No facts → no brief** (empty state, not an error).
- **Markdown** rendered as a safe subset (no raw HTML / scripts).
- LLM JSON parse failure → same defensive `parse()` fallback pattern as the planner/extractor; on total failure, treat as `synthesis-error`.

## 8. Component boundaries

- **`lib/synthesis.ts`** — facts → prose. The only place dossier text is generated. Pure generation + LLM call; writes via the store. Testable units: fact-grouping, prompt-building, compose-decision, output-parsing.
- **`lib/dossiers.ts`** — the only SQL (gains brief/update/summary helpers).
- **`lib/refresh.ts`** — unchanged in spirit; only returns `added` now.
- **SSE routes** — orchestrate refresh → compose, stream both.
- **Templates / page** — render only; `<Prose>` renders markdown; evidence zone groups facts by source.

## 9. Resolved decisions (settled with user, 2026-05-30)

1. **Dossier shape → brief + dated update log** (not a single rewritten brief, not an update-only stream).
2. **Brief upkeep → on demand.** Written at assembly; regenerated only via "Réécrire la synthèse." Refreshes append update notes, not brief rewrites.
3. **Updates → auto-written on refresh** when new facts exist (only then — empty refresh costs nothing). The "living dossier files an update" moment.
4. **Citations → source-level attribution** in prose ("selon X…") + facts grouped by source as evidence (each source blurbed, verbatim passages). Not per-fact inline citations.
5. **Temporal stance → deferred** entirely (revisit with M2 cadence).

## 10. Testing

- **Unit (pure, fake LLM client):** fact-grouping-by-source; prompt-building (subject + grouped facts → prompt string); the compose-decision (no facts → none; no brief → brief; brief + new facts → update); output JSON parsing/mapping (brief + source summaries; update + new-source summaries).
- **Live calibration** (one small dossier, **Supadata disabled** to protect quota): assemble → confirm a coherent, source-attributed brief; refresh once → confirm a sensible dated update note; eyeball attribution + cost (≤ a couple LLM calls).
- **Integration:** `pnpm test` + `pnpm --filter @veille/web typecheck` + `next build`; the SSE stream carries synthesis events; the page renders brief + updates + evidence.

## 11. Definition of done

Opening a dossier shows a **readable, source-attributed brief** of the current situation, not a fact dump. Hitting **Rafraîchir** streams in new facts AND a **dated "what's new" note** appears, written from them. **"Réécrire la synthèse"** refreshes the brief from everything known. The **facts are still there**, one expand away, **grouped by their source** with each source introduced — every claim still traceable to a verbatim passage. The Gabriel Attal dossier reads like a briefing, not a spreadsheet.
