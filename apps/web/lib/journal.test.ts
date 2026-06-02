import { describe, it, expect } from 'vitest';
import { buildJournalGatePrompt, parseJournalSelection, journalTextsOf } from './journal';

describe('buildJournalGatePrompt', () => {
  const p = buildJournalGatePrompt({
    subject: 'Affaire X',
    brief: 'Le brief actuel.',
    journalTexts: ['Déjà connu A'],
    candidates: [{ id: 'f1', text: 'Nouveau fait 1' }, { id: 'f2', text: 'Nouveau fait 2' }],
    max: 5,
  });
  it('includes the subject, brief, journal, candidates, and the cap', () => {
    expect(p).toMatch(/Affaire X/);
    expect(p).toMatch(/Le brief actuel\./);
    expect(p).toMatch(/Déjà connu A/);
    expect(p).toMatch(/f1/);
    expect(p).toMatch(/Nouveau fait 2/);
    expect(p).toMatch(/\b5\b/);
  });
  it('asks for genuinely new developments, not restatements', () => {
    expect(p).toMatch(/new development|nouveau|not.*restate|already/i);
  });
});

describe('parseJournalSelection', () => {
  const ids = ['f1', 'f2', 'f3'];
  it('keeps only in-candidate ids, preserves order, attaches reason, caps at max', () => {
    const text = JSON.stringify({ keep: [
      { id: 'f2', reason: 'développement majeur' },
      { id: 'zzz', reason: 'hallucinated' },
      { id: 'f1', reason: 'inédit' },
    ] });
    expect(parseJournalSelection(text, ids, 5)).toEqual([
      { factId: 'f2', reason: 'développement majeur' },
      { factId: 'f1', reason: 'inédit' },
    ]);
  });
  it('dedups repeated ids and caps at max', () => {
    const text = JSON.stringify({ keep: [
      { id: 'f1', reason: 'a' }, { id: 'f1', reason: 'b' }, { id: 'f2', reason: 'c' }, { id: 'f3', reason: 'd' },
    ] });
    expect(parseJournalSelection(text, ids, 2)).toEqual([
      { factId: 'f1', reason: 'a' },
      { factId: 'f2', reason: 'c' },
    ]);
  });
  it('returns [] on garbage', () => {
    expect(parseJournalSelection('not json', ids, 5)).toEqual([]);
  });
});

describe('journalTextsOf', () => {
  it('maps entries to their text', () => {
    expect(journalTextsOf([{ text: 'a' }, { text: 'b' }])).toEqual(['a', 'b']);
  });
});
