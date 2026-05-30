/** Normalise a URL to its publication host (no scheme, no leading www.). */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
