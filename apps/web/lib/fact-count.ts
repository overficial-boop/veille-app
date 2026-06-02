// Pure fact-count shaping. Kept DB-free so it's unit-testable without the env/db module chain
// (documents.ts pulls in the database client).

/** PURE. Attach a factCount to each row from a {documentId,n} count list (0 when none). */
export function attachFactCounts<T extends { id: string }>(
  rows: T[],
  counts: { documentId: string | null; n: number }[],
): (T & { factCount: number })[] {
  const map = new Map(counts.filter((c) => c.documentId).map((c) => [c.documentId as string, c.n]));
  return rows.map((r) => ({ ...r, factCount: map.get(r.id) ?? 0 }));
}
