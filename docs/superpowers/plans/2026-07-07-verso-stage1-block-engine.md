# Verso Stage 1 — Plan 1: Block Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The block system's engine — registry with prerequisite DAG, output cache with staleness, jobs-based execution — proven end-to-end by two real blocks (Résumé exécutif + TL;DR derivation) attachable and runnable via API.

**Architecture:** Blocks are code-registered definitions with declared prerequisites (primitives, other blocks, cross-scope aggregation). A pure resolver computes inputs + a cache fingerprint per (instance, target); a batch `blocks` job walks the topological order and upserts cached outputs; refresh marks outputs stale. UI comes in Plan 3 — this plan ends at tested API routes.

**Tech Stack:** Next.js 15 App Router, Drizzle/Postgres, the existing durable jobs system (`lib/jobs/*`), `selectLlmClient` from `@veille/core`, Vitest.

**Spec deviation (recorded):** the spec says "one instance run = one job", but the jobs table enforces **one active job per dossier** (`jobs_one_active_per_dossier_idx`). Per-instance jobs would break that invariant. This plan uses **one batch `blocks` job per run** that executes all requested instances in DAG order, narrating each block as a step. Semantics the spec wants (graph order, per-instance cache) are preserved; update the spec's §3 wording when this plan lands.

**Conventions used throughout** (match the codebase):
- ids: `uuidv7()` from `@veille/core`.
- LLM: `selectLlmClient(process.env as Record<string, string | undefined>)` → `client.complete(prompt, {}) → { text }` (see `lib/document/analyze.ts:44-53`).
- Routes: `getSession()` → 401; `getDossier(session.user.id, slug)` → 404; `startJobWorker()` before enqueue; 202 + `{ jobId }` (see `app/api/dossiers/[slug]/brief/route.ts`).
- User-facing strings in **French** (product language), code/comments in English.
- Tests colocated `*.test.ts`, run from repo root: `pnpm vitest run apps/web/lib/blocks/<file>.test.ts`.
- All commits from repo root `D:\Projects\CODING\veille-app`, end with the `Co-Authored-By: Claude` trailer used in this repo.

**File map (whole plan):**

| File | Responsibility |
|---|---|
| `apps/web/lib/blocks/types.ts` (create) | BlockScope, BlockInput, ResolvedInputs, BlockDef, BlockCitation |
| `apps/web/lib/blocks/registry.ts` (create) | register/get/list + `validateRegistry` (cycles, scopes, unknown refs) |
| `apps/web/lib/blocks/fingerprint.ts` (create) | pure cache-fingerprint helpers |
| `apps/web/lib/blocks/resolve.ts` (create) | `topoOrder` + `resolveInputs` (pure, injected loaders) |
| `apps/web/lib/blocks/generators/exec-summary.ts` (create) | Résumé exécutif block (item scope, raw-content) |
| `apps/web/lib/blocks/generators/tldr.ts` (create) | TL;DR block (derivation of exec-summary) |
| `apps/web/lib/blocks/index.ts` (create) | registration bootstrap + validation at import |
| `apps/web/lib/blocks/store.ts` (create) | DB: attach/detach/list instances, upsert/list outputs, markStale |
| `apps/web/lib/blocks/run.ts` (create) | `runBlocksJob` — batch execution in DAG order |
| `apps/web/lib/db/app-schema.ts` (modify) | + `blockInstances`, `blockOutputs` tables |
| `apps/web/lib/db/schema.ts` (modify) | barrel re-export (only if not `export *`) |
| `apps/web/lib/jobs/policy.ts` (modify) | JobType + `'blocks'`, JobParams + instanceIds/targetKeys |
| `apps/web/lib/jobs/worker.ts` (modify) | dispatch `blocks` job; mark stale after refresh |
| `apps/web/app/api/dossiers/[slug]/blocks/route.ts` (create) | GET instances+outputs+library, POST attach |
| `apps/web/app/api/dossiers/[slug]/blocks/run/route.ts` (create) | POST enqueue blocks job |

---

### Task 0: Branch

- [ ] **Step 1: Create the feature branch**

```bash
cd D:\Projects\CODING\veille-app
git switch main && git pull --ff-only origin main
git switch -c feat/stage1-block-engine
```

---

### Task 1: Block types + registry with DAG validation

**Files:**
- Create: `apps/web/lib/blocks/types.ts`
- Create: `apps/web/lib/blocks/registry.ts`
- Test: `apps/web/lib/blocks/registry.test.ts`

- [ ] **Step 1: Write the types file** (no test — types only)

```ts
// apps/web/lib/blocks/types.ts
export type BlockScope = 'page' | 'item';

/** A prerequisite a block declares. Uniform: primitives, another block's output, or cross-scope aggregation. */
export type BlockInput =
  | { kind: 'fact-pool' }
  | { kind: 'raw-content' }                 // item scope only — documents.content
  | { kind: 'item-metadata' }               // item scope only — title/url/siteName/publishedAt
  | { kind: 'block'; blockId: string }      // same-scope cached output of another block
  | { kind: 'all-items'; blockId: string }; // page scope only — every item's cached output of blockId

export type BlockCitation = { factId?: string; url: string };

/** What the resolver hands a generator. Only the declared inputs are populated. */
export type ResolvedInputs = {
  factPool?: { facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[]; version: string };
  rawContent?: { text: string; title: string; url: string };
  itemMetadata?: { title: string; url: string; siteName?: string; publishedAt?: string };
  blocks?: Record<string, string>;                                  // blockId → cached content
  allItems?: Record<string, { targetKey: string; content: string }[]>; // blockId → outputs across items
};

export type BlockDef = {
  id: string;
  name: string; // user-facing, French
  scope: BlockScope | 'both';
  prerequisites: BlockInput[];
  staleness: 'auto-on-refresh' | 'on-demand';
  generate: (inputs: ResolvedInputs, ctx: { language: string }) => Promise<{ content: string; citations: BlockCitation[] }>;
};
```

- [ ] **Step 2: Write the failing registry test**

