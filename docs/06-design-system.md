# 06: Design system (site, admin, portal, email and PDF documents)

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Inputs** | Owner logo files in `brand-incoming/` (`TecHaust.ai`, `TecHaust.png`, `TecHaust.jpg`, `techhast logo cover.jpg`) · [03 §3A.5](03-plan.md) design direction · audit findings M-4 to M-8 ([01](01-audit.md)) |
| **Implements** | [04 PRD](04-prd.md) WEB-G-05, WEB-G-13 to WEB-G-16, NFR-4 |

> **One source of truth.** All tokens live in `packages/ui/tokens/tokens.json`. A build script generates (1) CSS custom properties, (2) the Tailwind v4 `@theme` used by the site, admin and portal, (3) inline-style constants for email templates, and (4) the print CSS for PDFs. A token is never typed by hand in an app.

---

## 1. Brand foundations

### 1.1 The logo you supplied

| Element | Observed in the files | Value |
|---|---|---|
| Wordmark | "TECHAUST", bold geometric grotesque capitals. The top half is navy; the lower half is orange, split by an orange swoosh that crosses the letters. | — |
| Mark | A small "pixel cluster" (two navy squares + orange squares) at the top-right of the final T | — |
| Brand navy | Measured from `TecHaust.png` | **`#111A45`** |
| Brand orange | Measured from `TecHaust.png` | **`#FF5100`** |
| Source | `TecHaust.ai` is PDF-compatible (`%PDF-1.5`), so clean vectors can be extracted | — |

**Note:** this logo is different from the code-drawn "T" mark on the old website (cyan/violet). Since you supplied this one, the new brand is **navy + orange on warm neutrals**, and the old cyan/violet is retired.

### 1.2 Logo refinement plan (Phase 6, milestone M1: I'll show you the variants for approval)

The current file works well at large sizes but has issues at small ones. The swoosh makes the lower half of the letters hard to read below about 120 px wide, and the pixel cluster disappears at favicon size. Proposed refinements, keeping the identity intact:

1. **Clean master SVG**, traced from the `.ai` vectors (not from the PNG). Letter spacing optically balanced, the swoosh curve smoothed, and the pixel cluster aligned to the cap-height grid.
2. **Lockups:**
   - **Primary horizontal** (full wordmark + pixel cluster) for the header, PDFs and email
   - **Compact** (wordmark without the swoosh's lower letter halves, i.e. the navy top half completed as solid letters, swoosh kept as an underline) for sizes below 120 px. **Needs your approval**, as it changes the drawing.
   - **Symbol**: the pixel cluster on its own (or a "T" + cluster monogram) for the favicon, app icon, social avatar and PDF page footers
3. **Colour versions:**
   - full colour on light (navy + orange)
   - full colour on dark (navy letters → `#F3F1EA` warm white; orange unchanged)
   - one-colour navy, one-colour white, and one-colour black for fax-style or grayscale printing
4. **Rules:**
   - **Clear space** on every side = 2 × the pixel-square size.
   - **Minimum width:** primary 120 px (screen) / 30 mm (print); compact 72 px; symbol 16 px.
   - **Never:** gradients, glows, 3D effects (as in the "cover" mock-up), stretching, recolouring outside the palette, or placing on busy photos.
5. **Deliverables:** `packages/ui/brand/` (SVG masters, favicon set `favicon.svg` + 32 px ICO + 180 px Apple touch icon + 512/192 px PWA icons, a 1200×630 OG template, and a PDF-embeddable SVG).

### 1.3 Personality → design principles

| Principle | Meaning in practice |
|---|---|
| **Calm** | Generous white space, few colours on screen at once, no constant motion, no glows |
| **Editorial** | Strong type hierarchy, a serif display face for big headings, long-form text set like a good publication |
| **Premium, not flashy** | Hairline borders, restrained shadows, precise alignment, tabular numbers for prices |
| **Honest** | Diagrams over fake dashboards; "Illustrative" labels; no decorative "live" indicators |
| **Indian + global** | ₹ and $ treated equally; the lakh/crore format for INR; IST shown with the visitor's local time |

---

## 2. Colour tokens

### 2.1 Palette

**Brand scales** (anchors are the logo colours; other steps are derived and checked for contrast).

| Token | Light role | Hex |
|---|---|---|
| `navy-950` | Dark-theme background | `#0A0F2C` |
| `navy-900` | **Brand navy** (logo), light-theme text | `#111A45` |
| `navy-800` | Dark-theme surface | `#141D4D` |
| `navy-700` | Hover on navy buttons, dark-theme raised surface | `#1E2A63` |
| `navy-600` | Dark-theme borders (strong) | `#5C6694` |
| `navy-400` | Muted text (light) | `#4B5275` |
| `navy-300` | Muted text (dark) | `#B7BBD2` |
| `navy-100` | Tinted surface (light) | `#E8EAF3` |
| `orange-700` | **Accent text / links on light** | `#C03D00` |
| `orange-600` | Accent hover on light | `#A83500` |
| `orange-500` | **Brand orange** (logo), decorative, large text, accent bars | `#FF5100` |
| `orange-400` | Primary button background (dark theme) | `#FF6A26` |
| `orange-300` | Accent text / links on dark | `#FF7A3D` |
| `orange-100` | Tinted highlight (light) | `#FFE7DB` |

**Warm neutrals**

| Token | Hex | Use |
|---|---|---|
| `paper` | `#FBFAF7` | Light page background |
| `white` | `#FFFFFF` | Light cards, inputs, PDF paper |
| `sand-100` | `#F3F0E8` | Light alternate section background |
| `sand-200` | `#E9E5DA` | Light subtle fills (table stripes, code background) |
| `sand-300` | `#D9D4C7` | Light borders (decorative; never the only boundary of a control) |
| `stone-500` | `#8A8FA8` | Light **control** borders (inputs, checkboxes: ≥ 3:1) |
| `warm-white` | `#F3F1EA` | Dark-theme text |

**Status** (always paired with an icon and a text label, never colour alone)

| Token | Light | Dark |
|---|---|---|
| `success` | `#1E7A4C` | `#4FC08D` |
| `warning` | `#9A5800` | `#F2B54A` |
| `danger` | `#B42318` | `#FF8A7A` |
| `info` | `#2D4BA6` | `#8EA6FF` |

### 2.2 Semantic tokens (what components use)

| Semantic token | Light | Dark |
|---|---|---|
| `--color-bg` | `paper` | `navy-950` |
| `--color-surface` | `white` | `navy-800` |
| `--color-surface-alt` | `sand-100` | `#101845` |
| `--color-surface-raised` | `white` + `--shadow-1` | `navy-700` |
| `--color-text` | `navy-900` | `warm-white` |
| `--color-text-muted` | `navy-400` | `navy-300` |
| `--color-text-accent` | `orange-700` | `orange-300` |
| `--color-link` | `navy-900` underlined; hover `orange-700` | `warm-white` underlined; hover `orange-300` |
| `--color-border` | `sand-300` | `#27326B` |
| `--color-border-control` | `stone-500` | `navy-600` |
| `--color-accent-decor` | `orange-500` | `orange-500` |
| `--color-btn-primary-bg` / `-fg` | `navy-900` / `white` | `orange-400` / `navy-950` |
| `--color-btn-primary-hover` | `navy-700` | `#FF7F45` |
| `--color-btn-secondary` | transparent, 1.5 px `navy-900` border, `navy-900` text | transparent, 1.5 px `warm-white` border, `warm-white` text |
| `--color-focus` | `orange-700` (2 px ring + 2 px offset in `--color-bg`) | `orange-300` |
| `--color-selection` | `orange-100` | `#3A2A3F` |

### 2.3 Contrast (measured, WCAG 2.x)

| Pair | Ratio | Passes |
|---|---|---|
| Text `#111A45` on paper `#FBFAF7` | 16.0 : 1 | AAA |
| Muted `#4B5275` on paper | 7.3 : 1 | AAA |
| Accent text `#C03D00` on paper | 5.2 : 1 | AA |
| Brand orange `#FF5100` on paper | 3.1 : 1 | **Large text (≥ 24 px, or ≥ 18.7 px bold) and non-text UI only** |
| White on navy button | 16.7 : 1 | AAA |
| Control border `#8A8FA8` on paper | 3.1 : 1 | AA non-text (1.4.11) |
| Status success / warning / danger / info on paper | 5.1 / 5.3 / 6.3 / 7.5 : 1 | AA |
| Dark: text `#F3F1EA` on `#0A0F2C` | 16.6 : 1 | AAA |
| Dark: muted `#B7BBD2` on bg / on surface | 9.9 / 8.4 : 1 | AAA |
| Dark: accent `#FF7A3D` on bg / surface | 7.3 / 6.2 : 1 | AA+ |
| Dark: primary button text `#0A0F2C` on `#FF6A26` | 6.6 : 1 | AA |
| Dark: control border `#5C6694` on bg | 3.4 : 1 | AA non-text |
| Dark status colours on bg | 8.1–10.3 : 1 | AAA |

**Rules:**
- Body text is never `orange-500`.
- Placeholder text uses `--color-text-muted` (not lighter), and labels are always visible (placeholders never act as labels).
- A CI test (`packages/ui/tokens/contrast.test.ts`) recomputes every semantic pair and fails below the thresholds above.

---

## 3. Typography

### 3.1 Typefaces (all SIL Open Font License, self-hosted woff2, subset)

| Role | Family | Why | Files on first view |
|---|---|---|---|
| **Display** (h1, h2, pull quotes, PDF titles) | **Newsreader** (variable, optical size 6–72, weights 400–700) | Calm, editorial and very readable at large sizes. Gives "premium publication" rather than "startup template". | 1 (roman, Latin subset) |
| **UI and body** | **IBM Plex Sans** (variable or 400/500/600) | An engineering heritage that suits a senior studio. Highly legible at small sizes, tabular figures, distinct `Il1`. | 1 |
| **Mono** (code snippets only, never paragraphs: audit finding) | **IBM Plex Mono** 400 | Same family as the body face | Lazy, only on pages with code |

**Requirements:**
- **₹ (U+20B9) must render in the UI/body face**, since prices and all document numbers use it. Phase 6 M1 checks glyph coverage of the chosen files with a script. If either font lacks ₹, a `unicode-range` fallback to **Noto Sans** (₹ only) is added.
- Subsets: Latin + Latin-1 + ₹ + common punctuation (– — ’ “ ” • × →). Target ≤ 45 KB per file.
- `font-display: swap` for body, `optional` for display (avoids layout shift). Metric-matched fallbacks (`size-adjust`, `ascent-override`) for Georgia (display) and Arial (body), so CLS stays below 0.01.
- Numbers: `font-variant-numeric: tabular-nums` on all money, tables, invoice numbers and KPIs. `lining-nums` in headings.
- Language: `lang="en-IN"`. Hyphenation off for headings and on (`hyphens: auto`) for long prose on mobile.

### 3.2 Type scale

The base is 16 px. UI text uses a 1.25 ratio; display sizes are fluid with `clamp()` between 360 px and 1280 px viewports. **The minimum text size is 12 px (captions only); body text is never below 16 px** (fixes audit M-4, M-7).

| Token | Size / line-height | Weight | Family | Use |
|---|---|---|---|---|
| `text-display-1` | clamp(2.75rem → **4.5rem**) / 1.05 | 500 | Newsreader | Home hero h1 |
| `text-display-2` | clamp(2.25rem → **3.5rem**) / 1.1 | 500 | Newsreader | Page h1 |
| `text-h2` | clamp(1.75rem → **2.5rem**) / 1.15 | 500 | Newsreader | Section h2 |
| `text-h3` | 1.5rem (24 px) / 1.25 | 600 | Plex Sans | Sub-sections, card titles (large) |
| `text-h4` | 1.25rem (20 px) / 1.3 | 600 | Plex Sans | Card titles, FAQ questions |
| `text-lede` | clamp(1.125rem → 1.375rem) / 1.5 | 400 | Plex Sans | Intro paragraphs |
| `text-body-lg` | 1.125rem (18 px) / 1.65 | 400 | Plex Sans | **Site prose** (articles, service pages) |
| `text-body` | 1rem (16 px) / 1.6 | 400 | Plex Sans | **App body**, forms, site UI |
| `text-sm` | 0.875rem (14 px) / 1.45 | 400/500 | Plex Sans | App table cells, secondary UI, footer links (≥ 14 px) |
| `text-caption` | 0.75rem (12 px) / 1.4 | 500 | Plex Sans | Eyebrows (uppercase, +0.08 em tracking), legal fine print, PDF footers. **Minimum.** |
| `text-price-lg` | clamp(1.75rem → 2.25rem) / 1.1 | 600, tabular | Plex Sans | Price tags |
| `text-code` | 0.9375rem / 1.6 | 400 | Plex Mono | Code blocks |

**Measure:** prose is max **68 ch**, ledes max 60 ch, headings max 22 ch (balanced with `text-wrap: balance`, paragraphs `text-wrap: pretty`).

---

## 4. Space, layout and breakpoints

### 4.1 Spacing scale (4 px base)

`0` 0 · `1` 4 · `2` 8 · `3` 12 · `4` 16 · `5` 20 · `6` 24 · `8` 32 · `10` 40 · `12` 48 · `16` 64 · `20` 80 · `24` 96 · `32` 128 (px)

| Rhythm token | Mobile | Tablet | Desktop |
|---|---|---|---|
| `--section-y` (between page sections) | 64 | 80 | 112 |
| `--block-gap` (between blocks in a section) | 32 | 40 | 48 |
| `--stack` (paragraph spacing) | 16 | 16 | 20 |
| `--gutter` (page side padding) | 16 | 24 | 32 |

### 4.2 Breakpoints (fixes audit M-8: tablets get a real tablet layout)

| Token | Min width | Layout |
|---|---|---|
| (base) | 0 | 4-column grid, single-column content, full-screen menu |
| `sm` | 480 px | Wider cards, 2-up small cards |
| `md` | **768 px** | 8-column grid, 2-up service cards, side-by-side form fields, inline nav for ≤ 5 items + "More" |
| `lg` | 1024 px | 12-column grid, full nav with dropdowns, 3-up cards, sticky ToC on long pages |
| `xl` | 1280 px | Max container reached |
| `2xl` | 1536 px | Larger outer margins only (content width doesn't grow) |

**Containers:** `--container` 1200 px · `--container-wide` 1360 px (pricing table, diagrams) · `--container-prose` 68 ch. Apps: fluid, with a side nav of 248 px (collapsible to 64 px).

### 4.3 Shape, elevation, borders

| Token | Value |
|---|---|
| `radius-sm` | 4 px (inputs, tags) |
| `radius-md` | 8 px (buttons, cards in apps) |
| `radius-lg` | 12 px (site cards, dialogs) |
| `radius-full` | 999 px (pills, avatars) |
| `border-hairline` | 1 px `--color-border` |
| `shadow-1` | `0 1px 2px rgb(17 26 69 / .06), 0 1px 1px rgb(17 26 69 / .04)` |
| `shadow-2` | `0 8px 24px rgb(17 26 69 / .08), 0 2px 6px rgb(17 26 69 / .05)` (dialogs, menus) |
| Dark theme | Shadows replaced by a 1 px lighter border + `surface-raised` |

**Signature detail:** the **orange "swoosh rule"**, a 2–3 px gently curved orange line (an SVG echo of the logo swoosh). It is used sparingly: under the hero h1, at the top of PDF documents, and as the active-nav indicator. It is the one decorative flourish of the system.

### 4.4 Motion

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 120 ms | Hover, focus, toggles |
| `duration-base` | 200 ms | Menus, accordions |
| `duration-slow` | 320 ms | Dialogs, page-section reveals (optional) |
| `ease-standard` | `cubic-bezier(.2,.8,.2,1)` | All |

**Rules:**
- No infinite loops.
- No parallax.
- No auto-advancing carousels.
- Animations explain state changes only.
- `prefers-reduced-motion: reduce` → durations 0 and no transforms (fixes audit M-5, M-6).

### 4.5 Iconography and imagery
- **Icons:** Lucide (ISC licence), 1.5 px stroke, sizes 16 / 20 / 24, inlined as SVG (the site) or tree-shaken (apps). Decorative icons get `aria-hidden`; meaningful ones get a label.
- **Diagrams:** custom SVG (architecture, workflow, process), built with the tokens, labelled "Illustrative" where they don't depict a real client system. They must work in both themes (via `currentColor` + CSS variables).
- **Photography:** only real photos (the founder headshot at launch). No stock "team" photos.
- **OG images:** generated at build. Paper or navy background, the Newsreader title, a category eyebrow, the swoosh rule and the logo.

---

## 5. Components

### 5.1 Shared rules (all components)
- **Targets ≥ 44 × 44 px** (WCAG 2.5.8 needs 24 px; we choose 44 px).
- **Visible focus** on every interactive element: `outline: 2px solid var(--color-focus); outline-offset: 2px`. Never `outline: none` without a replacement (fixes audit M-5).
- **Disabled controls** keep ≥ 3:1 for the label and show why they're disabled (a tooltip or helper text) where useful.
- **States documented for each:** default, hover, focus-visible, active, disabled, loading, error, and selected where relevant.
- **ARIA patterns** follow the WAI-ARIA Authoring Practices exactly (menus, tabs, dialogs, comboboxes); no half-implemented patterns (fixes audit L-4).

### 5.2 Public website (Astro components, zero JS unless marked ⚡ for a tiny island)

| Component | Notes |
|---|---|
| `Logo` | The SVG lockup chosen by width; `aria-label="TecHaust Technologies – home"` |
| `SiteHeader` ⚡ | Sticky after scroll (no hide-on-scroll jank); dropdowns are disclosure buttons (`aria-expanded`), not `role="menu"`; mobile menu = a dialog with a focus trap |
| `ThemeToggle` ⚡ | A three-state cycle: system → light → dark. Icon + accessible name ("Theme: system"). |
| `CurrencyToggle` ⚡ | ₹ / $ segmented control (radio group semantics); persists the choice |
| `PriceTag` | "from" label + amount (`text-price-lg`, tabular) + unit ("/month", "per workflow") + GST note slot; renders both currencies, and CSS shows the active one |
| `Button` / `ButtonLink` | Variants: primary, secondary, ghost, text-link. Sizes: md (44 px), lg (52 px). Icon slot. Real `<a>` for navigation, `<button>` for actions. |
| `Eyebrow` + `SectionHeader` | Eyebrow (caption, uppercase, accent) + h2 + lede |
| `ServiceCard` | Category eyebrow, title, one-liner, "from" price, arrow link. The whole card is clickable via a stretched link (one link, not nested). |
| `CaseStudyCard` | Industry, problem, headline metric (real only) + "Anonymised" tag |
| `BlogCard` | Title, date, reading time, tags |
| `Steps` | Numbered process (ordered list semantics) with optional duration per step |
| `DeliverablesList` | Check-icon list (list semantics, icons hidden from assistive tech) |
| `ComparisonTable` | Care-plan tiers: a real `<table>` with `scope`. On mobile it becomes stacked cards per tier, with the same data. |
| `FAQ` | A `<details>`/`<summary>` list (works without JS), plus JSON-LD |
| `CTABand` | Navy background (light theme) with a white-text primary CTA; pre-fills the service |
| `Breadcrumbs` | `nav aria-label="Breadcrumb"` + JSON-LD |
| `Notice` | Variants: info, legal ("Pending legal review"), illustrative ("Illustrative example") |
| `DiagramFrame` | `<figure>` + caption + an "Illustrative" badge |
| `Prose` | Markdown typography: headings, lists, tables, blockquotes, code, footnotes, images with captions |
| `TOC` ⚡ | Sticky on `lg+` for long pages; highlights the current section (IntersectionObserver), with no scroll hijacking |
| `CookieBanner` ⚡ | Bottom sheet (not a modal), "Accept analytics" / "Reject" equal weight, "Preferences" link; doesn't cover the hero CTA on 375 px |
| `QuoteForm` ⚡ | A multi-step form (see §5.4), progressively enhanced from a single long form |
| `WhatsAppLink` | Icon + "Chat on WhatsApp" + hours; hidden if no number is configured |

### 5.3 Admin and portal (React components in `packages/ui/react`)

Built on **Radix UI primitives** (Dialog, Popover, DropdownMenu, Tabs, Tooltip, Select) for accessibility, styled with the tokens. No heavyweight component library.

| Component | Notes |
|---|---|
| `AppShell` | Side nav (collapsible, keyboard-navigable), top bar, content area with max width 1440 px |
| `PageHeader` | Title, breadcrumb, primary action, secondary actions in an overflow menu |
| `DataTable` | Server-side sort, filter and pagination; sticky header; row selection; column visibility; a keyboard-navigable grid only where needed (a plain table otherwise); responsive (cards below `md`). Money columns are right-aligned and tabular. |
| `FilterBar` | Chips for active filters; synced to the URL |
| `StatusPill` | Icon + text + colour, for every document state (§5.5) |
| `Money` | Formats minor units → `₹1,23,456.00` (en-IN) or `$12,345.00` (en-US); `aria-label` with full words optional |
| `MoneyInput` | Accepts typed amounts with Indian or Western grouping; stores integer minor units; never float maths; shows the currency prefix |
| `PercentInput`, `QuantityInput` | Decimal-safe (string-based parse → integer basis points / milli-units) |
| `LineItemsEditor` | Rows: catalogue picker (combobox), description, SAC, quantity, unit, rate, discount, tax rate. Keyboard: Enter adds a row; reorder by drag or by buttons (accessible alternative). Live totals. |
| `TaxBreakdown` | CGST/SGST or IGST or "Zero-rated (LUT)" summary by rate; round-off line; total in words |
| `PaymentScheduleEditor` | Instalments (% or fixed) with milestone labels; shows the rounding remainder on the last instalment; sums are always exact |
| `ConfirmDialog` | For money and irreversible actions: summary (document, client, amount, what happens), typed confirmation for void/refund, and a step-up TOTP slot |
| `StepUpAuth` | A 6-digit OTP input (`autocomplete="one-time-code"`, paste-friendly, single field with spacing) |
| `ApprovalBanner` | Shows the pending-approval state and the approver; offers "Request approval" |
| `KPITile` | Label, value (tabular), period, delta vs the previous period (with text, not just an arrow) |
| `ActivityTimeline` | Audit and activity entries with actor, time (IST, relative + absolute on hover/focus) |
| `Kanban` | Lead pipeline; every move is also possible via a "Move to…" menu (keyboard and screen-reader alternative to drag) |
| `FileDrop` | Drag-and-drop + a button; type and size checked before upload; progress; errors announced |
| `EmptyState` | Explains what goes here + the primary action |
| `Skeleton` | Loading placeholders for app data (no spinners for page loads; a spinner only inside buttons) |
| `Toast` | `role="status"` for success, `role="alert"` for errors; auto-dismiss ≥ 6 s with pause on hover/focus; never the only place an error appears |
| `FormField` | Label, hint, error (linked via `aria-describedby`), required marker (text, not just *) |
| `ErrorSummary` | At the top of a form on submit, linking to each invalid field; receives focus |

### 5.4 Forms (site and apps)
- Labels above fields; hints below labels; errors below fields in `danger`, with an icon.
- **Validation:** on blur, and on submit; never while typing the first characters.
- Correct `autocomplete` tokens (name, email, organization, tel, country) and `inputmode` (email, tel, numeric).
- **Multi-step quote form:**
  - a progress indicator ("Step 2 of 4: Goals") as text plus a bar
  - each step is a `<fieldset>` with a `<legend>`
  - focus moves to the step heading on step change
  - Back never loses data
- **Radio cards** (service picker, budget bands): native radio inputs inside labels, so the whole card is clickable and arrow keys work.

### 5.5 Document status colours (apps, portal, PDFs)

| Status | Pill style | Icon |
|---|---|---|
| Draft | Neutral (sand fill, navy text) | pencil |
| Pending approval | Warning | clock |
| Sent / Issued | Info | send / file-check |
| Viewed | Info (outline) | eye |
| Accepted / Paid | Success | check-circle |
| Partially paid | Warning (outline) | circle-half |
| Overdue | Danger | alert-triangle |
| Rejected / Expired / Void / Revised | Neutral muted + strikethrough label for Void | x-circle / archive |
| Pending verification (manual payment) | Warning | shield-question |

---

## 6. Email design

| Aspect | Spec |
|---|---|
| Layout | 600 px single column, table-based, inline CSS (generated from tokens), dark-mode-safe (no pure-white logos on transparent backgrounds; a navy/white logo pair via `prefers-color-scheme` where supported) |
| Header | Logo (primary lockup, 140 px wide, PNG @2x + alt text "TecHaust Technologies"), then an orange swoosh rule |
| Body | Plex Sans with Arial/Helvetica fallback (web fonts aren't relied on), 16 px / 1.6, navy text on white |
| Button | "Bulletproof" (VML-safe) navy button with white text, 48 px tall; the plain URL is repeated below |
| Footer | Company trade name, "Balurghat, West Bengal, India", contact@techaust.com, why you got this email, and an unsubscribe link (non-transactional only) |
| Plain text | Every template has a hand-tuned plain-text version |
| Accessibility | `lang`, `role="presentation"` on layout tables, real headings, ≥ 4.5:1 contrast, no image-only content |

---

## 7. PDF document templates (proposals, estimates, invoices, credit notes, receipts, proforma, statements)

All documents are **HTML + print CSS rendered by Browser Run** ([05 §8](05-architecture.md)), sharing one template system in `packages/pdf`. Every value comes from the frozen document snapshot, never live data.

### 7.1 Page and print foundations

| Aspect | Spec |
|---|---|
| Size | **A4 portrait** (210 × 297 mm) |
| Margins | Top 16 mm · bottom 18 mm (footer) · left/right 16 mm |
| Grid | 12 columns, 4 mm gutters |
| Fonts | Newsreader (document title, proposal headings) + IBM Plex Sans (everything else), **embedded** via `@font-face` data URIs; ₹ verified (§3.1); tabular numbers everywhere |
| Colour | Navy text on white. Orange only for the swoosh rule and the thin accent bar. Status is never colour-only. **Legible in grayscale** (checked by rendering a grayscale proof in tests). |
| Sizes | Body 9.5 pt / 13 pt leading; table cells 9 pt; small print 7.5 pt (minimum); totals 11 pt bold; grand total 14 pt |
| Repeating elements | Table headers repeat on each page (`thead { display: table-header-group }`); rows never split (`break-inside: avoid`); the totals block is kept together with the last rows |
| Footer (every page) | Symbol mark · "TecHaust Technologies · techaust.com · billing@techaust.com" · document number · "Page X of Y" |
| Metadata | `<title>` = "Tax Invoice TH/INV/2627/0001 – Client name"; `lang="en-IN"`; tagged PDF enabled where the renderer supports it |
| Integrity | A small footer line on the final page: "Document ID ‹uuid› · Content fingerprint ‹first 12 hex chars of the SHA-256 of the snapshot›". It is verifiable against the admin. |

### 7.2 Shared header (all document types)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ [TECHAUST logo, 42 mm]                                 TAX INVOICE        │  ← Newsreader 20 pt, navy
│                                              ORIGINAL FOR RECIPIENT       │  ← caption, GST docs only
│ ~~~~~~~~~~~~~~~~~~ orange swoosh rule (full width, 0.8 mm) ~~~~~~~~~~~~~~ │
│ FROM (supplier)                 BILL TO                     DOCUMENT       │
│ TecHaust Technologies           Client legal name           No. TH/INV/…   │
│ Proprietor: ‹legal name›        Address lines               Date 06 Oct 26 │
│ Address (principal place)       GSTIN ‹15 chars› / —        Due  13 Oct 26 │
│ GSTIN ‹15 chars› · State WB(19) Place of supply: ‹State (code)›  PO/Ref …  │
│ billing@techaust.com            Contact name, email         Currency INR   │
└──────────────────────────────────────────────────────────────────────────┘
```

Supplier block contents come from Settings (ADM-SET-01). **This is the only place the proprietor name and GSTIN appear publicly** (owner decision).

### 7.3 Per-document specifics

| Document | Title (exact wording is a setting, VERIFY WITH CA) | Body | Special blocks |
|---|---|---|---|
| **Tax Invoice** | "Tax Invoice" | Line items table: # · Description (+ SAC on a second line) · Qty · Unit · Rate · Discount · Taxable value · GST % | **Tax summary by SAC/rate**: taxable value, CGST (rate, amount), SGST (rate, amount) **or** IGST (rate, amount) · totals block (sub-total, discount, taxable value, taxes, round-off, **Total**) · **amount in words** (Indian system) · "Tax payable on reverse charge: No" · payment block (amount paid, **balance due**, due date, a "Pay online" QR code + short link, bank details INR) · "Authorised signatory" with an optional signature image · notes and terms (versioned) |
| **Export Invoice** | "Tax Invoice – Export of Services" + mode line (current Rule 46 wording): "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX" + "LUT ARN ‹…› for FY ‹…›" **or** "SUPPLY MEANT FOR EXPORT … ON PAYMENT OF INTEGRATED TAX"; country of destination | As the tax invoice, in USD | Currency USD; **INR equivalent + exchange rate (value, date, source)**; place of supply "Outside India (96 – Other Territory)" (VERIFY WITH CA); bank details with SWIFT; purpose-code hint for the client's bank |
| **Proforma** | "Proforma Invoice – not a tax invoice" | Line items + payment request amount (e.g. "Advance 40 % of TH/PRP/2627/0003 v2") | Large "Pay online" block; "A tax invoice will be issued on receipt of payment"; no tax summary is required (tax shown as an estimate, VERIFY WITH CA) |
| **Debit Note** | "Debit Note" | Same as the credit note, for upward corrections | Reference to the original invoice |
| **Credit Note** | "Credit Note" | Reference to the original invoice (number + date), reason, credited lines/amounts with tax reversal | "Original invoice: TH/INV/2627/0012 dated …"; the net effect on the balance |
| **Receipt** | "Payment Receipt" | A compact single page: receipt number and date, received from, **amount (large)**, in words, mode (UPI/card/netbanking/Stripe/PayPal/NEFT/RTGS/IMPS/SWIFT), gateway or UTR reference, against document(s), balance remaining | A "Thank you" line; no tax table (unless your CA wants a receipt voucher with tax for advances, which is a template variant) |
| **Estimate** | "Estimate" | Line items + tax preview + validity date ("Valid until …") + payment schedule | "This is an estimate, not a tax invoice." · an acceptance call-to-action (portal link) |
| **Proposal** | Cover page + sections | See §7.4 | The estimate section as above + acceptance block |
| **Statement of account** | "Statement of Account" | Date range; opening balance; dated rows (invoices, credit notes, payments); running balance; closing balance | Ageing summary (0–30 / 31–60 / 61–90 / 90+) |

### 7.4 Proposal layout (editorial)

1. **Cover** (full page):
   - logo top-left, swoosh rule
   - the title in Newsreader 32 pt (e.g. "Invoice-to-Tally automation pilot")
   - "Prepared for ‹Client›", the date, "Version 2", "Valid until ‹date›", the proposal number
   - the contact person at TecHaust
2. **Summary** (≤ ½ page): the outcome, the price headline, the timeline headline.
3. **Your goals / the problem**, **Scope** (in / out), **Deliverables**, **Timeline** (milestone table: milestone · what you get · target date · payment %), **Team** (roles), **How we work** (shared text).
4. **Investment**: the estimate table + tax summary + payment schedule table (instalment · trigger · % · amount).
5. **Assumptions & exclusions**, **Terms** (versioned, shared with the website "How we work" text).
6. **Acceptance**: an instruction box ("Accept online at portal.techaust.com"). On the **accepted** copy, a stamped record is added: "Accepted by ‹typed name› (‹email›) on ‹date time IST› from IP ‹…› · Document fingerprint ‹SHA-256›".

Headings are Newsreader; body text is Plex Sans 10 pt / 14 pt; each section starts on a new page only if less than 40 % of the current page remains.

### 7.5 Template engineering rules
- One `DocumentLayout` + per-type body partials. **No logic in templates** beyond formatting; all maths comes pre-computed from `packages/core` (tested).
- Every template has fixtures: short, long (3+ pages, 40 lines), USD export, intra-state, inter-state, credit note, and a **long client name and address** (overflow test).
- Visual regression: render the fixtures to PNG in CI (local Chromium via Playwright, not Browser Run) and diff against approved snapshots.

---

## 8. Accessibility checklist (design-level)

- [ ] All semantic colour pairs pass the contrast test (§2.3)
- [ ] Focus is visible on every interactive element in both themes
- [ ] Targets ≥ 44 px; no text below 12 px; body ≥ 16 px
- [ ] Reduced motion respected; nothing flashes more than 3 times per second
- [ ] Information never conveyed by colour alone (status pills, form errors, charts)
- [ ] Headings are hierarchical (one h1); landmarks on every page
- [ ] Data tables have `<th scope>` and captions; mobile card variants keep the labels
- [ ] Forms: labels, hints, errors linked; error summary; `autocomplete`
- [ ] PDFs: title, language, reading order; grayscale-legible

---

## 9. What I need you to approve in this document

1. **Palette:** navy `#111A45` + orange `#FF5100` from your logo, on warm neutrals; navy primary buttons (orange buttons in dark mode).
2. **Fonts:** Newsreader (display) + IBM Plex Sans/Mono (UI, body, code).
3. **Logo refinements** (§1.2), especially the **compact lockup** for small sizes and the **symbol** (pixel cluster) for the favicon. You'll see drawn variants in Phase 6 M1 before anything ships.
4. **Signature detail:** the orange swoosh rule, used sparingly.
5. **PDF layouts** (§7): A4, the header structure, and the per-document blocks.
