# Verso Stage 1 — Plan 2a: Item-Analysis Bundle & Extraction Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One hidden `item-analysis` bundle block (single holistic LLM call, structured JSON, numbered-fact citations) + eight visible zero-LLM extraction blocks, per the approved spec `docs/superpowers/specs/2026-07-07-verso-stage1-plan2a-item-catalog-design.md`.

**Architecture:** New `item-facts` primitive and `hidden` flag in the engine; a bundle generator using the LLM client's `jsonSchema` mode (Gemini-style uppercase schema, see `lib/journal.ts:49`); an extraction-block factory; `exec-summary` re-pointed to extraction; `tldr` untouched.

**Tech Stack:** unchanged (TS strict, Drizzle, Vitest, `selectLlmClient` from `@veille/core`).

**Conventions:** as Plan 1 (uuidv7, colocated tests, `pnpm vitest run <path>` from repo root, apps/web has its own `pnpm typecheck`, French user-facing strings, raw language codes in prompts, commits from repo root).

**File map:**

| File | Change |
|---|---|
| `apps/web/lib/blocks/types.ts` | modify: `BlockInput` += item-facts; `ResolvedInputs` += itemFacts; `BlockDef` += `hidden?` |
| `apps/web/lib/blocks/registry.ts` | modify: validate item-facts scope |
| `apps/web/lib/blocks/resolve.ts` | modify: item-facts case + `BlockLoaders.itemFacts` |
| `apps/web/lib/blocks/store.ts` | modify: `itemFacts` loader in `dbLoaders` |
| `apps/web/app/api/dossiers/[slug]/blocks/route.ts` | modify: filter `hidden` from library |
| `apps/web/lib/blocks/generators/item-analysis.ts` | create: bundle generator |
| `apps/web/lib/blocks/generators/extract.ts` | create: extraction factory + 7 blocks |
| `apps/web/lib/blocks/generators/exec-summary.ts` | rewrite: extraction via factory |
| `apps/web/lib/blocks/index.ts` | modify: register bundle + extractions |
| colocated `*.test.ts` | per task |

---

### Task 0: Branch

- [ ] `cd D:\Projects\CODING\veille-app && git switch main && git pull --ff-only origin main && git switch -c feat/stage1-plan2a-item-catalog`

---

### Task 1: Engine — `item-facts` primitive + `hidden` flag

**Files:** modify `types.ts`, `registry.ts`, `resolve.ts`, `store.ts`, blocks route; tests: extend `registry.test.ts`, `resolve.test.ts` (and fix loader stubs in them + `run.test.ts` if needed).

- [ ] **Step 1: types.ts** — add to the `BlockInput` union: `| { kind: 'item-facts' }` (comment: `// item scope only — the target document's facts`). Add to `ResolvedInputs`: `itemFacts?: { facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[] };`. Add to `BlockDef` after `staleness`: `hidden?: boolean; // internal blocks (e.g. bundles) — excluded from the user-facing library`.

- [ ] **Step 2: failing tests.** In `registry.test.ts` add:

```ts
  it('validate: item-facts only on item-capable blocks', () => {
    registerBlock(def({ id: 'p', scope: 'page', prerequisites: [{ kind: 'item-facts' }] }));
    expect(validateRegistry().some((e) => /item-facts/.test(e))).toBe(true);
  });
```

In `resolve.test.ts`, extend the `loaders` helper with `itemFacts: async () => ({ facts: [{ id: 'f1', text: 't', sourceUrl: 'u', sourcePassage: 'p' }] }),` and add:

```ts
  it('resolves item-facts for an item target and reports missing on page target', async () => {
    const d = def({ id: 'a', prerequisites: [{ kind: 'item-facts' }] });
    const r = await resolveInputs(d, { dossierId: 'D', documentId: 'doc1' }, loaders());
    if ('missing' in r) throw new Error('should resolve');
    expect(r.inputs.itemFacts?.facts).toHaveLength(1);
    const p = await resolveInputs(d, { dossierId: 'D' }, loaders());
    expect(p).toEqual({ missing: expect.stringContaining('item-facts') });
  });
```

