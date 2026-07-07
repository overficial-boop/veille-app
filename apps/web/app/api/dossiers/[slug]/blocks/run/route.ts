import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';
import { startJobWorker } from '@/lib/jobs/worker';

export const runtime = 'nodejs';

/** Enqueue a blocks run. Body: { instanceIds?: string[]; targetKeys?: string[] } (both optional). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  startJobWorker(); // idempotent — ensure the worker is running to pick up the job
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const instanceIds = Array.isArray(body.instanceIds) ? body.instanceIds.filter((x: unknown) => typeof x === 'string') : undefined;
  const targetKeys = Array.isArray(body.targetKeys) ? body.targetKeys.filter((x: unknown) => typeof x === 'string') : undefined;

  const { id, deduped } = await enqueueJob(dossier.id, 'blocks', { instanceIds, targetKeys });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
