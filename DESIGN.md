---
name: Hearth-v2
description: A warm household journal set over the lived-in photography of the home.
colors:
  parchment-ground: "#efe4d2"
  parchment-surface: "#e8dcc4"
  journal-paper: "#fbf5e6"
  hearth-ink: "#2d1b26"
  hearth-ink-soft: "#4a2f3d"
  hearth-muted: "#6e5e40"
  hearth-line: "#ddcba8"
  hearth-plum: "#5c2a4a"
  hearth-plum-deep: "#3f1a33"
  hearth-plum-light: "#7a3f60"
  antique-gold: "#8a6e30"
  action-white: "#fff"
  danger-clay: "#b05945"
  attention-orange: "#c06f2a"
  complete-green: "#5f8a4e"
  night-ground: "#20212a"
  night-surface: "#262732"
  night-paper: "#2e2f38"
  night-ink: "#f5efe3"
  night-ink-soft: "#e0d8c8"
  night-muted: "#a6a4ae"
  night-line: "#3a3b45"
  night-plum: "#c77aa0"
  night-plum-deep: "#9e5c84"
  night-plum-light: "#dca5c4"
  night-gold: "#dcb87a"
  night-on-accent: "#1a1410"
  night-danger: "#d47a6a"
  maintenance-amber: "#8a5610"
  maintenance-night-amber: "#d89b45"
  inventory-umber: "#7c6038"
  inventory-night-brass: "#c0a276"
  yard-green: "#356b31"
  yard-night-green: "#7fc77a"
  garden-green: "#38702e"
  garden-night-green: "#6fbf57"
  pool-cyan: "#0e7c99"
  pool-night-cyan: "#4fc5e0"
  kitchen-terracotta: "#a84624"
  kitchen-night-terracotta: "#db7a52"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.85rem, 1.4rem + 1.8vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Playfair Display, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.7rem, 1.4rem + 1.3vw, 2.2rem)"
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: "Playfair Display, Georgia, Times New Roman, serif"
    fontSize: "1.55rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.96rem"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.66rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  square: "0"
  compact: "8px"
  field: "10px"
  journal: "14px"
  sidebar: "22px"
  pill: "999px"
  circle: "50%"
spacing:
  micro: "6px"
  compact: "8px"
  page-inset: "16px"
  control-inline: "17px"
  surface: "22px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.hearth-plum}"
    textColor: "{colors.action-white}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "8px 17px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.hearth-plum-deep}"
    textColor: "{colors.action-white}"
  button-quiet:
    backgroundColor: "{colors.journal-paper}"
    textColor: "{colors.hearth-ink-soft}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "8px 17px"
    height: "40px"
  input:
    backgroundColor: "{colors.journal-paper}"
    textColor: "{colors.hearth-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
    height: "42px"
  journal-card:
    textColor: "{colors.hearth-ink}"
    rounded: "{rounded.journal}"
    padding: "18px 22px"
---

# Design System: Hearth-v2

## Overview

**Creative North Star: "The Home You Keep"**

Hearth-v2 makes household stewardship feel like returning to a familiar home: page-specific photography fills the viewport, a palette-matched veil quiets it, and warm paper surfaces hold the work. The result is editorial and domestic rather than administrative, while records remain compact and legible.

A floating translucent sidebar keeps the household map close without walling off the photograph. Playfair Display provides the journal voice; Inter carries every control and record. Rounded cards, pills, restrained lift, and route-specific color families keep each ledger distinct without changing its interaction grammar.

**Key Characteristics:**
- Byte-identical legacy household wallpapers, full-bleed under palette-matched veils
- One semantic role set exchanged as cohesive light and dark palettes on every route
- A 16px-inset, 212px translucent sidebar with 22px corners on wide screens
- 14px journal cards and deliberate pills for actions, tabs, counts, and statuses
- Locally bundled Playfair Display headings paired with Inter records and controls
- Ember, hearth, pool, drawer, and loading motion that yields to reduced-motion preferences

## Colors

The palette is contextual: every page swaps the same semantic roles while keeping warmth, hierarchy, and legibility stable.

