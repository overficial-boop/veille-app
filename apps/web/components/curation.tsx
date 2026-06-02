'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, X, Check, Sparkles } from 'lucide-react';
import { formatDateFr } from '@/components/templates/types';
import { hostOf } from '@/lib/host';
import { pubHue, pubMono } from '@/lib/publication';
import { Btn, Eyebrow } from '@/components/veille-ui';
import { setDocumentStatus } from '@/app/dossier/[slug]/actions';
import type { Doc } from '@/lib/documents';

type BriefFrame =
  | { type: 'brief-doc'; index: number; total: number; title: string }
  | { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' }
  | { type: 'synthesis-error'; message: string };

/**
 * GenerateBriefCta — the empty-brief prompt. On click it opens an SSE stream to the brief route
 * and expands in place into a live step list (Analyse i/N · titre … Rédaction de la synthèse…),
 * then refreshes so the brief + enriched cards render. (Click-triggered, so no StrictMode
 * auto-start race; the stream is closed on unmount.)
 */
export function GenerateBriefCta({ slug }: { slug: string }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [line, setLine] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const esRef = React.useRef<EventSource | null>(null);
  // Outcome is read in the onerror (stream-close) handler, which can't see fresh state — track via refs.
  const doneRef = React.useRef(false);
  const outcomeRef = React.useRef<'skip' | 'error' | null>(null);

  React.useEffect(() => () => esRef.current?.close(), []);

  function start() {
    if (running) return;
    setRunning(true);
    setNotice(null);
    setLine('Préparation…');
    doneRef.current = false;
    outcomeRef.current = null;
    const es = new EventSource(`/api/dossiers/${slug}/brief`);
    esRef.current = es;
    es.onmessage = (e) => {
      let p: BriefFrame;
      try { p = JSON.parse(e.data) as BriefFrame; } catch { return; }
      if (p.type === 'brief-doc') setLine(`Analyse des documents — ${p.index}/${p.total} · ${p.title}`);
      else if (p.type === 'synthesis' && p.state === 'start') setLine('Rédaction de la synthèse…');
      else if (p.type === 'synthesis' && p.state === 'done') doneRef.current = true;
      else if (p.type === 'synthesis' && p.state === 'skip') outcomeRef.current = 'skip';
      else if (p.type === 'synthesis-error') outcomeRef.current = 'error';
    };
    es.onerror = () => {
      // The server closes the stream after the final frame, surfacing here as onerror.
      es.close();
      esRef.current = null;
      setRunning(false);
      // On success a brief now exists and router.refresh() unmounts this CTA (Brief renders instead);
      // otherwise we stay mounted and explain why nothing appeared instead of silently reverting.
      if (!doneRef.current) {
        setNotice(
          outcomeRef.current === 'skip'
            ? 'Aucun fait à synthétiser pour l’instant — gardez des documents, puis réessayez.'
            : 'La génération du brief a échoué. Réessayez.',
        );
      }
      router.refresh();
    };
  }

  return (
    <section className="section brief-cta" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
      </div>
      {running ? (
        <div className="brief-empty" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="spin" />
          {line}
        </div>
      ) : (
        <>
          <div className="brief-empty">{notice ?? 'Pas encore de synthèse — rédigez-la à partir des documents retenus.'}</div>
          <Btn variant="primary" size="sm" icon={Sparkles} onClick={start}>
            Générer le brief
          </Btn>
        </>
      )}
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
                  {d.factCount > 0 && (
                    <span className="doc-facts">{d.factCount} {d.factCount === 1 ? 'fait' : 'faits'}</span>
                  )}
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
