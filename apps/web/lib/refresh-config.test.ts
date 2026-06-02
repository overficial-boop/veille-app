import { describe, it, expect } from 'vitest';
import { resolveRefreshConfig } from './refresh-config';

describe('resolveRefreshConfig', () => {
  it('uses defaults with empty env', () => {
    const c = resolveRefreshConfig({});
    expect(c).toMatchObject({ plannerMaxQueries: 5, assembleCandidatesPerSource: 10, refreshCandidatesPerSource: 6, candidateScoreFloor: 0.4, factRelevanceFloor: 0.5, maxFactsPerUrl: 20 });
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
});
