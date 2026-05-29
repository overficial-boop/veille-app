# Veille Reboot — Foundation & First Living Dossier (M0 + M1)

- **Date:** 2026-05-29
- **Status:** Approved design, pre-implementation
- **Supersedes nothing** — this is a fresh-start rebuild; the current `veille` repo becomes a *porting source*, not the product.

---

## 1. The reframe

Veille today is a **configuration tool**: the user assembles adapters, discovery tools, and sources by hand. The reboot makes it an **intent tool**: the user describes — in plain language — a subject they care about, and the system assembles the sources, watches them over time, and presents the result. The machinery is hidden.

The product is for **non-technical users**. Every layer follows one UX principle, discovered during the design conversation:

> **Smart default + always overridable + extensible library.**

This holds for sources (auto-picked connectors, editable, growing set), presentation (auto-picked template, editable, growing set), and cadence (auto-picked refresh rhythm, editable).

The **soul** of the product is a **living dossier**: a subject-shaped document that watches the world and grows itself, surfacing new, dated, sourced facts over time. It is durational, not transactional — closer to *dossier / intelligence / tracking* than to *search* or *news*.

## 2. North star (full vision — context, NOT all in scope)

The product decomposes into five pieces:

1. **Planner (front door)** — natural-language intent → a plan: which connectors, which presentation template, what refresh cadence. Auto, with an advanced-mode editor.
2. **Source library** — general connectors (web/news, YouTube, RSS, direct URL) + domain connectors (e.g. a padel-results API), all behind the universal `extract → Fact[]` contract. Extensible.
3. **Living engine** — automatic watching on a cadence + novelty detection (genuinely-new, worth-surfacing) → merge into the dossier.
4. **Presentation** — two faces: a universal *feed* + a templated *synthesis* (Profile, Chronology, …), auto-picked from content, overridable, drawn from an extensible registry.
5. **Library & social** — dossiers in a shared library: browse, subscribe to updates, fork/extend. Multi-user.

Pieces 1–4 = one great living dossier. Piece 5 = the network on top.

**Build order (engine-first):**

| Milestone | Name | What it delivers |
|---|---|---|
| **M0** | Foundation | Fresh Next.js + better-auth + Postgres app; ported core + adapters + planner. |
| **M1** | Body | Intent → planned general sources → presented dossier (Profile/Chronology) → **manual** refresh that surfaces new dated, sourced facts. |
| M2 | Heartbeat (the soul) | Automatic watching on a cadence + semantic novelty detection. |
| M3 | Expert sources | First domain connector (the padel-results API), proving the connector-library architecture. |
| M4 | Library | Multi-user shared library: browse, subscribe, fork/extend. |

Rationale for engine-first: you cannot judge whether a *feed of auto-updates* is good until single-dossier output is good — and that respects the standing principle *"don't automate before manual validates value."* M1 builds the body; M2 gives it the heartbeat.

**This spec covers M0 + M1 only.** M2–M4 each get their own spec → plan → implementation cycle later.

## 3. Scope of this spec

**In scope.** A fresh Veille web app where a signed-in user types what they want to track and gets a presented dossier (Profile or Chronology) they can refresh to pull in new dated, sourced facts. Two seed templates. General sources only. Manual refresh.

**Out of scope (deferred to later milestones).**

- Cron / automatic watching and *semantic* novelty detection (M2).
- Domain-specific connectors, including the padel-results API (M3).
- The shared library, subscribe, fork/extend, and any multi-user *sharing UI* (M4).
- The CLI and the Flutter Android app (left behind; the app may return as a client post-M4).
- Payments, teams, exports beyond what core already provides.

The **proving ground** is two real dossiers, built end-to-end: a **Profile** (a padel player) and a **Chronology** (a legal *affaire*). Both must feel good before M1 is "done."

## 4. M0 — Foundation

### 4.1 Stack

