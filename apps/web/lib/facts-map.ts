import type { Fact } from '@veille/core';
import type { facts } from './db/schema';

type FactRow = typeof facts.$inferInsert;

export function factToRow(fact: Fact, dossierId: string, sourceId: string | null): FactRow {
  return {
    id: fact.id,
    dossierId,
    sourceId,
    sourceUrl: fact.sourceUrl,
    text: fact.text,
    sourcePassage: fact.sourcePassage,
    language: fact.language,
    provenance: fact.provenance as object,
    extractedBy: fact.extractedBy,
    confidence: fact.confidence ?? null,
    extractedAt: new Date(fact.extractedAt),
  };
}
