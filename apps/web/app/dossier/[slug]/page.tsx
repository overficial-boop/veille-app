import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier, listSources, listFacts, listUpdates } from '@/lib/dossiers';
import { formatDateFr } from '@/components/templates/types';
import { Brief } from '@/components/brief';
import { Journal } from '@/components/journal';
import { CitationsProvider } from '@/components/citations-context';
import { BySource } from '@/components/templates/by-source';
import { DossierRuntime } from '@/components/dossier-runtime';
import { sourceTarget } from '@/lib/source-input';
import { TopBar } from '@/components/topbar';
import { StatusPill, Eyebrow } from '@/components/veille-ui';
import { buildCitationNumbers } from '@/lib/citations';

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
  const citations = buildCitationNumbers(dossier.brief, facts.map((f) => f.sourceUrl));
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
            <CitationsProvider>
              {/* Brief — the synthesis, the first thing the reader sees */}
              {dossier.brief ? (
                <Brief brief={dossier.brief} citations={citations} />
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
              <Journal
                entries={updates.map((u) => ({
                  id: u.id,
                  when: formatDateFr(new Date(u.createdAt)),
                  body: u.body,
                }))}
                citations={citations}
              />
            </CitationsProvider>

            {/* Sources & evidence — auditable evidence, grouped by publication */}
            <section className="evidence">
              <div className="section-head" style={{ maxWidth: 'none' }}>
                <div className="ttl">
                  <Eyebrow>Preuve auditable</Eyebrow>
                  <h2 style={{ marginTop: '.1rem' }}>Sources et faits</h2>
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-mono)',
                    color: 'var(--ink-3)',
                    letterSpacing: '.06em',
                  }}
                >
                  {facts.length} fait{facts.length !== 1 ? 's' : ''} ·{' '}
                  {new Set(facts.map((f) => f.sourceUrl.replace(/^https?:\/\//, '').split('/')[0])).size} publications
                </span>
              </div>
              <BySource dossier={dossier} facts={facts} citations={citations} />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
