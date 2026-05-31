'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Prose } from './prose';
import { Eyebrow } from './veille-ui';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 *
 * The inline source citations stay in the DOM at all times; the `show-src` class
 * (governed by CSS in globals.css) reveals or de-emphasizes their emphasis. The
 * fold-toggle just flips that class — it does not strip links. Default is the
 * clean reading view (sources de-emphasized).
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
        <Prose>{brief}</Prose>
      </div>
    </section>
  );
}
