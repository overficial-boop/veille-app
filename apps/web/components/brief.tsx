'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { renderNumberedCitations, renderHostCitations, type BriefRef } from '@/lib/citations';
import { useCitations, SourcesToggle } from './citations-context';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 *
 * Preferred: the model cites SPECIFIC articles by number ([1], [2, 5]); `refs` maps each number to
 * its article URL, and `renderNumberedCitations` turns them into the numbered-superscript pipeline,
 * each superscript linking to that exact article. Legacy briefs (no refs, host `[lefigaro.fr]` tags)
 * fall back to the host renderer so they still read cleanly until regenerated. Hidden until the toggle.
 */
export function Brief({ brief, refs, hostNumbers }: { brief: string; refs: BriefRef[]; hostNumbers: Record<string, number> }) {
  const { show } = useCitations();
  const numbered = refs.length > 0;
  const md = React.useMemo(
    () => prepareCiteMd(numbered ? renderNumberedCitations(brief, refs) : renderHostCitations(brief, hostNumbers)),
    [brief, refs, hostNumbers, numbered],
  );
  const citations = React.useMemo(
    () =>
      numbered
        ? Object.fromEntries(refs.map((r) => [r.url, r.n]))
        : Object.fromEntries(Object.entries(hostNumbers).map(([h, n]) => [`#cite-${h}`, n])),
    [refs, hostNumbers, numbered],
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
