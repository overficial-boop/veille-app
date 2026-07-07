import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';
import { startJobWorker } from '@/lib/jobs/worker';

export const runtime = 'nodejs';

/** Self-heal / manual start: ensure an assemble job exists for a still-building dossier. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  startJobWorker(); // idempotent — ensure the worker is running to pick up the job
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { id, deduped } = await enqueueJob(dossier.id, 'assemble', { phase: 'assemble', autoBrief: dossier.autoBrief });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
