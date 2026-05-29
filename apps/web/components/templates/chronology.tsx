import { FactRow } from './fact-row';
import { factDate, formatDateFr, type FactRow as FactRowType, type TemplateProps } from './types';

/** Group facts by their display day, preserving the order they arrive in. */
function groupByDay(sorted: FactRowType[]): { label: string; facts: FactRowType[] }[] {
  const groups: { label: string; facts: FactRowType[] }[] = [];
  for (const fact of sorted) {
    const label = formatDateFr(factDate(fact));
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.facts.push(fact);
    } else {
      groups.push({ label, facts: [fact] });
    }
  }
  return groups;
}

/** Strict timeline: oldest to newest, grouped under date headings. */
export function Chronology({ facts }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const sorted = [...facts].sort((a, b) => factDate(a).getTime() - factDate(b).getTime());
  const groups = groupByDay(sorted);

  return (
    <div className="border-border space-y-8 border-l pl-4">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="font-display text-foreground text-sm font-medium">{group.label}</h3>
          <div className="divide-border mt-1 divide-y">
            {group.facts.map((fact) => (
              <FactRow key={fact.id} fact={fact} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
