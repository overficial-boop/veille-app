import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier, listSources, listFacts, listUpdates } from '@/lib/dossiers';
import { formatDateFr } from '@/components/templates/types';
import { Prose } from '@/components/prose';
import { Brief } from '@/components/brief';
import { BySource } from '@/components/templates/by-source';
import { DossierRuntime } from '@/components/dossier-runtime';
import { sourceTarget } from '@/lib/source-input';
import { TopBar } from '@/components/topbar';
import { StatusPill, Eyebrow } from '@/components/veille-ui';

export const dynamic = 'force-dynamic';

const TEMPLATE_LABELS: Record<string, string> = {
  profile: 'Profil',
  chronology: 'Chronologie',
  feed: 'Fil',
};

function templateLabel(t: string): string {
  return TEMPLATE_LABELS[t] ?? t;
}

export default async function DossierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) notFound();
  const [sources, facts, updates] = await Promise.all([
    listSources(dossier.id),
    listFacts(dossier.id),
    listUpdates(dossier.id),
  ]);
  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <Link href="/" className="back">
          <ArrowLeft />
          Tous les dossiers
        </Link>

        <header className="dossier-head">
          <h1 className="rise">{dossier.name}</h1>
          <p className="intent rise">« {dossier.intent} »</p>
          <div className="dossier-meta rise">
            <StatusPill status={dossier.status} />
            <span className="sep" />
            <span>
              <b>{facts.length}</b> {facts.length === 1 ? 'fait sourcé' : 'faits sourcés'}
            </span>
            <span className="sep" />
            <span>{templateLabel(dossier.template)}</span>
            {dossier.refreshedAt ? (
              <>
                <span className="sep" />
                <span>
                  Actualisé le <b>{formatDateFr(new Date(dossier.refreshedAt))}</b>
                </span>
              </>
            ) : null}
          </div>
        </header>

        <div className="dossier-body">
          {/* RAIL — live runtime + sources (re-skinned in T6) */}
          <aside className="rail">
            <DossierRuntime
              slug={dossier.slug}
              status={dossier.status}
              sources={sources.map((s) => ({
                id: s.id,
                connector: s.connector,
                kind: s.kind,
                label: s.label,
                source: s.input.source,
                target: sourceTarget(s.connector, s.input),
                lastExtractedAt: s.lastExtractedAt ? s.lastExtractedAt.toISOString() : null,
              }))}
            />
          </aside>

          {/* MAIN — brief, journal, evidence */}
          <main style={{ minWidth: 0 }}>
            {/* Brief — the synthesis, the first thing the reader sees */}
            {dossier.brief ? (
              <Brief brief={dossier.brief} />
            ) : (
              <section className="section" style={{ marginTop: 0 }}>
                <div className="section-head">
                  <div className="ttl">
                    <Eyebrow>Le brief</Eyebrow>
                    <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
                  </div>
                </div>
                <div className="brief-empty">Synthèse en attente — lancez l&apos;assemblage.</div>
              </section>
            )}

            {/* Journal — dated "what's new" notes, newest first */}
            {updates.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <div className="ttl">
                    <Eyebrow>Journal</Eyebrow>
                    <h2 style={{ marginTop: '.1rem' }}>Mises à jour</h2>
                  </div>
                </div>
                <div className="journal">
                  {updates.map((u) => (
                    <div key={u.id} className="update fade">
                      <div className="when">{formatDateFr(new Date(u.createdAt))}</div>
                      <div className="body">
                        <Prose>{u.body}</Prose>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Sources & evidence — collapsed by default; by-source is the evidence lens (re-skinned in T5b) */}
            <details className="group mt-10 border-t border-[color:var(--color-border)] pt-6">
              <summary className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)] flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium transition-colors">
                <span className="transition-transform group-open:rotate-90" aria-hidden>
                  ▸
                </span>
                Sources et faits
                <span className="text-[color:var(--color-muted-foreground)]">({facts.length})</span>
              </summary>
              <div className="mt-6">
                <BySource dossier={dossier} facts={facts} />
              </div>
            </details>
          </main>
        </div>
      </div>
    </div>
  );
}
