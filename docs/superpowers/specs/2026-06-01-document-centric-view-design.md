# Document-centric view (Spec A)

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Scope:** Introduce **documents** as a first-class, individually-browsable object in a dossier — each analyzed URL with its own review / bullet summary / "aller plus loin" / facts (+ optional fact-checks), mirroring the old Veille prototype. Adds a **Documents** tab alongside **Synthèse** (brief + journal).
- **Out of scope (→ Spec B):** the revised refresh semantics (old-but-missed → propose brief rebuild; recent → journal). The brief and the two-stream journal are unchanged here.

## Motivation

The current app is synthesis-first: a brief on top, a journal of deltas, and evidence grouped by *publication*. That deliberately dissolves the individual document — you can't open "this source" and see what it yielded. The **old Veille prototype** (`D:\Projects\CODING\veille`) was document-centric: each analyzed URL had a rich, multi-block analysis you could open and read on its own. We lost that. This spec brings it back as a dedicated view, without removing the synthesis.

Reference (old app, verbatim model): per-URL `CachedReview` with `reviewMarkdown` (prose), `resume` (bullets), `elaboration` (topics + resources/links), `facts`, `factChecks`; prompts in `apps/android/assets/prompts/{review,resume,elaborate-llm-only,elaborate-with-tavily,fact-check,extract}.md`; UI in `apps/android/lib/pages/review_page.dart` + the `*_section.dart` widgets. Each block was a **separate, on-demand LLM call** with model + cost shown and a regenerate button.

## Decisions (from brainstorming)

1. **Two tabs** on the dossier page: **Synthèse** (brief + journal, unchanged) and **Documents** (grid of fiches → dedicated fiche page). The current "Preuve auditable / Sources et faits" section (grouped by publication host) is **removed** — facts now live inside their document's fiche.
2. **A document = one analyzed URL** (per dossier). New `documents` table; existing `facts` link to a document.
3. **Hybrid generation:**
   - **Automatic** at extraction, per document: *résumé court* + *review* (prose) + *puces* (bullets) + *facts*.
   - **On-demand** (button + cost shown): *aller plus loin* (topics + resources, optional web search) + *fact-checks* (per fact).
4. **Port the old prompts** (review, resume, elaborate, fact-check) into the web app, adapted to Gemini + the dossier language. The existing `extract` already yields facts + a short summary.
5. **Fiche = dedicated route** (`/dossier/[slug]/d/[docId]`), not a modal — shareable, back-button-friendly, matches the old app's full review page.

## Design

### 1. Data model

New table `documents` (`apps/web/lib/db/app-schema.ts`), one row per analyzed URL per dossier:

```
documents:
  id            uuid pk
  dossierId     uuid not null → dossiers.id (cascade)
  url           text not null
  title         text
  siteName      text                     -- host or YouTube channel name
  kind          text not null            -- 'web' | 'youtube'
  publishedAt   timestamptz
  shortSummary  text                     -- "résumé court" (2-3 sentences)
  review        jsonb                    -- { markdown, model, promptHash, generatedAt, cost }
  bullets       jsonb                    -- { markdown, model, promptHash, generatedAt, cost }
  elaboration   jsonb                    -- { topics:[{name,summary,resources?,links?}], withTavily, ...meta } | null
  factChecks    jsonb                    -- { checks:[{factId,note}], ...meta } | null
  createdAt     timestamptz default now()
  unique (dossierId, url)
```

`facts` gains `documentId uuid → documents.id (cascade)` (alongside the existing `dossierId`/`sourceId`). On extraction, each fact links to the document for its `sourceUrl`. The per-block `{model, promptHash, generatedAt, cost}` metadata mirrors the old app so we can show provenance + cost and support regeneration.

Migration via drizzle-kit (additive: new table + new nullable column on `facts`; existing facts get `documentId = null` and surface under a synthetic "non rattaché" group until re-extraction — acceptable, or a one-off backfill keyed by sourceUrl; the plan decides).

### 2. Per-document analysis module

New `apps/web/lib/document/` module:
- `prompts.ts` — the ported prompts as functions (review, resume, elaborate [llm-only + with-tavily], fact-check), parameterized by language + document metadata. Kept faithful to the old `.md` prompts.
- `analyze.ts` — orchestration:
  - `analyzeDocument(content, meta, lang)` → generates `shortSummary` (from the extract summary), `review`, `bullets` (review → resume). One review call + one resume call; cost captured per block.
  - `elaborateDocument(documentId, {withTavily})` → topics + resources (+ optional Tavily links).
  - `factCheckDocument(documentId)` → per-fact credibility notes.
