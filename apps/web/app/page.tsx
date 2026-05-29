import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listDossiers } from '@/lib/dossiers';
import { SignOutButton } from '@/components/sign-out-button';
import { NewDossierForm } from '@/components/new-dossier-form';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const TEMPLATE_LABELS: Record<string, string> = {
  profile: 'Profil',
  chronology: 'Chronologie',
  feed: 'Fil',
};

const STATUS_LABELS: Record<string, string> = {
  building: 'En préparation',
  active: 'Actif',
  idle: 'En veille',
};

function templateLabel(t: string) {
  return TEMPLATE_LABELS[t] ?? t;
}

function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s;
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const items = await listDossiers(session.user.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      {/* Header band */}
      <header className="flex items-baseline justify-between border-b pb-5">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Veille</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Vos dossiers vivants — {session.user.email}
          </p>
        </div>
        <SignOutButton />
      </header>

      {/* Primary action: new dossier */}
      <section className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl font-normal tracking-tight">
              Nouveau dossier
            </CardTitle>
            <CardDescription>
              Décrivez en une phrase ce que vous souhaitez suivre. Veille en compose le dossier.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewDossierForm />
          </CardContent>
        </Card>
      </section>

      {/* Dossier list */}
      <section className="mt-12">
        <h2 className="font-display text-lg tracking-tight">Vos dossiers</h2>
        {items.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">
            Votre premier dossier commence par une intention ci-dessus.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((d) => (
              <li key={d.id}>
                <a href={`/dossier/${d.slug}`} className="block">
                  <Card className="hover:border-foreground/20 hover:bg-accent/40 transition-colors">
                    <CardContent className="p-5">
                      <div className="flex items-baseline justify-between gap-4">
                        <h3 className="font-display truncate text-lg tracking-tight">{d.name}</h3>
                        <span className="text-muted-foreground shrink-0 text-xs uppercase tracking-wide">
                          {templateLabel(d.template)} · {statusLabel(d.status)}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">{d.intent}</p>
                    </CardContent>
                  </Card>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
