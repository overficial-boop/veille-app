# Durable background jobs — design

- **Date:** 2026-06-05
- **Status:** Approved (design); pending implementation plan
- **Scope:** Move the three long dossier pipelines (**assemble**, **brief**, **refresh**) off the SSE request lifecycle and onto a durable, DB-backed job queue with an in-process worker. A job runs to completion regardless of whether the user's tab is open, and survives a server restart (resumed via the existing idempotent handlers). The page becomes a poll-based observer.

## Motivation

Today `assemble` / `brief` / `refresh` run **inside** the SSE route handler — the work is `await`-ed in the stream's `start()`, so it is tied to that one HTTP request. If the user navigates away mid-build (brief generation is the worst case, minutes long), the client `EventSource` closes and the run can be cut short: the dossier is left `building` with partial documents, or with no brief. The data is never corrupted (writes are incremental + idempotent) and re-opening *can* resume it, but the experience is fragile and depends on the client staying connected.

This decouples the work from the client. It is also the **foundation for M2** ("automatic watching on a cadence"): cron will simply enqueue `refresh` jobs on a schedule — the same machinery.

**Chosen approach (over pg-boss and a minimal non-durable decouple):** a hand-rolled durable `jobs` table + in-process worker. It stays in the existing Drizzle / single-process idiom, the progress channel is the same row we already write, and it owns no second migration world. pg-boss's one real advantage — cron — is a small later addition.

## Design

### 1. Storage — `jobs` table (migration 0014)

```ts
// lib/db/app-schema.ts
type JobType   = 'assemble' | 'brief' | 'refresh';
type JobStatus = 'queued' | 'running' | 'done' | 'failed';

jobs {
  id           uuid pk            // uuidv7
  dossier_id   uuid FK→dossiers (cascade)   // subject; also implies owner for auth
  type         text               // JobType
  status       text               // JobStatus, default 'queued'
  params       jsonb              // handler input: { phase, recencyDays?, scope?, autoBrief? }
  progress     jsonb              // JobProgress (see §6): headline + counts + rolling named-step feed
  error        text null
  attempts     integer default 0
  heartbeat_at timestamptz null   // bumped while running → liveness for reap
  created_at   timestamptz default now
  started_at   timestamptz null
  finished_at  timestamptz null
}
```

**Indexes:**
- `idx_jobs_status_created` on `(status, created_at)` — the claim query's scan.
- `idx_jobs_dossier` on `(dossier_id)`.
- **Singleton:** partial **unique** index on `dossier_id` `WHERE status IN ('queued','running')` — at most one active job per dossier, enforced by the DB. Prevents `assemble` and `refresh` racing on the same dossier's documents.

`progress`, `params` are JSONB (additive evolution); everything else is columns — same convention as `facts`/`refresh_runs`.

### 2. Modules

Keep the "pure helpers cannot import `./db`" rule (env validates at import → ZodError in vitest collect):

- **`lib/jobs/policy.ts`** — DB-free, pure, vitest-tested:
  - `shouldReap(job, now, staleMs): boolean` — `status==='running' && heartbeat_at < now - staleMs`.
  - `throttleProgress(last, next, minIntervalMs): boolean` — whether to flush to the DB now (rate-limit writes to ~1–2/s) — but a frame is **always** appended to the in-memory step buffer first, so no named action is dropped from the feed (see §6).
  - `describeProgress(frame): { phase, headline, label }` — maps each `StreamProgress` frame to **French user-facing text** (the narration). Pure + table-driven + fully unit-tested (this is where "name every action" lives).
  - `pushStep(progress, described, cap): JobProgress` — append the described step to the rolling feed (cap ~40), update `headline`/`phase`/`current`/`total`.
  - `JOB_HANDLERS` dispatch map shape (type → which pipeline + how params map) — the mapping is data; the actual handler functions are injected by the worker so this stays db-free.
  - Job/progress TS types.
- **`lib/jobs/store.ts`** — DB-bound CRUD/SQL:
  - `enqueueJob(dossierId, type, params)` → inserts; on the singleton-index conflict returns the existing active job (no duplicate). Returns `{ id, deduped }`.
  - `claimNextJob()` → the atomic `UPDATE … SKIP LOCKED` claim, returns the claimed row or null.
  - `writeProgress(id, progress)` → sets `progress` + `heartbeat_at = now()` (throttled by the caller).
  - `finishJob(id, 'done'|'failed', error?)`.
  - `reapOrphans(staleMs)` → `UPDATE … SET status='queued', heartbeat_at=null WHERE status='running' AND heartbeat_at < now()-staleMs`.
  - `getActiveOrLatestJob(dossierId)` → for the polling endpoint.
