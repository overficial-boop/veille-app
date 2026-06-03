import { uuidv7 } from '@veille/core';
import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { refreshRuns } from './db/schema';
import type { FunnelEntry } from './diagnostics';

export type RefreshRunInput = {
  params: { recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number };
  counts: { raw: number; kept: number; suggestion: number; rejected: number };
  funnel: FunnelEntry[];
};

/** Persist one refresh's discovery funnel (bounded). */
export async function insertRefreshRun(dossierId: string, run: RefreshRunInput): Promise<void> {
  await db.insert(refreshRuns).values({
    id: uuidv7(),
    dossierId,
    params: run.params,
    counts: run.counts,
    funnel: run.funnel.slice(0, 200),
  } as typeof refreshRuns.$inferInsert);
}

export type RefreshRun = typeof refreshRuns.$inferSelect;

/** A dossier's recorded refresh runs, newest first. */
export async function listRefreshRuns(dossierId: string, limit = 10): Promise<RefreshRun[]> {
  return db
    .select()
    .from(refreshRuns)
    .where(eq(refreshRuns.dossierId, dossierId))
    .orderBy(desc(refreshRuns.createdAt))
    .limit(limit);
}
