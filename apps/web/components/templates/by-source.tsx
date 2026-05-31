import { ChevronRight, Play } from 'lucide-react';
import { hostOf } from '@/lib/synthesis';
import { FactRow } from './fact-row';
import type { FactRow as FactRowType, TemplateProps } from './types';

/** Publication identity of a fact: a YouTube video (with a known channel) belongs to
 *  its CHANNEL; everything else belongs to its host. */
type Pub = { key: string; name: string; kind: 'youtube' | 'web' };

const YT_HOST = /(?:^|\.)youtube\.com$|^youtu\.be$/i;

function factPub(f: FactRowType): Pub {
  const host = hostOf(f.sourceUrl);
  const p = f.provenance as { channelName?: string; channelId?: string } | null;
  if (YT_HOST.test(host) && p?.channelName) {
    return { key: `yt:${p.channelId || p.channelName}`, name: p.channelName, kind: 'youtube' };
  }
  return { key: host, name: host, kind: 'web' };
}

/** Group fact rows by publication identity (channel for YouTube, host otherwise),
 *  preserving first-appearance order. */
function groupByPublication(facts: FactRowType[]): { pub: Pub; facts: FactRowType[] }[] {
  const order: string[] = [];
  const map = new Map<string, { pub: Pub; facts: FactRowType[] }>();
  for (const f of facts) {
    const pub = factPub(f);
    const g = map.get(pub.key);
    if (g) {
      g.facts.push(f);
    } else {
      map.set(pub.key, { pub, facts: [f] });
      order.push(pub.key);
    }
  }
  return order.map((k) => map.get(k)!);
}

/** Within a publication group, sub-group facts by source URL (first-appearance order). */
function groupByArticle(facts: FactRowType[]): { url: string; facts: FactRowType[] }[] {
  const map = new Map<string, FactRowType[]>();
  for (const f of facts) {
    const arr = map.get(f.sourceUrl);
    if (arr) arr.push(f); else map.set(f.sourceUrl, [f]);
  }
  return [...map.entries()].map(([url, facts]) => ({ url, facts }));
}

/**
 * Deterministic hue from a seed string: stable hash mod 360, mapped to an
 * oklch swatch at constant lightness + chroma.
 */
function pubHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % 360;
  return `oklch(0.5 0.13 ${hue})`;
}

/**
 * Two-letter monogram from a publication name (channel or host).
 * Strips "www.", then takes the first two alphanumeric chars of the main label,
 * uppercased. e.g. "lemonde.fr" → "LE", "Le Média" → "LE", "youtube.com" → "YO".
 */
function pubMono(name: string): string {
  const label = name.replace(/^www\./, '').split('.')[0] ?? name;
  const chars = label.replace(/[^a-zA-Z0-9]/g, '');
  return (chars.slice(0, 2) || label.slice(0, 2)).toUpperCase();
}

/** Evidence grouped by publication (channel for YouTube, host otherwise), then by source URL. */
export function BySource({ dossier, facts, citations }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const groups = groupByPublication(facts);
  const notes = (dossier.sourceNotes ?? {}) as Record<string, string>;

  return (
    <>
      {groups.map((g, idx) => {
        const articles = groupByArticle(g.facts);
        const articleNums = articles
          .map((a) => citations[a.url])
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b);
        const isYt = g.pub.kind === 'youtube';

        return (
          <details key={g.pub.key} className="pub" open={idx === 0}>
            <summary className="pub-head">
              <span className="pub-mono" style={{ background: pubHue(g.pub.key) }}>
                {pubMono(g.pub.name)}
              </span>
              <span className="pub-info">
                <span className="name">
                  {isYt && (
                    <Play
                      aria-hidden
                      style={{ width: 12, height: 12, marginRight: 5, verticalAlign: '-1px', color: 'var(--accent)' }}
                    />
                  )}
                  {g.pub.name}
                  {isYt && <span className="src-kind"> · chaîne YouTube</span>}
                </span>
                {notes[g.pub.name] && <span className="desc">{notes[g.pub.name]}</span>}
                <span className="ct">
                  {g.facts.length} fait{g.facts.length > 1 ? 's' : ''}
                  {isYt && ` · ${articles.length} vidéo${articles.length > 1 ? 's' : ''}`}
                </span>
                {articleNums.length > 0 && (
                  <span className="pub-nums">
                    {articleNums.map((num) => (
                      <span key={num} className="pub-num">{num}</span>
                    ))}
                  </span>
                )}
              </span>
              <ChevronRight className="chev" />
            </summary>
            {articles.map((a) => (
              <div className="art" key={a.url}>
                <div className="art-num">{citations[a.url] ?? '·'}</div>
                <div className="art-body">
                  <a
                    className="art-url"
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {isYt ? <>▶ {a.url}</> : a.url}
                  </a>
                  {a.facts.map((f) => (
                    <FactRow key={f.id} fact={f} host={g.pub.name} />
                  ))}
                </div>
              </div>
            ))}
          </details>
        );
      })}
    </>
  );
}
