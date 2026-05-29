/**
 * Cross-surface operation logic for Subjects. The CLI and the web UI both
 * sit on top of these functions; each surface is responsible for adapter
 * registration, env validation, and UX (stderr lines for CLI, SSE messages
 * for web), but the underlying file-and-extraction work lives here.
 */
import { extractInput, findAdapter, UnsupportedInputError } from './extract.js';
import type { ExtractHints, ExtractInput } from './extract.js';
import { loadSubject, saveSubject, slugify, subjectExists } from './subject-store.js';
import { InvalidSlugError, SubjectAlreadyExistsError, SubjectNotFoundError } from './subject-store.js';
import type { CostInfo } from './pricing.js';
import type { Fact, SourceConfig, Subject } from './types.js';
import { v7 as uuidv7 } from 'uuid';

// ---------- createSubject ----------

export type CreateSubjectInput = {
  name: string;
  description?: string;
  language?: string;
};

export async function createSubject(input: CreateSubjectInput): Promise<Subject> {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) throw new InvalidSlugError(input.name);
  const slug = slugify(trimmedName);
  if (slug.length === 0) throw new InvalidSlugError(input.name);
  if (await subjectExists(slug)) throw new SubjectAlreadyExistsError(slug);
  const now = new Date().toISOString();
  const subject: Subject = {
    id: uuidv7(),
    slug,
    name: trimmedName,
    description: input.description ?? '',
    sources: [],
    facts: [],
    discoveryTools: [],
    proposals: [],
    createdAt: now,
    refreshedAt: now,
  };
  if (input.language !== undefined) subject.language = input.language;
  await saveSubject(subject);
  return subject;
}

// ---------- editSubject ----------

export type EditSubjectPatch = {
  name?: string;
  description?: string;
  /** Set to a string to update, to null to clear the language, omit to keep as-is. */
  language?: string | null;
};

/** Apply a patch to an existing Subject. Slug stays stable — renames are out
 *  of scope for v0.x. Empty/whitespace name in the patch is rejected. */
export async function editSubject(slug: string, patch: EditSubjectPatch): Promise<Subject> {
  const subject = await loadSubject(slug);
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) throw new InvalidSlugError(patch.name);
    subject.name = trimmed;
  }
  if (patch.description !== undefined) {
    subject.description = patch.description;
  }
  if (patch.language !== undefined) {
    if (patch.language === null || patch.language.trim().length === 0) {
      delete subject.language;
    } else {
      subject.language = patch.language;
    }
  }
  await saveSubject(subject);
  return subject;
}

// ---------- resolveSubject (helper) ----------

/** Accept a slug or a name (slugified) and return the canonical slug, or throw. */
export async function resolveSubjectSlug(subjectArg: string): Promise<string> {
  const candidates =
    subjectArg === slugify(subjectArg) ? [subjectArg] : [subjectArg, slugify(subjectArg)];
  for (const candidate of candidates) {
    if (await subjectExists(candidate)) return candidate;
  }
  throw new SubjectNotFoundError(subjectArg);
}

// ---------- addSource ----------

export async function addSource(slug: string, input: ExtractInput): Promise<SourceConfig> {
  const subject = await loadSubject(slug);
  // Dispatch through findAdapter for every input kind so the stored
  // SourceConfig.adapter reflects what'll actually handle extraction. Caller
  // must registerAllAdapters() before calling.
  const adapter = findAdapter(input);
  if (!adapter) throw new UnsupportedInputError(input);
  const source: SourceConfig = {
    id: uuidv7(),
    adapter: adapter.name,
    input,
  };
  subject.sources.push(source);
  await saveSubject(subject);
  return source;
}

// ---------- removeSource ----------

export async function removeSource(slug: string, sourceIdOrPrefix: string): Promise<SourceConfig> {
  if (sourceIdOrPrefix.length < 4) {
    throw new Error('Source id prefix must be at least 4 characters');
  }
  const subject = await loadSubject(slug);
  const matches = subject.sources.filter((s) => s.id.startsWith(sourceIdOrPrefix));
  if (matches.length === 0) {
    throw new Error(`No source matches "${sourceIdOrPrefix}" in subject ${slug}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous source prefix "${sourceIdOrPrefix}" — matches ${matches.length} sources`,
    );
  }
  const target = matches[0]!;
  subject.sources = subject.sources.filter((s) => s.id !== target.id);
  await saveSubject(subject);
  return target;
}

