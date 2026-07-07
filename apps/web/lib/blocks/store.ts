import { uuidv7 } from '@veille/core';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { blockInstances, blockOutputs, dossiers, facts, documents } from '../db/schema';
import { factPoolFingerprint } from './fingerprint';
import type { BlockLoaders } from './resolve';

export type BlockInstanceRow = typeof blockInstances.$inferSelect;
export type BlockOutputRow = typeof blockOutputs.$inferSelect;

/** Attach a block to a dossier (idempotent: re-attach returns the existing instance). */
export async function attachBlock(dossierId: string, blockId: string, scope: 'page' | 'item', position = 0): Promise<{ id: string; existed: boolean }> {
  const id = uuidv7();
  try {
    await db.insert(blockInstances).values({ id, dossierId, blockId, scope, position });
    return { id, existed: false };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      const [row] = await db.select({ id: blockInstances.id }).from(blockInstances)
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockInstances.scope, scope)));
      if (row) return { id: row.id, existed: true };
    }
    throw e;
  }
}

export async function detachBlock(instanceId: string): Promise<void> {
  await db.delete(blockInstances).where(eq(blockInstances.id, instanceId));
}

export async function listInstances(dossierId: string, ids?: string[]): Promise<BlockInstanceRow[]> {
  const where = ids?.length
    ? and(eq(blockInstances.dossierId, dossierId), inArray(blockInstances.id, ids))
    : eq(blockInstances.dossierId, dossierId);
  return db.select().from(blockInstances).where(where).orderBy(asc(blockInstances.position), asc(blockInstances.createdAt));
}

export async function listOutputs(dossierId: string): Promise<(BlockOutputRow & { blockId: string; scope: string })[]> {
  const rows = await db.select({
    o: blockOutputs, blockId: blockInstances.blockId, scope: blockInstances.scope,
  }).from(blockOutputs)
    .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
    .where(eq(blockInstances.dossierId, dossierId));
  return rows.map((r) => ({ ...r.o, blockId: r.blockId, scope: r.scope }));
}

/** Upsert the cached output for (instance, target). Regeneration clears the stale flag. */
export async function upsertOutput(a: { instanceId: string; targetKey: string; content: string; citations: { factId?: string; url: string }[]; fingerprint: string }): Promise<void> {
  await db.insert(blockOutputs)
    .values({ id: uuidv7(), ...a, stale: false, generatedAt: new Date() })
    .onConflictDoUpdate({
      target: [blockOutputs.instanceId, blockOutputs.targetKey],
      set: { content: a.content, citations: a.citations, fingerprint: a.fingerprint, stale: false, generatedAt: new Date() },
    });
}

/** Refresh landed: every cached output of the dossier may now be outdated. Visible, never silent. */
export async function markStaleForDossier(dossierId: string): Promise<number> {
  const ids = (await listInstances(dossierId)).map((i) => i.id);
  if (!ids.length) return 0;
  const res = await db.update(blockOutputs).set({ stale: true })
    .where(inArray(blockOutputs.instanceId, ids)).returning({ id: blockOutputs.id });
  return res.length;
}

/** Fingerprint matched after a stale-marking refresh: the output is provably fresh — clear the flag. */
export async function clearStaleOutput(instanceId: string, targetKey: string): Promise<void> {
  await db.update(blockOutputs).set({ stale: false })
    .where(and(eq(blockOutputs.instanceId, instanceId), eq(blockOutputs.targetKey, targetKey)));
}

/** Production BlockLoaders bound to the real DB (the resolver stays pure; this is its only impure binding).
 *  Scoped to a single dossier: the document loader must never resolve a foreign-dossier document id. */
export function dbLoaders(dossierId: string): BlockLoaders {
  return {
    async factPool(dossierId) {
      const [d] = await db.select({ refreshedAt: dossiers.refreshedAt }).from(dossiers).where(eq(dossiers.id, dossierId));
      const rows = await db.select({ id: facts.id, text: facts.text, sourceUrl: facts.sourceUrl, sourcePassage: facts.sourcePassage })
        .from(facts).where(eq(facts.dossierId, dossierId));
      return { facts: rows, version: factPoolFingerprint(d?.refreshedAt?.toISOString() ?? null, rows.length) };
    },
    async document(documentId) {
      // Scoped by dossierId (from the closure), not just id: a foreign document id must resolve to
      // null (recorded as a miss upstream) rather than leak another tenant's document content.
      const [doc] = await db.select({
        content: documents.content, title: documents.title, url: documents.url,
        siteName: documents.siteName, publishedAt: documents.publishedAt,
      }).from(documents).where(and(eq(documents.id, documentId), eq(documents.dossierId, dossierId)));
      return doc ? { ...doc, title: doc.title ?? '', siteName: doc.siteName ?? undefined } : null;
    },
    // At most one row can match: page instances only write targetKey='page', item instances only
    // write document-id targetKeys (enforced by runBlocksJob's targetKey assignment, not the DB).
    async cachedOutput(dossierId, blockId, targetKey) {
      const [row] = await db.select({ content: blockOutputs.content, fingerprint: blockOutputs.fingerprint })
        .from(blockOutputs)
        .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockOutputs.targetKey, targetKey)));
      return row ?? null;
    },
    async allOutputs(dossierId, blockId) {
      const rows = await db.select({ targetKey: blockOutputs.targetKey, content: blockOutputs.content })
        .from(blockOutputs)
        .innerJoin(blockInstances, eq(blockOutputs.instanceId, blockInstances.id))
        .where(and(eq(blockInstances.dossierId, dossierId), eq(blockInstances.blockId, blockId), eq(blockOutputs.stale, false)));
      return rows.filter((r) => r.targetKey !== 'page');
    },
    // Scoped by dossierId (from the closure), same cross-tenant rule as the document loader.
    async itemFacts(documentId) {
      const rows = await db.select({ id: facts.id, text: facts.text, sourceUrl: facts.sourceUrl, sourcePassage: facts.sourcePassage })
        .from(facts).where(and(eq(facts.documentId, documentId), eq(facts.dossierId, dossierId)));
      return { facts: rows };
    },
  };
}
