# Veille

A subject-tracking tool that turns a plain-language intent into a **living dossier**: the user says what they want to follow, and Veille assembles the sources, watches them over time, and presents the result. The machinery is hidden; the user sees results.

This repo is a **fresh rebuild** (web-first, multi-user) of an earlier CLI/Flutter prototype. The old project's `@veille/core` + adapters + discovery packages were ported here verbatim; everything else (auth, storage, UI) is new.

---

## Product identity

- **Soul:** a *living dossier* — durational, citation-rigorous, self-updating. Closer to *dossier / intelligence / tracking* than to *search* or *news*. The word "search" does not appear in product copy.
- **User:** non-technical, French-speaking professionals (journalists, analysts, creators). Complexity is hidden behind smart defaults.
- **The one UX principle, everywhere:** **smart default + always overridable + extensible library.** Holds for sources (auto-picked connectors, editable, growing set), presentation (auto-picked template, editable, growing set), and refresh cadence.
- **The model:** `intent → plan → present → refresh`. Type a sentence → the planner picks sources + a presentation template + a cadence → it auto-runs → the dossier renders → it refreshes (manually now, automatically later) and surfaces new, dated, cited facts.

## Architecture (five pieces, built in order)

1. **Planner** (`@veille/discovery`) — natural-language intent → `{ sources, template, cadence }`. Pure decisions, no persistence.
2. **Source library** (`@veille/adapter-*`) — general connectors (web/news, YouTube, RSS, direct URL/PDF/text) + future domain connectors, all behind the universal `extract(input, hints) → Fact[]` contract.
3. **Living engine** — automatic watching on a cadence + novelty detection → merge into the dossier. *(M2)*
4. **Presentation** — two faces: a universal **feed** + a templated **synthesis** (Profile / Chronology / …), auto-picked, overridable, from an extensible registry.
5. **Library & social** — shared library; browse, subscribe, fork/extend. Multi-user. *(M4)*

**Milestones:** M0 Foundation (this repo, **done**) → M1 Body (intent→present→manual refresh) → M2 Heartbeat (auto watch + semantic novelty) → M3 Expert sources (domain connectors) → M4 Library. Build engine-first; *don't automate before the manual loop produces good output.*

## Schemas

`Fact` (universal, stable contract — evolve additively): `id` (UUIDv7), `text`, `sourceUrl`, `sourcePassage` (verbatim, for anti-paraphrase/audit), `language`, `extractedAt`, `provenance` (adapter-specific JSON), `extractedBy` { model, promptHash, adapter }, `confidence?`. `sourcePassage` is reconstructed by the adapter, not the LLM.

Postgres tables (normalized; see `apps/web/lib/db/`): `dossiers` (owner, intent, template, cadence, status), `sources` (connector, **kind: standing|item**, jsonb input, lastExtractedAt), `facts` (text, source_passage, jsonb provenance + extracted_by, confidence). `provenance`/`extractedBy`/`input`/`cadence` are JSONB; everything else is columns. Owner FK to better-auth `user` from day one (M4-ready). **Standing vs item sources** is load-bearing: a *standing* source (Tavily query / RSS feed / YouTube channel) re-runs on refresh to find new items; an *item* source is one URL extracted once. Without standing sources, refresh surfaces nothing new.

Discovery folds into the source loop with **auto-accept** (no proposal/triage queue) — the consequence of choosing "truly automatic" over "gather-then-bless."

## Stack

- **pnpm monorepo** (ESM, TS strict). `packages/*` are portable libraries; `apps/web` is the Next app.
- **Next.js 15** (App Router) + React 19 + **Tailwind v4** (CSS-first `@theme` in `app/globals.css`).
- **better-auth** (v1.6) — email **magic link** via **Resend**. Drizzle adapter. Server config `lib/auth.ts`, client `lib/auth-client.ts`, route `app/api/auth/[...all]`, schema generated into `lib/db/auth-schema.ts`.
- **PostgreSQL** + **Drizzle ORM** + drizzle-kit. Schema in `lib/db/{auth-schema,app-schema}.ts`, barrel `lib/db/schema.ts`, client `lib/db/index.ts`. Migrations in `apps/web/drizzle/`.
- **LLM:** pluggable; web runs on **Gemini `gemini-2.5-flash`** (no Anthropic key in this env). Selected from env by the adapters.
- **Env:** `apps/web/.env.local` (gitignored), validated by `lib/env.ts` (zod). Keys: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `VEILLE_GEMINI_KEY`, `VEILLE_TAVILY_KEY`, `SUPADATA_API_KEY`.

