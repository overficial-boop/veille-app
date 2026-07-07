import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { listBlocks, getBlock, hiddenPrereqIds } from '@/lib/blocks';
import { attachBlock, listInstances, listOutputs } from '@/lib/blocks/store';

export const runtime = 'nodejs';

/** The dossier's block state: attached instances, cached outputs, and the available library. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const [instances, outputs] = await Promise.all([listInstances(dossier.id), listOutputs(dossier.id)]);
  const library = listBlocks().filter((b) => !b.hidden).map((b) => ({ id: b.id, name: b.name, scope: b.scope, staleness: b.staleness }));
  return NextResponse.json({ instances, outputs, library });
}

/** Attach a block: { blockId, scope } → instance (idempotent). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const blockId = typeof body.blockId === 'string' ? body.blockId : '';
  const scope = body.scope === 'page' || body.scope === 'item' ? body.scope : null;
  const def = getBlock(blockId);
  if (!def || !scope) return NextResponse.json({ error: 'blockId et scope requis' }, { status: 400 });
  if (def.scope !== 'both' && def.scope !== scope)
    return NextResponse.json({ error: `le bloc « ${def.name} » ne supporte pas la portée ${scope}` }, { status: 400 });

  const { id, existed } = await attachBlock(dossier.id, blockId, scope);
  for (const hiddenId of hiddenPrereqIds(def)) await attachBlock(dossier.id, hiddenId, scope);
  return NextResponse.json({ instanceId: id, existed }, { status: existed ? 200 : 201 });
}
