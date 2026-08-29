---
name: Hearth-v2
description: A precise property fieldbook built from drafting mylar, blueprint ink, and survey marks.
colors:
  floor-light: "#e4e7e2"
  ink: "#172a3b"
  ink-muted: "#53626c"
  mylar: "#f3f4ee"
  mylar-deep: "#e7eae4"
  rule: "#bcc5c6"
  rule-strong: "#7b8d94"
  survey: "#26668c"
  survey-deep: "#164b6c"
  utility: "#bf571f"
  garden: "#4c7654"
  danger: "#a53b31"
  floor-dark: "#091a27"
  ink-dark: "#e5eff0"
  ink-muted-dark: "#9aafb6"
  mylar-dark: "#132a3c"
  mylar-deep-dark: "#0d2233"
  rule-dark: "#385266"
  rule-strong-dark: "#627d8d"
  survey-dark: "#6db4dc"
  survey-deep-dark: "#8bc8e8"
  utility-dark: "#f18a4d"
  garden-dark: "#79aa81"
  danger-dark: "#f48678"
  white: "#ffffff"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4rem)"
    fontWeight: 640
    lineHeight: 0.92
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2rem, 3.8vw, 2.8rem)"
    fontWeight: 620
    lineHeight: 0.98
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.42rem"
    fontWeight: 650
    letterSpacing: "0.005em"
  body:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.66rem"
    fontWeight: 700
    letterSpacing: "0.08em"
  metadata:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "0.62rem"
    fontWeight: 400
    letterSpacing: "0.06em"
rounded:
  square: "0"
spacing:
  tight: "8px"
  compact: "9px"
  inset: "14px"
  content: "17px"
  panel: "21px"
components:
  button-primary:
    backgroundColor: "{colors.survey-deep}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "42px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0 15px"
    height: "42px"
  input:
    backgroundColor: "{colors.mylar}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "9px 10px"
    height: "42px"
  ledger-sheet:
    backgroundColor: "{colors.mylar}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
---

# Design System: Hearth-v2

## Overview

**Creative North Star: "The Property Fieldbook"**

Hearth-v2 treats the household as a mapped working record. Pale drafting mylar, blueprint ink, survey structure, folio coordinates, clipped sheets, and ruled ledgers make the interface feel precise and physical without becoming nostalgic or decorative.

Current work occupies the open field while navigation, evidence, and capture tools stay at the perimeter. Density is compact but legible: strong headings orient, one-pixel rules organize, and semantic color marks attention or truth rather than decorating containers.

**Key Characteristics:**
- Ruled fieldbook surfaces rather than a card grid
- Survey-blue structure with sparse utility-orange and garden-green meaning
- Square controls and clipped upper-right corners
- Fixed desktop legend; sticky mast and bottom index on phones
- Light drafting-mylar and dark blueprint-ink themes selected by the operating system

## Colors

The palette reverses from pale mylar to deep blueprint ink in dark mode while preserving the same semantic roles.

### Primary
- **Survey Blue:** Structural links, focus, pins, and primary interaction.
- **Deep Survey Blue:** Light-theme primary actions and folio emphasis.

### Secondary
- **Utility Orange:** Due, urgent, required, and attention-bearing information.

### Tertiary
- **Garden Green:** Completed, current, healthy, or truthful state.
- **Danger Red:** Destructive hover and inline error treatment only.

### Neutral
- **Blueprint Ink / Muted Ink:** Primary and subordinate text.
- **Drafting Mylar / Deep Mylar:** Work fields, controls, headers, and ruled surface layers.
- **Rule / Strong Rule:** Ordinary separators and structural boundaries.
- **Floor:** The exposed page surround beneath the mylar work field.
- **Dark Theme Set:** The corresponding `*-dark` tokens replace ink, mylar, rules, and accents under `prefers-color-scheme: dark`.

### Named Rules
**The Semantic Mark Rule.** Survey blue structures; utility orange demands attention; garden green confirms truth. Pair every color mark with text, position, or shape.

**The Mylar Reversal Rule.** Theme changes reverse the material from pale mylar to blueprint ink without changing hierarchy or meaning.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow and sans-serif fallback)  
**Body Font:** Aptos (with Segoe UI Variable, Segoe UI, system-ui, and sans-serif fallbacks)  
**Label/Mono Font:** SFMono-Regular (with Consolas and monospace fallback)

**Character:** Condensed headings read like fieldbook titling; neutral body type keeps controls and records practical. Monospace is reserved for coordinates, counts, and build metadata.

