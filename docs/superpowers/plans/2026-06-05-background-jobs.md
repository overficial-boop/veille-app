# Durable Background Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three long dossier pipelines (assemble / brief / refresh) off the SSE request lifecycle onto a durable Postgres-backed job queue with an in-process worker, so a dossier builds to completion even if the tab closes or the server restarts — and narrate every action so the wait reads as "a lot is being done."

**Architecture:** A `jobs` table (queued/running/done/failed + JSONB progress + heartbeat) with a partial-unique "one active job per dossier" index. A worker started once via `instrumentation.ts` claims jobs with `SELECT … FOR UPDATE SKIP LOCKED`, dispatches to the existing `refreshDossier`/`composeDossier`, and writes a narrated, rolling activity feed to the job's `progress`. Routes enqueue instead of running inline; the page polls a status endpoint. On boot the worker reaps stale `running` jobs back to `queued`; the existing idempotent handlers resume them.

**Tech Stack:** Next.js 15 (App Router, `next start` — persistent Node process), Drizzle ORM + drizzle-kit, PostgreSQL (`FOR UPDATE SKIP LOCKED`), `@veille/core` `mapWithConcurrency`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-background-jobs-design.md`

---

## File Structure

**Create:**
- `apps/web/lib/jobs/policy.ts` — DB-free pure helpers: types, `describeProgress`, `pushStep`, `shouldReap`, `throttleProgress`, `PHASE_ORDER`.
- `apps/web/lib/jobs/policy.test.ts` — vitest for the above.
- `apps/web/lib/jobs/store.ts` — DB CRUD: `enqueueJob`, `claimNextJob`, `writeProgress`, `finishJob`, `reapOrphans`, `getActiveOrLatestJob`.
- `apps/web/lib/jobs/worker.ts` — `startJobWorker()` (loop + dispatch + heartbeat + boot reap).
- `apps/web/instrumentation.ts` — Next boot hook → `startJobWorker()`.
- `apps/web/app/api/dossiers/[slug]/job/route.ts` — `GET` job status for polling.

**Modify:**
- `apps/web/lib/db/app-schema.ts` — add `jobs` table.
- `apps/web/lib/dossiers.ts` — enqueue an `assemble` job at the end of `createDossier`.
- `apps/web/app/api/dossiers/[slug]/assemble/route.ts` — `GET`(SSE) → `POST`(enqueue).
- `apps/web/app/api/dossiers/[slug]/refresh/route.ts` — `GET`(SSE) → `POST`(enqueue).
- `apps/web/app/api/dossiers/[slug]/brief/route.ts` — `GET`(SSE) → `POST`(enqueue).
- `apps/web/components/dossier-runtime.tsx` — EventSource → polling + narrated feed; buttons enqueue.
- `apps/web/app/globals.css` — `.jobfeed` activity-feed styles.

**Migration:** `apps/web/drizzle/0014_*.sql` (generated).

---

## Task 1: `jobs` table + migration

**Files:**
- Modify: `apps/web/lib/db/app-schema.ts`
- Create: `apps/web/drizzle/0014_*.sql` (generated)

- [ ] **Step 1: Add the `jobs` table to the schema**

In `apps/web/lib/db/app-schema.ts`, the top import currently is:
```ts
import { pgTable, text, timestamp, jsonb, real, uuid, uniqueIndex, integer, boolean } from 'drizzle-orm/pg-core';
import { user } from './auth-schema';
```
Replace it with (adds `index` + `sql`):
```ts
import { pgTable, text, timestamp, jsonb, real, uuid, uniqueIndex, index, integer, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth-schema';
```
Then append at the end of the file (after the `facts` table), importing the JSONB types from the jobs policy module:
```ts
import type { JobType, JobStatus, JobParams, JobProgress } from '../jobs/policy';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  type: text('type').$type<JobType>().notNull(),
  status: text('status').$type<JobStatus>().notNull().default('queued'),
  params: jsonb('params').$type<JobParams>().notNull(),
  progress: jsonb('progress').$type<JobProgress>(),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('jobs_status_created_idx').on(t.status, t.createdAt),
  index('jobs_dossier_idx').on(t.dossierId),
  // At most ONE active (queued|running) job per dossier — enforced by the DB.
  uniqueIndex('jobs_one_active_per_dossier_idx').on(t.dossierId).where(sql`status in ('queued','running')`),
]);
```

> Note: `policy.ts` (Task 2) is created before you generate the migration, so this `import type` resolves. If you do tasks out of order, do Task 2 first.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter "@veille/web" db:generate`
Expected: a new file `apps/web/drizzle/0014_*.sql` containing `CREATE TABLE "jobs"`, the two plain indexes, and a `CREATE UNIQUE INDEX "jobs_one_active_per_dossier_idx" ON "jobs" ("dossier_id") WHERE status in ('queued','running')`.

- [ ] **Step 3: Inspect the generated SQL**

Open the generated file and confirm the partial `WHERE status in ('queued','running')` is present on the unique index. If drizzle-kit emitted it without the predicate, hand-edit the `.sql` to add `WHERE status in ('queued','running')` to that `CREATE UNIQUE INDEX`.

- [ ] **Step 4: Apply the migration**

