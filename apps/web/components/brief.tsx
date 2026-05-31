'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Prose } from './prose';
import { Eyebrow } from './veille-ui';

/**
 * Remove inline source citations (`[text](url)`, with any leading whitespace) so the
 * default brief reads as clean prose. Our citations are bare host-name links woven into
 * the text, so de-emphasizing them via CSS isn't enough — they must be removed when hidden.
 */
function stripSourceLinks(markdown: string): string {
  return markdown.replace(/\s*\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)/g, '');
}

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 *
 * Default ("Afficher les sources" off): citations are stripped → clean reading.
 * On ("Sources affichées"): the full markdown renders with citation links, and the
 * `show-src` class (CSS in globals.css) gives them the accent underline.
 */
export function Brief({ brief }: { brief: string }) {
  const [showSrc, setShowSrc] = React.useState(false);
  const toggle = () => setShowSrc((v) => !v);

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
        <Prose>{showSrc ? brief : stripSourceLinks(brief)}</Prose>
      </div>
    </section>
  );
}
