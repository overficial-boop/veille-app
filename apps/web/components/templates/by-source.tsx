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

/** Evidence grouped by publication host, with per-host blurbs from sourceNotes. */
export function BySource({ dossier, facts }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const groups = groupByHost(facts);
  const notes = dossier.sourceNotes ?? {};

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.host}>
          <h3 className="font-display text-foreground text-lg">{g.host}</h3>
          {notes[g.host] && (
            <p className="text-muted-foreground mt-0.5 mb-2 text-sm">{notes[g.host]}</p>
          )}
          <div className="divide-border divide-y">
            {g.facts.map((f) => (
              <FactRow key={f.id} fact={f} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
