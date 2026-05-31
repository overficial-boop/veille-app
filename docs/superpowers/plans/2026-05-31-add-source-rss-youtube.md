# Add RSS feeds & YouTube channels to "Ajouter une source" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add an RSS feed (blog/magazine) and a YouTube channel from "Ajouter une source", on top of the existing web-page and permanent-search options.

**Architecture:** Pure front-of-house work — the refresh engine already runs `rss` standing sources. A new server-only module `apps/web/lib/source-input.ts` interprets the user's input (and resolves a YouTube channel to its **RSS feed**, server-safe, no youtubei.js). `addSourceAction` gains the two new types + add-time validation and returns a result; the SourcesPanel dialog grows from 2 to 4 type buttons and shows success/error.

**Tech Stack:** TypeScript (ESM, strict), Next 15 App Router (server actions + client component), vitest, `fetch` (server-side). No new dependencies, no schema/refresh changes.

**Spec:** `docs/superpowers/specs/2026-05-31-add-source-rss-youtube-design.md`.

> **Naming note:** the spec tentatively called the new module `lib/youtube-feed.ts`; this plan realizes it as **`lib/source-input.ts`** because it also holds the RSS feed-title fetch and the 4-way source-row mapping (all "add-source input → row" logic).

---

## File structure

```
apps/web/lib/source-input.ts          CREATE — pure mapping + YouTube→feed resolver + feed-title fetch
apps/web/lib/source-input.test.ts     CREATE — unit tests for the PURE helpers (no network)
apps/web/app/dossier/[slug]/actions.ts MODIFY — addSourceAction: 4 types, validation, returns {ok}|{ok,error}
apps/web/components/dossier-runtime.tsx MODIFY — SourcesPanel: 4-button picker, result/error handling, type label in list
apps/web/app/dossier/[slug]/page.tsx   MODIFY — pass input.source hint through to the source list
```

---

## Task 1: `lib/source-input.ts` — pure helpers + resolver (TDD)

**Files:**
- Create: `apps/web/lib/source-input.ts`
- Test: `apps/web/lib/source-input.test.ts`

The two PURE functions (`youtubeFeedFromInput`, `sourceSpecToRow`) are unit-tested. The two async network functions (`resolveYouTubeFeed`, `fetchFeedTitle`) are implemented here but verified by the live check in Task 4 (they hit the network).

- [ ] **Step 1: Write the failing test** — `apps/web/lib/source-input.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { youtubeFeedFromInput, sourceSpecToRow } from './source-input';

describe('youtubeFeedFromInput', () => {
  const feed = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  it('maps a bare UC id to its feed', () => {
    expect(youtubeFeedFromInput('UCABCDEFGHIJKLMNOPQRSTUV')).toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('maps a /channel/UC… URL to its feed', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/channel/UCABCDEFGHIJKLMNOPQRSTUV/videos'))
      .toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('passes a channel feed URL through (normalized)', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/feeds/videos.xml?channel_id=UCABCDEFGHIJKLMNOPQRSTUV'))
      .toBe(feed('UCABCDEFGHIJKLMNOPQRSTUV'));
  });
  it('returns null for an @handle (needs network) and for non-YouTube text', () => {
    expect(youtubeFeedFromInput('https://www.youtube.com/@mkbhd')).toBeNull();
    expect(youtubeFeedFromInput('@mkbhd')).toBeNull();
    expect(youtubeFeedFromInput('le procès du siècle')).toBeNull();
  });
});

describe('sourceSpecToRow', () => {
  it('web → item/web', () => {
    expect(sourceSpecToRow('web', '  https://lemonde.fr/x  ')).toEqual({
      connector: 'web', kind: 'item', input: { url: 'https://lemonde.fr/x' }, label: 'https://lemonde.fr/x',
    });
  });
  it('search → standing/tavily', () => {
    expect(sourceSpecToRow('search', 'gabriel attal')).toEqual({
      connector: 'tavily', kind: 'standing', input: { query: 'gabriel attal' }, label: 'gabriel attal',
    });
  });
  it('rss → standing/rss with resolved label, falling back to the value', () => {
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed', { feedUrl: 'https://blog.fr/feed', label: 'Le Blog' })).toEqual({
      connector: 'rss', kind: 'standing', input: { feedUrl: 'https://blog.fr/feed' }, label: 'Le Blog',
    });
    expect(sourceSpecToRow('rss', 'https://blog.fr/feed').label).toBe('https://blog.fr/feed');
  });
  it('youtube → standing/rss carrying the feed + source hint', () => {
    expect(sourceSpecToRow('youtube', '@mkbhd', { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', label: 'MKBHD' })).toEqual({
      connector: 'rss', kind: 'standing',
      input: { feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx', source: 'youtube' },
      label: 'MKBHD',
    });
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS** — Run: `pnpm exec vitest run apps/web/lib/source-input.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/web/lib/source-input.ts`

```ts
// "Ajouter une source": interpret user input into a `sources` row.
// Server-only (uses fetch). A YouTube channel becomes an RSS feed — no youtubei.js,
// so it survives deployment to the VPS (datacenter IPs are blocked from InnerTube).

