import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier, listSources, listFacts } from '@/lib/dossiers';
import { listDocumentsByStatus } from '@/lib/documents';
import { formatDateFr } from '@/components/templates/types';
import { Brief } from '@/components/brief';
import { CitationsProvider } from '@/components/citations-context';
import { DossierRuntime } from '@/components/dossier-runtime';
import { KeptFeed, SuggestionsTray, GenerateBriefCta } from '@/components/curation';
import { sourceTarget } from '@/lib/source-input';
import { TopBar } from '@/components/topbar';
import { StatusPill } from '@/components/veille-ui';
import { buildHostCitations, buildSourceRows } from '@/lib/citations';
import { hostOf } from '@/lib/host';
import { Sources } from '@/components/sources-list';

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
  const [sources, facts, { kept, suggestions }] = await Promise.all([
    listSources(dossier.id),
    listFacts(dossier.id),
    listDocumentsByStatus(dossier.id),
  ]);
  const factUrls = facts.map((f) => f.sourceUrl);
  const factHosts = [...new Set(factUrls.map(hostOf))];
  const hostNumbers = dossier.brief ? buildHostCitations(dossier.brief, factHosts) : {};
  const sourceRows = dossier.brief ? buildSourceRows(hostNumbers, factUrls, dossier.sourceNotes ?? {}) : [];
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
              hasBrief={Boolean(dossier.brief)}
              sources={sources.map((s) => ({
                id: s.id,
                connector: s.connector,
                kind: s.kind,
                purpose: s.purpose,
                label: s.label,
                source: s.input.source,
                target: sourceTarget(s.connector, s.input),
                lastExtractedAt: s.lastExtractedAt ? s.lastExtractedAt.toISOString() : null,
              }))}
            />
          </aside>

          {/* MAIN — one workspace: brief (or CTA), kept feed, suggestions, journal */}
          <main style={{ minWidth: 0 }}>
            {/* Brief — the synthesis (or the prompt to write one), at the top */}
            {dossier.brief ? (
              <CitationsProvider>
                <Brief brief={dossier.brief} hostNumbers={hostNumbers} />
                <Sources rows={sourceRows} />
              </CitationsProvider>
            ) : (
              <GenerateBriefCta slug={dossier.slug} />
            )}

            {/* Kept documents — the curated body of the dossier */}
            <KeptFeed slug={dossier.slug} documents={kept} />

            {/* Suggestions — lower-confidence candidates to triage (hidden if none) */}
            <SuggestionsTray slug={dossier.slug} documents={suggestions} />

          </main>
        </div>
      </div>
    </div>
  );
}
