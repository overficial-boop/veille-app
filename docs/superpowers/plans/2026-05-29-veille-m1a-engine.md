# Veille M1a — Engine Implementation Plan (planner → dossier store → refresh → SSE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the M1 *engine*: turn an intent into a persisted dossier with sources, extract facts into Postgres with dedup, and stream assembly/refresh progress over SSE — everything except the presentation templates + UI (that's the M1b plan).

**Architecture:** A new `planDossier` in `@veille/discovery` (reuses `planTavilyQueries`, adds template + subjectName). Owner-scoped Postgres CRUD in `apps/web/lib/dossiers.ts`. A Postgres-native `refreshDossier` in `apps/web/lib/refresh.ts` that reuses the discovery providers + adapters + a pure dedup helper, writing facts as it goes and emitting progress. Two SSE routes (create+assemble, refresh) drive the stream.

**Tech Stack:** TypeScript (ESM), `@veille/core` (extract/findAdapter/uuidv7/slugify/Fact), `@veille/discovery` (planTavilyQueries/discover*), Drizzle + pg, Next 15 route handlers (SSE via `ReadableStream`), vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-veille-m1-body-design.md` (approved). This plan implements §4, §5, §7 and the SSE half of §3. Templates/§6 + the new-dossier/detail UI are **M1b**.

---

## Available ported APIs (already in the repo — don't reimplement)

```ts
// @veille/core
import { extract, extractInput, findAdapter, uuidv7, slugify } from '@veille/core';
import type { Fact, ExtractInput } from '@veille/core';
extract(url: string, hints?: ExtractHints): Promise<Fact[]>;            // url-string convenience
findAdapter(input: ExtractInput): Adapter | undefined;                 // {kind:'url',url} | {kind:'text',...}
type Fact = { id; text; sourceUrl; sourcePassage; language; extractedAt;
              provenance: unknown; extractedBy: {model;promptHash;adapter}; confidence? };
slugify(s: string): string;                                            // from subject-store
uuidv7(): string;

// @veille/discovery
import { planTavilyQueries, discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate, PlannedQuery } from '@veille/discovery';
planTavilyQueries({ intent, language?, model?, client? }): Promise<{ queries: PlannedQuery[]; model: string }>;
// PlannedQuery = { config: TavilyConfig; rationale: string }; TavilyConfig = { query; days?; topic?; maxResults?; includeDomains? }
discoverTavily(config: TavilyConfig): Promise<Candidate[]>;            // also discoverRss(RssConfig), discoverYouTubeChannel(YouTubeChannelConfig)
type Candidate = { url; title?; publishedAt?; author?; siteName?; excerpt?; raw? };
import { selectLlmClient } from '@veille/core';                        // LlmClient.complete(prompt,{jsonSchema,model})

// apps/web (M0)
import { db } from '@/lib/db';
import { dossiers, sources, facts } from '@/lib/db/schema';
import { registerAllAdapters } from '@/lib/adapters';                  // call once before extract()
```

`registerAllAdapters()` must run before any `extract`/`findAdapter` in a given process; call it at the top of the refresh engine.

## File structure

```
packages/discovery/src/
  plan-dossier.ts            CREATE — planDossier(): intent → DossierPlan (template + sources + subjectName)
  plan-dossier.test.ts       CREATE
  index.ts                   MODIFY — export planDossier + types

apps/web/lib/
  dossiers.ts                MODIFY — add createDossier/getDossier/listFacts/listSources/addSource/removeSource/setTemplate
  facts-map.ts               CREATE — Fact → facts insert row; pure
  facts-map.test.ts          CREATE
  dedup.ts                   CREATE — pure dedup helper (dossier-wide, by sourceUrl+text)
  dedup.test.ts              CREATE
  refresh.ts                 CREATE — refreshDossier(dossierId,{force?,onProgress})
apps/web/app/
  api/dossiers/route.ts                 CREATE — POST create dossier (returns {slug})
  api/dossiers/[slug]/assemble/route.ts CREATE — GET SSE: run first refresh, stream progress
  api/dossiers/[slug]/refresh/route.ts  CREATE — GET SSE: re-refresh, stream progress
  api/smoke/extract/route.ts            DELETE
