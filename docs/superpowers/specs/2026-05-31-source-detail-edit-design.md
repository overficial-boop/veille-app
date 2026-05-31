# Veille — See & edit source details

- **Date:** 2026-05-31
- **Status:** **Designed autonomously** while the user was away (delegated "do everything you can"; #4 deferred). For the user's review on return.
- **Builds on:** the add-source connectors feature (web / recherche / RSS / YouTube). Folds in deferred item **#1** (type the `sources.input` jsonb).

## 1. Goal
In the **Sources** panel, let the user **expand a source to see its details** (type · target · last extraction) and **edit it** (rename the label, change the target — the query / URL / feed). Today a source shows only a label + type badge + remove.

## 2. Data model
- **No schema/migration.** `sources.label` is a column; `sources.input` is jsonb.
- **Fold in #1:** annotate the column `input: jsonb('input').$type<{ url?: string; query?: string; feedUrl?: string; source?: string }>()` in `app-schema.ts`, giving typed access to `input` across the app (removes the `as` cast in `page.tsx`; `refresh.ts`'s existing `as never` provider casts still compile).
- **Pure helper** (`apps/web/lib/source-input.ts`): `sourceTargetField(connector) → 'url' | 'query' | 'feedUrl' | null` (web→url, tavily→query, rss→feedUrl, else null) and `sourceTarget(connector, input) → string` (the primary value, or `''`). One source of truth for "what's the editable target of this source."

## 3. Store + action
- **`updateSource(ownerId, slug, sourceId, patch: { label?: string; target?: string })`** in `dossiers.ts` — owner-scoped exactly like `removeSource` (`getDossier(ownerId, slug)` guard, `where id = sourceId AND dossierId = dossier.id`). Sets `label` when provided; when `target` provided, reads the row's `connector` + `input`, writes the new value into `input[sourceTargetField(connector)]` **preserving other input keys** (e.g. `source:'youtube'`), and updates the row. No-op if the connector has no target field.
- **`updateSourceAction(slug, sourceId, { label?, target? })`** in `actions.ts` — `ownerId()` guard, calls `updateSource`, `revalidatePath`. Returns `void` (mirrors `removeSourceAction`). No re-validation/re-fetch of the target on edit (a bad feed simply yields nothing on the next refresh — non-fatal, per the existing refresh try/catch).

## 4. Presentation (`dossier-runtime.tsx`, SourcesPanel)
- `SourceLite` gains `target?: string` and `lastExtractedAt?: string | null`. `page.tsx` passes them: `target: sourceTarget(s.connector, s.input)`, `lastExtractedAt: s.lastExtractedAt?.toISOString() ?? null` (and drops the now-unneeded `source` cast — read `s.input.source` typed).
- Each source row gets a disclosure (chevron) toggling a **detail panel**: **Type** (`sourceTypeLabel`), **Cible** (the target, monospace/truncated), **Dernière extraction** (`formatDateFr(new Date(lastExtractedAt))` or « jamais »).
- The detail panel has an **« Éditer »** button → inline form: a **label** input (prefilled) + a **target** input (prefilled) + **Enregistrer** / **Annuler**. Save calls `updateSourceAction(slug, id, { label, target })` in a transition (disabled while pending; Enregistrer disabled if target is empty), then collapses. The existing **remove** stays.
- One source expanded/edited at a time (`expandedId` / `editingId` local state).

## 5. Scope (out)
- Pause/disable a source (needs an `enabled` column + refresh-skip → migration; deferred). Remove already exists.
- Editing a source's **type/connector** (remove + re-add instead).
- Re-validating the target on save (deferred — keep edit cheap; next refresh surfaces a broken target).

## 6. Testing
- **Unit:** `sourceTargetField` (web→url, tavily→query, rss→feedUrl, unknown→null) and `sourceTarget` (reads the right field; `''` when absent).
- **Live:** on `gabriel-attal`, edit a source's label + target via `updateSource`; confirm both persist and the row reflects them.
- **Gates:** `pnpm test` + typecheck + `next build`.

## 7. Definition of done
Expanding a source shows its type, target, and last-extraction time; editing saves a new label and/or target (preserving the YouTube hint), reflected immediately. Owner-scoped throughout. No schema migration.
