import { eq, desc, and } from 'drizzle-orm';
import { uuidv7, slugify } from '@veille/core';
import type { Fact } from '@veille/core';
import type { DossierPlan } from '@veille/discovery';
import { db } from './db';
import { dossiers, sources, facts } from './db/schema';
import { factToRow } from './facts-map';

export async function listDossiers(ownerId: string) {
  return db
    .select()
    .from(dossiers)
    .where(eq(dossiers.ownerId, ownerId))
    .orderBy(desc(dossiers.createdAt));
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
