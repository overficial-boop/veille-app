# Journal — refresh discovers vetted novelties — design

- **Date:** 2026-06-02
- **Status:** Approved (design); pending implementation plan
- **Milestone:** Brings back the journal (removed in the watcher-refresh reframe) as a **fact-driven, LLM-gated "what's new" feed**.
- **Scope:** "Rafraîchir" now extracts facts from newly-found documents and runs an **LLM novelty/importance gate**; facts that pass are **promoted to a journal** displayed above the brief.

## Motivation

Without a journal, the dossier lost the felt sense of *discovering new developments over time*. The old journal was removed because it was a prose-stream of fact-based updates that duplicated the brief. The new journal is **earned**: refresh surfaces only the few fresh facts an LLM judges genuinely new and important versus what the dossier already says.

## Decisions (from brainstorming)

- **Novelty baseline:** judge each new fact against the **current brief + the facts already in the journal** (what the reader has already been shown).
- **Entry = the fact itself** (its text, source, date) — not a rewritten prose update — plus the gate's one-line "why it's notable" reason as a subtitle.
- **Triggered by refresh only** (not the initial assemble/brief): the first brief is the baseline; subsequent refreshes reveal what's new against it.
- **Displayed above the brief** (top of the brief column).
- **Capped per refresh** so the journal stays a signal, not a flood (configurable; default a small number).

## Design

### 1. Storage — promote the fact (migration)

Add two nullable columns to `facts`:
- `journal_at timestamptz` — when the fact was promoted to the journal (null = not in journal).
- `journal_reason text` — the gate's one-line justification.

The journal = `facts WHERE journal_at IS NOT NULL`, newest first. No new table. The vestigial `dossier_updates` table stays unused (no DROP). One migration (additive).

### 2. The novelty/importance gate — `apps/web/lib/journal.ts` (new)

Pure, testable prompt + parse, plus a thin LLM call:

```
buildJournalGatePrompt({ subject, brief, journalTexts, candidates }): string
parseJournalSelection(text, candidateIds): { factId: string; reason: string }[]
selectJournalWorthy({ subject, brief, journalTexts, candidates, max, client? }): Promise<{ factId; reason }[]>
```

- `candidates`: the new facts from this refresh — `{ id, text }[]`.
- The prompt gives the model the **subject**, the **current brief** (may be empty), and the **journal fact texts already shown**, then asks it to return ONLY the candidate facts that (a) report a *new development* not already covered by the brief or journal, and (b) matter to someone tracking this subject — dropping restatements, near-duplicates, and trivia. Output JSON: `{ keep: [{ id, reason }] }`. Cap the kept list at `max` (the model is told the cap; we also slice defensively).
- `parseJournalSelection` keeps only ids that are in `candidateIds` (guards hallucinated ids), preserving order.
- One LLM call per refresh (Gemini flash), regardless of candidate count.

A `JournalConfig` in `refresh-config.ts` (env-overridable, matching the existing `RefreshConfig` pattern): `journalMaxPerRefresh` (default 5), `journalEnabled` (default true).

### 3. Refresh flow — `apps/web/lib/refresh.ts`

After the existing pull loop (which upserts documents as kept/suggestion), on the **refresh** phase only:
1. Track the **URLs newly kept this run** — candidates that were not in the seed `seenUrls` and whose `processCandidate` returned `'kept'`. (Collect them inside the loop.)
2. Resolve those URLs to their `documents` rows (id, url, title, content, siteName, review) and **extract facts** for the ones lacking facts (reuse `extractFactsForDocument`). Collect the freshly-inserted facts (`{ id, text, sourceUrl, documentId }`).
3. If there are fresh facts and `journalEnabled`: load the dossier's **brief** and the existing **journal fact texts**, call `selectJournalWorthy({ subject, brief, journalTexts, candidates: freshFacts, max })`.
4. **Promote** the selected facts: `promoteFactsToJournal(dossierId, selections)` → `UPDATE facts SET journal_at = now(), journal_reason = $reason WHERE id = $id` (only facts in this dossier; skip any already promoted).
5. Stream a progress frame around the gate (e.g. `{ type:'journal'; state:'start'|'done'; promoted:number }`) so the UI shows "Analyse des nouveautés…".

