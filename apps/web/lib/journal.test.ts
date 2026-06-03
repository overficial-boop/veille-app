import { describe, it, expect } from 'vitest';
import { buildJournalGatePrompt, parseJournalSelection, journalTextsOf, groupJournalByDocument } from './journal';

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

describe('groupJournalByDocument', () => {
  const d = new Date('2026-06-03T10:00:00Z');
  const e = (id: string, documentId: string | null, sourceUrl: string, title: string | null, siteName: string | null) =>
    ({ id, text: 't' + id, sourceUrl, documentId, title, siteName, journalAt: d });
  it('groups by documentId, preserves order, uses title/host, carries latestAt', () => {
    const groups = groupJournalByDocument([
      e('1', 'docA', 'https://lemonde.fr/a', 'Titre A', 'lemonde.fr'),
      e('2', 'docA', 'https://lemonde.fr/a', 'Titre A', 'lemonde.fr'),
      e('3', 'docB', 'https://rtl.fr/b', null, 'rtl.fr'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.documentId).toBe('docA');
    expect(groups[0]!.title).toBe('Titre A');
    expect(groups[0]!.facts.map((f) => f.id)).toEqual(['1', '2']);
    expect(groups[0]!.latestAt).toEqual(d);
    expect(groups[1]!.title).toBe('rtl.fr'); // no title → host
  });
  it('falls back to sourceUrl as the key when documentId is null', () => {
    const groups = groupJournalByDocument([e('1', null, 'https://x.fr/a', null, null)]);
    expect(groups[0]!.key).toBe('https://x.fr/a');
    expect(groups[0]!.title).toBe('x.fr');
  });
});