### Primary
- **Hearth Plum:** The default home accent for actions, active navigation, links, emphasized title text, and ember details. Deep and light companions provide hover and dark-theme contrast.
- **Domain Accents:** Workshop amber, kraft umber, yard green, garden green, pool cyan, and kitchen terracotta replace plum by page without changing component semantics.

### Secondary
- **Antique Gold:** Atmospheric warmth in the home palette. Each domain supplies its own brass, ochre, sand, or olive companion for glow and supporting emphasis rather than primary actions.

### Tertiary
- **Danger Clay:** Destructive actions, required-field marks, and errors.
- **Attention Orange / Complete Green:** Dot-backed status meaning. Orange marks open, high, urgent, or needed; green marks completed, purchased, or reviewed.

### Neutral
- **Parchment Ground / Surface / Journal Paper:** The three-step light material ramp from exposed page to working card.
- **Hearth Ink / Soft Ink / Muted Ink:** Primary text, secondary copy, and metadata.
- **Hearth Line:** Low-contrast one-pixel borders and dividers.
- **Night Ground / Surface / Paper and Night Ink / Soft Ink / Muted Ink:** The corresponding dark material and text ramps. Theme changes are explicit and persist across visits.

### Page palette map

Every page implements the full role sequence `ground → surface → paper`, `ink → soft ink → muted ink`, `line`, `accent → deep accent → light accent`, and `secondary`. The table records each palette's five anchors in `ground / paper / ink / accent / secondary` order; the implementation's intermediate roles stay within the same family.

| Page | Photograph | Light anchors | Dark anchors |
| --- | --- | --- | --- |
| Home | `hearth-bg.jpg` | `#efe4d2 / #fbf5e6 / #2d1b26 / #5c2a4a / #8a6e30` | `#20212a / #2e2f38 / #f5efe3 / #c77aa0 / #dcb87a` |
| Home maintenance | `workshop-bg.jpg` | `#f0e4ce / #fbf4e4 / #33240f / #8a5610 / #7e6224` | `#221a0f / #362a19 / #f3e7d0 / #d89b45 / #e0c07a` |
| Home inventory | `kraft-bg.jpg` | `#ece3d4 / #f8f2e7 / #2e2820 / #7c6038 / #8a6a3c` | `#201c16 / #322c22 / #efe7d8 / #c0a276 / #d8be92` |
| Yard maintenance | `grass-bg.jpg` | `#e4f0da / #f2f8ec / #1e3312 / #356b31 / #8a6a28` | `#16241a / #213626 / #e8f3e0 / #7fc77a / #e0c07a` |
| Garden | `garden-bg.jpg` | `#edf1e4 / #f7faf0 / #17200f / #38702e / #8a6318` | `#101509 / #1e2715 / #edf3e2 / #6fbf57 / #d9b463` |
| Pool maintenance | `pool-bg.jpg` | `#dceef3 / #f0f9fb / #0f2e3a / #0e7c99 / #8a6230` | `#0e1f27 / #183441 / #e4f4f8 / #4fc5e0 / #e6bc7e` |
| Recipe manager | `kitchen-bg.jpg` | `#f1e7da / #fbf4ea / #33221a / #a84624 / #5e6b2e` | `#221812 / #36271e / #f3e5d8 / #db7a52 / #a8b96a` |

The shipped wallpaper files are identity assets, not replaceable stock-image slots. A fixed, slightly overscanned photograph is always paired with that page's diagonal light or dark veil.

### Named Rules

**The Whole-Room Palette Rule.** A page changes its photograph and its complete semantic ramp together; never recolor only the primary action.

**The Matched Veil Rule.** Photography remains full-bleed and the veil is derived from the active page ground, so content is legible without severing it from the room.

**The Meaning Twice Rule.** Status hue is always accompanied by readable text and a dot, border, or position; color never carries state alone.

## Typography

**Display Font:** Playfair Display (with Georgia, Times New Roman, and serif fallbacks)

**Body Font:** Inter (with system-ui, -apple-system, Segoe UI, and sans-serif fallbacks)

Both families are bundled locally. Playfair Display is loaded at 700 in roman and italic; Inter is loaded from 300 through 700. The pairing gives headings a warm journal voice while keeping dense ledgers, forms, and navigation direct.

