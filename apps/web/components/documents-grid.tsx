import Link from 'next/link';
import { Play } from 'lucide-react';
import { formatDateFr } from '@/components/templates/types';
import { hostOf } from '@/lib/host';
import type { listDocuments } from '@/lib/documents';

type DocRow = Awaited<ReturnType<typeof listDocuments>>[number];

/**
 * Deterministic hue from a seed string — same helper as in by-source.tsx.
 * Task 8 will extract both to lib/publication.ts.
 */
function pubHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % 360;
  return `oklch(0.5 0.13 ${hue})`;
}

/**
 * Two-letter monogram from a publication name — same helper as in by-source.tsx.
 */
function pubMono(name: string): string {
  const label = name.replace(/^www\./, '').split('.')[0] ?? name;
  const chars = label.replace(/[^a-zA-Z0-9]/g, '');
  return (chars.slice(0, 2) || label.slice(0, 2)).toUpperCase();
}

/** Badge labels for the blocks present on a document card. */
function blockBadges(d: DocRow): string[] {
  const b: string[] = [];
  if (d.review) b.push('review');
  if (d.bullets) b.push('puces');
  if (d.elaboration) b.push('+loin');
  if (d.factChecks) b.push('vérifs');
  return b;
}

interface DocumentsGridProps {
  documents: DocRow[];
  slug: string;
}

export function DocumentsGrid({ documents, slug }: DocumentsGridProps) {
  if (documents.length === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '1.1rem', marginTop: '2rem' }}>
        Aucun document analysé pour l&apos;instant.
      </p>
    );
  }

  return (
    <div className="doc-grid">
      {documents.map((d) => {
        const siteLabel = d.siteName ?? hostOf(d.url);
        const mono = pubMono(siteLabel);
        const hue = pubHue(siteLabel);
        const date = d.publishedAt ?? d.createdAt;
        const badges = blockBadges(d);

        return (
          <Link key={d.id} href={`/dossier/${slug}/d/${d.id}`} className="doc-card dcard">
            <div className="doc-card-top">
              <span className="pub-mono" style={{ background: hue }}>
                {mono}
                {d.kind === 'youtube' && (
                  <Play
                    aria-hidden
                    style={{ position: 'absolute', bottom: 2, right: 2, width: 8, height: 8, color: 'var(--accent-ink)', opacity: 0.8 }}
                  />
                )}
              </span>
              <span className="doc-site">{siteLabel}</span>
            </div>

            <p className="doc-title">
              {d.title ?? d.url}
            </p>

            {d.shortSummary && (
              <p className="doc-summary">{d.shortSummary}</p>
            )}

            <div className="doc-foot">
              <span>{formatDateFr(new Date(date))}</span>
              {badges.length > 0 && (
                <span className="doc-badges">
                  {badges.map((b) => (
                    <span key={b} className="doc-badge">{b}</span>
                  ))}
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
