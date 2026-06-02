import Link from 'next/link';
import { hostOf } from '@/lib/host';
import { formatDateFr } from '@/components/templates/types';
import { Eyebrow } from '@/components/veille-ui';
import type { JournalEntry } from '@/lib/dossiers';

/**
 * The journal — a feed of genuinely new, vetted facts surfaced by refresh, newest first.
 * Each entry is the fact itself (text), with its publication (→ the document's fiche), the date it
 * was surfaced, and the gate's one-line reason. Rendered above the brief; hidden when empty.
 */
export function JournalFeed({ entries, slug }: { entries: JournalEntry[]; slug: string }) {
  if (entries.length === 0) return null;
  return (
    <section className="section journal" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Nouveautés</h2>
        </div>
      </div>
      <ol className="journal-list">
        {entries.map((e) => {
          const host = hostOf(e.sourceUrl);
          return (
            <li key={e.id} className="journal-entry">
              <div className="journal-date">{formatDateFr(new Date(e.journalAt))}</div>
              <div className="journal-body">
                <p className="journal-text">{e.text}</p>
                {e.journalReason ? <p className="journal-reason">{e.journalReason}</p> : null}
                <div className="journal-meta">
                  {e.documentId ? (
                    <Link href={`/dossier/${slug}/d/${e.documentId}`}>{host}</Link>
                  ) : (
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{host}</a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