```ts
// apps/web/lib/blocks/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerBlock, getBlock, listBlocks, validateRegistry, __clearRegistryForTests } from './registry';
import type { BlockDef } from './types';

const gen: BlockDef['generate'] = async () => ({ content: 'x', citations: [] });
const def = (over: Partial<BlockDef>): BlockDef => ({
  id: 'a', name: 'A', scope: 'item', prerequisites: [], staleness: 'on-demand', generate: gen, ...over,
});

beforeEach(() => __clearRegistryForTests());

describe('registry', () => {
  it('registers and lists blocks', () => {
    registerBlock(def({ id: 'a' }));
    expect(getBlock('a')?.id).toBe('a');
    expect(listBlocks().map((b) => b.id)).toEqual(['a']);
  });

  it('rejects duplicate ids', () => {
    registerBlock(def({ id: 'a' }));
    expect(() => registerBlock(def({ id: 'a' }))).toThrow(/duplicate/i);
  });

  it('validate: flags unknown block prerequisite', () => {
    registerBlock(def({ id: 'a', prerequisites: [{ kind: 'block', blockId: 'ghost' }] }));
    expect(validateRegistry()).toEqual([expect.stringMatching(/a.*ghost/)]);
  });

  it('validate: flags a cycle', () => {
    registerBlock(def({ id: 'a', prerequisites: [{ kind: 'block', blockId: 'b' }] }));
    registerBlock(def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] }));
    expect(validateRegistry().some((e) => /cycle/i.test(e))).toBe(true);
  });

  it('validate: raw-content only on item-capable blocks', () => {
    registerBlock(def({ id: 'p', scope: 'page', prerequisites: [{ kind: 'raw-content' }] }));
    expect(validateRegistry().some((e) => /raw-content/.test(e))).toBe(true);
  });

  it('validate: all-items only on page-capable blocks, referencing an item-capable block', () => {
    registerBlock(def({ id: 'leaf', scope: 'item' }));
    registerBlock(def({ id: 'agg', scope: 'page', prerequisites: [{ kind: 'all-items', blockId: 'leaf' }] }));
    registerBlock(def({ id: 'bad', scope: 'item', prerequisites: [{ kind: 'all-items', blockId: 'leaf' }] }));
    const errors = validateRegistry();
    expect(errors.some((e) => /bad/.test(e))).toBe(true);
    expect(errors.some((e) => /agg/.test(e))).toBe(false);
  });

  it('validate: clean graph returns no errors', () => {
    registerBlock(def({ id: 'a' }));
    registerBlock(def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] }));
    expect(validateRegistry()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`

- [ ] **Step 4: Implement the registry**

```ts
// apps/web/lib/blocks/registry.ts
import type { BlockDef, BlockScope } from './types';

const registry = new Map<string, BlockDef>();

export function registerBlock(def: BlockDef): void {
  if (registry.has(def.id)) throw new Error(`duplicate block id: ${def.id}`);
  registry.set(def.id, def);
}

export function getBlock(id: string): BlockDef | undefined { return registry.get(id); }
export function listBlocks(): BlockDef[] { return [...registry.values()]; }
export function __clearRegistryForTests(): void { registry.clear(); }

const canRun = (def: BlockDef, scope: BlockScope) => def.scope === 'both' || def.scope === scope;

/** Validate the whole registry: unknown refs, scope violations, cycles. Returns human-readable errors. */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  for (const def of registry.values()) {
    for (const p of def.prerequisites) {
      if ((p.kind === 'raw-content' || p.kind === 'item-metadata') && !canRun(def, 'item'))
        errors.push(`block "${def.id}": ${p.kind} requires item scope`);
      if (p.kind === 'all-items') {
        if (!canRun(def, 'page')) errors.push(`block "${def.id}": all-items requires page scope`);
        const ref = registry.get(p.blockId);
        if (!ref) errors.push(`block "${def.id}": unknown prerequisite "${p.blockId}"`);
        else if (!canRun(ref, 'item')) errors.push(`block "${def.id}": all-items target "${p.blockId}" is not item-capable`);
      }
      if (p.kind === 'block' && !registry.has(p.blockId))
        errors.push(`block "${def.id}": unknown prerequisite "${p.blockId}"`);
    }
  }
  // Cycle detection (DFS over block + all-items edges).
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') { errors.push(`cycle: ${[...path, id].join(' → ')}`); return; }
    state.set(id, 'visiting');
    const def = registry.get(id);
    for (const p of def?.prerequisites ?? []) {
      if (p.kind === 'block' || p.kind === 'all-items') visit(p.blockId, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of registry.keys()) visit(id, []);
  return errors;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/blocks/registry.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/blocks/types.ts apps/web/lib/blocks/registry.ts apps/web/lib/blocks/registry.test.ts
git commit -m "feat(blocks): block types + registry with DAG validation"
```

---

### Task 2: Fingerprint helpers

**Files:**
- Create: `apps/web/lib/blocks/fingerprint.ts`
- Test: `apps/web/lib/blocks/fingerprint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/blocks/fingerprint.test.ts
import { describe, it, expect } from 'vitest';
import { contentFingerprint, factPoolFingerprint, combineFingerprints } from './fingerprint';

describe('fingerprint', () => {
  it('contentFingerprint is deterministic and short', () => {
    expect(contentFingerprint('hello')).toBe(contentFingerprint('hello'));
    expect(contentFingerprint('hello')).toHaveLength(16);
    expect(contentFingerprint('hello')).not.toBe(contentFingerprint('hello!'));
  });

  it('factPoolFingerprint encodes refresh time and count', () => {
    expect(factPoolFingerprint('2026-07-07T10:00:00Z', 42)).toBe('fp:2026-07-07T10:00:00Z:42');
    expect(factPoolFingerprint(null, 0)).toBe('fp:never:0');
  });

  it('combineFingerprints is order-sensitive', () => {
    expect(combineFingerprints(['a', 'b'])).not.toBe(combineFingerprints(['b', 'a']));
    expect(combineFingerprints(['a', 'b'])).toBe(combineFingerprints(['a', 'b']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/fingerprint.test.ts`
Expected: FAIL — `Cannot find module './fingerprint'`

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/blocks/fingerprint.ts
import { createHash } from 'node:crypto';

