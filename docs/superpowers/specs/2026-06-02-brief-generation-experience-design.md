# Brief-generation experience — host citations + card enrichment + streamed progress — design

- **Date:** 2026-06-02
- **Status:** Approved (design); pending implementation plan
- **Milestone:** Curation reframe — quality pass on the on-demand brief (sits beside ③ state-watch; not a new phase).
- **Scope:** Make "Générer le brief" produce **readable, properly-cited** output, **enrich the document cards** (pitch + fact count), and **stream the work live**. One unifying change: the button becomes a streamed **enrich-then-synthesize** pass.

## Motivation

After "Générer le brief" finished on a real dossier (Violences post PSG-Arsenal), three problems surfaced:

1. **Unreadable brief.** The model emitted citations as bare bracketed host lists — `[apnews.com, smobserved.com]` — instead of the Markdown links the prompt asked for. The citation system (`lib/citations.ts`, `components/cited-markdown.tsx`) only recognizes `[text](url)` links, so the raw brackets render as literal text ("huge block with lots of []") and the "Afficher les sources" toggle has nothing to toggle. Root cause: **gemini-2.5-flash does not follow the inline-link instruction** when many sources back one sentence — it cites by publication.
2. **Cards show no value.** Document cards have no pitch and no fact count, even right after brief-gen extracted facts. The pitch (`shortSummary`) is only generated when a fiche is opened; the fact count is never queried (`listDocumentsByStatus` selects document rows with no join to `facts`).
3. **Frozen wait.** Brief-gen is a plain server action: the button shows "Rédaction…" for ~30–60s (6 fact extractions + 1 synthesis on that dossier) with no feedback.

## Decisions (from brainstorming)

- **Scope:** all three threads in **one spec**.
- **Attribution style:** keep **numbered superscripts ¹² + the "Afficher les sources" toggle** — just make it work. The toggle reveals the superscripts **and a numbered "Sources" list under the brief** (there is no longer an evidence section — the curation reframe removed it; the page renders only brief + cards). This finally surfaces `source_notes`, which the brief step already generates but nothing displays today.
- **Card pitch:** a **generated teaser** (`shortSummary`), folded into the brief-gen loop (not the free relevance reason).
- **Progress UI:** **inline, replacing the CTA** — the card expands in place into a live step list, then becomes the finished brief.
- **Citation architecture:** **host-based** — number citations by publication (matching the host-keyed `source_notes` + the new Sources list), and render the model's `[host, host]` tags as superscripts. (Rejected: hardening the prompt for URL links — demonstrably drifts; structured `[^n]` footnotes — more drift risk + changes prose format.)

## Design

### Unifying model — streamed enrich-then-synthesize

`composeDossier(mode:'brief')` already loops over the target documents (scope or all kept) ensuring facts. Extend that loop to also ensure the **core** (`analyzeDocumentCore` → `setDocumentCore`, which yields `shortSummary`), and stream per-doc progress, then write the host-cited brief. Both per-doc steps stay **idempotent** (only missing work runs), so re-runs are fast.

### A. Host-based citations

**Numbering — `lib/citations.ts`.** Add a host-keyed builder alongside the existing URL one:

```
buildHostCitations(brief: string|null, factHosts: string[]): Record<string /*host*/, number>
```

Number each host by **first appearance of a `[host]` tag in the brief**, then any remaining `factHosts` not yet seen — mirroring today's `buildCitationNumbers` ordering, but keyed by host. `factHosts` = the distinct hosts present in the dossier's facts (`hostOf(fact.sourceUrl)`), so a publication cited in the brief and one only present in the facts both get a stable number. The page passes this map to the Brief (superscripts) and the Sources list, so both surfaces use one number per publication.

**Prompt — `lib/synthesis.ts` `buildBriefPrompt`.** Replace the "attribute with a Markdown link to its EXACT URL" instruction with: cite each claim with the publication tag(s) in square brackets, using the **exact `## host` headers** provided in FACTS BY PUBLICATION — e.g. `[lefigaro.fr]` or grouped `[lefigaro.fr, apnews.com]`. Use only those tags; never invent. (The `renderGroups` `## host` headers already supply the exact tokens.)

**Rendering — `components/cited-markdown.tsx` + `components/brief.tsx`.** A preprocessor converts host tags into the **existing** numbered-superscript pipeline so we reuse `citeComponents` + the `.show-src` toggle untouched (the journal no longer renders inline citations, so this is brief-only):

- `renderHostCitations(markdown, hostNumbers)` scans for `[token]` / `[token, token, …]` groups. For each token that is a **known host** (in `hostNumbers`), replace it with a Markdown link whose text is the host and whose href is the in-page citation anchor `#cite-<host>`; a group becomes a run of such links. Tokens that are **not** known hosts are left as literal text (graceful — a stray `[note]` never breaks).
- The `citations` map handed to `citeComponents` is keyed by those hrefs (`#cite-<host>` → number), so each renders as `<sup>n</sup>` exactly as today. The superscript links to the in-page Sources-list entry (`#cite-<host>`); tooltip = host.
- `prepareCiteMd` (tighten the space before a citation) continues to run.
- **Belt-and-suspenders:** still also handle real `[text](url)` links the model occasionally emits (keep the current `a`-override path), so mixed output degrades gracefully. `stripUnknownLinks` is retained for any stray URL links.

