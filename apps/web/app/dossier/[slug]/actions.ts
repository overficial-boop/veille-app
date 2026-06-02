'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';
import { setTemplate, addSource, removeSource, getDossier, updateSource } from '@/lib/dossiers';
import { setDocumentStatus as setDocumentStatusDb } from '@/lib/documents';
import { composeDossier } from '@/lib/synthesis';
import { resolveYouTubeFeed, fetchFeedTitle, sourceSpecToRow, type AddSourceType, type SourceRow } from '@/lib/source-input';

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

export type AddSourceResult = { ok: true } | { ok: false; error: string };

/** web → single URL · search → Tavily query · rss → feed URL · youtube → channel (stored as its RSS feed). */
export async function addSourceAction(
  slug: string,
  spec: { type: AddSourceType; value: string },
): Promise<AddSourceResult> {
  const id = await ownerId();
  if (!id) return { ok: false, error: 'Non authentifié.' };
  const value = spec.value.trim();
  if (!value) return { ok: false, error: 'Entrée vide.' };

  let row: SourceRow;
  if (spec.type === 'rss') {
    const meta = await fetchFeedTitle(value);
    if (!meta.ok) return { ok: false, error: meta.error };
    row = sourceSpecToRow('rss', value, { feedUrl: value, label: meta.title });
  } else if (spec.type === 'youtube') {
    const res = await resolveYouTubeFeed(value);
    if ('error' in res) return { ok: false, error: res.error };
    row = sourceSpecToRow('youtube', value, { feedUrl: res.feedUrl, label: res.title });
  } else {
    row = sourceSpecToRow(spec.type, value);
  }

  await addSource(id, slug, row);
  revalidatePath(`/dossier/${slug}`);
  return { ok: true };
}

export async function removeSourceAction(slug: string, sourceId: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await removeSource(id, slug, sourceId);
  revalidatePath(`/dossier/${slug}`);
}

export async function updateSourceAction(
  slug: string,
  sourceId: string,
  patch: { label?: string; target?: string },
): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  await updateSource(id, slug, sourceId, patch);
  revalidatePath(`/dossier/${slug}`);
}

export async function regenerateBriefAction(slug: string): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const dossier = await getDossier(id, slug);
  if (!dossier) return;
  await composeDossier(dossier.id, { mode: 'brief', language: dossier.language ?? 'fr' });
  revalidatePath(`/dossier/${slug}`);
}

/** Owner-scoped curation: move a document between kept / suggestion / rejected. */
export async function setDocumentStatus(
  slug: string,
  docId: string,
  status: 'kept' | 'suggestion' | 'rejected',
): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const dossier = await getDossier(id, slug);
  if (!dossier) return;
  await setDocumentStatusDb(dossier.id, docId, status);
  revalidatePath(`/dossier/${slug}`);
}

export async function generateBriefAction(slug: string, scope?: string[]): Promise<void> {
  const id = await ownerId();
  if (!id) return;
  const dossier = await getDossier(id, slug);
  if (!dossier) return;
  await composeDossier(dossier.id, { mode: 'brief', language: dossier.language ?? 'fr', scope });
  revalidatePath(`/dossier/${slug}`);
}
