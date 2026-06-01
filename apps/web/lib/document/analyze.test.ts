import { describe, it, expect } from 'vitest';
import { firstSentences } from './analyze';

describe('firstSentences', () => {
  it('takes the first n sentences', () => {
    expect(firstSentences('Un. Deux. Trois.', 2)).toBe('Un. Deux.');
  });
  it('collapses whitespace and handles no terminal punctuation', () => {
    expect(firstSentences('  bloc\nsans\nponctuation  ', 2)).toBe('bloc sans ponctuation');
  });
});
