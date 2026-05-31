# Temporal model: a two-stream journal (Actualité / Compléments)

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Scope:** The refresh → synthesis-update path and fact date-capture. Does **not** touch the brief ("Situation actuelle"), the "Réécrire" rewrite path, candidate retrieval (score + relevance floors + per-source cap), or first assembly.

## Motivation

After validating the manual refresh loop on the Gabriel Attal dossier, two problems surfaced:

- **Q1 — old treated as new.** A refresh surfaced an August-2025 Paris Match article and presented it in the **31-May "Mises à jour"** entry as if it were a current development. "New" in the engine means *newly discovered by this dossier* (`dedupKey` = `sourceUrl + text`, no date awareness), not *newly published*. The journal frames everything as temporal, conflating **newly-published** with **newly-discovered**.
- **Q2 — quality decay over refreshes.** Because refresh skips already-seen URLs (`freshCandidates`), each run is pushed deeper into the provider's ranking, so over time it mines progressively older / more peripheral long-tail material.

**Key enabling fact:** publication dates are largely already available.
- `WebProvenance.publishedAt?` (Readability `article:published_time`; partial coverage) and `YouTubeProvenance.publishedAt` (reliable) are stored per fact.
- The discovery `Candidate` type **already carries `publishedAt`** *before* extraction — Tavily `published_date` and RSS `pubDate` (good coverage), plus a `score`. `factDate()` (`components/templates/types.ts`) already reads `provenance.publishedAt` for display.

So the fix is mostly *using data we already have*, organized as presentation, not changing retrieval.

## Decisions (from brainstorming)

1. **Two separate streams** in the journal: **Actualité** (recently published) and **Compléments / Découvertes** (older, newly found) — materialised as two real, persistent timelines (not two sections inside one entry).
2. **Boundary = "since last refresh."** A fact is *Actualité* if its publication date is **after** the previous-update cutoff; otherwise (older, or unknown date) → *Compléments*.
3. **Unknown publication date → Compléments** (claiming "actualité" requires positive evidence of recency).
4. **Retrieval unchanged.** Keep score-based candidate selection + the 0.4 / 0.5 floors + the 6-per-source cap. The decay concern is *reframed* by the two streams (long-tail lands, labelled, in Compléments) rather than actively fought. Recency-aware ranking and source-exhaustion detection were considered and **deferred** (recency-ranking would starve the Compléments stream, which by design wants older finds).

## Design

### 1. Data model

Add a column to `dossier_updates` (`apps/web/lib/db/app-schema.ts`):

```
kind text not null default 'actualite'   -- 'actualite' | 'complement'
```

Generate + apply a drizzle-kit migration. Existing rows adopt `'actualite'` via the default (the one pre-existing Gabriel Attal entry — a blended block — is not retro-split; acceptable).

### 2. Date capture (coverage)

In `refreshDossier` (`apps/web/lib/refresh.ts`), in the **standing-source** branch, immediately after extracting a candidate's facts and before accumulating them:

- If a fact's `provenance.publishedAt` is absent/empty **and** `candidate.publishedAt` parses to a valid `Date`, set `provenance.publishedAt` to that ISO string.
- Only Tavily/RSS ISO-ish dates are used; YouTube-channel relative strings ("2 days ago") are **not** parsed (the YouTube adapter already supplies a reliable date).
- Enrichment happens **before** `insertFacts`, so the stored fact carries the best available date.

Item sources (single URL, no candidate) keep relying on adapter provenance. No adapter changes. `factDate()` already consumes `provenance.publishedAt`, so the evidence display benefits too.

### 3. Classification

New pure helper (e.g. `apps/web/lib/temporal.ts`), unit-tested:

```
factPublishedAt(fact): Date | null
```

Reads `provenance.publishedAt`; returns a valid `Date` or `null`. **No fallback to `extractedAt`** — an unknown publication date must stay unknown (the `factDate()` fallback is for *display*, not classification).

```
classify(fact, cutoff: Date | null): 'actualite' | 'complement'
```

With a **non-null** `cutoff`: `actualite` iff `factPublishedAt(fact)` is non-null **and** `> cutoff`; otherwise `complement`. With a **null** `cutoff` (no prior update and no brief time — i.e. the first update): "since last time" is undefined, so **all** new facts are `actualite`.

The boundary `cutoff` reuses `newFactsCutoff(dossierId, briefGeneratedAt)` in `synthesis.ts` (latest update `createdAt`, else `briefGeneratedAt`, else null).

### 4. Synthesis — emit up to two updates

In `composeDossier` (`apps/web/lib/synthesis.ts`), update path (`kind === 'update'`):

1. Compute `cutoff = newFactsCutoff(...)`.
2. Take the facts this update treats as new (those created since `cutoff` — existing selection behaviour) and partition them into `{ actualite: Fact[], complement: Fact[] }` via `classify(fact, cutoff)`. Note the **two uses of `cutoff`**: a fact's *creation* time decides whether it is new this run; its *publication* date decides which stream it lands in.
3. For **each non-empty** bucket, in order [actualite, complement]:
   - Build source groups from that bucket's facts.
   - Call `buildUpdatePrompt(...)` with a bucket-appropriate instruction ("recent developments since the last update" vs "older material newly added to the dossier").
   - Insert one `dossier_updates` row with `kind` set accordingly + its `factCount`.
   - Emit a `synthesis` progress event tagged with the bucket.
4. Two LLM calls only when both buckets are populated (updates are short; acceptable cost). A refresh that finds only older material writes a single *Compléments* entry.

`buildUpdatePrompt` gains a parameter for the framing line; the existing prompt text is the `actualite` variant.

### 5. Journal UI — two sections

- `listUpdates` (`apps/web/lib/dossiers.ts`) returns `kind`.
- `Journal` (`apps/web/components/journal.tsx`) splits entries by `kind` into two labelled sub-sections — **Actualité** and **Compléments / Découvertes** — each newest-first, each reusing the numbered-superscript citations + the shared `CitationsProvider` toggle (from the Q4 work).
- An empty section is hidden; both empty → render nothing (current behaviour). The single shared "Afficher les sources" toggle governs both.

## Edge cases

- **Unknown date** → Compléments (deliberate).
- **First assembly** → brief from all facts, no journal (unchanged); first *update* (null cutoff) → all Actualité.
- **Existing Gabriel Attal entry** → defaults to `'actualite'`; not retro-split.
- **Item sources** → no candidate date; rely on adapter provenance (may be unknown → Compléments).
- **Both buckets empty** (no genuinely new facts) → no update written (matches the refresh route's `added > 0` gate).

## Out of scope (deferred)

- Recency-aware candidate ranking; source-exhaustion detection (Q2 retrieval-side).
- Storing the YouTube video **title** in provenance (separate additive enhancement).
- Re-extracting existing facts to backfill dates.

## Testing & verification

- **Unit (vitest):** `factPublishedAt` (valid ISO / missing / malformed) and `classify` (after-cutoff, before-cutoff, equal-to-cutoff, unknown-date, null-cutoff) in `apps/web/lib/temporal.test.ts`.
- **Integration:** the partition logic in the synthesis update path (both-buckets, only-actualité, only-compléments).
- **Visual:** a throwaway preview route rendering a `Journal` with both kinds, confirming two labelled streams + citation toggle.
- **Gate:** `pnpm --filter @veille/web typecheck`, `pnpm test`, and a production build with the dev server stopped.

## Rollout

Additive migration (new column with default) — safe on the dev DB over the SSH tunnel via `pnpm --filter @veille/web db:generate` + `db:migrate`. No data backfill required.