- **Framework:** Next.js (App Router), TypeScript strict.
- **Auth:** better-auth, email-based (magic link / OTP). Replaces the old NextAuth-email-OTP + separate phone-JWT dual setup with a single clean system. Reuse the existing **Resend** sender (`send.theviborapapers.com`) for delivery.
- **Database:** PostgreSQL. This is the roadmap's own trigger ("Postgres when multi-user matters") arriving on schedule. Local Postgres for dev; a new database on the VPS for prod.
- **Repo:** brand-new git repo, **new `CLAUDE.md`** (see 4.4), new domain (deferred — keep building under `Veille`; final public domain locked pre-launch).
- **Layout:** **monorepo** (pnpm workspaces). `@veille/core` + adapters + `@veille/discovery` stay as portable packages; a fresh `apps/web` sits on top. Keeping the packages portable preserves their publishability and lets a future client (or the resting Flutter app) reuse them.

### 4.2 Porting manifest — what comes from the current `veille`

**Port (logic is sound; carries over with light edits):**

- **`@veille/core`** — `types.ts` (Fact/Subject/Provenance/AdapterName), `extract.ts` (adapter registry + orchestration), `pipeline.ts`, `chunk.ts` (time-window chunking), `passage.ts` (passage reconstruction), `prompt.ts` (template load + hash), `pricing.ts`, the LLM layer (`llm.ts`, `anthropic-client.ts`, `gemini-client.ts`), `summary-stream-parser.ts`, `export.ts`.
- **Adapters** — `@veille/adapter-youtube` (incl. `supadata.ts`, `transcript.ts` disk cache, `metadata.ts`, `track-ranking.ts`), `@veille/adapter-web` (jsdom + Readability), `@veille/adapter-text`, `@veille/adapter-pdf`.
- **`@veille/discovery`** — `plan-queries.ts` (the planner — the heart of the new front door), `providers/` (tavily, rss, youtube-channel), `summarize.ts`, `suggest.ts`, the `optimize-*` helpers, `types.ts`.

**Port the logic, swap the persistence:**

- `core/operations.ts` — the operation shapes (`createSubject`, `addSource`, `removeSource`, `runRefresh` with its `onProgress`/`onSource*`/`onCost` callbacks, discovery ops) are reused, but their persistence is re-pointed from the file/SQLite stores to the new Postgres store.

**Do NOT port (rebuilt fresh):**

- `core/subject-store.ts` (file-based `.veille/subjects/*.json`) → replaced by the Postgres dossier store.
- The old web app's SQLite `dossiers` table and `lib/dossier-store.ts`, `lib/review-store.ts`, `lib/db.ts` → replaced by Postgres + normalized tables.
- All old auth (NextAuth config, phone JWT request/verify routes).
- The entire old UI.

**Leave behind:**

- `@veille/cli` (web-first product has no CLI need in M0/M1).
- The Flutter Android app (`apps/android`) — rests; may return as a client after M4.
- The drifted VPS repo state.

**Carry as operational knowledge** (into the new `CLAUDE.md` and/or reference notes, not as code): Supadata quirks (`videoId=` param not `url=`, 202/jobId polling for long videos, free-tier 1 req/s + ~credits remaining, lang-mismatch fallback); the YouTube datacenter-IP bot-check (server-side `youtubei.js`/`yt-dlp` is blocked — Supadata is the server transcript path); the jsdom `xhr-sync-worker` stub; the VPS systemd sandbox `ReadWritePaths` requirement for the transcript cache; Resend sender setup.

### 4.3 What gets genuinely simpler

The old system carried a *dual-auth* split (web cookie + phone JWT, both resolving to one user) and *dual storage* (legacy file-subjects + SQLite dossiers). Web-first + better-auth + Postgres collapses both into one auth system and one store. This is the main structural win of the reboot beyond the clean UI.

### 4.4 New `CLAUDE.md` outline

The fresh repo's `CLAUDE.md` should be written from scratch (not copied) and cover: product identity & soul (living dossier, the UX principle); the intent → plan → present → refresh model; the five-piece architecture + milestone order; the `extract → Fact[]` contract and the Fact/Dossier schemas; the stack (Next.js / better-auth / Postgres / monorepo); the ported-package map; the operational gotchas from 4.2; and the explicit non-scope.

## 5. Data model (Postgres, normalized)

Real columns for everything the living engine and library will query; JSONB only for genuinely adapter-specific shapes.

