import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  slugify,
  loadSubject,
  saveSubject,
  listSubjects,
  deleteSubject,
  subjectExists,
  subjectStoreDir,
  SubjectNotFoundError,
} from '../src/subject-store.js';
import type { Subject } from '../src/types.js';

const makeSubject = (overrides: Partial<Subject> = {}): Subject => ({
  id: 'subject-id',
  slug: 'test-subject',
  name: 'Test subject',
  description: 'For tests',
  sources: [],
  facts: [],
  discoveryTools: [],
  proposals: [],
  createdAt: '2026-05-14T00:00:00.000Z',
  refreshedAt: '2026-05-14T00:00:00.000Z',
  ...overrides,
});

describe('slugify', () => {
  it.each([
    ['Pro padel', 'pro-padel'],
    ['Hello, World!', 'hello-world'],
    ['  spaces  everywhere  ', 'spaces-everywhere'],
    ['CamelCase', 'camelcase'],
    ['multi    spaces', 'multi-spaces'],
    ['Unicode café résumé', 'unicode-cafe-resume'],
    ['---leading-and-trailing---', 'leading-and-trailing'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('subject-store', () => {
  let tmpDir: string;
  const originalEnv = process.env['VEILLE_SUBJECTS_DIR'];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veille-store-'));
    process.env['VEILLE_SUBJECTS_DIR'] = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) process.env['VEILLE_SUBJECTS_DIR'] = originalEnv;
    else delete process.env['VEILLE_SUBJECTS_DIR'];
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses the VEILLE_SUBJECTS_DIR override', () => {
    expect(subjectStoreDir()).toBe(path.resolve(tmpDir));
  });

  it('subjectExists is false before save, true after', async () => {
    expect(await subjectExists('test-subject')).toBe(false);
    await saveSubject(makeSubject());
    expect(await subjectExists('test-subject')).toBe(true);
  });

  it('round-trips all subject fields including new slug and lastExtractedAt', async () => {
    const subject = makeSubject({
      slug: 'round-trip',
      description: 'Some description',
      language: 'fr',
      sources: [
        {
          id: 'source-1',
          adapter: 'web',
          input: { kind: 'url', url: 'https://example.com/' },
          lastExtractedAt: '2026-05-14T12:00:00.000Z',
        },
      ],
    });
    await saveSubject(subject);
    const loaded = await loadSubject('round-trip');
    expect(loaded).toEqual(subject);
  });

  it('loadSubject throws SubjectNotFoundError for an unknown slug', async () => {
    await expect(loadSubject('does-not-exist')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it('listSubjects returns summaries without loading facts', async () => {
    const factful = makeSubject({
      slug: 'with-facts',
      name: 'Has facts',
      facts: [
        {
          id: 'f1',
          text: 'A claim',
          sourceUrl: 'https://x',
          sourcePassage: 'A claim from somewhere',
          language: 'en',
          extractedAt: '2026-05-14T00:00:00.000Z',
          provenance: {},
          extractedBy: { model: 'm', promptHash: 'h', adapter: 'web' },
        },
      ],
    });
    await saveSubject(factful);
    const summaries = await listSubjects();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      slug: 'with-facts',
      name: 'Has facts',
      sourceCount: 0,
      factCount: 1,
    });
    expect(summaries[0]).not.toHaveProperty('facts');
  });

  it('listSubjects sorts summaries by slug', async () => {
    await saveSubject(makeSubject({ slug: 'b-sub', name: 'B' }));
    await saveSubject(makeSubject({ slug: 'a-sub', name: 'A' }));
    const summaries = await listSubjects();
    expect(summaries.map((s) => s.slug)).toEqual(['a-sub', 'b-sub']);
  });

  it('listSubjects returns [] when the store dir does not exist', async () => {
    process.env['VEILLE_SUBJECTS_DIR'] = path.join(tmpDir, 'never-created');
    expect(await listSubjects()).toEqual([]);
  });

  it('deleteSubject removes the file', async () => {
    await saveSubject(makeSubject({ slug: 'to-delete' }));
    expect(await subjectExists('to-delete')).toBe(true);
    await deleteSubject('to-delete');
    expect(await subjectExists('to-delete')).toBe(false);
  });

  it('deleteSubject throws SubjectNotFoundError when missing', async () => {
    await expect(deleteSubject('nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});