### Hierarchy
- **Display** (620–640, fluid 2–4rem, 0.92–0.98): Page titles and first-run statements.
- **Title** (650, 1.42–1.55rem): Ledger, rail, and dialog headings.
- **Body** (400, 1rem, 1.55): Descriptions and explanatory copy, generally capped near 58–68ch.
- **Label** (700, 0.66–0.75rem, 0.08–0.09em): Uppercase table headings and folio labels.
- **Metadata** (400–700, 0.62–0.78rem): Coordinates, counts, and build stamps only.

### Named Rules
**The Coordinate Reserve Rule.** Monospace belongs to coordinates and machine-like metadata, never ordinary prose or major headings.

## Layout

Desktop uses a fixed left site legend (`248px`, narrowing to `210px` at `1040px`) beside a full-height work field. The field uses fluid horizontal insets and a ruled background; Today divides into one flexible attention register and a `280–350px` evidence rail.

At `780px`, the fixed legend becomes a sticky `65px` mast and fixed seven-part `72px` bottom index. Content becomes one column with `16px` side insets and bottom clearance. At `600px`, ledger tables become labeled record rows and dialogs become full-viewport sheets; at `460px`, compact actions stack.

Spacing favors repeated compact increments around 8–21px, with 30–38px reserved for major section separation. Current work stays central; domain navigation and evidence remain peripheral.

## Elevation & Depth

Depth is structural, not atmospheric decoration. Mylar sheets and the modal dialog receive directional shadows; ordinary rows, rails, tabs, and controls rely on tonal layers and one-pixel rules.

### Shadow Vocabulary
- **Paper lift** (`5px 9px 20px rgb(27 45 54 / 10%)`; dark `5px 9px 22px rgb(1 9 15 / 35%)`): Ledger and attention sheets.
- **Action lift** (`3px 5px 12px rgb(22 75 108 / 18%)`): Primary buttons only.
- **Dialog lift** (`12px 18px 45px rgb(7 25 37 / 28%)`): Modal record entry over a darkened backdrop.

### Named Rules
**The Ruled Before Raised Rule.** Establish hierarchy with ink, tonal layers, and one-pixel boundaries before adding a shadow.

## Shapes

Controls and fields are square. Important actions, active navigation, sheets, and dialogs use a single clipped upper-right corner, scaled from 8px on buttons to 13–16px on large surfaces. The property mark uses the same cut-corner geometry. Borders remain one pixel except the evidence rail's three-pixel top index.

**The One Cut Rule.** Clip only the upper-right corner; do not mix radii, pills, or multiple ornamental cuts into the fieldbook silhouette.

## Components

### Buttons
- **Shape:** Square with an 8px upper-right cut, 42px minimum height, and `0 15px` padding.
- **Primary:** Deep survey fill, white text, matching border, and action lift; dark mode uses pale survey fill with deep ink text.
- **Hover / Focus:** Hover deepens or lightens the fill; global focus uses a three-pixel mixed-survey outline with a three-pixel offset.
- **Quiet:** Transparent mylar treatment with the same border and shape.

### Cards / Containers
- **Corner Style:** Square with a 13px upper-right cut on ledger sheets.
- **Background:** Mylar over the exposed floor, with deep-mylar headers and rule boundaries.
- **Shadow Strategy:** Paper lift only on active working sheets.
- **Internal Padding:** Compact ledger headers use roughly 17px by 21px.

### Inputs / Fields
- **Style:** Square, 42px minimum height, strong-rule border, and a lightly lifted mylar fill.
- **Focus:** Border shifts to survey blue while the global focus outline remains visible.
- **Error / Disabled:** Errors use danger text and border; disabled actions reduce opacity and retain their label.

### Navigation
- **Desktop:** A dark fixed site legend pairs coordinates, outline icons, and plain-language labels. Active entries use a survey-toned field, a visible border, and a clipped corner.
- **Mobile:** A sticky mast preserves identity and status; a fixed bottom index gives each domain equal-width icon-and-label access.
- **Ledger tabs:** Horizontal, scrollable, rule-separated controls; the current ledger reverses to ink on mylar.

### Status Marks
Status text is preceded by a compact rectangular mark. Survey is default, utility marks open or urgent work, garden marks completed truth, and muted ink marks cancelled or failed states.

## Do's and Don'ts

### Do:
- **Do** use one-pixel rules and tonal layering as the default structure.
- **Do** keep folio coordinates functional and pair semantic color with readable status text.
- **Do** preserve the fixed-legend-to-bottom-index responsive transformation.
- **Do** honor reduced-motion preferences; loading survey motion collapses to effectively static.

### Don't:
- **Don't** turn records into a generic floating-card grid.
- **Don't** use pills, soft rounded cards, gradients as decoration, or ornamental corner variation.
- **Don't** use utility orange or garden green as broad surface fills when a compact mark communicates the state.
- **Don't** use monospace for ordinary body copy or Barlow Condensed for form controls.
