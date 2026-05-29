# Veille M1 — The Body (intent → plan → present → refresh)

- **Date:** 2026-05-29
- **Status:** **DRAFT — autonomous head-start, awaiting user review.** Drafted from the agreed design in the M0 spec (§2 north-star, §6 "M1 — The Body") and the brainstorm. The **Open Decisions** section (§10) lists calls I deliberately did *not* make alone — resolve those before implementation.
- **Builds on:** M0 (foundation: Next 15 + better-auth + Postgres/Drizzle; ported core/adapters/discovery; `dossiers`/`sources`/`facts` tables already migrated).

---

## 1. Goal

Make ONE living dossier real and good: a signed-in user types an intent, watches a dossier assemble itself, reads it in the right template (Profile or Chronology, or the universal Feed), and hits **Refresh** to pull in genuinely new, dated, cited facts. No cron, no semantic novelty, no library yet (those are M2/M4). This is the milestone that proves the output is worth automating.

## 2. Scope

**In:** dossier creation from intent; the expanded planner (sources + template + cadence); Postgres-backed extraction/refresh (re-pointing `operations.runRefresh`); the Feed + Profile + Chronology templates with auto-pick + override; manual refresh with URL+exact dedup; the new-dossier and dossier-detail UI.

**Out:** automatic/scheduled watching + semantic novelty (M2); domain connectors (M3); shared library / subscribe / fork (M4); the temporary `/api/smoke/extract` route (delete it in this milestone).

## 3. The flow

1. **Home** lists the user's dossiers + a "Nouveau dossier" entry (intent input).
2. **Create:** user submits an intent → the **planner** returns `{ template, sources[], cadence }` → we persist the `dossier` (status `building`) + its `sources` (auto-accepted, no triage) → redirect to the dossier page.
3. **First assembly = the first refresh:** extraction runs over the new sources; facts stream into the dossier as they land (see §10 for sync-vs-streaming decision).
4. **Read:** the dossier renders in its chosen template; a template switcher and an advanced "sources & plan" panel are available but never block reading.
5. **Refresh:** re-walks sources (standing sources re-run their query/feed/channel; item sources only under force), dedups, surfaces new dated facts.

## 4. The planner (`@veille/discovery`)

Add `planDossier(intent, { language }) → DossierPlan` alongside the existing `plan-queries.ts` (reuse it for the Tavily-query generation):

```ts
type DossierPlan = {
  template: 'profile' | 'chronology' | 'feed';
  sources: PlannedSource[];     // 1–N, auto-accepted
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
- Always emit **1–3 Tavily standing searches** (via the existing query planner — terminology/decomposition/temporal/regional).
- If the intent contains explicit URLs → add them as **item** sources (routed by adapter `matches()`).
- Template selection: see §10 (planner-driven vs rules). Default lean: ask the LLM to classify intent shape → person/entity ⇒ `profile`, "chronologie/timeline/affaire" ⇒ `chronology`, else `feed`.
- YouTube-channel / RSS standing sources only when the intent makes one obvious (e.g. a channel handle); otherwise skip — don't fabricate feeds.

## 5. The refresh engine (Postgres-backed)

Re-point the ported `operations.runRefresh` (or write a thin web-side `refreshDossier`) to read/write Postgres instead of the file store:

```
refreshDossier(dossierId, { force? }):
  load dossier + sources from Postgres
  seen = set of existing fact.sourceUrl for this dossier   // dedup key set
  for each source where (kind==='standing') OR (kind==='item' && !lastExtractedAt) OR force:
    if standing: run provider (tavily/rss/youtube-channel) → candidate URLs
                 → drop URLs already in `seen` or already a source input
                 → for each fresh URL: extract via findAdapter({kind:'url',url}) → facts
    if item:     extract(source.input.url) → facts
    dedup facts by (sourceUrl + exact text) and by (timestampStart,timestampEnd,text) where present
    insert new facts (UUIDv7, extractedAt, extractedBy)
    set source.lastExtractedAt
  set dossier.refreshedAt; if status==='building' → 'active'