Ensure the SSH tunnel is up (`:15432`). Run: `pnpm --filter "@veille/web" db:migrate`
Expected: applies `0014`; no error.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(jobs): add durable jobs table + migration 0014"
```

---

## Task 2: `lib/jobs/policy.ts` — pure helpers (TDD)

**Files:**
- Create: `apps/web/lib/jobs/policy.ts`
- Test: `apps/web/lib/jobs/policy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/jobs/policy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  describeProgress, pushStep, shouldReap, throttleProgress, emptyProgress, PHASE_ORDER,
} from './policy';

describe('describeProgress', () => {
  it('source-start → searching + named search', () => {
    expect(describeProgress({ type: 'source-start', label: 'Le Monde' })).toMatchObject({
      phase: 'searching', label: 'Recherche : Le Monde',
    });
  });
  it('document kept → reading + retenu suffix + kept headline', () => {
    const d = describeProgress({ type: 'document', sourceLabel: 'q', title: 'Titre', status: 'kept', kept: 3, total: 5 })!;
    expect(d.phase).toBe('reading');
    expect(d.label).toBe('Lecture et évaluation : Titre — retenu');
    expect(d.headline).toMatch(/3/);
  });
  it('document suggestion → écarté suffix', () => {
    expect(describeProgress({ type: 'document', sourceLabel: 'q', title: 'T', status: 'suggestion', kept: 0, total: 1 })!.label)
      .toBe('Lecture et évaluation : T — écarté');
  });
  it('brief-doc → analyzing + index/total in label, current/total set', () => {
    const d = describeProgress({ type: 'brief-doc', index: 3, total: 21, title: 'Doc' })!;
    expect(d.phase).toBe('analyzing');
    expect(d.label).toBe('Analyse du document 3/21 : Doc');
    expect(d).toMatchObject({ current: 3, total: 21 });
  });
  it('synthesis brief start → writing', () => {
    expect(describeProgress({ type: 'synthesis', phase: 'brief', state: 'start' })).toMatchObject({
      phase: 'writing', label: 'Rédaction de la synthèse…',
    });
  });
  it('synthesis update start → mise à jour wording', () => {
    expect(describeProgress({ type: 'synthesis', phase: 'update', state: 'start' })!.label).toBe('Rédaction de la mise à jour…');
  });
  it('journal start → nouveautés wording', () => {
    expect(describeProgress({ type: 'journal', state: 'start', promoted: 0 })!.label).toBe('Analyse des nouveautés…');
  });
  it('source-error → named, non-fatal', () => {
    expect(describeProgress({ type: 'source-error', label: 'RSS X', message: 'boom' })!.label).toBe('Source indisponible : RSS X');
  });
  it('terminal/no-op frames return null', () => {
    expect(describeProgress({ type: 'done', total: 5 })).toBeNull();
    expect(describeProgress({ type: 'synthesis', phase: 'brief', state: 'done' })).toBeNull();
    expect(describeProgress({ type: 'journal', state: 'done', promoted: 2 })).toBeNull();
  });
});

describe('pushStep', () => {
  it('appends a step with the provided timestamp and advances the headline', () => {
    const p0 = emptyProgress();
    const p1 = pushStep(p0, { phase: 'searching', headline: 'H1', label: 'L1' }, '2026-06-05T10:00:00.000Z', 40);
    expect(p1.steps).toEqual([{ at: '2026-06-05T10:00:00.000Z', label: 'L1' }]);
    expect(p1.headline).toBe('H1');
    expect(p1.phase).toBe('searching');
  });
  it('never regresses the phase (reading stays past a later searching frame)', () => {
    let p = emptyProgress();
    p = pushStep(p, { phase: 'reading', headline: 'r', label: 'r' }, 't1', 40);
    p = pushStep(p, { phase: 'searching', headline: 's', label: 's' }, 't2', 40);
    expect(p.phase).toBe('reading');
  });
  it('caps the steps list at the given cap (keeps the newest)', () => {
    let p = emptyProgress();
    for (let i = 0; i < 50; i++) p = pushStep(p, { phase: 'reading', headline: 'h', label: `L${i}` }, `t${i}`, 40);
    expect(p.steps).toHaveLength(40);
    expect(p.steps[0]!.label).toBe('L10');
    expect(p.steps.at(-1)!.label).toBe('L49');
  });
  it('carries current/total when provided', () => {
    const p = pushStep(emptyProgress(), { phase: 'analyzing', headline: 'h', label: 'l', current: 3, total: 21 }, 't', 40);
    expect(p).toMatchObject({ current: 3, total: 21 });
  });
});

describe('shouldReap', () => {
  const base = { status: 'running' as const, heartbeatAt: new Date('2026-06-05T10:00:00Z'), startedAt: new Date('2026-06-05T09:59:00Z') };
  it('reaps a running job whose heartbeat is older than the stale window', () => {
    expect(shouldReap(base, new Date('2026-06-05T10:05:00Z').getTime(), 120_000)).toBe(true);
  });
  it('does not reap a fresh heartbeat', () => {
    expect(shouldReap(base, new Date('2026-06-05T10:01:00Z').getTime(), 120_000)).toBe(false);
  });
  it('does not reap a non-running job', () => {
    expect(shouldReap({ ...base, status: 'done' }, Date.parse('2026-06-05T12:00:00Z'), 120_000)).toBe(false);
  });
  it('falls back to startedAt when heartbeat is null', () => {
    expect(shouldReap({ status: 'running', heartbeatAt: null, startedAt: new Date('2026-06-05T09:00:00Z') }, Date.parse('2026-06-05T10:00:00Z'), 120_000)).toBe(true);
  });
});

