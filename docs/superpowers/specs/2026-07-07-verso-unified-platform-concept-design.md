# Verso — unified platform concept

**Date:** 2026-07-07
**Status:** North star (Stage 0). Approved as concept; no implementation committed.
**Scope:** Reconciles four projects — veille-app, verso-ink, simpleyt, and the old veille Flutter app — into one product concept.

---

## 1. Why

Four codebases turned out to be one pipeline built four times:

```
sources → extraction (with provenance) → facts → synthesis → output
```

| Project | What it is | Its slice of the pipeline |
|---|---|---|
| veille-app | Living dossiers (Next.js monorepo, mid-M1) | The durational version: intent → auto-picked sources → cited Facts → refreshing dossier |
| verso-ink | AI writing command center (Phase 2 complete) | The output half: Brief → Web Search → Fact Sheet → Plans → Draft → claim-level Verify |
| simpleyt | Desktop one-shot YouTube analyzer (Tkinter) | The degenerate case: one URL → transcript → one analysis |
| veille Flutter app | Old mobile prototype (frozen) | The mobile face: dossiers, reviews, discovery on-device |

verso-ink's "Fact Sheet" is a one-shot dossier; simpleyt is a hand-cranked YouTube adapter; the Flutter app is a mobile client of the dossier concept. The seam is real: **knowledge gathering produces grounded facts; everything a user makes consumes them.**

## 2. Decisions (made 2026-07-06/07, with reasoning)

1. **One platform, several faces** — shared backend + Fact/dossier engine; surfaces are clients of the same account and data.
2. **The dossier is the workspace.** Users compose each dossier by adding modules, when they want. The veille UX principle — *smart default + always overridable + extensible library* — is promoted from sources/templates to the whole product.
3. **All three module slots**: Sources (knowledge in), Views (how it reads), Studios (what it produces).
4. **Gathering first.** The knowledge is the product; every output is a *result*. The brand and UI must not drag the center of gravity toward "writing app."
5. **Dossier owns everything** (rejected: a separate "Works" shelf). Rationale: most outputs are for the user to read, not publishable pieces; "when does something become a Work?" is a confusing boundary. Cross-dossier needs are met by **cross-referencing** (dossier-as-source) instead.
6. **Name: Verso** (from verso.ink; the ".ink" de-emphasized). Not French-branded, not writer-branded. Taglines/positioning parked for later. ⚠️ Do a trademark sanity-check against Verso Books (adjacent space) before investing in the brand.
7. **Mobile: none in v1.** Later, a *companion* (read, notify, share-sheet capture) — not a full client. The old Flutter app stays frozen as the reference sketch.
8. **Horizon: concept-only now** (this document); later, **continuity path**: veille-app's codebase *becomes* Verso. No fresh platform repo, no big-bang merge.

## 3. The concept

**Verso** is one product: a place where you keep **living dossiers** on the subjects you care about. A dossier gathers knowledge automatically from sources you attach, keeps itself current, and — when asked — *does things* with what it knows: briefs you, digests the week, drafts an article, all grounded in its accumulated, cited facts.

Pitch: **"Tell Verso what to follow. It builds the dossier. Everything you make starts from what it knows."**

There is exactly one top-level object. Persona: professional users internationally (journalists, analysts, creators) — an intelligence tool that happens to write brilliantly when asked.

## 4. Object model

```
Dossier
├── intent            "follow Premier Padel's 2026 season"
├── Sources[]         module slot — where knowledge comes in
│     youtube-channel · rss · web-search · single URL/PDF/text
│     · another dossier (cross-reference)
├── Facts[]           the accumulating pool — cited, dated, provenance-rigorous
│                     (veille's Fact schema, unchanged)
├── Views[]           module slot — how you read it
│     feed · synthesis (profile, chronology, …)
└── Studios[]         module slot — what it produces; outputs are artifacts
      brief-me · digest · write (Brief→Plan→Draft→Verify) · export
```

Three rules:

