import { eq, desc, and, count, inArray } from 'drizzle-orm';
import { uuidv7, slugify } from '@veille/core';
import type { Fact } from '@veille/core';
import type { DossierPlan } from '@veille/discovery';
import { db } from './db';
import { dossiers, sources, facts, dossierUpdates } from './db/schema';
import { factToRow } from './facts-map';
import { sourceTargetField, type SourceInput } from './source-input';
import { countPendingRebuild } from './temporal';

export async function listDossiers(ownerId: string) {
  const rows = await db
    .select()
    .from(dossiers)
    .where(eq(dossiers.ownerId, ownerId))
    .orderBy(desc(dossiers.createdAt));

  if (rows.length === 0) return [];

  // Fetch per-dossier fact counts in one query
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({ dossierId: facts.dossierId, factCount: count(facts.id) })
    .from(facts)
    .where(inArray(facts.dossierId, ids))
    .groupBy(facts.dossierId);

  const countMap = Object.fromEntries(counts.map((c) => [c.dossierId, c.factCount]));
  return rows.map((r) => ({ ...r, factCount: countMap[r.id] ?? 0 }));
}

export async function createDossier(ownerId: string, intent: string, plan: DossierPlan) {
  const id = uuidv7();
  const base = slugify(plan.subjectName) || 'dossier';
  // ensure unique slug per owner
  let slug = base;
  for (let n = 2; ; n++) {
    const clash = await db
      .select({ id: dossiers.id })
      .from(dossiers)
      .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug, slug)))
      .limit(1);
    if (clash.length === 0) break;
    slug = `${base}-${n}`;
  }
  await db.insert(dossiers).values({
    id,
    ownerId,
    name: plan.subjectName,
    intent,
    language: 'fr',
    template: plan.template,
    cadence: plan.cadence ?? null,
    status: 'building',
    slug,
  } as typeof dossiers.$inferInsert);
  await db.insert(sources).values(
    plan.sources.map((s) => ({
      id: uuidv7(),
      dossierId: id,
      connector: s.connector,
      kind: s.kind,
      input: s.input,
      label: s.label,
    })) as (typeof sources.$inferInsert)[],
  );
  return { id, slug };
}

export async function getDossier(ownerId: string, slug: string) {
  const [row] = await db
    .select()
    .from(dossiers)
    .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug, slug)))
    .limit(1);
  return row ?? null;
}

export async function listSources(dossierId: string) {
  return db.select().from(sources).where(eq(sources.dossierId, dossierId)).orderBy(sources.createdAt);
}

export async function listFacts(dossierId: string) {
  return db.select().from(facts).where(eq(facts.dossierId, dossierId)).orderBy(desc(facts.extractedAt));
}

export async function insertFacts(dossierId: string, sourceId: string, newFacts: Fact[]) {
  if (newFacts.length === 0) return;
  await db.insert(facts).values(newFacts.map((f) => factToRow(f, dossierId, sourceId)));
}

export async function setTemplate(ownerId: string, slug: string, template: string) {
  await db
    .update(dossiers)
    .set({ template })
    .where(and(eq(dossiers.ownerId, ownerId), eq(dossiers.slug, slug)));
}

type NewSource = {
  connector: string;
  kind: 'standing' | 'item';
  input: unknown;
  label?: string | null;
};

/** Owner-scoped: adds a source to the dossier identified by (ownerId, slug). Returns the new source id, or null if the dossier isn't the caller's. */
export async function addSource(ownerId: string, slug: string, source: NewSource): Promise<string | null> {
  const dossier = await getDossier(ownerId, slug);
  if (!dossier) return null;
  const id = uuidv7();
  await db.insert(sources).values({
    id,
    dossierId: dossier.id,
    connector: source.connector,
    kind: source.kind,
    input: source.input,
    label: source.label ?? null,
  } as typeof sources.$inferInsert);
  return id;
}

/** Owner-scoped: removes a source from the dossier identified by (ownerId, slug). */
export async function removeSource(ownerId: string, slug: string, sourceId: string): Promise<void> {
  const dossier = await getDossier(ownerId, slug);
  if (!dossier) return;
  await db.delete(sources).where(and(eq(sources.id, sourceId), eq(sources.dossierId, dossier.id)));
}

/** Owner-scoped: update a source's label and/or its target (the primary input value). */
export async function updateSource(
  ownerId: string,
  slug: string,
  sourceId: string,
  patch: { label?: string; target?: string },
): Promise<void> {
  const dossier = await getDossier(ownerId, slug);
  if (!dossier) return;
  const [row] = await db.select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.dossierId, dossier.id)));
  if (!row) return;
  const set: Partial<typeof sources.$inferInsert> = {};
  if (typeof patch.label === 'string') set.label = patch.label.trim() || null;
  if (typeof patch.target === 'string') {
    const field = sourceTargetField(row.connector);
    if (field) set.input = { ...(row.input as SourceInput), [field]: patch.target.trim() };
  }
  if (Object.keys(set).length === 0) return;
  await db.update(sources).set(set).where(and(eq(sources.id, sourceId), eq(sources.dossierId, dossier.id)));
}

/** Returns all updates for a dossier, newest first. */
export async function listUpdates(dossierId: string) {
  return db.select().from(dossierUpdates).where(eq(dossierUpdates.dossierId, dossierId)).orderBy(desc(dossierUpdates.createdAt));
}

/** Replaces the brief + source_notes wholesale (on-demand brief regeneration). Not a merge — see addUpdate. */
export async function setBrief(dossierId: string, brief: string, sourceNotes: Record<string, string>) {
  await db.update(dossiers).set({ brief, sourceNotes, briefGeneratedAt: new Date() }).where(eq(dossiers.id, dossierId));
}

/** Appends an update entry and merges newSourceNotes into dossiers.source_notes atomically. */
export async function addUpdate(
  dossierId: string,
  body: string,
  factCount: number,
  newSourceNotes: Record<string, string>,
  kind: 'actualite' | 'complement' = 'actualite',
) {
  await db.transaction(async (tx) => {
    await tx.insert(dossierUpdates).values({ id: uuidv7(), dossierId, body, factCount, kind });
    if (Object.keys(newSourceNotes).length > 0) {
      const [d] = await tx.select({ notes: dossiers.sourceNotes }).from(dossiers).where(eq(dossiers.id, dossierId));
      const merged = { ...(d?.notes ?? {}), ...newSourceNotes };
      await tx.update(dossiers).set({ sourceNotes: merged }).where(eq(dossiers.id, dossierId));
    }
  });
}

/** Derived count of older-than-brief facts found since the brief / last snooze (drives the rebuild banner). */
export async function pendingRebuildCount(dossierId: string): Promise<number> {
  const [d] = await db
    .select({ briefGeneratedAt: dossiers.briefGeneratedAt, dismissedAt: dossiers.briefSuggestionDismissedAt })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId));
  if (!d?.briefGeneratedAt) return 0;
  const rows = await db
    .select({ createdAt: facts.createdAt, provenance: facts.provenance })
    .from(facts)
    .where(eq(facts.dossierId, dossierId));
  return countPendingRebuild(rows, d.briefGeneratedAt, d.dismissedAt ?? null);
}

/** Owner-scoped: snooze the rebuild proposal (the banner returns when newer old facts arrive). */
export async function dismissBriefSuggestion(ownerId: string, slug: string): Promise<void> {
  const dossier = await getDossier(ownerId, slug);
  if (!dossier) return;
  await db.update(dossiers).set({ briefSuggestionDismissedAt: new Date() }).where(eq(dossiers.id, dossier.id));
}
