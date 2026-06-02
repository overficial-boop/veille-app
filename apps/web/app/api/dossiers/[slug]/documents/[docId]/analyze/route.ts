import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, ensureDocumentCore } from '@/lib/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// On-demand review + bullets for a document. The assemble no longer analyzes documents inline
// (it just stores the raw content); this generates the review/bullets the first time a document
// is opened. Idempotent: returns the existing core if already analyzed.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string; docId: string }> }) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });
  const doc = await getDocument(dossier.id, docId);
  if (!doc) return new Response('not found', { status: 404 });
  if (!doc.review && !doc.content) return new Response('no stored content to analyze', { status: 409 });
  await ensureDocumentCore({ id: dossier.id, language: dossier.language }, doc);
  const fresh = await getDocument(dossier.id, docId);
  return Response.json({ shortSummary: fresh?.shortSummary, review: fresh?.review, bullets: fresh?.bullets });
}