// ---------- runRefresh ----------

export type RefreshCallbacks = {
  /** Free-form progress messages (one per significant step). */
  onProgress?: (message: string) => void;
  /** Fires once per source that begins extraction. */
  onSourceStart?: (info: { index: number; total: number; source: SourceConfig }) => void;
  /** Fires once per source that finishes successfully, before facts are merged. */
  onSourceComplete?: (info: { source: SourceConfig; factCount: number }) => void;
  /** Fires once per source that fails. */
  onSourceFailed?: (info: { source: SourceConfig; error: Error }) => void;
  /** Fires once per source with its incremental cost. */
  onCost?: (cost: CostInfo) => void;
};

export type RefreshOptions = {
  force?: boolean;
  model?: string;
  subjectHint?: string;
  language?: string;
  /** If set, only sources whose id is in this list (or starts with one of these
   *  ≥4-char prefixes) are considered. Useful for per-source refresh from a UI. */
  sourceIds?: string[];
};

export type RefreshResult = {
  slug: string;
  totalSources: number;
  attempted: number;
  succeeded: number;
  failed: number;
  factsAdded: number;
  cost: CostInfo;
};

export class NoSourcesError extends Error {
  constructor(slug: string) {
    super(`Subject ${slug} has no sources`);
    this.name = 'NoSourcesError';
  }
}

