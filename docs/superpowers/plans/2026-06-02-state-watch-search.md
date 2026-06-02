# State-vs-Watch search + "mode recherche" (③) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split discovery into a **state** query set (broad, builds the corpus on assemble) and a **watch** set (recent/news, drives refresh), tagged on `sources.purpose`; add a **"mode recherche"** one-off ad-hoc pull that grows the curated set without saving a source.

**Architecture:** A new `sources.purpose` column ('state' | 'watch') tags every standing source. The planner emits two query arrays which become `state`/`watch`-tagged Tavily sources. A pure `sourcesForPhase(rows, phase)` helper selects which sources run per phase (assemble→state, refresh→watch with a state fallback for legacy dossiers). The per-candidate pull (fetch→score→upsert) is lifted to a module-level `processCandidate(ctx, …)` shared by the standing refresh loop and a new `pullAdHoc(dossierId, query)` that powers mode recherche.

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle ORM + drizzle-kit (Postgres), `@veille/discovery` (planner), vitest. Spec: [docs/superpowers/specs/2026-06-02-state-watch-search-design.md](../specs/2026-06-02-state-watch-search-design.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `apps/web/lib/db/app-schema.ts` | `sources` table | add `purpose` column |
| `apps/web/drizzle/0010_*.sql` | migration | generated (ADD COLUMN) |
| `apps/web/lib/db/app-schema.test.ts` | schema smoke test | assert `purpose` present |
| `packages/discovery/src/plan-dossier.ts` | planner | two query sets → tagged sources |
| `packages/discovery/test/plan-dossier.test.ts` | planner tests | new two-set shape |
| `apps/web/lib/dossiers.ts` | persistence | persist `purpose` (create + addSource) |
| `apps/web/lib/source-input.ts` | add-source spec → row | tag manual sources with `purpose` |
| `apps/web/lib/source-input.test.ts` | add-source tests | assert purpose tagging |
| `apps/web/lib/refresh.ts` | engine | `sourcesForPhase` helper, lift `processCandidate`, `pullAdHoc` |
| `apps/web/lib/refresh.test.ts` | engine helper test | **new file** — `sourcesForPhase` cases |
| `apps/web/app/dossier/[slug]/actions.ts` | server actions | `adHocPullAction` |
| `apps/web/app/dossier/[slug]/page.tsx` | page | pass `purpose` into `SourceLite` |
| `apps/web/components/dossier-runtime.tsx` | rail UI | mode-recherche input + purpose badge |

---

## Task 1: `sources.purpose` column + migration

**Files:**
- Modify: `apps/web/lib/db/app-schema.ts:25-36`
- Modify: `apps/web/lib/db/app-schema.test.ts:9-11`
- Create: `apps/web/drizzle/0010_*.sql` (generated)

- [ ] **Step 1: Add the failing schema assertion**

In `apps/web/lib/db/app-schema.test.ts`, extend the `sources` assertion (line 9-11):

```ts
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['id', 'dossierId', 'connector', 'kind', 'input', 'purpose', 'lastExtractedAt']),
    );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "@veille/web" exec vitest run lib/db/app-schema.test.ts`
Expected: FAIL — `purpose` not in `Object.keys(sources)`.

- [ ] **Step 3: Add the column to the schema**

In `apps/web/lib/db/app-schema.ts`, in the `sources` table, add `purpose` right after `kind` (line 31):

```ts
  connector: text('connector').notNull(), // youtube|web|text|pdf|tavily|rss|youtube-channel
  kind: text('kind').notNull(), // 'standing' | 'item'
  purpose: text('purpose').notNull().default('state'), // 'state' (corpus, assemble) | 'watch' (recent, refresh)
  input: jsonb('input').$type<{ url?: string; query?: string; feedUrl?: string; source?: string }>().notNull(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter "@veille/web" exec vitest run lib/db/app-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter "@veille/web" db:generate`
Expected: creates `apps/web/drizzle/0010_<name>.sql` containing
`ALTER TABLE "sources" ADD COLUMN "purpose" text DEFAULT 'state' NOT NULL;`
and updates `apps/web/drizzle/meta/`. (Migration is applied to the DB in Task 9 — generation is offline and needs no tunnel.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/db/app-schema.ts apps/web/lib/db/app-schema.test.ts apps/web/drizzle
git commit -m "feat(db): add sources.purpose (state|watch)"
```

---

## Task 2: Planner emits state + watch query sets

The planner asks the model for **two** arrays (`stateQueries`, `watchQueries`), each up to `maxQueries`. Each becomes a standing Tavily `PlannedSource` tagged with `purpose`. Watch sources carry `input.topic='news'` + a default `days` window. The `DossierPlan.sources` array stays single (createDossier already iterates it) — only the tavily variant gains a `purpose` field.

**Files:**
- Modify: `packages/discovery/src/plan-dossier.ts`
- Modify: `packages/discovery/test/plan-dossier.test.ts`

- [ ] **Step 1: Rewrite the planner tests for the two-set shape**

Replace the body of `packages/discovery/test/plan-dossier.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { planDossier } from '../src/plan-dossier.js';
import type { LlmClient } from '@veille/core';

const fakeClient = (json: object): LlmClient =>
  ({ complete: async () => ({ text: JSON.stringify(json), model: 'fake' }) } as unknown as LlmClient);

describe('planDossier', () => {
  it('tags state queries state and watch queries watch (with news topic + days)', async () => {
    const client = fakeClient({
      subjectName: "l'affaire X",
      template: 'chronology',
      stateQueries: [
        { query: 'affaire X chronologie', rationale: 'r' },
        { query: 'affaire X faits', rationale: 'r' },
      ],
      watchQueries: [{ query: 'affaire X dernières actualités', rationale: 'r' }],
    });
    const plan = await planDossier({ intent: 'une chronologie de l’affaire X', language: 'fr', client });
    const tavily = plan.sources.filter((s) => s.connector === 'tavily');
    const state = tavily.filter((s) => s.purpose === 'state');
    const watch = tavily.filter((s) => s.purpose === 'watch');
    expect(state).toHaveLength(2);
    expect(watch).toHaveLength(1);
    // watch sources are news-flavoured with a recency window
    expect((watch[0]!.input as { topic?: string }).topic).toBe('news');
    expect((watch[0]!.input as { days?: number }).days).toBeGreaterThan(0);
    expect(tavily.every((s) => s.kind === 'standing')).toBe(true);
  });

  it('caps each set at maxQueries independently', async () => {
    const five = (p: string) => Array.from({ length: 5 }, (_, i) => ({ query: `${p}${i}`, rationale: 'r' }));
    const client = fakeClient({ subjectName: 'X', template: 'feed', stateQueries: five('s'), watchQueries: five('w') });
    const plan = await planDossier({ intent: 'suivre X', language: 'fr', client, maxQueries: 3 });
    expect(plan.sources.filter((s) => s.purpose === 'state')).toHaveLength(3);
    expect(plan.sources.filter((s) => s.purpose === 'watch')).toHaveLength(3);
  });

  it('keyword guardrail forces chronology even if the model says profile', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'profile', stateQueries: [{ query: 'q', rationale: 'r' }], watchQueries: [] });
    const plan = await planDossier({ intent: 'chronologie des faits', language: 'fr', client });
    expect(plan.template).toBe('chronology');
  });

  it('adds explicit URLs in the intent as item sources, on top of the cap', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'feed', stateQueries: [{ query: 'q', rationale: 'r' }], watchQueries: [] });
    const plan = await planDossier({ intent: 'suivre https://example.com/article X', language: 'fr', client });
    const items = plan.sources.filter((s) => s.kind === 'item');
    expect(items).toHaveLength(1);
    expect(items[0]!.input).toEqual({ url: 'https://example.com/article' });
    expect(items[0]!.purpose).toBe('state');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter "@veille/discovery" build && pnpm --filter "@veille/discovery" exec vitest run test/plan-dossier.test.ts`
Expected: FAIL — `purpose` is not on `PlannedSource`, and the planner still reads `queries`.

- [ ] **Step 3: Add `purpose` to the tavily PlannedSource + a default watch window**

In `packages/discovery/src/plan-dossier.ts`, replace the `PlannedSource` type (lines 6-8) with:

```ts
export type SourcePurpose = 'state' | 'watch';

