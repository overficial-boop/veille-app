import { describe, it, expect } from 'vitest';
import { attachFactCounts } from './fact-count';

describe('attachFactCounts', () => {
  it('attaches factCount per row from the count map, 0 when absent', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const out = attachFactCounts(rows, [{ documentId: 'a', n: 3 }, { documentId: null, n: 9 }]);
    expect(out).toEqual([{ id: 'a', factCount: 3 }, { id: 'b', factCount: 0 }]);
  });
});
