'use client';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Eye, EyeOff } from 'lucide-react';
import { proseComponents } from './prose';
import { Eyebrow } from './veille-ui';
import { hostOf } from '@/lib/host';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 *
 * Citations render as numbered superscripts (¹²³) at the cited point, each a link to its
 * source. By default they're invisible (clean reading); "Afficher les sources" reveals the
 * numbers + the accent underline (the `.cite` / `.cite sup` CSS in globals.css does the toggle).
 *
 * `citations` is the shared map (built in the page) so brief superscripts and the evidence
 * section use the same numbers.
 */
export function Brief({ brief, citations }: { brief: string; citations: Record<string, number> }) {
  const [showSrc, setShowSrc] = React.useState(false);
  const toggle = () => setShowSrc((v) => !v);

  // Attach each citation to the preceding word (drop the space before the link) so the
  // superscript reads as "claim¹", and the prose stays clean when the number is hidden.
  const md = React.useMemo(() => brief.replace(/[ \t]+(?=\[[^\]]+\]\()/g, ''), [brief]);

  const components = React.useMemo<Components>(
    () => ({
      ...proseComponents,
      a: ({ href, children }) => {
        const n = href ? citations[href] : undefined;
        if (!href || !n) return <>{children}</>;
        return (
          <a
            className="cite"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={hostOf(href)}
          >
            <sup>{n}</sup>
          </a>
        );
      },
    }),
    [citations],
  );

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
        <div
          className={'fold-toggle' + (showSrc ? ' on' : '')}
          role="switch"
          aria-checked={showSrc}
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => e.key === 'Enter' && toggle()}
        >
          {showSrc ? <Eye /> : <EyeOff />}
          {showSrc ? 'Sources affichées' : 'Afficher les sources'}
        </div>
      </div>

      <div className={'brief-prose' + (showSrc ? ' show-src' : '')}>
        <ReactMarkdown components={components}>{md}</ReactMarkdown>
      </div>
    </section>
  );
}
