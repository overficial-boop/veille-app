# Verso — UX concept

**Date:** 2026-07-07
**Status:** North star (Stage 0). Companion to [2026-07-07-verso-unified-platform-concept-design.md](2026-07-07-verso-unified-platform-concept-design.md), which defines the object model this UX presents.
**Why this document:** adoption hinges on how a complex, composable app is apprehended. These decisions were made visually (mockup rounds via the brainstorming visual companion; mockups preserved under `.superpowers/brainstorm/`) and settle the surfaces before any implementation.

---

## 1. The Briefing — magazine-first

A dossier opens as a **living publication**, not a control panel (chosen over "workspace with visible module sidebar" and "chat-first command bar").

Anatomy of the recto (reading face), top to bottom:
- Masthead: dossier title, last-updated, quiet `⚙ flip` affordance.
- **"Since you last looked"** — the narrated novelty brief. Always first.
- The active view (feed by default), fact counts and sources visible per item.

Machinery is invisible while reading. Feels calm, editorial, "it works for me."

## 2. Recto/verso — flip the page

Every page has two faces; **one gesture flips it**:

- **Recto** — what you read (the briefing above).
- **Verso** — how it's made: the three module slots (SOURCES / VIEWS / STUDIOS), each listing attached modules with health/state, each ending in `+ add`. Flip back to reading.

The brand becomes the core interaction; composability is not buried in settings — it is literally the other half of the object.

**Discovery engine — the dossier suggests.** Module cards appear inline in the reading flow, contextually: "Padel Alto keeps appearing via web search — follow its RSS directly? [add source]" / "9 facts about Tapia's injury — spin off a dossier?". Users compose by accepting suggestions while reading; the flip side is where they compose deliberately. (Chosen as a pair: flip = mental model, suggestions = discovery. The "recipe rail" margin variant was deferred to wide screens, maybe never.)

## 3. First run — one box, two doors

First open shows one question in huge type and one input:

> **What do you want to stay on top of?**

- **Type an intent** → the planner assembles a starter dossier live in front of the user (sources found, first facts arriving, briefing building). The product demonstrates itself in under a minute.
- **Paste a URL** (video, article, PDF) → **Quick Catch**: instant extraction, cited facts, instant analysis — then "keep following this subject?" graduates it into a dossier.

No template gallery at first run (kiosk idea deferred; risks reading as a news app and undersells "any subject").

## 4. Home — fractal: the dossier of your dossiers

Returning users land on one screen, two zones:

1. **Front page** — "since you last looked" merged across all dossiers, ranked by novelty; quiet dossiers say so in one line.
2. **The shelf** — dossier covers with freshness signals, plus `+ new`.

Scroll = read; tap = dive. **Home has exactly a dossier's anatomy** (brief on top, contents below) — the app is fractal, one structure to learn. Home flips too: the verso of home is the global module library, account, cadences.

Requires honest novelty ranking; a front page that hides real news kills the habit it exists to create.

## 5. Studios — the dossier publishes itself

- **Outputs are pages of the magazine.** A digest, brief, or article renders as an editorial page inside the dossier's reading flow ("YOUR WEEKLY DIGEST · ISSUE 12"), announced in the feed. Gathered and produced content share the flow; provenance chips (§6) keep them distinguishable. (Chosen over a separate "Made" drawer.)
- **Write is a mode: the workbench.** Opening the Write studio takes over the screen: the verso-ink editor (ghost diffs, block metadata, sub-block control) center-stage, the dossier docked as a **fact rail** on the right — searchable, draggable into the draft; the verify pass highlights claims against it. Closing the workbench returns to the magazine; the draft persists as an artifact page. The fact rail is the Stage-2 architecture (dossier replaces verso-ink's Fact Sheet) made visible.
- Small studios (brief-me, digest) have no mode — they just produce pages.

## 6. Provenance — one gesture, app-wide

Any fact or claim, anywhere — feed item, digest sentence, draft paragraph — responds to a tap with the same popover: **verbatim source passage, source name, date, link out**. One gesture teaches the product's core promise: *everything here can prove itself.* This is the Fact schema's `sourcePassage` field becoming UI. AI-produced text carries visible origin distinction from gathered facts (per the platform concept's provenance rules).

## 7. Adoption logic (why these choices fit together)

| Moment | Surface | What it must do |
|---|---|---|
| Minute 1 | One box | Deliver a living dossier or an instant analysis — no configuration, no blank app |
| Day 2–14 | Home front page | One read = caught up; habit forms |
| Week 2+ | Inline suggestions | Teach composability without a manual |
| Power use | Flip + workbench | Full control and serious writing, discovered exactly when wanted |

Complexity is *staged into the user's journey*, not removed: the app is as simple as the newest user needs and as deep as the oldest user wants.

## 8. Parked / open

- Visual design language (typography, color, motion) — separate exercise; the mockups were structural wireframes only.
- The flip gesture's exact implementation (3D turn vs slide vs crossfade) — motion design, later.
- Recipe-rail margin for wide screens — revisit after Stage 1 ships.
- Mobile companion UX — Stage 3; the share-sheet → Quick Catch flow is the anchor.
- Novelty-ranking quality bar for the front page — needs its own design when Stage 1 approaches.
