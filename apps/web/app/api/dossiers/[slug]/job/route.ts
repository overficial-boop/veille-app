import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getActiveOrLatestJob } from '@/lib/jobs/store';
import { startJobWorker } from '@/lib/jobs/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Idempotently ensure the in-process worker is running. We start it from the job routes (rather
  // than instrumentation.ts) because Next does NOT apply serverExternalPackages to the instrumentation
  // bundle — pulling the engine (jsdom/pg) there fails to compile. nodejs route bundles externalize
  // them correctly. The client always polls this endpoint, so the worker is alive whenever work exists.
  startJobWorker();
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const job = await getActiveOrLatestJob(dossier.id);
  if (!job) return NextResponse.json({ job: null });
  return NextResponse.json({
    job: { id: job.id, type: job.type, status: job.status, progress: job.progress, error: job.error },
  });
}
