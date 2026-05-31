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

/** Evidence grouped by publication host, with per-host blurbs from sourceNotes. */
export function BySource({ dossier, facts }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const groups = groupByHost(facts);
  const notes = (dossier.sourceNotes ?? {}) as Record<string, string>;

  return (
    <>
      {groups.map((g, idx) => (
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
            </span>
            <ChevronRight className="chev" />
          </summary>
          {g.facts.map((f) => (
            <FactRow key={f.id} fact={f} host={g.host} />
          ))}
        </details>
      ))}
    </>
  );
}