/** Short stable hash of arbitrary content (cache keys, not security). */
export function contentFingerprint(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/** Fact-pool version: changes whenever a refresh lands or the pool size moves. */
export function factPoolFingerprint(refreshedAtIso: string | null, factCount: number): string {
  return `fp:${refreshedAtIso ?? 'never'}:${factCount}`;
}

/** Combine prerequisite fingerprints into one instance-target fingerprint. Order-sensitive by design. */
export function combineFingerprints(parts: string[]): string {
  return contentFingerprint(parts.join('|'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/blocks/fingerprint.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blocks/fingerprint.ts apps/web/lib/blocks/fingerprint.test.ts
git commit -m "feat(blocks): cache fingerprint helpers"
```

---

### Task 3: Schema — block_instances + block_outputs (+ migration)

**Files:**
- Modify: `apps/web/lib/db/app-schema.ts` (append after the `jobs` table)
- Check: `apps/web/lib/db/schema.ts` (barrel — if it `export *` from app-schema, no change needed)
- Generated: `apps/web/drizzle/0015_*.sql`

- [ ] **Step 1: Append the tables to app-schema.ts**

```ts
// apps/web/lib/db/app-schema.ts — append at end of file
export const blockInstances = pgTable('block_instances', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  blockId: text('block_id').notNull(),           // registry id — definitions live in code
  scope: text('scope').$type<'page' | 'item'>().notNull(),
  position: integer('position').notNull().default(0), // page-stack order; item blocks ignore it
  config: jsonb('config').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One instance of a block per dossier per scope (re-attach = no-op).
  uniqueIndex('block_instances_dossier_block_scope_idx').on(t.dossierId, t.blockId, t.scope),
]);

export const blockOutputs = pgTable('block_outputs', {
  id: uuid('id').primaryKey(),
  instanceId: uuid('instance_id').notNull().references(() => blockInstances.id, { onDelete: 'cascade' }),
  targetKey: text('target_key').notNull().default('page'), // 'page' | a documents.id (item scope)
  content: text('content').notNull(),                      // markdown
  citations: jsonb('citations').$type<{ factId?: string; url: string }[]>().notNull(),
  fingerprint: text('fingerprint').notNull(),              // combined prerequisite fingerprint at generation time
  stale: boolean('stale').notNull().default(false),        // set by refresh; cleared on regeneration
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('block_outputs_instance_target_idx').on(t.instanceId, t.targetKey),
  index('block_outputs_instance_idx').on(t.instanceId),
]);
```

- [ ] **Step 2: Verify the barrel exports the new tables**

Run: `grep -n "app-schema" apps/web/lib/db/schema.ts`
If it re-exports named symbols (not `export *`), add `blockInstances, blockOutputs` to the list.

- [ ] **Step 3: Generate the migration**

Run (needs no DB): `cd apps/web && pnpm db:generate && cd ../..`
Expected: a new `apps/web/drizzle/0015_<name>.sql` creating both tables with both indexes. Read it and confirm it contains `CREATE TABLE "block_instances"`, `CREATE TABLE "block_outputs"`, and the two unique indexes.

- [ ] **Step 4: Apply the migration (needs the SSH tunnel)**

If the dev tunnel isn't up, start it in the background first (see CLAUDE.md; `ssh -L 15432:localhost:5432 root@178.104.52.131 -N`).
Run: `cd apps/web && pnpm db:migrate && cd ../..`
Expected: migration applies without error.

- [ ] **Step 5: Typecheck, then commit**

Run: `pnpm typecheck` — Expected: clean.

```bash
git add apps/web/lib/db/app-schema.ts apps/web/lib/db/schema.ts apps/web/drizzle
git commit -m "feat(blocks): block_instances + block_outputs tables (migration 0015)"
```

---

### Task 4: Resolver — topological order + input resolution

**Files:**
- Create: `apps/web/lib/blocks/resolve.ts`
- Test: `apps/web/lib/blocks/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/blocks/resolve.test.ts
import { describe, it, expect } from 'vitest';
import { topoOrder, resolveInputs, type BlockLoaders } from './resolve';
import type { BlockDef } from './types';

const gen: BlockDef['generate'] = async () => ({ content: 'x', citations: [] });
const def = (over: Partial<BlockDef>): BlockDef => ({
  id: 'a', name: 'A', scope: 'item', prerequisites: [], staleness: 'on-demand', generate: gen, ...over,
});

const loaders = (over: Partial<BlockLoaders> = {}): BlockLoaders => ({
  factPool: async () => ({ facts: [{ id: 'f1', text: 't', sourceUrl: 'u', sourcePassage: 'p' }], version: 'fp:now:1' }),
  document: async () => ({ content: 'transcript text', title: 'T', url: 'https://x', siteName: 'X', publishedAt: null }),
  cachedOutput: async () => ({ content: 'cached summary', fingerprint: 'abc' }),
  allOutputs: async () => [{ targetKey: 'doc1', content: 'sum1' }],
  ...over,
});

describe('topoOrder', () => {
  it('orders prerequisites before dependents', () => {
    const a = def({ id: 'a' });
    const b = def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'a' }] });
    const c = def({ id: 'c', prerequisites: [{ kind: 'block', blockId: 'b' }] });
    expect(topoOrder([c, a, b]).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores edges to blocks outside the set', () => {
    const b = def({ id: 'b', prerequisites: [{ kind: 'block', blockId: 'not-here' }] });
    expect(topoOrder([b]).map((d) => d.id)).toEqual(['b']);
  });
});