- **`users`** — managed by better-auth (id, email, …).
- **`dossiers`** — `id`, `owner_id` (FK users), `name`, `intent` (the raw natural-language input, also the `subjectHint`), `language`, `template` (`'profile' | 'chronology' | 'feed'`), `cadence` (recorded by the planner; *not acted on* in M1), `status`, `created_at`, `refreshed_at`.
- **`sources`** — `id`, `dossier_id` (FK), `connector` (`'youtube' | 'web' | 'text' | 'pdf' | 'tavily' | 'rss' | 'youtube-channel'`), `kind` (`'standing' | 'item'`, see below), `input` (JSONB: adapter-specific — URL, query, channel id, …), `label`, `last_extracted_at` (null = pending/retry), `created_at`.

  **Two source kinds.** An **item** source is one concrete thing (a URL, video, PDF) — extracted once. A **standing** source is a *query that yields new items over time* (a Tavily search, an RSS feed, a YouTube channel). This distinction is load-bearing: without standing sources, a refresh re-extracts the same URLs and dedup drops everything, so nothing new ever appears. Standing sources are what make even a *manual* refresh feel alive.
- **`facts`** — `id` (UUIDv7), `dossier_id` (FK), `source_id` (FK), `text`, `source_passage`, `language`, `provenance` (JSONB — adapter-specific), `extracted_by` (JSONB: model, promptHash, adapter), `confidence`, `extracted_at`, `created_at`.

**Owner columns exist from day one** so M4 (sharing/forking) needs no migration — it adds visibility/subscription tables alongside, never alters these.

**Transcript / LLM caching.** Keep the existing on-disk transcript cache (`~/.veille/cache/transcripts/`) as ported — it already works and respects the Supadata credit budget. Moving caches into Postgres is a later optimization, explicitly out of scope here.

## 6. M1 — The Body

### 6.1 Flow: intent → plan → present

1. User types an intent (e.g. *"Jules Marie and his results in his padel career"* or *"a chronology of the facts in l'affaire X"*).
2. The **planner** produces a plan: `{ sources[], template, cadence }`. It expands the current `plan-queries.ts` (which today yields Tavily queries) to also choose **source kinds** and a **presentation template**.
3. The plan **auto-runs** — extraction proceeds immediately. The plan is shown in an **advanced panel** where the user can edit sources/template/cadence, but editing is never required. *This is the "see the results directly" crux: the default path is type → watch it appear.*
4. Each source runs its adapter's `extract(input, { language, subjectHint: intent })`; returned Facts are stored.
5. The dossier renders in its chosen template.

### 6.2 The planner's expanded job

`plan-queries.ts` grows from "intent → Tavily queries" to "intent → full plan":
- **Source kinds** — decide among general connectors (web/news search via Tavily, a named YouTube channel/video, an RSS feed, a direct article/video URL). Domain connectors are recognized but none exist yet (M3).
- **Template** — pick `profile` vs `chronology` vs `feed` from the intent's shape (a person/entity → profile; "chronology/timeline/affaire" → chronology; otherwise → feed).
- **Cadence** — suggest a refresh rhythm. **Recorded only** in M1; the automatic loop is M2.

### 6.3 Sources in M1

General connectors only: web/news search (Tavily), YouTube (Supadata transcript path on the server), RSS, and direct URLs/files (web/youtube/pdf/text adapters by hostname/kind). No domain connectors.

**Discovery folds into the source loop — no triage step.** The old architecture separated *discovery tools* (Tavily/RSS/channel → proposals the user accepts) from *sources* (things you extract). The reboot collapses that: a standing source, on refresh, runs its provider, takes the new candidate URLs, and **auto-extracts** them — no proposal queue, no "accept" click. This is the direct consequence of the user choosing *truly automatic* over *auto-gather, you bless*. Quality control is URL-dedup in M1 and *semantic* novelty in M2; the deliberate bet is that auto-accept + good novelty filtering beats a manual triage gate for a non-technical user.

**Refresh behavior by kind.** Standing sources re-run their query/feed/channel and extract newly-seen URLs (dedup against facts already in the dossier). Item sources are extracted once and only re-run under a force option. So a fresh dossier's first assembly and its later refreshes use the same machinery — assembly is just the first refresh.