export async function runRefresh(
  slug: string,
  callbacks: RefreshCallbacks = {},
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const subject = await loadSubject(slug);
  if (subject.sources.length === 0) throw new NoSourcesError(slug);

  const idFilter = options.sourceIds;
  const sourceMatchesFilter = (id: string): boolean => {
    if (!idFilter || idFilter.length === 0) return true;
    return idFilter.some((needle) => needle.length >= 4 && id.startsWith(needle));
  };
  const toExtract = subject.sources.filter(
    (s) =>
      sourceMatchesFilter(s.id) && (options.force || s.lastExtractedAt === undefined),
  );
  const totalCost: CostInfo = { model: '', inputTokens: 0, outputTokens: 0 };
  let factsAdded = 0;
  let failed = 0;

  for (let i = 0; i < toExtract.length; i++) {
    const source = toExtract[i]!;
    callbacks.onSourceStart?.({ index: i, total: toExtract.length, source });

    const hints: ExtractHints = {
      onCost: (cost) => {
        totalCost.inputTokens += cost.inputTokens;
        totalCost.outputTokens += cost.outputTokens;
        totalCost.model = cost.model;
        callbacks.onCost?.(cost);
      },
      withSummary: false,
    };
    if (callbacks.onProgress !== undefined) hints.onProgress = callbacks.onProgress;
    const effectiveHint = options.subjectHint ?? subject.description;
    if (effectiveHint.length > 0) hints.subjectHint = effectiveHint;
    const effectiveLang = options.language ?? subject.language;
    if (effectiveLang !== undefined) hints.language = effectiveLang;
    if (options.model !== undefined) hints.model = options.model;

    let facts: Fact[];
    try {
      facts = await extractInput(source.input, hints);
    } catch (err) {
      failed++;
      callbacks.onSourceFailed?.({
        source,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      continue;
    }

    subject.facts.push(...facts);
    factsAdded += facts.length;
    source.lastExtractedAt = new Date().toISOString();
    callbacks.onSourceComplete?.({ source, factCount: facts.length });
  }

  subject.refreshedAt = new Date().toISOString();
  await saveSubject(subject);

  const succeeded = toExtract.length - failed;
  return {
    slug,
    totalSources: subject.sources.length,
    attempted: toExtract.length,
    succeeded,
    failed,
    factsAdded,
    cost: totalCost,
  };
}

// ---------- deleteSubjectByArg ----------

/** Convenience wrapper that accepts slug-or-name, resolves it, and deletes. */
export async function deleteSubjectByArg(subjectArg: string): Promise<string> {
  const slug = await resolveSubjectSlug(subjectArg);
  const { deleteSubject } = await import('./subject-store.js');
  await deleteSubject(slug);
  return slug;
}

// ---------- Discovery tools and proposals (Phase 3) ----------

import type {
  DiscoveryTool,
  DiscoveryToolKind,
  Proposal,
  ProposalStatus,
  TavilyConfig,
  RssConfig,
  YouTubeChannelConfig,
} from './types.js';

export class ProposalNotFoundError extends Error {
  constructor(slug: string, idOrPrefix: string) {
    super(`No proposal matches "${idOrPrefix}" in subject ${slug}`);
    this.name = 'ProposalNotFoundError';
  }
}

export class DiscoveryToolNotFoundError extends Error {
  constructor(slug: string, idOrPrefix: string) {
    super(`No discovery tool matches "${idOrPrefix}" in subject ${slug}`);
    this.name = 'DiscoveryToolNotFoundError';
  }
}

export class ProposalAlreadyTriagedError extends Error {
  constructor(public readonly proposalId: string, public readonly currentStatus: ProposalStatus) {
    super(`Proposal ${proposalId} is already ${currentStatus}`);
    this.name = 'ProposalAlreadyTriagedError';
  }
}

export type AddDiscoveryToolInput =
  | { kind: 'tavily'; config: TavilyConfig }
  | { kind: 'rss'; config: RssConfig }
  | { kind: 'youtube-channel'; config: YouTubeChannelConfig };

export async function addDiscoveryTool(
  slug: string,
  input: AddDiscoveryToolInput,
): Promise<DiscoveryTool> {
  const subject = await loadSubject(slug);
  const tool: DiscoveryTool = {
    id: uuidv7(),
    kind: input.kind,
    config: input.config,
  } as DiscoveryTool;
  subject.discoveryTools.push(tool);
  await saveSubject(subject);
  return tool;
}

export async function listDiscoveryTools(slug: string): Promise<DiscoveryTool[]> {
  const subject = await loadSubject(slug);
  return subject.discoveryTools;
}

function resolveTool(subject: Subject, idOrPrefix: string): DiscoveryTool {
  if (idOrPrefix.length < 4) {
    throw new Error('Discovery tool id prefix must be at least 4 characters');
  }
  const matches = subject.discoveryTools.filter((t) => t.id.startsWith(idOrPrefix));
  if (matches.length === 0) throw new DiscoveryToolNotFoundError(subject.slug, idOrPrefix);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous tool prefix "${idOrPrefix}" — matches ${matches.length} tools in subject ${subject.slug}`,
    );
  }
  return matches[0]!;
}

export async function removeDiscoveryTool(slug: string, toolIdOrPrefix: string): Promise<DiscoveryTool> {
  const subject = await loadSubject(slug);
  const tool = resolveTool(subject, toolIdOrPrefix);
  subject.discoveryTools = subject.discoveryTools.filter((t) => t.id !== tool.id);
  await saveSubject(subject);
  return tool;
}

export async function markToolDiscovered(slug: string, toolId: string): Promise<void> {
  const subject = await loadSubject(slug);
  const tool = subject.discoveryTools.find((t) => t.id === toolId);
  if (!tool) throw new DiscoveryToolNotFoundError(slug, toolId);
  tool.lastDiscoveredAt = new Date().toISOString();
  await saveSubject(subject);
}

/** Patch a discovery tool's config in-place. Kind is immutable; the patch's
 *  config object replaces the existing one entirely (callers send the full
 *  config, not a partial diff). lastDiscoveredAt and schedule are untouched. */
export async function editDiscoveryTool(
  slug: string,
  toolIdOrPrefix: string,
  configPatch: TavilyConfig | RssConfig | YouTubeChannelConfig,
): Promise<DiscoveryTool> {
  const subject = await loadSubject(slug);
  const tool = resolveTool(subject, toolIdOrPrefix);
  (tool as { config: TavilyConfig | RssConfig | YouTubeChannelConfig }).config = configPatch;
  await saveSubject(subject);
  return tool;
}

// ----- Proposals -----

export type CandidateLike = {
  url: string;
  title?: string;
  publishedAt?: string;
  author?: string;
  siteName?: string;
  excerpt?: string;
};

export type AddProposalsResult = {
  added: Proposal[];
  skippedDuplicates: number;
};

/** Collect URLs the subject has already "expressed an opinion on" — anything
 *  that's already a proposal (any status) or an explicit URL source. New
 *  candidates whose URL is in this set are skipped to keep proposals deduped. */
function collectKnownUrls(subject: Subject): Set<string> {
  const known = new Set<string>();
  for (const p of subject.proposals) known.add(p.url);
  for (const s of subject.sources) {
    if (s.input.kind === 'url') known.add(s.input.url);
  }
  return known;
}

export async function addProposals(
  slug: string,
  candidates: CandidateLike[],
  toolId: string,
): Promise<AddProposalsResult> {
  const subject = await loadSubject(slug);
  const known = collectKnownUrls(subject);
  const now = new Date().toISOString();
  const added: Proposal[] = [];
  let skippedDuplicates = 0;
  for (const c of candidates) {
    if (known.has(c.url)) {
      skippedDuplicates++;
      continue;
    }
    known.add(c.url);
    const proposal: Proposal = {
      id: uuidv7(),
      toolId,
      url: c.url,
      discoveredAt: now,
      status: 'pending',
    };
    if (c.title) proposal.title = c.title;
    if (c.publishedAt) proposal.publishedAt = c.publishedAt;
    if (c.author) proposal.author = c.author;
    if (c.siteName) proposal.siteName = c.siteName;
    if (c.excerpt) proposal.excerpt = c.excerpt;
    subject.proposals.push(proposal);
    added.push(proposal);
  }
  await saveSubject(subject);
  return { added, skippedDuplicates };
}

function resolveProposal(subject: Subject, idOrPrefix: string): Proposal {
  if (idOrPrefix.length < 4) {
    throw new Error('Proposal id prefix must be at least 4 characters');
  }
  const matches = subject.proposals.filter((p) => p.id.startsWith(idOrPrefix));
  if (matches.length === 0) throw new ProposalNotFoundError(subject.slug, idOrPrefix);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous proposal prefix "${idOrPrefix}" — matches ${matches.length} proposals in subject ${subject.slug}`,
    );
  }
  return matches[0]!;
}

