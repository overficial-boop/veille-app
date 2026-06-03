import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { formatDateFr } from '@/components/templates/types';
import { Eyebrow } from '@/components/veille-ui';
import { groupJournalByDocument } from '@/lib/journal';
import type { JournalEntry } from '@/lib/dossiers';

/**
 * The journal — vetted new facts surfaced by refresh, GROUPED BY DOCUMENT (newest first). Each group
 * is one source document: its title + publication + date, with a link to the document's fiche in
 * Veille and to the external source, then the new facts beneath. The gate's reason is kept in the
 * data but not shown here. Hidden when empty.
 */
export function JournalFeed({ entries, slug }: { entries: JournalEntry[]; slug: string }) {
  if (entries.length === 0) return null;
  const groups = groupJournalByDocument(entries);
  return (
    <section className="section journal" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le journal</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Nouveautés</h2>
        </div>
      </div>
      <ol className="journal-list">
        {groups.map((g) => (
          <li key={g.key} className="journal-group">
            <div className="journal-ghead">
              <div className="journal-gtitle">
                {g.documentId ? (
                  <Link href={`/dossier/${slug}/d/${g.documentId}`}>{g.title}</Link>
                ) : (
                  <span>{g.title}</span>
                )}
              </div>
              <div className="journal-gmeta">
                <span>{g.host}</span>
                <span className="sep" />
                <span>{formatDateFr(new Date(g.latestAt))}</span>
                <a href={g.sourceUrl} target="_blank" rel="noopener noreferrer" className="journal-src">
                  source <ExternalLink style={{ width: 11, height: 11 }} />
                </a>
              </div>
            </div>
            <ul className="journal-gfacts">
              {g.facts.map((f) => (
                <li key={f.id} className="journal-text">{f.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
