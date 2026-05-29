import { describe, it, expect } from 'vitest';
import { dossiers, sources, facts } from './app-schema';

describe('app schema', () => {
  it('exposes the three tables with their key columns', () => {
    expect(Object.keys(dossiers)).toEqual(
      expect.arrayContaining(['id', 'ownerId', 'intent', 'template', 'cadence', 'status']),
    );
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['id', 'dossierId', 'connector', 'kind', 'input', 'lastExtractedAt']),
    );
    expect(Object.keys(facts)).toEqual(
      expect.arrayContaining([
        'id', 'dossierId', 'sourceId', 'text', 'sourcePassage', 'provenance', 'extractedBy', 'confidence',
      ]),
    );
  });
});
