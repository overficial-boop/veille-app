import { mapWithConcurrency } from '@veille/core';
import type { Candidate } from '../types.js';

export type GroundedConfig = { query: string; language?: string; maxItems?: number };

const MODEL = 'gemini-2.5-flash';
const DEFAULT_MAX_ITEMS = 8;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

type Chunk = { web?: { uri?: string; title?: string } };

/** PURE. Pull {uri,title} from groundingMetadata.groundingChunks[].web. */
export function groundingChunksToUrls(meta: { groundingChunks?: Chunk[] } | undefined): { uri: string; title: string }[] {
  const chunks = meta?.groundingChunks ?? [];
  const out: { uri: string; title: string }[] = [];
  for (const c of chunks) {
    if (c.web?.uri) out.push({ uri: c.web.uri, title: c.web.title ?? '' });
  }
  return out;
}

/** Official fallback: Gemini grounded search → publisher URLs (resolved by following the
 *  vertexaisearch redirect). Slow (~30-60s); only call when Google News returns nothing. Returns []
 *  on any failure (no key, API error, nothing grounded). */
export async function discoverGrounded(config: GroundedConfig): Promise<Candidate[]> {
  const key = process.env['VEILLE_GEMINI_KEY'];
  if (!key) return [];
  const prompt = `Liste les dernières actualités récentes sur: ${config.query}. Donne des sources de presse${config.language === 'fr' ? ' françaises' : ''}.`;
  let chunks: { uri: string; title: string }[] = [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { candidates?: { groundingMetadata?: { groundingChunks?: Chunk[] } }[] };
    chunks = groundingChunksToUrls(json.candidates?.[0]?.groundingMetadata).slice(0, config.maxItems ?? DEFAULT_MAX_ITEMS);
  } catch {
    return [];
  }
  const resolved = await mapWithConcurrency(chunks, 4, async (c) => {
    try {
      const r = await fetch(c.uri, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!r.ok || /(?:^|\.)(news\.google|vertexaisearch\.cloud\.google)\.com$/.test(new URL(r.url).hostname)) return null;
      const cand: Candidate = { url: r.url };
      if (c.title) cand.siteName = c.title;
      return cand;
    } catch {
      return null;
    }
  });
  return resolved.filter((x): x is Candidate => x !== null);
}
