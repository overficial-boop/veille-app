/** Tunable depth/recency knobs. Defaults below; env overrides for admins now,
 *  structured so a per-user/per-dossier source can replace `process.env` later. */
export type RefreshConfig = {
  plannerMaxQueries: number;
  assembleCandidatesPerSource: number;
  refreshCandidatesPerSource: number;
  candidateScoreFloor: number;
  factRelevanceFloor: number;
  maxFactsPerUrl: number;
};

// The floors + cap (candidateScoreFloor 0.4, factRelevanceFloor 0.5, maxFactsPerUrl 20)
// were empirically calibrated against live dossiers (the "relevance pass"); don't change
// them blindly. The candidate counts set first-run depth (10) vs ongoing refresh depth (6).
const DEFAULTS: RefreshConfig = {
  plannerMaxQueries: 5,
  assembleCandidatesPerSource: 10,
  refreshCandidatesPerSource: 6,
  candidateScoreFloor: 0.4,
  factRelevanceFloor: 0.5,
  maxFactsPerUrl: 20,
};

/** Positive finite number from an env string, else the default. Fractional values pass
 *  through unchanged: the floors (candidateScoreFloor/factRelevanceFloor) are meant to be
 *  fractional, and the count knobs are only ever used as slice/loop bounds, which JS
 *  truncates safely — so no rounding is applied here. */
function num(v: string | undefined, d: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function resolveRefreshConfig(env: Record<string, string | undefined>): RefreshConfig {
  return {
    plannerMaxQueries: num(env.VEILLE_PLANNER_MAX_QUERIES, DEFAULTS.plannerMaxQueries),
    assembleCandidatesPerSource: num(env.VEILLE_ASSEMBLE_CANDIDATES, DEFAULTS.assembleCandidatesPerSource),
    refreshCandidatesPerSource: num(env.VEILLE_REFRESH_CANDIDATES, DEFAULTS.refreshCandidatesPerSource),
    candidateScoreFloor: num(env.VEILLE_CANDIDATE_SCORE_FLOOR, DEFAULTS.candidateScoreFloor),
    factRelevanceFloor: num(env.VEILLE_FACT_RELEVANCE_FLOOR, DEFAULTS.factRelevanceFloor),
    maxFactsPerUrl: num(env.VEILLE_MAX_FACTS_PER_URL, DEFAULTS.maxFactsPerUrl),
  };
}

/** Resolved config from the live environment (admin overrides via VEILLE_* env). */
export function getRefreshConfig(): RefreshConfig {
  return resolveRefreshConfig(process.env as Record<string, string | undefined>);
}
