import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listDossiers } from '@/lib/dossiers';
import { TopBar } from '@/components/topbar';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const dossiers = await listDossiers(session.user.id);
  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <h1 className="rise" style={{ fontSize: 'var(--t-h1)' }}>Diagnostics</h1>
        <p className="intent rise">Comprendre et calibrer la découverte.</p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {dossiers.map((d) => (
            <li key={d.id}><Link href={`/admin/${d.slug}`} style={{ color: 'var(--accent)' }}>{d.name}</Link></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
