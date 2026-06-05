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