### Hierarchy
- **Display** (700, fluid 1.85–2.5rem, 1.12, -0.02em): Page hero titles; italic color emphasis may isolate one meaningful phrase.
- **Headline** (700, fluid 1.7–2.2rem, 1.1): First-run and prominent state statements.
- **Title** (700, 1.42–1.55rem, about 1.1): Ledger, panel, and dialog headings.
- **Body** (400, 0.92–0.96rem, 1.55–1.65): Explanations and journal copy, generally held to 58–65ch.
- **Control** (600, 0.8–0.875rem): Buttons, tabs, navigation, and compact actions.
- **Label** (700, 0.66rem, 0.08em, uppercase): Table headings and compact record metadata.

### Named Rules

**The Two-Type Rule.** Playfair speaks for the home in headings and large values; Inter does the work everywhere else.

## Layout

The wide shell floats a fixed 212px sidebar 16px from the viewport edges. Content begins 228px from the left, centers inside a 1280px maximum work field, and uses 16px page insets with 32px between major sections. The photograph remains fixed beneath both navigation and content.

At 1199px and below, the sidebar becomes a 280px left drawer and the page receives paired 36px floating menu and theme controls at the top corners. At 900px, five-up summaries reduce to three columns. At 720px, work-field insets become 14px, page heroes stack, hero statistics hide, actions span the available width, summaries become two columns, and quick capture becomes one column. At 600px, ledgers transform from tables into labeled record cards and dialogs fit within 10px of the viewport. At 440px, summaries and first-run actions become single-column.

The ordinary route hero is a translucent editorial plate with a 155px minimum row; the dashboard instead uses a 250px photographic welcome surface. Both place the first working section immediately below, preserving the story from orientation to current household work.

### Named Rules

**The Work Beside Navigation Rule.** On wide screens the first hero and working surface align beside—not beneath—the floating household map; compact screens use the same map as a drawer.

## Elevation & Depth

Depth is a restrained hybrid of tonal paper layers, soft shadows, and selective translucency. Working cards are lightly lifted, interactive summary cards rise only on hover, the sidebar is the deepest persistent glass plate, and the dialog alone receives modal elevation.

### Shadow Vocabulary
- **Journal rest, light** (`0 1px 3px rgb(45 27 38 / 10%), 0 6px 16px -6px rgb(45 27 38 / 24%)`): Ledger sheets, dashboard panels, cards, tabs, and hero copy.
- **Journal rest, dark** (`0 1px 3px rgb(0 0 0 / 50%), 0 6px 18px -6px rgb(0 0 0 / 60%)`): The dark-theme counterpart.
- **Journal hover, light** (`0 4px 10px rgb(45 27 38 / 14%), 0 16px 32px -10px rgb(45 27 38 / 30%)`): Summary and quick-access cards paired with a 2px rise.
- **Journal hover, dark** (`0 4px 12px rgb(0 0 0 / 55%), 0 16px 36px -10px rgb(0 0 0 / 75%)`): The dark-theme counterpart.
- **Floating sidebar** (`0 8px 22px rgb(45 27 38 / 10%), 0 30px 60px -24px rgb(45 27 38 / 28%)`): Wide navigation over the photograph; dark mode strengthens both layers.
- **Dialog** (`0 24px 64px rgb(45 27 38 / 28%)`): Record creation and revision above a blurred scrim.

The blur vocabulary follows function: 20px plus 180% saturation for the sidebar, 10px for floating controls, 6–8px for content and statistic plates, and 2–3px for scrims or the pool hero. These are glass treatments over photography, not decoration on every container.

### Named Rules

**The Lift by Job Rule.** Persistent navigation floats deepest, working paper rests lightly, and extra lift appears only for hover or modal focus.

**The Motion Must Yield Rule.** Ember drift, hearth glow, pool caustics, shimmer, drawer movement, and card lift collapse to effectively static behavior when reduced motion is requested.

## Shapes

The system is gently rounded rather than bubbly. Journal cards, panels, tabs, dialogs, and hero plates share a 14px radius; the floating sidebar uses 22px; inputs use 10px; compact navigation and icon actions use 8px. Fully round geometry is reserved for small icon controls, avatars, indicator dots, and the paired floating controls.

