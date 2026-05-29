import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listDossiers } from '@/lib/dossiers';
import { SignOutButton } from '@/components/sign-out-button';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const items = await listDossiers(session.user.id);

  return (
    <main className="mx-auto max-w-2xl p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vos dossiers</h1>
        <SignOutButton />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{session.user.email}</p>
      {items.length === 0 ? (
        <p className="mt-8 text-sm">
          Aucun dossier pour l&apos;instant. La création arrive en M1.
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {items.map((d) => (
            <li key={d.id} className="border-border rounded-md border p-3">
              {d.name}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
