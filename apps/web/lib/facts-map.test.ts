import { describe, it, expect } from 'vitest';
import { factToRow } from './facts-map';
import type { Fact } from '@veille/core';

const fact: Fact = {
  id: 'f1', text: 't', sourceUrl: 'u', sourcePassage: 'p', language: 'fr',
  extractedAt: '2026-05-29T00:00:00.000Z', provenance: { a: 1 },
  extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' }, confidence: 0.9,
};

describe('factToRow', () => {
  it('maps a Fact onto the facts table columns', () => {
    const row = factToRow(fact, 'doss-1', 'src-1');
    expect(row).toMatchObject({
      id: 'f1', dossierId: 'doss-1', sourceId: 'src-1', sourceUrl: 'u', text: 't', sourcePassage: 'p',
      language: 'fr', provenance: { a: 1 }, extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' }, confidence: 0.9,
    });
    expect(row.extractedAt instanceof Date).toBe(true);
  });
});