export type PlannedSource =
  | { connector: 'tavily'; kind: 'standing'; input: TavilyConfig; label: string; purpose: SourcePurpose }
  | { connector: 'web' | 'youtube' | 'pdf'; kind: 'item'; input: { url: string }; label: string; purpose: SourcePurpose };
```

Add a constant below the regexes (after line 27, `const CHRONO_RE = …`):

```ts
// Default recency window for watch queries (days), used when refresh has no prior timestamp.
const WATCH_DEFAULT_DAYS = 14;
```

- [ ] **Step 4: Ask the model for two query arrays (SCHEMA + prompt)**

Replace the `queries` property in `SCHEMA` (lines 34-48) and its `required`/`propertyOrdering` (lines 49-50) so the schema declares both arrays. The whole `SCHEMA` becomes:

```ts
const QUERY_ITEM = {
  type: 'OBJECT',
  properties: {
    query: { type: 'STRING' },
    days: { type: 'NUMBER' },
    topic: { type: 'STRING' },
    rationale: { type: 'STRING' },
  },
  required: ['query', 'rationale'],
  propertyOrdering: ['query', 'days', 'topic', 'rationale'],
} as const;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    subjectName: { type: 'STRING' },
    template: { type: 'STRING' }, // profile | chronology | feed
    stateQueries: { type: 'ARRAY', items: QUERY_ITEM },
    watchQueries: { type: 'ARRAY', items: QUERY_ITEM },
  },
  required: ['subjectName', 'template', 'stateQueries', 'watchQueries'],
  propertyOrdering: ['subjectName', 'template', 'stateQueries', 'watchQueries'],
} as const;
```

Replace the `prompt` function (lines 53-67) with:

```ts
function prompt(intent: string, language: string, maxQueries: number): string {
  return [
    'You plan a subject-monitoring dossier from a free-form intent.',
    'Return JSON: { subjectName, template, stateQueries[], watchQueries[] }.',
    '- subjectName: the short canonical name of the subject (person, entity, or affair), in ' + language + '.',
    '- template: "profile" if the subject is a person/entity; "chronology" if the intent asks for a timeline/sequence of events/an affair; otherwise "feed".',
    `- stateQueries: up to ${maxQueries} sharp Tavily queries that build a COMPREHENSIVE overview of the subject (background, key facts, who/what/why). Decompose distinct angles; do not pad.`,
    `- watchQueries: up to ${maxQueries} sharp Tavily queries framed for RECENT developments — "dernières actualités / annonces / ${new Date().getFullYear()}" style phrasings that surface this period's news. Decompose distinct angles; do not pad.`,
    '- Each query: query + one-sentence rationale; optional days, topic in news|finance|general.',
    '',
    'INTENT:',
    intent,
    '',
    'Write text in: ' + language,
    'Return JSON only.',
  ].join('\n');
}
```

> Note: `new Date().getFullYear()` runs server-side in the Next runtime — fine here (this is the planner, not a workflow script).

- [ ] **Step 5: Parse both arrays into tagged sources**

Replace the query-parsing block (lines 104-113) with a small helper + two calls. Replace:

```ts
  const rawQueries = Array.isArray(raw.queries) ? raw.queries : [];
  const tavily: PlannedSource[] = rawQueries
    .filter((q: any) => q && typeof q.query === 'string' && q.query.trim())
    .slice(0, maxQueries)
    .map((q: any) => {
      const config: TavilyConfig = { query: q.query.trim() };
      if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
      if (q.topic === 'news' || q.topic === 'finance' || q.topic === 'general') config.topic = q.topic;
      return { connector: 'tavily' as const, kind: 'standing' as const, input: config, label: q.query.trim() };
    });
