/** URL heuristic for PDFs — just checks the pathname extension. */
export function isLikelyPdfUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  return u.pathname.toLowerCase().endsWith('.pdf');
}
