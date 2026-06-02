// Pure phase→purpose source selection. Kept DB-free so it's unit-testable without the
// env/db module chain (refresh.ts pulls in the database client).

/** The minimal shape sourcesForPhase needs from a source row. */
type PhaseRow = { kind: string; purpose: string };

/** PURE. Which sources run in a given phase. Assemble builds the corpus from `state` standing
 *  sources; refresh watches via `watch` standing sources, falling back to `state` when a dossier
 *  has no watch sources (legacy / none planned). Item sources run in both phases (the caller's
 *  `needs` gate then skips already-extracted items). */
export function sourcesForPhase<T extends PhaseRow>(rows: T[], phase: 'assemble' | 'refresh'): T[] {
  const standing = rows.filter((r) => r.kind === 'standing');
  const items = rows.filter((r) => r.kind === 'item');
  if (phase === 'assemble') {
    return [...standing.filter((r) => r.purpose === 'state'), ...items];
  }
  const watch = standing.filter((r) => r.purpose === 'watch');
  const refreshStanding = watch.length > 0 ? watch : standing.filter((r) => r.purpose === 'state');
  return [...refreshStanding, ...items];
}