describe('throttleProgress', () => {
  it('flushes when the interval has elapsed', () => {
    expect(throttleProgress(1000, 2000, 750)).toBe(true);
  });
  it('skips when within the interval', () => {
    expect(throttleProgress(1000, 1200, 750)).toBe(false);
  });
});

describe('PHASE_ORDER', () => {
  it('orders planning < searching < reading < analyzing < writing < done', () => {
    expect(PHASE_ORDER.planning).toBeLessThan(PHASE_ORDER.searching);
    expect(PHASE_ORDER.searching).toBeLessThan(PHASE_ORDER.reading);
    expect(PHASE_ORDER.reading).toBeLessThan(PHASE_ORDER.analyzing);
    expect(PHASE_ORDER.analyzing).toBeLessThan(PHASE_ORDER.writing);
    expect(PHASE_ORDER.writing).toBeLessThan(PHASE_ORDER.done);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- policy`
Expected: FAIL — `Cannot find module './policy'`.

- [ ] **Step 3: Implement `policy.ts`**

Create `apps/web/lib/jobs/policy.ts`:
```ts
import type { StreamProgress } from '../refresh'; // type-only → erased at runtime, never loads ./db

export type JobType = 'assemble' | 'brief' | 'refresh';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** Handler input persisted on the job row. */
export type JobParams = {
  phase?: 'assemble' | 'refresh';
  recencyDays?: number;
  scope?: string[];
  autoBrief?: boolean;
};

export type JobPhase = 'planning' | 'searching' | 'reading' | 'analyzing' | 'writing' | 'done';

export const PHASE_ORDER: Record<JobPhase, number> = {
  planning: 0, searching: 1, reading: 2, analyzing: 3, writing: 4, done: 5,
};

export type JobStep = { at: string; label: string };

export type JobProgress = {
  phase: JobPhase;
  headline: string;
  current?: number;
  total?: number;
  steps: JobStep[];
};

export function emptyProgress(): JobProgress {
  return { phase: 'planning', headline: 'Préparation de la veille…', steps: [] };
}

/** What a single engine frame contributes to the narrated feed. null = no step (terminal/no-op). */
export type Described = { phase: JobPhase; headline: string; label: string; current?: number; total?: number };

/** Map an engine progress frame to user-facing French narration. This is the "name every action" surface. */
export function describeProgress(frame: StreamProgress): Described | null {
  switch (frame.type) {
    case 'source-start':
      return { phase: 'searching', headline: 'Recherche des sources…', label: `Recherche : ${frame.label}` };
    case 'document':
      return {
        phase: 'reading',
        headline: `Lecture des sources — ${frame.kept} retenue${frame.kept === 1 ? '' : 's'}`,
        label: `Lecture et évaluation : ${frame.title} — ${frame.status === 'kept' ? 'retenu' : 'écarté'}`,
      };
    case 'brief-doc':
      return {
        phase: 'analyzing',
        headline: `Analyse des documents — ${frame.index} / ${frame.total}`,
        label: `Analyse du document ${frame.index}/${frame.total} : ${frame.title}`,
        current: frame.index, total: frame.total,
      };
    case 'synthesis':
      if (frame.state !== 'start') return null;
      // 'journal' synthesis isn't a SynthesisProgress phase — the dedicated `journal` frame narrates it.
      if (frame.phase === 'update') return { phase: 'writing', headline: 'Rédaction de la mise à jour…', label: 'Rédaction de la mise à jour…' };
      return { phase: 'writing', headline: 'Rédaction de la synthèse…', label: 'Rédaction de la synthèse…' };
    case 'journal':
      return frame.state === 'start' ? { phase: 'analyzing', headline: 'Analyse des nouveautés…', label: 'Analyse des nouveautés…' } : null;
    case 'source-error':
      return { phase: 'searching', headline: 'Recherche des sources…', label: `Source indisponible : ${frame.label}` };
    case 'synthesis-error':
      return { phase: 'writing', headline: 'Synthèse', label: 'Synthèse indisponible — les faits sont enregistrés.' };
    case 'done':
    default:
      return null;
  }
}

/** Append a described step to the feed (capped), advancing — never regressing — the phase/headline. */
export function pushStep(progress: JobProgress, d: Described, at: string, cap: number): JobProgress {
  const steps = [...progress.steps, { at, label: d.label }].slice(-cap);
  const phase = PHASE_ORDER[d.phase] >= PHASE_ORDER[progress.phase] ? d.phase : progress.phase;
  return {
    phase,
    headline: d.headline,
    current: d.current ?? progress.current,
    total: d.total ?? progress.total,
    steps,
  };
}

/** A running job whose heartbeat (or, if null, startedAt) is older than staleMs is orphaned. */
export function shouldReap(
  job: { status: JobStatus; heartbeatAt: Date | null; startedAt?: Date | null },
  nowMs: number, staleMs: number,
): boolean {
  if (job.status !== 'running') return false;
  const last = (job.heartbeatAt ?? job.startedAt ?? new Date(0)).getTime();
  return last < nowMs - staleMs;
}

/** Whether to flush progress to the DB now (rate-limits writes; the in-memory feed already has the step). */
export function throttleProgress(lastFlushMs: number, nowMs: number, minIntervalMs: number): boolean {
  return nowMs - lastFlushMs >= minIntervalMs;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- policy`
Expected: PASS (all `policy.test.ts` cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/jobs/policy.ts apps/web/lib/jobs/policy.test.ts
git commit -m "feat(jobs): pure policy helpers (narration, feed, reap, throttle)"
```

---

## Task 3: `lib/jobs/store.ts` — DB operations

**Files:**
- Create: `apps/web/lib/jobs/store.ts`

> No unit test (imports `./db`, which validates env at import → not vitest-loadable per the project rule). Verified via Task 9 manual checks.

- [ ] **Step 1: Implement the store**

Create `apps/web/lib/jobs/store.ts`:
```ts
import { uuidv7 } from '@veille/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { jobs } from '../db/schema';
import type { JobType, JobParams, JobProgress } from './policy';

export type JobRow = typeof jobs.$inferSelect;

const ACTIVE: ('queued' | 'running')[] = ['queued', 'running'];

/** Enqueue a job. Singleton: if the dossier already has an active job, return it instead (deduped). */
export async function enqueueJob(dossierId: string, type: JobType, params: JobParams): Promise<{ id: string; deduped: boolean }> {
  const id = uuidv7();
  try {
    await db.insert(jobs).values({ id, dossierId, type, params, status: 'queued' });
    return { id, deduped: false };
  } catch (e) {
    // 23505 = unique_violation on the partial "one active per dossier" index → fetch the existing active job.
    if ((e as { code?: string }).code === '23505') {
      const [active] = await db.select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.dossierId, dossierId), inArray(jobs.status, ACTIVE)))
        .limit(1);
      if (active) return { id: active.id, deduped: true };
    }
    throw e;
  }
}

/** Atomically claim the oldest queued job. Race-free across workers/processes via SKIP LOCKED. */
export async function claimNextJob(): Promise<JobRow | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', started_at = now(), heartbeat_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING *
  `);
  const row = (res.rows as JobRow[] | undefined)?.[0];
  return row ?? null;
}

/** Persist progress + bump the heartbeat (called throttled from the worker's onProgress). */
export async function writeProgress(id: string, progress: JobProgress): Promise<void> {
  await db.update(jobs).set({ progress, heartbeatAt: new Date() }).where(eq(jobs.id, id));
}

/** Heartbeat only — keeps a long single LLM call from looking orphaned. */
export async function touchHeartbeat(id: string): Promise<void> {
  await db.update(jobs).set({ heartbeatAt: new Date() }).where(eq(jobs.id, id));
}

export async function finishJob(id: string, status: 'done' | 'failed', error?: string): Promise<void> {
  await db.update(jobs).set({ status, error: error ?? null, finishedAt: new Date() }).where(eq(jobs.id, id));
}

/** Reset stale `running` jobs (heartbeat older than staleMs) back to `queued` so a fresh worker resumes them. */
export async function reapOrphans(staleMs: number): Promise<number> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'queued', heartbeat_at = NULL
    WHERE status = 'running' AND coalesce(heartbeat_at, started_at) < now() - ${`${Math.floor(staleMs / 1000)} seconds`}::interval
    RETURNING id
  `);
  return (res.rows as unknown[] | undefined)?.length ?? 0;
}

/** The active job for a dossier, else the most recent finished one (for the polling endpoint). */
export async function getActiveOrLatestJob(dossierId: string): Promise<JobRow | null> {
  const [active] = await db.select().from(jobs)
    .where(and(eq(jobs.dossierId, dossierId), inArray(jobs.status, ACTIVE)))
    .orderBy(desc(jobs.createdAt)).limit(1);
  if (active) return active;
  const [latest] = await db.select().from(jobs)
    .where(eq(jobs.dossierId, dossierId))
    .orderBy(desc(jobs.createdAt)).limit(1);
  return latest ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: no errors. (If `res.rows` typing complains, the `as JobRow[]` cast handles it; `db.execute` returns a node-postgres `QueryResult`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/jobs/store.ts
git commit -m "feat(jobs): job store (enqueue/claim/progress/finish/reap)"
```

---

## Task 4: `lib/jobs/worker.ts` — the worker loop

**Files:**
- Create: `apps/web/lib/jobs/worker.ts`

- [ ] **Step 1: Implement the worker**

Create `apps/web/lib/jobs/worker.ts` (per-job internal parallelism lives inside the engine, so this file needs no `mapWithConcurrency`):
```ts
import type { StreamProgress } from '../refresh';
import { describeProgress, pushStep, emptyProgress, throttleProgress, type JobProgress } from './policy';
import { claimNextJob, writeProgress, touchHeartbeat, finishJob, reapOrphans, type JobRow } from './store';

const CONCURRENCY = Math.max(1, Number(process.env.VEILLE_JOB_CONCURRENCY) || 2);
const IDLE_MS = 1500;        // sleep when no job is claimable
const FLUSH_MS = 750;        // min interval between progress DB writes
const HEARTBEAT_MS = 15_000; // periodic heartbeat during long single calls
const STALE_MS = Number(process.env.VEILLE_JOB_STALE_MS) || 120_000;
const STEP_CAP = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one claimed job: dispatch by type, narrate progress to its row, finish or fail. */
async function runJob(job: JobRow): Promise<void> {
  // Lazy imports keep this module light and avoid load-order surprises at boot.
  const { refreshDossier } = await import('../refresh');
  const { composeDossier } = await import('../synthesis');
  const { db } = await import('../db');
  const { dossiers } = await import('../db/schema');
  const { eq } = await import('drizzle-orm');

  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, job.dossierId));
  if (!dossier) { await finishJob(job.id, 'failed', 'dossier introuvable'); return; }
  const language = dossier.language ?? 'fr';

  let progress: JobProgress = job.progress ?? emptyProgress();
  let lastFlush = 0;
  const onProgress = (frame: StreamProgress) => {
    const d = describeProgress(frame);
    if (!d) return;
    progress = pushStep(progress, d, new Date().toISOString(), STEP_CAP);
    const now = Date.now();
    if (throttleProgress(lastFlush, now, FLUSH_MS)) {
      lastFlush = now;
      void writeProgress(job.id, progress); // fire-and-forget; ordering not critical
    }
  };

  // Periodic heartbeat so a long single LLM call (between frames) is never reaped.
  const beat = setInterval(() => void touchHeartbeat(job.id), HEARTBEAT_MS);
  try {
    if (job.type === 'assemble' || job.type === 'refresh') {
      const phase = job.type === 'assemble' ? 'assemble' : 'refresh';
      await refreshDossier(job.dossierId, { phase, language, recencyDays: job.params.recencyDays, onProgress });
      if (job.type === 'assemble' && job.params.autoBrief) {
        await composeDossier(job.dossierId, { mode: 'brief', language, onProgress });
      }
    } else if (job.type === 'brief') {
      await composeDossier(job.dossierId, { mode: 'brief', language, scope: job.params.scope, onProgress });
    }
    progress = { ...progress, phase: 'done', headline: 'Veille prête.' };
    await writeProgress(job.id, progress);
    await finishJob(job.id, 'done');
  } catch (e) {
    await finishJob(job.id, 'failed', e instanceof Error ? e.message : String(e));
  } finally {
    clearInterval(beat);
  }
}

/** One worker: claim → run → repeat; sleep when idle. */
async function workerLoop(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let job: JobRow | null = null;
    try {
      job = await claimNextJob();
    } catch {
      await sleep(IDLE_MS);
      continue;
    }
    if (!job) { await sleep(IDLE_MS); continue; }
    await runJob(job);
  }
}

/** Start the worker pool ONCE per process. Guarded against dev-HMR / double import. Reaps orphans on boot. */
export function startJobWorker(): void {
  const g = globalThis as { __veille_jobWorker?: boolean };
  if (g.__veille_jobWorker) return;
  g.__veille_jobWorker = true;
  void reapOrphans(STALE_MS).catch(() => {});
  for (let i = 0; i < CONCURRENCY; i++) void workerLoop();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: no errors. (Confirm `refreshDossier`'s options accept `recencyDays?: number` and `phase: 'assemble' | 'refresh'`, and `composeDossier` accepts `{ mode, language, scope?, onProgress }` — both already do, per `lib/refresh.ts` / `lib/synthesis.ts`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/jobs/worker.ts
git commit -m "feat(jobs): in-process worker (claim/dispatch/narrate/heartbeat/reap)"
```

---

## Task 5: `instrumentation.ts` — start the worker on boot

**Files:**
- Create: `apps/web/instrumentation.ts`

- [ ] **Step 1: Add the instrumentation hook**

Create `apps/web/instrumentation.ts`:
```ts
// Next runs register() once per server process (next dev / next start), in the Node runtime.
// We start the background job worker here so it lives for the life of the process, not a request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip the edge runtime
  const { startJobWorker } = await import('./lib/jobs/worker');
  startJobWorker();
}
```

> Next 15 enables `instrumentation.ts` by default (no `experimental.instrumentationHook` flag needed). The `NEXT_RUNTIME` guard ensures the worker (which uses `pg`) only starts in the Node runtime.

- [ ] **Step 2: Verify it loads (dev already running on :3000)**

The dev server hot-reloads. Confirm the worker started exactly once: it has no startup log yet — add a temporary `console.log('[jobs] worker started', CONCURRENCY)` inside `startJobWorker` after the guard, save, watch the dev terminal show it **once**, then remove the log. (Do not restart via `next build`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/instrumentation.ts
git commit -m "feat(jobs): start the worker via instrumentation register()"
```

---

## Task 6: Routes enqueue + dossier-creation enqueue + status endpoint

**Files:**
- Modify: `apps/web/lib/dossiers.ts` (enqueue assemble on create)
- Modify: `apps/web/app/api/dossiers/[slug]/assemble/route.ts`
- Modify: `apps/web/app/api/dossiers/[slug]/refresh/route.ts`
- Modify: `apps/web/app/api/dossiers/[slug]/brief/route.ts`
- Create: `apps/web/app/api/dossiers/[slug]/job/route.ts`

- [ ] **Step 1: Enqueue an assemble job when a dossier is created**

In `apps/web/lib/dossiers.ts`, find the end of `createDossier` — after the `sources` insert it currently returns `{ slug }` (and `id`). Locate the `return` of `createDossier` and, immediately before it, add the enqueue. First add the import near the other imports at the top of the file:
```ts
import { enqueueJob } from './jobs/store';
```
Then before `createDossier`'s return statement (it returns an object containing `slug`), insert:
```ts
  await enqueueJob(id, 'assemble', { phase: 'assemble', autoBrief });
```
(`id` and `autoBrief` are both in scope in `createDossier`.)

- [ ] **Step 2: Convert the assemble route to POST-enqueue**

Replace the entire contents of `apps/web/app/api/dossiers/[slug]/assemble/route.ts` with:
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';

/** Self-heal / manual start: ensure an assemble job exists for a still-building dossier. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { id, deduped } = await enqueueJob(dossier.id, 'assemble', { phase: 'assemble', autoBrief: dossier.autoBrief });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
```

- [ ] **Step 3: Convert the refresh route to POST-enqueue**

Replace the entire contents of `apps/web/app/api/dossiers/[slug]/refresh/route.ts` with:
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const daysParam = Number(req.nextUrl.searchParams.get('days'));
  const recencyDays = Number.isFinite(daysParam) ? Math.min(60, Math.max(0, Math.floor(daysParam))) : 0;

  const { id, deduped } = await enqueueJob(dossier.id, 'refresh', { phase: 'refresh', recencyDays });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
```

- [ ] **Step 4: Convert the brief route to POST-enqueue**

Replace the entire contents of `apps/web/app/api/dossiers/[slug]/brief/route.ts` with:
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { id, deduped } = await enqueueJob(dossier.id, 'brief', {});
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
```

- [ ] **Step 5: Add the job status endpoint**

Create `apps/web/app/api/dossiers/[slug]/job/route.ts`:
```ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getActiveOrLatestJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const job = await getActiveOrLatestJob(dossier.id);
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({
    job: { id: job.id, type: job.type, status: job.status, progress: job.progress, error: job.error },
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/dossiers.ts apps/web/app/api/dossiers
git commit -m "feat(jobs): routes enqueue jobs + status endpoint; assemble enqueued on create"
```

---

## Task 7: Client — poll the job + narrated activity feed

**Files:**
- Modify: `apps/web/components/dossier-runtime.tsx`

This replaces the `EventSource` machinery in `DossierRuntime` with polling of `GET /api/dossiers/[slug]/job`, renders the narrated feed, and points the buttons at the new POST enqueue routes. `ModeRecherche`, `SourcesPanel`, `AddSourceDialog`, `ProgressRow`, the icon helpers, and `ADD_SOURCE_OPTIONS` are unchanged.

- [ ] **Step 1: Replace the progress/types block and the `DossierRuntime` function body**

In `apps/web/components/dossier-runtime.tsx`:

(a) Replace the `type Progress = … | SynthesisProgress;` block (the one documented as "Mirrors the server-side StreamProgress union") AND the `type ProgressLine`, `type SynthLine`, `type Phase` declarations with this single client mirror of `JobProgress`:
```ts
// Mirrors lib/jobs/policy.ts JobProgress — kept local so the client bundle never imports the engine.
type JobPhase = 'planning' | 'searching' | 'reading' | 'analyzing' | 'writing' | 'done';
type JobStep = { at: string; label: string };
type JobProgress = { phase: JobPhase; headline: string; current?: number; total?: number; steps: JobStep[] };
type JobView = { id: string; type: 'assemble' | 'brief' | 'refresh'; status: 'queued' | 'running' | 'done' | 'failed'; progress: JobProgress | null; error: string | null };
```
Remove the now-unused `import type { SynthesisProgress }` line.

(b) Replace the whole `export function DossierRuntime({ slug, status, hasBrief, sources }: Props) { … }` body (from `const router = useRouter();` down to its closing `}` before `function ProgressRow`) with:
```ts
  const router = useRouter();
  const [job, setJob] = React.useState<JobView | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const enqueuingRef = React.useRef(false);
  const [recencyDays, setRecencyDays] = React.useState(0);

  const active = job?.status === 'queued' || job?.status === 'running';

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/dossiers/${slug}/job`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { job: JobView | null };
      setJob(data.job);
      if (data.job && (data.job.status === 'done' || data.job.status === 'failed')) {
        stopPolling();
        if (data.job.status === 'done') router.refresh();
      }
    } catch { /* transient network blip — keep polling */ }
  }, [slug, router, stopPolling]);

  const startPolling = React.useCallback(() => {
    if (pollRef.current) return;
    void poll();
    pollRef.current = setInterval(() => void poll(), 1500);
  }, [poll]);

  // Enqueue a job (POST) then begin polling. Deduped server-side, so double-clicks are safe.
  const enqueue = React.useCallback(async (path: string) => {
    if (enqueuingRef.current || active) return;
    enqueuingRef.current = true;
    try {
      const res = await fetch(path, { method: 'POST' });
      if (res.ok) startPolling();
    } finally {
      enqueuingRef.current = false;
    }
  }, [active, startPolling]);

  // On mount: poll once to pick up any in-flight job (built in the background while away). If the
  // dossier is still 'building' with no active job (left mid-build by the old path), self-heal by
  // enqueuing assemble.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/dossiers/${slug}/job`, { cache: 'no-store' });
        const data = (await res.json()) as { job: JobView | null };
        if (cancelled) return;
        setJob(data.job);
        const isActive = data.job && (data.job.status === 'queued' || data.job.status === 'running');
        if (isActive) { startPolling(); return; }
        if (status === 'building') void enqueue(`/api/dossiers/${slug}/assemble`);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = job?.progress ?? null;
  const showPanel = active || (job?.status === 'failed') || (progress != null && progress.steps.length > 0);
  const pct = progress?.total ? Math.round(((progress.current ?? 0) / progress.total) * 100) : null;

  return (
    <>
      <div className="card runtime">
        <div className="runtime-top">
          <StatusPill status={status} live={active} />
        </div>

        <div className="runtime-actions">
          <Btn
            variant="soft" size="sm" icon={RefreshCw}
            onClick={() => void enqueue(`/api/dossiers/${slug}/refresh?days=${recencyDays}`)}
            disabled={active}
          >
            {active ? 'En cours…' : 'Rafraîchir'}
          </Btn>
          {hasBrief ? (
            <Btn variant="ghost" size="sm" icon={PenLine} onClick={() => void enqueue(`/api/dossiers/${slug}/brief`)} disabled={active}>
              Réécrire
            </Btn>
          ) : (
            <Btn variant="ghost" size="sm" icon={Sparkles} onClick={() => void enqueue(`/api/dossiers/${slug}/brief`)} disabled={active}>
              Générer le brief
            </Btn>
          )}
        </div>

        <label className="refresh-window" title="Fenêtre de récence pour le rafraîchissement">
          <span className="rw-label">Fenêtre</span>
          <input
            type="range" min={0} max={30} step={1} value={recencyDays}
            onChange={(e) => setRecencyDays(Number(e.target.value))} disabled={active}
          />
          <span className="rw-val">{recencyDays === 0 ? 'Nouveautés' : `${recencyDays} j`}</span>
        </label>

        {showPanel ? (
          <div className="jobfeed">
            <div className="jf-head">
              {active ? <span className="spin" /> : null}
              <span className="jf-headline">
                {job?.status === 'failed' ? (job.error ?? 'Une erreur est survenue') : (progress?.headline ?? 'Préparation…')}
              </span>
            </div>

            {active ? (
              <div className="jf-bar" data-indeterminate={pct == null ? 'true' : 'false'}>
                <i style={pct == null ? undefined : { width: `${pct}%` }} />
              </div>
            ) : null}

            {progress && progress.steps.length > 0 ? (
              <ol className="jf-steps">
                {progress.steps.map((s, i) => (
                  <li key={`${s.at}-${i}`} className="jf-step">{s.label}</li>
                ))}
              </ol>
            ) : null}

            {active ? (
              <p className="jf-reassure">Vous pouvez fermer cet onglet — la veille se construit en arrière-plan.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <ModeRecherche slug={slug} />
      <SourcesPanel slug={slug} sources={sources} />
    </>
  );
```

(c) Delete the now-unused imports/symbols: the `Check` and `Globe`… imports are still used by other components, so leave the lucide import list as-is EXCEPT nothing to remove there. Remove the unused `regenerateBriefAction` and `generateBriefAction` from the `actions` import (the buttons now POST to routes). Verify with the typecheck in Step 3 and delete whatever it flags as unused.

- [ ] **Step 2: Confirm `ProgressRow` removal**

The old `ProgressRow` component and `ProgressLine` type are no longer referenced. Delete the `function ProgressRow({ line }: { line: ProgressLine }) { … }` definition (it sits between `DossierRuntime` and `ModeRecherche`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: no errors. Fix any "declared but never used" by removing the dead symbol it names.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/dossier-runtime.tsx
git commit -m "feat(jobs): client polls job status + renders narrated activity feed"
```

---

## Task 8: Activity-feed styles

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Add the `.jobfeed` styles**

Append to `apps/web/app/globals.css` (uses the existing Ardoise tokens; `.spin` already exists):
```css
/* Background-job activity feed (dossier creation / refresh narration) */
.jobfeed { margin-top: .9rem; padding-top: .75rem; border-top: 1px solid var(--rule); }
.jf-head { display: flex; align-items: center; gap: .5rem; font-size: var(--t-sm); color: var(--ink-2); }
.jf-headline { font-family: var(--font-serif); }
.jf-bar { position: relative; height: 4px; margin: .6rem 0; border-radius: 2px; background: var(--rule); overflow: hidden; }
.jf-bar > i { display: block; height: 100%; background: var(--accent); border-radius: 2px; transition: width .4s ease; }
.jf-bar[data-indeterminate='true'] > i { width: 35%; animation: jf-slide 1.1s ease-in-out infinite; }
@keyframes jf-slide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.jf-steps { list-style: none; margin: .5rem 0 0; padding: 0; max-height: 12rem; overflow-y: auto;
  display: flex; flex-direction: column; }
.jf-step { font-size: var(--t-sm); color: var(--ink-3); padding: .12rem 0; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jf-step:last-child { color: var(--ink-2); }
.jf-reassure { margin: .6rem 0 0; font-size: var(--t-sm); font-style: italic; color: var(--ink-3); }
```

> If any token name differs in `globals.css` (e.g. `--rule`, `--accent`, `--ink-2/3`, `--t-sm`), match the names already used elsewhere in the file. Check the `:root`/`@theme` block first.

- [ ] **Step 2: Visual check (dev on :3000)**

Open an existing dossier and click **Rafraîchir**. Expected: the feed shows a headline, an animated bar, and a streaming list of named lines ("Recherche : …", "Lecture et évaluation : … — retenu", …), plus the "Vous pouvez fermer cet onglet" line. The newest line is darker.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(jobs): styles for the narrated activity feed"
```

---

## Task 9: End-to-end verification + gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests**

Run: `pnpm -r typecheck && pnpm --filter "@veille/web" typecheck && pnpm test`
Expected: all green (the prior 267 + the new `policy.test.ts` cases).

- [ ] **Step 2: Create-a-dossier, close-the-tab**

With dev on :3000: create a new dossier. Confirm the narrated feed streams. Close the tab immediately. Wait ~1 min. Reopen the dossier URL. Expected: it finished (or is still progressing) — documents + brief present; the job row shows `status='done'`.

Verify the job row directly (tunnel up):
```bash
psql "$DATABASE_URL" -c "select type,status,jsonb_array_length(progress->'steps') steps, error from jobs order by created_at desc limit 3;"
```
Expected: latest job `done`, non-trivial `steps` count, null error.

- [ ] **Step 3: Restart-survival (reap + resume)**

Create another dossier; while its job is `running`, stop dev by PORT (`:3000`) — do NOT use `next build`. Restart `pnpm --filter "@veille/web" dev`. Within ~2–3 min the boot reap re-queues the orphaned job and the worker resumes it. Confirm the dossier completes and:
```bash
psql "$DATABASE_URL" -c "select status,attempts from jobs order by created_at desc limit 1;"
```
Expected: `status='done'`, `attempts >= 2` (claimed again after reap).

- [ ] **Step 4: Singleton dedup**

On a dossier with an active job, click Rafraîchir again (or POST twice quickly). Expected: no second active row —
```bash
psql "$DATABASE_URL" -c "select count(*) from jobs where dossier_id = '<id>' and status in ('queued','running');"
```
returns `1`.

- [ ] **Step 5: Final review subagent**

Dispatch a code-review subagent (superpowers:code-reviewer) against the diff for: race-safety of the claim, the singleton catch on `23505`, no `./db` import in `policy.ts`, the worker's heartbeat/`clearInterval` in `finally`, and client poll cleanup on unmount. Address anything it flags with high confidence; self-verify (don't trust off-prompt claims).

- [ ] **Step 6: Merge to main (solo-git)**

```bash
git checkout main
git merge --no-ff feat/background-jobs -m "Merge feat: durable background jobs + narrated progress"
git branch -d feat/background-jobs
```

---

## Self-Review (plan vs. spec)

- **Spec §1 jobs table** → Task 1 (columns, indexes, partial-unique singleton). ✓
- **Spec §2 modules** (`policy`/`store`/`worker`) → Tasks 2/3/4. ✓
- **Spec §3 worker** (SKIP LOCKED claim, concurrency, dispatch, throttled progress, heartbeat, autoBrief chain, no retry) → Task 4. ✓
- **Spec §4 startup + reap** → Tasks 4 (`reapOrphans`, guard) + 5 (`instrumentation`). ✓
- **Spec §5 triggering** (routes enqueue, create enqueues assemble, 202) → Task 6. ✓
- **Spec §6 narrated progress** (`describeProgress`, `pushStep`, feed, bar, reassurance, poll endpoint + hook) → Tasks 2 (narration, tested), 6 (endpoint), 7 (poll + feed), 8 (styles). ✓
- **Spec §7 scope** (only 3 ops; fiche ops stay sync) → on-demand actions untouched; only assemble/brief/refresh routes changed. ✓
- **Spec §8 testing** → Task 2 pure tests; Task 9 manual claim/dedup/reap. ✓

**Type consistency:** `JobType`/`JobStatus`/`JobParams`/`JobProgress`/`JobStep`/`JobPhase`/`Described` defined once in `policy.ts` (Task 2); imported by `store.ts` (Task 3), `worker.ts` (Task 4), `app-schema.ts` (Task 1); mirrored intentionally in the client (Task 7) to keep the engine out of the bundle. `enqueueJob`/`claimNextJob`/`writeProgress`/`touchHeartbeat`/`finishJob`/`reapOrphans`/`getActiveOrLatestJob` names are consistent across store ↔ worker ↔ routes.

**No placeholders.** All steps carry concrete code/commands.