describe('resolveInputs', () => {
  it('resolves raw-content + item-metadata for an item target', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.rawContent?.text).toBe('transcript text');
    expect(r.inputs.itemMetadata?.title).toBe('T');
    expect(r.fingerprint).toHaveLength(16);
  });

  it('reports missing when the document has no content', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' },
      loaders({ document: async () => ({ content: null, title: 'T', url: 'u', siteName: undefined, publishedAt: null }) }));
    expect(r).toEqual({ missing: expect.stringContaining('raw-content') });
  });

  it('resolves a block prerequisite from cache and folds its fingerprint', async () => {
    const d = def({ id: 'tldr', prerequisites: [{ kind: 'block', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.blocks?.['exec-summary']).toBe('cached summary');
  });

  it('reports missing when a block prerequisite has no cached output', async () => {
    const d = def({ id: 'tldr', prerequisites: [{ kind: 'block', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders({ cachedOutput: async () => null }));
    expect(r).toEqual({ missing: expect.stringContaining('exec-summary') });
  });

  it('resolves fact-pool and all-items for a page target', async () => {
    const d = def({ id: 'themes', scope: 'page',
      prerequisites: [{ kind: 'fact-pool' }, { kind: 'all-items', blockId: 'exec-summary' }] });
    const r = await resolveInputs(d, { dossierId: 'D' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.factPool?.facts).toHaveLength(1);
    expect(r.inputs.allItems?.['exec-summary']).toEqual([{ targetKey: 'doc1', content: 'sum1' }]);
  });

  it('reports missing for item primitives on a page target', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'raw-content' }] });
    const r = await resolveInputs(d, { dossierId: 'D' }, loaders());
    expect(r).toEqual({ missing: expect.stringContaining('raw-content') });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve'`

- [ ] **Step 3: Implement the resolver**

```ts
// apps/web/lib/blocks/resolve.ts
import type { BlockDef, ResolvedInputs } from './types';
import { combineFingerprints, contentFingerprint } from './fingerprint';

/** Injected data access so the resolver stays pure and unit-testable. */
export type BlockLoaders = {
  factPool: (dossierId: string) => Promise<{ facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[]; version: string }>;
  document: (documentId: string) => Promise<{ content: string | null; title: string; url: string; siteName?: string; publishedAt: Date | string | null } | null>;
  cachedOutput: (dossierId: string, blockId: string, targetKey: string) => Promise<{ content: string; fingerprint: string } | null>;
  allOutputs: (dossierId: string, blockId: string) => Promise<{ targetKey: string; content: string }[]>;
};

export type ResolveTarget = { dossierId: string; documentId?: string };
export type Resolved = { inputs: ResolvedInputs; fingerprint: string };
export type ResolveResult = Resolved | { missing: string };

/** Kahn topological order over block/all-items edges, restricted to the given set. Assumes the
 *  registry graph is validated (acyclic) at boot; edges leaving the set are ignored. */
export function topoOrder(defs: BlockDef[]): BlockDef[] {
  const inSet = new Map(defs.map((d) => [d.id, d]));
  const deps = new Map<string, Set<string>>();
  for (const d of defs) {
    const s = new Set<string>();
    for (const p of d.prerequisites) {
      if ((p.kind === 'block' || p.kind === 'all-items') && inSet.has(p.blockId)) s.add(p.blockId);
    }
    deps.set(d.id, s);
  }
  const out: BlockDef[] = [];
  const done = new Set<string>();
  while (out.length < defs.length) {
    const ready = defs.filter((d) => !done.has(d.id) && [...deps.get(d.id)!].every((x) => done.has(x)));
    if (ready.length === 0) break; // unreachable if registry is acyclic; guard anyway
    for (const d of ready) { out.push(d); done.add(d.id); }
  }
  return out;
}

/** Resolve a block's declared inputs for one target. Returns the inputs bundle + the cache
 *  fingerprint, or { missing } naming the first unsatisfiable prerequisite. */
export async function resolveInputs(def: BlockDef, target: ResolveTarget, loaders: BlockLoaders): Promise<ResolveResult> {
  const inputs: ResolvedInputs = {};
  const prints: string[] = [];
  const targetKey = target.documentId ?? 'page';

  for (const p of def.prerequisites) {
    if (p.kind === 'fact-pool') {
      const pool = await loaders.factPool(target.dossierId);
      inputs.factPool = pool;
      prints.push(pool.version);
    } else if (p.kind === 'raw-content' || p.kind === 'item-metadata') {
      if (!target.documentId) return { missing: `${p.kind} requires an item target` };
      const doc = await loaders.document(target.documentId);
      if (!doc) return { missing: `${p.kind}: document ${target.documentId} not found` };
      if (p.kind === 'raw-content') {
        if (!doc.content) return { missing: `raw-content: document ${target.documentId} has no stored content` };
        inputs.rawContent = { text: doc.content, title: doc.title ?? '', url: doc.url };
        prints.push(contentFingerprint(doc.content));
      } else {
        inputs.itemMetadata = {
          title: doc.title ?? '', url: doc.url, siteName: doc.siteName,
          publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : undefined,
        };
        prints.push(contentFingerprint(`${doc.title}|${doc.url}`));
      }
    } else if (p.kind === 'block') {
      const cached = await loaders.cachedOutput(target.dossierId, p.blockId, targetKey);
      if (!cached) return { missing: `block "${p.blockId}" has no cached output for ${targetKey}` };
      inputs.blocks = { ...inputs.blocks, [p.blockId]: cached.content };
      prints.push(cached.fingerprint);
    } else if (p.kind === 'all-items') {
      const outs = await loaders.allOutputs(target.dossierId, p.blockId);
      inputs.allItems = { ...inputs.allItems, [p.blockId]: outs };
      prints.push(contentFingerprint(outs.map((o) => `${o.targetKey}:${contentFingerprint(o.content)}`).join(',')));
    }
  }
  return { inputs, fingerprint: combineFingerprints([def.id, targetKey, ...prints]) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/blocks/resolve.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blocks/resolve.ts apps/web/lib/blocks/resolve.test.ts
git commit -m "feat(blocks): topological order + pure input resolver"
```

---

### Task 5: Generator — Résumé exécutif (exec-summary)

**Files:**
- Create: `apps/web/lib/blocks/generators/exec-summary.ts`
- Test: `apps/web/lib/blocks/generators/exec-summary.test.ts`

- [ ] **Step 1: Write the failing test** (pure parts only — prompt building and content capping)

```ts
// apps/web/lib/blocks/generators/exec-summary.test.ts
import { describe, it, expect } from 'vitest';
import { buildExecSummaryPrompt, CONTENT_CAP, execSummaryBlock } from './exec-summary';

describe('exec-summary', () => {
  it('prompt embeds title, url, language instruction and content', () => {
    const p = buildExecSummaryPrompt({ title: 'Rome Final', url: 'https://yt/x', content: 'transcript here', language: 'fr' });
    expect(p).toContain('Rome Final');
    expect(p).toContain('https://yt/x');
    expect(p).toContain('transcript here');
    expect(p).toMatch(/français|French|fr\b/i);
  });

  it('caps very long content', () => {
    const long = 'x'.repeat(CONTENT_CAP + 5000);
    const p = buildExecSummaryPrompt({ title: 't', url: 'u', content: long, language: 'fr' });
    expect(p.length).toBeLessThan(CONTENT_CAP + 2000);
  });

  it('declares item scope with raw-content + item-metadata prerequisites', () => {
    expect(execSummaryBlock.scope).toBe('item');
    expect(execSummaryBlock.prerequisites).toEqual([{ kind: 'raw-content' }, { kind: 'item-metadata' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/generators/exec-summary.test.ts`
Expected: FAIL — `Cannot find module './exec-summary'`

- [ ] **Step 3: Implement** (prompt adapted from simpleyt's "Executive Summary" section; LLM call matches `lib/document/analyze.ts`)

```ts
// apps/web/lib/blocks/generators/exec-summary.ts
import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

export const CONTENT_CAP = 24_000; // chars of source content sent to the model

const LANGUAGE_NAME: Record<string, string> = { fr: 'français', en: 'English' };

export function buildExecSummaryPrompt(a: { title: string; url: string; content: string; language: string }): string {
  const lang = LANGUAGE_NAME[a.language] ?? a.language;
  const content = a.content.length > CONTENT_CAP ? `${a.content.slice(0, CONTENT_CAP)}\n[…tronqué]` : a.content;
  return `You are an expert analyst of published content (videos, articles).
Write an executive summary in ${lang}.

## Item
- Title: ${a.title}
- URL: ${a.url}

## Content
${content}

---

Write 2 to 4 paragraphs summarizing the item's purpose and core message.
Be specific, ground every statement in the content, no generic filler, no heading — paragraphs only, Markdown.`;
}

export const execSummaryBlock: BlockDef = {
  id: 'exec-summary',
  name: 'Résumé exécutif',
  scope: 'item',
  prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const rc = inputs.rawContent;
    const meta = inputs.itemMetadata;
    if (!rc || !meta) throw new Error('exec-summary: resolver must provide raw-content + item-metadata');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(
      buildExecSummaryPrompt({ title: meta.title, url: meta.url, content: rc.text, language: ctx.language }), {});
    return { content: r.text.trim(), citations: [{ url: meta.url }] };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/blocks/generators/exec-summary.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blocks/generators/exec-summary.ts apps/web/lib/blocks/generators/exec-summary.test.ts
git commit -m "feat(blocks): exec-summary generator (item scope)"
```

---

### Task 6: Generator — TL;DR (derivation block)

**Files:**
- Create: `apps/web/lib/blocks/generators/tldr.ts`
- Test: `apps/web/lib/blocks/generators/tldr.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/blocks/generators/tldr.test.ts
import { describe, it, expect } from 'vitest';
import { buildTldrPrompt, tldrBlock } from './tldr';

describe('tldr', () => {
  it('prompt embeds the parent summary and asks for one sentence', () => {
    const p = buildTldrPrompt({ summary: 'A long executive summary.', language: 'fr' });
    expect(p).toContain('A long executive summary.');
    expect(p).toMatch(/une seule phrase|one sentence/i);
  });

  it('is a pure derivation: prerequisite is the exec-summary block output', () => {
    expect(tldrBlock.prerequisites).toEqual([{ kind: 'block', blockId: 'exec-summary' }]);
    expect(tldrBlock.scope).toBe('item');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/generators/tldr.test.ts`
Expected: FAIL — `Cannot find module './tldr'`

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/blocks/generators/tldr.ts
import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

const LANGUAGE_NAME: Record<string, string> = { fr: 'français', en: 'English' };

export function buildTldrPrompt(a: { summary: string; language: string }): string {
  const lang = LANGUAGE_NAME[a.language] ?? a.language;
  return `Condense this executive summary into ONE sentence in ${lang} (a TL;DR).
Keep the single most important point. No preamble, no quotes — une seule phrase.

## Executive summary
${a.summary}`;
}

/** The "smaller summary": derives from exec-summary's cached output — near-free by construction. */
export const tldrBlock: BlockDef = {
  id: 'tldr',
  name: 'TL;DR',
  scope: 'item',
  prerequisites: [{ kind: 'block', blockId: 'exec-summary' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const summary = inputs.blocks?.['exec-summary'];
    if (!summary) throw new Error('tldr: resolver must provide exec-summary output');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(buildTldrPrompt({ summary, language: ctx.language }), {});
    return { content: r.text.trim(), citations: [] };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/web/lib/blocks/generators/tldr.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the registration bootstrap**

```ts
// apps/web/lib/blocks/index.ts
// Registration bootstrap: importing this module makes the registry complete and validated.
import { registerBlock, validateRegistry, listBlocks, getBlock } from './registry';
import { execSummaryBlock } from './generators/exec-summary';
import { tldrBlock } from './generators/tldr';

const g = globalThis as { __verso_blocksRegistered?: boolean };
if (!g.__verso_blocksRegistered) {
  g.__verso_blocksRegistered = true;
  registerBlock(execSummaryBlock);
  registerBlock(tldrBlock);
  const errors = validateRegistry();
  if (errors.length) throw new Error(`invalid block registry:\n${errors.join('\n')}`);
}

export { listBlocks, getBlock };
```

- [ ] **Step 6: Typecheck + full blocks tests, then commit**

Run: `pnpm typecheck && pnpm vitest run apps/web/lib/blocks`
Expected: clean + all blocks tests pass.

```bash
git add apps/web/lib/blocks/generators/tldr.ts apps/web/lib/blocks/generators/tldr.test.ts apps/web/lib/blocks/index.ts
git commit -m "feat(blocks): tldr derivation block + registration bootstrap"
```

---

### Task 7: Store — instances & outputs DB layer

**Files:**
- Create: `apps/web/lib/blocks/store.ts`

No unit test (thin DB layer — repo convention: `lib/jobs/store.ts` has none; logic stays in the pure modules).

- [ ] **Step 1: Implement the store**

```ts
// apps/web/lib/blocks/store.ts
import { uuidv7 } from '@veille/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { blockInstances, blockOutputs, dossiers, facts, documents } from '../db/schema';
import { factPoolFingerprint } from './fingerprint';
import type { BlockLoaders } from './resolve';

export type BlockInstanceRow = typeof blockInstances.$inferSelect;
export type BlockOutputRow = typeof blockOutputs.$inferSelect;

/** Attach a block to a dossier (idempotent: re-attach returns the existing instance). */
export async function attachBlock(dossierId: string, blockId: string, scope: 'page' | 'item', position = 0): Promise<{ id: string; existed: boolean }> {
  const id = uuidv7();
  try {
    await db.insert(blockInstances).values({ id, dossierId, blockId, scope, position });
    return { id, existed: false };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      const [row] = await db.select({ id: blockInstances.id }).from(blockInstances)
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockInstances.scope, scope)));
      if (row) return { id: row.id, existed: true };
    }
    throw e;
  }
}

export async function detachBlock(instanceId: string): Promise<void> {
  await db.delete(blockInstances).where(eq(blockInstances.id, instanceId));
}

export async function listInstances(dossierId: string, ids?: string[]): Promise<BlockInstanceRow[]> {
  const where = ids?.length
    ? and(eq(blockInstances.dossierId, dossierId), inArray(blockInstances.id, ids))
    : eq(blockInstances.dossierId, dossierId);
  return db.select().from(blockInstances).where(where).orderBy(asc(blockInstances.position), asc(blockInstances.createdAt));
}

export async function listOutputs(dossierId: string): Promise<(BlockOutputRow & { blockId: string; scope: string })[]> {
  const rows = await db.select({
    o: blockOutputs, blockId: blockInstances.blockId, scope: blockInstances.scope,
  }).from(blockOutputs)
    .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
    .where(eq(blockInstances.dossierId, dossierId));
  return rows.map((r) => ({ ...r.o, blockId: r.blockId, scope: r.scope }));
}

/** Upsert the cached output for (instance, target). Regeneration clears the stale flag. */
export async function upsertOutput(a: { instanceId: string; targetKey: string; content: string; citations: { factId?: string; url: string }[]; fingerprint: string }): Promise<void> {
  await db.insert(blockOutputs)
    .values({ id: uuidv7(), ...a, stale: false, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: [blockOutputs.instanceId, blockOutputs.targetKey],
      set: { content: a.content, citations: a.citations, fingerprint: a.fingerprint, stale: false, generatedAt: new Date() },
    });
}

/** Refresh landed: every cached output of the dossier may now be outdated. Visible, never silent. */
export async function markStaleForDossier(dossierId: string): Promise<number> {
  const ids = (await listInstances(dossierId)).map((i) => i.id);
  if (!ids.length) return 0;
  const res = await db.update(blockOutputs).set({ stale: true })
    .where(inArray(blockOutputs.instanceId, ids)).returning({ id: blockOutputs.id });
  return res.length;
}

/** Production BlockLoaders bound to the real DB (the resolver stays pure; this is its only impure binding). */
export function dbLoaders(): BlockLoaders {
  return {
    async factPool(dossierId) {
      const [d] = await db.select({ refreshedAt: dossiers.refreshedAt }).from(dossiers).where(eq(dossiers.id, dossierId));
      const rows = await db.select({ id: facts.id, text: facts.text, sourceUrl: facts.sourceUrl, sourcePassage: facts.sourcePassage })
        .from(facts).where(eq(facts.dossierId, dossierId));
      return { facts: rows, version: factPoolFingerprint(d?.refreshedAt?.toISOString() ?? null, rows.length) };
    },
    async document(documentId) {
      const [doc] = await db.select({
        content: documents.content, title: documents.title, url: documents.url,
        siteName: documents.siteName, publishedAt: documents.publishedAt,
      }).from(documents).where(eq(documents.id, documentId));
      return doc ? { ...doc, title: doc.title ?? '', siteName: doc.siteName ?? undefined } : null;
    },
    async cachedOutput(dossierId, blockId, targetKey) {
      const [row] = await db.select({ content: blockOutputs.content, fingerprint: blockOutputs.fingerprint })
        .from(blockOutputs)
        .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockOutputs.targetKey, targetKey)));
      return row ?? null;
    },
    async allOutputs(dossierId, blockId) {
      const rows = await db.select({ targetKey: blockOutputs.targetKey, content: blockOutputs.content })
        .from(blockOutputs)
        .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockOutputs.stale, false)));
      return rows.filter((r) => r.targetKey !== 'page');
    },
  };
}
```

- [ ] **Step 2: Typecheck, then commit**

Run: `pnpm typecheck` — Expected: clean.

```bash
git add apps/web/lib/blocks/store.ts
git commit -m "feat(blocks): instances/outputs store + production loaders"
```

---

### Task 8: Runner — runBlocksJob

**Files:**
- Create: `apps/web/lib/blocks/run.ts`
- Test: `apps/web/lib/blocks/run.test.ts`

- [ ] **Step 1: Write the failing test** (the pure planning/skip logic via injected deps)

```ts
// apps/web/lib/blocks/run.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeBlocks, type ExecDeps } from './run';
import type { BlockDef } from './types';

const mk = (id: string, prereqs: BlockDef['prerequisites'] = []): BlockDef => ({
  id, name: id, scope: 'item', prerequisites: prereqs, staleness: 'on-demand',
  generate: vi.fn(async () => ({ content: `out:${id}`, citations: [] })),
});

const deps = (defs: BlockDef[], over: Partial<ExecDeps> = {}): ExecDeps => ({
  getDef: (id) => defs.find((d) => d.id === id),
  resolve: vi.fn(async (def) => ({ inputs: {}, fingerprint: `fp-${def.id}` })),
  existing: vi.fn(async () => null),
  save: vi.fn(async () => {}),
  narrate: vi.fn(),
  ...over,
});

describe('executeBlocks', () => {
  it('runs instances in DAG order and saves each output', async () => {
    const a = mk('a'); const b = mk('b', [{ kind: 'block', blockId: 'a' }]);
    const d = deps([a, b]);
    const res = await executeBlocks(
      [{ instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }, { instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual(['a', 'b']); // a before b despite input order
    expect(d.save).toHaveBeenCalledTimes(2);
  });

  it('skips when the cached output is fresh (same fingerprint, not stale)', async () => {
    const a = mk('a');
    const d = deps([a], { existing: vi.fn(async () => ({ fingerprint: 'fp-a', stale: false })) });
    const res = await executeBlocks([{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }], { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual([]);
    expect(res.skipped).toEqual(['a']);
    expect(a.generate).not.toHaveBeenCalled();
  });

  it('regenerates when cached output is stale even with same fingerprint', async () => {
    const a = mk('a');
    const d = deps([a], { existing: vi.fn(async () => ({ fingerprint: 'fp-a', stale: true })) });
    const res = await executeBlocks([{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }], { dossierId: 'D', language: 'fr' }, d);
    expect(res.ran).toEqual(['a']);
  });

  it('records a miss (and continues) when prerequisites are unsatisfiable', async () => {
    const a = mk('a'); const b = mk('b');
    const d = deps([a, b], {
      resolve: vi.fn(async (def) => def.id === 'a' ? { missing: 'no content' } : { inputs: {}, fingerprint: 'fp-b' }),
    });
    const res = await executeBlocks(
      [{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }, { instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.missed).toEqual([{ blockId: 'a', reason: 'no content' }]);
    expect(res.ran).toEqual(['b']);
  });

  it('a generator failure does not abort the batch', async () => {
    const a = mk('a'); (a.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('llm down'));
    const b = mk('b');
    const d = deps([a, b]);
    const res = await executeBlocks(
      [{ instanceId: 'ia', blockId: 'a', targetKey: 'doc1' }, { instanceId: 'ib', blockId: 'b', targetKey: 'doc1' }],
      { dossierId: 'D', language: 'fr' }, d);
    expect(res.failed).toEqual([{ blockId: 'a', error: 'llm down' }]);
    expect(res.ran).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/lib/blocks/run.test.ts`
Expected: FAIL — `Cannot find module './run'`

- [ ] **Step 3: Implement the runner**

```ts
// apps/web/lib/blocks/run.ts
import './index'; // ensure registry is populated + validated
import type { BlockDef, ResolvedInputs } from './types';
import { topoOrder, type ResolveResult } from './resolve';

export type WorkItem = { instanceId: string; blockId: string; targetKey: string };

/** Injected effects so the batch semantics (order, skip, miss, fail-soft) are unit-testable. */
export type ExecDeps = {
  getDef: (id: string) => BlockDef | undefined;
  resolve: (def: BlockDef, targetKey: string) => Promise<ResolveResult>;
  existing: (instanceId: string, targetKey: string) => Promise<{ fingerprint: string; stale: boolean } | null>;
  save: (item: WorkItem, content: string, citations: { factId?: string; url: string }[], fingerprint: string) => Promise<void>;
  narrate: (label: string) => void;
};

export type ExecResult = {
  ran: string[]; skipped: string[];
  missed: { blockId: string; reason: string }[];
  failed: { blockId: string; error: string }[];
};

/** Run a batch of block instances in DAG order. Fresh cache → skip; missing prereq → record and
 *  continue; generator error → record and continue. Never throws for a single block's sake. */
export async function executeBlocks(items: WorkItem[], ctx: { dossierId: string; language: string }, deps: ExecDeps): Promise<ExecResult> {
  const res: ExecResult = { ran: [], skipped: [], missed: [], failed: [] };
  const defs = items.map((i) => deps.getDef(i.blockId)).filter((d): d is BlockDef => !!d);
  const order = topoOrder(defs).map((d) => d.id);
  const sorted = [...items].sort((a, b) => order.indexOf(a.blockId) - order.indexOf(b.blockId));

  for (const item of sorted) {
    const def = deps.getDef(item.blockId);
    if (!def) { res.missed.push({ blockId: item.blockId, reason: 'unknown block' }); continue; }
    const r = await deps.resolve(def, item.targetKey);
    if ('missing' in r) { res.missed.push({ blockId: def.id, reason: r.missing }); continue; }
    const cached = await deps.existing(item.instanceId, item.targetKey);
    if (cached && cached.fingerprint === r.fingerprint && !cached.stale) {
      res.skipped.push(def.id);
      continue;
    }
    deps.narrate(`Bloc « ${def.name} » — génération…`);
    try {
      const out = await def.generate(r.inputs as ResolvedInputs, { language: ctx.language });
      await deps.save(item, out.content, out.citations, r.fingerprint);
      res.ran.push(def.id);
      deps.narrate(`Bloc « ${def.name} » — terminé.`);
    } catch (e) {
      res.failed.push({ blockId: def.id, error: e instanceof Error ? e.message : String(e) });
      deps.narrate(`Bloc « ${def.name} » — échec.`);
    }
  }
  return res;
}

/** Entry point for the worker: binds executeBlocks to the real DB. */
export async function runBlocksJob(
  dossierId: string,
  params: { instanceIds?: string[]; targetKeys?: string[] },
  narrate: (label: string) => void,
): Promise<ExecResult> {
  const { listInstances, upsertOutput, dbLoaders } = await import('./store');
  const { getBlock } = await import('./index');
  const { resolveInputs } = await import('./resolve');
  const { db } = await import('../db');
  const { blockOutputs, dossiers } = await import('../db/schema');
  const { and, eq } = await import('drizzle-orm');

  const [dossier] = await db.select({ language: dossiers.language }).from(dossiers).where(eq(dossiers.id, dossierId));
  const language = dossier?.language ?? 'fr';
  const instances = await listInstances(dossierId, params.instanceIds);
  const loaders = dbLoaders();

  // Page instances target 'page'; item instances fan out over the provided targetKeys (documents).
  const items: WorkItem[] = [];
  for (const inst of instances) {
    if (inst.scope === 'page') items.push({ instanceId: inst.id, blockId: inst.blockId, targetKey: 'page' });
    else for (const t of params.targetKeys ?? []) items.push({ instanceId: inst.id, blockId: inst.blockId, targetKey: t });
  }

  return executeBlocks(items, { dossierId, language }, {
    getDef: getBlock,
    resolve: (def, targetKey) => resolveInputs(def, { dossierId, documentId: targetKey === 'page' ? undefined : targetKey }, loaders),
    existing: async (instanceId, targetKey) => {
      const [row] = await db.select({ fingerprint: blockOutputs.fingerprint, stale: blockOutputs.stale })
        .from(blockOutputs).where(and(eq(blockOutputs.instanceId, instanceId), eq(blockOutputs.targetKey, targetKey)));
      return row ?? null;
    },
    save: (item, content, citations, fingerprint) =>
      upsertOutput({ instanceId: item.instanceId, targetKey: item.targetKey, content, citations, fingerprint }),
    narrate,
  });
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run apps/web/lib/blocks/run.test.ts && pnpm typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blocks/run.ts apps/web/lib/blocks/run.test.ts
git commit -m "feat(blocks): batch runner — DAG order, cache skip, fail-soft"
```

---

### Task 9: Jobs integration — `blocks` job type + stale-on-refresh

**Files:**
- Modify: `apps/web/lib/jobs/policy.ts` (types at top, lines 3-12)
- Modify: `apps/web/lib/jobs/worker.ts` (`runJob`, lines 43-54)

- [ ] **Step 1: Extend the job types in policy.ts**

```ts
// apps/web/lib/jobs/policy.ts — replace lines 3-12 with:
export type JobType = 'assemble' | 'brief' | 'refresh' | 'blocks';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** Handler input persisted on the job row. */
export type JobParams = {
  phase?: 'assemble' | 'refresh';
  recencyDays?: number;
  scope?: string[];
  autoBrief?: boolean;
  instanceIds?: string[]; // blocks job: which instances (default: all of the dossier)
  targetKeys?: string[];  // blocks job: document ids for item-scope runs
};
```

- [ ] **Step 2: Dispatch the blocks job in worker.ts**

In `runJob`, extend the type dispatch (after the `'brief'` branch, before the success lines):

```ts
// apps/web/lib/jobs/worker.ts — inside runJob's try block, after the `else if (job.type === 'brief')` branch:
    } else if (job.type === 'blocks') {
      const { runBlocksJob } = await import('../blocks/run');
      const r = await runBlocksJob(job.dossierId, job.params, (label) => {
        progress = pushStep(progress, { phase: 'analyzing', headline: 'Génération des blocs…', label }, new Date().toISOString(), STEP_CAP);
        const now = Date.now();
        if (throttleProgress(lastFlush, now, FLUSH_MS)) {
          lastFlush = now;
          void writeProgress(job.id, progress).catch(() => {});
        }
      });
      const done = r.ran.length + r.skipped.length;
      progress = { ...progress, headline: `Blocs générés : ${r.ran.length} (à jour : ${r.skipped.length}${r.failed.length ? `, échecs : ${r.failed.length}` : ''})` };
      void done;
    }
```

Note: `pushStep`, `throttleProgress`, `writeProgress`, `STEP_CAP`, `FLUSH_MS`, `progress`, `lastFlush` all already exist in `runJob`'s scope — reuse them, do not redeclare. `describeProgress` is NOT used here (blocks narrate directly).

- [ ] **Step 3: Mark outputs stale after a successful refresh**

Still in `runJob`, inside the `if (job.type === 'assemble' || job.type === 'refresh')` branch, after `refreshDossier(...)` resolves (and before the `autoBrief` block):

```ts
      const { markStaleForDossier } = await import('../blocks/store');
      const stale = await markStaleForDossier(job.dossierId);
      if (stale > 0) onProgress({ type: 'source-start', label: `${stale} bloc(s) à rafraîchir` } as StreamProgress);
```

(If `StreamProgress`'s `source-start` frame shape differs, use the simplest valid frame — the goal is one narrated line; check `../refresh`'s `StreamProgress` type and adjust the literal to a valid variant.)

- [ ] **Step 4: Typecheck + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean; all suites pass (existing `policy.test.ts` unaffected — additions only).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/jobs/policy.ts apps/web/lib/jobs/worker.ts
git commit -m "feat(blocks): 'blocks' job type + stale-marking after refresh"
```

---

### Task 10: API routes

**Files:**
- Create: `apps/web/app/api/dossiers/[slug]/blocks/route.ts`
- Create: `apps/web/app/api/dossiers/[slug]/blocks/run/route.ts`

- [ ] **Step 1: Implement the blocks route (GET list, POST attach)**

```ts
// apps/web/app/api/dossiers/[slug]/blocks/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { listBlocks, getBlock } from '@/lib/blocks';
import { attachBlock, listInstances, listOutputs } from '@/lib/blocks/store';

export const runtime = 'nodejs';

/** The dossier's block state: attached instances, cached outputs, and the available library. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [instances, outputs] = await Promise.all([listInstances(dossier.id), listOutputs(dossier.id)]);
  const library = listBlocks().map((b) => ({ id: b.id, name: b.name, scope: b.scope, staleness: b.staleness }));
  return NextResponse.json({ instances, outputs, library });
}

/** Attach a block: { blockId, scope } → instance (idempotent). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const blockId = typeof body.blockId === 'string' ? body.blockId : '';
  const scope = body.scope === 'page' || body.scope === 'item' ? body.scope : null;
  const def = getBlock(blockId);
  if (!def || !scope) return NextResponse.json({ error: 'blockId et scope requis' }, { status: 400 });
  if (def.scope !== 'both' && def.scope !== scope)
    return NextResponse.json({ error: `le bloc « ${def.name} » ne supporte pas la portée ${scope}` }, { status: 400 });

  const { id, existed } = await attachBlock(dossier.id, blockId, scope);
  return NextResponse.json({ instanceId: id, existed }, { status: existed ? 200 : 201 });
}
```

- [ ] **Step 2: Implement the run route** (pattern: `brief/route.ts`)

```ts
// apps/web/app/api/dossiers/[slug]/blocks/run/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';
import { startJobWorker } from '@/lib/jobs/worker';

export const runtime = 'nodejs';

/** Enqueue a blocks run. Body: { instanceIds?: string[]; targetKeys?: string[] } (both optional). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  startJobWorker(); // idempotent — ensure the worker is running to pick up the job
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const instanceIds = Array.isArray(body.instanceIds) ? body.instanceIds.filter((x: unknown) => typeof x === 'string') : undefined;
  const targetKeys = Array.isArray(body.targetKeys) ? body.targetKeys.filter((x: unknown) => typeof x === 'string') : undefined;

  const { id, deduped } = await enqueueJob(dossier.id, 'blocks', { instanceIds, targetKeys });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: both clean (build validates the new routes compile under Next).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/api/dossiers/[slug]/blocks"
git commit -m "feat(blocks): API — list/attach blocks + enqueue blocks run"
```

---

### Task 11: End-to-end smoke + full verification

- [ ] **Step 1: Full suite**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all clean/green.

- [ ] **Step 2: Live smoke against dev DB** (needs tunnel + `apps/web/.env.local`)

Start `pnpm dev`, then with an authenticated session on an existing dossier that has at least one kept document with content:
1. `POST /api/dossiers/<slug>/blocks` body `{"blockId":"exec-summary","scope":"item"}` → 201 `{ instanceId }`.
2. `POST /api/dossiers/<slug>/blocks` body `{"blockId":"tldr","scope":"item"}` → 201.
3. Pick a document id from the dossier (e.g. via the existing documents endpoint or DB), then `POST /api/dossiers/<slug>/blocks/run` body `{"targetKeys":["<documentId>"]}` → 202 `{ jobId }`.
4. Poll the existing job endpoint (`/api/dossiers/<slug>/job`) — expect narrated steps "Bloc « Résumé exécutif » — génération…" then "Bloc « TL;DR » — génération…" (order proves the DAG), then done.
5. `GET /api/dossiers/<slug>/blocks` → two outputs, `stale: false`, tldr's content is one sentence.
6. Re-run step 3 → job completes with both blocks **skipped** (fresh fingerprints — proves the cache).

Record the results in the executing session (this step is manual verification, not code).

- [ ] **Step 3: Final commit if smoke surfaced fixes; otherwise done**

Plan complete. Merge decision (`--no-ff` to main per repo convention) belongs to the finishing workflow, not this plan.

---

## Self-review (done at write time)

- **Spec coverage:** engine-side of spec §2 (model, prerequisites, scopes, cross-scope `all-items` in resolver+registry), §3 (jobs execution, visible staleness, cost rules via skip-if-fresh + on-demand item runs). §4 UI and §5 full catalog are Plans 2-3 by design. Deviation from §3 "one instance = one job" recorded in header.
- **Placeholder scan:** none — all steps carry real code/commands.
- **Type consistency:** `BlockDef.generate(inputs, ctx)` uniform; `ResolveResult = Resolved | { missing }` used by resolver, runner, tests; `WorkItem.targetKey: 'page' | documentId` consistent across store/runner/routes; `JobParams.instanceIds/targetKeys` match route → job → runner.
