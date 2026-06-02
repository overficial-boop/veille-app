import { uuidv7, extractInput } from '@veille/core';
import { and, eq, isNull, ne, desc, sql } from 'drizzle-orm';
import { db } from './db';
import { documents, facts } from './db/schema';
import type { ReviewBlock, BulletsBlock, ElaborationBlock, FactChecksBlock, DocKind } from './document/types';
import { registerAllAdapters } from './adapters';

export async function upsertDocument(
  dossierId: string,
  m: { url: string; title?: string; siteName?: string; kind: DocKind; publishedAt?: Date | null; content?: string | null; status?: 'kept' | 'suggestion' | 'rejected'; relevance?: number | null; relevanceReason?: string | null },
): Promise<{ id: string; needsCore: boolean }> {
  const [existing] = await db
    .select({ id: documents.id, review: documents.review })
    .from(documents)
    .where(and(eq(documents.dossierId, dossierId), eq(documents.url, m.url)));
  if (existing) {
    await db
      .update(documents)
      .set({
        title: m.title,
        siteName: m.siteName,
        kind: m.kind,
        publishedAt: m.publishedAt ?? null,
        // only overwrite stored content when fresh content was captured (don't clobber on a contentless call)
        ...(m.content != null ? { content: m.content } : {}),
        // only overwrite status/relevance when provided
        ...(m.status != null ? { status: m.status } : {}),
        ...(m.relevance != null ? { relevance: m.relevance } : {}),
        ...(m.relevanceReason != null ? { relevanceReason: m.relevanceReason } : {}),
      })
      .where(eq(documents.id, existing.id));
    return { id: existing.id, needsCore: existing.review == null };
  }
  const id = uuidv7();
  await db.insert(documents).values({
    id,
    dossierId,
    url: m.url,
    title: m.title,
    siteName: m.siteName,
    kind: m.kind,
    publishedAt: m.publishedAt ?? null,
    content: m.content ?? null,
    status: m.status ?? 'kept',
    relevance: m.relevance ?? null,
    relevanceReason: m.relevanceReason ?? null,
  });
  return { id, needsCore: true };
}

export async function setDocumentCore(
  id: string,
  core: { shortSummary: string; review: ReviewBlock; bullets: BulletsBlock },
) {
  await db
    .update(documents)
    .set({
      shortSummary: core.shortSummary,
      review: core.review as unknown as Record<string, unknown>,
      bullets: core.bullets as unknown as Record<string, unknown>,
    })
    .where(eq(documents.id, id));
}

export async function setElaboration(id: string, block: ElaborationBlock) {
  await db
    .update(documents)
    .set({ elaboration: block as unknown as Record<string, unknown> })
    .where(eq(documents.id, id));
}

export async function setFactChecks(id: string, block: FactChecksBlock) {
  await db
    .update(documents)
    .set({ factChecks: block as unknown as Record<string, unknown> })
    .where(eq(documents.id, id));
}

export async function linkFacts(dossierId: string, documentId: string, url: string) {
  await db
    .update(facts)
    .set({ documentId })
    .where(and(eq(facts.dossierId, dossierId), eq(facts.sourceUrl, url), isNull(facts.documentId)));
}

export async function getDocument(dossierId: string, id: string) {
  const [d] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.dossierId, dossierId)));
  return d ?? null;
}

/**
 * The curated split for the workspace: every non-rejected document, partitioned by status.
 * Kept docs lead with the most relevant (relevance desc, NULLs last) then most recent;
 * suggestions order by relevance desc so the strongest candidates surface first.
 */
export async function listDocumentsByStatus(dossierId: string) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.dossierId, dossierId), ne(documents.status, 'rejected')))
    .orderBy(sql`${documents.relevance} desc nulls last`, desc(documents.createdAt));
  const kept = rows.filter((r) => r.status === 'kept');
  const suggestions = rows.filter((r) => r.status === 'suggestion');
  return { kept, suggestions };
}

export type Doc = Awaited<ReturnType<typeof listDocumentsByStatus>>['kept'][number];

/** Set a document's curation status (kept | suggestion | rejected). */
export async function setDocumentStatus(
  dossierId: string,
  docId: string,
  status: 'kept' | 'suggestion' | 'rejected',
) {
  await db
    .update(documents)
    .set({ status })
    .where(and(eq(documents.id, docId), eq(documents.dossierId, dossierId)));
}

export async function listFactsForDocument(documentId: string) {
  return db.select().from(facts).where(eq(facts.documentId, documentId));
}

/** Idempotently extract facts from a document's STORED content (no re-fetch), attribute them to
 *  the document's URL, insert + link them. Returns the fact count. */
export async function extractFactsForDocument(
  dossier: { id: string; name: string; intent: string; language: string | null },
  doc: { id: string; url: string; title: string | null; content: string | null },
): Promise<number> {
  const existing = await listFactsForDocument(doc.id);
  if (existing.length > 0) return existing.length;
  if (!doc.content) return 0;
  registerAllAdapters();
  const raw = await extractInput(
    { kind: 'text', content: doc.content, label: doc.title ?? doc.url },
    { language: dossier.language ?? 'fr', subjectHint: [dossier.name, dossier.intent].filter(Boolean).join(' — ') },
  );
  const docFacts = raw.map((f) => ({ ...f, sourceUrl: doc.url })); // text adapter doesn't know the URL
  const { insertFacts } = await import('./dossiers'); // lazy → avoid circular import
  await insertFacts(dossier.id, null, docFacts);
  await linkFacts(dossier.id, doc.id, doc.url);
  return docFacts.length;
}