Assemble phase is unchanged (no journal). The gate never runs on assemble or on `pullAdHoc` (mode recherche) — only on `refreshDossier({ phase: 'refresh' })`. *(Open option: also gate mode-recherche pulls later — out of scope now.)*

### 4. Journal queries — `apps/web/lib/journal.ts` or `dossiers.ts`

- `listJournal(dossierId): Promise<JournalEntry[]>` — facts with `journal_at` set, ordered `journal_at DESC`. `JournalEntry = { id, text, sourceUrl, documentId, host, journalReason, journalAt, publishedAt }`.
- `promoteFactsToJournal(dossierId, selections: { factId; reason }[]): Promise<void>`.
- A pure helper `journalTextsOf(entries) → string[]` for feeding the gate.

### 5. UI — `apps/web/components/journal-feed.tsx` (new) + `page.tsx`

- `page.tsx` loads `listJournal(dossier.id)` and renders `<JournalFeed entries={...} slug={...} />` at the **top of the brief column** (`.dossier-main`), above `<Brief>` / `<GenerateBriefCta>`. Renders nothing when empty.
- Each entry row: the **fact text**; a meta line with the **publication/host** linking to the document's fiche (`/dossier/<slug>/d/<documentId>`, else the external `sourceUrl`) and the **date** (`journalAt`, or `publishedAt` if present); the **reason** as a quiet italic subtitle. Newest first. A section header ("Le journal" / "Nouveautés").
- Reuses existing tokens/section styling; a new `.journal-*` block in `globals.css`. The old `journal.tsx` is replaced by `journal-feed.tsx` (or repurposed) — it's currently unused.

## Edge cases

- **No brief yet** → baseline is just the journal (empty on first refresh); the gate falls back to pure importance judgment, and the cap prevents a flood.
- **No new kept docs / no fresh facts** → gate skipped; journal unchanged; a quiet done frame.
- **Gate returns nothing** → nothing promoted (normal; "rien de neuf").
- **Hallucinated/duplicate ids** → filtered by `parseJournalSelection` against `candidateIds`; already-promoted facts are skipped in `promoteFactsToJournal`.
- **A fact promoted, then its document rejected later** → out of scope (journal keeps it; could revisit).
- **Re-running refresh quickly** → recency window + `seenUrls` dedup mean few/no new docs, so few/no candidates.

## Testing & verification

- **Unit (vitest, pure):**
  - `parseJournalSelection` — keeps only in-candidate ids, drops unknown, preserves order, caps at max.
  - `buildJournalGatePrompt` — includes subject/brief/journal/candidates + the "new development, not a restatement" instruction + the cap.
  - `journalTextsOf` shaping.
  - (These live in a db-free module so they load without the env/db chain — per the recurring lesson.)
- **Live:** assemble a dossier, generate a brief (baseline), then "Rafraîchir" → new docs → facts extracted → a few entries appear in the Journal above the brief with reasons; re-refresh with nothing new → journal unchanged; legacy dossiers still refresh.
- **Gate:** typecheck · `pnpm test` · build (dev stopped) · migration applied to `veille_dev`.

## Out of scope

- Gating mode-recherche (`pullAdHoc`) pulls into the journal.
- Auto-rewriting the brief from journal entries (Réécrire still synthesizes from facts).
- Per-entry dismiss/curation of the journal.
- Dropping the vestigial `dossier_updates` table.

## Integration points to resolve in the plan

1. Tracking "newly kept this run" inside `refreshDossier`'s loop (collect kept-new URLs) + resolving them to docs + extracting facts (reuse `extractFactsForDocument`, which needs the dossier row + doc fields).
2. The streamed progress event shape for the journal step (extend `RefreshProgress`/`StreamProgress`), and whether the refresh SSE route forwards it.
3. `facts` schema additions + `Fact`-row mapping untouched (journal columns are set by a dedicated UPDATE, not the insert path).
4. `JournalConfig` knobs in `refresh-config.ts` + its test.
