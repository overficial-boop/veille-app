// Resolve a Google News `…/rss/articles/<id>` link to its real publisher URL.
// Google News links are not HTTP redirects — they JS-redirect — so we call Google's internal
// `batchexecute` endpoint (the method verified by spike: 3/3 links resolved to lemonde/lefigaro/france24).
// This is an undocumented API: treat decode failure as "skip this item", never throw.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The `<id>` path segment after `/articles/`, query stripped — or null if not an articles URL. */
export function articleIdFrom(articleUrl: string): string | null {
  const m = articleUrl.match(/\/articles\/([^/?]+)/);
  return m ? m[1] : null;
}

/** Build the `f.req=` body for the batchexecute `Fbv4je` (garturlreq) call. */
export function buildDecodeBody(id: string, ts: number | string, sig: string): string {
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sig}"]`;
  const payload = [[['Fbv4je', inner]]];
  return 'f.req=' + encodeURIComponent(JSON.stringify(payload));
}

/** First https URL in the response that is NOT a google host. */
export function extractDecodedUrl(responseText: string): string | null {
  const m = responseText.match(/https?:\/\/(?!news\.google|www\.google|consent\.google)[^\s"'\\<>]+/);
  return m ? m[0] : null;
}

/** Resolve one Google News article link to the publisher URL. Returns null on any failure. */
export async function decodeGoogleNewsUrl(articleUrl: string): Promise<string | null> {
  try {
    const id = articleIdFrom(articleUrl);
    if (!id) return null;
    const page = await fetch(articleUrl, { headers: { 'user-agent': UA } });
    if (!page.ok) return null;
    const html = await page.text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/);
    const ts = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sig || !ts) return null;
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: buildDecodeBody(id, ts[1], sig[1]),
    });
    if (!res.ok) return null;
    return extractDecodedUrl(await res.text());
  } catch {
    return null;
  }
}