```

with:

```ts
  function tavilySources(rawList: unknown, purpose: SourcePurpose): PlannedSource[] {
    const list = Array.isArray(rawList) ? rawList : [];
    return list
      .filter((q: any) => q && typeof q.query === 'string' && q.query.trim())
      .slice(0, maxQueries)
      .map((q: any) => {
        const config: TavilyConfig = { query: q.query.trim() };
        if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
        if (q.topic === 'news' || q.topic === 'finance' || q.topic === 'general') config.topic = q.topic;
        if (purpose === 'watch') {
          // Watch queries are news by nature; default the topic + a recency window the planner didn't set.
          config.topic = config.topic ?? 'news';
          config.days = config.days ?? WATCH_DEFAULT_DAYS;
        }
        return { connector: 'tavily' as const, kind: 'standing' as const, input: config, label: q.query.trim(), purpose };
      });
  }

  const tavily: PlannedSource[] = [
    ...tavilySources(raw.stateQueries, 'state'),
    ...tavilySources(raw.watchQueries, 'watch'),
  ];
```

- [ ] **Step 6: Tag item sources `state`**

Replace the `items` map (lines 116-121):

```ts
  const items: PlannedSource[] = urls.map((url) => ({
    connector: 'web',
    kind: 'item',
    input: { url },
    label: url,
    purpose: 'state' as const,
  }));
