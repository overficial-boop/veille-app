import { describe, it, expect } from 'vitest';
import { sourcesForPhase } from './source-phase';

type Row = { id: string; kind: 'standing' | 'item'; purpose: 'state' | 'watch' };
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

const rows: Row[] = [
  { id: 'state1', kind: 'standing', purpose: 'state' },
  { id: 'state2', kind: 'standing', purpose: 'state' },
  { id: 'watch1', kind: 'standing', purpose: 'watch' },
  { id: 'item1', kind: 'item', purpose: 'state' },
];

describe('sourcesForPhase', () => {
  it('assemble → state standing + items (excludes watch standing)', () => {
    expect(ids(sourcesForPhase(rows, 'assemble'))).toEqual(['item1', 'state1', 'state2']);
  });

  it('refresh → watch standing + items (excludes state standing)', () => {
    expect(ids(sourcesForPhase(rows, 'refresh'))).toEqual(['item1', 'watch1']);
  });

  it('refresh with no watch standing → falls back to state standing + items', () => {
    const noWatch = rows.filter((r) => r.purpose !== 'watch');
    expect(ids(sourcesForPhase(noWatch, 'refresh'))).toEqual(['item1', 'state1', 'state2']);
  });

  it('refresh with no standing at all → just items', () => {
    const onlyItems = rows.filter((r) => r.kind === 'item');
    expect(ids(sourcesForPhase(onlyItems, 'refresh'))).toEqual(['item1']);
  });
});
