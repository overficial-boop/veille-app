import { ChevronRight } from 'lucide-react';
import { hostOf } from '@/lib/synthesis';
import { FactRow } from './fact-row';
import type { FactRow as FactRowType, TemplateProps } from './types';

/** Group DB fact rows by publication host, preserving first-appearance order. */
function groupByHost(facts: FactRowType[]): { host: string; facts: FactRowType[] }[] {
  const map = new Map<string, FactRowType[]>();
  for (const f of facts) {
    const h = hostOf(f.sourceUrl);
    const arr = map.get(h);
    if (arr) arr.push(f); else map.set(h, [f]);
  }
  return [...map.entries()].map(([host, facts]) => ({ host, facts }));
}

/** Within a host group, sub-group facts by article URL (first-appearance order). */
function groupByArticle(facts: FactRowType[]): { url: string; facts: FactRowType[] }[] {
  const map = new Map<string, FactRowType[]>();
  for (const f of facts) {
    const arr = map.get(f.sourceUrl);
    if (arr) arr.push(f); else map.set(f.sourceUrl, [f]);
  }
  return [...map.entries()].map(([url, facts]) => ({ url, facts }));
}

/**
 * Deterministic hue from a host string: stable hash mod 360, mapped to an
 * oklch swatch at constant lightness + chroma.
 */
function pubHue(host: string): string {
  let h = 0;
  for (let i = 0; i < host.length; i++) {
    h = (h * 31 + host.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % 360;
  return `oklch(0.5 0.13 ${hue})`;
}

/**
 * Two-letter monogram from a host.
 * Strips "www.", then takes the first two alphanumeric chars of the main label,
 * uppercased. e.g. "lemonde.fr" → "LE", "rtl.fr" → "RT", "youtube.com" → "YO".
 */
function pubMono(host: string): string {
  const label = host.replace(/^www\./, '').split('.')[0] ?? host;
  const chars = label.replace(/[^a-zA-Z0-9]/g, '');
  return (chars.slice(0, 2) || label.slice(0, 2)).toUpperCase();
}

/** Evidence grouped by publication host, then by article URL. */
export function BySource({ dossier, facts, citations }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const groups = groupByHost(facts);
  const notes = (dossier.sourceNotes ?? {}) as Record<string, string>;

  return (
    <>
      {groups.map((g, idx) => {
        const articles = groupByArticle(g.facts);
        const articleNums = articles
          .map((a) => citations[a.url])
          .filter((n): n is number => n !== undefined)
          .sort((a, b) => a - b);

        return (
          <details key={g.host} className="pub" open={idx === 0}>
            <summary className="pub-head">
              <span className="pub-mono" style={{ background: pubHue(g.host) }}>
                {pubMono(g.host)}
              </span>
              <span className="pub-info">
                <span className="name">{g.host}</span>
                {notes[g.host] && <span className="desc">{notes[g.host]}</span>}
                <span className="ct">
                  {g.facts.length} fait{g.facts.length > 1 ? 's' : ''}
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
                    {a.url}
                  </a>
                  {a.facts.map((f) => (
                    <FactRow key={f.id} fact={f} host={g.host} />
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