- **`lib/jobs/worker.ts`** — the loop + dispatch + lifecycle (below).

### 3. The worker

A claim/run loop, bounded by a **global concurrency `N` (default 2, env `VEILLE_JOB_CONCURRENCY`)**:

```
claim: UPDATE jobs SET status='running', started_at=now(), heartbeat_at=now(), attempts=attempts+1
       WHERE id = (SELECT id FROM jobs WHERE status='queued'
                   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *
```

- `SKIP LOCKED` makes the claim race-free even if N>1 (or, later, more than one process).
- Dispatch by `type` → call the existing `refreshDossier(dossierId, { phase, … })` (assemble/refresh) or `composeDossier(dossierId, { mode:'brief', … })` (brief), passing an `onProgress` that calls `writeProgress` **throttled** (~1s) — which doubles as the heartbeat. `assemble` with `params.autoBrief` chains a `brief` job at the end (enqueue), exactly as the SSE route does today.
- Long single LLM calls between progress frames: a lightweight periodic **heartbeat tick** (~15s) keeps `heartbeat_at` fresh so a live job is never reaped.
- On success → `finishJob('done')`; on throw → `finishJob('failed', message)`. **No automatic retry in v1** (a failed job is surfaced; the user can re-trigger, which is idempotent). Retry/backoff is a later additive change.
- When no job is claimable, sleep (~1.5s) and poll again. (Simple polling loop — no LISTEN/NOTIFY needed at this scale.)

### 4. Startup & restart survival

