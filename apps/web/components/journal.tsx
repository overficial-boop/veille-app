'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { useCitations, SourcesToggle } from './citations-context';

export type JournalEntry = { id: string; when: string; body: string; kind: 'actualite' | 'complement' };

/**
 * The dossier journal — two recency streams. "Actualité" = developments published since the
 * last refresh; "Compléments / Découvertes" = older or undated material newly found. Citations
 * render as numbered superscripts (shared map + toggle with the brief).
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

  const actu = entries.filter((e) => e.kind === 'actualite');
  const comp = entries.filter((e) => e.kind === 'complement');

  const stream = (items: JournalEntry[]) => (
    <div className="journal">
      {items.map((u) => (
        <div key={u.id} className="update fade">
          <div className="when">{u.when}</div>
          <div className={'body' + (show ? ' show-src' : '')}>
            <ReactMarkdown components={components}>{prepareCiteMd(u.body)}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {actu.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div className="ttl">
              <Eyebrow>Journal</Eyebrow>
              <h2 style={{ marginTop: '.1rem' }}>Actualité</h2>
            </div>
            <SourcesToggle />
          </div>
          {stream(actu)}
        </section>
      )}
      {comp.length > 0 && (
        <section className="section">
          <div className="section-head">
            <div className="ttl">
              <Eyebrow>Journal</Eyebrow>
              <h2 style={{ marginTop: '.1rem' }}>Compléments / Découvertes</h2>
            </div>
            {actu.length === 0 && <SourcesToggle />}
          </div>
          {stream(comp)}
        </section>
      )}
    </>
  );
}
