import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources } from './db/schema';
import { extract, findAdapter, mapWithConcurrency } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel, discoverWatch } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { hostOf } from './host';
import { scoreRelevance } from './relevance';
import { getRefreshConfig } from './refresh-config';

export type ProbeCandidate = {
  query: string; url: string; title?: string; publishedAt?: string; siteName?: string;
  providerScore?: number; relevance: number | null; relevanceReason?: string;
};

/** Dry run: discover the dossier's standing sources, fetch + relevance-score the top candidates,
 *  return them UNBUCKETED (the admin Tester applies knob thresholds client-side). No upserts. */
export async function runDiscoveryProbe(dossierId: string, perSource = 10): Promise<ProbeCandidate[]> {
  registerAllAdapters();
  const cfg = getRefreshConfig();
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return [];
  const language = dossier.language ?? 'fr';
  const intent = [dossier.name, dossier.intent].filter(Boolean).join(' — ') || dossier.intent;
  const srcRows = await db.select().from(sources).where(and(eq(sources.dossierId, dossierId), eq(sources.kind, 'standing')));

  const out: ProbeCandidate[] = [];
  for (const src of srcRows) {
    let cands: Candidate[] = [];
    try {
      if (src.connector === 'google-news') cands = await discoverWatch({ query: (src.input as { query: string }).query, language });
      else if (src.connector === 'tavily') cands = await discoverTavily(src.input as never);
      else if (src.connector === 'rss') cands = await discoverRss(src.input as never);
      else if (src.connector === 'youtube-channel') cands = await discoverYouTubeChannel(src.input as never);
    } catch { cands = []; }
    const top = cands.filter((c) => !/youtube\.com\/shorts\//i.test(c.url)).slice(0, perSource);
    const scored = await mapWithConcurrency(top, 3, async (c) => {
      let content = '';
      try { if (findAdapter({ kind: 'url', url: c.url })) await extract(c.url, { language, contentOnly: true, onContent: (t) => { content = t; } }); } catch { /* skip */ }
      const rel = content ? await scoreRelevance({ title: c.title ?? c.url, content, intent, language, contentBudget: cfg.relevanceContentBudget }) : null;
      const pc: ProbeCandidate = {
        query: src.label ?? src.connector, url: c.url, title: c.title, publishedAt: c.publishedAt,
        siteName: c.siteName ?? hostOf(c.url), providerScore: c.score, relevance: rel ? rel.score : null,
      };
      if (rel) pc.relevanceReason = rel.reason;
      return pc;
    });
    out.push(...scored);
  }
  return out;
}
