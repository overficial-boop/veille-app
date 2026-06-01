import { uuidv7 } from '@veille/core';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { documents, facts } from './db/schema';
import type { ReviewBlock, BulletsBlock, ElaborationBlock, FactChecksBlock, DocKind } from './document/types';

export async function upsertDocument(
  dossierId: string,
  m: { url: string; title?: string; siteName?: string; kind: DocKind; publishedAt?: Date | null },
): Promise<{ id: string; needsCore: boolean }> {
  const [existing] = await db
    .select({ id: documents.id, review: documents.review })
    .from(documents)
    .where(and(eq(documents.dossierId, dossierId), eq(documents.url, m.url)));
  if (existing) {
    await db
      .update(documents)
      .set({ title: m.title, siteName: m.siteName, kind: m.kind, publishedAt: m.publishedAt ?? null })
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

export async function listDocuments(dossierId: string) {
  return db
    .select()
    .from(documents)
    .where(eq(documents.dossierId, dossierId))
    .orderBy(documents.createdAt);
}

export async function getDocument(dossierId: string, id: string) {
  const [d] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.dossierId, dossierId)));
  return d ?? null;
}

export async function listFactsForDocument(documentId: string) {
  return db.select().from(facts).where(eq(facts.documentId, documentId));
}