Run both files → expect FAIL (type errors / missing case).

- [ ] **Step 3: registry.ts** — in `validateRegistry`, extend the item-primitive check: `if ((p.kind === 'raw-content' || p.kind === 'item-metadata' || p.kind === 'item-facts') && !canRun(def, 'item')) errors.push(\`block "${def.id}": ${p.kind} requires item scope\`);` (replace the existing two-kind condition).

- [ ] **Step 4: resolve.ts** — add to `BlockLoaders`: `itemFacts: (documentId: string) => Promise<{ facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[] }>;`. In `resolveInputs`, add a case before the `block` case:

```ts
    } else if (p.kind === 'item-facts') {
      if (!target.documentId) return { missing: 'item-facts requires an item target' };
      const { facts } = await loaders.itemFacts(target.documentId);
      inputs.itemFacts = { facts };
      prints.push(contentFingerprint(facts.map((f) => f.id).join(',')));
```

- [ ] **Step 5: store.ts** — in `dbLoaders(dossierId)`, add:

```ts
    async itemFacts(documentId) {
      const rows = await db.select({ id: facts.id, text: facts.text, sourceUrl: facts.sourceUrl, sourcePassage: facts.sourcePassage })
        .from(facts).where(and(eq(facts.documentId, documentId), eq(facts.dossierId, dossierId)));
      return { facts: rows };
    },
```

(Note: dossier-scoped like the document loader — same cross-tenant rule.)

- [ ] **Step 6: blocks route** — library listing becomes `listBlocks().filter((b) => !b.hidden).map(...)`.

- [ ] **Step 7:** update any other loader stubs that now miss `itemFacts` (search tests for `BlockLoaders`). Run `pnpm vitest run apps/web/lib/blocks` → all green (registry 8, resolve 11, others unchanged). `cd apps/web && pnpm typecheck` → clean.

- [ ] **Step 8: Commit** — `feat(blocks): item-facts primitive + hidden flag`

---

### Task 2: Bundle generator — `item-analysis`

**Files:** create `apps/web/lib/blocks/generators/item-analysis.ts` + test.

- [ ] **Step 1: failing test**

```ts
// apps/web/lib/blocks/generators/item-analysis.test.ts
import { describe, it, expect } from 'vitest';
import { buildItemAnalysisPrompt, parseBundle, SECTION_KEYS, itemAnalysisBlock, CONTENT_CAP } from './item-analysis';

const args = {
  title: 'Rome Final', url: 'https://yt/x', content: 'transcript here', language: 'fr',
  facts: [{ id: 'f-1', text: 'Galán won', sourceUrl: 'https://yt/x', sourcePassage: 'passage' }],
};

describe('item-analysis', () => {
  it('prompt numbers facts and embeds metadata, content, language', () => {
    const p = buildItemAnalysisPrompt(args);
    expect(p).toContain('Rome Final');
    expect(p).toContain('transcript here');
    expect(p).toMatch(/\bfr\b/);
    expect(p).toMatch(/\[1\]|^1\./m); // fact numbered 1
    expect(p).toContain('Galán won');
    expect(p).not.toContain('f-1'); // raw fact ids never reach the model
  });

  it('caps long content', () => {
    const p = buildItemAnalysisPrompt({ ...args, content: 'x'.repeat(CONTENT_CAP + 5000) });
    expect(p.length).toBeLessThan(CONTENT_CAP + 3000);
  });

  it('declares hidden item scope with raw-content + item-metadata + item-facts', () => {
    expect(itemAnalysisBlock.hidden).toBe(true);
    expect(itemAnalysisBlock.scope).toBe('item');
    expect(itemAnalysisBlock.prerequisites).toEqual([
      { kind: 'raw-content' }, { kind: 'item-metadata' }, { kind: 'item-facts' },
    ]);
  });

  it('parseBundle returns sections and refs, and throws on invalid JSON', () => {
    const good = JSON.stringify({
      executive_summary: 'sum [1]', key_themes: '- t', detailed_breakdown: 'd', arguments_evidence: 'a',
      notable_quotes: 'q', strengths_weaknesses: 's', actionable_takeaways: 'act', open_questions: 'o',
      refs: [{ n: 1, factId: 'f-1', url: 'https://yt/x' }],
    });
    const b = parseBundle(good);
    expect(b.sections.executive_summary).toBe('sum [1]');
    expect(b.refs).toEqual([{ n: 1, factId: 'f-1', url: 'https://yt/x' }]);
    expect(SECTION_KEYS).toHaveLength(8);
    expect(() => parseBundle('not json')).toThrow(/bundle/i);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: implement**

```ts
// apps/web/lib/blocks/generators/item-analysis.ts
import { selectLlmClient } from '@veille/core';
import type { BlockDef } from '../types';

