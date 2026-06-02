import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { planDossier } from '@veille/discovery';
import { createDossier } from '@/lib/dossiers';
import { getRefreshConfig } from '@/lib/refresh-config';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { intent?: string; plan?: unknown };
  const intent = (body.intent ?? '').trim();
  if (!intent) return NextResponse.json({ error: 'intent required' }, { status: 400 });
  try {
    const plan = await planDossier({ intent, language: 'fr', maxQueries: getRefreshConfig().plannerMaxQueries });
    const { slug } = await createDossier(session.user.id, intent, plan);
    return NextResponse.json({ slug });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
