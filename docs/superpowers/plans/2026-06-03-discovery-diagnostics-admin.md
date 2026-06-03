# Discovery Diagnostics + Tuning Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/admin` tool to see every refresh's discovery funnel (what was found / why kept-suggested-rejected) and to fine-tune the knobs live with sliders.

**Architecture:** A `refresh_runs` table records each refresh's funnel (instrumenting the existing filter chain — no extra LLM calls). A db-free `lib/diagnostics.ts` holds the pure `classifyDiscovery` (pre-relevance staging) + `bucket` (verdict from knobs). `/admin/[slug]` shows persisted funnels (Historique) and runs a live dry probe with knob sliders that re-bucket scored candidates client-side (Tester).

**Tech Stack:** Next.js 15 App Router, React 19, Drizzle (Postgres), `@veille/discovery`, Gemini relevance scorer, vitest. Spec: [docs/superpowers/specs/2026-06-03-discovery-diagnostics-admin-design.md](../specs/2026-06-03-discovery-diagnostics-admin-design.md).

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `apps/web/lib/db/app-schema.ts` | `refresh_runs` table | add table |
| `apps/web/drizzle/0013_*.sql` | migration | generated |
| `apps/web/lib/diagnostics.ts` | pure funnel logic + types | **new** (`FunnelEntry`, `classifyDiscovery`, `bucket`) |
| `apps/web/lib/diagnostics.test.ts` | pure tests | **new** |
| `apps/web/lib/refresh.ts` | instrument funnel | `processCandidate` returns relevance; build `runFunnel`; insert run |
| `apps/web/lib/refresh-runs.ts` | db ops | **new** (`insertRefreshRun`, `listRefreshRuns`) |
| `apps/web/lib/diagnostics-probe.ts` | live dry probe | **new** (`runDiscoveryProbe`) |
| `apps/web/app/api/admin/discovery/route.ts` | probe API | **new** |
| `apps/web/app/admin/page.tsx` | dossier picker | **new** |
| `apps/web/app/admin/[slug]/page.tsx` | diagnostics page | **new** |
| `apps/web/components/diagnostics-view.tsx` | Historique + Tester tabs | **new** |
| `apps/web/components/topbar.tsx` | Admin link | add link |
| `apps/web/app/globals.css` | funnel/admin styles | add `.funnel-*` block |

---

## Task 1: `refresh_runs` table + migration

**Files:** Modify `apps/web/lib/db/app-schema.ts`; Create `apps/web/drizzle/0013_*.sql`.

- [ ] **Step 1: Add the table**

In `apps/web/lib/db/app-schema.ts`, after the `dossierUpdates` table (or near the other tables), add:

```ts
export const refreshRuns = pgTable('refresh_runs', {
  id: uuid('id').primaryKey(),
  dossierId: uuid('dossier_id').notNull().references(() => dossiers.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  params: jsonb('params').$type<{ recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number }>().notNull(),
  counts: jsonb('counts').$type<{ raw: number; kept: number; suggestion: number; rejected: number }>().notNull(),
  funnel: jsonb('funnel').notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter "@veille/web" db:generate`
