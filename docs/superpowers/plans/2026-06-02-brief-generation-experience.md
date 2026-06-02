# Brief-Generation Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Générer le brief" produce a readable host-cited brief with a numbered Sources list, enrich the document cards (pitch + fact count), and stream the work live as an inline step list.

**Architecture:** "Générer le brief" becomes a streamed enrich-then-synthesize pass. Citations move from per-URL Markdown links to **publication (host) tags** the model already emits; pure helpers number hosts and rewrite `[host, host]` into the existing numbered-superscript pipeline; a new Sources list under the brief surfaces `source_notes`. `composeDossier` ensures each kept doc's core (pitch) + facts, emitting per-doc progress over a new SSE route that the CTA renders inline. No DB migration.

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle ORM (Postgres), `@veille/core` (LLM), vitest. Spec: [docs/superpowers/specs/2026-06-02-brief-generation-experience-design.md](../specs/2026-06-02-brief-generation-experience-design.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `apps/web/lib/citations.ts` | citation helpers | add `hostTagGroups`, `buildHostCitations`, `renderHostCitations`, `buildSourceRows` (pure) |
| `apps/web/lib/citations.test.ts` | citation tests | add cases for the new helpers |
| `apps/web/lib/synthesis.ts` | brief prompt + progress | host-tag prompt; add `brief-doc` progress event |
| `apps/web/components/brief.tsx` | brief render | host-based superscripts |
| `apps/web/components/sources-list.tsx` | the numbered Sources list | **new** |
| `apps/web/app/dossier/[slug]/page.tsx` | page wiring | build host citation data; render `<Sources>` |
| `apps/web/lib/documents.ts` | doc helpers | `attachFactCounts`, fact count in `listDocumentsByStatus`, `ensureDocumentCore` |
| `apps/web/lib/documents.test.ts` | doc helper test | **new** — `attachFactCounts` |
| `apps/web/components/curation.tsx` | cards + CTA | "N faits" marker; streamed inline CTA |
| `apps/web/app/api/dossiers/[slug]/brief/route.ts` | brief SSE route | **new** |
| `apps/web/app/api/dossiers/[slug]/documents/[docId]/analyze/route.ts` | analyze route | use `ensureDocumentCore` |

---

## Task 1: Pure host-citation helpers

**Files:**
- Modify: `apps/web/lib/citations.ts`
- Modify: `apps/web/lib/citations.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `apps/web/lib/citations.test.ts`:

```ts
import {
  hostTagGroups,
  buildHostCitations,
  renderHostCitations,
  buildSourceRows,
} from './citations';

describe('hostTagGroups', () => {
  it('extracts comma-split tokens from [..] groups, ignoring real [text](url) links', () => {
    const md = 'a [lefigaro.fr, apnews.com] b [Le Monde](https://lemonde.fr) c [ouest-france.fr]';
    expect(hostTagGroups(md)).toEqual([['lefigaro.fr', 'apnews.com'], ['ouest-france.fr']]);
  });
});

describe('buildHostCitations', () => {
  it('numbers brief-cited hosts first (appearance order), then remaining fact hosts', () => {
    const brief = 'x [b.fr] y [a.fr, b.fr] z';
    const map = buildHostCitations(brief, ['a.fr', 'b.fr', 'c.fr']);
    expect(map).toEqual({ 'b.fr': 1, 'a.fr': 2, 'c.fr': 3 });
  });
  it('ignores brief tags that are not known fact hosts', () => {
    expect(buildHostCitations('q [unknown.fr] w', ['a.fr'])).toEqual({ 'a.fr': 1 });
  });
  it('empty brief → fact hosts in given order', () => {
    expect(buildHostCitations(null, ['a.fr', 'b.fr'])).toEqual({ 'a.fr': 1, 'b.fr': 2 });
  });
});

describe('renderHostCitations', () => {
  const nums = { 'a.fr': 1, 'b.fr': 2 };
  it('rewrites a known-host group into anchor links (one per host)', () => {
    expect(renderHostCitations('hi [a.fr, b.fr] x', nums))
      .toBe('hi [a.fr](#cite-a.fr)[b.fr](#cite-b.fr) x');
  });
  it('leaves a group with no known host untouched', () => {
    expect(renderHostCitations('see [note] end', nums)).toBe('see [note] end');
  });
  it('does not touch real [text](url) links', () => {
    expect(renderHostCitations('[Le Monde](https://lemonde.fr)', nums)).toBe('[Le Monde](https://lemonde.fr)');
  });
});

describe('buildSourceRows', () => {
  it('orders by number; representative url = first fact url for the host; attaches note', () => {
    const rows = buildSourceRows(
      { 'a.fr': 1, 'b.fr': 2 },
      ['https://a.fr/1', 'https://a.fr/2', 'https://b.fr/x'],
      { 'a.fr': 'note A' },
    );
    expect(rows).toEqual([
      { host: 'a.fr', n: 1, url: 'https://a.fr/1', note: 'note A' },
      { host: 'b.fr', n: 2, url: 'https://b.fr/x', note: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/citations.test.ts`
Expected: FAIL — the four helpers are not exported.

- [ ] **Step 3: Implement the helpers**

Add to `apps/web/lib/citations.ts` (after the existing `buildCitationNumbers`, and add the `hostOf` import at top):

```ts
import { hostOf } from './host';

/** Inner tokens of each `[a, b]` group, EXCLUDING real `[text](url)` links (negative lookahead on `(`). */
export function hostTagGroups(md: string): string[][] {
  const re = /\[([^\]]+)\](?!\()/g;
  const out: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1].split(',').map((s) => s.trim()).filter(Boolean));
  return out;
}

/** Number publications: brief-cited hosts first (appearance order), then remaining fact hosts. */
export function buildHostCitations(brief: string | null | undefined, factHosts: string[]): Record<string, number> {
  const known = new Set(factHosts);
  const map: Record<string, number> = {};
  let n = 0;
  if (brief) for (const group of hostTagGroups(brief)) for (const tok of group) {
    if (known.has(tok) && !(tok in map)) map[tok] = ++n;
  }
  for (const h of factHosts) if (!(h in map)) map[h] = ++n;
  return map;
}

/** Rewrite `[host, host]` groups into per-host anchor links the citation renderer turns into
 *  superscripts. Groups with no known host (and real `[text](url)` links) are left untouched. */
export function renderHostCitations(md: string, hostNumbers: Record<string, number>): string {
  return md.replace(/\[([^\]]+)\](?!\()/g, (full, inner: string) => {
    const tokens = inner.split(',').map((s) => s.trim());
    if (!tokens.some((t) => t in hostNumbers)) return full;
    return tokens.map((t) => (t in hostNumbers ? `[${t}](#cite-${t})` : t)).join('');
  });
}

export type SourceRow = { host: string; n: number; url: string; note?: string };

/** One row per numbered host (ordered by number): representative url = the first fact url whose
 *  host matches; note = the host's source_note if any. */
export function buildSourceRows(
  hostNumbers: Record<string, number>,
  factUrls: string[],
  notes: Record<string, string> | null | undefined,
): SourceRow[] {
  const repUrl: Record<string, string> = {};
  for (const u of factUrls) { const h = hostOf(u); if (!(h in repUrl)) repUrl[h] = u; }
  return Object.entries(hostNumbers)
    .sort((a, b) => a[1] - b[1])
    .map(([host, n]) => ({ host, n, url: repUrl[host] ?? '#', note: notes?.[host] }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/web" exec vitest run lib/citations.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/citations.ts apps/web/lib/citations.test.ts
git commit -m "feat(web): host-based citation helpers (number/render/source rows)"
```

---

## Task 2: Host-tag brief prompt

**Files:**
- Modify: `apps/web/lib/synthesis.ts:74-87`
- Modify: `apps/web/lib/synthesis.test.ts`

- [ ] **Step 1: Update the prompt test**

In `apps/web/lib/synthesis.test.ts`, find the `buildBriefPrompt` test (search for `buildBriefPrompt`). Replace its body's assertion about Markdown links with one asserting the host-tag instruction. If no such test exists, add:

```ts
import { buildBriefPrompt } from './synthesis';

describe('buildBriefPrompt host tags', () => {
  it('instructs citing with the bracketed publication tag, not URLs', () => {
    const p = buildBriefPrompt('Sujet', 'fr', [{ host: 'lefigaro.fr', facts: [] }]);
    expect(p).toMatch(/\[lefigaro\.fr\]/);
    expect(p).toMatch(/publication tag/i);
    expect(p).not.toMatch(/Markdown link/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/synthesis.test.ts`
Expected: FAIL — the prompt still says "Markdown link".

- [ ] **Step 3: Rewrite the citation instruction**

In `apps/web/lib/synthesis.ts`, replace the citation line inside `buildBriefPrompt` (the line starting `'Attribute each claim to its source with a Markdown link…'`) with:

```ts
    'Cite each claim with its source publication tag(s) in square brackets, using the EXACT "## " publication headers listed under FACTS BY PUBLICATION below — e.g. "selon Le Figaro [lefigaro.fr]" or, when several back a point, "[lefigaro.fr, apnews.com]". Use ONLY those exact tags; never invent a tag or write a URL. Group related points; do not just list facts.',
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/web" exec vitest run lib/synthesis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/synthesis.ts apps/web/lib/synthesis.test.ts
git commit -m "feat(web): brief prompt cites publication tags, not URLs"
```

---

## Task 3: Brief renders host superscripts + the Sources list

**Files:**
- Modify: `apps/web/components/brief.tsx`
- Create: `apps/web/components/sources-list.tsx`
- Modify: `apps/web/app/dossier/[slug]/page.tsx`

- [ ] **Step 1: Switch `Brief` to host numbers**

Replace `apps/web/components/brief.tsx` body with (changes: prop `citations` → `hostNumbers`; run `renderHostCitations`; derive the anchor map):

```tsx
'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Eyebrow } from './veille-ui';
import { citeComponents, prepareCiteMd } from './cited-markdown';
import { renderHostCitations } from '@/lib/citations';
import { useCitations, SourcesToggle } from './citations-context';

/**
 * The dossier brief — the synthesis, rendered as a `.section` with a drop-cap.
 * Citations are publication tags ([lefigaro.fr]) the model emits; we rewrite them into the
 * shared numbered-superscript pipeline. Numbers come from `hostNumbers` (one per publication),
 * shared with the Sources list so each superscript jumps to its entry. Hidden until the toggle.
 */
export function Brief({ brief, hostNumbers }: { brief: string; hostNumbers: Record<string, number> }) {
  const { show } = useCitations();
  const md = React.useMemo(() => prepareCiteMd(renderHostCitations(brief, hostNumbers)), [brief, hostNumbers]);
  const citations = React.useMemo(
    () => Object.fromEntries(Object.entries(hostNumbers).map(([h, n]) => [`#cite-${h}`, n])),
    [hostNumbers],
  );
  const components = React.useMemo(() => citeComponents(citations), [citations]);

  return (
    <section className="section" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
        <SourcesToggle />
      </div>

      <div className={'brief-prose' + (show ? ' show-src' : '')}>
        <ReactMarkdown components={components}>{md}</ReactMarkdown>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create the Sources list**

Create `apps/web/components/sources-list.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useCitations } from './citations-context';
import type { SourceRow } from '@/lib/citations';

/**
 * The numbered Sources list under the brief, revealed by the shared "Afficher les sources" toggle.
 * Each row: n · publication · optional source_note one-liner · outbound link. `id="cite-<host>"`
 * is the jump target for the brief's superscripts. Renders nothing when hidden or empty.
 */
export function Sources({ rows }: { rows: SourceRow[] }) {
  const { show } = useCitations();
  if (!show || rows.length === 0) return null;
  return (
    <section className="section sources-list" aria-label="Sources">
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((r) => (
          <li key={r.host} id={`cite-${r.host}`} style={{ display: 'flex', gap: '.5rem', padding: '.35rem 0', fontSize: 'var(--t-sm)' }}>
            <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', minWidth: '1.4em' }}>{r.n}</span>
            <span style={{ minWidth: 0 }}>
              <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{r.host}</a>
              {r.note ? <span style={{ color: 'var(--ink-2)' }}> — {r.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 3: Wire the page**

In `apps/web/app/dossier/[slug]/page.tsx`: replace the `buildCitationNumbers` import + usage and the `<Brief>` render.

Change the import line:
```ts
import { buildCitationNumbers } from '@/lib/citations';
```
to:
```ts
import { buildHostCitations, buildSourceRows } from '@/lib/citations';
import { hostOf } from '@/lib/host';
import { Sources } from '@/components/sources-list';
```

Replace the citations computation (the `const factUrls …` / `const citations …` lines):
```ts
  const factUrls = facts.map((f) => f.sourceUrl);
  const citations = dossier.brief ? buildCitationNumbers(dossier.brief, factUrls) : {};
```
with:
```ts
  const factUrls = facts.map((f) => f.sourceUrl);
  const factHosts = [...new Set(factUrls.map(hostOf))];
  const hostNumbers = dossier.brief ? buildHostCitations(dossier.brief, factHosts) : {};
  const sourceRows = dossier.brief ? buildSourceRows(hostNumbers, factUrls, dossier.sourceNotes ?? {}) : [];
```

Replace the brief render block:
```tsx
            {dossier.brief ? (
              <CitationsProvider>
                <Brief brief={dossier.brief} citations={citations} />
              </CitationsProvider>
            ) : (
              <GenerateBriefCta slug={dossier.slug} />
            )}
```
with:
```tsx
            {dossier.brief ? (
              <CitationsProvider>
                <Brief brief={dossier.brief} hostNumbers={hostNumbers} />
                <Sources rows={sourceRows} />
              </CitationsProvider>
            ) : (
              <GenerateBriefCta slug={dossier.slug} />
            )}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS. (`buildCitationNumbers` may now be unused in the app — that is fine; it stays exported and tested. If `tsc` is clean, proceed.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/brief.tsx apps/web/components/sources-list.tsx "apps/web/app/dossier/[slug]/page.tsx"
git commit -m "feat(web): render host-based superscripts + numbered Sources list"
```

---

## Task 4: Document fact count on cards

**Files:**
- Create: `apps/web/lib/documents.test.ts`
- Modify: `apps/web/lib/documents.ts`
- Modify: `apps/web/components/curation.tsx`

- [ ] **Step 1: Write the failing helper test**

Create `apps/web/lib/documents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { attachFactCounts } from './documents';

describe('attachFactCounts', () => {
  it('attaches factCount per row from the count map, 0 when absent', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const out = attachFactCounts(rows, [{ documentId: 'a', n: 3 }, { documentId: null, n: 9 }]);
    expect(out).toEqual([{ id: 'a', factCount: 3 }, { id: 'b', factCount: 0 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/documents.test.ts`
Expected: FAIL — `attachFactCounts` not exported.

- [ ] **Step 3: Add the helper + use it in `listDocumentsByStatus`**

In `apps/web/lib/documents.ts`, add the pure helper above `listDocumentsByStatus`:

```ts
/** PURE. Attach a factCount to each row from a {documentId,n} count list (0 when none). */
export function attachFactCounts<T extends { id: string }>(
  rows: T[],
  counts: { documentId: string | null; n: number }[],
): (T & { factCount: number })[] {
  const map = new Map(counts.filter((c) => c.documentId).map((c) => [c.documentId as string, c.n]));
  return rows.map((r) => ({ ...r, factCount: map.get(r.id) ?? 0 }));
}
```

Then in `listDocumentsByStatus`, after the `rows` select, count facts and attach:

```ts
  const counts = await db
    .select({ documentId: facts.documentId, n: sql<number>`count(*)::int` })
    .from(facts)
    .where(eq(facts.dossierId, dossierId))
    .groupBy(facts.documentId);
  const withCounts = attachFactCounts(rows, counts);
  const kept = withCounts.filter((r) => r.status === 'kept');
  const suggestions = withCounts.filter((r) => r.status === 'suggestion');
  return { kept, suggestions };
```

(Replace the existing `const kept = rows.filter(...)` / `suggestions` / `return` lines. `Doc` is derived from this return, so it gains `factCount` automatically. `facts` and `sql` are already imported.)

- [ ] **Step 4: Show "N faits" on the card**

In `apps/web/components/curation.tsx`, in `KeptFeed`'s `.doc-foot` block, add the fact marker after the date `<span>`:

```tsx
                <div className="doc-foot">
                  <span>{formatDateFr(new Date(date))}</span>
                  {d.factCount > 0 && (
                    <span className="doc-facts">{d.factCount} {d.factCount === 1 ? 'fait' : 'faits'}</span>
                  )}
                  {badges.length > 0 && (
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter "@veille/web" exec vitest run lib/documents.test.ts`
Expected: PASS.
Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS (`Doc.factCount` flows to the card).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/documents.ts apps/web/lib/documents.test.ts apps/web/components/curation.tsx
git commit -m "feat(web): fact count on document cards"
```

---

## Task 5: `ensureDocumentCore` shared helper

**Files:**
- Modify: `apps/web/lib/documents.ts`
- Modify: `apps/web/app/api/dossiers/[slug]/documents/[docId]/analyze/route.ts`

- [ ] **Step 1: Add `ensureDocumentCore`**

In `apps/web/lib/documents.ts`, add after `setDocumentCore`:

```ts
/** Idempotently generate + store a document's core (shortSummary/review/bullets) from its STORED
 *  content. Returns true if it generated, false if already present or no content. Shared by the
 *  fiche analyze route and the brief-generation enrichment loop. */
export async function ensureDocumentCore(
  dossier: { id: string; language: string | null },
  doc: { id: string; url: string; title: string | null; siteName: string | null; content: string | null; review: unknown },
): Promise<boolean> {
  if (doc.review) return false;
  if (!doc.content) return false;
  const { analyzeDocumentCore } = await import('./document/analyze');
  const core = await analyzeDocumentCore({
    content: doc.content,
    title: doc.title ?? doc.url,
    siteName: doc.siteName ?? undefined,
    lang: dossier.language ?? 'fr',
  });
  await setDocumentCore(doc.id, core);
  return true;
}
```

- [ ] **Step 2: Use it in the analyze route**

In `apps/web/app/api/dossiers/[slug]/documents/[docId]/analyze/route.ts`, replace the import + the generation block. Change the import line:
```ts
import { getDocument, setDocumentCore } from '@/lib/documents';
import { analyzeDocumentCore } from '@/lib/document/analyze';
```
to:
```ts
import { getDocument, ensureDocumentCore } from '@/lib/documents';
```

Replace the body from `if (doc.review) {` through `return Response.json(core);` with:
```ts
  if (!doc.review && !doc.content) return new Response('no stored content to analyze', { status: 409 });
  await ensureDocumentCore({ id: dossier.id, language: dossier.language }, doc);
  const fresh = await getDocument(dossier.id, docId);
  return Response.json({ shortSummary: fresh?.shortSummary, review: fresh?.review, bullets: fresh?.bullets });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/documents.ts "apps/web/app/api/dossiers/[slug]/documents/[docId]/analyze/route.ts"
git commit -m "refactor(web): shared ensureDocumentCore (analyze route reuses it)"
```

---

## Task 6: composeDossier enriches + streams per-doc

**Files:**
- Modify: `apps/web/lib/synthesis.ts`

- [ ] **Step 1: Add the per-doc progress event**

In `apps/web/lib/synthesis.ts`, extend `SynthesisProgress` (the union near line 93):

```ts
export type SynthesisProgress =
  | { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' }
  | { type: 'brief-doc'; index: number; total: number; title: string }
  | { type: 'synthesis-error'; message: string };
```

- [ ] **Step 2: Select core fields + enrich in the loop**

In `composeDossier`, the two `targetDocs` selects currently fetch `{ id, url, title, content }`. Add `siteName` and `review` to BOTH selects so `ensureDocumentCore` can run:

```ts
        .select({ id: documentsTable.id, url: documentsTable.url, title: documentsTable.title, content: documentsTable.content, siteName: documentsTable.siteName, review: documentsTable.review })
```

Replace the fact-ensuring loop:
```ts
    if (targetDocs.length > 0) {
      const { extractFactsForDocument } = await import('./documents');
      for (const doc of targetDocs) {
        await extractFactsForDocument(dossier, doc);
      }
    }
```
with an enrich-then-facts loop that streams a frame per doc:
```ts
    if (targetDocs.length > 0) {
      const { extractFactsForDocument, ensureDocumentCore } = await import('./documents');
      let i = 0;
      for (const doc of targetDocs) {
        i += 1;
        onProgress({ type: 'brief-doc', index: i, total: targetDocs.length, title: doc.title ?? doc.url });
        await ensureDocumentCore({ id: dossier.id, language: dossier.language ?? null }, doc);
        await extractFactsForDocument(dossier, doc);
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS. (`ensureDocumentCore` accepts the doc shape now selected — `siteName`, `review` included.)

- [ ] **Step 4: Run the synthesis tests (no regression)**

Run: `pnpm --filter "@veille/web" exec vitest run lib/synthesis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/synthesis.ts
git commit -m "feat(web): brief-gen ensures doc core + streams per-doc progress"
```

---

## Task 7: Brief SSE route

**Files:**
- Create: `apps/web/app/api/dossiers/[slug]/brief/route.ts`

- [ ] **Step 1: Create the route**

Create `apps/web/app/api/dossiers/[slug]/brief/route.ts` (mirrors the refresh route):

```ts
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { composeDossier, type SynthesisProgress } from '@/lib/synthesis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) return new Response('not found', { status: 404 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (p: SynthesisProgress) => controller.enqueue(enc.encode(`data: ${JSON.stringify(p)}\n\n`));
      try {
        await composeDossier(dossier.id, { mode: 'brief', language: dossier.language ?? 'fr', onProgress: send });
      } catch (e) {
        send({ type: 'synthesis-error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/dossiers/[slug]/brief/route.ts"
git commit -m "feat(web): SSE route streaming brief generation"
```

---

## Task 8: Inline streamed CTA

**Files:**
- Modify: `apps/web/components/curation.tsx`

- [ ] **Step 1: Replace `GenerateBriefCta` with a streamed island**

In `apps/web/components/curation.tsx`, replace the whole `GenerateBriefCta` function (lines ~19-41) with the version below. It opens an `EventSource` on click, shows a live step line, and refreshes on close. Also add `useRouter` to the imports from `next/navigation` at the top of the file if not present (`import { useRouter } from 'next/navigation';`), and keep the existing `Sparkles` import.

```tsx
type BriefFrame =
  | { type: 'brief-doc'; index: number; total: number; title: string }
  | { type: 'synthesis'; phase: 'brief' | 'update'; state: 'start' | 'done' | 'skip' }
  | { type: 'synthesis-error'; message: string };

/**
 * GenerateBriefCta — the empty-brief prompt. On click it opens an SSE stream to the brief route
 * and expands in place into a live step list (Analyse i/N · titre … Rédaction de la synthèse…),
 * then refreshes so the brief + enriched cards render. (Click-triggered, so no StrictMode
 * auto-start race; the stream is closed on unmount.)
 */
export function GenerateBriefCta({ slug }: { slug: string }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [line, setLine] = React.useState<string | null>(null);
  const esRef = React.useRef<EventSource | null>(null);

  React.useEffect(() => () => esRef.current?.close(), []);

  function start() {
    if (running) return;
    setRunning(true);
    setLine('Préparation…');
    const es = new EventSource(`/api/dossiers/${slug}/brief`);
    esRef.current = es;
    es.onmessage = (e) => {
      let p: BriefFrame;
      try { p = JSON.parse(e.data) as BriefFrame; } catch { return; }
      if (p.type === 'brief-doc') setLine(`Analyse des documents — ${p.index}/${p.total} · ${p.title}`);
      else if (p.type === 'synthesis' && p.state === 'start') setLine('Rédaction de la synthèse…');
      else if (p.type === 'synthesis-error') setLine('Une erreur est survenue.');
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      router.refresh(); // brief now exists (or nothing changed); re-render either way
    };
  }

  return (
    <section className="section brief-cta" style={{ marginTop: 0 }}>
      <div className="section-head">
        <div className="ttl">
          <Eyebrow>Le brief</Eyebrow>
          <h2 style={{ marginTop: '.1rem' }}>Situation actuelle</h2>
        </div>
      </div>
      {running ? (
        <div className="brief-empty" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="spin" />
          {line}
        </div>
      ) : (
        <>
          <div className="brief-empty">Pas encore de synthèse — rédigez-la à partir des documents retenus.</div>
          <Btn variant="primary" size="sm" icon={Sparkles} onClick={start}>
            Générer le brief
          </Btn>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Drop the now-unused import (if any)**

`generateBriefAction` is no longer used by the CTA. If `apps/web/components/curation.tsx` no longer references it anywhere, remove it from the `@/app/dossier/[slug]/actions` import. Check:

Run: `grep -n "generateBriefAction" apps/web/components/curation.tsx`
If the only hit was the (now-replaced) CTA, remove `generateBriefAction` from the import list. If `Eyebrow`/`Btn` were only used by the old CTA, leave them — they are used elsewhere in the file.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/curation.tsx
git commit -m "feat(web): inline streamed brief-generation CTA"
```

---

## Task 9: Gate — full suite, build, live

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run: `pnpm -r typecheck && pnpm --filter "@veille/web" typecheck`
Expected: PASS across packages + web.

- [ ] **Step 2: Full test suite from the repo root**

Run: `pnpm test`
Expected: PASS — including the new citation, documents, and synthesis tests. (Run from the repo root, not `apps/web`.)

- [ ] **Step 3: Production build (ensure `next dev` stopped first)**

Stop any `next dev` on :3000 (kill by port — do not build while dev runs), then:
```bash
pnpm --filter "@veille/web" build
```
Expected: build succeeds.

- [ ] **Step 4: Live smoke (manual, with `next dev`)**

- On a dossier with a brief already, confirm it now renders readable prose with ¹² superscripts; toggling "Afficher les sources" reveals the superscripts **and** the numbered Sources list; clicking a superscript jumps to its row.
- Delete/regenerate a brief (or use a fresh dossier): "Générer le brief" expands inline into `Analyse i/N · titre` then `Rédaction de la synthèse…`, then the brief + Sources render.
- Cards show a pitch (`shortSummary`) and "N faits".
- Re-run "Générer le brief" → fast (idempotent core/facts).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: brief-generation experience verification fixups"
```

---

## Self-Review

**Spec coverage:**
- A host citations: numbering (Task 1 `buildHostCitations`), prompt (Task 2), rendering (Task 1 `renderHostCitations` + Task 3 Brief), Sources list surfacing `source_notes` (Task 1 `buildSourceRows` + Task 3 `Sources`). ✓
- B cards: fact count (Task 4), pitch already rendered via `shortSummary` now populated by Task 6 enrichment. ✓
- C streaming: progress event + enrichment loop (Task 6), SSE route (Task 7), inline CTA (Task 8). ✓
- Schema impact none; no migration. ✓
- Edge cases: unknown token untouched (Task 1 `renderHostCitations` test), real links untouched (Task 1 test), 0 kept docs → existing skip path (unchanged), re-run idempotent (`ensureDocumentCore`/`extractFactsForDocument` early-returns), long enrichment over SSE (Task 7/8), host without note (Task 1 `buildSourceRows` → `note: undefined`). ✓

**Type consistency:** `hostNumbers: Record<string, number>` (Task 1/3); `SourceRow {host,n,url,note?}` (Task 1/3); `factCount: number` on `Doc` (Task 4); `{ type:'brief-doc'; index; total; title }` identical in `SynthesisProgress` (Task 6), the route's `SynthesisProgress` (Task 7), and the CTA's `BriefFrame` (Task 8); `ensureDocumentCore(dossier, doc)` shape matches the Task 6 select (`siteName`, `review` added). ✓

**Notes:** `buildCitationNumbers` becomes unused by the app but stays exported + tested (no removal — avoids churn). First brief-gen runs ~3 LLM calls per kept doc (core review + résumé + facts); the stream covers the wait; re-runs short-circuit.
