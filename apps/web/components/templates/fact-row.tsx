import { Quote } from 'lucide-react';
import { ConfBars, confLevel } from '@/components/veille-ui';
import { factDate, formatDateFr, sourceHost, type FactRow as FactRowType } from './types';

/**
 * One fact, dated and cited — the citation-rigor unit of every template.
 * Server component: pure render, no hooks. The verbatim source passage is
 * revealed via a native <details> (no JS), preserving the audit trail.
 */
export function FactRow({ fact, host }: { fact: FactRowType; host?: string }) {
  const displayHost = host ?? sourceHost(fact.sourceUrl);
  return (
    <div className="fact">
      <div className="fact-text">{fact.text}</div>
      <div className="fact-meta">
        <time dateTime={factDate(fact).toISOString()}>{formatDateFr(factDate(fact))}</time>
        <ConfBars level={confLevel(fact.confidence ?? undefined)} />
      </div>
      <details className="verbatim">
        <summary>
          <Quote style={{ width: 13, height: 13 }} />
          Passage source
        </summary>
        <blockquote>
          {fact.sourcePassage}
          <span className="cite-src">
            — {displayHost} · {fact.sourceUrl}
          </span>
        </blockquote>
      </details>
    </div>
  );
}