```

- [ ] **Step 7: Export the new type**

In `packages/discovery/src/index.ts`, add `SourcePurpose` to the `plan-dossier` type export (line 26):

```ts
export type { DossierPlan, DossierTemplate, PlannedSource, SourcePurpose, PlanDossierInput } from './plan-dossier.js';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter "@veille/discovery" build && pnpm --filter "@veille/discovery" exec vitest run test/plan-dossier.test.ts`
Expected: PASS (all 4).

- [ ] **Step 9: Commit**

```bash
git add packages/discovery/src/plan-dossier.ts packages/discovery/src/index.ts packages/discovery/test/plan-dossier.test.ts
git commit -m "feat(discovery): planner emits state + watch query sets"
```

---

## Task 3: Persist `purpose` on dossier creation

**Files:**
- Modify: `apps/web/lib/dossiers.ts:56-65`

- [ ] **Step 1: Map `purpose` through `createDossier`**

In `apps/web/lib/dossiers.ts`, in the `db.insert(sources).values(...)` map (lines 57-64), add `purpose`:

```ts
  await db.insert(sources).values(
    plan.sources.map((s) => ({
      id: uuidv7(),
      dossierId: id,
      connector: s.connector,
      kind: s.kind,
      purpose: s.purpose,
      input: s.input,
      label: s.label,
    })) as (typeof sources.$inferInsert)[],
  );
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS (`PlannedSource.purpose` now flows into the insert). If `@veille/discovery` types are stale, run its build first: `pnpm --filter "@veille/discovery" build`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/dossiers.ts
git commit -m "feat(web): persist source purpose on dossier creation"
```

---

## Task 4: Manual add-source tags purpose (watch for feeds/searches)

Manual sources from the "Ajouter une source" dialog: `search` (Tavily), `rss`, and `youtube` default to `purpose='watch'`; a `web` item URL stays `'state'` (items always extract — purpose is irrelevant for them, but keep the column non-null with the default).

**Files:**
- Modify: `apps/web/lib/source-input.ts:25-69`
- Modify: `apps/web/lib/dossiers.ts:98-119`
- Modify: `apps/web/lib/source-input.test.ts`

- [ ] **Step 1: Add failing assertions for purpose tagging**

In `apps/web/lib/source-input.test.ts`, inside the existing `describe('sourceSpecToRow', …)` block (find it first; if there is none, add this block at the end of the file):

```ts
describe('sourceSpecToRow purpose', () => {
  it('tags manual search/rss/youtube as watch, web item as state', () => {
    expect(sourceSpecToRow('web', 'https://x.fr/a').purpose).toBe('state');
    expect(sourceSpecToRow('search', 'requête').purpose).toBe('watch');
    expect(sourceSpecToRow('rss', 'https://x.fr/feed', { feedUrl: 'https://x.fr/feed' }).purpose).toBe('watch');
    expect(sourceSpecToRow('youtube', '@chan', { feedUrl: 'https://f', label: 'C' }).purpose).toBe('watch');
  });
});
```

Ensure `sourceSpecToRow` is imported at the top of the test file (it may already be).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "@veille/web" exec vitest run lib/source-input.test.ts`
Expected: FAIL — `purpose` is `undefined` on the returned row.

- [ ] **Step 3: Add `purpose` to `SourceRow` + set it per type**

In `apps/web/lib/source-input.ts`, extend the `SourceRow` type (lines 25-30):

```ts
export type SourceRow = {
  connector: string;
  kind: 'item' | 'standing';
  purpose: 'state' | 'watch';
  input: Record<string, unknown>;
  label: string;
};
```

Then set `purpose` in each branch of `sourceSpecToRow` (lines 54-68):

```ts
  const v = value.trim();
  switch (type) {
    case 'web':
      return { connector: 'web', kind: 'item', purpose: 'state', input: { url: v }, label: v };
    case 'search':
      return { connector: 'tavily', kind: 'standing', purpose: 'watch', input: { query: v }, label: v };
    case 'rss':
      return { connector: 'rss', kind: 'standing', purpose: 'watch', input: { feedUrl: resolved?.feedUrl ?? v }, label: resolved?.label?.trim() || v };
    case 'youtube':
      return { connector: 'rss', kind: 'standing', purpose: 'watch', input: { feedUrl: resolved?.feedUrl ?? v, source: 'youtube' }, label: resolved?.label?.trim() || v };
    default: {
      const _e: never = type;
      return _e;
    }
  }
```

- [ ] **Step 4: Thread `purpose` through `addSource`**

In `apps/web/lib/dossiers.ts`, extend the `NewSource` type (lines 98-103) and the insert (lines 110-117):

```ts
type NewSource = {
  connector: string;
  kind: 'standing' | 'item';
  purpose: 'state' | 'watch';
  input: unknown;
  label?: string | null;
};
```

```ts
  const id = uuidv7();
  await db.insert(sources).values({
    id,
    dossierId: dossier.id,
    connector: source.connector,
    kind: source.kind,
    purpose: source.purpose,
    input: source.input,
    label: source.label ?? null,
  } as typeof sources.$inferInsert);
  return id;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter "@veille/web" exec vitest run lib/source-input.test.ts`