export type AddSourceType = 'web' | 'search' | 'rss' | 'youtube';

export type SourceRow = {
  connector: string;
  kind: 'item' | 'standing';
  input: Record<string, unknown>;
  label: string;
};

const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const UA = 'Mozilla/5.0 (compatible; VeilleBot/1.0; +https://veille.app)';

/** PURE. Map a known YouTube form (channel feed URL, bare UC id, or /channel/UC… URL) to its feed URL.
 *  Returns null when the input needs a network lookup (e.g. an @handle) or isn't a known YouTube form. */
export function youtubeFeedFromInput(input: string): string | null {
  const s = input.trim();
  const feed = s.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]+)/i);
  if (feed) return `${FEED_BASE}${feed[1]}`;
  if (/^UC[\w-]{20,}$/.test(s)) return `${FEED_BASE}${s}`;
  const chan = s.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (chan) return `${FEED_BASE}${chan[1]}`;
  return null;
}

/** PURE. Build the sources row for an add-source spec. For 'rss'/'youtube', pass the resolved
 *  { feedUrl, label } (from resolveYouTubeFeed / fetchFeedTitle); falls back to the raw value. */
export function sourceSpecToRow(
  type: AddSourceType,
  value: string,
  resolved?: { feedUrl: string; label?: string },
): SourceRow {
  const v = value.trim();
  switch (type) {
    case 'web':
      return { connector: 'web', kind: 'item', input: { url: v }, label: v };
    case 'search':
      return { connector: 'tavily', kind: 'standing', input: { query: v }, label: v };
    case 'rss':
      return { connector: 'rss', kind: 'standing', input: { feedUrl: resolved?.feedUrl ?? v }, label: resolved?.label?.trim() || v };
    case 'youtube':
      return { connector: 'rss', kind: 'standing', input: { feedUrl: resolved?.feedUrl ?? v, source: 'youtube' }, label: resolved?.label?.trim() || v };
  }
}

/** Fetch a feed URL, confirm it parses as a feed, and return its <title> for labelling. Server-safe. */
export async function fetchFeedTitle(feedUrl: string): Promise<{ ok: true; title?: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(feedUrl, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!res.ok) return { ok: false, error: `Le flux a répondu ${res.status}.` };
    const xml = await res.text();
    if (!/<(rss|feed|channel)[\s>]/i.test(xml)) return { ok: false, error: 'Ce lien ne ressemble pas à un flux RSS/Atom.' };
    const m = xml.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)/i);
    return { ok: true, title: m?.[1]?.trim() };
  } catch {
    return { ok: false, error: 'Impossible de lire ce flux.' };
  }
}

/** Resolve a YouTube channel (UC id / channel URL / @handle / handle / video URL) to its RSS feed + name.
 *  Server-safe: known forms are pure; otherwise fetch the channel page HTML and read the channel_id. */
export async function resolveYouTubeFeed(input: string): Promise<{ feedUrl: string; title?: string } | { error: string }> {
  const known = youtubeFeedFromInput(input);
  if (known) {
    const meta = await fetchFeedTitle(known);
    return meta.ok ? { feedUrl: known, title: meta.title } : { error: meta.error };
  }
  const pageUrl = toChannelUrl(input);
  if (!pageUrl) return { error: 'Chaîne YouTube introuvable.' };
  try {
    const res = await fetch(pageUrl, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
    if (!res.ok) return { error: `La page de la chaîne a répondu ${res.status}.` };
    const html = await res.text();
    const id = html.match(/"(?:channelId|externalId)":"(UC[\w-]+)"/)?.[1]
      ?? html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]+)/)?.[1];
    if (!id) return { error: 'Chaîne YouTube introuvable.' };
    const feedUrl = `${FEED_BASE}${id}`;
    const meta = await fetchFeedTitle(feedUrl);
    return { feedUrl, title: meta.ok ? meta.title : undefined };
  } catch {
    return { error: 'Impossible de résoudre la chaîne YouTube.' };
  }
}

