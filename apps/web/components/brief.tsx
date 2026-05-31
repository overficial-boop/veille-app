'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { useCitations, SourcesToggle } from './citations-context';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 *
 * Citations render as numbered superscripts (¹²³), hidden until "Afficher les sources"
 * is toggled. That toggle is shared (CitationsProvider), so the journal reveals in step.
 * The `citations` map is shared with the journal + evidence so each URL keeps one number.
 */
export function Brief({ brief, citations }: { brief: string; citations: Record<string, number> }) {
  const { show } = useCitations();
  const md = React.useMemo(() => prepareCiteMd(brief), [brief]);
  const components = React.useMemo(() => citeComponents(citations), [citations]);

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
        <SourcesToggle />
      </div>

      <div className={'brief-prose' + (show ? ' show-src' : '')}>
        <ReactMarkdown components={components}>{md}</ReactMarkdown>
      </div>
    </section>
  );
}