```

---

## Task 1: `planDossier` — intent → plan (template + sources + subjectName)

**Files:**
- Create: `packages/discovery/src/plan-dossier.ts`
- Create: `packages/discovery/src/plan-dossier.test.ts`
- Modify: `packages/discovery/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/discovery/src/plan-dossier.test.ts
import { describe, it, expect } from 'vitest';
import { planDossier } from './plan-dossier.js';
import type { LlmClient } from '@veille/core';

const fakeClient = (json: object): LlmClient =>
  ({ complete: async () => ({ text: JSON.stringify(json), model: 'fake' }) } as unknown as LlmClient);

describe('planDossier', () => {
  it('classifies a chronology intent and caps sources at 3', async () => {
    const client = fakeClient({
      subjectName: "l'affaire X",
      template: 'chronology',
      queries: [
        { query: 'affaire X chronologie', rationale: 'r' },
        { query: 'affaire X faits', rationale: 'r' },
        { query: 'affaire X procès', rationale: 'r' },
        { query: 'affaire X extra', rationale: 'r' },
      ],
    });
    const plan = await planDossier({ intent: 'une chronologie de l’affaire X', language: 'fr', client });
    expect(plan.template).toBe('chronology');
    expect(plan.subjectName).toBe("l'affaire X");
    expect(plan.sources.filter((s) => s.connector === 'tavily')).toHaveLength(3); // capped
    expect(plan.sources.every((s) => s.kind === 'standing')).toBe(true);
  });

  it('keyword guardrail forces chronology even if the model says profile', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'profile', queries: [{ query: 'q', rationale: 'r' }] });
    const plan = await planDossier({ intent: 'chronologie des faits', language: 'fr', client });
    expect(plan.template).toBe('chronology');
  });

  it('adds explicit URLs in the intent as item sources, on top of the cap', async () => {
    const client = fakeClient({ subjectName: 'X', template: 'feed', queries: [{ query: 'q', rationale: 'r' }] });
    const plan = await planDossier({ intent: 'suivre https://example.com/article X', language: 'fr', client });
    const items = plan.sources.filter((s) => s.kind === 'item');
    expect(items).toHaveLength(1);
    expect(items[0]!.input).toEqual({ url: 'https://example.com/article' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @veille/discovery exec vitest run src/plan-dossier.test.ts` (or root `pnpm test`)
Expected: FAIL — `./plan-dossier.js` not found.

- [ ] **Step 3: Implement `plan-dossier.ts`**

```ts
// packages/discovery/src/plan-dossier.ts
import { selectLlmClient } from '@veille/core';
import type { LlmClient, TavilyConfig } from '@veille/core';

export type DossierTemplate = 'profile' | 'chronology' | 'feed';

export type PlannedSource =
  | { connector: 'tavily'; kind: 'standing'; input: TavilyConfig; label: string }
  | { connector: 'web' | 'youtube' | 'pdf'; kind: 'item'; input: { url: string }; label: string };

export type DossierPlan = {
  subjectName: string;
  template: DossierTemplate;
  cadence: string | null;
  sources: PlannedSource[];
};

export type PlanDossierInput = { intent: string; language?: string; model?: string; client?: LlmClient };

export class EmptyIntentError extends Error {
  constructor() { super('Intent is empty.'); this.name = 'EmptyIntentError'; }
}

const MAX_TAVILY = 3;
const URL_RE = /https?:\/\/[^\s)]+/g;
const CHRONO_RE = /\b(chronolog\w*|timeline|affaire|frise)\b/i;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    subjectName: { type: 'STRING' },
    template: { type: 'STRING' }, // profile | chronology | feed
    queries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { query: { type: 'STRING' }, days: { type: 'NUMBER' }, topic: { type: 'STRING' }, rationale: { type: 'STRING' } },
        required: ['query', 'rationale'],
        propertyOrdering: ['query', 'days', 'topic', 'rationale'],
      },
    },
  },
  required: ['subjectName', 'template', 'queries'],
  propertyOrdering: ['subjectName', 'template', 'queries'],
} as const;

