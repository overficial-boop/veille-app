import { hostOf } from './host';

/** Markdown link `[text](http…url)`, tolerating one level of balanced parens in the URL. */
export const LINK_RE = /\[[^\]]+\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;

/**
 * Number each source URL: brief-cited URLs first (first-appearance order in the brief),
 * then any remaining fact URLs not already in the map.
 */
export function buildCitationNumbers(
  brief: string | null | undefined,
  factUrls: string[],
): Record<string, number> {
  const map: Record<string, number> = {};
  let n = 0;
  if (brief) {
    const re = new RegExp(LINK_RE);
    let m: RegExpExecArray | null;
    while ((m = re.exec(brief)) !== null) {
      const u = m[1];
      if (!(u in map)) map[u] = ++n;
    }
  }
  for (const u of factUrls) {
    if (u && !(u in map)) map[u] = ++n;
  }
  return map;
}

/** Inner tokens of each `[a, b]` group, EXCLUDING real `[text](url)` links (negative lookahead on `(`). */
export function hostTagGroups(md: string): string[][] {
  const re = /\[([^\]]+)\](?!\()/g;
  const out: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}

/** Number publications: brief-cited hosts first (appearance order), then remaining fact hosts. */
export function buildHostCitations(brief: string | null | undefined, factHosts: string[]): Record<string, number> {
  const known = new Set(factHosts);
  const map: Record<string, number> = {};
  let n = 0;
  if (brief) for (const group of hostTagGroups(brief)) for (const tok of group) {
    if (known.has(tok) && !(tok in map)) map[tok] = ++n;
  }
  for (const h of factHosts) if (!(h in map)) map[h] = ++n;
  return map;
}

/** Rewrite `[host, host]` groups into per-host anchor links the citation renderer turns into
 *  superscripts. Groups with no known host (and real `[text](url)` links) are left untouched. */
export function renderHostCitations(md: string, hostNumbers: Record<string, number>): string {
  return md.replace(/\[([^\]]+)\](?!\()/g, (full, inner: string) => {
    const tokens = inner.split(',').map((s) => s.trim());
    if (!tokens.some((t) => t in hostNumbers)) return full;
    return tokens.map((t) => (t in hostNumbers ? `[${t}](#cite-${t})` : t)).join('');
  });
}

// --- Article-level (numbered) citations --------------------------------------
// Preferred model: the brief cites SPECIFIC articles by number ([1], [2, 5]). The numbered
// reference list is built + persisted at generation time (dossiers.brief_refs).

export type BriefRef = { n: number; url: string; docId: string | null; title: string; host: string };

/** Rewrite numeric citation groups `[n]` / `[n, m]` into per-article links the renderer turns
 *  into superscripts. Only numbers present in `refs` are linked; any other bracketed text
 *  (prose `[note]`, host tags, real `[text](url)` links) is left untouched. */
export function renderNumberedCitations(md: string, refs: { n: number; url: string }[]): string {
  const byN = new Map(refs.map((r) => [r.n, r.url]));
  return md.replace(/\[([\d,\s]+)\](?!\()/g, (full, inner: string) => {
    const toks = inner.split(',').map((s) => s.trim()).filter(Boolean);
    if (!toks.some((t) => /^\d+$/.test(t) && byN.has(Number(t)))) return full;
    return toks.map((t) => {
      const url = /^\d+$/.test(t) ? byN.get(Number(t)) : undefined;
      return url ? `[${t}](${url})` : t;
    }).join('');
  });
}

export type SourceRow = { host: string; n: number; url: string; note?: string };

/** One row per numbered host (ordered by number): representative url = the first fact url whose
 *  host matches; note = the host's source_note if any. */
export function buildSourceRows(
  hostNumbers: Record<string, number>,
  factUrls: string[],
  notes: Record<string, string> | null | undefined,
): SourceRow[] {
  const repUrl: Record<string, string> = {};
  for (const u of factUrls) { const h = hostOf(u); if (!(h in repUrl)) repUrl[h] = u; }
  return Object.entries(hostNumbers)
    .sort((a, b) => a[1] - b[1])
    .map(([host, n]) => ({ host, n, url: repUrl[host] ?? '#', note: notes?.[host] }));
}
