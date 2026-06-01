'use client';

import * as React from 'react';
import { Eyebrow, Btn, ConfBars, confLevel } from './veille-ui';
import { Prose } from './prose';
import type {
  ReviewBlock,
  BulletsBlock,
  ElaborationBlock,
  FactChecksBlock,
  TokenCost,
} from '@/lib/document/types';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface FactProp {
  id: string;
  text: string;
  sourcePassage: string;
  confidence: number | null;
  sourceUrl: string;
  extractedAt: string;
}

interface DocumentProp {
  id: string;
  url: string;
  title: string | null;
  siteName: string | null;
  kind: 'web' | 'youtube';
  shortSummary: string | null;
  review: ReviewBlock | null;
  bullets: BulletsBlock | null;
  elaboration: ElaborationBlock | null;
  factChecks: FactChecksBlock | null;
}

interface DocumentFicheProps {
  document: DocumentProp;
  facts: FactProp[];
  slug: string;
}

/* ------------------------------------------------------------------ */
/* Cost line                                                            */
/* ------------------------------------------------------------------ */

function CostLine({ cost }: { cost: TokenCost }) {
  return (
    <span
      style={{
        display: 'block',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-mono)',
        color: 'var(--ink-3)',
        marginTop: '.5rem',
      }}
    >
      {cost.model} · {cost.inputTokens}/{cost.outputTokens} tok
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

export function DocumentFiche({ document: doc, facts, slug }: DocumentFicheProps) {
  const [elaboration, setElaboration] = React.useState<ElaborationBlock | null>(doc.elaboration);
  const [factChecks, setFactChecks] = React.useState<FactChecksBlock | null>(doc.factChecks);
  const [elaborating, setElaborating] = React.useState(false);
  const [factChecking, setFactChecking] = React.useState(false);
  const [withTavily, setWithTavily] = React.useState(false);
  const [elaborateError, setElaborateError] = React.useState<string | null>(null);
  const [factCheckError, setFactCheckError] = React.useState<string | null>(null);

  async function handleElaborate() {
    setElaborating(true);
    setElaborateError(null);
    try {
      const res = await fetch(`/api/dossiers/${slug}/documents/${doc.id}/elaborate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ withTavily }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        setElaborateError(msg || 'Erreur inconnue');
      } else {
        const block = await res.json() as ElaborationBlock;
        setElaboration(block);
      }
    } catch (e) {
      setElaborateError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setElaborating(false);
    }
  }

  async function handleFactCheck() {
    setFactChecking(true);
    setFactCheckError(null);
    try {
      const res = await fetch(`/api/dossiers/${slug}/documents/${doc.id}/factcheck`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        setFactCheckError(msg || 'Erreur inconnue');
      } else {
        const block = await res.json() as FactChecksBlock;
        setFactChecks(block);
      }
    } catch (e) {
      setFactCheckError(e instanceof Error ? e.message : 'Erreur réseau');
    } finally {
      setFactChecking(false);
    }
  }

  return (
    <div style={{ marginTop: '2rem' }}>

      {/* Résumé court */}
      {doc.shortSummary && (
        <p className="fiche-lead">{doc.shortSummary}</p>
      )}

      {/* Review */}
      <section className="section" style={{ marginTop: '2rem' }}>
        <div className="section-head">
          <div className="ttl">
            <Eyebrow>Analyse</Eyebrow>
            <h2 style={{ marginTop: '.1rem' }}>Review</h2>
          </div>
        </div>
        {doc.review ? (
          <>
            <Prose>{doc.review.markdown}</Prose>
            <CostLine cost={doc.review.cost} />
          </>
        ) : (
          <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', color: 'var(--ink-3)', fontSize: '1.05rem' }}>
            Analyse en attente.
          </p>
        )}
      </section>

      {/* Résumé en puces */}
      {doc.bullets && (
        <section className="section" style={{ marginTop: '2rem' }}>
          <div className="section-head">
            <div className="ttl">
              <Eyebrow>Résumé</Eyebrow>
              <h2 style={{ marginTop: '.1rem' }}>En bref</h2>
            </div>
          </div>
          <Prose>{doc.bullets.markdown}</Prose>
          <CostLine cost={doc.bullets.cost} />
        </section>
      )}

      {/* Aller plus loin */}
      <section className="section" style={{ marginTop: '2rem' }}>
        <div className="section-head">
          <div className="ttl">
            <Eyebrow>Approfondissement</Eyebrow>
            <h2 style={{ marginTop: '.1rem' }}>Aller plus loin</h2>
          </div>
        </div>

        {elaboration ? (
          <>
            <div className="fiche-topics">
              {elaboration.topics.map((topic) => (
                <div key={topic.name} className="fiche-topic">
                  <strong>{topic.name}</strong>
                  <p style={{ color: 'var(--ink-2)', fontSize: 'var(--t-sm)', marginTop: '.3rem', lineHeight: 1.55 }}>
                    {topic.summary}
                  </p>
                  {topic.resources && topic.resources.length > 0 && (
                    <div className="fiche-chips">
                      {topic.resources.map((r, i) => (
                        <span key={i} className="chip">
                          {r.kind ? `[${r.kind}] ` : ''}{r.name}{r.note ? ` — ${r.note}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {topic.links && topic.links.length > 0 && (
                    <div className="fiche-links">
                      {topic.links.map((l, i) => (
                        <a
                          key={i}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="fiche-link"
                        >
                          {l.title}
                          {l.siteName && <span style={{ color: 'var(--ink-3)', marginLeft: '.4em' }}>({l.siteName})</span>}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <CostLine cost={elaboration.cost} />
          </>
        ) : (
          <div className="fiche-generate">
            <label className="fiche-toggle">
              <input
                type="checkbox"
                checked={withTavily}
                onChange={(e) => setWithTavily(e.target.checked)}
                disabled={elaborating}
              />
              <span>avec recherche web</span>
            </label>
            <Btn
              variant="soft"
              onClick={handleElaborate}
              disabled={elaborating}
            >
              {elaborating ? 'Génération…' : 'Générer (aller plus loin)'}
            </Btn>
            {elaborateError && (
              <p style={{ color: 'var(--danger)', fontSize: 'var(--t-sm)', marginTop: '.5rem' }}>
                {elaborateError}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Faits */}
      <section className="section" style={{ marginTop: '2rem' }}>
        <div className="section-head">
          <div className="ttl">
            <Eyebrow>Preuve</Eyebrow>
            <h2 style={{ marginTop: '.1rem' }}>Faits sourcés</h2>
          </div>
          {facts.length > 0 && !factChecks && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.4rem' }}>
              <Btn
                variant="ghost"
                size="sm"
                onClick={handleFactCheck}
                disabled={factChecking}
              >
                {factChecking ? 'Vérification…' : 'Vérifier les faits'}
              </Btn>
              {factCheckError && (
                <p style={{ color: 'var(--danger)', fontSize: 'var(--t-xs)' }}>
                  {factCheckError}
                </p>
              )}
            </div>
          )}
        </div>

        {facts.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>
            Aucun fait extrait pour ce document.
          </p>
        ) : (
          <>
            {factChecks && (
              <>
                <div style={{ marginBottom: '.5rem' }}>
                  <CostLine cost={factChecks.cost} />
                </div>
              </>
            )}
            <div className="fiche-facts">
              {facts.map((f) => {
                const check = factChecks?.checks.find((c) => c.factId === f.id);
                return (
                  <div key={f.id} className="fact" style={{ paddingLeft: 0 }}>
                    <div className="fact-top">
                      <span className="fact-text">{f.text}</span>
                    </div>
                    {check && (
                      <p className="fiche-check-note">{check.note}</p>
                    )}
                    <div className="fact-meta">
                      <ConfBars level={confLevel(f.confidence ?? undefined)} />
                    </div>
                    {f.sourcePassage && (
                      <details className="verbatim">
                        <summary>passage source</summary>
                        <blockquote>{f.sourcePassage}</blockquote>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