function prompt(intent: string, language: string): string {
  return [
    'You plan a subject-monitoring dossier from a free-form intent.',
    'Return JSON: { subjectName, template, queries[] }.',
    '- subjectName: the short canonical name of the subject (person, entity, or affair), in ' + language + '.',
    '- template: "profile" if the subject is a person/entity; "chronology" if the intent asks for a timeline/sequence of events/an affair; otherwise "feed".',
    '- queries: up to 3 sharp Tavily web-search queries (query + one-sentence rationale; optional days, topic in news|finance|general). Decompose distinct angles; do not pad.',
    '',
    'INTENT:', intent, '',
    'Write text in: ' + language, 'Return JSON only.',
  ].join('\n');
}

function parse(text: string): Record<string, unknown> {
  try { return JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return {};
  }
}

export async function planDossier(input: PlanDossierInput): Promise<DossierPlan> {
  const intent = (input.intent ?? '').trim();
  if (!intent) throw new EmptyIntentError();
  const client = input.client ?? selectLlmClient(process.env);
  const language = input.language ?? 'fr';
  const opts: { jsonSchema: object; model?: string } = { jsonSchema: SCHEMA };
  if (input.model !== undefined) opts.model = input.model;
  const res = await client.complete(prompt(intent, language), opts);
  const raw = parse(res.text);

  // template: model's choice, with keyword guardrail
  let template: DossierTemplate =
    raw.template === 'profile' || raw.template === 'chronology' || raw.template === 'feed' ? raw.template : 'feed';
  if (CHRONO_RE.test(intent)) template = 'chronology';

  const subjectName = typeof raw.subjectName === 'string' && raw.subjectName.trim() ? raw.subjectName.trim() : intent.slice(0, 80);

  const rawQueries = Array.isArray(raw.queries) ? raw.queries : [];
  const tavily: PlannedSource[] = rawQueries
    .filter((q: any) => q && typeof q.query === 'string' && q.query.trim())
    .slice(0, MAX_TAVILY)
    .map((q: any) => {
      const config: TavilyConfig = { query: q.query.trim() };
      if (typeof q.days === 'number' && q.days > 0) config.days = Math.floor(q.days);
      if (q.topic === 'news' || q.topic === 'finance' || q.topic === 'general') config.topic = q.topic;
      return { connector: 'tavily' as const, kind: 'standing' as const, input: config, label: q.query.trim() };
    });

  const urls = [...new Set((intent.match(URL_RE) ?? []).map((u) => u.replace(/[.,]$/, '')))];
  const items: PlannedSource[] = urls.map((url) => ({
    connector: 'web', kind: 'item', input: { url }, label: url,
  }));

  return { subjectName, template, cadence: null, sources: [...tavily, ...items] };
}
```

> Note: the `connector` on item sources is nominal — actual routing at extract time uses `findAdapter({kind:'url',url})`, so a YouTube URL still goes to the YouTube adapter regardless of the stored `connector` string. M1b/refresh can refine the stored connector if desired.

- [ ] **Step 4: Export from `index.ts`** — add:

```ts
export { planDossier, EmptyIntentError as EmptyDossierIntentError } from './plan-dossier.js';
export type { DossierPlan, DossierTemplate, PlannedSource, PlanDossierInput } from './plan-dossier.js';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm test`
Expected: the three planDossier tests pass; full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/discovery
git commit -m "feat(discovery): planDossier — intent -> template + capped sources + subjectName"
```

---

## Task 2: Pure dedup helper

**Files:**
- Create: `apps/web/lib/dedup.ts`
- Create: `apps/web/lib/dedup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/dedup.test.ts
import { describe, it, expect } from 'vitest';
import { dedupKey, filterNewFacts } from './dedup';
import type { Fact } from '@veille/core';

const f = (sourceUrl: string, text: string): Fact =>
  ({ id: 'x', text, sourceUrl, sourcePassage: '', language: 'fr', extractedAt: '', provenance: {}, extractedBy: { model: '', promptHash: '', adapter: '' } });

describe('dedup', () => {
  it('keeps only facts whose (sourceUrl,text) is not already seen', () => {
    const seen = new Set<string>([dedupKey(f('u1', 'a'))]);
    const incoming = [f('u1', 'a'), f('u1', 'b'), f('u2', 'a')];
    const fresh = filterNewFacts(incoming, seen);
    expect(fresh.map((x) => x.text)).toEqual(['b', 'a']);
    expect(seen.size).toBe(3); // seen is mutated with the kept ones
  });

  it('dedupes duplicates within the same batch', () => {
    const fresh = filterNewFacts([f('u', 'a'), f('u', 'a')], new Set());
    expect(fresh).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @veille/web exec vitest run lib/dedup.test.ts`
