# Veille — Add RSS feeds & YouTube channels to "Ajouter une source"

- **Date:** 2026-05-31
- **Status:** **Approved in brainstorm** (3 decisions settled with the user 2026-05-31, §9). Pending the user's read-through of this spec before the implementation plan.
- **Builds on:** M1 "The Body" + the synthesis presentation (both merged to `main`). The refresh engine, the discovery providers (`tavily`, `rss`, `youtube-channel`), and the extract adapters (`web`, `youtube`, `text`, `pdf`) are all already in place.

---

## 1. Goal

The "Ajouter une source" control currently exposes only **two** of the connectors the engine already supports: a web page (URL → `web` item) and a permanent search (natural language → `tavily` standing). Let the user also add the two source types that matter most for following blogs/magazines and creators: an **RSS feed** and a **YouTube channel**. The engine already runs both as standing sources — this is a front-of-house gap, not engine work.

## 2. Scope

**In:**
- Two new explicit options in the add-source UI: **Un flux RSS (blog, magazine)** and **Une chaîne YouTube**.
- Mapping each to a `sources` row the existing refresh loop already understands.
- A small **server-safe** resolver that turns a YouTube channel (URL / `@handle` / id) into its RSS feed URL.
- Add-time validation + auto-labelling + error feedback for the two new types.

**Out (explicitly):**
- **The planner** (`packages/discovery/.../plan-dossier.ts`) still proposes only `tavily` standing + `web` item sources from an intent. It will NOT auto-suggest RSS/YouTube sources — that is a separate discovery enhancement.
- The legacy `youtube-channel` connector (youtubei.js `getChannel/getVideos`) stays in the tree but **new adds do not use it** — it is blocked from datacenter IPs (see §5), so it is parked, not wired.
- No new connector dispatch in `refresh.ts`: a YouTube channel is stored as an `rss` source (§4).
- Multi-user, payments, cadence — unchanged, out of scope.

## 3. The model (what the user does)

The add-source dialog's type picker grows from 2 buttons to **4** (same interaction as today — the button row swaps the single text input's placeholder + helper text):

1. **Une page web (URL)** — unchanged. → `web` / `item`.
2. **Une recherche permanente** — unchanged. → `tavily` / `standing`.
3. **Un flux RSS (blog, magazine)** — *new*. Input: the feed URL (placeholder `https://exemple.fr/feed`).
4. **Une chaîne YouTube** — *new*. Input: the channel URL, `@handle`, or id (placeholder `https://youtube.com/@chaine`).

## 4. Connector mapping (what gets stored)

`sources` rows (schema unchanged — `connector` is free text, `input` is jsonb):

| User picks | `connector` | `kind` | `input` | `label` |
|---|---|---|---|---|
| Page web | `web` | `item` | `{ url }` | the URL *(unchanged)* |
| Recherche permanente | `tavily` | `standing` | `{ query }` | the query *(unchanged)* |
| **Flux RSS** | `rss` | `standing` | `{ feedUrl }` | the feed's title |
| **Chaîne YouTube** | `rss` | `standing` | `{ feedUrl: <channel feed>, source: 'youtube' }` | the channel name |

- A YouTube channel is stored **as an RSS source** pointed at the channel's feed (`https://www.youtube.com/feeds/videos.xml?channel_id=UC…`). `input.source: 'youtube'` is a **display hint** — `refresh.ts` and the `rss` provider ignore it; only the source list reads it (next bullet).
- **The source list (SourcesPanel) labels each source by type** — Page web / Recherche permanente / Flux RSS / Chaîne YouTube — derived from `connector` + `input.source`, so a YouTube channel doesn't look like a generic feed. This is the in-scope consumer of the `source` hint.
- **No engine change.** `refresh.ts` already dispatches `connector === 'rss'` → `discoverRss(input)` → feed item URLs → `findAdapter({kind:'url', url})`. YouTube `watch?v=` URLs route to the `youtube` adapter (transcripts via **Supadata**, which is server-safe); article URLs route to the `web` adapter.

## 5. YouTube channel → feed resolver (the one new piece of logic)

A pure-ish helper `resolveYouTubeFeed(input) → { feedUrl, channelName? } | { error }`, server-safe (never calls youtubei.js):

- `UC…` id, or `youtube.com/channel/UC…` → build `https://www.youtube.com/feeds/videos.xml?channel_id=<UCID>` directly (no network).
- `@handle`, `youtube.com/@handle`, `/c/name`, `/user/name` → **fetch the channel page HTML server-side** and read the RSS link it already contains: `<link rel="alternate" type="application/rss+xml" href="…/feeds/videos.xml?channel_id=UC…">` (and the page title for the label). Plain HTTP GET of a public page — not the bot-blocked InnerTube API.
- A `feeds/videos.xml?...` URL pasted directly → use as-is.
- Anything that doesn't resolve → `{ error }` (no source created; surfaced per §7).