### Ported packages (do not rewrite; evolve additively — they're public API)

`@veille/core` (Fact/Subject types, `extract`/`extractInput` + adapter registry, pipeline, chunk, passage, prompt, pricing, LLM clients, export), `@veille/adapter-youtube` (incl. Supadata transcripts + cache + metadata + `prompts/`), `@veille/adapter-web` (jsdom + Readability), `@veille/adapter-text`, `@veille/adapter-pdf`, `@veille/discovery` (planner + tavily/rss/youtube-channel providers + summarize). `core/subject-store.ts` (file storage) and `operations.ts` came along but their persistence will be re-pointed to Postgres in M1.

## Database (dev) — VPS Postgres over an SSH tunnel

Dev uses the VPS Postgres (Postgres 16 on `root@178.104.52.131`, localhost-only). Role `veille`, database `veille_dev` (prod gets `veille_prod` at deploy). It is **not** exposed publicly — connect through a tunnel:

```
# Auto-reconnecting (keepalives survive idle drops; relaunches on sleep/wake) — preferred:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-tunnel.ps1
# one-shot (dies on drop, no keepalive): ssh -L 15432:localhost:5432 root@178.104.52.131 -N
```

`DATABASE_URL` points at `localhost:15432/veille_dev`. Tunnel port **15432** is deliberate: the dev machine already runs **local Postgres 16 on `:5432` and Postgres 18 on `:5433`**, so the tunnel avoids both. The local Postgres is **not** used for dev — its superuser password is unknown/unsaved (no `pgpass.conf`), and resetting it needs admin + a service restart (not worth it). Claude opens the tunnel itself during its own DB work (background `ssh -L`); a human only needs to run it to drive the app standalone without a Claude session.

## Operational gotchas (hard-won — heed these)

- **YouTube on a server is blocked.** Datacenter IPs hit `LOGIN_REQUIRED`/bot-check (`youtubei.js` + `yt-dlp` both fail). Transcripts come from **Supadata** (`adapter-youtube/src/supadata.ts`): param is **`videoId=`** (not `url=`), handles sync 200 + async 202/jobId poll, free tier ~1 req/s + ~100 credits. `fetchVideoInfo` is best-effort → some videos render with intact facts but a **blank title**. Transcript file-cache is indefinite (1 credit per unique video).
- **jsdom xhr-sync-worker** crashes the Next server bundle; `next.config.ts` aliases it to `jsdom-xhr-sync-worker-stub.js` and marks `canvas` external. We never use sync XHR.
- **serverExternalPackages**, not transpilePackages: `@veille/*` + Node-only deps load at runtime; packages' `dist/` must be built first (the `predev`/`prebuild` scripts do this).
- **Windows monorepo scripts:** root `--filter` must use **double quotes** (`"./packages/*"`); single quotes aren't stripped by cmd and match nothing.
- **Next private folders:** a `_`-prefixed route folder (e.g. `app/api/_x`) is non-routable. Don't prefix route segments with `_`.
- **tsconfig:** the web app sets `declaration: false` (the base sets `true` for the libs); better-auth's inferred types otherwise trip TS2742.
- **Resend sender:** `send.theviborapapers.com` is the verified domain; magic-link emails send from `RESEND_FROM_EMAIL`.
- **Line endings:** `.gitattributes` pins LF (this deploys to Linux).

## Explicitly out of scope right now

Cron / automatic watching + semantic novelty (M2). Domain connectors incl. a padel-results API (M3). Shared library / subscribe / fork (M4). The old CLI and Flutter app (left behind; the app may return as a client post-M4). Payments, teams.

## Design docs

`docs/superpowers/specs/2026-05-29-veille-reboot-foundation-and-first-dossier-design.md` (the spec) and `docs/superpowers/plans/2026-05-29-veille-reboot-m0-foundation.md` (the M0 plan). M1 gets its own spec + plan.

## When in doubt

Add fields/types/features only when a real recipe demands them. Provenance is sacred — every Fact traces to a source passage. The Fact schema is a stable contract; evolve it additively.
