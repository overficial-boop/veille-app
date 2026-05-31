'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { useCitations, SourcesToggle } from './citations-context';

export type JournalEntry = { id: string; when: string; body: string };

/**
 * The dossier journal — dated "what's new" notes, newest first. Citations render as
 * numbered superscripts (same map + toggle as the brief), so the dated prose reads
 * cleanly and the sources reveal on demand instead of cluttering the text inline.
 */
export function Journal({
  entries,
  citations,
}: {
  entries: JournalEntry[];
  citations: Record<string, number>;
}) {
  const { show } = useCitations();
  const components = React.useMemo(() => citeComponents(citations), [citations]);

  if (entries.length === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Mises à jour</h2>
        </div>
        <SourcesToggle />
      </div>

      <div className="journal">
        {entries.map((u) => (
          <div key={u.id} className="update fade">
            <div className="when">{u.when}</div>
            <div className={'body' + (show ? ' show-src' : '')}>
              <ReactMarkdown components={components}>{prepareCiteMd(u.body)}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
