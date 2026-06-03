import type { Candidate } from '../types.js';
import { discoverGoogleNews } from './google-news.js';
import { discoverGrounded } from './grounded-search.js';

export type WatchConfig = { query: string; language?: string; maxItems?: number };

/** The watch/refresh discovery path: Google News first; if it yields nothing (decode all-failed,
 *  blocked, empty), fall back to the official Gemini grounded search. */
export async function discoverWatch(config: WatchConfig): Promise<Candidate[]> {
  let primary: Candidate[] = [];
  try { primary = await discoverGoogleNews(config); } catch { primary = []; }
  if (primary.length > 0) return primary;
  return discoverGrounded(config);
}
