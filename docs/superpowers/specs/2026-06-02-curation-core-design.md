# Curation core (②) — design

- **Date:** 2026-06-02
- **Status:** Approved (design); pending implementation plan
- **Milestone:** "Curation" reframe — phase ② of ④ (① full-screen layout shipped `f7624c6`; ③ state-vs-watch search; ④ optional "quoi de neuf" note + polish).
- **Scope:** Invert the pipeline from **"discover → extract facts → auto-brief"** to **"discover → fetch content + score relevance → curate documents → generate facts/brief on demand."** Rebuild the dossier into a single full-screen workspace. Brief becomes optional (creation toggle + always-a-button).

## Motivation

Today every pull extracts facts (the spine) and the brief auto-generates. The user wants the **documents** to be the unit of work: pull many, keep the relevant ones (relevance-gated, overridable), and generate the heavy artifacts (facts, review, brief) only on demand. The brief should be optional, not the forced centerpiece. This builds on the just-shipped document-centric view (per-doc fiche, on-demand review/elaborate/factcheck, `documents.content` persisted) and the watcher model.

## Decisions (from brainstorming)

1. **Pull = discovery + content + relevance** (not facts; not discovery-only).
2. **Curation = relevance-gated auto-keep + suggestions** (above threshold → kept; below → suggestion); reject a kept / promote a suggestion. Smart default + overridable. (Re-introduces a curation step M0 avoided.)
3. **Brief synthesizes from facts** (provenance sacred); generating it extracts facts for selected docs lacking them.
4. **Brief optionality = creation toggle (default off) + always-available button.**
5. **Unified full-screen page** (no tabs): brief (or CTA) on top · kept-documents feed · suggestions tray · journal · rail.
6. **Journal = list of new curated publications** (the data half of ④ folds into ② out of necessity, since facts go on-demand and the fact-based prose note can't function).
7. **Search split (state vs watch) + "mode recherche" → deferred to ③.**

## Design

### 1. Pipeline inversion — the "pull"
A pull (creation = state search; refresh = watch) processes each candidate **one at a time, streamed**:
1. **Discover** — `candidatesFor(source)` (Tavily/RSS/YouTube), shorts-filtered, score-floored, capped, recency-filtered on refresh (unchanged from the watcher model).
2. **Fetch content** — fetch the candidate's readable text **without LLM fact extraction** (content-only). *(Integration point: `@veille/core` currently only exposes `extract(url)` which fetches AND extracts facts; add a content-only path — e.g. `fetchContent(url)` or `extract(url, { contentOnly: true })` returning `{ content, title, siteName, publishedAt, channelName? }` and skipping the fact LLM call.)*
3. **Score relevance** — `scoreRelevance({ content, title, intent, language }) → { score: 0..1, reason: string }` (one light LLM call; see §2).
4. **Upsert document** — store `content`, `relevance`, `relevanceReason`, and `status` = `kept` if `score ≥ cfg.relevanceKeepFloor` else `suggestion`. **No facts.**
5. **Emit progress** — a `document` frame (label/relevance) so the UI shows documents appearing with their relevance.

Dedup by URL stays (`documents` unique `(dossierId, url)`; `seenUrls`/`freshCandidates` skip already-pulled URLs). `refreshDossier`'s `processCandidate` is rewritten accordingly: it no longer extracts/inserts facts; it fetches content + scores + upserts with status. The fact-extraction + per-candidate fact streaming added in the watcher fix is removed from the pull path (facts move to §4 on-demand).

### 2. Relevance scoring — `apps/web/lib/relevance.ts` (new)
- `buildRelevancePrompt({ title, content, intent, language })` (pure) + `parseRelevance(text) → { score, reason }` (pure, testable: clamps score to [0,1], tolerant parse) + `scoreRelevance(args)` (calls `selectLlmClient`).
- Output via a small JSON schema `{ score: NUMBER, reason: STRING }`. `reason` = one short sentence ("why relevant / not") shown as the indicator tooltip.
- Content is truncated to a budget (e.g. first ~6k chars) before the call to bound cost.
- Cost per pull = N fetches + N relevance calls (capped by `cfg.assembleCandidatesPerSource`). Lighter than fact extraction (one small-output call vs full extraction); streamed so it feels live.

### 3. Schema + migration
- `documents`: add `status text not null default 'kept'` (`kept` | `suggestion` | `rejected`), `relevance real`, `relevanceReason text`.
- `dossiers`: add `autoBrief boolean not null default false`.
- Migration (`drizzle-kit generate` → `0009_*`): the three `documents` columns + the `dossiers` column. All additive with defaults → safe.
- **Backfill existing data:** existing `documents` get `status='kept'` (the default covers them), `relevance` stays null. Existing facts + briefs are untouched, so legacy dossiers render in the new page with their kept docs + existing brief.

### 4. On-demand facts (per kept document)
- New endpoint `POST /api/dossiers/[slug]/documents/[docId]/facts` (mirrors `…/analyze`): loads the document's stored `content`, runs fact extraction **on the stored text** (no re-fetch), `insertFacts` + `linkFacts`. Idempotent (if the doc already has facts, returns them). *(Integration point: run extraction on stored content via the text-extraction path rather than `extract(url)`, to avoid a re-fetch.)*
- The **fiche** auto-triggers it on open when the document has content but no facts yet (same pattern as the on-demand review), showing a "Extraction des faits…" state; the "Faits sourcés" section then renders them.

### 5. On-demand brief + autoBrief
- **"Générer le brief"** action over *all kept* documents or *a selection*: for each selected doc lacking facts → call the on-demand fact extraction → then `composeDossier(dossierId, { mode: 'brief', scope })` writes the citation-rigorous brief from those facts (reuse the existing brief path; `scope` limits to the selected docs' facts).
- **`autoBrief`** (creation toggle, default off): the creation form adds the checkbox; after the first pull (assemble) completes, the assemble route checks `dossier.autoBrief` and, if set, runs the brief generation over all kept docs.
- A brief that hasn't been generated simply doesn't exist yet → the page shows the "Générer le brief" CTA instead.

### 6. Unified dossier page (full-screen, no tabs)
Replace the tabbed page (Synthèse / Documents) with one full-width workspace:
- **Brief** (top): the prose brief with citations if it exists, else a "Générer le brief" CTA (with all/selected scope).
- **Kept documents** (main feed): cards — titre · source · date · **relevance indicator** (score + reason tooltip) — click → fiche. Reject (→ `status='rejected'`, hidden) inline.
- **Suggestions tray**: below-threshold candidates — **promote** (→ kept) / **dismiss** (→ rejected). Collapsible.
- **Journal**: new publications since last refresh (dated entries: titre · source · pertinence · lien), relevance-gated — the curated-new-publications list. (Legacy prose `dossier_updates` entries may remain as historical or be hidden — plan decides.)
- **Rail**: sources panel + pull/refresh progress (the runtime island) + actions (Rafraîchir, Générer le brief; "mode recherche" arrives in ③).

Server actions: `setDocumentStatus(slug, docId, status)` (reject/promote), `generateBriefAction(slug, scope)`.

### 7. Scope — ② vs ③/④
- **② includes:** the three schema columns + `autoBrief`; the content-only fetch + `scoreRelevance`; the rewritten pull-curate `processCandidate` (used by **both** assemble and refresh); on-demand facts endpoint + fiche wiring; the brief button + `autoBrief`; the unified page; migration/backfill; the journal rendered as **new curated documents**.
- **③ (later):** planner state/watch query split + "mode recherche" manual search UI.
- **④ (later):** the optional on-demand "quoi de neuf" note over new docs + journal polish.

### 8. Config (reuse `RefreshConfig`)
- Add `relevanceKeepFloor` (default 0.5) — the kept/suggestion threshold.
- Add `relevanceContentBudget` (default ~6000 chars) — truncation for the scoring call.
- Existing `assembleCandidatesPerSource` / `refreshCandidatesPerSource` now bound how many candidates get fetched + scored per pull.

## Edge cases
- **Candidate fetch fails** → skip it (no document), like today's per-candidate try/catch.
- **Relevance call fails** → keep the document as a `suggestion` with `relevance=null` + a noted reason ("score indisponible"), rather than dropping it.
- **All candidates below threshold** → all land in suggestions; the kept feed is empty with an inviting empty-state.
- **Existing dossier with facts + brief** → docs backfilled to `kept`, brief shown, refresh now pull-curates (no new facts unless the user opens/briefs).
- **Brief over a selection that includes docs without content** (legacy) → extract from URL as a fallback, or skip with a notice (plan decides).
- **autoBrief on but the pull kept zero docs** → no brief; CTA shown.

## Testing & verification
- **Unit (vitest):** `parseRelevance` (valid/clamp/garbage), `buildRelevancePrompt` (includes intent + content), the kept/suggestion gate predicate, `resolveRefreshConfig` new knobs.
- **Live:** create a dossier → documents stream in with relevance, kept vs suggestions split correctly; promote/reject works; open a fiche → facts + review generate on demand; "Générer le brief" produces a cited brief; `autoBrief` on → brief appears after the first pull.
- **Gate:** typecheck · `pnpm test` · production build (dev stopped). Migration applied to `veille_dev`.

## Out of scope
- State/watch query split + manual search (③); the optional journal note (④).
- The Fact schema itself (unchanged — facts are still extracted the same way, just on demand).
- Per-user config UI (knobs stay env/admin).

## Integration points to resolve in the plan
1. **Content-only fetch** in `@veille/core` (fetch readable text + metadata without the fact LLM call).
2. **Extract facts from stored content** (on-demand) without re-fetching the URL (reuse the text-extraction path).
3. **autoBrief hook** placement in the assemble SSE route (after the pull, before/around synthesis).
4. The unified page is a large UI rebuild — its plan tasks should be sequenced (schema+migration → pipeline → on-demand facts → brief → page → backfill → gate), and may ship behind the existing page until complete.
