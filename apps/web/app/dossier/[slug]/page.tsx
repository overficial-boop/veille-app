import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getDossier, listSources, listFacts } from '@/lib/dossiers';
import { TEMPLATES, resolveTemplate } from '@/components/templates/registry';
import { formatDateFr } from '@/components/templates/types';
import { DossierRuntime } from '@/components/dossier-runtime';

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
  const [sources, facts] = await Promise.all([listSources(dossier.id), listFacts(dossier.id)]);
  const key = resolveTemplate(dossier.template);
  const { Component } = TEMPLATES[key];

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
        template={key}
        factCount={facts.length}
        sources={sources.map((s) => ({
          id: s.id,
          connector: s.connector,
          kind: s.kind,
          label: s.label,
        }))}
      />

      <div className="mt-8">
        <Component dossier={dossier} facts={facts} />
      </div>
    </main>
  );
}