### 6.4 Presentation: two faces, two seed templates

- **Feed** (universal) — reverse-chronological list of facts, each with its date and a link to the source passage. Always available for any dossier.
- **Synthesis** — one of:
  - **Profile** — identity header → key facts → a timeline of results/events. (The Jules-Marie shape.)
  - **Chronology** — a strict dated sequence of events, each cited. (The *affaire* shape.)

The template is auto-selected by the planner and overridable by the user. Templates live in an **extensible registry** so adding a third (e.g. a comparison, a map) later is additive.

### 6.5 Refresh: the manual heartbeat

A **Refresh** action re-walks the dossier's sources (those with `last_extracted_at` unset, or all with a force option), runs extraction, and merges results. Dedup in M1 is the existing **URL + exact `(timestampStart, timestampEnd, text)` triple** drop. Newly-arrived facts are visibly surfaced as new, dated entries. *Semantic* novelty ("is this fact substantively new?") and *automatic* cadence are M2.

### 6.6 Language

Reuse the existing precedence: explicit override → dossier language → detected. Default leans French for the launch persona but is fully overridable. `language` is the output language of `Fact.text`; the verbatim `source_passage` stays in the source's language.

## 7. Component boundaries

Each unit has one purpose, a defined interface, and known dependencies:

- **Planner** (`@veille/discovery`) — `intent → { sources, template, cadence }`. Depends on an LLM client + Tavily. Pure decision-making; no persistence.
- **Connector/adapter layer** (`@veille/adapter-*`) — `extract(input, hints) → Fact[]`. Ported unchanged; the universal contract.
- **Dossier store** (`apps/web` server / a small data module) — Postgres CRUD for dossiers/sources/facts. The only thing that knows SQL.
- **Refresh orchestration** (ported `operations.runRefresh`, re-pointed to the Postgres store) — walks sources, calls adapters, merges, dedups, reports progress via callbacks.
- **Presentation/template registry** (`apps/web`) — maps a dossier + its facts to a rendered view; one entry per template.

You can change any one without breaking the others: the planner doesn't know about SQL; templates don't know about adapters; adapters don't know about dossiers.

## 8. Error handling & edge cases

- **Intent yields no usable sources** — surface a friendly "couldn't find sources for this — try rephrasing / add one manually" rather than an empty dossier.
- **A source fails to extract** — keep going; leave that source's `last_extracted_at` unset so the next refresh retries it (idempotent refresh, as today).
- **YouTube on the server** — transcript via Supadata; `fetchVideoInfo` is best-effort, so a video may render with intact facts but a blank title (known, acceptable).
- **All sources fail on a refresh** — report it; don't claim success.
- **Auth** — all dossier routes require a signed-in user; a dossier belongs to its `owner_id`.

## 9. Testing strategy

- **Ported packages** keep their existing tests (adapters, chunking, passage, planner output shape).
- **New:** dossier-store CRUD against a test Postgres; planner produces a well-formed plan (right template for person vs. chronology intents); dedup drops exact repeats; refresh is idempotent.
- **End-to-end smoke (the real bar):** build the two proving-ground dossiers — a padel-player Profile and an *affaire* Chronology — and confirm they read well, cite correctly, and that a refresh surfaces new entries without duplicates.

## 10. Open questions / deferred decisions

- **Template-selection heuristic** — planner-driven (LLM picks template) vs. rule-based (keywords like "chronology/timeline"). Lean planner-driven with a rules fallback; finalize in the plan.
- **Postgres hosting on the VPS** — new managed-on-box Postgres vs. container; decide at M0 implementation (the VPS deploy reference notes apply).
- **Exact better-auth flow** — magic link vs. OTP code; both are fine, pick during M0.
- **Where the spec + plan live** — written in the current repo now; copied into the new repo when it's scaffolded (first implementation step of M0).

## 11. Definition of done (M0 + M1)

A signed-in user, on the fresh stack, types an intent, watches a dossier assemble itself, reads it in the right template (Profile or Chronology) with every fact dated and cited, hits Refresh, and sees genuinely new facts appear — with no duplicates, on local Postgres, ready to point at a VPS database. The two proving-ground dossiers both feel good enough to want the M2 heartbeat.