- Uses `selectLlmClient` (Gemini) + the existing Tavily client for the web-search variant.

**Content availability (integration point):** review/resume need the document's cleaned text, which the `extract` pipeline currently consumes internally and discards. The plan must surface that text — either have the adapter/pipeline return the cleaned content alongside facts, or re-derive it — so `analyzeDocument` can run without a second fetch where possible. Flagged as the main implementation risk.

### 3. Generation flow

- **At assemble/refresh** (`refresh.ts`): for each extracted URL → upsert the `document` row (url/title/siteName/kind/publishedAt from provenance + candidate), link its facts, then auto-generate `shortSummary` + `review` + `bullets`. Volume: ~1 extract + 2 analysis calls per *new* document (≈ tens per assembly; Gemini-flash, low cost). Existing relevance floors + per-source cap still bound how many documents are created.
- **On-demand** API routes (SSE or JSON):
  - `POST /api/dossiers/[slug]/documents/[docId]/elaborate` (`{withTavily?}`)
  - `POST /api/dossiers/[slug]/documents/[docId]/factcheck`
  - Each writes its jsonb block + returns it; the fiche shows a spinner + the resulting cost.

### 4. UI

- **Dossier page** (`app/dossier/[slug]/page.tsx`) becomes two tabs (client-side switch, URL-synced e.g. `?tab=documents`):
  - **Synthèse** — `Brief` + `Journal` (unchanged), inside the existing `CitationsProvider`.
  - **Documents** — a grid/list of document cards: monogram/site (reuse the Q3 channel/host identity), title, date, `shortSummary`, fact count, and which blocks exist. Click → fiche route.
- **Fiche** (`app/dossier/[slug]/d/[docId]/page.tsx`): header (title, source identity, date, ↗ original) → résumé court → **review** (prose) → **puces** → **aller plus loin** (with ↻ / "générer", optional "+ recherche web") → **faits** (each: text, verbatim passage, confidence bars, + ↻ "vérifier" → credibility note). Reuses the Ardoise system; facts reuse the Q4 citation styling where relevant. Each generated block shows model + cost (small, mono), matching the old app.
- The old `BySource` evidence section is removed from the dossier page (its job moves into the Documents tab + fiches). `by-source.tsx` may be retired or repurposed.

### 5. Edge cases

- A document whose review/bullets generation fails → row exists with facts + shortSummary; review/bullets can be (re)generated on demand (graceful degradation).
- Item sources (single URL) and standing-discovered URLs both become documents uniformly.
- `unique(dossierId, url)` makes re-encountering a URL an upsert, not a duplicate.
- A fact with `documentId = null` (pre-migration) renders under a "non rattaché" group until backfilled/re-extracted.
- On-demand blocks absent → fiche shows a "générer" affordance, not an empty section.

## Testing & verification

- **Unit (vitest):** prompt builders (review/resume/elaborate/fact-check) produce the expected instructions + JSON schema; the review→bullets and elaborate parsers; document upsert keying by `(dossierId, url)`.
- **Visual:** preview route rendering a fully-populated fiche + a Documents grid (throwaway, like prior previews).
- **Gate:** typecheck, `pnpm test`, production build with the dev server stopped; a live assemble on a small dossier to confirm documents + auto blocks populate and on-demand endpoints work.

## Decomposition note

This spec is sizable; the implementation plan will split it into tasks roughly: (1) `documents` table + `facts.documentId` + migration; (2) ported prompts + `analyze.ts` (unit-tested); (3) wire auto-generation into extraction (incl. surfacing document content); (4) on-demand elaborate + fact-check endpoints; (5) Documents tab + grid; (6) fiche page; (7) remove/repurpose the old evidence section; (8) gate. Each produces working, reviewable software.

## Open implementation decisions (resolve in plan)

- Exact mechanism to surface the document's cleaned text for review/resume (adapter return vs re-fetch).
- Whether to backfill `documentId` for the existing dossier's facts or let them re-link on next extraction.
- Streaming (SSE) vs plain JSON for the on-demand endpoints (SSE matches the existing assemble/refresh pattern + shows progress).
