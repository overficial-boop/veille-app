# Verso Stage 1 — the block system

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation planning.
**Parents:** [platform concept](2026-07-07-verso-unified-platform-concept-design.md) · [UX concept](2026-07-07-verso-ux-concept-design.md)
**One line:** everything veille does today, redistributed as composable blocks with prerequisites — presented as the Verso magazine (recto) with a flip-to-compose side (verso).

---

## 1. Scope

**In**
- The block system: definitions, prerequisites DAG, page/item scopes, jobs-based execution, output cache + visible staleness.
- The magazine recto (page = the block stack) and the flip verso (composer).
- Structural rebrand to **Verso** (UI naming only; repo/package names stay `veille-*` for now; visual identity stays parked).
- Launch catalog of ~12 blocks (§5), mostly adapted from simpleyt's analysis sections and veille's existing brief/synthesis.

**Out (explicit)**
- Big Studios (Write workbench, Digest-as-publication) — **last**, per product owner: extensions, not core.
- Quick Catch and the one-box first run — Stage 1.5 (item-URL sources already exist today).
- Fractal home front page (needs multi-dossier novelty ranking) — after blocks.
- Mobile; visual redesign; ML-driven suggestions (v1 suggestions are rule-based).

**Acceptance bar — the ancestor test:** paste a YouTube video into a dossier; Verso must offer at least simpleyt's eight analysis sections for that video, on demand, each with provenance simpleyt never had. Nothing veille does today may regress.

## 2. The block model

A **block definition** (code-registered, not DB):

```
{ id, name, scope: page | item | both,
  prerequisites: [input, …],          // see below
  generator: (inputs) → output,        // prompt + output schema
  stalenessPolicy: auto-on-refresh | on-demand }
```

**Inputs are uniform.** A prerequisite is any of:
- a primitive: `fact-pool`, `raw-content` (transcript/article text), `item-metadata`, `items` (the stream);
- **another block's output**, same scope (`block:exec-summary`);
- **cross-scope aggregation**: `all-items:<block-id>` — a page block consuming every item's cached output of a block (map-reduce: dossier-level Key Themes reads item summaries, not 40 transcripts).

The graph is a DAG, validated at attach time (no cycles, no unsatisfiable scope). Derivation blocks (One-liner ← Executive Summary) are near-free by construction.

**Instances.** Attaching a block to a mount point — a dossier's page, or an item type within a dossier — creates an instance. Outputs are cached per `(block, target, prerequisites-version)`.

**Provenance.** Generators cite facts wherever they claim; the app-wide provenance popover (UX spec §6) works inside every block output. Quote-bearing blocks (`Notable Quotes`) require `raw-content` so quotes are verbatim.

## 3. Execution & staleness

- **One instance run = one job** on the durable jobs system (merged 2026-07-07): enqueue → claim → generate → cache → narrate in the activity feed.
- **Scheduling by graph:** a job is enqueued only when its prerequisites are fresh or their jobs finished; the worker walks the DAG by "enqueue what's ready" — no separate orchestrator.
- **Staleness is visible, never silent.** Fact-pool version bumps on refresh; dependents show a "stale — refresh?" chip. Policy: page blocks default `auto-on-refresh`; item blocks and expensive derivations default `on-demand` (run on first tap, then cache) — simpleyt's economics.
- **Cost rules:** eager work = only what's mounted on the page; item analysis is paid once per item per block; derivations reuse cached parents.

## 4. UI — recto / verso

**Recto (reading).** Masthead (title, updated-ago, flip affordance) then the page-block stack in user order. **The feed is itself a page block** (prerequisite `items`) — no special cases. Items expand into item cards: metadata + mounted item blocks; ungenerated blocks render as one-tap "Run" affordances; stale outputs carry the chip.

**Verso (composing).** Three sections + settings:
- **SOURCES** — today's add/manage UI, restyled into the slot.
- **PAGE BLOCKS** — the stack: add from library, drag to reorder, per-block cadence/staleness policy.
- **ITEM BLOCKS** — defaults per item type ("every YouTube item offers Summary + Quotes + Takeaways").

**Inline suggestions (thin v1):** rule-based cards in the reading flow (e.g. recurring-domain → "follow its RSS?"; N items on a sub-topic → "add Open Questions block?"). No ML.

## 5. Launch block catalog

| Block | Scope | Prerequisites | Origin |
|---|---|---|---|
| Since you last looked | page | fact-pool (novelty-gated) | veille brief, reframed |
| Feed | page | items | veille journal/document view |
| Chronology | page | fact-pool | veille synthesis template |
| Executive Summary | both | item: raw-content · page: all-items:exec-summary | simpleyt |
| Key Themes | both | item: fact-pool · page: all-items:exec-summary | simpleyt |
| Detailed Breakdown | item | raw-content | simpleyt |
| Arguments & Evidence | both | fact-pool + raw-content | simpleyt |
| Notable Quotes | item | raw-content | simpleyt |
| Strengths & Weaknesses | both | block:arguments-evidence | simpleyt |
| Actionable Takeaways | both | fact-pool + block:strengths-weaknesses | simpleyt |
| Open Questions | both | fact-pool | simpleyt |
| One-liner / TL;DR | both | block:exec-summary (pure derivation) | new (the "smaller summary") |
| Elaborate | both | any block output + fact-pool (on-demand deepening of a tapped point) | new (product owner) |

Stage 1 adds no new *capability* beyond Elaborate and TL;DR — it is a redistribution of what the ancestors already did.

## 6. Mapping today's code

| Today (veille-app) | Becomes |
|---|---|
| Brief generation + novelty gate | Since-you-last-looked generator, nearly as-is |
| Two-stream journal / document view | Feed block |
| Synthesis templates | Chronology (later Profile) blocks |
| Sources screens | Verso side, SOURCES |
| Jobs system | Block executor (`block` job type) |
| Curation, discovery diagnostics, admin | Unchanged, reachable from verso side |
| Fact pool, adapters, planner | Untouched — blocks are consumers |

**New code:** block registry (in code), `block_instances` + `block_outputs` tables, DAG resolver in the worker, recto/flip UI, ~10 generators (adapted from simpleyt's prompt sections and veille's brief).

## 7. Risks / open

- **Generator quality per block** — simpleyt's sections came from one holistic call; split prompts may lose cross-section coherence. Mitigation: shared context preamble; evaluate on real dossiers early.
- **Cost visibility** — per-block LLM spend should be observable (the jobs table already records runs; surface per-dossier counts on the verso side).
- **Flip implementation** (gesture/animation) — motion design parked; Stage 1 ships a plain toggle if needed.
- **DB-registered third-party blocks, block sharing/library growth** — future; the code registry must not preclude it.