**Sources list — new, under the brief (`components/brief.tsx` or a sibling rendered by it).** A numbered list revealed by the same `.show-src` toggle: for each host in `hostNumbers` (ordered by number), one row — `n · <publication host> · <source_note one-liner, if any> · lien`, with `id="cite-<host>"` so the superscripts jump to it. The outbound link is the publication's **representative source URL** (the first fact URL for that host). Hosts cited in the brief and hosts only present in the facts both appear, so the toggle reveals the full source basis. This is the only consumer of `source_notes`.

### B. Card enrichment

**Fact count — `lib/documents.ts` `listDocumentsByStatus`.** After selecting the non-rejected rows, run one grouped count of `facts` by `document_id` for the dossier and attach `factCount` to each row. `Doc` gains `factCount: number`. (Keep it one extra query, not a per-row N+1.)

**Card — `components/curation.tsx` `KeptFeed`.** The pitch line already renders `d.shortSummary` when present (now populated by the brief-gen pass). Add a **"N faits"** marker in `.doc-foot` when `factCount > 0` (alongside the date/badges). No fallback pitch — before enrichment a card simply shows no teaser.

### C. Streamed brief generation

**Progress events — `lib/synthesis.ts`.** Extend `SynthesisProgress` (or add a sibling union) with per-doc enrichment frames, e.g.:

```
{ type:'brief-doc'; index:number; total:number; title:string; step:'core'|'facts'|'skip' }
```

In the brief-mode loop, for each target doc lacking it: `analyzeDocumentCore` + `setDocumentCore` (pitch), then `extractFactsForDocument` (facts), emitting a frame per doc; then the existing `{ type:'synthesis'; phase:'brief'; state:'start'|'done' }` around the synthesis call.

**SSE route — `app/api/dossiers/[slug]/brief/route.ts`** (new). GET → `ReadableStream` of `data: <json>` frames, mirroring the assemble/refresh routes: auth + owner check, then `composeDossier(dossier.id, { mode:'brief', language, onProgress: send })`, close on completion/error.

**Inline UI — `components/curation.tsx` `GenerateBriefCta`.** Becomes a client island that, on click, opens an `EventSource` to the brief route and renders a live step list **in place** of the CTA body:

- `Analyse des documents — i/N · <titre>` (driven by `brief-doc` frames),
- `Rédaction de la synthèse…` (driven by the `synthesis:start` frame),
- on stream close: `router.refresh()` so the brief + enriched cards render.

Reuse the SSE-handling shape from `DossierRuntime` (deferred-start + close-on-unmount lessons from the assemble fix apply; factor a small shared hook if it reads cleanly, otherwise inline). A pending/disabled state prevents double-fire.

**Scope of streaming.** Only the **first-generation** CTA (enrich-heavy) streams. The rail's **"Réécrire"** (`regenerateBriefAction` — one synthesis call over existing facts) stays a simple `useTransition` action with a spinner. If the rail also exposes a first-time "Générer le brief", point it at the same streamed flow.

## Schema impact

**None.** `documents.short_summary`, `documents.review/bullets`, the `facts` table, and `dossiers.source_notes` (host-keyed) all already exist. The fact count is a query; host citations reuse `source_notes` + facts. No migration.

## Edge cases

- **Unknown bracket token** (typo host, or a literal `[note]`) → rendered as plain text, no broken superscript.
- **Mixed output** (model emits a real `[text](url)` link) → still rendered via the retained link path.
- **0 kept docs** → nothing to enrich; synthesis skips; quiet "rien à synthétiser" state (existing skip path).
- **Re-run brief-gen** → core/facts only generated where missing (idempotent), fast; brief rewritten.
- **Long enrichment** (many kept docs) → SSE keeps the connection open; the step list shows progress; no server-action timeout.
- **A host in the brief with no facts** (shouldn't happen — tags come from the fact groups) → unknown-token path (plain text), and no Sources row.
- **A host with facts but no `source_note`** → Sources row shows publication + link, no one-liner.

## Testing & verification

- **Unit (vitest, pure):**
  - `buildHostCitations` — brief-first ordering, then remaining fact hosts; stable numbers.
  - `renderHostCitations` — single + grouped tags → superscript links; **unknown tokens pass through**; real Markdown links untouched.
  - fact-count attach — a pure shaping helper over `{docId→count}` if extracted; otherwise covered live.
- **Live:** "Générer le brief" on a fresh dossier streams `Analyse i/N` then `Rédaction…`; the brief renders with working ¹² superscripts; toggling "Afficher les sources" reveals the superscripts + the numbered Sources list (with `source_note` one-liners), and a superscript jumps to its Sources row; cards show a pitch + "N faits"; re-run is fast.
- **Gate:** typecheck · `pnpm test` · build (dev stopped) — no migration.

## Out of scope

- Per-claim (sentence-level) citation granularity — citations stay at the publication level.
- Regenerate/"Réécrire" streaming (stays a spinner).
- Generating review/bullets/factchecks eagerly for every card beyond what `analyzeDocumentCore` already returns (review/bullets come along with the core; elaboration + factchecks stay on-demand at the fiche).
- Any schema/migration work.

## Integration points to resolve in the plan

1. `buildBriefPrompt` wording + whether `renderGroups` host headers need a tweak to guarantee clean `[host]` tokens.
2. The cleanest place for `renderHostCitations` (in `cited-markdown.tsx`); how `page.tsx` builds the host data — `hostNumbers` (`buildHostCitations`), the per-host representative URL (first fact URL), and `source_notes` — and threads it to Brief (superscripts) + the new Sources list.
3. `composeDossier` progress-event shape + reusing the assemble/refresh SSE client pattern for the inline CTA (shared hook vs inline).
4. `listDocumentsByStatus` fact-count query shape + `Doc` type update + every call site that destructures `Doc`.
