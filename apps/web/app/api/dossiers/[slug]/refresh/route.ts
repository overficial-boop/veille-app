import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { enqueueJob } from '@/lib/jobs/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const daysParam = Number(req.nextUrl.searchParams.get('days'));
  const recencyDays = Number.isFinite(daysParam) ? Math.min(60, Math.max(0, Math.floor(daysParam))) : 0;

  const { id, deduped } = await enqueueJob(dossier.id, 'refresh', { phase: 'refresh', recencyDays });
  return NextResponse.json({ jobId: id, deduped }, { status: 202 });
}
