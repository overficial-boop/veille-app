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
