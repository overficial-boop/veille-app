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
      // Benign narrow race: the active job finished between the failed insert and this select, so
      // there's no active job to return. Rethrow — the caller surfaces a transient error the user
      // can simply retry; not worth a retry-loop for this window.
    }
    throw e;
  }
}

/** Atomically claim the oldest queued job. Race-free across workers/processes via SKIP LOCKED.
 *  The raw `db.execute` result returns snake_case pg columns (Drizzle's camelCase mapping only
 *  happens through the query builder), so we RETURN just the id and re-read the row via select() —
 *  a PK lookup that yields a correctly-mapped JobRow the worker can read (job.dossierId etc.). */
export async function claimNextJob(): Promise<JobRow | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', started_at = now(), heartbeat_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id
  `);
  const claimedId = (res.rows as { id: string }[] | undefined)?.[0]?.id;
  if (!claimedId) return null;
  const [row] = await db.select().from(jobs).where(eq(jobs.id, claimedId));
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