- Start the worker **once per process** via an idempotent `startJobWorker()` (guarded by a `globalThis.__veille_jobWorker` flag so repeated calls / dev HMR don't spawn duplicates), called from the **job route handlers** (the `GET …/job` status poll + the three enqueue routes). **Not** from `instrumentation.ts`: Next does not apply `serverExternalPackages` to the instrumentation bundle, so pulling the engine (`jsdom`/`pg`) through the worker there fails to compile (`Can't resolve 'http'` via `jsdom → agent-base`). The `nodejs` route bundles externalize those packages correctly — the same way the old SSE routes imported the engine. Since the client always polls `…/job` (on mount and after every enqueue), the worker is alive whenever there is work. *(Trade-off vs. instrumentation: the worker starts on the first job-route request after a boot, not at boot. Fine for M1; M2's cron scheduler will be the always-on starter.)*
- On first start (and thus after a restart, on the first job-route request), **reap orphans** once: `reapOrphans(staleMs ≈ 2 min)` — any `running` job whose heartbeat is stale (its process died mid-run on a deploy/crash) is reset to `queued`. The worker re-claims it and the **idempotent handlers resume**: `upsertDocument` skips existing URLs, `ensureDocumentCore`/`extractFactsForDocument` short-circuit on done docs, the brief is re-synthesized. With heartbeats every ~15s and a 2-min threshold, a *live* job is never falsely reaped.

### 5. Triggering — routes enqueue, no longer run inline

The `assemble` / `brief` / `refresh` routes stop `await`-ing the pipeline in an SSE stream. Each becomes a small **POST that enqueues** the corresponding job (with params) and returns `{ jobId, deduped }` immediately (HTTP 202). If an active job already exists for the dossier, the singleton returns it.

- **Dossier creation:** enqueue an `assemble` job (carrying `autoBrief`) instead of opening the assemble SSE.
- **"Rafraîchir" / "Générer le brief":** enqueue `refresh` / `brief` jobs (with their existing params — `recencyDays`, `scope`).
- `dossier.status` (`building` | `active`) remains the user-facing summary, driven by the handlers as today (assemble flips `active` at the end). The job table is the mechanism underneath.

The old SSE `ReadableStream` plumbing in these three routes is removed.

### 6. Progress — a fully narrated activity feed (polled)

**Requirement:** during creation the user must *feel* the volume of work — every action named, so a multi-minute wait reads as "a lot is being done for me," not "is this stuck?"

**Progress shape (`progress` jsonb):**
```ts
type JobStep = { at: string; label: string };        // ISO time + French narration
type JobProgress = {
  phase: 'planning' | 'searching' | 'reading' | 'analyzing' | 'writing' | 'done';
  headline: string;                                   // e.g. "Analyse des documents — 3 / 21"
  current?: number; total?: number;                   // drives the bar when known
  steps: JobStep[];                                   // rolling, newest-last, capped ~40
};
```

**Narration — `describeProgress(frame)` maps every emitted frame to text** (subject language; French examples):

| frame | phase | step label (named action) |
|---|---|---|
| job start | `planning` | "Préparation de la veille…" |
| `source-start { label }` | `searching` | "Recherche : {label}" |
| `document { title, status }` | `reading` | "Lecture et évaluation : {title}" (+ "— retenu" / "— écarté") |
| `brief-doc { index, total, title }` | `analyzing` | "Analyse du document {index}/{total} : {title}" |
| `synthesis { state:'start' }` | `writing` | "Rédaction de la synthèse…" |
| `source-error { label }` | (unchanged) | "Source indisponible : {label}" (non-fatal, shown) |
| job done | `done` | "Veille prête." |

`headline`/`current`/`total` track the dominant phase (e.g. `reading` shows "{kept} sources retenues", `analyzing` shows "{index} / {total}"). Every frame is **appended to `steps`** before throttling, so even rapid concurrent frames (the parallel enrichment pool) each leave a named line — the feed visibly *streams* activity. DB writes are throttled (~1–2/s, plus an immediate flush on phase change) so the row isn't hammered.

**Endpoint:** `GET /api/dossiers/[slug]/job` → `getActiveOrLatestJob`, owner-authorized → `{ id, type, status, progress, error }` or `null`.

**Client (`DossierRuntime`):** replaces `EventSource` with a **poll hook** (~1.5s while `queued|running`). The creation view renders:
- a **headline + progress bar** (indeterminate until `total` is known),
- a **live activity feed** — the `steps` list, console-like, newest at the bottom, greyed timestamps — this is the "lots happening" indicator,
- a calm reassurance line tied to the whole point: **"Vous pouvez fermer cet onglet — la veille se construit en arrière-plan."**

On `done` → `router.refresh()`; on `failed` → show `error` + a "Réessayer" that re-enqueues (idempotent).

- The existing StrictMode deferred-start logic is no longer needed for correctness (the job runs server-side regardless), but the page still **auto-enqueues** an assemble job if it loads a `building` dossier with no active job (self-heal for any dossier left mid-build by the old path).

### 7. Scope

- **Only the three long pipeline ops become jobs.** On-demand fiche actions — document **analyze**, **factcheck**, **elaborate**, and ad-hoc **pull / mode recherche** — stay **synchronous** (short, user-initiated in-context, the user is watching).
- **No automatic retry, no cron** in v1. Cron (M2) and retry/backoff are additive later: cron = a scheduler that calls `enqueueJob(dossierId, 'refresh', …)` for dossiers whose cadence is due.

### 8. Testing

- **Pure (vitest, `lib/jobs/policy.test.ts`):** `shouldReap` (stale vs fresh vs non-running), `throttleProgress` (interval gating), `describeProgress` (every frame type → expected phase + French label, incl. status suffix and the start/done sentinels), `pushStep` (append, cap at ~40, headline/current/total update), the dispatch-map shape.
- **DB-bound (manual / light integration):** the `SKIP LOCKED` claim (two concurrent claims never grab the same job), singleton dedup (second enqueue returns the first), reap re-queues a stale running job. Exercised against the dev DB; not in the pure suite (which can't import `./db`).
- **Manual end-to-end:** create a dossier → close the tab → reopen → it completed; kill `next dev` mid-job → restart → the job reaps + resumes to completion.

## Risks / caveats

- **Single VPS / single process** is assumed (matches deploy: `next start`). `SKIP LOCKED` already makes the design correct for >1 worker/process if that ever changes.
- **Worker double-start (dev HMR / many routes calling `startJobWorker`):** mitigated by the `globalThis` guard. If the worker somehow runs twice, `SKIP LOCKED` + the singleton index keep it correct (just wasted polling).
- **Worker not started via `instrumentation.ts`:** that bundle doesn't honor `serverExternalPackages`, so the engine's `jsdom`/`pg` fail to compile there. Started from the `nodejs` job routes instead (see §4).
- **Reap threshold vs. genuinely slow ops:** the ~15s heartbeat must fire even during a long single LLM call — the periodic tick (not just `onProgress`) guarantees this. If an op could exceed 2 min between *any* heartbeat, raise the threshold; with the tick it won't.
- **Vestigial:** the assemble/brief/refresh SSE routes' streaming code is deleted, not left inert (they're replaced by enqueue). The `StreamProgress` type stays (the worker still produces the same progress frames, now written to the row).

## Out of scope (later, additive)

- Cron / cadence-driven auto-refresh (M2) — enqueues `refresh` jobs.
- Automatic retry with backoff.
- LISTEN/NOTIFY instead of poll-claim (only if the poll loop ever shows latency).
- Multi-process / multi-machine workers.
