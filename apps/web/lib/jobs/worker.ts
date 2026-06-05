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