export const CONTENT_CAP = 24_000;

export const SECTION_KEYS = [
  'executive_summary', 'key_themes', 'detailed_breakdown', 'arguments_evidence',
  'notable_quotes', 'strengths_weaknesses', 'actionable_takeaways', 'open_questions',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type BundleRef = { n: number; factId?: string; url: string };
export type Bundle = { sections: Record<SectionKey, string>; refs: BundleRef[] };

const sectionProps = Object.fromEntries(SECTION_KEYS.map((k) => [k, { type: 'STRING' }]));
export const BUNDLE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...sectionProps,
    refs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { n: { type: 'NUMBER' }, url: { type: 'STRING' } },
        required: ['n', 'url'],
      },
    },
  },
  required: [...SECTION_KEYS],
};

export function buildItemAnalysisPrompt(a: {
  title: string; url: string; content: string; language: string;
  facts: { id: string; text: string; sourceUrl: string; sourcePassage: string }[];
}): string {
  const content = a.content.length > CONTENT_CAP ? `${a.content.slice(0, CONTENT_CAP)}\n[…tronqué]` : a.content;
  const factLines = a.facts.map((f, i) => `${i + 1}. ${f.text} (source: ${f.sourceUrl})`).join('\n') || '(none extracted yet)';
  return `You are an expert analyst of published content (videos, articles).
Produce a thorough, structured analysis in ${a.language}. Be specific, ground every statement in the content, no generic filler.

## Item
- Title: ${a.title}
- URL: ${a.url}

## Known facts (cite them with [n] markers wherever a claim relies on one)
${factLines}

## Content
${content}

---

Return JSON with these fields, each a Markdown string in ${a.language} (no headings inside — the field name is the heading):
- executive_summary: 2-4 paragraphs, the item's purpose and core message.
- key_themes: bullet list of major themes with one-line explanations.
- detailed_breakdown: section-by-section or topic-by-topic analysis.
- arguments_evidence: what claims are made and how they are supported.
- notable_quotes: 3-8 verbatim quotes from the content with brief commentary.
- strengths_weaknesses: what works and what is missing, weak, or questionable.
- actionable_takeaways: concrete insights a reader/viewer could apply.
- open_questions: what remains unclear or debatable.
Append [n] markers to any sentence relying on a numbered fact. Also return refs: the list of { n, url } you actually cited.`;
}

export function parseBundle(text: string): Bundle {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text.trim()); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('bundle: model returned no JSON object');
    try { raw = JSON.parse(m[0]); } catch { throw new Error('bundle: unparseable JSON'); }
  }
  const sections = {} as Record<SectionKey, string>;
  for (const k of SECTION_KEYS) {
    const v = raw[k];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`bundle: missing section "${k}"`);
    sections[k] = v.trim();
  }
  const refs: BundleRef[] = Array.isArray(raw.refs)
    ? (raw.refs as Record<string, unknown>[])
        .filter((r) => typeof r?.n === 'number' && typeof r?.url === 'string')
        .map((r) => ({ n: r.n as number, url: r.url as string }))
    : [];
  return { sections, refs };
}