Expected: PASS.
Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS (`addSourceAction` passes a `SourceRow` that now has `purpose`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/source-input.ts apps/web/lib/source-input.test.ts apps/web/lib/dossiers.ts
git commit -m "feat(web): tag manual sources with purpose (watch for feeds/searches)"
```

---

## Task 5: `sourcesForPhase` helper + wire into `refreshDossier`

A pure helper decides which sources run per phase, then `refreshDossier` iterates its output (the existing `needs` gate still applies). Also lift the per-candidate `processCandidate` closure to a module-level function so Task 6's ad-hoc pull can reuse it.

**Files:**
- Modify: `apps/web/lib/refresh.ts`
- Create: `apps/web/lib/refresh.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/lib/refresh.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sourcesForPhase } from './refresh';

type Row = { id: string; kind: 'standing' | 'item'; purpose: 'state' | 'watch' };
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

const rows: Row[] = [
  { id: 'state1', kind: 'standing', purpose: 'state' },
  { id: 'state2', kind: 'standing', purpose: 'state' },
  { id: 'watch1', kind: 'standing', purpose: 'watch' },
  { id: 'item1', kind: 'item', purpose: 'state' },
];

describe('sourcesForPhase', () => {
  it('assemble → state standing + items (excludes watch standing)', () => {
    expect(ids(sourcesForPhase(rows as never, 'assemble'))).toEqual(['item1', 'state1', 'state2']);
  });

  it('refresh → watch standing + items (excludes state standing)', () => {
    expect(ids(sourcesForPhase(rows as never, 'refresh'))).toEqual(['item1', 'watch1']);
  });

  it('refresh with no watch standing → falls back to state standing + items', () => {
    const noWatch = rows.filter((r) => r.purpose !== 'watch');
    expect(ids(sourcesForPhase(noWatch as never, 'refresh'))).toEqual(['item1', 'state1', 'state2']);
  });

  it('refresh with no standing at all → just items', () => {
    const onlyItems = rows.filter((r) => r.kind === 'item');
    expect(ids(sourcesForPhase(onlyItems as never, 'refresh'))).toEqual(['item1']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter "@veille/web" exec vitest run lib/refresh.test.ts`
Expected: FAIL — `sourcesForPhase` is not exported.

- [ ] **Step 3: Add the `sourcesForPhase` helper**

In `apps/web/lib/refresh.ts`, after the `SourceRow` type alias (line 24) add:

```ts
/** PURE. Which sources run in a given phase. Assemble builds the corpus from `state` standing
 *  sources; refresh watches via `watch` standing sources, falling back to `state` when a dossier
 *  has no watch sources (legacy / none planned). Item sources run in both phases (the caller's
 *  `needs` gate then skips already-extracted items). */
export function sourcesForPhase(rows: SourceRow[], phase: 'assemble' | 'refresh'): SourceRow[] {
  const standing = rows.filter((r) => r.kind === 'standing');
  const items = rows.filter((r) => r.kind === 'item');
  if (phase === 'assemble') {
    return [...standing.filter((r) => r.purpose === 'state'), ...items];
  }
  const watch = standing.filter((r) => r.purpose === 'watch');
  const refreshStanding = watch.length > 0 ? watch : standing.filter((r) => r.purpose === 'state');
  return [...refreshStanding, ...items];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter "@veille/web" exec vitest run lib/refresh.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Lift `processCandidate` to module scope**

In `apps/web/lib/refresh.ts`, define a context type + a module-level `processCandidate` above `refreshDossier`. Add after the `candidatesFor` function (line 34):

```ts
import type { RefreshConfig } from './refresh-config';

/** Everything a single-candidate pull needs, independent of phase/source. */
type PullCtx = { dossierId: string; intent: string; language: string; cfg: RefreshConfig };

/** Fetch content-only, score relevance, upsert a curated document (no fact extraction).
 *  Returns the curation status for progress reporting. Shared by the refresh loop and the
 *  ad-hoc pull (mode recherche). */
async function processCandidate(
  ctx: PullCtx,
  url: string,
  candPublishedAt: string | undefined,
  candTitle: string | undefined,
): Promise<'kept' | 'suggestion'> {
  let captured = '';
  await extract(url, { language: ctx.language, contentOnly: true, onContent: (t) => { captured = t; } });
  const rel = captured
    ? await scoreRelevance({ title: candTitle ?? url, content: captured, intent: ctx.intent, language: ctx.language, contentBudget: ctx.cfg.relevanceContentBudget })
    : { score: 0, reason: 'contenu indisponible' };
  const status: 'kept' | 'suggestion' = rel.score >= ctx.cfg.relevanceKeepFloor ? 'kept' : 'suggestion';
  const yt = /(?:^|\.)youtube\.com|youtu\.be/i.test(url);
  const siteName = yt ? 'youtube.com' : hostOf(url);
  const publishedAt = candPublishedAt ? new Date(candPublishedAt) : null;
  await upsertDocument(ctx.dossierId, {
    url,
    title: candTitle ?? url,
    siteName,
    kind: yt ? 'youtube' : 'web',
    publishedAt,
    content: captured,
    status,
    relevance: rel.score,
    relevanceReason: rel.reason,
  });
  return status;
}
```

> The `import type { RefreshConfig }` can also be merged into the existing `import { getRefreshConfig } from './refresh-config';` line as `import { getRefreshConfig, type RefreshConfig } from './refresh-config';` — either is fine; pick one and keep imports tidy.

- [ ] **Step 6: Remove the inner closure + build a `ctx`; filter srcRows via the helper**

In `refreshDossier`, delete the inner `async function processCandidate(...) { … }` block (the original lines 74-103) and replace the `srcRows` line + add a `ctx`. After the existing `const srcRows = await db.select()...` line, change it to filter by phase and build the context:

Replace (original line 66):
```ts
  const srcRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
```
with:
```ts
  const allRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const srcRows = sourcesForPhase(allRows, phase);
```

After the `seenUrls` set is built (original line 70), add:
```ts
  const ctx: PullCtx = { dossierId, intent: subjectHint || dossier?.intent || '', language: lang, cfg };
```

Then update the two `processCandidate(...)` call sites inside the loop to pass `ctx` first:
- standing branch (original line 131): `const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);`
- item branch (original line 142): `const status = await processCandidate(ctx, url, undefined, title);`

- [ ] **Step 7: Typecheck + run the whole web test suite**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS — no unused `intent` var, `ctx` used in both call sites.
Run: `pnpm --filter "@veille/web" exec vitest run lib/refresh.test.ts lib/temporal.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/refresh.ts apps/web/lib/refresh.test.ts
git commit -m "feat(web): phase→purpose source filter (sourcesForPhase) + shared processCandidate"
```

---

## Task 6: `pullAdHoc` — one-off ad-hoc pull (mode recherche engine)

Runs the ②-pipeline over a single ad-hoc Tavily query: discover → score-floor + cap → for each fresh candidate `processCandidate`. No source is created, no `refreshedAt`/`lastExtractedAt` touched, no recency filter. Dedups against existing document URLs.

**Files:**
- Modify: `apps/web/lib/refresh.ts`

- [ ] **Step 1: Add `pullAdHoc` at the end of `refresh.ts`**

After `refreshDossier` (end of file), add:

```ts
/** One-off ad-hoc pull (mode recherche): runs the curate pipeline over a single Tavily query and
 *  lands documents in the feed/suggestions by the usual relevance floor. Creates NO source and does
 *  NOT advance refreshedAt — it only grows the curated set. Dedups against existing document URLs. */
export async function pullAdHoc(
  dossierId: string,
  query: string,
  opts: { language?: string } = {},
): Promise<{ kept: number; suggested: number; total: number }> {
  registerAllAdapters();
  const q = query.trim();
  if (!q) return { kept: 0, suggested: 0, total: 0 };
  const cfg = getRefreshConfig();
  const lang = opts.language ?? 'fr';

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return { kept: 0, suggested: 0, total: 0 };
  const subjectHint = [dossier.name, dossier.intent].filter(Boolean).join(' — ');
  const ctx: PullCtx = { dossierId, intent: subjectHint || dossier.intent || '', language: lang, cfg };

  const existingDocs = await db.select({ url: documents.url }).from(documents).where(eq(documents.dossierId, dossierId));
  const seenUrls = new Set(existingDocs.map((d) => d.url));

  const cands = (await discoverTavily({ query: q })).filter((c) => !/youtube\.com\/shorts\//i.test(c.url));
  const ranked = [...cands]
    .filter((c) => c.score === undefined || c.score >= cfg.candidateScoreFloor)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, cfg.assembleCandidatesPerSource);

  let kept = 0;
  let suggested = 0;
  for (const c of freshCandidates(ranked, seenUrls)) {
    if (!findAdapter({ kind: 'url', url: c.url })) continue;
    try {
      const status = await processCandidate(ctx, c.url, c.publishedAt, c.title);
      if (status === 'kept') kept++; else suggested++;
    } catch {
      /* skip a bad candidate URL, keep going */
    }
  }
  return { kept, suggested, total: kept + suggested };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS. (All imports — `discoverTavily`, `freshCandidates`, `findAdapter`, `documents`, `dossiers` — already exist at the top of the file.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): pullAdHoc — one-off ad-hoc pull for mode recherche"
```

---

## Task 7: `adHocPullAction` server action

**Files:**
- Modify: `apps/web/app/dossier/[slug]/actions.ts`

- [ ] **Step 1: Add the action**

In `apps/web/app/dossier/[slug]/actions.ts`, add the `pullAdHoc` import to the existing imports and append the action. Add to imports near the top:

```ts
import { pullAdHoc } from '@/lib/refresh';
```

Append at the end of the file:

```ts
export type AdHocPullResult =
  | { ok: true; kept: number; suggested: number; total: number }
  | { ok: false; error: string };

/** Mode recherche: one-off ad-hoc pull → new documents land in the feed/suggestions. No source saved. */
export async function adHocPullAction(slug: string, query: string): Promise<AdHocPullResult> {
  const id = await ownerId();
  if (!id) return { ok: false, error: 'Non authentifié.' };
  const q = query.trim();
  if (!q) return { ok: false, error: 'Requête vide.' };
  const dossier = await getDossier(id, slug);
  if (!dossier) return { ok: false, error: 'Dossier introuvable.' };
  const res = await pullAdHoc(dossier.id, q, { language: dossier.language ?? 'fr' });
  revalidatePath(`/dossier/${slug}`);
  return { ok: true, ...res };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/dossier/[slug]/actions.ts
git commit -m "feat(web): adHocPullAction (mode recherche server action)"
```

---

## Task 8: UI — mode-recherche input + purpose badge

Add a "mode recherche" search box in the rail (above the sources panel) that calls `adHocPullAction` and refreshes; show each standing source's purpose as a small "État/Veille" badge in its detail panel.

**Files:**
- Modify: `apps/web/app/dossier/[slug]/page.tsx:80-88`
- Modify: `apps/web/components/dossier-runtime.tsx`

- [ ] **Step 1: Pass `purpose` into `SourceLite`**

In `apps/web/app/dossier/[slug]/page.tsx`, add `purpose` to the mapped source object (after `kind: s.kind,`, line 84):

```ts
              sources={sources.map((s) => ({
                id: s.id,
                connector: s.connector,
                kind: s.kind,
                purpose: s.purpose,
                label: s.label,
                source: s.input.source,
                target: sourceTarget(s.connector, s.input),
                lastExtractedAt: s.lastExtractedAt ? s.lastExtractedAt.toISOString() : null,
              }))}
```

- [ ] **Step 2: Add `purpose` to the `SourceLite` type**

In `apps/web/components/dossier-runtime.tsx`, extend `SourceLite` (lines 95-103):

```ts
type SourceLite = {
  id: string;
  connector: string;
  kind: string;
  purpose?: string;
  label: string | null;
  source?: string;
  target?: string;
  lastExtractedAt?: string | null;
};
```

- [ ] **Step 3: Import the action**

In the actions import block (lines 21-27), add `adHocPullAction`:

```ts
import {
  addSourceAction,
  adHocPullAction,
  removeSourceAction,
  regenerateBriefAction,
  generateBriefAction,
  updateSourceAction,
} from '@/app/dossier/[slug]/actions';
```

- [ ] **Step 4: Add the `ModeRecherche` component**

In `apps/web/components/dossier-runtime.tsx`, add this component just above `function SourcesPanel(` (line 433):

```tsx
/** Mode recherche — a one-off ad-hoc pull. Grows the curated set from a manual query without
 *  saving a standing source; new documents appear in the feed/suggestions after the refresh. */
function ModeRecherche({ slug }: { slug: string }) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [pending, startPull] = React.useTransition();
  const [note, setNote] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setNote(null);
    startPull(async () => {
      const res = await adHocPullAction(slug, q);
      if (!res.ok) {
        setNote(res.error);
        return;
      }
      setQuery('');
      setNote(res.total === 0 ? 'Aucun résultat.' : `${res.total} ${res.total === 1 ? 'document ajouté' : 'documents ajoutés'}.`);
      router.refresh();
    });
  }

  return (
    <div className="card rech" style={{ marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 .5rem' }}>Mode recherche</h3>
      <form onSubmit={submit} style={{ display: 'flex', gap: '.4rem' }}>
        <input
          className="field"
          value={query}
          placeholder="Une recherche ponctuelle…"
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Btn type="submit" variant="primary" size="sm" icon={Search} disabled={!query.trim() || pending}>
          {pending ? 'Recherche…' : 'Chercher'}
        </Btn>
      </form>
      {note ? (
        <p style={{ marginTop: '.5rem', fontSize: 'var(--t-sm)', color: 'var(--ink-3)', fontStyle: 'italic' }}>{note}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Render `ModeRecherche` in the rail**

In `DossierRuntime`, render it right before `<SourcesPanel … />` (line 388):

```tsx
      {/* Mode recherche — ad-hoc pull, then Sources */}
      <ModeRecherche slug={slug} />
      <SourcesPanel slug={slug} sources={sources} />
```

- [ ] **Step 6: Show the purpose badge in the source detail**

In `SourcesPanel`'s `src-detail` block, add a "Rôle" row for standing sources. Insert after the "Type" `kv` block (after line 590, before the "Cible" `kv`):

```tsx
                      {s.kind === 'standing' && s.purpose ? (
                        <div className="kv">
                          <span className="k">Rôle</span>
                          <span className="v">{s.purpose === 'watch' ? 'Veille' : 'État'}</span>
                        </div>
                      ) : null}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/dossier/[slug]/page.tsx apps/web/components/dossier-runtime.tsx
git commit -m "feat(web): mode-recherche input + source purpose badge"
```

---

## Task 9: Gate — full suite, build, migration, live check

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run: `pnpm -r typecheck` (or `pnpm --filter "@veille/web" typecheck && pnpm typecheck`)
Expected: PASS across packages + web.

- [ ] **Step 2: Run the full test suite from the repo root**

Run: `pnpm test`
Expected: PASS — including the new `refresh.test.ts`, updated `plan-dossier.test.ts`, `source-input.test.ts`, `app-schema.test.ts`. (Run from the repo root, not `apps/web` — per project lesson.)

- [ ] **Step 3: Apply the migration to `veille_dev`**

Open the tunnel (background) if not already up, then migrate:
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-tunnel.ps1   # background, leave running
pnpm --filter "@veille/web" db:migrate
```
Expected: migration `0010_*` applies; `sources.purpose` exists with default `'state'`. Existing rows backfill to `'state'`.

- [ ] **Step 4: Production build (ensure `next dev` is stopped first)**

Stop any running `next dev` (kill by port :3000 — per project lesson, do not build while dev runs), then:
```bash
pnpm --filter "@veille/web" build
```
Expected: build succeeds.

- [ ] **Step 5: Live smoke (manual, with `next dev`)**

Start dev, then verify:
- New dossier → assemble pulls via **state** queries (corpus builds); the rail's standing sources show **État** / **Veille** roles.
- "Actualiser" (refresh) → surfaces recent items via **watch** queries.
- **Mode recherche**: type a query → "Recherche…" → new documents appear in the feed/suggestions; "Aucun résultat." when nothing clears.
- A **legacy** dossier (e.g. Attal — all `state` after backfill) still refreshes (watch-fallback → state + recency window).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: state-watch search verification fixups"
```

---

## Self-Review

**Spec coverage:**
- §1 `sources.purpose` column → Task 1. ✓
- §2 planner two query sets → Task 2; new-dossier route stores them (state vs watch w/ `topic:news`+`days`) → Task 2 (tagging) + Task 3 (persist). ✓
- §3 phase→purpose mapping + watch-fallback → Task 5 (`sourcesForPhase`). ✓
- §4 mode recherche (reuses per-candidate logic, dedup via seenUrls, no source created) → Task 6 (`pullAdHoc`) + Task 7 (action) + Task 8 (UI). ✓
- §5 editable/visible purpose badge; manual "Recherche" defaults watch → Task 4 + Task 8. ✓
- §6 backfill migration → Task 1 + Task 9 Step 3. ✓
- Edge cases: no watch sources (Task 5 fallback), ad-hoc nothing/below-threshold (Task 6 returns total 0 → Task 8 "Aucun résultat"), ad-hoc dedup (Task 6 seenUrls), assemble with no state (helper returns items-only → empty-state CTA already handles). ✓
- Integration points: `DossierPlan` shape (Task 2, additive `purpose` on `PlannedSource`, single caller migrated in Task 3); shared per-candidate logic (Task 5 lift); UI location + transition+revalidate (Task 8, no SSE — simplest path per spec §63). ✓

**Type consistency:** `purpose: 'state' | 'watch'` used uniformly (schema column, `PlannedSource`/`SourcePurpose`, `SourceRow`, `NewSource`, `SourceLite?`); `sourcesForPhase(rows, phase)`, `processCandidate(ctx, url, publishedAt, title)`, `pullAdHoc(dossierId, query, opts)`, `adHocPullAction(slug, query)`, `AdHocPullResult` consistent across tasks.

**Out of scope (per spec):** ④ journal-as-curated-list; per-source purpose toggle in the add dialog (manual searches default watch); cadence/scheduling (M2).
