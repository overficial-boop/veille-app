import type { dossiers, facts } from '@/lib/db/schema';

export type DossierRow = typeof dossiers.$inferSelect;
export type FactRow = typeof facts.$inferSelect;
export type TemplateProps = { dossier: DossierRow; facts: FactRow[] };

/** Best display date for a fact: provenance.publishedAt if present, else extractedAt. */
export function factDate(f: FactRow): Date {
  const p = f.provenance as { publishedAt?: unknown } | null;
  if (p && typeof p.publishedAt === 'string') {
    const d = new Date(p.publishedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return f.extractedAt instanceof Date ? f.extractedAt : new Date(f.extractedAt);
}

/** "lemonde.fr" from a URL, for a compact source label. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatDateFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}
