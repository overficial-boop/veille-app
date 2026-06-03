import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { runDiscoveryProbe } from '@/lib/diagnostics-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  const dossier = await getDossier(session.user.id, body.slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const candidates = await runDiscoveryProbe(dossier.id);
  return NextResponse.json({ candidates });
}