1. **Every fact has provenance; every output cites facts.** The chain is user-visible end to end: claim → fact → source passage → URL. verso-ink's verify pipeline becomes a property of *all* studios, not just writing.
2. **Cross-reference = dossier-as-source.** Dossier B attaches dossier A as a source; A's facts become available to B's views and studios, carrying their original provenance. A live link, not a copy.
3. **Quick Catch** (simpleyt's soul): paste one URL anywhere → instant extraction and analysis. A dossier-less entry point that creates a lightweight one-source dossier the user can discard, keep, or merge into an existing dossier. The transactional use case survives; every quick catch is one tap from becoming durable knowledge.

## 5. Launch module catalog

Everything below exists in one of the four codebases — a re-shelving, not a wishlist.

| Slot | Module | Comes from |
|---|---|---|
| Source | YouTube (video, channel; Supadata transcripts) | veille `adapter-youtube` + simpleyt |
| Source | Web page / article (Readability) | veille `adapter-web` |
| Source | Web search, standing (Tavily) | veille `discovery` |
| Source | RSS feed | veille `discovery/rss` + old Flutter app |
| Source | PDF / raw text | veille `adapter-pdf`, `adapter-text` |
| Source | Dossier cross-reference | new (thin: a live link, not an adapter) |
| View | Feed (universal, chronological) | veille-app M1 |
| View | Synthesis (templated: profile, chronology, …) | veille-app template registry |
| Studio | Brief me — narrated "what's new since you last looked" | veille-app narrated activity feed groundwork |
| Studio | Digest — periodic readable summary | simpleyt's analysis, matured; theviborapapers' weekly-report pipeline proves the pattern |
| Studio | Write — Brief → Plan → Draft → claim-level Verify, ghost-diff editor | verso-ink, whole |
| Studio | Export (md/docx/pdf) | veille `core/export` + verso-ink export |

The planner keeps its veille role, extended one notch: from the intent it proposes a **starter kit** — sources + a view + one default studio (usually Brief me). The user then adds/removes modules freely.

## 6. What each codebase becomes

- **veille-app → is Verso.** The platform base: monorepo, Fact engine, adapters, auth, Postgres. Rebrand + module framing when Stage 1 triggers.
- **verso-ink → the Write studio.** Ported as a module; the editor (TipTap, ghost diff, block metadata) is the crown jewel carried over. Its internal Fact Sheet dissolves — the dossier is the fact sheet. Donates the brand.
- **simpleyt → retired as an app.** Survives as Quick Catch (its whole UX) and lessons for the YouTube source module. Tkinter UI and local storage go.
- **old veille Flutter app → stays frozen.** The sketch of the future mobile companion; revisit when the platform API exists. Likely rebuild rather than resurrect; its screens are the reference.
- Out of scope, untouched: bloomtracker, sorties, theviborapapers (the latter is a private proof that the dossier → digest → article loop produces something people read).

## 7. Boundaries

- A module talks to the dossier **only** through two interfaces:
  - Sources implement `extract(input, hints) → Fact[]` — veille's existing contract, unchanged.
  - Views and studios read a **fact-pool query API** and write artifacts back.
  - No module touches another module.
- Studios are **jobs, not requests** — veille-app's durable background jobs system (feat/background-jobs) is the studio execution layer.
- The Fact schema stays a stable, additively-evolved public contract (per veille's existing rule).

## 8. Staged path (non-binding)

- **Stage 0 — now.** This spec is the north star. Both apps keep shipping as-is. One rule takes effect immediately: new work in either app avoids contradicting this concept (veille-app names things "modules" where natural; verso-ink doesn't deepen the Fact Sheet's coupling to the document).
- **Stage 1 — Verso emerges** (the "continuity" trigger). veille-app rebrands to Verso; module framing becomes explicit UI (add source / add view / add studio). Brief-me and Digest ship first — small, and they prove the studio slot. Quick Catch ships as the low-friction front door.
- **Stage 2 — the Write studio.** verso-ink's editor ported into the platform; the dossier replaces its Fact Sheet. The big lift. verso-ink standalone freezes at parity.
- **Stage 3 — mobile companion.** Flutter rebuilt against the platform API: read, notifications, share-sheet capture into Quick Catch.

Each stage delivers user value on its own; no stage has a date.

## 9. Success criteria

- One top-level object (dossier) explains every feature.
- All four apps' capabilities have a named home in the module catalog.
- Nothing requires breaking veille's Fact contract or verso-ink's editor architecture.

## 10. Parked / open

- Taglines and positioning copy (decided: explore later; the name must not drag the product toward "writing app").
- Trademark sanity-check: Verso Books adjacency.
- Stage-1 trigger conditions (when does veille-app rebrand?) — owner's call, not specified here.
- Pricing/tiers, social/library layer (veille M4, "UpNews") — untouched by this concept; the module system should not preclude them.
