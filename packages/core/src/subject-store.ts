import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Subject } from './types.js';

export class SubjectNotFoundError extends Error {
  constructor(slug: string) {
    super(`Subject not found: ${slug}`);
    this.name = 'SubjectNotFoundError';
  }
}

export class SubjectAlreadyExistsError extends Error {
  constructor(slug: string) {
    super(`Subject already exists: ${slug}`);
    this.name = 'SubjectAlreadyExistsError';
  }
}

export class InvalidSlugError extends Error {
  constructor(input: string) {
    super(`Invalid subject name (could not slugify): ${input}`);
    this.name = 'InvalidSlugError';
  }
}

/** Resolve the on-disk directory for subject files. */
export function subjectStoreDir(): string {
  const override = process.env['VEILLE_SUBJECTS_DIR'];
  if (override !== undefined && override.length > 0) return path.resolve(override);
  return path.resolve(process.cwd(), '.veille', 'subjects');
}

/** Kebab-case slug from a free-form name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    // Strip diacritics: NFKD decomposes, then drop combining marks.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function subjectFilePath(slug: string): string {
  return path.join(subjectStoreDir(), `${slug}.json`);
}

export async function subjectExists(slug: string): Promise<boolean> {
  try {
    await fs.access(subjectFilePath(slug));
    return true;
  } catch {
    return false;
  }
}

export async function loadSubject(slug: string): Promise<Subject> {
  let raw: string;
  try {
    raw = await fs.readFile(subjectFilePath(slug), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SubjectNotFoundError(slug);
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as Subject;
  // Lenient migration for fields introduced after the initial subject schema.
  // Older subject files don't have these arrays; default to empty so callers
  // never have to null-check.
  if (!Array.isArray(parsed.discoveryTools)) parsed.discoveryTools = [];
  if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
  return parsed;
}

export async function saveSubject(subject: Subject): Promise<void> {
  const dir = subjectStoreDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${subject.slug}.json`);
  await fs.writeFile(file, JSON.stringify(subject, null, 2) + '\n', 'utf-8');
}

export async function deleteSubject(slug: string): Promise<void> {
  try {
    await fs.unlink(subjectFilePath(slug));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SubjectNotFoundError(slug);
    }
    throw err;
  }
}

export type SubjectSummary = {
  slug: string;
  name: string;
  description: string;
  language?: string;
  sourceCount: number;
  factCount: number;
  createdAt: string;
  refreshedAt: string;
};

export async function listSubjects(): Promise<SubjectSummary[]> {
  const dir = subjectStoreDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const summaries: SubjectSummary[] = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8');
      const s = JSON.parse(raw) as Subject;
      const summary: SubjectSummary = {
        slug: s.slug,
        name: s.name,
        description: s.description,
        sourceCount: s.sources.length,
        factCount: s.facts.length,
        createdAt: s.createdAt,
        refreshedAt: s.refreshedAt,
      };
      if (s.language !== undefined) summary.language = s.language;
      summaries.push(summary);
    } catch {
      // Skip files that aren't valid subjects (partial writes, junk).
    }
  }
  summaries.sort((a, b) => a.slug.localeCompare(b.slug));
  return summaries;
}
