'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { renderHostCitations } from '@/lib/citations';
import { useCitations, SourcesToggle } from './citations-context';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 * Citations are publication tags ([lefigaro.fr]) the model emits; we rewrite them into the
 * shared numbered-superscript pipeline. Numbers come from `hostNumbers` (one per publication),
 * shared with the Sources list so each superscript jumps to its entry. Hidden until the toggle.
 */
export function Brief({ brief, hostNumbers }: { brief: string; hostNumbers: Record<string, number> }) {
  const { show } = useCitations();
  const md = React.useMemo(() => prepareCiteMd(renderHostCitations(brief, hostNumbers)), [brief, hostNumbers]);
  const citations = React.useMemo(
    () => Object.fromEntries(Object.entries(hostNumbers).map(([h, n]) => [`#cite-${h}`, n])),
    [hostNumbers],
  );
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
