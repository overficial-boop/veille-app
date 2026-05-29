# Veille M1 — The Body (intent → plan → present → refresh)

- **Date:** 2026-05-29
- **Status:** **Approved** — six open decisions resolved with the user (2026-05-29); see §10.
- **Builds on:** M0 (foundation: Next 15 + better-auth + Postgres/Drizzle; ported core/adapters/discovery; `dossiers`/`sources`/`facts` tables already migrated).

---

## 1. Goal

Make ONE living dossier real and good: a signed-in user types an intent, watches a dossier assemble itself, reads it in the right template (Profile or Chronology, or the universal Feed), and hits **Refresh** to pull in genuinely new, dated, cited facts. No cron, no semantic novelty, no library yet (those are M2/M4). This is the milestone that proves the output is worth automating.

## 2. Scope

**In:** dossier creation from intent; the expanded planner (sources + template + cadence); Postgres-backed extraction/refresh (new `refreshDossier`); the Feed + Profile + Chronology templates with auto-pick + user override (at creation *and* after); manual refresh with URL+exact dedup; streaming (SSE) assembly + refresh; the new-dossier and dossier-detail UI.

**Out:** automatic/scheduled watching + semantic novelty (M2); domain connectors (M3); shared library / subscribe / fork (M4); the temporary `/api/smoke/extract` route (delete it in this milestone).

## 3. The flow

1. **Home** lists the user's dossiers + a "Nouveau dossier" entry (intent input + an optional **advanced panel**).
2. **Create:** user submits an intent → the **planner** returns `{ template, sources[], cadence, subjectName }` → if the user opened the advanced panel they may adjust the template and add/remove sources first → we persist the `dossier` (status `building`) + its `sources` (auto-accepted, no triage) → redirect to the dossier page.
3. **First assembly = the first refresh, streamed (SSE):** the dossier shell renders **instantly** (subject, template, source list); facts **stream in live** as each source resolves. This is the "see results directly" moment — reuse the old app's `/review/stream` SSE pattern.
4. **Read:** the dossier renders in its chosen template; a **template switcher** and the advanced "sources & plan" panel are available but never block reading.
5. **Refresh:** re-walks sources (standing re-run their query/feed/channel; item only under force), dedups, streams in new dated facts (same SSE pattern).

## 4. The planner (`@veille/discovery`)

Add `planDossier(intent, { language }) → DossierPlan` alongside the existing `plan-queries.ts` (reuse it for the Tavily-query generation):

```ts
type DossierPlan = {
  template: 'profile' | 'chronology' | 'feed';
  sources: PlannedSource[];     // capped at 3 + any explicit items (§10.3)
  cadence: string | null;        // suggested rhythm; RECORDED ONLY in M1
  subjectName: string;           // derived from intent, for Profile header / dossier name
};
type PlannedSource =
  | { connector: 'tavily'; kind: 'standing'; input: { query: string; days?: number; topic?: string }; label: string }
  | { connector: 'youtube-channel'; kind: 'standing'; input: { channelId: string }; label: string }
  | { connector: 'rss'; kind: 'standing'; input: { feedUrl: string }; label: string }
  | { connector: 'web' | 'youtube' | 'pdf'; kind: 'item'; input: { url: string }; label: string };
```

M1 planner behaviour (general connectors only):
- Emit **≤3 Tavily standing searches** (via the existing query planner — terminology/decomposition/temporal/regional).
- If the intent contains explicit URLs → add them as **item** sources (routed by adapter `matches()`), on top of the ≤3 cap.
- **Template:** classified in the *same* planner LLM call (no extra round-trip) → person/entity ⇒ `profile`, chronology-shaped ⇒ `chronology`, else `feed`. **Keyword guardrail:** if the intent literally contains "chronologie / timeline / affaire" (and obvious equivalents), force `chronology`. Always user-overridable (§6).
- YouTube-channel / RSS standing sources only when the intent makes one obvious (e.g. a channel handle); never fabricate feeds.

## 5. The refresh engine — new `refreshDossier` (`apps/web/lib/refresh.ts`)

Postgres-native orchestrator. Reuses the discovery providers + adapters + dedup logic, but **not** the ported file-store `operations.runRefresh` (that stays as reference; the data models diverge too much — §10.6).

```
refreshDossier(dossierId, { force?, onProgress }):
  load dossier + sources from Postgres
  seen = set of existing fact.sourceUrl for this dossier        // dedup key set
  for each source where (kind==='standing') OR (kind==='item' && !lastExtractedAt) OR force:
    if standing: run provider (tavily/rss/youtube-channel) → candidate URLs
                 → drop URLs already in `seen` or already a source input
                 → for each fresh URL: extract via findAdapter({kind:'url',url}) → facts
    if item:     extract(source.input.url) → facts
    dedup facts by (sourceUrl + exact text), and by (timestampStart,timestampEnd,text) where present
    insert new facts (UUIDv7, extractedAt, extractedBy); emit onProgress
    set source.lastExtractedAt
  set dossier.refreshedAt; if status==='building' → 'active'
```

