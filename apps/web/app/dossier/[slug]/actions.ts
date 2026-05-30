'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { setTemplate, addSource, removeSource, getDossier } from '@/lib/dossiers';
import { composeDossier } from '@/lib/synthesis';

async function ownerId(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ?? null;
}

export async function setTemplateAction(slug: string, template: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await setTemplate(id, slug, template);
  revalidatePath(`/dossier/${slug}`);
}

/** kind 'item' → a single web URL; kind 'standing' → a Tavily search query. */
export async function addSourceAction(
  slug: string,
  spec: { kind: 'item' | 'standing'; value: string },
): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const value = spec.value.trim();
  if (!value) return;
  const source =
    spec.kind === 'item'
      ? { connector: 'web', kind: 'item' as const, input: { url: value }, label: value }
      : { connector: 'tavily', kind: 'standing' as const, input: { query: value }, label: value };
  await addSource(id, slug, source);
  revalidatePath(`/dossier/${slug}`);
}

export async function removeSourceAction(slug: string, sourceId: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await removeSource(id, slug, sourceId);
  revalidatePath(`/dossier/${slug}`);
}

export async function regenerateBriefAction(slug: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const dossier = await getDossier(id, slug);
  if (!dossier) return;
  await composeDossier(dossier.id, { mode: 'brief' });
  revalidatePath(`/dossier/${slug}`);
}