export async function hideProposal(slug: string, proposalIdOrPrefix: string): Promise<Proposal> {
  const subject = await loadSubject(slug);
  const proposal = resolveProposal(subject, proposalIdOrPrefix);
  proposal.status = 'hidden';
  proposal.hiddenAt = new Date().toISOString();
  await saveSubject(subject);
  return proposal;
}

export async function unhideProposal(slug: string, proposalIdOrPrefix: string): Promise<Proposal> {
  const subject = await loadSubject(slug);
  const proposal = resolveProposal(subject, proposalIdOrPrefix);
  proposal.status = 'pending';
  delete proposal.hiddenAt;
  await saveSubject(subject);
  return proposal;
}

export async function acceptProposal(
  slug: string,
  proposalIdOrPrefix: string,
): Promise<{ proposal: Proposal; source: SourceConfig }> {
  const subject = await loadSubject(slug);
  const proposal = resolveProposal(subject, proposalIdOrPrefix);
  if (proposal.status === 'accepted') {
    throw new ProposalAlreadyTriagedError(proposal.id, proposal.status);
  }

  // Build the source via findAdapter (caller must registerAllAdapters first).
  const input: ExtractInput = { kind: 'url', url: proposal.url };
  const adapter = findAdapter(input);
  if (!adapter) throw new UnsupportedInputError(input);
  const source: SourceConfig = {
    id: uuidv7(),
    adapter: adapter.name,
    input,
  };
  subject.sources.push(source);

  proposal.status = 'accepted';
  proposal.acceptedAt = new Date().toISOString();
  proposal.acceptedSourceId = source.id;
  delete proposal.hiddenAt;

  await saveSubject(subject);
  return { proposal, source };
}

export async function setProposalSummary(
  slug: string,
  proposalIdOrPrefix: string,
  summary: string,
): Promise<Proposal> {
  const subject = await loadSubject(slug);
  const proposal = resolveProposal(subject, proposalIdOrPrefix);
  proposal.summary = summary;
  await saveSubject(subject);
  return proposal;
}
