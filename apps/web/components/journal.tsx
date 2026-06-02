'use client';

import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { proseComponents } from './prose';

export type JournalEntry = { id: string; when: string; body: string };

/** Dossier journal — a single dated "nouveautés" stream of clean prose. Sources live in the
 *  Documents tab; the journal carries no inline citations. */
export function Journal({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Nouveautés</h2>
        </div>
      </div>
      <div className="journal">
        {entries.map((u) => (
          <div key={u.id} className="update fade">
            <div className="when">{u.when}</div>
            <div className="body">
              <ReactMarkdown components={proseComponents}>{u.body}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
