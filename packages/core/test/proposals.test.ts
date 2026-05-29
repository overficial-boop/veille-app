import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  addDiscoveryTool,
  addProposals,
  hideProposal,
  unhideProposal,
  acceptProposal,
  setProposalSummary,
  listDiscoveryTools,
  removeDiscoveryTool,
  createSubject,
  ProposalNotFoundError,
  DiscoveryToolNotFoundError,
  registerAdapter,
  resetAdapters,
} from '../src/index.js';
import { loadSubject } from '../src/subject-store.js';
import type { Adapter } from '../src/extract.js';

const fakeWebAdapter: Adapter = {
  name: 'web',
  matches: (input) => input.kind === 'url',
  extract: async () => [],
};

describe('discovery tools + proposals', () => {
  let tmpDir: string;
  const originalEnv = process.env['VEILLE_SUBJECTS_DIR'];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veille-prop-'));
    process.env['VEILLE_SUBJECTS_DIR'] = tmpDir;
    resetAdapters();
    registerAdapter(fakeWebAdapter);
    await createSubject({ name: 'Topic A' });
  });
  afterEach(async () => {
    if (originalEnv !== undefined) process.env['VEILLE_SUBJECTS_DIR'] = originalEnv;
    else delete process.env['VEILLE_SUBJECTS_DIR'];
    await fs.rm(tmpDir, { recursive: true, force: true });
    resetAdapters();
  });

  it('adds, lists, and removes discovery tools', async () => {
    const t1 = await addDiscoveryTool('topic-a', {
      kind: 'tavily',
      config: { query: 'pro padel' },
    });
    expect(t1.kind).toBe('tavily');
    expect(t1.id).toBeDefined();

    await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'https://x/feed' } });
    const tools = await listDiscoveryTools('topic-a');
    expect(tools).toHaveLength(2);

    await removeDiscoveryTool('topic-a', t1.id);
    expect((await listDiscoveryTools('topic-a'))).toHaveLength(1);
  });

  it('addProposals dedups against existing proposal URLs', async () => {
    const tool = await addDiscoveryTool('topic-a', {
      kind: 'rss',
      config: { feedUrl: 'https://x/feed' },
    });
    const first = await addProposals(
      'topic-a',
      [{ url: 'https://a/1' }, { url: 'https://a/2' }],
      tool.id,
    );
    expect(first.added).toHaveLength(2);
    expect(first.skippedDuplicates).toBe(0);

    const second = await addProposals(
      'topic-a',
      [{ url: 'https://a/2' }, { url: 'https://a/3' }],
      tool.id,
    );
    expect(second.added).toHaveLength(1);
    expect(second.skippedDuplicates).toBe(1);
    expect(second.added[0]!.url).toBe('https://a/3');
  });

  it('addProposals dedups against existing URL sources too', async () => {
    const { addSource } = await import('../src/operations.js');
    await addSource('topic-a', { kind: 'url', url: 'https://existing-source' });

    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const result = await addProposals(
      'topic-a',
      [{ url: 'https://existing-source' }, { url: 'https://new' }],
      tool.id,
    );
    expect(result.added).toHaveLength(1);
    expect(result.skippedDuplicates).toBe(1);
  });

  it('hide marks the proposal hidden with timestamp; unhide restores pending', async () => {
    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const { added } = await addProposals('topic-a', [{ url: 'https://a/1' }], tool.id);
    const p = added[0]!;

    const hidden = await hideProposal('topic-a', p.id);
    expect(hidden.status).toBe('hidden');
    expect(hidden.hiddenAt).toBeDefined();

    const back = await unhideProposal('topic-a', p.id);
    expect(back.status).toBe('pending');
    expect(back.hiddenAt).toBeUndefined();
  });

  it('hidden proposals still block re-proposing the same URL', async () => {
    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const { added } = await addProposals('topic-a', [{ url: 'https://a/1' }], tool.id);
    await hideProposal('topic-a', added[0]!.id);

    const next = await addProposals('topic-a', [{ url: 'https://a/1' }], tool.id);
    expect(next.added).toHaveLength(0);
    expect(next.skippedDuplicates).toBe(1);
  });

  it('accept creates a SourceConfig and links it via acceptedSourceId', async () => {
    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const { added } = await addProposals(
      'topic-a',
      [{ url: 'https://accept-me' }],
      tool.id,
    );

    const { proposal, source } = await acceptProposal('topic-a', added[0]!.id);
    expect(proposal.status).toBe('accepted');
    expect(proposal.acceptedSourceId).toBe(source.id);
    expect(source.adapter).toBe('web');
    expect(source.input).toEqual({ kind: 'url', url: 'https://accept-me' });

    const subject = await loadSubject('topic-a');
    expect(subject.sources).toHaveLength(1);
    expect(subject.sources[0]!.id).toBe(source.id);
  });

  it('summarize stores the summary string on the proposal', async () => {
    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const { added } = await addProposals('topic-a', [{ url: 'https://a/1' }], tool.id);
    const updated = await setProposalSummary('topic-a', added[0]!.id, 'A brief summary.');
    expect(updated.summary).toBe('A brief summary.');
  });

  it('proposal operations throw ProposalNotFoundError for unknown ids', async () => {
    await expect(hideProposal('topic-a', 'nope-id')).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
    await expect(acceptProposal('topic-a', 'nope-id')).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
  });

  it('removeDiscoveryTool throws DiscoveryToolNotFoundError for unknown ids', async () => {
    await expect(removeDiscoveryTool('topic-a', 'nope-id')).rejects.toBeInstanceOf(
      DiscoveryToolNotFoundError,
    );
  });

  it('accepts a proposal by id prefix (≥4 chars)', async () => {
    const tool = await addDiscoveryTool('topic-a', { kind: 'rss', config: { feedUrl: 'x' } });
    const { added } = await addProposals('topic-a', [{ url: 'https://a/1' }], tool.id);
    const prefix = added[0]!.id.slice(0, 8);
    const { proposal } = await acceptProposal('topic-a', prefix);
    expect(proposal.status).toBe('accepted');
  });
});