Expected: creates `apps/web/drizzle/0013_<name>.sql` with `CREATE TABLE "refresh_runs" (…)`. (Applied to the DB in the gate task.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/db/app-schema.ts apps/web/drizzle
git commit -m "feat(db): refresh_runs (discovery funnel per refresh)"
```

---

## Task 2: Pure funnel logic — `lib/diagnostics.ts`

**Files:** Create `apps/web/lib/diagnostics.ts`, `apps/web/lib/diagnostics.test.ts`. Must be db-free (testable without env).

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/diagnostics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyDiscovery, bucket } from './diagnostics';

const c = (url: string, score?: number, publishedAt?: string) => ({ url, title: url, score, publishedAt });

describe('classifyDiscovery', () => {
  it('stages candidates: score floor, low-rank, recency, seen → and returns survivors to process', () => {
    const cands = [
      c('https://a/1', 0.9, '2026-06-03'),  // ok
      c('https://a/2', 0.3, '2026-06-03'),  // below score floor 0.4
      c('https://a/3', 0.8, '2020-01-01'),  // old → recency
      c('https://a/seen', 0.7, '2026-06-03'), // seen
      c('https://a/4', 0.6, '2026-06-03'),  // ok but beyond perSource=2 after sort
    ];
    const seen = new Set(['https://a/seen']);
    const { funnel, toProcess } = classifyDiscovery(cands, {
      query: 'q', candidateScoreFloor: 0.4, perSource: 2,
      isRecent: (p) => p !== '2020-01-01', seenUrls: seen,
    });
    const verdict = (u: string) => funnel.find((f) => f.url === u)?.verdict;
    expect(verdict('https://a/2')).toBe('rejected:score');
    // after dropping the sub-floor one, sort by score desc: [0.9,0.8,0.7,0.6]; perSource=2 → top two kept-path
    expect(verdict('https://a/4')).toBe('rejected:low-rank'); // 0.6 is 4th
    expect(verdict('https://a/3')).toBe('rejected:recency');  // 0.8 in top2? top2 = [0.9,0.8] → 0.8 IS in top, then recency drops it
    expect(toProcess.map((x) => x.url)).toEqual(['https://a/1']); // only 0.9 survives (0.8 old, seen out of top)
  });
});

describe('bucket', () => {
  const knobs = { recencyDays: 7, candidateScoreFloor: 0.4, relevanceKeepFloor: 0.5 };
  const now = new Date('2026-06-03T12:00:00Z');
  it('rejects on provider score floor', () => {
    expect(bucket({ providerScore: 0.2, relevance: 0.9, publishedAt: '2026-06-03' }, knobs, now)).toBe('rejected:score');
  });
  it('rejects on recency window', () => {
    expect(bucket({ relevance: 0.9, publishedAt: '2026-05-01' }, knobs, now)).toBe('rejected:recency');
  });
  it('keeps when relevance ≥ keep floor, suggestion when below', () => {
    expect(bucket({ relevance: 0.8, publishedAt: '2026-06-03' }, knobs, now)).toBe('kept');
    expect(bucket({ relevance: 0.3, publishedAt: '2026-06-03' }, knobs, now)).toBe('suggestion');
  });
  it('null relevance → suggestion (not kept)', () => {
    expect(bucket({ relevance: null, publishedAt: '2026-06-03' }, knobs, now)).toBe('suggestion');
  });
  it('recencyDays 0 disables the window (undated/old still pass to relevance)', () => {
    expect(bucket({ relevance: 0.9, publishedAt: '2020-01-01' }, { ...knobs, recencyDays: 0 }, now)).toBe('kept');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter "@veille/web" exec vitest run lib/diagnostics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/diagnostics.ts`**

```ts
// Pure discovery-funnel logic. DB-free so it's unit-testable and reusable by the refresh
// instrumentation, the live probe, and the admin Tester re-bucketing.
import { isWithinDays } from './temporal';

export type FunnelVerdict =
  | 'kept' | 'suggestion'
  | 'rejected:score' | 'rejected:low-rank' | 'rejected:recency' | 'rejected:seen' | 'rejected:no-content';

export type FunnelEntry = {
  query: string;
  url: string;
  title?: string;
  publishedAt?: string;
  siteName?: string;
  providerScore?: number;
  verdict: FunnelVerdict;
  relevance?: number | null;
  relevanceReason?: string;
};

type RawCand = { url: string; title?: string; publishedAt?: string; siteName?: string; score?: number };

/** Stage raw candidates (post-shorts) through score-floor → rank-cut → recency → seen, recording a
 *  funnel entry for each dropped one and returning the survivors to fetch + relevance-score. PURE. */
export function classifyDiscovery(
  cands: RawCand[],
  opts: { query: string; candidateScoreFloor: number; perSource: number; isRecent: (publishedAt?: string) => boolean; seenUrls: Set<string> },
): { funnel: FunnelEntry[]; toProcess: RawCand[] } {
  const funnel: FunnelEntry[] = [];
  const e = (c: RawCand, verdict: FunnelVerdict): FunnelEntry => ({
    query: opts.query, url: c.url, title: c.title, publishedAt: c.publishedAt, siteName: c.siteName, providerScore: c.score, verdict,
  });
  const scored: RawCand[] = [];
  for (const c of cands) {
    if (c.score !== undefined && c.score < opts.candidateScoreFloor) funnel.push(e(c, 'rejected:score'));
    else scored.push(c);
  }
  const ranked = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = ranked.slice(0, opts.perSource);
  for (const c of ranked.slice(opts.perSource)) funnel.push(e(c, 'rejected:low-rank'));
  const recent: RawCand[] = [];
  for (const c of top) { if (opts.isRecent(c.publishedAt)) recent.push(c); else funnel.push(e(c, 'rejected:recency')); }
  const toProcess: RawCand[] = [];
  for (const c of recent) { if (opts.seenUrls.has(c.url)) funnel.push(e(c, 'rejected:seen')); else toProcess.push(c); }
  return { funnel, toProcess };
}

/** Verdict for a probe candidate under a set of knobs — the single source of truth for the Tester's
 *  instant re-bucketing. PURE. recencyDays 0 = window disabled. */
export function bucket(
  c: { providerScore?: number; publishedAt?: string; relevance?: number | null },
  knobs: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number },
  now: Date,
): FunnelVerdict {
  if (c.providerScore !== undefined && c.providerScore < knobs.candidateScoreFloor) return 'rejected:score';
  if (knobs.recencyDays > 0 && !isWithinDays(c.publishedAt, now, knobs.recencyDays)) return 'rejected:recency';
  if (c.relevance == null) return 'suggestion';
  return c.relevance >= knobs.relevanceKeepFloor ? 'kept' : 'suggestion';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter "@veille/web" exec vitest run lib/diagnostics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/diagnostics.ts apps/web/lib/diagnostics.test.ts
git commit -m "feat(web): pure discovery-funnel helpers (classifyDiscovery + bucket)"
```

---

## Task 3: Instrument refresh to record the funnel

**Files:** Modify `apps/web/lib/refresh.ts`; Create `apps/web/lib/refresh-runs.ts`.

- [ ] **Step 1: `processCandidate` returns the relevance score**

In `apps/web/lib/refresh.ts`, change `processCandidate`'s return type + final lines:

```ts
async function processCandidate(
  ctx: PullCtx,
  url: string,
  candPublishedAt: string | undefined,
  candTitle: string | undefined,
): Promise<{ status: 'kept' | 'suggestion'; relevance: number; reason: string }> {
```
and replace `return status;` (end of the function) with:
```ts
  return { status, relevance: rel.score, reason: rel.reason };
```

Update the OTHER two call sites to destructure:
- item branch in `refreshDossier`: `const { status } = await processCandidate(ctx, url, undefined, title);`
- `pullAdHoc` loop: `const { status } = await processCandidate(ctx, c.url, c.publishedAt, c.title);`

- [ ] **Step 2: Create `lib/refresh-runs.ts`**

```ts
import { uuidv7 } from '@veille/core';
import { eq, desc } from 'drizzle-orm';
import { db } from './db';
import { refreshRuns } from './db/schema';
import type { FunnelEntry } from './diagnostics';

export type RefreshRunInput = {
  params: { recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number };
  counts: { raw: number; kept: number; suggestion: number; rejected: number };
  funnel: FunnelEntry[];
};

export async function insertRefreshRun(dossierId: string, run: RefreshRunInput): Promise<void> {
  await db.insert(refreshRuns).values({
    id: uuidv7(),
    dossierId,
    params: run.params,
    counts: run.counts,
    funnel: run.funnel.slice(0, 200), // bound the jsonb
  } as typeof refreshRuns.$inferInsert);
}

export type RefreshRun = typeof refreshRuns.$inferSelect;

export async function listRefreshRuns(dossierId: string, limit = 10): Promise<RefreshRun[]> {
  return db.select().from(refreshRuns).where(eq(refreshRuns.dossierId, dossierId)).orderBy(desc(refreshRuns.createdAt)).limit(limit);
}
```

- [ ] **Step 3: Build the funnel in `refreshDossier`'s standing branch**

In `apps/web/lib/refresh.ts`: add imports
```ts
import { classifyDiscovery, type FunnelEntry } from './diagnostics';
import { insertRefreshRun } from './refresh-runs';
```
Declare `const runFunnel: FunnelEntry[] = [];` next to `newKeptUrls`.

Replace the standing-branch inner block (from `const ranked = …` through the `for (const c of freshCandidates(recencyFiltered, seenUrls)) { … }` loop) with:

```ts
        const candidateScoreFloor = cfg.candidateScoreFloor;
        const recencyDays = opts.recencyDays ?? cfg.refreshRecencyDays;
        const now = new Date();
        const isRecent = (p?: string) =>
          phase !== 'refresh' ? true : recencyDays > 0 ? isWithinDays(p, now, recencyDays) : isRecentCandidate(p, lastRefresh);
        const { funnel: preFunnel, toProcess } = classifyDiscovery(candidates, {
          query: src.label ?? src.connector, candidateScoreFloor, perSource: candidatesPerSource, isRecent, seenUrls,
        });
        runFunnel.push(...preFunnel);
        for (const c of toProcess) {
          seenUrls.add(c.url); // mark seen up-front so a later source dedups even if this one fails
          if (!findAdapter({ kind: 'url', url: c.url })) {
            runFunnel.push({ query: src.label ?? src.connector, url: c.url, title: c.title, publishedAt: c.publishedAt, siteName: c.siteName, providerScore: c.score, verdict: 'rejected:no-content' });
            continue;
          }
          try {
            const r = await processCandidate(ctx, c.url, c.publishedAt, c.title);
            if (r.status === 'kept') { kept++; newKeptUrls.push(c.url); } else suggested++;
            runFunnel.push({ query: src.label ?? src.connector, url: c.url, title: c.title, publishedAt: c.publishedAt, siteName: c.siteName, providerScore: c.score, verdict: r.status, relevance: r.relevance, relevanceReason: r.reason });
            onProgress({ type: 'document', sourceLabel: src.label ?? src.connector, title: c.title ?? c.url, status: r.status, kept, total: kept + suggested });
          } catch {
            runFunnel.push({ query: src.label ?? src.connector, url: c.url, title: c.title, publishedAt: c.publishedAt, siteName: c.siteName, providerScore: c.score, verdict: 'rejected:no-content' });
          }
        }
```

This removes the old `ranked`/`recencyFiltered`/`freshCandidates` lines for the standing branch. (`freshCandidates` stays imported for `pullAdHoc`; `isWithinDays`/`isRecentCandidate` stay imported.)

- [ ] **Step 4: Persist the run before the journal/finish block**

Just before the journal block (`if (phase === 'refresh' && cfg.journalEnabled …`), add:

```ts
  if (phase === 'refresh') {
    const rejected = runFunnel.filter((f) => f.verdict.startsWith('rejected')).length;
    try {
      await insertRefreshRun(dossierId, {
        params: { recencyDays: opts.recencyDays ?? cfg.refreshRecencyDays, relevanceKeepFloor: cfg.relevanceKeepFloor, candidateScoreFloor: cfg.candidateScoreFloor },
        counts: { raw: runFunnel.length, kept, suggestion: suggested, rejected },
        funnel: runFunnel,
      });
    } catch { /* diagnostics are best-effort; never fail a refresh on logging */ }
  }
```

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.
Run: `pnpm --filter "@veille/web" exec vitest run lib/source-phase.test.ts lib/diagnostics.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/refresh.ts apps/web/lib/refresh-runs.ts
git commit -m "feat(web): record the discovery funnel of each refresh (refresh_runs)"
```

---

## Task 4: `/admin` Historique view

**Files:** Create `apps/web/app/admin/page.tsx`, `apps/web/app/admin/[slug]/page.tsx`, `apps/web/components/diagnostics-view.tsx`; Modify `apps/web/components/topbar.tsx`, `apps/web/app/globals.css`.

- [ ] **Step 1: Admin dossier picker — `app/admin/page.tsx`**

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { listDossiers } from '@/lib/dossiers';
import { TopBar } from '@/components/topbar';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const dossiers = await listDossiers(session.user.id);
  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <h1 className="rise" style={{ fontSize: 'var(--t-h1)' }}>Diagnostics</h1>
        <p className="intent rise">Comprendre et calibrer la découverte.</p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {dossiers.map((d) => (
            <li key={d.id}><Link href={`/admin/${d.slug}`} style={{ color: 'var(--accent)' }}>{d.name}</Link></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Diagnostics page — `app/admin/[slug]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { listRefreshRuns } from '@/lib/refresh-runs';
import { TopBar } from '@/components/topbar';
import { DiagnosticsView } from '@/components/diagnostics-view';
import { getRefreshConfig } from '@/lib/refresh-config';

export const dynamic = 'force-dynamic';

export default async function AdminDossierPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const dossier = await getDossier(session.user.id, slug);
  if (!dossier) notFound();
  const runs = await listRefreshRuns(dossier.id, 10);
  const cfg = getRefreshConfig();
  return (
    <div className="shell">
      <TopBar email={session.user.email} />
      <div className="page dossier">
        <Link href="/admin" className="back"><ArrowLeft />Diagnostics</Link>
        <h1 className="rise" style={{ fontSize: 'var(--t-h1)' }}>{dossier.name}</h1>
        <DiagnosticsView
          slug={dossier.slug}
          runs={runs.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), params: r.params, counts: r.counts, funnel: r.funnel as object[] }))}
          defaults={{ recencyDays: 0, candidateScoreFloor: cfg.candidateScoreFloor, relevanceKeepFloor: cfg.relevanceKeepFloor }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The view (Historique tab now; Tester stub) — `components/diagnostics-view.tsx`**

```tsx
'use client';

import * as React from 'react';
import type { FunnelEntry } from '@/lib/diagnostics';

type Run = { id: string; createdAt: string; params: { recencyDays: number; relevanceKeepFloor: number; candidateScoreFloor: number }; counts: { raw: number; kept: number; suggestion: number; rejected: number }; funnel: object[] };

function FunnelTable({ funnel }: { funnel: FunnelEntry[] }) {
  return (
    <table className="funnel">
      <thead><tr><th>verdict</th><th>requête</th><th>publication</th><th>date</th><th>score</th><th>pertinence</th><th>titre</th></tr></thead>
      <tbody>
        {funnel.map((f, i) => (
          <tr key={i} className={'fv-' + f.verdict.replace(':', '-')}>
            <td>{f.verdict}</td><td>{f.query}</td><td>{f.siteName ?? ''}</td>
            <td>{f.publishedAt?.slice(0, 10) ?? '—'}</td>
            <td>{f.providerScore != null ? f.providerScore.toFixed(2) : '—'}</td>
            <td>{f.relevance != null ? f.relevance.toFixed(2) : '—'}</td>
            <td title={f.title}>{(f.title ?? f.url).slice(0, 60)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiagnosticsView({ slug, runs, defaults }: { slug: string; runs: Run[]; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  const [tab, setTab] = React.useState<'hist' | 'test'>('hist');
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div className="diag-tabs">
        <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>Historique</button>
        <button className={tab === 'test' ? 'on' : ''} onClick={() => setTab('test')}>Tester</button>
      </div>
      {tab === 'hist' ? (
        runs.length === 0 ? <p className="diag-empty">Aucun rafraîchissement enregistré.</p> : (
          runs.map((r) => (
            <details key={r.id} className="diag-run" open={r === runs[0]}>
              <summary>{new Date(r.createdAt).toLocaleString('fr-FR')} — {r.counts.kept} gardés · {r.counts.suggestion} suggestions · {r.counts.rejected} rejetés (fenêtre {r.params.recencyDays} j)</summary>
              <FunnelTable funnel={r.funnel as unknown as FunnelEntry[]} />
            </details>
          ))
        )
      ) : (
        <Tester slug={slug} defaults={defaults} />
      )}
    </div>
  );
}

// Tester filled in Task 6.
function Tester(_props: { slug: string; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  return <p className="diag-empty">Bientôt.</p>;
}
```

- [ ] **Step 4: Topbar Admin link + styles**

In `apps/web/components/topbar.tsx`, add a link before the email (inside `.topbar-acct`):
```tsx
        <ThemeToggle />
        <a href="/admin" className="topbar-email" style={{ textDecoration: 'none' }}>Diagnostics</a>
        <span className="topbar-email">{email}</span>
```

In `apps/web/app/globals.css`, append:
```css
.diag-tabs { display: flex; gap: .5rem; margin-bottom: 1rem; }
.diag-tabs button { font-family: var(--font-mono); font-size: var(--t-mono); padding: .3rem .7rem; border: 1px solid var(--line-2); border-radius: var(--radius-sm); background: none; color: var(--ink-2); cursor: pointer; }
.diag-tabs button.on { color: var(--accent); border-color: var(--accent); }
.diag-empty { color: var(--ink-3); font-style: italic; font-family: var(--font-serif); }
.diag-run { margin-bottom: .8rem; }
.diag-run > summary { cursor: pointer; font-family: var(--font-mono); font-size: var(--t-sm); color: var(--ink-2); }
.funnel { width: 100%; border-collapse: collapse; margin-top: .6rem; font-size: var(--t-xs); }
.funnel th, .funnel td { text-align: left; padding: .25rem .5rem; border-bottom: 1px solid var(--line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 28ch; }
.funnel th { color: var(--ink-3); font-family: var(--font-mono); font-weight: 400; }
.funnel .fv-kept td:first-child { color: var(--accent); }
.funnel tr[class^="fv-rejected"] td:first-child { color: var(--ink-3); }
.funnel .fv-suggestion td:first-child { color: var(--ink-2); }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin apps/web/components/diagnostics-view.tsx apps/web/components/topbar.tsx apps/web/app/globals.css
git commit -m "feat(web): /admin discovery diagnostics — Historique view"
```

---

## Task 5: Live probe — `runDiscoveryProbe` + API

**Files:** Create `apps/web/lib/diagnostics-probe.ts`, `apps/web/app/api/admin/discovery/route.ts`.

- [ ] **Step 1: `lib/diagnostics-probe.ts`**

```ts
import { eq, and, ne } from 'drizzle-orm';
import { db } from './db';
import { dossiers, sources, documents } from './db/schema';
import { extract, findAdapter, mapWithConcurrency } from '@veille/core';
import { discoverTavily, discoverRss, discoverYouTubeChannel, discoverWatch } from '@veille/discovery';
import type { Candidate } from '@veille/discovery';
import { registerAllAdapters } from './adapters';
import { hostOf } from './host';
import { scoreRelevance } from './relevance';
import { getRefreshConfig } from './refresh-config';

export type ProbeCandidate = {
  query: string; url: string; title?: string; publishedAt?: string; siteName?: string;
  providerScore?: number; relevance: number | null; relevanceReason?: string;
};

/** Dry run: discover the dossier's standing sources, fetch + relevance-score the top candidates,
 *  return them UNBUCKETED (the admin Tester applies knob thresholds client-side). No upserts. */
export async function runDiscoveryProbe(dossierId: string, perSource = 10): Promise<ProbeCandidate[]> {
  registerAllAdapters();
  const cfg = getRefreshConfig();
  const [dossier] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!dossier) return [];
  const language = dossier.language ?? 'fr';
  const intent = [dossier.name, dossier.intent].filter(Boolean).join(' — ') || dossier.intent;
  const srcRows = await db.select().from(sources).where(and(eq(sources.dossierId, dossierId), eq(sources.kind, 'standing')));

  const out: ProbeCandidate[] = [];
  for (const src of srcRows) {
    let cands: Candidate[] = [];
    try {
      if (src.connector === 'google-news') cands = await discoverWatch({ query: (src.input as { query: string }).query, language });
      else if (src.connector === 'tavily') cands = await discoverTavily(src.input as never);
      else if (src.connector === 'rss') cands = await discoverRss(src.input as never);
      else if (src.connector === 'youtube-channel') cands = await discoverYouTubeChannel(src.input as never);
    } catch { cands = []; }
    const top = cands.filter((c) => !/youtube\.com\/shorts\//i.test(c.url)).slice(0, perSource);
    const scored = await mapWithConcurrency(top, 3, async (c) => {
      let content = '';
      try { if (findAdapter({ kind: 'url', url: c.url })) await extract(c.url, { language, contentOnly: true, onContent: (t) => { content = t; } }); } catch { /* skip */ }
      const rel = content ? await scoreRelevance({ title: c.title ?? c.url, content, intent, language, contentBudget: cfg.relevanceContentBudget }) : null;
      const pc: ProbeCandidate = {
        query: src.label ?? src.connector, url: c.url, title: c.title, publishedAt: c.publishedAt,
        siteName: c.siteName ?? hostOf(c.url), providerScore: c.score, relevance: rel ? rel.score : null,
      };
      if (rel) pc.relevanceReason = rel.reason;
      return pc;
    });
    out.push(...scored);
  }
  return out;
}
```

(`ne` import is unused — remove it; kept here only if needed. Use `and(eq(dossierId), eq(kind,'standing'))`.)

- [ ] **Step 2: API route — `app/api/admin/discovery/route.ts`**

```ts
import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getDossier } from '@/lib/dossiers';
import { runDiscoveryProbe } from '@/lib/diagnostics-probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  const dossier = await getDossier(session.user.id, body.slug);
  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const candidates = await runDiscoveryProbe(dossier.id);
  return NextResponse.json({ candidates });
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS (remove the unused `ne` import from `diagnostics-probe.ts` if tsc flags it).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/diagnostics-probe.ts "apps/web/app/api/admin/discovery/route.ts"
git commit -m "feat(web): live discovery probe + /api/admin/discovery"
```

---

## Task 6: Tester tab — sliders + re-bucket + env hints

**Files:** Modify `apps/web/components/diagnostics-view.tsx`.

- [ ] **Step 1: Replace the `Tester` stub**

In `apps/web/components/diagnostics-view.tsx`, add the import at the top:
```ts
import { bucket, type FunnelVerdict } from '@/lib/diagnostics';
```
Replace the `Tester` function with:

```tsx
type ProbeCandidate = { query: string; url: string; title?: string; publishedAt?: string; siteName?: string; providerScore?: number; relevance: number | null; relevanceReason?: string };

function Tester({ slug, defaults }: { slug: string; defaults: { recencyDays: number; candidateScoreFloor: number; relevanceKeepFloor: number } }) {
  const [running, setRunning] = React.useState(false);
  const [cands, setCands] = React.useState<ProbeCandidate[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [recencyDays, setRecencyDays] = React.useState(defaults.recencyDays);
  const [scoreFloor, setScoreFloor] = React.useState(defaults.candidateScoreFloor);
  const [keepFloor, setKeepFloor] = React.useState(defaults.relevanceKeepFloor);

  async function run() {
    setRunning(true); setError(null);
    try {
      const res = await fetch('/api/admin/discovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) });
      if (!res.ok) { setError('Échec de la sonde.'); return; }
      const json = (await res.json()) as { candidates: ProbeCandidate[] };
      setCands(json.candidates);
    } catch { setError('Erreur réseau.'); } finally { setRunning(false); }
  }

  const knobs = { recencyDays, candidateScoreFloor: scoreFloor, relevanceKeepFloor: keepFloor };
  const now = new Date();
  const verdicts = (cands ?? []).map((c) => bucket(c, knobs, now));
  const count = (v: FunnelVerdict | 'rejected') => verdicts.filter((x) => (v === 'rejected' ? x.startsWith('rejected') : x === v)).length;

  return (
    <div>
      <button className="diag-run-btn" onClick={run} disabled={running}>{running ? 'Sonde en cours… (~60 s)' : 'Lancer la sonde'}</button>
      {error ? <p className="diag-empty">{error}</p> : null}
      {cands ? (
        <>
          <div className="diag-knobs">
            <label>Fenêtre (j): <input type="range" min={0} max={30} value={recencyDays} onChange={(e) => setRecencyDays(+e.target.value)} /> {recencyDays}</label>
            <label>Score min: <input type="range" min={0} max={1} step={0.05} value={scoreFloor} onChange={(e) => setScoreFloor(+e.target.value)} /> {scoreFloor.toFixed(2)}</label>
            <label>Pertinence min: <input type="range" min={0} max={1} step={0.05} value={keepFloor} onChange={(e) => setKeepFloor(+e.target.value)} /> {keepFloor.toFixed(2)}</label>
          </div>
          <p className="diag-counts">{count('kept')} gardés · {count('suggestion')} suggestions · {count('rejected')} rejetés (sur {cands.length})</p>
          <pre className="diag-env">VEILLE_REFRESH_RECENCY_DAYS={recencyDays}{'\n'}VEILLE_CANDIDATE_SCORE_FLOOR={scoreFloor}{'\n'}VEILLE_RELEVANCE_KEEP_FLOOR={keepFloor}</pre>
          <table className="funnel">
            <thead><tr><th>verdict</th><th>requête</th><th>publication</th><th>date</th><th>score</th><th>pertinence</th><th>titre</th></tr></thead>
            <tbody>
              {cands.map((c, i) => (
                <tr key={i} className={'fv-' + verdicts[i].replace(':', '-')}>
                  <td>{verdicts[i]}</td><td>{c.query}</td><td>{c.siteName ?? ''}</td>
                  <td>{c.publishedAt?.slice(0, 10) ?? '—'}</td>
                  <td>{c.providerScore != null ? c.providerScore.toFixed(2) : '—'}</td>
                  <td>{c.relevance != null ? c.relevance.toFixed(2) : '—'}</td>
                  <td title={c.title}>{(c.title ?? c.url).slice(0, 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Styles**

In `apps/web/app/globals.css`, append:
```css
.diag-run-btn { font-family: var(--font-mono); font-size: var(--t-sm); padding: .4rem .9rem; border: 1px solid var(--accent); border-radius: var(--radius-sm); background: none; color: var(--accent); cursor: pointer; }
.diag-run-btn:disabled { opacity: .5; cursor: default; }
.diag-knobs { display: flex; flex-wrap: wrap; gap: 1.2rem; margin: 1rem 0; font-family: var(--font-mono); font-size: var(--t-sm); color: var(--ink-2); }
.diag-knobs input[type="range"] { accent-color: var(--accent); vertical-align: middle; }
.diag-counts { font-family: var(--font-mono); font-size: var(--t-sm); color: var(--ink); margin: .5rem 0; }
.diag-env { font-family: var(--font-mono); font-size: var(--t-xs); background: var(--surface-2); padding: .6rem .8rem; border-radius: var(--radius-sm); color: var(--ink-2); white-space: pre; }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter "@veille/web" typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/diagnostics-view.tsx apps/web/app/globals.css
git commit -m "feat(web): admin Tester — live probe + knob sliders + env hints"
```

---

## Task 7: Gate — suite, build, migration, live

**Files:** none.

- [ ] **Step 1: Typecheck + full suite**

Run: `pnpm -r typecheck && pnpm --filter "@veille/web" typecheck && pnpm test`
Expected: PASS (incl. `diagnostics.test.ts`).

- [ ] **Step 2: Apply migration**

Ensure tunnel up (port 15432), then: `pnpm --filter "@veille/web" db:migrate`
Expected: `0013_*` applies; `refresh_runs` exists.

- [ ] **Step 3: Build (dev stopped)**

Stop `next dev` on :3000, then: `pnpm --filter "@veille/web" build`
Expected: succeeds (the `/admin` + `/admin/[slug]` + `/api/admin/discovery` routes appear).

- [ ] **Step 4: Live smoke**

Restart dev. Refresh a dossier → an entry appears in `/admin/[slug]` Historique with the funnel. Tester → Lancer → candidates load; moving the sliders re-buckets the counts/table instantly; the env block updates.

- [ ] **Step 5: Final commit (if fixups)**

```bash
git add -A
git commit -m "chore: discovery-diagnostics verification fixups"
```

---

## Self-Review

**Spec coverage:** §1 table (T1); §2 instrument + processCandidate relevance + insertRefreshRun (T3); §3 live probe API (T5); §4 /admin page + Historique + Tester sliders + env hints (T4, T6); shared `bucket`/`classifyDiscovery` (T2). ✓
**Placeholder scan:** none — the Task-4 `Tester` stub is explicitly replaced in Task 6. ✓
**Type consistency:** `FunnelEntry`/`FunnelVerdict` (T2) used by refresh-runs (T3), view (T4), Tester (T6); `bucket(c, knobs, now)` signature identical (T2/T6); `ProbeCandidate` shape matches between probe (T5) and Tester (T6); `processCandidate` returns `{status,relevance,reason}` at all three call sites (T3). ✓
**Notes:** the live probe fetches+scores ~10/source (wider than refresh) so lowering a slider reveals more — slow but explicit. Funnel persisted is bounded to 200 entries/run. Admin is owner-scoped (no role system).
