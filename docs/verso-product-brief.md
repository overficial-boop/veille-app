# Verso — Product & Feature Brief (for design)

*Self-contained brief for designing Verso's interface. Everything a designer needs is in this document — no codebase context required. UI copy is in French (target users are French-speaking professionals); this brief is in English for clarity. Example copy is given in French where it matters.*

---

## 1. What Verso is

**Verso is a place where you keep living dossiers on the subjects you care about.** You tell it what to follow in one sentence; it assembles sources, extracts dated, cited facts, keeps itself current, and — when asked — produces things from what it knows: summaries, analyses, briefings, one day full articles.

**Pitch:** *"Tell Verso what to follow. It builds the dossier. Everything you make starts from what it knows."*

**The name is the concept:** every page has two sides. The **recto** is what you read — a calm, editorial briefing. Flip the page and the **verso** is how it's made — sources, blocks, machinery. The flip is the product's signature interaction.

**Three product laws** (every screen must respect them):
1. **Gathering first.** The knowledge is the product; outputs are results. Verso must never feel like a "writing app" or a "chat app."
2. **Everything can prove itself.** Any factual claim, anywhere, is one tap away from its verbatim source passage and link. Provenance is the soul.
3. **Smart default, always overridable, extensible library.** Verso decides for you first (sources, blocks, cadence) and lets you change everything.

## 2. Who it's for

French-speaking professionals who track subjects for a living or a serious hobby: journalists, analysts, content creators, researchers. Non-technical. They want to *stay on top of things* without operating machinery — but reward tools that show their work (citations, provenance).

## 3. Core vocabulary (the object model)

