# Veille — Brief links to its sources

- **Date:** 2026-05-31
- **Status:** **Designed autonomously** while the user was away (they delegated "do everything you can," deferred #4). For the user's review on return — revisit if the per-claim-link choice (below) isn't what you wanted.
- **Builds on:** the synthesis presentation (brief + update log + by-source evidence).

## 1. Goal
The synthesis **brief** and **update notes** should hyperlink each attributed claim to the **specific source** it came from (the article/video URL), so a reader can click through to the original. Today the brief attributes by name only ("selon Le Monde") with no links. This intentionally revisits the synthesis spec's "source-level attribution, no per-claim links" decision — at the user's request.

## 2. Approach (per-claim links to real URLs, guarded)
1. **Prompt** — the synthesis prompts already pass the facts grouped by host; now they also pass **each fact's URL**, and instruct the model to attribute claims with a Markdown link to the **exact** provided URL (e.g. `selon [Le Monde](https://www.lemonde.fr/article-x)`), using ONLY the URLs given, never inventing one. `renderGroups` emits each fact as `- <text> [source: <url>]`.
2. **Guard (anti-hallucination)** — a pure `stripUnknownLinks(markdown, allowedUrls)` runs after generation: any Markdown link whose URL is not one of the dossier's **real fact source URLs** is unlinked (the link text is kept as plain prose). URL comparison ignores a trailing `/` and a `#fragment` but **preserves query strings** (so different YouTube `watch?v=` videos stay distinct). Applied in `composeDossier` to the brief (over all facts' URLs) and to each update note (over that run's new facts' URLs).
3. **Rendering** — unchanged. The existing `<Prose>` already renders Markdown links safely (`target="_blank"`, `rel="noopener noreferrer"`, no raw HTML). So links open the source in a new tab, XSS-safe.

## 3. Scope
- **In:** prompt change (brief + update), the `stripUnknownLinks` guard + its application, tests.
- **Out:** footnote/citation-ID style references (we link inline to URLs, not fact IDs); changes to the by-source evidence zone (it already links each fact to its URL via `FactRow`); any new dependency or schema change.

## 4. Component boundaries
All changes live in **`apps/web/lib/synthesis.ts`** (+ its test): `renderGroups` (emit URLs), `buildBriefPrompt`/`buildUpdatePrompt` (link instruction), new pure `stripUnknownLinks`, and its application inside `composeDossier` (after `parseBrief`/`parseUpdate`, before `setBrief`/`addUpdate`). `<Prose>` and the schema are untouched.

## 5. Testing
- **Unit:** `stripUnknownLinks` (keeps known URLs; unlinks unknown, keeping text; tolerates trailing-slash/fragment; keeps distinct `watch?v=` videos distinct). Updated `renderGroups` test for the `[source: url]` format.
- **Live:** regenerate the `gabriel-attal` brief (mode `brief`); confirm the brief contains Markdown links, that every link URL is one of the dossier's real fact source URLs, and that it renders as clickable prose.

## 6. Definition of done
Opening a dossier, the brief reads the same but its source attributions are now **clickable links to the actual articles/videos**, and no link points anywhere that isn't a real source of the dossier. Update notes behave the same.
