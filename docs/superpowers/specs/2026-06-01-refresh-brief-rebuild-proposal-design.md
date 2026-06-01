# Refresh semantics: brief-rebuild proposal (Spec B)

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Scope:** Add a **brief-rebuild proposal** to the dossier: when a refresh surfaces older material that predates the brief, a quiet banner offers to rebuild the brief (with all facts). Small, additive feature layered on the existing two-stream journal + documents.
- **Out of scope:** the Actualité journal stream, the Compléments journal stream, document extraction/analysis — all unchanged.

## Motivation

The two-stream journal (shipped) records *recent* developments (Actualité) and *older-but-newly-found* material (Compléments). But the **brief** — the canonical synthesis — is only built/rewritten on demand. When refresh keeps surfacing older material we'd missed, the brief silently drifts out of date relative to what we now know. The user's intent: *old-but-missed* facts should **propose rebuilding the brief** (with confirmation — the brief is canonical, never silently rewritten), while *recent* facts keep flowing to the journal.

## Decisions (from brainstorming)

1. **Keep the two-stream journal as-is** (Actualité + Compléments, automatic). Compléments stays the dated record of older material found.
2. **Add a rebuild-proposal banner** on top, in the **Synthèse** tab, above the brief.
3. **Trigger:** any un-briefed, old-published facts (no threshold, no LLM importance judge) — a quiet count; the user's confirmation is the importance filter.
4. **Snooze lifecycle:** a "Plus tard" button hides the banner until a *later* refresh adds *new* old facts; "Reconstruire" rebuilds and clears it.
5. **Reuse the existing rewrite** (`regenerateBriefAction` / the "Réécrire" button) for "Reconstruire."
6. **Auto-accept exception:** the journal stays automatic; this brief rebuild is the **only** confirmation step in the product.

## Design

### 1. Data
Add one nullable column to `dossiers` (`apps/web/lib/db/app-schema.ts`):
```
briefSuggestionDismissedAt: timestamp('brief_suggestion_dismissed_at', { withTimezone: true })
```
Additive migration (drizzle-kit). No per-fact state is stored — the count is derived.

### 2. The "pending rebuild" count (derived)
New helper `pendingRebuildCount(dossierId): Promise<number>` (in `apps/web/lib/dossiers.ts`, reusing `classify` from `lib/temporal.ts`):

- If the dossier has no `briefGeneratedAt` (brief never built) → return `0` (nothing to rebuild yet).
- `floor = max(briefGeneratedAt, briefSuggestionDismissedAt ?? briefGeneratedAt)`.
- Load facts with `createdAt > floor` (not in the current brief, and not snoozed-away).
- Count those where `classify(fact, briefGeneratedAt) === 'complement'` — i.e. **published before the brief was built** (older material the brief missed). Recent facts (Actualité) don't count toward a rebuild; they belong in the journal.
- Return the count.

(The classification cutoff is `briefGeneratedAt`: "was this published before the brief existed?" The `createdAt > floor` gate is "found since the brief / since I snoozed".)

### 3. UI — the banner
A `RebuildProposal` client component, rendered in the **Synthèse** tab (in `app/dossier/[slug]/page.tsx`, above `<Brief>`), only when `pendingRebuildCount > 0`. The page (server) computes the count and passes it + the slug.

- Copy: *« N éléments plus anciens à intégrer au brief. »* + two buttons:
  - **Reconstruire le brief** → calls `regenerateBriefAction(slug)` (existing). On success the page revalidates; `briefGeneratedAt` advances → next render's count is 0 → banner gone. Shows a pending/“Réécriture…” state while running.
  - **Plus tard** → calls a new `dismissBriefSuggestionAction(slug)` → banner gone until new old facts arrive.
- Style: quiet/informational (reuse a `.card`/`.badge`-style strip in the Ardoise system; accent-soft background). Not a modal.

### 4. Server actions (`app/dossier/[slug]/actions.ts`)
- Reuse `regenerateBriefAction(slug)` (already exists: `composeDossier(mode:'brief')` + `revalidatePath`).
- Add `dismissBriefSuggestionAction(slug)`: owner-scoped; set `dossiers.briefSuggestionDismissedAt = new Date()` (via a `dismissBriefSuggestion(ownerId, slug)` helper in `lib/dossiers.ts`); `revalidatePath('/dossier/'+slug)`.

### 5. Relationship to the existing "Réécrire" button
"Réécrire" (always available in the rail) and the banner's "Reconstruire" trigger the **same** `regenerateBriefAction`. The banner is just a contextual, count-driven nudge for it + the snooze. No unification needed; both call the one action.

## Edge cases
- **No brief yet** (first assemble pending) → `pendingRebuildCount` = 0 → no banner. (The brief is built by the normal assemble/auto path first.)
- **Only recent facts found** → all classify as Actualité → count 0 → no banner (correct: recent → journal, not a rebuild).
- **Snooze then rebuild** → rebuild advances `briefGeneratedAt` past everything; count 0 regardless of `dismissedAt`.
- **Unknown publication date** → `classify` returns `complement` (per the temporal rules) → counts toward rebuild. (Conservative: undated newly-found material is treated as "the brief might have missed it".)
- **Manual "Réécrire"** (without the banner) → also advances `briefGeneratedAt` → clears any pending count.

## Testing & verification
- **Unit (vitest):** `pendingRebuildCount` logic via a small pure helper `countPendingRebuild(facts, briefGeneratedAt, dismissedAt)` (extract the pure counting from the DB wrapper): cases — no brief (0), recent-only (0), old-but-found > floor (counts), snoozed (excluded until createdAt > dismissedAt), unknown-date (counts).
- **Visual:** preview route rendering `RebuildProposal` (count > 0) + the dossier Synthèse tab with the banner.
- **Gate:** typecheck, `pnpm test`, production build (dev stopped). Live: on Attal, the 13 backfilled (old-published) docs' facts should yield a pending count → banner appears; "Reconstruire" rewrites the brief and clears it.

## Notes
- This also makes the existing Attal dossier immediately useful: its backfilled older facts will surface the banner, and one rebuild folds them into the brief.
- The pure `countPendingRebuild` helper keeps the logic testable and out of the DB wrapper.
