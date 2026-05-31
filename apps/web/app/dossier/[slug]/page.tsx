import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getDossier, listSources, listFacts, listUpdates } from '@/lib/dossiers';
import { formatDateFr } from '@/components/templates/types';
import { Prose } from '@/components/prose';
import { Brief } from '@/components/brief';
import { BySource } from '@/components/templates/by-source';
import { DossierRuntime } from '@/components/dossier-runtime';
import { sourceTarget } from '@/lib/source-input';

export const dynamic = 'force-dynamic';

function statusFr(status: string): string {
  if (status === 'building') return 'En préparation';
  if (status === 'active') return 'Actif';
  return status;
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
    <main className="mx-auto max-w-3xl p-6 sm:p-10">
      <header className="border-b border-[color:var(--color-border)] pb-6">
        <Link
          href="/"
          className="text-[color:var(--color-muted-foreground)] text-sm transition-colors hover:text-[color:var(--color-foreground)]"
        >
          ← Tous les dossiers
        </Link>
        <h1 className="font-display mt-4 text-3xl leading-tight tracking-tight">{dossier.name}</h1>
        <p className="text-[color:var(--color-muted-foreground)] mt-2 text-base leading-relaxed">
          {dossier.intent}
        </p>
        <div className="text-[color:var(--color-muted-foreground)] mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span>{statusFr(dossier.status)}</span>
          <span aria-hidden>·</span>
          <span>
            {facts.length} {facts.length === 1 ? 'fait' : 'faits'}
          </span>
          {dossier.refreshedAt ? (
            <>
              <span aria-hidden>·</span>
              <span>Actualisé le {formatDateFr(new Date(dossier.refreshedAt))}</span>
            </>
          ) : null}
        </div>
      </header>

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

      {/* Brief — the synthesis, the first thing the reader sees */}
      {dossier.brief ? (
        <section className="mt-8 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-6 shadow-sm sm:p-8">
          <Brief brief={dossier.brief} />
        </section>
      ) : (
        <p className="text-[color:var(--color-muted-foreground)] mt-8 text-sm">
          Synthèse en attente — lancez l&apos;assemblage.
        </p>
      )}

      {/* Update log — dated "what's new" notes, newest first */}
      {updates.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-display text-foreground text-xl">Mises à jour</h2>
          <div className="mt-4 space-y-8">
            {updates.map((u) => (
              <article key={u.id}>
                <time
                  dateTime={new Date(u.createdAt).toISOString()}
                  className="text-[color:var(--color-muted-foreground)] text-xs"
                >
                  {formatDateFr(new Date(u.createdAt))}
                </time>
                <Prose className="text-[color:var(--color-foreground)] mt-1.5">{u.body}</Prose>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* Sources & evidence — collapsed by default; by-source is the evidence lens */}
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
  );
}
