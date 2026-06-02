import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, setFactChecks, listFactsForDocument } from '@/lib/documents';
import { factCheck, mergeFactChecks } from '@/lib/document/analyze';
import type { FactChecksBlock } from '@/lib/document/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Verify all facts (no body) OR a single fact ({ factId }). The single-fact path re-checks just
// that fact and merges the result into the document's stored checks, so the per-fact "Vérifier"
// button and the "Vérifier tous les faits" button share one endpoint.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; docId: string }> }) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });
  const doc = await getDocument(dossier.id, docId);
  if (!doc) return new Response('not found', { status: 404 });
  const rows = await listFactsForDocument(docId);
  if (rows.length === 0) return new Response('no facts', { status: 409 });

  const body = (await req.json().catch(() => ({}))) as { factId?: string };
  const title = doc.title ?? doc.url;
  const lang = dossier.language ?? 'fr';

  if (body.factId) {
    const one = rows.find((f) => f.id === body.factId);
    if (!one) return new Response('fact not found', { status: 404 });
    const single = await factCheck([{ id: one.id, text: one.text }], title, lang);
    const merged = mergeFactChecks((doc.factChecks as FactChecksBlock | null) ?? null, single);
    await setFactChecks(docId, merged);
    return Response.json(merged);
  }

  const block = await factCheck(rows.map((f) => ({ id: f.id, text: f.text })), title, lang);
  await setFactChecks(docId, block);
  return Response.json(block);
}
