import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { getDocument, listFactsForDocument } from '@/lib/documents';
import { formatDateFr } from '@/components/templates/types';
import { TopBar } from '@/components/topbar';
import { DocumentFiche } from '@/components/document-fiche';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string; docId: string }>;
}) {
  const { slug, docId } = await params;
  const session = await getSession();
  if (!session) redirect('/sign-in');

  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) notFound();

  const doc = await getDocument(dossier.id, docId);
  if (!doc) notFound();

  const factRows = await listFactsForDocument(docId);

  // Serialize to plain props for the client island (no Date objects)
  const facts = factRows.map((f) => ({
    id: f.id,
    text: f.text,
    sourcePassage: f.sourcePassage,
    confidence: f.confidence ?? null,
    sourceUrl: f.sourceUrl,
    extractedAt: f.extractedAt instanceof Date ? f.extractedAt.toISOString() : String(f.extractedAt),
  }));

  const publishedAt = doc.publishedAt instanceof Date ? doc.publishedAt.toISOString() : doc.publishedAt ? String(doc.publishedAt) : null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt);

  const displayDate = publishedAt ?? createdAt;

  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <Link href={`/dossier/${slug}?tab=documents`} className="back">
          <ArrowLeft />
          Documents
        </Link>

        <header className="dossier-head" style={{ paddingBottom: '1.2rem' }}>
          <h1 className="rise" style={{ fontSize: 'var(--t-h1)', maxWidth: '36ch', textWrap: 'balance' }}>
            {doc.title ?? doc.url}
          </h1>
          <div className="dossier-meta rise" style={{ marginTop: '.8rem' }}>
            {doc.siteName && <span>{doc.siteName}</span>}
            {doc.siteName && <span className="sep" />}
            <span>{formatDateFr(new Date(displayDate))}</span>
            <span className="sep" />
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '.3em', color: 'var(--accent)' }}
            >
              Source
              <ExternalLink style={{ width: 12, height: 12 }} />
            </a>
          </div>
        </header>

        <DocumentFiche
          document={{
            id: doc.id,
            url: doc.url,
            title: doc.title ?? null,
            siteName: doc.siteName ?? null,
            kind: (doc.kind as 'web' | 'youtube'),
            shortSummary: doc.shortSummary ?? null,
            review: doc.review as import('@/lib/document/types').ReviewBlock | null,
            bullets: doc.bullets as import('@/lib/document/types').BulletsBlock | null,
            elaboration: doc.elaboration as import('@/lib/document/types').ElaborationBlock | null,
            factChecks: doc.factChecks as import('@/lib/document/types').FactChecksBlock | null,
          }}
          canAnalyze={doc.content != null}
          facts={facts}
          slug={slug}
        />
      </div>
    </div>
  );
}
