import type { StreamProgress } from '../refresh'; // type-only → erased at runtime, never loads ./db

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
      // 'journal' synthesis isn't a SynthesisProgress phase — the dedicated `journal` frame (below)
      // narrates "Analyse des nouveautés". Only 'brief' | 'update' reach here.
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
