'use client';

import * as React from 'react';
import Link from 'next/link';
import { Play, X, Check, Sparkles } from 'lucide-react';
import { formatDateFr } from '@/components/templates/types';
import { hostOf } from '@/lib/host';
import { pubHue, pubMono } from '@/lib/publication';
import { Btn, Eyebrow } from '@/components/veille-ui';
import { setDocumentStatus, generateBriefAction } from '@/app/dossier/[slug]/actions';
import type { Doc } from '@/lib/documents';

/**
 * GenerateBriefCta — the empty-brief prompt at the top of the workspace.
 * The brief is on-demand: until one exists, this invites the reader to assemble it.
 * generateBriefAction revalidates the dossier path, so the brief renders when the
 * transition resolves.
 */
export function GenerateBriefCta({ slug }: { slug: string }) {
  const [isPending, startTransition] = React.useTransition();
  return (
    <section className="section brief-cta" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
      </div>
      <div className="brief-empty">Pas encore de synthèse — rédigez-la à partir des documents retenus.</div>
      <Btn
        variant="primary"
        size="sm"
        icon={Sparkles}
        onClick={() => !isPending && startTransition(() => generateBriefAction(slug))}
        disabled={isPending}
      >
        {isPending ? 'Rédaction…' : 'Générer le brief'}
      </Btn>
    </section>
  );
}

/** Badge labels for the analysis blocks present on a document. */
function blockBadges(d: Doc): string[] {
  const b: string[] = [];
  if (d.review) b.push('review');
  if (d.bullets) b.push('puces');
  if (d.elaboration) b.push('+loin');
  if (d.factChecks) b.push('vérifs');
  return b;
}

/** Small relevance indicator — a percentage pill tinted by score, with the reason as a tooltip.
 *  Null relevance (unscored) renders nothing. */
function RelevancePill({ relevance, reason }: { relevance: number | null; reason: string | null }) {
  if (relevance == null) return null;
  const pct = Math.round(relevance * 100);
  const tier = relevance >= 0.66 ? 'hi' : relevance >= 0.4 ? 'mid' : 'lo';
  return (
    <span className={`rel-pill rel-${tier}`} title={reason ?? `Pertinence ${pct}%`}>
      {pct}%
    </span>
  );
}

/**
 * KeptFeed — the curated documents, the body of the workspace.
 * Reuses the .doc-grid / .doc-card look; each card links to its fiche and carries a
 * relevance pill plus a quiet "Écarter" control that rejects the document without
 * navigating (the reject click stops the link).
 */
export function KeptFeed({ slug, documents }: { slug: string; documents: Doc[] }) {
  const [isPending, startTransition] = React.useTransition();

  function reject(e: React.MouseEvent, docId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;
    startTransition(() => {
      setDocumentStatus(slug, docId, 'rejected');
    });
  }

  return (
    <section className="section">
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le dossier</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>
            Documents {documents.length > 0 ? `(${documents.length})` : ''}
          </h2>
        </div>
      </div>

      {documents.length === 0 ? (
        <p
          style={{
            color: 'var(--ink-3)',
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: '1.1rem',
            marginTop: '1rem',
          }}
        >
          Aucun document retenu pour l&apos;instant — lancez un rafraîchissement.
        </p>
      ) : (
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
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          right: 2,
                          width: 8,
                          height: 8,
                          color: 'var(--accent-ink)',
                          opacity: 0.8,
                        }}
                      />
                    )}
                  </span>
                  <span className="doc-site">{siteLabel}</span>
                  <RelevancePill relevance={d.relevance} reason={d.relevanceReason} />
                  <button
                    type="button"
                    className="doc-reject"
                    title="Écarter ce document"
                    aria-label={`Écarter ${d.title ?? d.url}`}
                    onClick={(e) => reject(e, d.id)}
                    disabled={isPending}
                  >
                    <X />
                  </button>
                </div>

                <p className="doc-title">{d.title ?? d.url}</p>

                {d.shortSummary && <p className="doc-summary">{d.shortSummary}</p>}

                <div className="doc-foot">
                  <span>{formatDateFr(new Date(date))}</span>
                  {badges.length > 0 && (
                    <span className="doc-badges">
                      {badges.map((b) => (
                        <span key={b} className="doc-badge">
                          {b}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * SuggestionsTray — lower-confidence candidates, parked behind a collapsed <details>.
 * Each row offers "Garder" (promote to kept) and "Écarter" (reject). Renders nothing
 * when there are no suggestions.
 */
export function SuggestionsTray({ slug, documents }: { slug: string; documents: Doc[] }) {
  const [isPending, startTransition] = React.useTransition();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => { if (!isPending) setBusyId(null); }, [isPending]);

  if (documents.length === 0) return null;

  function curate(docId: string, status: 'kept' | 'rejected') {
    if (isPending) return;
    setBusyId(docId);
    startTransition(() => {
      setDocumentStatus(slug, docId, status);
    });
  }

  return (
    <details className="suggest-tray section">
      <summary className="suggest-head">
        <Eyebrow>À trier</Eyebrow>
        <span className="suggest-count">Suggestions ({documents.length})</span>
      </summary>

      <div className="suggest-list">
        {documents.map((d) => {
          const siteLabel = d.siteName ?? hostOf(d.url);
          const busy = busyId === d.id;
          return (
            <div key={d.id} className={`suggest-row${busy && isPending ? ' suggest-row-busy' : ''}`}>
              <Link href={`/dossier/${slug}/d/${d.id}`} className="suggest-main">
                <span className="suggest-title">{d.title ?? d.url}</span>
                <span className="suggest-meta">
                  <span className="doc-site">{siteLabel}</span>
                  <RelevancePill relevance={d.relevance} reason={d.relevanceReason} />
                </span>
              </Link>
              <div className="suggest-acts">
                <Btn
                  variant="soft"
                  size="sm"
                  icon={Check}
                  onClick={() => curate(d.id, 'kept')}
                  disabled={isPending}
                >
                  Garder
                </Btn>
                <Btn
                  variant="quiet"
                  size="sm"
                  icon={X}
                  onClick={() => curate(d.id, 'rejected')}
                  disabled={isPending}
                  aria-label={`Écarter ${d.title ?? d.url}`}
                >
                  Écarter
                </Btn>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