| Term | Meaning |
|---|---|
| **Dossier** | The one top-level object. A living file on a subject ("Premier Padel — saison 2026"). Gathers, refreshes, produces. |
| **Source** | Where knowledge comes in: a YouTube channel, an RSS feed, a standing web search, a single URL/PDF. Attached to a dossier; re-runs on refresh. |
| **Fact** | The atomic unit: one dated, cited statement extracted from a source, carrying the verbatim passage it came from. Users mostly see facts *through* blocks and items, plus in the provenance popover. |
| **Item** | One captured document: a video, an article, a PDF. Has metadata (title, source, date) and its own facts. |
| **Block** | A composable module the user attaches. Two kinds by placement: **page blocks** (sections of the dossier's reading page) and **item blocks** (analyses available on every item). Users add/remove/reorder blocks — this is how the product "feels customizable." |
| **Refresh** | The dossier re-running its sources, finding what's new. Manual today (a button), automatic later. |
| **Brief / "Depuis votre dernière visite"** | The novelty summary at the top of a dossier: what changed since you last looked, cited. |

## 4. The signature interaction — recto / verso

Every dossier page has two faces, one flip apart:

- **Recto (reading face):** masthead (dossier title, "actualisé il y a 2 h", quiet flip affordance) → "Depuis votre dernière visite" brief → the page-block stack in the user's order (feed, themes, open questions…). No machinery visible. Feels like a living magazine issue about your subject.
- **Verso (making face):** the composer. Three labeled slots — **SOURCES** (attached sources with health/state, `+ ajouter`), **BLOCS DE PAGE** (the stack: add from library, drag to reorder), **BLOCS D'ÉLÉMENT** (defaults per item type: "chaque vidéo YouTube propose : Résumé + Citations + À retenir") — plus dossier settings (name, cadence).
- The flip must feel like turning a page (motion design open — 3D turn, slide, crossfade all acceptable; pick what stays elegant on repeat use).

**Discovery happens while reading:** the dossier suggests its own upgrades inline, as quiet cards in the flow — *"Padel Alto revient souvent dans vos recherches — suivre son flux RSS ? [ajouter]"*, *"9 faits mentionnent Tapia — créer un dossier dédié ?"*. Accept or dismiss; never a modal, never a tutorial.

## 5. Screens to design

### 5.1 First run — one box, two doors
A single question in large type on an otherwise empty screen:
> **De quoi voulez-vous rester informé·e ?**

One input. Two behaviors:
- **Type an intent** ("la saison 2026 de Premier Padel") → the screen becomes a live build: sources found one by one, first facts arriving, briefing assembling — the product demonstrates itself in under a minute.
- **Paste a URL** (YouTube, article, PDF) → **Quick Catch**: instant extraction and analysis of that one item, then *"Continuer à suivre ce sujet ? → créer un dossier"*.

No template gallery, no onboarding carousel, no feature tour.

### 5.2 Home — the dossier of your dossiers (fractal)
Home has **exactly a dossier's anatomy**, so users learn one structure:
- **Top: the front page** — "Depuis votre dernière visite" merged across all dossiers, ranked by novelty. Quiet dossiers get one line ("5 dossiers sans nouveauté aujourd'hui").
- **Below: the shelf** — dossier covers with freshness signals (new-fact counts, live indicator), plus `+ nouveau`.
- Home flips too: its verso is the global library (all blocks/sources available), account, cadences.

### 5.3 Dossier recto
As described in §4. Key components:
- **Masthead** with title, updated-ago, flip affordance.
- **Brief block** ("Depuis votre dernière visite") — always first when attached; cited sentences.
- **Page-block stack** — each block is a titled editorial section (see catalog §6). Stale blocks show a quiet chip: *"obsolète — actualiser ?"* — never silently outdated content.
- **Feed block** — the chronological stream of items; each item row shows title, source, date, fact count.
- **Inline suggestion cards** woven between sections.

### 5.4 Item card
An item (video/article) expands from the feed into a card:
- Metadata header (title, source/channel, date, link out).
- Its **item blocks**: generated ones render as sections with cited claims; not-yet-generated ones are one-tap affordances (*"Générer : Analyse détaillée"*). First generation shows progress (see 5.6); afterwards content appears instantly (cached).
- Stale chip logic identical to page blocks.

### 5.5 The block library (picker)
Reached from the verso's `+ ajouter un bloc`. A browsable list of available blocks — name, one-line description, where it can mount (page / élément / les deux). Design for growth: dozens of blocks eventually, categories later. Internal/system blocks never appear here.

### 5.6 Generation & activity — the narrated feed
Verso narrates everything it does, in French, step by step: *"Recherche : Padel Alto…"*, *"Lecture et évaluation : Rome Final Highlights — retenu"*, *"Bloc « Questions ouvertes » — génération…"*, *"Blocs générés : 4 (à jour : 2)"*. Design a compact live-activity presentation (in-context progress on the affected block/dossier + an expandable step log). Long jobs must feel alive, not frozen. Failures are per-block and non-blocking: a failed block shows a retry affordance; the rest of the page is fine.

### 5.7 The provenance popover — one gesture, app-wide
Any cited claim — in the brief, a block, an item analysis — carries a small numbered marker (`[3]`, superscript style). Tapping it opens the same popover everywhere: **the verbatim source passage**, source name, date, link out. This popover is the product's trust signature — design it once, beautifully, and reuse it everywhere. AI-produced text must remain visually distinguishable from gathered/quoted material.

### 5.8 (Later — design direction only, not needed now)
- **The Write workbench:** full-screen writing mode; editor center-stage, the dossier docked as a searchable fact rail on the right; claim-level verification against the dossier. A future "studio."
- **Mobile companion:** read + notifications + share-sheet capture. Not in scope; keep layouts responsive-friendly.

## 6. The block catalog (current, real)

Item blocks (available on every video/article; all outputs cited with `[n]` markers):

| Block (FR name) | What it renders |
|---|---|
| Résumé exécutif | 2–4 grounded paragraphs |
| TL;DR | one sentence |
| Thèmes clés | bulleted major themes |
| Analyse détaillée | section-by-section breakdown |
| Arguments et preuves | claims made and how supported |
| Citations marquantes | verbatim quotes + commentary |
| Forces et faiblesses | what works / what's weak |
| À retenir (actionnable) | concrete takeaways |
| Questions ouvertes | what remains unclear |

Page blocks (dossier level): "Depuis votre dernière visite" (the brief), Feed, Chronology — with dossier-level Thèmes/Questions variants coming. The catalog grows; the design must not assume a fixed count.

*(Under the hood, item analyses come from one shared generation pass, so adding more blocks to an item is instant after the first — design can promise "add freely, it's fast.")*

## 7. States that must exist

- **Empty dossier** (just created, sources still running) — the live-build state doubles as this.
- **Generating** (block-level progress, narrated).
- **Stale** (quiet chip, one-tap refresh).
- **Failed block** (inline, retry, never breaks the page).
- **Quiet day** (front page with nothing new — make calm feel like a feature: *"Rien de nouveau. Tout est à jour."*).
- **Quick Catch result** (single-item analysis + "keep following?" prompt).

## 8. Design language guardrails

Visual identity is deliberately **open** — no legacy to match. Constraints that are product, not taste:
- **Editorial, calm, magazine-like** — a briefing you read with coffee, not a dashboard. Density closer to a quality newspaper than a SaaS admin.
- **Machinery hidden on the recto, honest on the verso.** The flip is the only door to complexity.
- **Citations are first-class typography** — the `[n]` markers and the popover deserve type-level care, not afterthought superscripts.
- **French UI copy throughout**; tone: precise, sober, warm — never jargon ("dossier", "sources", "blocs" are the words users see; never "LLM", "jobs", "pipeline").
- The word **"recherche" (search) never appears in product copy** — Verso tracks and briefs; it doesn't "search."
- No gamification, no emoji in UI, no engagement mechanics. Trust and calm are the brand.

## 9. Explicitly out of scope (do not design)

Real-time collaboration; social/sharing library; payments/tiers; mobile apps; the Write workbench (direction noted in 5.8 only); settings beyond dossier basics; admin/diagnostic screens.

## 10. The adoption arc (why these screens, in order)

| Moment | Surface | Must accomplish |
|---|---|---|
| Minute 1 | One box (5.1) | A living dossier or instant analysis — zero configuration |
| Day 2–14 | Home front page (5.2) | One read = caught up; the daily-return habit |
| Week 2+ | Inline suggestions (5.3) | Teach composability without a manual |
| Power use | Flip + library (5.4–5.5) | Full control, discovered exactly when wanted |

Complexity is staged into the journey, not removed: as simple as the newest user needs, as deep as the oldest user wants.