/** Best-effort: a handle / channel URL / bare handle / video URL → a fetchable youtube.com URL. */
function toChannelUrl(input: string): string | null {
  const s = input.trim();
  if (/^https?:\/\/(?:www\.)?youtube\.com\//i.test(s)) return s;
  if (/^@[\w.-]+$/.test(s)) return `https://www.youtube.com/${s}`;
  if (/^[\w.-]+$/.test(s)) return `https://www.youtube.com/@${s}`;
  return null;
}
```

- [ ] **Step 4: Run tests, verify PASS** — Run: `pnpm exec vitest run apps/web/lib/source-input.test.ts`. Expected: PASS (8 tests). Then `pnpm --filter @veille/web typecheck` → clean. (If `sourceSpecToRow`'s switch trips a "not all paths return" error under strict TS, the 4 cases cover the closed union — if needed add `default: { const _e: never = type; return _e; }`.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/source-input.ts apps/web/lib/source-input.test.ts
git commit -m "feat(web): source-input helpers — YouTube channel→RSS feed resolver + add mapping + tests"
```

---

## Task 2: `addSourceAction` — 4 types, validation, result

**Files:**
- Modify: `apps/web/app/dossier/[slug]/actions.ts`

Thin orchestration over Task 1's helpers + the existing `addSource` store; verified by typecheck + the Task 4 live check (no unit test — it needs session + db + network).

- [ ] **Step 1: Replace `addSourceAction` + add the imports/result type**

Add to the imports at the top of `actions.ts`:
```ts
import { resolveYouTubeFeed, fetchFeedTitle, sourceSpecToRow, type AddSourceType } from '@/lib/source-input';
```
Replace the existing `addSourceAction` (and its doc comment, lines 20-35) with:
```ts
export type AddSourceResult = { ok: true } | { ok: false; error: string };

/** web → single URL · search → Tavily query · rss → feed URL · youtube → channel (stored as its RSS feed). */
export async function addSourceAction(
  slug: string,
  spec: { type: AddSourceType; value: string },
): Promise<AddSourceResult> {
  const id = await ownerId();
  if (!id) return { ok: false, error: 'Non authentifié.' };
  const value = spec.value.trim();
  if (!value) return { ok: false, error: 'Entrée vide.' };

  let row;
  if (spec.type === 'rss') {
    const meta = await fetchFeedTitle(value);
    if (!meta.ok) return { ok: false, error: meta.error };
    row = sourceSpecToRow('rss', value, { feedUrl: value, label: meta.title });
  } else if (spec.type === 'youtube') {
    const res = await resolveYouTubeFeed(value);
    if ('error' in res) return { ok: false, error: res.error };
    row = sourceSpecToRow('youtube', value, { feedUrl: res.feedUrl, label: res.title });
  } else {
    row = sourceSpecToRow(spec.type, value);
  }

  await addSource(id, slug, row);
  revalidatePath(`/dossier/${slug}`);
  return { ok: true };
}
```

- [ ] **Step 2: Do NOT typecheck/commit yet — continue into Task 3** — the action's new `{ type, value }` signature + result type intentionally break the old SourcesPanel call site (`{ kind, value }`). Proceed straight into Task 3, which updates the call site; the typecheck/test gate and the commit cover **both files together** (Task 3 Steps 7-8), so every commit stays green. **Tasks 2 and 3 are one executable unit — dispatch/do them together.**

---

## Task 3: SourcesPanel 4-button picker + result handling + typed list

**Files:**
- Modify: `apps/web/components/dossier-runtime.tsx` (the `SourcesPanel` component + the `SourceLite` type)
- Modify: `apps/web/app/dossier/[slug]/page.tsx` (pass the `input.source` hint)

- [ ] **Step 1: Pass the `source` hint from the page** — in `apps/web/app/dossier/[slug]/page.tsx`, the `<DossierRuntime … sources={sources.map((s) => ({ … }))} />` mapping currently emits `{ id, connector, kind, label }`. Add the hint:
```tsx
sources={sources.map((s) => ({
  id: s.id,
  connector: s.connector,
  kind: s.kind,
  label: s.label,
  source: (s.input as { source?: string } | null)?.source,
}))}
```

- [ ] **Step 2: Extend the `SourceLite` type** — find the `SourceLite` type in `apps/web/components/dossier-runtime.tsx` (the element type of the `sources` prop; it has `id`, `connector`, `kind`, `label`). Add `source?: string` to it.

- [ ] **Step 3: Add the type import + the display/option tables** — at the top of `dossier-runtime.tsx`, add a type-only import (erased — keeps the server-only module out of the client bundle):
```ts
import type { AddSourceType } from '@/lib/source-input';
```
Add these module-level consts (near the other top-level consts in the file):
```tsx
const ADD_SOURCE_OPTIONS: { type: AddSourceType; label: string; placeholder: string }[] = [
  { type: 'web', label: 'Une page web (URL)', placeholder: 'https://exemple.fr/article' },
  { type: 'search', label: 'Une recherche permanente', placeholder: 'Sujet ou requête à suivre' },
  { type: 'rss', label: 'Un flux RSS (blog, magazine)', placeholder: 'https://exemple.fr/feed' },
  { type: 'youtube', label: 'Une chaîne YouTube', placeholder: 'https://youtube.com/@chaine' },
];

function sourceTypeLabel(connector: string, source?: string): string {
  if (connector === 'web') return 'Page web';
  if (connector === 'tavily') return 'Recherche';
  if (connector === 'rss') return source === 'youtube' ? 'Chaîne YouTube' : 'Flux RSS';
  return connector;
}
```

- [ ] **Step 4: Rewrite the `SourcesPanel` state + `add()`** — replace the `kind`/`value` state and the `add` handler (current lines ~324-343) with:
```tsx
const [type, setType] = React.useState<AddSourceType>('web');
const [value, setValue] = React.useState('');
const [error, setError] = React.useState<string | null>(null);
const [pending, startTransition] = React.useTransition();
// keep the existing `remove` helper as-is (it uses its own transition or this one — leave unchanged)

function add(e: React.FormEvent) {
  e.preventDefault();
  const v = value.trim();
  if (!v) return;
  setError(null);
  startTransition(async () => {
    const res = await addSourceAction(slug, { type, value: v });
    if (res.ok) {
      setValue('');
      setType('web');
      setDialogOpen(false);
    } else {
      setError(res.error);
    }
  });
}
```
Note: `useTransition()` now destructures `[pending, startTransition]` (the existing code discarded the pending flag as `[, startTransition]`). If `remove()` used that same `startTransition`, it still works. Keep `remove` as it was.

- [ ] **Step 5: Replace the source-list badge with the type label** — in the `sources.map(...)` list item, replace the existing kind badge:
```tsx
<Badge variant="secondary" className="shrink-0">
  {s.kind === 'standing' ? 'permanente' : 'ponctuelle'}
</Badge>
```
with:
```tsx
<Badge variant="secondary" className="shrink-0">
  {sourceTypeLabel(s.connector, s.source)}
</Badge>
```

- [ ] **Step 6: Replace the 2-button picker + input + footer with the 4-button version** — replace the `<div … role="group" aria-label="Type de source">…</div>` (the two buttons, lines ~404-423), the `<Input …>` (lines ~424-431), and add an error line. The picker:
```tsx
<div className="flex flex-wrap gap-1.5" role="group" aria-label="Type de source">
  {ADD_SOURCE_OPTIONS.map((o) => (
    <Button
      key={o.type}
      type="button"
      variant={type === o.type ? 'default' : 'outline'}
      size="sm"
      onClick={() => setType(o.type)}
      aria-pressed={type === o.type}
    >
      {o.label}
    </Button>
  ))}
</div>
<Input
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder={ADD_SOURCE_OPTIONS.find((o) => o.type === type)?.placeholder}
  autoFocus
/>
{error ? (
  <p className="text-[color:var(--color-muted-foreground)] text-sm italic">{error}</p>
) : null}
```
And update the submit button (the `<Button type="submit" …>`):
```tsx
<Button type="submit" size="sm" disabled={!value.trim() || pending}>
  {pending ? 'Ajout…' : 'Ajouter'}
</Button>
```

- [ ] **Step 7: Typecheck** — `pnpm --filter @veille/web typecheck` → clean (this also resolves any Task 2 call-site mismatch). Then `pnpm test` → still green (160 + the 8 new source-input tests = 168).

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/dossier/[slug]/actions.ts" "apps/web/components/dossier-runtime.tsx" "apps/web/app/dossier/[slug]/page.tsx"
git commit -m "feat(web): 4-option add-source (action + dialog + typed list) for RSS & YouTube"
```

---

## Task 4: Integration gates + live check

**Files:** none (verification) — plus any small fixes surfaced.

- [ ] **Step 1: Static gates**
```bash
pnpm test && pnpm --filter @veille/web typecheck && pnpm --filter @veille/web build
```
Expected: tests green (incl. the 8 source-input tests); typecheck clean; build compiles. (No dev server running during build — if one is, stop it first.)

- [ ] **Step 2: Live check (dev machine — residential IP, fine; needs the SSH tunnel up).** Throwaway `tsx` script (mirror the synthesis calibration; load `apps/web/.env.local`, `delete process.env.SUPADATA_API_KEY` is NOT wanted here — we WANT Supadata for the YouTube transcript leg, so leave it set):
  1. Call `resolveYouTubeFeed('@<a real channel handle>')` → expect `{ feedUrl, title }` with a `feeds/videos.xml?channel_id=UC…` URL and the channel name. Also try a bare `UC…` id and a `/channel/UC…` URL.
  2. Call `fetchFeedTitle('<a real blog/magazine feed URL>')` → expect `{ ok: true, title }`.
  3. Reuse the `gabriel-attal` dossier: insert one `rss` source via `addSource` for a real feed and one for a resolved YouTube channel feed (with `input.source:'youtube'`), then run `refreshDossier(id, …)` and confirm it pulls items from both and that a YouTube video extracts a transcript via Supadata. Delete the two throwaway sources afterward (or use a throwaway dossier). Delete the script when done.

  Assess: do the resolver + feed-title return sensible values? Does refresh ingest both source types? Report the resolved feed URLs, the labels, and a couple of extracted facts.

- [ ] **Step 3: Visual check (optional, needs login).** With the dev server on :3000, open a dossier → Sources → Ajouter une source: confirm 4 buttons, per-type placeholders, that adding a bad feed shows the error and a good one adds with a clean label, and that the list badge reads "Flux RSS" / "Chaîne YouTube".

- [ ] **Step 4: Commit any fixes**
```bash
git add -A && git commit -m "chore(web): add-source RSS/YouTube verified end-to-end"
```

---

## Self-Review

**Spec coverage:** §3 four options → Task 3. §4 connector mapping (incl. youtube→rss + `source` hint) → `sourceSpecToRow` (Task 1) + action (Task 2). §5 server-safe channel→feed resolver → `resolveYouTubeFeed`/`youtubeFeedFromInput` (Task 1). §6 validation + `{ok,error}` result → action (Task 2) + dialog (Task 3). §7 error handling → action returns errors, dialog shows them (Task 3), refresh's existing per-source try/catch unchanged. §8 boundaries → matches the file structure (SourcesPanel labels list via `connector`+`input.source`, Task 3 Steps 1-2-5). §10 testing → Task 1 (pure units) + Task 4 (live + integration).

**Placeholder scan:** none — every code step is complete. The `tsx` live-check script (Task 4 Step 2) is described, not pre-written, deliberately (throwaway, mirrors the existing calibration pattern).

**Type consistency:** `AddSourceType` + `SourceRow` + `sourceSpecToRow` + `resolveYouTubeFeed`/`fetchFeedTitle` (Task 1) consumed by `addSourceAction` (Task 2, returns `AddSourceResult`) called by `SourcesPanel.add()` (Task 3). `SourceLite.source?` (Task 3 Step 2) fed by page.tsx (Step 1) and read by `sourceTypeLabel` (Step 3/5). `addSource(id, slug, row)` store signature unchanged.

**Open risks:** (1) the channel-page HTML fetch (Task 1 `resolveYouTubeFeed` handle path) may hit a YouTube consent interstitial from some IPs — the regex also falls back to the `feeds/videos.xml?channel_id=` link, and the live check (Task 4) confirms it on the dev IP; the known-form paths (UC id / channel URL / feed URL) need no fetch and always work. (2) Task 2 typechecks cleanly only once Task 3 updates the call site — do them in the same session (subagent-driven handles this in order).
