'use client';

import * as React from 'react';
import Link from 'next/link';
import { useCitations } from './citations-context';
import type { SourceRow, BriefRef } from '@/lib/citations';

/**
 * The numbered Sources list under the brief, revealed by the shared "Afficher les sources" toggle.
 *
 * Preferred: one row per cited ARTICLE — `n · <article title> · publication`, linking to that
 * document's in-app fiche (or its external URL if it has no fiche). Legacy briefs pass host `rows`
 * instead. Renders nothing when hidden or empty.
 */
export function Sources({ refs, rows, slug }: { refs: BriefRef[]; rows: SourceRow[]; slug: string }) {
  const { show } = useCitations();
  if (!show) return null;
  if (refs.length > 0) {
    return (
      <section className="section sources-list" aria-label="Sources">
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {refs.map((r) => (
            <li key={r.n} style={{ display: 'flex', gap: '.5rem', padding: '.35rem 0', fontSize: 'var(--t-sm)' }}>
              <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', minWidth: '1.4em' }}>{r.n}</span>
              <span style={{ minWidth: 0 }}>
                {r.docId ? (
                  <Link href={`/dossier/${slug}/d/${r.docId}`} style={{ fontWeight: 600 }}>{r.title}</Link>
                ) : (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{r.title}</a>
                )}
                <span style={{ color: 'var(--ink-3)' }}> · {r.host}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (rows.length === 0) return null;
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
