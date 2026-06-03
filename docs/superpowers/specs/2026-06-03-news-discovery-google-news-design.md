# News discovery — Google News watch provider (+ grounding fallback) — design

- **Date:** 2026-06-03
- **Status:** Approved (design); pending implementation plan
- **Milestone:** Discovery quality — make the **watch/refresh** path actually surface fresh, on-topic, language-localized news for *any* subject (replacing Tavily on that path).

## Motivation

Tavily is a general web-search engine; for "what's new today on subject X" it returns noisy, English-skewed, loosely-dated results, forcing a per-subject score threshold that doesn't automate. A live probe of the "Violences post PSG-Arsenal" dossier confirmed it: 50 raw candidates → 44 dropped on score, the survivors were a *different* event (a London stabbing) or already in the dossier, and nothing from this morning's French press surfaced.

A spike of **Google News RSS** for the same query returned 100 items of **French press** (Le Monde, Le Figaro, France 24, RMC, RTL) with **real dates including this morning** — exactly what was missing. The catch: Google News item links are `news.google.com/rss/articles/…` redirects; a spike confirmed they **decode to real publisher URLs** via Google's `batchexecute` endpoint (3/3 resolved to lemonde.fr / lefigaro.fr / france24.com).

## Decisions (from brainstorming)

- **Google News is the primary watch engine**, localized by the dossier language (`hl`/`gl`/`ceid`) — no domain allow-lists (those don't generalize).
- **Pluggable provider layer:** the watch path tries providers in order and degrades, so no single source is load-bearing. Order: **Google News → Gemini grounded search (fallback)**.
- **Relevance stays our LLM scorer.** Google-News/grounding candidates are **unscored** → they bypass the Tavily score-floor and go straight to `scoreRelevance` (kept vs suggestion). No per-subject threshold.
- **Tavily stays** for the broad **state** corpus-build and for **mode recherche** (ad-hoc). Only the **watch/refresh** path changes.
- **Licensed APIs are a documented future drop-in** (SerpAPI/Serper "Google News", Brave News, NewsData) — same provider contract; the productionization path when shipping multi-user. Not built now.

## Design

### 1. Google News provider — `packages/discovery/src/providers/google-news.ts`

`discoverGoogleNews(config: { query: string; language?: string; maxItems?: number }): Promise<Candidate[]>`

1. **Build the feed URL** from the language: `https://news.google.com/rss/search?q=<query>&hl=<hl>&gl=<gl>&ceid=<gl>:<hl>`. A small pure map `localeFor(language)` → `{ hl, gl }` (e.g. `fr → {hl:'fr', gl:'FR'}`, default `en → {hl:'en', gl:'US'}`). General, parameterized — no domains.
2. **Parse** with the existing `rss-parser`.
3. **Decode** each item's `…/rss/articles/<id>` link → the publisher URL (see §2), with bounded concurrency (`mapWithConcurrency`, ~4). **Decode failure → skip that item** (don't emit an unusable google-redirect URL).
4. **Map to `Candidate`:** `url` = decoded publisher URL; `title` = item title with the trailing " - Publisher" suffix stripped (pure helper `cleanTitle`); `publishedAt` = `isoDate`; `siteName` = `item.source.title`; `excerpt` = snippet; **`score` left undefined**. Cap at `maxItems` (default 10).

### 2. Google News URL decode — `packages/discovery/src/providers/google-news-decode.ts`

`decodeGoogleNewsUrl(articleUrl: string): Promise<string | null>` (verified by spike):
1. GET the `…/rss/articles/<id>` page; extract `data-n-a-sg` (signature) + `data-n-a-ts` (timestamp); the `<id>` is the path segment after `/articles/`.
2. POST `f.req` to `https://news.google.com/_/DotsSplashUi/data/batchexecute` with the `Fbv4je` payload (`["garturlreq", …, "<id>", <ts>, "<sig>"]`).
3. Parse the first non-`news.google.com` URL from the response. Return it, or `null` on any failure (missing sig/ts, non-200, parse miss).

Pure parts (payload construction, response URL extraction) are unit-tested; the network round-trip is verified live.

### 3. Gemini grounded-search fallback — `packages/discovery/src/providers/grounded-search.ts`

`discoverGrounded(config: { query: string; language?: string }): Promise<Candidate[]>` — the **official** fallback (no scraping), used when Google News yields nothing.
- Calls Gemini (`gemini-2.5-flash`) with the `google_search` tool, prompting for recent news on the query in the dossier language.
- Reads `candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}`; each `uri` is a `vertexaisearch.cloud.google.com/grounding-api-redirect/…` link → resolve to the publisher by **following the HTTP redirect** (`fetch(..., { redirect:'follow' }).url`); skip on failure.
- Map to `Candidate` (unscored), cap to a handful.
- **VERIFIED by spike:** one grounded call returned 17 chunks (atlantico.fr, publicsenat.fr, theguardian.com, africanews.com, youtube.com…); the first `vertexaisearch` redirect followed a clean HTTP 302 to `https://atlantico.fr/article/…` (a real publisher article). So resolution is a **simple redirect-follow — no batchexecute**. Caveats observed: the grounded call is **slow (~30–60s)** — fine for a fallback; coverage is **more mixed (French + international) and fewer items** than Google News, consistent with its fallback role. If grounding is ever unavailable, **GDELT DOC API** (free, direct publisher URLs, `sourcelang`/`sourcecountry` filters — noisier) is the documented secondary.