/** Hidden bundle: ONE holistic LLM call per item; the visible analysis blocks are pure extractions. */
export const itemAnalysisBlock: BlockDef = {
  id: 'item-analysis',
  name: 'Analyse (interne)',
  scope: 'item',
  hidden: true,
  prerequisites: [{ kind: 'raw-content' }, { kind: 'item-metadata' }, { kind: 'item-facts' }],
  staleness: 'on-demand',
  async generate(inputs, ctx) {
    const rc = inputs.rawContent; const meta = inputs.itemMetadata; const facts = inputs.itemFacts?.facts ?? [];
    if (!rc || !meta) throw new Error('item-analysis: resolver must provide raw-content + item-metadata');
    const client = selectLlmClient(process.env as Record<string, string | undefined>);
    const r = await client.complete(
      buildItemAnalysisPrompt({ title: meta.title, url: meta.url, content: rc.text, language: ctx.language, facts }),
      { jsonSchema: BUNDLE_SCHEMA });
    const bundle = parseBundle(r.text); // validates; throws → fail-soft in the runner
    // Re-attach factIds server-side: the model only ever sees numbers.
    const withIds = bundle.refs.map((ref) => ({ ...ref, factId: facts[ref.n - 1]?.id }));
    const content = JSON.stringify({ sections: bundle.sections, refs: withIds });
    return { content, citations: withIds.map((ref) => ({ factId: ref.factId, url: ref.url })) };
  },
};
```

- [ ] **Step 3:** run test → 4 passed; `cd apps/web && pnpm typecheck` → clean.
- [ ] **Step 4: Commit** — `feat(blocks): item-analysis bundle generator (hidden, jsonSchema, numbered-fact citations)`

---

### Task 3: Extraction factory + seven visible blocks

**Files:** create `apps/web/lib/blocks/generators/extract.ts` + test.

- [ ] **Step 1: failing test**

```ts
// apps/web/lib/blocks/generators/extract.test.ts
import { describe, it, expect } from 'vitest';
import { makeExtractionBlock, EXTRACTION_BLOCKS } from './extract';
import type { ResolvedInputs } from '../types';

const bundleContent = JSON.stringify({
  sections: {
    executive_summary: 'sum [1]', key_themes: '- t', detailed_breakdown: 'd', arguments_evidence: 'a',
    notable_quotes: 'q', strengths_weaknesses: 's', actionable_takeaways: 'act', open_questions: 'o',
  },
  refs: [{ n: 1, factId: 'f-1', url: 'https://yt/x' }],
});
const inputs: ResolvedInputs = { blocks: { 'item-analysis': bundleContent } };

describe('extraction blocks', () => {
  it('extracts its section and inherits the refs as citations — zero LLM', async () => {
    const b = makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions');
    const out = await b.generate(inputs, { language: 'fr' });
    expect(out.content).toBe('o');
    expect(out.citations).toEqual([{ factId: 'f-1', url: 'https://yt/x' }]);
  });

  it('throws (fail-soft upstream) when the bundle is absent or the section missing', async () => {
    const b = makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions');
    await expect(b.generate({}, { language: 'fr' })).rejects.toThrow(/item-analysis/);
    const bad: ResolvedInputs = { blocks: { 'item-analysis': JSON.stringify({ sections: {}, refs: [] }) } };
    await expect(b.generate(bad, { language: 'fr' })).rejects.toThrow(/open_questions/);
  });

  it('declares the seven visible catalog blocks, all item-scope extractions of item-analysis', () => {
    expect(EXTRACTION_BLOCKS.map((b) => b.id).sort()).toEqual([
      'actionable-takeaways', 'arguments-evidence', 'detailed-breakdown', 'key-themes',
      'notable-quotes', 'open-questions', 'strengths-weaknesses',
    ]);
    for (const b of EXTRACTION_BLOCKS) {
      expect(b.scope).toBe('item');
      expect(b.hidden).toBeUndefined();
      expect(b.prerequisites).toEqual([{ kind: 'block', blockId: 'item-analysis' }]);
    }
  });
});
```

Run → FAIL.

- [ ] **Step 2: implement**

```ts
// apps/web/lib/blocks/generators/extract.ts
import type { BlockDef } from '../types';
import type { SectionKey } from './item-analysis';

type StoredBundle = { sections: Record<string, string>; refs: { n: number; factId?: string; url: string }[] };

