# News Discovery — Google News Watch Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tavily on the watch/refresh path with a `google-news` provider (localized RSS + publisher-URL decode), falling back to Gemini grounded search, so refresh surfaces fresh, on-topic, language-localized news for any subject.

**Architecture:** New discovery providers in `@veille/discovery`: `discoverGoogleNews` (RSS → decode each link to its publisher URL via Google's `batchexecute`) and `discoverGrounded` (Gemini `google_search` tool → resolve grounding redirect URLs). A `discoverWatch` chain tries Google News then grounding. `refresh.ts` dispatches the new `google-news` connector; the planner + a backfill point watch sources at it. Candidates are unscored → our existing LLM relevance scorer is the gate. Tavily stays for the state corpus + mode recherche.

**Tech Stack:** TypeScript (ESM), `@veille/discovery` (rss-parser, `mapWithConcurrency` from `@veille/core`), Next.js app, Gemini `gemini-2.5-flash`, Drizzle (Postgres), vitest. Spec: [docs/superpowers/specs/2026-06-03-news-discovery-google-news-design.md](../specs/2026-06-03-news-discovery-google-news-design.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/discovery/src/providers/google-news-decode.ts` | decode a GNews link → publisher URL | **new** |
| `packages/discovery/test/google-news-decode.test.ts` | decode pure-part tests | **new** |
| `packages/discovery/src/providers/google-news.ts` | the Google News provider | **new** |
| `packages/discovery/test/google-news.test.ts` | provider pure-part tests | **new** |
| `packages/discovery/src/providers/grounded-search.ts` | Gemini grounded fallback | **new** |
| `packages/discovery/test/grounded-search.test.ts` | grounding mapper tests | **new** |
| `packages/discovery/src/providers/watch.ts` | `discoverWatch` fallback chain | **new** |
| `packages/discovery/src/providers/index.ts` | provider re-exports | add new providers |
| `packages/discovery/src/index.ts` | package barrel | export new providers |
| `packages/discovery/src/plan-dossier.ts` | planner | watch → `google-news` |
| `packages/discovery/test/plan-dossier.test.ts` | planner test | watch connector assertion |
| `apps/web/lib/refresh.ts` | `candidatesFor` | dispatch `google-news` + pass language |
| `apps/web/lib/source-input.ts` | manual add-source | `search` → `google-news` |
| `apps/web/lib/source-input.test.ts` | add-source test | connector assertion |
| `apps/web/backfill-watch-gnews.mjs` | one-off backfill | **new (run once, then delete)** |

---

## Task 1: Google News URL decode (`google-news-decode.ts`)

**Files:**
- Create: `packages/discovery/src/providers/google-news-decode.ts`
- Create: `packages/discovery/test/google-news-decode.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `packages/discovery/test/google-news-decode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDecodeBody, extractDecodedUrl, articleIdFrom } from '../src/providers/google-news-decode.js';

describe('articleIdFrom', () => {
  it('takes the path segment after /articles/, dropping query', () => {
    expect(articleIdFrom('https://news.google.com/rss/articles/CBMiABC123?oc=5&hl=fr')).toBe('CBMiABC123');
  });
  it('returns null when not an articles URL', () => {
    expect(articleIdFrom('https://news.google.com/rss/search?q=x')).toBeNull();
  });
});

describe('buildDecodeBody', () => {
  it('embeds id, ts, sig in the Fbv4je garturlreq payload', () => {
    const body = buildDecodeBody('ID123', 1700000000, 'SIG456');
    expect(body.startsWith('f.req=')).toBe(true);
    const decoded = decodeURIComponent(body.slice('f.req='.length));
    expect(decoded).toContain('Fbv4je');
    expect(decoded).toContain('garturlreq');
    expect(decoded).toContain('ID123');
    expect(decoded).toContain('1700000000');
    expect(decoded).toContain('SIG456');
  });
});

describe('extractDecodedUrl', () => {
  it('pulls the first non-google https URL from a batchexecute response', () => {
    const resp = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"https://www.lemonde.fr/article/x\\"]",null,null,null,"generic"]]`;
    expect(extractDecodedUrl(resp)).toBe('https://www.lemonde.fr/article/x');
  });
  it('returns null when no publisher url present', () => {
    expect(extractDecodedUrl(')]}\\'\\n[["wrb.fr","Fbv4je","[]"]]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/google-news-decode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `google-news-decode.ts`**

Create `packages/discovery/src/providers/google-news-decode.ts`:

```ts
// Resolve a Google News `…/rss/articles/<id>` link to its real publisher URL.
// Google News links are not HTTP redirects — they JS-redirect — so we call Google's internal
// `batchexecute` endpoint (the method verified by spike: 3/3 links resolved to lemonde/lefigaro/france24).
// This is an undocumented API: treat decode failure as "skip this item", never throw.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The `<id>` path segment after `/articles/`, query stripped — or null if not an articles URL. */
export function articleIdFrom(articleUrl: string): string | null {
  const m = articleUrl.match(/\/articles\/([^/?]+)/);
  return m ? m[1] : null;
}

/** Build the `f.req=` body for the batchexecute `Fbv4je` (garturlreq) call. */
export function buildDecodeBody(id: string, ts: number | string, sig: string): string {
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sig}"]`;
  const payload = [[['Fbv4je', inner]]];
  return 'f.req=' + encodeURIComponent(JSON.stringify(payload));
}

/** First https URL in the response that is NOT a google host. */
export function extractDecodedUrl(responseText: string): string | null {
  const m = responseText.match(/https?:\/\/(?!news\.google|www\.google|consent\.google)[^\s"'\\<>]+/);
  return m ? m[0] : null;
}

/** Resolve one Google News article link to the publisher URL. Returns null on any failure. */
export async function decodeGoogleNewsUrl(articleUrl: string): Promise<string | null> {
  try {
    const id = articleIdFrom(articleUrl);
    if (!id) return null;
    const page = await fetch(articleUrl, { headers: { 'user-agent': UA } });
    if (!page.ok) return null;
    const html = await page.text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/);
    const ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sig || !ts) return null;
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: buildDecodeBody(id, ts[1], sig[1]),
    });
    if (!res.ok) return null;
    return extractDecodedUrl(await res.text());
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/google-news-decode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/providers/google-news-decode.ts packages/discovery/test/google-news-decode.test.ts
git commit -m "feat(discovery): Google News URL decode (batchexecute → publisher URL)"
```

---

## Task 2: Google News provider (`google-news.ts`)

**Files:**
- Create: `packages/discovery/src/providers/google-news.ts`
- Create: `packages/discovery/test/google-news.test.ts`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `packages/discovery/test/google-news.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { localeFor, cleanTitle, buildFeedUrl } from '../src/providers/google-news.js';

describe('localeFor', () => {
  it('maps fr to French locale', () => {
    expect(localeFor('fr')).toEqual({ hl: 'fr', gl: 'FR' });
  });
  it('defaults unknown/undefined to en/US', () => {
    expect(localeFor(undefined)).toEqual({ hl: 'en', gl: 'US' });
    expect(localeFor('xx')).toEqual({ hl: 'en', gl: 'US' });
  });
});

describe('cleanTitle', () => {
  it('strips a trailing " - Publisher" suffix', () => {
    expect(cleanTitle('Violences à Paris après PSG-Arsenal - Le Monde')).toBe('Violences à Paris après PSG-Arsenal');
  });
  it('leaves a title without the suffix unchanged', () => {
    expect(cleanTitle('Un titre simple')).toBe('Un titre simple');
  });
});

describe('buildFeedUrl', () => {
  it('builds a localized Google News search RSS url', () => {
    expect(buildFeedUrl('violences PSG', 'fr')).toBe(
      'https://news.google.com/rss/search?q=violences%20PSG&hl=fr&gl=FR&ceid=FR%3Afr',
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/google-news.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `google-news.ts`**

Create `packages/discovery/src/providers/google-news.ts`:

```ts
import Parser from 'rss-parser';
import { mapWithConcurrency } from '@veille/core';
import type { Candidate } from '../types.js';
import { decodeGoogleNewsUrl } from './google-news-decode.js';

export type GoogleNewsConfig = { query: string; language?: string; maxItems?: number };

const DEFAULT_MAX_ITEMS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LOCALES: Record<string, { hl: string; gl: string }> = {
  fr: { hl: 'fr', gl: 'FR' },
  en: { hl: 'en', gl: 'US' },
  es: { hl: 'es', gl: 'ES' },
  de: { hl: 'de', gl: 'DE' },
  it: { hl: 'it', gl: 'IT' },
  pt: { hl: 'pt', gl: 'BR' },
};

/** Map a dossier language to a Google News {hl, gl}. Defaults to en/US. */
export function localeFor(language: string | undefined): { hl: string; gl: string } {
  return LOCALES[(language ?? 'en').toLowerCase()] ?? LOCALES.en!;
}

/** Google News titles are "Headline - Publisher"; drop the trailing publisher segment. */
export function cleanTitle(title: string): string {
  const i = title.lastIndexOf(' - ');
  return i > 0 ? title.slice(0, i).trim() : title.trim();
}

/** Localized Google News search RSS URL. */
export function buildFeedUrl(query: string, language: string | undefined): string {
  const { hl, gl } = localeFor(language);
  const ceid = encodeURIComponent(`${gl}:${hl}`);
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

const parser = new Parser({ timeout: 30_000, headers: { 'User-Agent': UA } });

type GItem = { title?: string; link?: string; isoDate?: string; pubDate?: string; source?: { title?: string } | string };

/** Fresh, localized news for a query. Each item's google-redirect link is decoded to its publisher
 *  URL; items whose link can't be decoded are skipped. Candidates are UNSCORED (the app's relevance
 *  scorer is the gate). */
export async function discoverGoogleNews(config: GoogleNewsConfig): Promise<Candidate[]> {
  const feed = await parser.parseURL(buildFeedUrl(config.query, config.language));
  const items = ((feed.items ?? []) as GItem[]).filter((i) => typeof i.link === 'string' && i.link.length > 0);
  const top = items.slice(0, config.maxItems ?? DEFAULT_MAX_ITEMS);

  const resolved = await mapWithConcurrency(top, 4, async (item) => {
    const url = await decodeGoogleNewsUrl(item.link!);
    if (!url) return null;
    const cand: Candidate = { url };
    if (item.title) cand.title = cleanTitle(item.title);
    const date = item.isoDate ?? item.pubDate;
    if (date) cand.publishedAt = date;
    const src = typeof item.source === 'string' ? item.source : item.source?.title;
    if (src) cand.siteName = src;
    return cand;
  });
  return resolved.filter((c): c is Candidate => c !== null);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/google-news.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/providers/google-news.ts packages/discovery/test/google-news.test.ts
git commit -m "feat(discovery): Google News watch provider (localized RSS + decode)"
```

---

## Task 3: Gemini grounded-search fallback (`grounded-search.ts`)

**Files:**
- Create: `packages/discovery/src/providers/grounded-search.ts`
- Create: `packages/discovery/test/grounded-search.test.ts`

- [ ] **Step 1: Write the failing test for the pure mapper**

Create `packages/discovery/test/grounded-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groundingChunksToUrls } from '../src/providers/grounded-search.js';

describe('groundingChunksToUrls', () => {
  it('extracts web uris + titles from grounding chunks', () => {
    const meta = { groundingChunks: [
      { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A1', title: 'atlantico.fr' } },
      { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A2', title: 'lemonde.fr' } },
      { other: {} },
    ] };
    expect(groundingChunksToUrls(meta)).toEqual([
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A1', title: 'atlantico.fr' },
      { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A2', title: 'lemonde.fr' },
    ]);
  });
  it('returns [] when metadata is missing', () => {
    expect(groundingChunksToUrls(undefined)).toEqual([]);
    expect(groundingChunksToUrls({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/grounded-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `grounded-search.ts`**

Create `packages/discovery/src/providers/grounded-search.ts`:

```ts
import { mapWithConcurrency } from '@veille/core';
import type { Candidate } from '../types.js';

export type GroundedConfig = { query: string; language?: string; maxItems?: number };

const MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_ITEMS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type Chunk = { web?: { uri?: string; title?: string } };

/** PURE. Pull {uri,title} from groundingMetadata.groundingChunks[].web. */
export function groundingChunksToUrls(meta: { groundingChunks?: Chunk[] } | undefined): { uri: string; title: string }[] {
  const chunks = meta?.groundingChunks ?? [];
  const out: { uri: string; title: string }[] = [];
  for (const c of chunks) {
    if (c.web?.uri) out.push({ uri: c.web.uri, title: c.web.title ?? '' });
  }
  return out;
}

/** Official fallback: Gemini grounded search → publisher URLs (resolved by following the
 *  vertexaisearch redirect). Slow (~30-60s); only call when Google News returns nothing. Returns []
 *  on any failure (no key, API error, nothing grounded). */
export async function discoverGrounded(config: GroundedConfig): Promise<Candidate[]> {
  const key = process.env['VEILLE_GEMINI_KEY'];
  if (!key) return [];
  const prompt = `Liste les dernières actualités récentes sur: ${config.query}. Donne des sources de presse${config.language === 'fr' ? ' françaises' : ''}.`;
  let chunks: { uri: string; title: string }[] = [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { candidates?: { groundingMetadata?: { groundingChunks?: Chunk[] } }[] };
    chunks = groundingChunksToUrls(json.candidates?.[0]?.groundingMetadata).slice(0, config.maxItems ?? DEFAULT_MAX_ITEMS);
  } catch {
    return [];
  }
  const resolved = await mapWithConcurrency(chunks, 4, async (c) => {
    try {
      const r = await fetch(c.uri, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!r.ok || /(?:^|\.)(news\.google|vertexaisearch\.cloud\.google)\.com/.test(new URL(r.url).hostname)) return null;
      const cand: Candidate = { url: r.url };
      if (c.title) cand.siteName = c.title;
      return cand;
    } catch {
      return null;
    }
  });
  return resolved.filter((x): x is Candidate => x !== null);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/discovery" exec vitest run test/grounded-search.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/providers/grounded-search.ts packages/discovery/test/grounded-search.test.ts
git commit -m "feat(discovery): Gemini grounded-search fallback provider"
```

---

## Task 4: `discoverWatch` chain + package exports

**Files:**
- Create: `packages/discovery/src/providers/watch.ts`
- Modify: `packages/discovery/src/providers/index.ts`
- Modify: `packages/discovery/src/index.ts`

- [ ] **Step 1: Create the chain**

Create `packages/discovery/src/providers/watch.ts`:

```ts
import type { Candidate } from '../types.js';
import { discoverGoogleNews } from './google-news.js';
import { discoverGrounded } from './grounded-search.js';

export type WatchConfig = { query: string; language?: string; maxItems?: number };

/** The watch/refresh discovery path: Google News first; if it yields nothing (decode all-failed,
 *  blocked, empty), fall back to the official Gemini grounded search. */
export async function discoverWatch(config: WatchConfig): Promise<Candidate[]> {
  let primary: Candidate[] = [];
  try { primary = await discoverGoogleNews(config); } catch { primary = []; }
  if (primary.length > 0) return primary;
  return discoverGrounded(config);
}
```

- [ ] **Step 2: Re-export from `providers/index.ts`**

In `packages/discovery/src/providers/index.ts`, add to the bottom export block:

```ts
export { discoverRss } from './rss.js';
export { discoverTavily } from './tavily.js';
export { discoverYouTubeChannel } from './youtube-channel.js';
export { discoverGoogleNews } from './google-news.js';
export { discoverGrounded } from './grounded-search.js';
export { discoverWatch } from './watch.js';
```

- [ ] **Step 3: Re-export from `src/index.ts`**

In `packages/discovery/src/index.ts`, change the providers export line to add the three new functions:

```ts
export {
  runDiscoveryProvider,
  discoverRss,
  discoverTavily,
  discoverYouTubeChannel,
  discoverGoogleNews,
  discoverGrounded,
  discoverWatch,
} from './providers/index.js';
```

- [ ] **Step 4: Build + typecheck the package**

Run: `pnpm --filter "@veille/discovery" build && pnpm --filter "@veille/discovery" typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/providers/watch.ts packages/discovery/src/providers/index.ts packages/discovery/src/index.ts
git commit -m "feat(discovery): discoverWatch fallback chain + exports"
```

---

## Task 5: Planner emits `google-news` watch sources

**Files:**
- Modify: `packages/discovery/src/plan-dossier.ts`
- Modify: `packages/discovery/test/plan-dossier.test.ts`

- [ ] **Step 1: Update the planner test**

In `packages/discovery/test/plan-dossier.test.ts`, the first test asserts state/watch tagging. Add a connector assertion to it (find the test "tags state queries state and watch queries watch") and append inside it:

```ts
    expect(watch.every((s) => s.connector === 'google-news')).toBe(true);
    expect(state.every((s) => s.connector === 'tavily')).toBe(true);
```

(`state`/`watch` are already computed in that test as `tavily.filter(...)` — rename the filter to read all sources: change `const tavily = plan.sources.filter((s) => s.connector === 'tavily');` to `const standing = plan.sources.filter((s) => s.kind === 'standing');` and `const state = standing.filter((s) => s.purpose === 'state'); const watch = standing.filter((s) => s.purpose === 'watch');`, then the `tavily.every(kind==='standing')` line becomes `standing.every(...)`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/discovery" build && pnpm --filter "@veille/discovery" exec vitest run test/plan-dossier.test.ts`
Expected: FAIL — watch sources are still `connector: 'tavily'`.

- [ ] **Step 3: Add `'google-news'` to `PlannedSource` + emit it for watch**

In `packages/discovery/src/plan-dossier.ts`, extend the `PlannedSource` union's standing variant to include the new connector:

```ts
export type PlannedSource =
  | { connector: 'tavily' | 'google-news'; kind: 'standing'; input: TavilyConfig; label: string; purpose: SourcePurpose }
  | { connector: 'web' | 'youtube' | 'pdf'; kind: 'item'; input: { url: string }; label: string; purpose: SourcePurpose };
```

In `tavilySources`, branch the connector + input by purpose. Replace the `.map((q: any) => { … })` body with:

```ts
      .map((q: any) => {
        const config: TavilyConfig = { query: q.query.trim() };
        if (purpose === 'watch') {
          // Watch = Google News (recency/locality). No topic/days — the provider is recency-native
          // and localized at refresh time from the dossier language.
          return { connector: 'google-news' as const, kind: 'standing' as const, input: config, label: q.query.trim(), purpose };
        }
        if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
        if (q.topic === 'news' || q.topic === 'finance' || q.topic === 'general') config.topic = q.topic;
        return { connector: 'tavily' as const, kind: 'standing' as const, input: config, label: q.query.trim(), purpose };
      });
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/discovery" build && pnpm --filter "@veille/discovery" exec vitest run test/plan-dossier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/plan-dossier.ts packages/discovery/test/plan-dossier.test.ts
git commit -m "feat(discovery): planner emits google-news watch sources"
```

---

## Task 6: Refresh dispatches `google-news`

**Files:**
- Modify: `apps/web/lib/refresh.ts`

- [ ] **Step 1: Import + dispatch in `candidatesFor`**

In `apps/web/lib/refresh.ts`, add `discoverWatch` to the discovery import:

```ts
import { discoverTavily, discoverRss, discoverYouTubeChannel, discoverWatch } from '@veille/discovery';
```

Change `candidatesFor` to accept the dossier language and dispatch the new connector:

```ts
async function candidatesFor(source: SourceRow, language: string, daysOverride?: number): Promise<Candidate[]> {
  if (source.connector === 'google-news') {
    return discoverWatch({ query: (source.input as { query: string }).query, language });
  }
  if (source.connector === 'tavily') {
    const input = daysOverride ? { ...(source.input as object), days: daysOverride } : source.input;
    return discoverTavily(input as never);
  }
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}
```

- [ ] **Step 2: Pass `lang` at the call site**

In `refreshDossier`, the standing branch calls `candidatesFor(src, daysSince)`. Change it to:

```ts
        const cands = await candidatesFor(src, lang, daysSince);
```

(`lang` is already defined near the top of `refreshDossier` as `opts.language ?? 'fr'`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS. (Rebuild discovery first if its dist is stale: `pnpm --filter "@veille/discovery" build`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): refresh dispatches google-news watch via discoverWatch"
```

---

## Task 7: Manual "Recherche" creates a `google-news` source

**Files:**
- Modify: `apps/web/lib/source-input.ts`
- Modify: `apps/web/lib/source-input.test.ts`

- [ ] **Step 1: Update the failing assertion**

In `apps/web/lib/source-input.test.ts`, the `sourceSpecToRow` block has a `search → standing/tavily` test. Change its expectation to the new connector:

```ts
  it('search → standing/google-news watch', () => {
    expect(sourceSpecToRow('search', 'gabriel attal')).toEqual({
      connector: 'google-news', kind: 'standing', purpose: 'watch', input: { query: 'gabriel attal' }, label: 'gabriel attal',
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/source-input.test.ts`
Expected: FAIL — connector is still `tavily`.

- [ ] **Step 3: Change the row + the editable-target field**

In `apps/web/lib/source-input.ts`, in `sourceSpecToRow`, change the `'search'` case:

```ts
    case 'search':
      return { connector: 'google-news', kind: 'standing', purpose: 'watch', input: { query: v }, label: v };
```

And in `sourceTargetField`, make `google-news` editable on its query (so "edit source" works) — change:

```ts
export function sourceTargetField(connector: string): 'url' | 'query' | 'feedUrl' | null {
  if (connector === 'web') return 'url';
  if (connector === 'tavily' || connector === 'google-news') return 'query';
  if (connector === 'rss') return 'feedUrl';
  return null;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter "@veille/web" exec vitest run lib/source-input.test.ts`
Expected: PASS.
Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/source-input.ts apps/web/lib/source-input.test.ts
git commit -m "feat(web): manual Recherche source uses google-news"
```

---

## Task 8: Gate — suite, build, backfill, live

**Files:**
- Create (temporary): `apps/web/backfill-watch-gnews.mjs`

- [ ] **Step 1: Typecheck + full suite**

Run: `pnpm -r typecheck && pnpm --filter "@veille/web" typecheck && pnpm test`
Expected: PASS (includes the new discovery tests).

- [ ] **Step 2: Build the packages + web (ensure `next dev` stopped before web build)**

Run: `pnpm --filter "@veille/discovery" build`
Stop `next dev` on :3000, then: `pnpm --filter "@veille/web" build`
Expected: both succeed.

- [ ] **Step 3: Backfill existing watch-Tavily sources → google-news**

Create `apps/web/backfill-watch-gnews.mjs`:

```js
// One-off: convert existing watch Tavily sources to google-news (keep the query). Run once, then delete.
import { readFileSync } from 'node:fs';
import pg from 'pg';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `update sources set connector='google-news', input = jsonb_build_object('query', input->>'query')
   where purpose='watch' and connector='tavily' and input ? 'query'`,
);
console.log('converted watch tavily → google-news:', r.rowCount);
await c.end();
```

Ensure the tunnel is up (port 15432), then run:
```bash
cd apps/web && node backfill-watch-gnews.mjs && cd ../.. && rm apps/web/backfill-watch-gnews.mjs
```
Expected: prints the converted count; file removed.

- [ ] **Step 4: Restart dev + live smoke**

Start `next dev`. On the PSG-Arsenal dossier (now with google-news watch sources), click **Rafraîchir**:
- Progress runs; French publisher articles (incl. recent) appear as kept/suggestions; the journal gate then promotes the genuinely-new ones above the brief.
- A dossier with a watch source whose Google News yields nothing still completes (grounded fallback or empty, no error).

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: news-discovery verification fixups"
```

---

## Self-Review

**Spec coverage:**
- §1 Google News provider (localeFor/cleanTitle/buildFeedUrl, RSS + decode, unscored) → Task 2. ✓
- §2 decode (articleIdFrom/buildDecodeBody/extractDecodedUrl/decodeGoogleNewsUrl) → Task 1. ✓
- §3 grounded fallback (groundingChunksToUrls + discoverGrounded, redirect-follow) → Task 3. ✓
- §4 provider selection (discoverWatch chain, candidatesFor google-news + language) → Task 4 + Task 6. ✓
- §5 planner watch→google-news + backfill + manual search → Task 5 + Task 8 (backfill) + Task 7. ✓
- Tavily stays for state/mode-recherche (unchanged), relevance/journal unchanged. ✓
- Edge cases: decode-all-fail → [] → grounded fallback (Task 4 chain); grounded failure → [] (Task 3); non-French → localeFor (Task 2). ✓

**Type consistency:** `Candidate` (existing); `GoogleNewsConfig`/`GroundedConfig`/`WatchConfig` `{ query, language?, maxItems? }`; `decodeGoogleNewsUrl(articleUrl) → string|null`; `PlannedSource` standing variant gains `'google-news'` (Task 5) and is the connector refresh dispatches (Task 6) + the planner/manual emit (Task 5/7). `candidatesFor(source, language, daysOverride?)` signature updated at its one call site. ✓

**Notes:** Decode is 2 requests/item; capped at `maxItems` (8) × ~5 watch queries → bounded but a slow refresh (acceptable, background SSE). Grounded fallback is slow (~30–60s) and only fires when Google News returns empty. Both engines spike-verified. Licensed-API drop-in is documented in the spec, not built.
