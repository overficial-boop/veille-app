import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { listDossiers } from '@/lib/dossiers';
import { TopBar } from '@/components/topbar';
import { NewDossierForm } from '@/components/new-dossier-form';
import { StatusPill, Eyebrow } from '@/components/veille-ui';

const TEMPLATE_LABELS: Record<string, string> = {
  profile: 'Profil',
  chronology: 'Chronologie',
  feed: 'Fil',
};

function templateLabel(t: string) {
  return TEMPLATE_LABELS[t] ?? t;
}

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const items = await listDossiers(session.user.id);

  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page home">
        {/* Head band */}
        <div className="home-head rise">
          <div>
            <Eyebrow>Vos dossiers vivants</Eyebrow>
            <h1 style={{ marginTop: '.5rem' }}>Que souhaitez-vous suivre&nbsp;?</h1>
          </div>
          <div className="meta">
            Connecté·e en tant que <b>{session.user.email}</b>
          </div>
        </div>

        {/* Compose card */}
        <NewDossierForm />

        {/* Dossier list */}
        <div className="dossiers">
          <div className="dossiers-head">
            <h2>Vos dossiers</h2>
            <span className="count">
              {items.length} dossier{items.length !== 1 ? 's' : ''}
            </span>
          </div>

          {items.length === 0 ? (
            <div className="empty">
              Votre premier dossier commence par une intention ci-dessus.
            </div>
          ) : (
            <div className="dossier-grid">
              {items.map((d, i) => (
                <Link
                  key={d.id}
                  href={`/dossier/${d.slug}`}
                  className="dcard rise"
                  style={{ animationDelay: `${i * 0.04 + 0.12}s` }}
                >
                  <div className="meta-row">
                    <StatusPill status={d.status} />
                  </div>
                  <h3>{d.name}</h3>
                  <div className="intent">{d.intent}</div>
                  <div className="foot">
                    <span>{templateLabel(d.template)}</span>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--ink-3)', opacity: 0.5, flexShrink: 0 }} />
                    <span>{d.factCount > 0 ? `${d.factCount} faits` : '—'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
