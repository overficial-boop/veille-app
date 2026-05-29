import { FactRow } from './fact-row';
import { factDate, type FactRow as FactRowType, type TemplateProps } from './types';

/** Confidence descending, nulls last — for the "Faits clés" highlight. */
function byConfidenceDesc(a: FactRowType, b: FactRowType): number {
  const ca = a.confidence ?? -1;
  const cb = b.confidence ?? -1;
  return cb - ca;
}

/** Profile of a person or entity: key facts on top, then a full chronology. */
export function Profile({ dossier, facts }: TemplateProps) {
  if (facts.length === 0) {
    return (
      <div>
        <header>
          <h2 className="font-display text-xl">{dossier.name}</h2>
        </header>
        <p className="text-muted-foreground mt-6 text-sm">Aucun fait pour l&apos;instant.</p>
      </div>
    );
  }

  const keyFacts = [...facts].sort(byConfidenceDesc).slice(0, 5);
  const chronological = [...facts].sort((a, b) => factDate(b).getTime() - factDate(a).getTime());

  return (
    <div className="space-y-10">
      <header>
        <h2 className="font-display text-xl">{dossier.name}</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {facts.length} fait{facts.length > 1 ? 's' : ''}
        </p>
      </header>

      <section>
        <h3 className="font-display text-foreground text-lg">Faits clés</h3>
        <div className="divide-border mt-2 divide-y">
          {keyFacts.map((fact) => (
            <FactRow key={fact.id} fact={fact} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-display text-foreground text-lg">Chronologie</h3>
        <div className="divide-border mt-2 divide-y">
          {chronological.map((fact) => (
            <FactRow key={fact.id} fact={fact} />
          ))}
        </div>
      </section>
    </div>
  );
}