`onProgress` drives the SSE stream (assembly + refresh share this). **Novelty in M1 = URL + exact-text dedup only**; semantic novelty is M2.

## 6. Presentation (template registry) — auto-pick + user ownership

`apps/web/components/templates/` — a registry mapping `template` → a component `(dossier, facts) → JSX`:

- **Feed** (universal): reverse-chronological facts; each row = text + date (provenance `publishedAt`/`extractedAt`) + source link + confidence. Always selectable.
- **Profile:** header (`subjectName`) → "key facts" (highest-confidence / most-cited) → a timeline of dated facts.
- **Chronology:** strictly date-ordered events, each cited.

The planner auto-picks, **but the choice is the user's to make** (their call: ownership raises satisfaction). So the template chooser appears **both** in the advanced panel at creation **and** as a switcher on the dossier page (persists `dossiers.template`). The registry is extensible (add a template = one entry + one component).

## 7. Persistence / operations (`apps/web/lib/`)

`lib/dossiers.ts` grows: `createDossier(ownerId, plan, intent)`, `getDossier(ownerId, slug|id)`, `listFacts(dossierId)`, `listSources(dossierId)`, `addSource`, `removeSource`, `setTemplate`, plus `refreshDossier` (§5). All owner-scoped. Slugs: derive from `subjectName` (reuse core `slugify`), unique per owner.

## 8. Component boundaries

- **Planner** (`discovery/planDossier`) — intent → plan. No persistence, no extraction.
- **Adapters** (`@veille/adapter-*`) — unchanged; `extract(input) → Fact[]`.
- **Refresh engine** (`lib/refresh.ts`) — providers + adapters + dedup + Postgres writes; the only place extraction + persistence meet; emits progress.
- **Dossier store** (`lib/dossiers.ts`) — the only SQL.
- **Templates** (`components/templates/*`) — pure render of (dossier, facts). No data access.
- **Routes/actions** (`app/`) — translate HTTP/SSE ⇄ the above.

## 9. Error handling

- Planner returns no usable sources → friendly "reformulez ou ajoutez une source" state, dossier still created (empty), user can add a source manually.
- A source fails → keep going; leave its `lastExtractedAt` unset to retry next refresh (idempotent).
- YouTube via Supadata; blank-title videos acceptable.
- All sources fail on a refresh → surface it; don't mark success.
- Every route owner-scopes; 404 a dossier that isn't the caller's.

## 10. Resolved decisions (settled with user, 2026-05-29)

1. **First-assembly UX → Stream (SSE).** Dossier shell instant; facts stream in live. Reuse the old `/review/stream` pattern. (Refresh uses the same SSE — former Decision 5, now folded in.)
2. **Template selection → LLM-classified (in the existing planner call) + keyword guardrail** for chronology. **Plus:** the user can choose the template themselves at creation (advanced panel) and after (switcher) — their choice increases satisfaction (§6).
3. **Planner aggressiveness → cap ≤3** Tavily searches + any explicit URLs/channels named in the intent.
4. **Advanced panel → add/remove source + template switch.** Defer richer per-source editing (query text, reorder, Tavily days/topic) to a later milestone.
5. *(folded into #1)* **Refresh trigger UX → SSE progress**, same pattern as assembly.
6. **Refresh engine → new Postgres-native `refreshDossier`** reusing providers/adapters/dedup; do not retrofit the file-store `runRefresh`.

## 11. Testing

- Planner: intent → well-formed `DossierPlan`; person-intent ⇒ profile, chronology-intent ⇒ chronology; ≤3 sources cap respected.
- Refresh engine (test Postgres): standing source surfaces new URLs across two runs; exact dedup drops repeats; idempotent (second refresh with no new candidates adds nothing); failed source retries.
- Templates: render Feed/Profile/Chronology from a fixed fact fixture.
- End-to-end smoke: build a padel-player **Profile** dossier and an *affaire* **Chronology** dossier; both read well, cite correctly, refresh surfaces new facts without dupes.

## 12. Definition of done

A signed-in user types an intent, watches a dossier assemble (streamed), reads it in the right template with every fact dated + cited, can switch templates / add a source, and hits Refresh to see new facts appear (no dupes). The two proving-ground dossiers feel good enough to want the M2 heartbeat.