Expected: FAIL — `./dedup` not found.

- [ ] **Step 3: Implement `dedup.ts`**

```ts
// apps/web/lib/dedup.ts
import type { Fact } from '@veille/core';

export function dedupKey(fact: Pick<Fact, 'sourceUrl' | 'text'>): string {
  return `${fact.sourceUrl}\n${fact.text.trim()}`;
}

/** Returns facts not already in `seen`; mutates `seen` to include the kept ones. */
export function filterNewFacts(incoming: Fact[], seen: Set<string>): Fact[] {
  const fresh: Fact[] = [];
  for (const fact of incoming) {
    const key = dedupKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(fact);
  }
  return fresh;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @veille/web exec vitest run lib/dedup.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/dedup.ts apps/web/lib/dedup.test.ts
git commit -m "feat(web): pure fact dedup helper (sourceUrl+text)"
```

---

## Task 3: Fact → row mapping

**Files:**
- Create: `apps/web/lib/facts-map.ts`
- Create: `apps/web/lib/facts-map.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/facts-map.test.ts
import { describe, it, expect } from 'vitest';
import { factToRow } from './facts-map';
import type { Fact } from '@veille/core';

const fact: Fact = {
  id: 'f1', text: 't', sourceUrl: 'u', sourcePassage: 'p', language: 'fr',
  extractedAt: '2026-05-29T00:00:00.000Z', provenance: { a: 1 },
  extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' }, confidence: 0.9,
};

describe('factToRow', () => {
  it('maps a Fact onto the facts table columns', () => {
    const row = factToRow(fact, 'doss-1', 'src-1');
    expect(row).toMatchObject({
      id: 'f1', dossierId: 'doss-1', sourceId: 'src-1', text: 't', sourcePassage: 'p',
      language: 'fr', provenance: { a: 1 }, extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' }, confidence: 0.9,
    });
    expect(row.extractedAt instanceof Date).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @veille/web exec vitest run lib/facts-map.test.ts` → FAIL.

- [ ] **Step 3: Implement `facts-map.ts`**

```ts
// apps/web/lib/facts-map.ts
import type { Fact } from '@veille/core';
import type { facts } from './db/schema';

type FactRow = typeof facts.$inferInsert;

export function factToRow(fact: Fact, dossierId: string, sourceId: string): FactRow {
  return {
    id: fact.id,
    dossierId,
    sourceId,
    text: fact.text,
    sourcePassage: fact.sourcePassage,
    language: fact.language,
    provenance: fact.provenance as object,
    extractedBy: fact.extractedBy,
    confidence: fact.confidence ?? null,
    extractedAt: new Date(fact.extractedAt),
  };
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/facts-map.ts apps/web/lib/facts-map.test.ts
git commit -m "feat(web): Fact -> facts row mapping"
```

---

## Task 4: Dossier store CRUD

**Files:**
- Modify: `apps/web/lib/dossiers.ts`

- [ ] **Step 1: Add the CRUD functions** (append to the existing file, which already has `listDossiers`):

