import { describe, it, expect } from 'vitest';
import { resolveRefreshConfig } from './refresh-config';

describe('resolveRefreshConfig', () => {
  it('uses defaults with empty env', () => {
    const c = resolveRefreshConfig({});
    expect(c).toMatchObject({ plannerMaxQueries: 5, assembleCandidatesPerSource: 10, refreshCandidatesPerSource: 6, candidateScoreFloor: 0.4 });
  });
  it('applies valid env overrides', () => {
    const c = resolveRefreshConfig({ VEILLE_PLANNER_MAX_QUERIES: '8', VEILLE_ASSEMBLE_CANDIDATES: '15' });
    expect(c.plannerMaxQueries).toBe(8);
    expect(c.assembleCandidatesPerSource).toBe(15);
  });
  it('ignores invalid/zero/negative overrides → default', () => {
    expect(resolveRefreshConfig({ VEILLE_PLANNER_MAX_QUERIES: 'abc' }).plannerMaxQueries).toBe(5);
    expect(resolveRefreshConfig({ VEILLE_REFRESH_CANDIDATES: '0' }).refreshCandidatesPerSource).toBe(6);
  });
  it('exposes relevance knobs (defaults + override)', () => {
    expect(resolveRefreshConfig({}).relevanceKeepFloor).toBe(0.5);
    expect(resolveRefreshConfig({}).relevanceContentBudget).toBe(6000);
    expect(resolveRefreshConfig({ VEILLE_RELEVANCE_KEEP_FLOOR: '0.7' }).relevanceKeepFloor).toBe(0.7);
  });
});
