import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, setDocumentCore } from '@/lib/documents';
import { analyzeDocumentCore } from '@/lib/document/analyze';

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
  if (doc.review) {
    return Response.json({ shortSummary: doc.shortSummary, review: doc.review, bullets: doc.bullets });
  }
  if (!doc.content) return new Response('no stored content to analyze', { status: 409 });
  const core = await analyzeDocumentCore({
    content: doc.content,
    title: doc.title ?? doc.url,
    siteName: doc.siteName ?? undefined,
    lang: dossier.language ?? 'fr',
  });
  await setDocumentCore(docId, core);
  return Response.json(core);
}