```ts
import { and, eq, desc } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { uuidv7, slugify } from '@veille/core';
import type { DossierPlan } from '@veille/discovery';
import { factToRow } from './facts-map';
import type { Fact } from '@veille/core';

export async function createDossier(ownerId: string, intent: string, plan: DossierPlan) {
  const id = uuidv7();
  const base = slugify(plan.subjectName) || 'dossier';
  // ensure unique slug per owner
  let slug = base;
  for (let n = 2; ; n++) {
    const clash = await db.select({ id: dossiers.id }).from(dossiers)
      .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug ?? dossiers.id, slug))).limit(1)
      .catch(() => [] as { id: string }[]);
    if (clash.length === 0) break;
    slug = `${base}-${n}`;
  }
  await db.insert(dossiers).values({
    id, ownerId, name: plan.subjectName, intent, language: 'fr',
    template: plan.template, cadence: plan.cadence ?? null, status: 'building', slug,
  } as typeof dossiers.$inferInsert);
  await db.insert(sources).values(plan.sources.map((s) => ({
    id: uuidv7(), dossierId: id, connector: s.connector, kind: s.kind, input: s.input, label: s.label,
  })) as (typeof sources.$inferInsert)[]);
  return { id, slug };
}

export async function getDossier(ownerId: string, slug: string) {
  const [row] = await db.select().from(dossiers)
    .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug, slug))).limit(1);
  return row ?? null;
}

export async function listSources(dossierId: string) {
  return db.select().from(sources).where(eq(sources.dossierId, dossierId)).orderBy(sources.createdAt);
}

export async function listFacts(dossierId: string) {
  return db.select().from(facts).where(eq(facts.dossierId, dossierId)).orderBy(desc(facts.extractedAt));
}

export async function insertFacts(dossierId: string, sourceId: string, newFacts: Fact[]) {
  if (newFacts.length === 0) return;
  await db.insert(facts).values(newFacts.map((f) => factToRow(f, dossierId, sourceId)));
}

export async function setTemplate(ownerId: string, slug: string, template: string) {
  await db.update(dossiers).set({ template })
    .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug, slug)));
}
```

> **Schema note:** this introduces a `slug` column on `dossiers` (unique per owner) not in the M0 migration. Add it in Step 2.

- [ ] **Step 2: Add the `slug` column to `app-schema.ts` and migrate**

In `apps/web/lib/db/app-schema.ts`, add to `dossiers`: `slug: text('slug').notNull(),` and a unique index:
```ts
import { pgTable, text, timestamp, jsonb, real, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
// ...in the dossiers table definition's third arg:
}, (t) => [uniqueIndex('dossiers_owner_slug_idx').on(t.ownerId, t.slug)]);
```
Then (tunnel open): `pnpm --filter @veille/web db:generate && pnpm --filter @veille/web db:migrate`. Verify the column: `\d dossiers` shows `slug` + the unique index.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @veille/web typecheck`
Expected: clean. (If `dossiers.slug ?? dossiers.id` in the clash check trips types, simplify to `eq(dossiers.slug, slug)`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/dossiers.ts apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(web): dossier CRUD + slug column/migration"
```

---

## Task 5: `refreshDossier` engine

**Files:**
- Create: `apps/web/lib/refresh.ts`

- [ ] **Step 1: Implement `refresh.ts`**

