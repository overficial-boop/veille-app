import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, setElaboration } from '@/lib/documents';
import { elaborate } from '@/lib/document/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string; docId: string }> }) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });
  const doc = await getDocument(dossier.id, docId);
  if (!doc) return new Response('not found', { status: 404 });
  if (!doc.review) return new Response('document not analyzed yet', { status: 409 });
  const body = await req.json().catch(() => ({} as { withTavily?: boolean }));
  const reviewMarkdown = (doc.review as { markdown: string }).markdown;
  const block = await elaborate({ review: reviewMarkdown, title: doc.title ?? doc.url, lang: dossier.language ?? 'fr', withTavily: !!body.withTavily });
  await setElaboration(docId, block);
  return Response.json(block);
}