**Why this and not the old approach:** the old prototype listed channel videos with `youtubei.js`, which "worked great" only because it ran on a residential IP (CLI / local). Per `CLAUDE.md` and the old git history (the Supadata fallback, *"survive blocked youtubei.js on the VPS"*), `youtubei.js` is blocked from datacenter IPs — so it would break once this app is deployed. The channel-RSS-feed path uses no youtubei.js at refresh time and only a server-safe HTML fetch at add time, so it survives deployment.

## 6. Validation, labelling, and the action

- `addSourceAction(slug, spec)` gains the two new specs. For **RSS** and **YouTube** it does a quick **add-time fetch** to (a) confirm the feed is readable / the channel resolves and (b) capture a human label (feed `<title>` / channel name).
- The action's signature changes from `Promise<void>` to **`Promise<{ ok: true } | { ok: false; error: string }>`** so the dialog can show success or a clear French error. Its call site in SourcesPanel (and any optimistic UI there) adjusts to the result.
- `web` and `tavily` keep their current behaviour (no add-time fetch needed); their mapping is unchanged.
- Store helper `addSource` in `lib/dossiers.ts` is unchanged (it already takes `{ connector, kind, input, label }`).

## 7. Error handling

- **Invalid / unreadable feed or unresolvable channel** → the action returns `{ ok:false, error }`; the dialog shows e.g. *"Impossible de lire ce flux."* / *"Chaîne YouTube introuvable."* and **no source is created**.
- The add-time fetch is best-effort for the *label* only: a resolvable-but-titleless feed still gets created (label falls back to the URL / handle).
- Refresh-time failures are already handled by the existing per-source `try/catch` in `refresh.ts` (a bad feed yields zero candidates, never crashes a refresh).
- Network fetches use a browser-like `User-Agent` (the `rss` provider already does); the resolver does the same.

## 8. Component boundaries

- **`components/dossier-runtime.tsx` (SourcesPanel)** — UI only: 4-way type picker, per-type placeholder/helper, calls `addSourceAction`, renders its `{ok,error}` result, and labels each listed source by type (`connector` + `input.source`).
- **`app/dossier/[slug]/actions.ts` (`addSourceAction`)** — maps the 4 specs → source rows; for RSS/YouTube runs validation + labelling via the resolver/feed-read; returns a result.
- **`lib/youtube-feed.ts` (new) — `resolveYouTubeFeed`** — the only place a channel identifier becomes a feed URL. Pure logic + one server-safe fetch; independently unit-testable for the no-network cases.
- **Everything else (refresh, providers, adapters, schema, store)** — untouched.

## 9. Resolved decisions (settled with user, 2026-05-31)

1. **Add-source UX → explicit options.** Four labelled buttons, not auto-detection. The manual add is the "override" path, so being explicit is clearest for non-technical users.
2. **YouTube channel → channel-RSS-feed, server-safe.** Store a channel as an `rss` source on its feed; never use youtubei.js (which breaks on the VPS). RSS feeds are server-safe as-is.
3. **Validate at add time.** Fetch once when adding RSS/YouTube to confirm it works and to label it nicely, with a clear error on failure — rather than storing optimistically.

## 10. Testing

- **Unit (`resolveYouTubeFeed`):** UC id → feed URL (no network); `/channel/UC…` URL → feed URL; a `feeds/videos.xml` URL → unchanged; obviously-bad input → `{ error }`. (The HTML-fetch handle-resolution path is covered by the live check, not a unit test that hits the network.)
- **Unit (add mapping):** each of the 4 specs → the expected `{ connector, kind, input, label }` (with the fetch stubbed for RSS/YouTube).
- **Live check (dev, residential IP — fine):** add a real blog RSS feed and a real YouTube channel to a throwaway/`gabriel-attal` dossier; confirm each resolves + labels, that a refresh pulls items, and that YouTube videos extract transcripts via Supadata.
- **Integration:** `pnpm test` + `pnpm --filter @veille/web typecheck` + `next build` stay green.

## 11. Definition of done

The "Ajouter une source" dialog offers four clear choices. Adding a blog/magazine **RSS feed** or a **YouTube channel** creates a standing source with a readable label and immediate success/error feedback; a refresh then pulls new items from it (YouTube transcripts via Supadata) and folds the facts into the dossier — exactly like the existing Tavily standing sources, and **without any change to the refresh engine**. The YouTube path uses the channel's RSS feed, so it keeps working after the app is deployed to the VPS.
