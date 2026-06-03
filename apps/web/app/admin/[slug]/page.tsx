import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { listRefreshRuns } from '@/lib/refresh-runs';
import { TopBar } from '@/components/topbar';
import { DiagnosticsView } from '@/components/diagnostics-view';
import { getRefreshConfig } from '@/lib/refresh-config';

export const dynamic = 'force-dynamic';

export default async function AdminDossierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) notFound();
  const runs = await listRefreshRuns(dossier.id, 10);
  const cfg = getRefreshConfig();
  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <Link href="/admin" className="back"><ArrowLeft />Diagnostics</Link>
        <h1 className="rise" style={{ fontSize: 'var(--t-h1)' }}>{dossier.name}</h1>
        <DiagnosticsView
          slug={dossier.slug}
          runs={runs.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), params: r.params, counts: r.counts, funnel: r.funnel as object[] }))}
          defaults={{ recencyDays: 0, candidateScoreFloor: cfg.candidateScoreFloor, relevanceKeepFloor: cfg.relevanceKeepFloor }}
        />
      </div>
    </div>
  );
}