/** A visible catalog block that extracts one section of the cached item-analysis bundle. Zero LLM. */
export function makeExtractionBlock(id: string, name: string, section: SectionKey): BlockDef {
  return {
    id, name, scope: 'item',
    prerequisites: [{ kind: 'block', blockId: 'item-analysis' }],
    staleness: 'on-demand',
    async generate(inputs) {
      const raw = inputs.blocks?.['item-analysis'];
      if (!raw) throw new Error(`${id}: resolver must provide the item-analysis bundle`);
      let bundle: StoredBundle;
      try { bundle = JSON.parse(raw); } catch { throw new Error(`${id}: item-analysis bundle is not valid JSON`); }
      const content = bundle.sections?.[section];
      if (typeof content !== 'string' || !content.trim()) throw new Error(`${id}: bundle has no "${section}" section`);
      return { content: content.trim(), citations: (bundle.refs ?? []).map((r) => ({ factId: r.factId, url: r.url })) };
    },
  };
}

export const EXTRACTION_BLOCKS: BlockDef[] = [
  makeExtractionBlock('key-themes', 'Thèmes clés', 'key_themes'),
  makeExtractionBlock('detailed-breakdown', 'Analyse détaillée', 'detailed_breakdown'),
  makeExtractionBlock('arguments-evidence', 'Arguments et preuves', 'arguments_evidence'),
  makeExtractionBlock('notable-quotes', 'Citations marquantes', 'notable_quotes'),
  makeExtractionBlock('strengths-weaknesses', 'Forces et faiblesses', 'strengths_weaknesses'),
  makeExtractionBlock('actionable-takeaways', 'À retenir (actionnable)', 'actionable_takeaways'),
  makeExtractionBlock('open-questions', 'Questions ouvertes', 'open_questions'),
];
```

- [ ] **Step 3:** run test → 3 passed; typecheck clean.
- [ ] **Step 4: Commit** — `feat(blocks): extraction factory + seven catalog blocks`

---

### Task 4: Re-point `exec-summary` + register everything

**Files:** rewrite `generators/exec-summary.ts` + its test; modify `index.ts`.

- [ ] **Step 1:** rewrite `exec-summary.ts`:

```ts
// apps/web/lib/blocks/generators/exec-summary.ts
import { makeExtractionBlock } from './extract';

/** Résumé exécutif — since Plan 2a an extraction of the item-analysis bundle (was: standalone LLM call). */
export const execSummaryBlock = makeExtractionBlock('exec-summary', 'Résumé exécutif', 'executive_summary');
```

Rewrite `exec-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execSummaryBlock } from './exec-summary';

describe('exec-summary', () => {
  it('is an item-scope extraction of the item-analysis bundle', () => {
    expect(execSummaryBlock.scope).toBe('item');
    expect(execSummaryBlock.prerequisites).toEqual([{ kind: 'block', blockId: 'item-analysis' }]);
  });

  it('extracts executive_summary with inherited citations', async () => {
    const bundle = JSON.stringify({ sections: { executive_summary: 'sum [1]' }, refs: [{ n: 1, factId: 'f1', url: 'u' }] });
    const out = await execSummaryBlock.generate({ blocks: { 'item-analysis': bundle } }, { language: 'fr' });
    expect(out.content).toBe('sum [1]');
    expect(out.citations).toEqual([{ factId: 'f1', url: 'u' }]);
  });
});
```

(`tldr.ts` and `tldr.test.ts` are NOT touched — tldr still consumes `block:exec-summary` content, now the extracted section text.)

- [ ] **Step 2:** update `index.ts` registration:

```ts
import { registerBlock, validateRegistry, listBlocks, getBlock } from './registry';
import { itemAnalysisBlock } from './generators/item-analysis';
import { EXTRACTION_BLOCKS } from './generators/extract';
import { execSummaryBlock } from './generators/exec-summary';
import { tldrBlock } from './generators/tldr';

// Self-healing bootstrap: after dev-HMR the registry Map may be recreated empty while any
// global flag would survive — so guard on the registry's own state, not a flag.
if (!getBlock(itemAnalysisBlock.id)) {
  registerBlock(itemAnalysisBlock);
  registerBlock(execSummaryBlock);
  for (const b of EXTRACTION_BLOCKS) registerBlock(b);
  registerBlock(tldrBlock);
  const errors = validateRegistry();
  if (errors.length) throw new Error(`invalid block registry:\n${errors.join('\n')}`);
}