### 4. Provider selection — `packages/discovery` + `apps/web/lib/refresh.ts`

- New connector **`'google-news'`**, input `{ query }`. `refresh.ts` `candidatesFor` dispatches `connector === 'google-news'` → `discoverGoogleNews({ query, language })`, passing the dossier language (already available as `lang` in `refreshDossier`).
- **Watch fallback chain:** a thin `discoverWatch({ query, language })` in discovery tries `discoverGoogleNews`; if it returns `[]` (or throws), tries `discoverGrounded`. `candidatesFor` for `google-news` calls `discoverWatch`. (Tavily/RSS/youtube-channel dispatch unchanged.)
- The recency window + `freshCandidates` dedup + `processCandidate` (content fetch → `scoreRelevance` → upsert) are **unchanged** — Google News just feeds better, dated candidates in.

### 5. Planner + existing dossiers

- **Planner** (`@veille/discovery` `plan-dossier.ts`): watch queries become **`google-news`** `PlannedSource`s (connector `'google-news'`, input `{ query }`, purpose `'watch'`) instead of tavily-news. State queries stay tavily.
- **Backfill** (migration or one-off script): convert existing `purpose='watch' AND connector='tavily'` sources → `connector='google-news'` (keep `input.query`; drop `topic`/`days`) so current dossiers benefit immediately.
- **Manual "Ajouter une source → Recherche"** (`source-input.ts` `sourceSpecToRow('search', …)`): now creates a **`google-news`** watch source (a "follow this for news"), per the user's choice. Mode recherche (`pullAdHoc`) stays Tavily (broad one-off).

## Edge cases

- **Decode fails for an item** → skip it (no unusable URL stored). If ALL items fail → provider returns `[]` → watch chain falls through to grounding.
- **Google News blocked (datacenter IP, deploy-time)** → provider returns `[]`/throws → grounding fallback. Flagged as a deploy-time concern (parallel to the YouTube/Supadata gotcha); works from local dev now.
- **Grounding unverified / unavailable** → §3: spike first; GDELT free as the documented secondary.
- **Non-French dossier** → `localeFor` maps the language; default `en/US`.
- **Title without a " - Publisher" suffix** → `cleanTitle` returns it unchanged.
- **Duplicate URLs across watch queries** → existing `freshCandidates` dedup.

## Testing & verification

- **Unit (vitest, pure):** `localeFor`, `cleanTitle`, the batchexecute payload builder + response-URL extractor, the grounding-chunk → candidate mapper. (Network/decode/grounding verified live.)
- **Live:** refresh the PSG-Arsenal dossier → French articles incl. this morning surface as kept/suggestions; the journal gate then promotes the genuinely-new ones. A non-French dossier localizes correctly.
- **Gate:** typecheck · `pnpm test` · build · (backfill migration applied to `veille_dev`). Rebuild `@veille/discovery` dist (web loads it at runtime).

## Risks (explicit)

1. **Decode fragility** — scrapes Google's undocumented `batchexecute`; Google can change the format (breaks decode) → grounding fallback covers it; Tavily still powers the state path.
2. **ToS** — the decode uses an undocumented internal API (against Google ToS; gray-area, fine for personal/low-volume, a liability for a public product). The grounding fallback is ToS-clean; a **licensed API** (SerpAPI/Serper/Brave/NewsData) is the clean productionization drop-in — same `discover…(query, language) → Candidate[]` contract.
3. **Datacenter IP block at deploy** — revisit at deployment (like YouTube→Supadata).

## Out of scope

- Building a licensed-API provider now (documented as a drop-in).
- A "rejected candidates" audit view (separate idea, parked).
- Changing the state path, mode recherche, or the relevance/journal gates.

## Integration points to resolve in the plan

1. Both engines are spike-verified (Google News decode → publisher URLs; grounding redirect → publisher URLs). GDELT stays a documented secondary, not built.
2. `candidatesFor` dispatch + `discoverWatch` fallback chain location (in `@veille/discovery` so it's reusable + testable). The grounded call's ~30–60s latency means the fallback should only fire when Google News returns empty.
3. Planner `PlannedSource` `google-news` variant + the single new-dossier call site; rebuild discovery.
4. Backfill of existing watch tavily sources (migration vs one-off script) + `source-input.ts` manual-search change.
