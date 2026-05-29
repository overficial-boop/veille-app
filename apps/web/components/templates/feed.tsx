import { FactRow } from './fact-row';
import { factDate, type TemplateProps } from './types';

/** Universal reverse-chronological feed: newest facts first. */
export function Feed({ facts }: TemplateProps) {
  if (facts.length === 0) {
    return <p className="text-muted-foreground text-sm">Aucun fait pour l&apos;instant.</p>;
  }

  const sorted = [...facts].sort((a, b) => factDate(b).getTime() - factDate(a).getTime());

  return (
    <div className="divide-border divide-y">
      {sorted.map((fact) => (
        <FactRow key={fact.id} fact={fact} />
      ))}
    </div>
  );
}