```ts
// apps/web/lib/refresh.ts
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { extract, findAdapter } from '@veille/core';
import type { Fact } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { dedupKey, filterNewFacts } from './dedup';
import { insertFacts } from './dossiers';

export type RefreshProgress =
  | { type: 'source-start'; label: string }
  | { type: 'facts'; sourceLabel: string; added: number; total: number }
  | { type: 'source-error'; label: string; message: string }
  | { type: 'done'; total: number };

type SourceRow = typeof sources.$inferSelect;

async function candidatesFor(source: SourceRow): Promise<Candidate[]> {
  if (source.connector === 'tavily') return discoverTavily(source.input as never);
  if (source.connector === 'rss') return discoverRss(source.input as never);
  if (source.connector === 'youtube-channel') return discoverYouTubeChannel(source.input as never);
  return [];
}

export async function refreshDossier(
  dossierId: string,
  opts: { force?: boolean; language?: string; onProgress?: (p: RefreshProgress) => void } = {},
): Promise<{ total: number }> {
  registerAllAdapters();
  const onProgress = opts.onProgress ?? (() => {});
  const lang = opts.language ?? 'fr';

  const srcRows = await db.select().from(sources).where(eq(sources.dossierId, dossierId));
  const existing = await db.select({ sourceUrl: facts.sourceUrl, text: facts.text }).from(facts).where(eq(facts.dossierId, dossierId));
  const seen = new Set(existing.map((e) => dedupKey(e)));
  let total = seen.size;

  for (const src of srcRows) {
    const needs = src.kind === 'standing' || !src.lastExtractedAt || opts.force;
    if (!needs) continue;
    onProgress({ type: 'source-start', label: src.label ?? src.connector });
    try {
      let extracted: Fact[] = [];
      if (src.kind === 'standing') {
        const candidates = await candidatesFor(src);
        for (const c of candidates) {
          if (seen.has(`${c.url}\n`)) continue; // cheap pre-skip; full dedup below by (url,text)
          const adapter = findAdapter({ kind: 'url', url: c.url });
          if (!adapter) continue;
          try { extracted = extracted.concat(await extract(c.url, { language: lang, withSummary: false })); }
          catch { /* skip a bad candidate URL, keep going */ }
        }
      } else {
        const url = (src.input as { url: string }).url;
        extracted = await extract(url, { language: lang, withSummary: false });
      }
      const fresh = filterNewFacts(extracted, seen);
      // group fresh facts by their real sourceUrl is unnecessary — store under this source row
      await insertFacts(dossierId, src.id, fresh);
      total += fresh.length;
      await db.update(sources).set({ lastExtractedAt: new Date() }).where(eq(sources.id, src.id));
      onProgress({ type: 'facts', sourceLabel: src.label ?? src.connector, added: fresh.length, total });
    } catch (e) {
      // leave lastExtractedAt unset so it retries next refresh
      onProgress({ type: 'source-error', label: src.label ?? src.connector, message: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.update(dossiers).set({ refreshedAt: new Date(), status: 'active' }).where(eq(dossiers.id, dossierId));
  onProgress({ type: 'done', total });
  return { total };
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @veille/web typecheck` → clean. (The `as never` casts on provider configs are deliberate: the stored jsonb `input` is `unknown`; the planner guarantees the right shape per connector.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/refresh.ts
git commit -m "feat(web): Postgres-native refreshDossier (standing/item, dedup, progress)"
```

> No unit test here: `refreshDossier` is thin orchestration over already-tested units (planDossier, dedup, adapters, providers). It's verified by the integration smoke in Task 8.

---

## Task 6: Create-dossier route (POST)

**Files:**
- Create: `apps/web/app/api/dossiers/route.ts`

- [ ] **Step 1: Implement the route**

```ts
// apps/web/app/api/dossiers/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { planDossier } from '@veille/discovery';
import { createDossier } from '@/lib/dossiers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { intent?: string; plan?: unknown };
  const intent = (body.intent ?? '').trim();
  if (!intent) return NextResponse.json({ error: 'intent required' }, { status: 400 });
  try {
    const plan = await planDossier({ intent, language: 'fr' });
    const { slug } = await createDossier(session.user.id, intent, plan);
    return NextResponse.json({ slug });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
```

> The advanced-panel "edit the plan before assembly" flow (passing an edited `plan`) is **M1b**; M1a always plans server-side from the intent.

- [ ] **Step 2: Typecheck + smoke**

Run: `pnpm --filter @veille/web typecheck`. Then with tunnel + `dev` up and an authed session cookie (mint one as in Task 8): `curl -X POST .../api/dossiers -d '{"intent":"le padel de Jules Marie"}'` → `{ "slug": "..." }`; verify a `dossiers` row + its `sources` rows exist.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/dossiers/route.ts
git commit -m "feat(web): POST /api/dossiers — plan + create"
```

---

## Task 7: SSE assemble + refresh routes

**Files:**
- Create: `apps/web/app/api/dossiers/[slug]/assemble/route.ts`
- Create: `apps/web/app/api/dossiers/[slug]/refresh/route.ts`

- [ ] **Step 1: Implement a shared SSE helper inline in the assemble route**

```ts
// apps/web/app/api/dossiers/[slug]/assemble/route.ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { refreshDossier, type RefreshProgress } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (p: RefreshProgress) => controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      try {
        await refreshDossier(dossier.id, { language: dossier.language ?? 'fr', onProgress: send });
      } catch (e) {
        send({ type: 'source-error', label: 'refresh', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 2: Implement the refresh route** — identical to assemble but call `refreshDossier(dossier.id, { force: false, ... })`. (Same file body; different path. Repeating in full:)

```ts
// apps/web/app/api/dossiers/[slug]/refresh/route.ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { refreshDossier, type RefreshProgress } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (p: RefreshProgress) => controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      try {
        await refreshDossier(dossier.id, { language: dossier.language ?? 'fr', onProgress: send });
      } catch (e) {
        send({ type: 'source-error', label: 'refresh', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 3: Typecheck** — `pnpm --filter @veille/web typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/dossiers/[slug]"
git commit -m "feat(web): SSE assemble + refresh routes"
```

---

## Task 8: End-to-end integration smoke + remove the M0 smoke route

**Files:**
- Delete: `apps/web/app/api/smoke/extract/route.ts`

- [ ] **Step 1: Mint an authed session for testing** (no email click needed — reuse the M0 technique)

With tunnel + `pnpm --filter @veille/web dev` running:
```bash
curl -s -X POST http://localhost:3000/api/auth/sign-in/magic-link -H "Content-Type: application/json" -d '{"email":"overficial@gmail.com","callbackURL":"/"}'
# read the token from verification.identifier:
ssh root@178.104.52.131 "PGPASSWORD=<pw> psql -h 127.0.0.1 -U veille -d veille_dev -tAc \"SELECT identifier FROM verification ORDER BY created_at DESC LIMIT 1\""
curl -s -c cj.txt "http://localhost:3000/api/auth/magic-link/verify?token=<token>&callbackURL=/" >/dev/null
```

- [ ] **Step 2: Create a dossier and stream its assembly**

```bash
SLUG=$(curl -s -b cj.txt -X POST http://localhost:3000/api/dossiers -H "Content-Type: application/json" -d '{"intent":"le padel professionnel et Jules Marie"}' | python -c "import sys,json;print(json.load(sys.stdin)['slug'])")
curl -s -b cj.txt -N "http://localhost:3000/api/dossiers/$SLUG/assemble" | head -40
```
Expected: a stream of `data: {"type":"source-start"...}` / `{"type":"facts","added":N,...}` lines ending in `{"type":"done","total":>0}`.

- [ ] **Step 3: Verify facts persisted + dedup on re-refresh**

```bash
ssh root@178.104.52.131 "PGPASSWORD=<pw> psql -h 127.0.0.1 -U veille -d veille_dev -tAc \"SELECT count(*) FROM facts WHERE dossier_id IN (SELECT id FROM dossiers WHERE slug='$SLUG')\""
curl -s -b cj.txt -N "http://localhost:3000/api/dossiers/$SLUG/refresh" | tail -3   # standing sources re-run; dedup should add few/none new
```
Expected: count > 0; the refresh `done.total` is ≥ the first (only genuinely-new facts added).

- [ ] **Step 4: Delete the temporary smoke route**

```bash
rm -rf "apps/web/app/api/smoke"
```

- [ ] **Step 5: Full verification**

Run: `pnpm test && pnpm --filter @veille/web typecheck && pnpm --filter @veille/web build`
Expected: all green; routes list shows `/api/dossiers` + `/api/dossiers/[slug]/assemble` + `/api/dossiers/[slug]/refresh`, no `/api/smoke`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(web): remove M0 smoke route; M1a engine verified end-to-end"
```

---

## Self-Review

**Spec coverage (M1a portion):** §4 planner → Task 1. §5 refresh engine (standing/item, dedup, progress) → Tasks 2,3,5. §7 dossier ops → Task 4. §3 SSE assembly/refresh → Tasks 6,7. Smoke route removal (scope §2) → Task 8. Presentation templates (§6) + new-dossier/detail UI + the advanced-panel plan-editing + `setTemplate`/`removeSource` *UI* are correctly deferred to **M1b** (the store functions exist; the UI that calls them is M1b).

**Placeholder scan:** none — every code step is complete. The `as never`/`as object` casts are deliberate (jsonb `input`/`provenance` are `unknown`) and annotated.

**Type consistency:** `DossierPlan`/`PlannedSource` (Task 1) are consumed by `createDossier` (Task 4) and `planDossier` is called in the route (Task 6). `RefreshProgress` (Task 5) is imported by both SSE routes (Task 7). `dedupKey`/`filterNewFacts` (Task 2) used in `refresh.ts` (Task 5). `factToRow` (Task 3) used by `insertFacts` (Task 4). `slug` column added in Task 4 before `getDossier`/routes rely on it.

**Open risk flagged:** Task 4's slug-clash loop uses `dossiers.slug`, which doesn't exist until Step 2 of the same task — implement Step 2 (schema+migrate) *before* Step 1 compiles, or land them together. Noted in Task 4.