export { listBlocks, getBlock };
```

- [ ] **Step 3: Auto-attach hidden prerequisites.** Extractions need the bundle's *instance* to exist, or every run records a miss. Add to `registry.ts`:

```ts
/** Hidden blocks reachable from def via block-prerequisite edges — auto-attached alongside it. */
export function hiddenPrereqIds(def: BlockDef): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (d: BlockDef) => {
    for (const p of d.prerequisites) {
      if (p.kind !== 'block' || seen.has(p.blockId)) continue;
      seen.add(p.blockId);
      const ref = registry.get(p.blockId);
      if (!ref) continue;
      if (ref.hidden) out.push(ref.id);
      walk(ref);
    }
  };
  walk(def);
  return out;
}
```

Test in `registry.test.ts`:

```ts
  it('hiddenPrereqIds walks block edges and returns hidden blocks transitively', () => {
    registerBlock(def({ id: 'bundle', scope: 'item', hidden: true }));
    registerBlock(def({ id: 'mid', prerequisites: [{ kind: 'block', blockId: 'bundle' }] }));
    registerBlock(def({ id: 'leaf', prerequisites: [{ kind: 'block', blockId: 'mid' }] }));
    expect(hiddenPrereqIds(getBlock('leaf')!)).toEqual(['bundle']);
    expect(hiddenPrereqIds(getBlock('bundle')!)).toEqual([]);
  });
```

(add `hidden?: boolean` passthrough to the test's `def()` helper if needed). In the blocks route POST, after the successful `attachBlock`:

```ts
  for (const hiddenId of hiddenPrereqIds(def)) await attachBlock(dossier.id, hiddenId, scope);
```

(import `hiddenPrereqIds` from `@/lib/blocks/registry`; re-export it from `@/lib/blocks` index for consistency if the route imports from there).

- [ ] **Step 4:** `pnpm vitest run apps/web/lib/blocks` → all green; `pnpm test` → full suite green; `cd apps/web && pnpm typecheck` → clean.
- [ ] **Step 5: Commit** — `feat(blocks): exec-summary re-pointed to bundle extraction; auto-attach hidden prerequisites; register catalog`

---

### Task 5: Full verification + build

- [ ] `pnpm test` (full), `cd apps/web && pnpm typecheck`, `pnpm build` from root — all clean/green. Commit only if fixes were needed.

---

### Task 6: E2E smoke (real DB + LLM)

Same approach as Plan 1's smoke (vitest e2e file run with `--env-file=.env.local`, tunnel up, DELETE the file after; leave DB rows):

1. Same dossier as Plan 1's smoke; attach `open-questions`, `notable-quotes` ('item' scope) — `exec-summary`/`tldr` instances already exist.
2. Attach via the store the way the ROUTE would (attachBlock for the block + its `hiddenPrereqIds`) — verify attaching `open-questions` results in an `item-analysis` instance too. Then run `runBlocksJob(dossierId, { targetKeys: [documentId] }, log)`.
3. Expect run 1: `item-analysis` ran (ONE LLM call), then exec-summary/open-questions/notable-quotes extractions ran instantly (order: bundle first), tldr ran (small LLM call). Citations on extractions include factIds; content of open-questions non-empty.
4. Run 2: everything skipped (fresh fingerprints).
5. Record: LLM call count (2 total), timings, one extraction's citations, tldr sentence.

---

## Self-review (done at write time)

- **Spec coverage:** §2 bundle (Task 2), §3 catalog + re-point (Tasks 3-4), §4 engine touches (Task 1), §6 acceptance (Task 6). The auto-attach-hidden-prerequisites gap was caught during plan writing and folded into Tasks 4/6.
- **Placeholder scan:** none.
- **Type consistency:** `SectionKey` shared between bundle and factory; `BlockLoaders.itemFacts` shape matches store loader and test stubs; stored bundle JSON shape (`{sections, refs}`) written by item-analysis and read by extract.ts match.