```

Callbacks (`onProgress`/`onSourceComplete`/etc.) already exist on `runRefresh` — the web surface formats them (SSE or await; §10). **Novelty in M1 = URL + exact-text dedup only**; semantic novelty is M2.

## 6. Presentation (template registry)

`apps/web/components/templates/` — a registry mapping `template` → a component `(dossier, facts) → JSX`:

- **Feed** (universal): reverse-chronological facts; each row = text + date (from provenance `publishedAt`/`extractedAt`) + source link + confidence. Always selectable for any dossier.
- **Profile:** header (`subjectName`) → "key facts" (highest-confidence / most-cited) → a timeline of dated facts. The Jules-Marie shape.
- **Chronology:** strictly date-ordered events, each cited. The *affaire* shape.

Auto-picked from the plan; a switcher on the dossier page overrides (persists `dossiers.template`). The registry is extensible (add a template = one entry + one component).

## 7. Persistence / operations (`apps/web/lib/`)

`lib/dossiers.ts` grows: `createDossier(ownerId, plan, intent)`, `getDossier(ownerId, slug|id)`, `listFacts(dossierId)`, `listSources(dossierId)`, `setTemplate`, plus `refreshDossier` (above). All owner-scoped. Slugs: derive from `subjectName` (reuse core `slugify`), unique per owner.

## 8. Component boundaries

- **Planner** (`discovery/planDossier`) — intent → plan. No persistence, no extraction.
- **Adapters** (`@veille/adapter-*`) — unchanged; `extract(input) → Fact[]`.
- **Refresh engine** (`lib/refresh.ts` wrapping ported `runRefresh`) — orchestrates providers + adapters + dedup + Postgres writes. The only place extraction + persistence meet.
- **Dossier store** (`lib/dossiers.ts`) — the only SQL.
- **Templates** (`components/templates/*`) — pure render of (dossier, facts). No data access.
- **Routes/actions** (`app/`) — translate HTTP ⇄ the above.

## 9. Error handling

- Planner returns no usable sources → friendly "reformulez ou ajoutez une source" state, dossier still created (empty), user can add a source manually.
- A source fails → keep going; leave its `lastExtractedAt` unset to retry next refresh (idempotent).
- YouTube via Supadata; blank-title videos acceptable.
- All sources fail on a refresh → surface it; don't mark success.
- Every route owner-scopes; 404 a dossier that isn't the caller's.

## 10. Open decisions (resolve with user before building)

1. **First-assembly UX — sync or streaming?** "See results directly" argues for showing the dossier shell immediately and **streaming facts in** (SSE, like the old `/review/stream`). Simpler alternative: block on creation until the first extraction finishes, then render. *Lean: streaming.*
2. **Template selection — LLM-classified vs rule-based?** *Lean: LLM classifies, with a keyword fallback ("chronologie/timeline/affaire" ⇒ chronology).*
3. **How aggressive is the planner?** Cap auto-created sources (e.g. ≤3 Tavily searches + any explicit URLs/channel)? *Lean: yes, ≤3 + explicit items, to keep cost/noise down.*
4. **Advanced panel in M1 — editable or view-only?** Editing sources/template adds surface. *Lean: view + add/remove source + template switch; defer richer editing.*
5. **Refresh trigger UX** — a button with a spinner vs streamed progress. *Lean: reuse the SSE progress pattern from the old app.*
6. **Re-point `runRefresh` vs new `refreshDossier`?** The ported `runRefresh` is file-store-coupled. *Lean: write a Postgres `refreshDossier` that reuses the provider/adapter/dedup logic, rather than retrofitting the file-store function.*

## 11. Testing

- Planner: intent → well-formed `DossierPlan`; person-intent ⇒ profile, chronology-intent ⇒ chronology; ≤ cap sources.
- Refresh engine (test Postgres): standing source surfaces new URLs across two runs; exact dedup drops repeats; idempotent (second refresh with no new candidates adds nothing); failed source retries.
- Templates: render Feed/Profile/Chronology from a fixed fact fixture.
- End-to-end smoke: build a padel-player **Profile** dossier and an *affaire* **Chronology** dossier; both read well, cite correctly, refresh surfaces new facts without dupes.

## 12. Definition of done

A signed-in user types an intent, watches a dossier assemble, reads it in the right template with every fact dated + cited, hits Refresh and sees new facts appear (no dupes), and can switch templates / add a source. The two proving-ground dossiers feel good enough to want the M2 heartbeat.
