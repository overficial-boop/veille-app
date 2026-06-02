'use client';

import * as React from 'react';
import { useCitations } from './citations-context';
import type { SourceRow } from '@/lib/citations';

/**
 * The numbered Sources list under the brief, revealed by the shared "Afficher les sources" toggle.
 * Each row: n · publication · optional source_note one-liner · outbound link. `id="cite-<host>"`
 * is the jump target for the brief's superscripts. Renders nothing when hidden or empty.
 */
export function Sources({ rows }: { rows: SourceRow[] }) {
  const { show } = useCitations();
  if (!show || rows.length === 0) return null;
  return (
    <section className="section sources-list" aria-label="Sources">
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li key={r.host} id={`cite-${r.host}`} style={{ display: 'flex', gap: '.5rem', padding: '.35rem 0', fontSize: 'var(--t-sm)' }}>
            <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', minWidth: '1.4em' }}>{r.n}</span>
            <span style={{ minWidth: 0 }}>
              <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{r.host}</a>
              {r.note ? <span style={{ color: 'var(--ink-2)' }}> — {r.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