Pills (`999px`) are intentional and frequent: primary and quiet buttons, counts, and statuses use them. Borders remain one pixel and palette-relative. Cards do not become pills, and controls do not inherit the sidebar's larger radius.

### Named Rules

**The Soft Journal Rule.** Use 14px for working paper, 22px for navigation glass, 10px for fields, 8px for compact controls, and full pills only for concise actions or state.

## Components

### Buttons
- **Shape:** Compact pill with a 40px minimum height and 8px by 17px padding.
- **Primary:** Active page accent with on-accent text and a matching border; the pool hero reverses this to translucent white with deep-water text.
- **Hover / Focus:** Hover moves to the page's deep accent. Keyboard focus uses a 3px accent-and-white mixed outline with a 3px offset.
- **Quiet / Text:** Quiet actions use translucent paper and the same pill silhouette. Tertiary text actions use a current-color underline instead of a container.

### Cards / Containers
- **Corner Style:** Rounded journal paper (14px).
- **Background:** A subtle paper-to-surface vertical gradient with a one-pixel line border.
- **Shadow Strategy:** Journal-rest shadow at rest; only linked summary and quick-access cards gain hover lift.
- **Internal Padding:** Dense cards use 15–19px; headings and major panels use 18px by 22px.

### Inputs / Fields
- **Style:** Paper fill, one-pixel page line, 10px radius, 42px minimum height, and 9px by 11px padding.
- **Focus:** Border changes to the page accent and adds a 3px low-opacity accent ring.
- **Error / Disabled:** Required marks and inline errors use danger clay with readable text and an outlined 8px container; busy actions retain their label and reduce opacity.

### Navigation
- **Desktop:** The 22px translucent sidebar combines a wordmark, grouped plain-language links, build identity, and household status. Active links use an accent-tinted field, stronger weight, and a 2px accent bar.
- **Compact:** Paired circular menu and theme controls open the same navigation as a 280px drawer over a blurred scrim.
- **Ledger tabs:** A 14px paper pill-group scrolls horizontally. Tabs are 44px high; the current ledger uses an accent tint, 800 weight, and a 3px inset accent bar.

### Status Pills
Statuses are compact outlined pills with readable, humanized text and a 6px dot. Page accent is the default; attention orange, complete green, and muted ink specialize meaning. Counts use the same pill geometry without a status dot.

### Data Ledgers and Dialogs
Ledger sheets pair an 82px heading band with compact 50px rows, muted uppercase column labels, row hover tint, and 34px icon actions. Below 600px, each row becomes a labeled record block rather than forcing horizontal reading. Record entry uses a native modal dialog, a two-column form that collapses to one, and a persistent action footer.

### Page Heroes
Route heroes use editorial Playfair titles, restrained phrase emphasis, a short accent rule, and a translucent 14px copy plate. The dashboard uses a warmer photographic hero with hearth glow; the pool uses a water-tinted hero with slow caustics and statistic plates. All ornamental motion is hidden from assistive technology and covered by the reduced-motion rule.

## Do's and Don'ts

### Do:
- **Do** keep each shipped wallpaper paired with its complete light and dark page palette.
- **Do** use the semantic role names—paper, ink, line, accent, secondary—so components inherit the active room.
- **Do** reserve Playfair Display for headings and prominent values; keep controls, forms, and records in Inter.
- **Do** preserve the 14px journal, 22px sidebar, 10px field, 8px compact-control, and 999px pill hierarchy.
- **Do** preserve visible 3px keyboard focus and the table-to-labeled-record transformation.
- **Do** make every ambient or loading animation safe under `prefers-reduced-motion`.

### Don't:
- **Don't** collapse the page-specific photography and palettes into one generic dashboard theme.
- **Don't** place the wallpapers inside cards; they are full-viewport environmental material beneath the interface.
- **Don't** give every container glass blur or hover lift; depth is assigned by job.
- **Don't** apply Playfair Display to controls or routine record copy.
- **Don't** communicate status or destructive intent with color or an unlabeled icon alone.
- **Don't** restore fieldbook geometry, clipped corners, square controls, or condensed drafting typography.

**Not canonized:** Repeated hero and section eyebrow/kicker labels, plus the inherited 12px bold field-text cascade, are shipped defects rather than reusable rules; both are excluded by the craft floor.
