import { Badge } from '@/components/ui/badge';
import { factDate, formatDateFr, sourceHost, type FactRow as FactRowType } from './types';

/**
 * One fact, dated and cited — the citation-rigor unit of every template.
 * Server component: pure render, no hooks. The verbatim source passage is
 * revealed via a native <details> (no JS), preserving the audit trail.
 */
export function FactRow({ fact }: { fact: FactRowType }) {
  return (
    <article className="py-4">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <time dateTime={factDate(fact).toISOString()}>{formatDateFr(factDate(fact))}</time>
        <span aria-hidden="true">·</span>
        <a
          href={fact.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          {sourceHost(fact.sourceUrl)}
        </a>
        {fact.confidence != null && (
          <Badge variant="secondary">{Math.round(fact.confidence * 100)} %</Badge>
        )}
      </div>

      <p className="text-foreground mt-1.5 leading-relaxed">{fact.text}</p>

      <details className="mt-2">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
          Passage source
        </summary>
        <blockquote className="border-border text-muted-foreground mt-2 border-l-2 pl-3 text-sm italic">
          {fact.sourcePassage}
        </blockquote>
      </details>
    </article>
  );
}
