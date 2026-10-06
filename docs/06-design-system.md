# 06: Design system (site, admin, portal, email and PDF documents)

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06). §1–3 rewritten in Phase 6 M1.1 for the new identity "Patina" (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 (last updated 2026-10-07) |
| **Inputs** | Owner brief for a new identity (2026-10-06; the supplied logo files in `brand-incoming/` are retired) · [11 brand audit](11-brand-audit.md) · [03 §3A.5](03-plan.md) design direction · audit findings M-4 to M-8 ([01](01-audit.md)) |
| **Implements** | [04 PRD](04-prd.md) WEB-G-05, WEB-G-13 to WEB-G-16, NFR-4 |

> **One source of truth.** All tokens live in `packages/ui/tokens/tokens.json`. A build script generates (1) CSS custom properties, (2) the Tailwind v4 `@theme` used by the site, admin and portal, (3) inline-style constants for email templates, and (4) the print CSS for PDFs. A token is never typed by hand in an app. Print CMYK values live in `tokens/print-cmyk.json` (§1.6).

---

## 1. Brand foundations

> **Identity "Patina" (owner-chosen 2026-10-06, after a three-concept round), refined by the brand audit in [11](11-brand-audit.md).** It replaces the supplied navy/orange "TECHAUST" logo, which is retired. Source of truth: `packages/ui/src/brand/geometry.ts`, which defines the mark and the wordmark edits as numbers. `pnpm --filter @techaust/ui draw:master` then `build:brand` regenerate every file, and tests fail on any drift.

### 1.1 The idea
Ink green and verdigris: the colour copper earns after years outdoors. Systems built properly, then looked after for years (build + AMC), which is what TecHaust sells. The strapline is the approved home-page H1: **"Build it right. Automate the rest."**

### 1.2 The mark
- **Construction:** a TH ligature on a 100-unit grid, made as **one block split by a single diagonal cut**. The T and the H share one stem. The T bar's end and the H's right stem are cut at 45°, and the channel between the two cuts is exactly **one stroke wide** (19 units).
- **Optical corrections:** horizontals are 8 % thinner than verticals (17.5 vs 19). The crossbar sits 1.5 units above the geometric centre.
- **Colour logic:** the T and the shared stem are always ink (the "base"); the crossbar and the right stem are verdigris (the "accent"). Never swap them.
- **Small sizes:** at 64 px and below the mark is **pixel-fitted**, so every edge lands on a whole pixel. `favicon.svg` is drawn on a 16-unit grid, so it is crisp at 16 and 32 px and switches colours in a dark browser.

### 1.3 The wordmark
"TecHaust" in Archivo (OFL) at weight 620 and width 116 %, outlined, so it is artwork and not live text. Bespoke edits:
- the T bar carries the mark's 45° cut
- everything after the T is kerned 9 units closer
- three pairs are optically re-spaced: cH −4, Ha −2, st −2 (measured white area, [11 §2.3](11-brand-audit.md))

Mixed case is deliberate: it keeps "Haust" readable.

### 1.4 Lockups and rules
| Lockup | Use | File |
|---|---|---|
| **Primary (horizontal)** | Default: site header, documents, email | `logo-primary-*.svg` |
| Stacked | Square spaces (merch, slides, signage) | `logo-stacked-*.svg` |
| Wordmark only | Where the mark already appears nearby | `logo-wordmark-*.svg` |
| Symbol | Favicon, avatars, app icon, PDF footers | `logo-symbol-*.svg`, `logo-tile.svg` |

**Rules:**
- **Proportions:** the mark is 1.28 × the cap height, centred on the caps. The gap between mark and wordmark is two mark strokes.
- **Clear space:** one mark stroke on every side.
- **Minimum size:** horizontal lockup 96 px wide on screen (24 mm in print); symbol 16 px (6 mm).
- **Colour versions:** full colour on light; on dark (mist + light verdigris); one colour ink, white or black. Nothing else.
- **Never:**
  - stretch, rotate or outline the mark
  - recolour it outside the palette, or swap the two colours
  - add shadows, glows or gradients
  - place it on busy photos
  - set "TecHaust" in a live font in place of the wordmark

### 1.5 Deliverables (`packages/ui/brand/`, all generated)
- **Vector logos:** 4 lockups × 5 colour versions (SVG), plus `logo-tile.svg`.
- **Favicons:** `favicon.svg` (pixel-fitted, adaptive) and `favicon.ico` (16/32/48, pixel-fitted tiles).
- **App icons:** `apple-touch-icon.png`, `icon-192/512.png`, `icon-maskable-512.png`.
- **Social:**
  - `profile-400.png` (LinkedIn page logo) and `profile-800.png` (WhatsApp, X, Google)
  - `cover-linkedin-company.png`: 1512 × 256, LinkedIn's official size
  - `cover-linkedin-profile.png`: 1584 × 396
  - `cover-x.png`: 1500 × 500, with content kept inside X's 60 px top and bottom crop
- **Link previews:** `og-default.png` / `og-default-dark.png`, 1200 × 630, with the strapline.
- **Email:** `logo-email-color@2x.png`, `-dark@2x.png`, and `logo-email-badge@2x.png`. The badge has a white plate, so the logo survives clients that force dark mode by inverting colours.
- **Print** (`print/`): vector PDFs in CMYK with all text outlined (§1.6):
  - `logo-primary-cmyk.pdf` and `-on-dark.pdf`
  - `business-card.pdf`: 3.5 × 2 in, 3 mm bleed, with trim and bleed boxes
  - `letterhead-a4.pdf`

### 1.6 Print colour
CMYK values come from a real ICC profile, not a formula. `scripts/measure-cmyk.py` searches the CMYK space with LittleCMS against SWOP coated (Microsoft `RSWOP.icm`), with total ink ≤ 300 %. The results are in `tokens/print-cmyk.json`.

| Colour | Hex | CMYK (starting values) | ΔE |
|---|---|---|---|
| Ink | `#14231F` | 88 / 56 / 60 / 72 | 0.0 |
| Verdigris | `#1E6B5C` | 92 / 40 / 64 / 4 | 0.0 |
| Light verdigris (dark backgrounds) | `#6CC4AE` | 60 / 0 / 32 / 0 | 3.8 (the closest printable) |
| Mist | `#E4EBE7` | 8 / 0 / 4 / 4 | 0.8 |

**Before any print run:**
- approve a printed proof against the hex colours
- for premium stationery, ask the printer to match verdigris to a **Pantone Solid Coated** swatch from a physical guide, then record the number here

**Owner action:** confirm the phone/WhatsApp number for the business card (it is left off until then).

### 1.7 Personality → design principles

| Principle | Meaning in practice |
|---|---|
| **Calm** | Generous white space, few colours on screen at once, no constant motion, no glows |
| **Engineered** | One family of type, exact alignment, one decorative device (the diagonal cut), nothing ornamental |
| **Premium, not flashy** | Hairline borders, restrained shadows, tabular numbers for prices; verdigris used sparingly, never as large fills |
| **Honest** | Diagrams over fake dashboards; "Illustrative" labels; no decorative "live" indicators |
| **Indian + global** | ₹ and $ treated equally; the lakh/crore format for INR; IST shown with the visitor's local time |

---

## 2. Colour tokens

### 2.1 Palette (`tokens/tokens.json`)

| Group | Tokens |
|---|---|
| **Ink** (text, dark surfaces) | `ink-950 #0D1613` · `ink-900 #14231F` (brand ink) · `ink-800 #15211D` · `ink-750 #111C18` · `ink-700 #1B2924` · `ink-600 #26352F` · `ink-500 #61796F` · `ink-400 #485752` · `ink-300 #9DB0A8` |
| **Verdigris** (brand accent) | `verdigris-900 #1F4A40` · `-800 #175548` · `-700 #1E6B5C` (brand) · `-500 #2E8B77` · `-300 #6CC4AE` (brand, dark) · `-200 #8AD4C1` · `-100 #D7ECE5` |
| **Stone** (light neutrals) | `stone-50 #F6F7F5` (page) · `-100 #ECEFEB` · `-200 #E1E6E2` · `-300 #D3DBD6` · `-500 #7A8B84` (control borders) |
| **Other** | `mist #E4EBE7` (dark-theme text) · `white` · `black` |
| **Status** (always with an icon + label) | success `#47730F` / `#A9D46B` (80° of hue away from verdigris, so success never reads as "brand") · warning `#8F5B00` / `#E9B44C` · danger `#B3261E` / `#FF8A80` · info `#2B5797` / `#8DB4FF` |

### 2.2 Semantic tokens (what components use)

| Semantic token | Light | Dark |
|---|---|---|
| `--color-bg` | `stone-50` | `ink-950` |
| `--color-surface` / `-alt` / `-raised` | `white` / `stone-100` / `white` + shadow | `ink-800` / `ink-750` / `ink-700` |
| `--color-fill-subtle` | `stone-200` | `ink-750` |
| `--color-text` / `-muted` | `ink-900` / `ink-400` | `mist` / `ink-300` |
| `--color-text-accent`, `--color-link-hover`, `--color-focus` | `verdigris-700` | `verdigris-300` |
| `--color-link` | `ink-900` (underlined) | `mist` (underlined) |
| `--color-border` / `-control` | `stone-300` / `stone-500` | `ink-600` / `ink-500` |
| `--color-btn-primary-bg` / `-fg` / `-hover` | `verdigris-700` / `white` / `verdigris-800` | `verdigris-300` / `ink-950` / `verdigris-200` |
| `--color-btn-secondary-fg` | `ink-900` | `mist` |
| `--color-accent-decor` | `verdigris-500` | `verdigris-300` |
| `--color-selection` | `verdigris-100` | `verdigris-900` |
| Shadows | soft ink shadows (`--elevation-1/2`; `--shadow-1/2` are aliases of them) | replaced by a 1 px `ink-600` outline |

### 2.3 Contrast (computed from the tokens; the test `tokens/contrast.test.ts` enforces it)

| Pair | Light | Dark | Level |
|---|---|---|---|
| Text on page | 15.2 | 15.2 | AAA |
| Muted text on page / on alternate section | 7.1 / 6.6 | 8.1 / 7.7 | AAA on page |
| Accent text on page / alternate section | 5.9 / 5.5 | 8.9 / 8.4 | AA |
| Button label on primary button / on hover | 6.3 / 8.6 | 8.9 / 10.8 | AA |
| Control border on page / card (dark: also dialog 3.2) | 3.3 / 3.6 | 3.9 / 3.5 | AA non-text (1.4.11) |
| Focus ring on page | 5.9 | 8.9 | AA non-text |
| Decorative verdigris on page | 3.9 | 8.9 | Large text and non-text only |
| Success / warning / danger / info on page | 5.2 / 5.3 / 6.1 / 6.7 | 10.8 / 9.7 / 8.1 / 8.9 | AA |

**Rules:**
- Body text is never the decorative accent.
- Placeholders use `--color-text-muted`, and labels are always visible.
- Status is never colour alone.

---

## 3. Typography

### 3.1 Typefaces (SIL Open Font License, self-hosted, subset)

| Role | Family | Files |
|---|---|---|
| **Display** (h1, h2, the wordmark, PDF titles) | **Archivo, Expanded** (`font-stretch: 116%`, weight 560) | One variable file for display *and* text: `archivo-latin.woff2`, 34 KB, weights 400–600 × widths 100–116 %. ₹ ships as `archivo-rupee.woff2` (1.5 KB), loaded only on pages with ₹ |
| **UI and body** | **Archivo, Normal** (100 %, 400/500/600) | (the same file) |
| **Mono** (code only) | **IBM Plex Mono** 400 | `ibm-plex-mono-latin.woff2` 12 KB (+ ₹ file) |

**Requirements:**
- ₹ coverage is tested (`test/fonts.test.ts`). → (U+2192) is not in these fonts, so arrows are Lucide icons, never text.
- Two metric-matched Arial fallbacks keep layout shift near zero during font swap: "Archivo Fallback" for body text and "Archivo Expanded Fallback" for headings.
- Numbers: `tabular-nums` on money, tables, document numbers and KPIs.
- `lang="en-IN"`.
- Font licence: the OFL permits using the font to make a logo. The outlined wordmark is artwork, not Font Software.

### 3.2 Type scale

The base is 16 px; display sizes are fluid between 360 px and 1280 px viewports. **The minimum text size is 12 px (captions only); body text is never below 16 px.**

| Token | Size / line-height | Weight | Family | Use |
|---|---|---|---|---|
| `text-display-1` | clamp(2.75rem → **4.5rem**) / 1.05 | 560 | Archivo Expanded | Home hero h1 |
| `text-display-2` | clamp(2.25rem → **3.5rem**) / 1.1 | 560 | Archivo Expanded | Page h1 |
| `text-h2` | clamp(1.75rem → **2.5rem**) / 1.15 | 560 | Archivo Expanded | Section h2 |
| `text-h3` | 1.5rem (24 px) / 1.25 | 600 | Archivo | Sub-sections, card titles (large) |
| `text-h4` | 1.25rem (20 px) / 1.3 | 600 | Archivo | Card titles, FAQ questions |
| `text-lede` | clamp(1.125rem → 1.375rem) / 1.5 | 400 | Archivo | Intro paragraphs |
| `text-body-lg` | 1.125rem (18 px) / 1.65 | 400 | Archivo | **Site prose** |
| `text-body` | 1rem (16 px) / 1.6 | 400 | Archivo | **App body**, forms, site UI |
| `text-sm` | 0.875rem (14 px) / 1.45 | 400/500 | Archivo | Table cells, secondary UI |
| `text-caption` | 0.75rem (12 px) / 1.4 | 500 | Archivo | Legal fine print, PDF footers. **Minimum.** |
| `text-price-lg` | clamp(1.75rem → 2.25rem) / 1.1 | 600, tabular | Archivo | Price tags |
| `text-code` | 0.9375rem / 1.6 | 400 | Plex Mono | Code blocks |

**Measure:**
- prose: max **68 ch**
- ledes: max 60 ch
- headings: max 22 ch, with `text-wrap: balance`
- paragraphs: `text-wrap: pretty`

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

**Containers:** `--container-page` 1200 px · `--container-wide` 1360 px (pricing table, diagrams) · `--container-prose` 68 ch. Apps: fluid, with a side nav of 248 px (collapsible to 64 px).

### 4.3 Shape, elevation, borders

| Token | Value |
|---|---|
| `radius-sm` | 4 px (inputs, tags) |
| `radius-md` | 8 px (buttons, cards in apps) |
| `radius-lg` | 12 px (site cards, dialogs) |
| `radius-full` | 999 px (pills, avatars) |
| `border-hairline` | 1 px `--color-border` |
| `shadow-1` | `0 1px 2px rgb(20 35 31 / 0.06), 0 1px 1px rgb(20 35 31 / 0.04)` |
| `shadow-2` | `0 8px 24px rgb(20 35 31 / 0.08), 0 2px 6px rgb(20 35 31 / 0.05)` (dialogs, menus) |
| Dark theme | Shadows replaced by a 1 px `ink-600` outline (`0 0 0 1px #26352F`) + `surface-raised`. `--shadow-n` is an alias of `--elevation-n`. |

**Signature detail:** the **diagonal cut**, the 45° edge from the mark. It is used sparingly: as the corner of the active-nav indicator, on the top-right corner of the hero image frame, and as the tone-on-tone mark on banners. It is the one decorative device of the system; there are no curves, swooshes or gradients.

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
- **OG images:** generated at build on the `og-default` layout: stone or ink background, the lockup, the page title in Archivo Expanded (outlined), the domain, and the tone-on-tone mark bleeding off the right edge.

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
| `CTABand` | Ink background (light theme) with a verdigris-300 primary CTA; pre-fills the service |
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
| `Money` | Formats minor units → `₹1,23,456.00` (en-IN) or `$12,345.00` (en-US); negatives show a true minus sign (U+2212), e.g. `−₹1,000.00`; `aria-label` with full words optional |
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
| Draft | Neutral (stone fill, ink text) | pencil |
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
| Layout | 600 px single column, table-based, inline CSS (generated from tokens), dark-mode-safe (no pure-white logos on transparent backgrounds; an ink/mist logo pair via `prefers-color-scheme` where supported, plus the white-plate badge) |
| Header | Logo (primary lockup, 140 px wide, PNG @2x + alt text "TecHaust Technologies"; the white-plate badge version for clients that force dark mode), then a 2 px verdigris rule |
| Body | Archivo with Arial/Helvetica fallback (web fonts aren't relied on), 16 px / 1.6, ink text on white |
| Button | VML-safe (Outlook) verdigris button with white text, 48 px tall; the plain URL is repeated below |
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
| Fonts | Archivo Expanded (document title, proposal headings) + Archivo (everything else), **embedded** via `@font-face` data URIs; ₹ verified (§3.1); tabular numbers everywhere |
| Colour | Ink text on white. Verdigris only for the header rule and the mark. Status is never colour-only. **Legible in grayscale** (checked by rendering a grayscale proof in tests). |
| Sizes | Body 9.5 pt / 13 pt leading; table cells 9 pt; small print 7.5 pt (minimum); totals 11 pt bold; grand total 14 pt |
| Repeating elements | Table headers repeat on each page (`thead { display: table-header-group }`); rows never split (`break-inside: avoid`); the totals block is kept together with the last rows |
| Footer (every page) | Symbol mark · "TecHaust Technologies · techaust.com" and the sender address for the document type (`hello@techaust.com` for proposals and estimates, `billing@techaust.com` for invoices, proformas, receipts, credit/debit notes and statements) · document number · "Page X of Y" |
| Metadata | `<title>` = "Tax Invoice TH/INV/2627/0001 – Client name"; `lang="en-IN"`; tagged PDF enabled where the renderer supports it |
| Integrity | A small footer line on the final page: "Document ID ‹uuid› · Content fingerprint ‹first 12 hex chars of the SHA-256 of the snapshot›". It is verifiable against the admin. |

### 7.2 Shared header (all document types)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ [TecHaust logo, 42 mm]                                 TAX INVOICE        │  ← Archivo Expanded 20 pt, ink
│                                              ORIGINAL FOR RECIPIENT       │  ← caption, GST docs only
│ ──────────────────── verdigris rule (full width, 0.8 pt) ──────────────── │
│ FROM (supplier)                 BILL TO                     DOCUMENT       │
│ TecHaust Technologies           Client legal name           No. TH/INV/…   │
│ Proprietor: ‹legal name›        Address lines               Date 06 Oct 26 │
│ Address (principal place)       GSTIN ‹15 chars› / —        Due  13 Oct 26 │
│ GSTIN ‹15 chars› · State WB(19) Place of supply: ‹State (code)›  PO/Ref …  │
│ billing@techaust.com            Contact name, email         Currency INR   │
└──────────────────────────────────────────────────────────────────────────┘
```

Supplier block contents come from Settings (ADM-SET-01). **This is the only public place for the GSTIN and the proprietor's legal name as supplier** (owner decision; the website shows neither as supplier, [04 §0](04-prd.md) Identity). The sender address in the block follows the document type: `hello@` for proposals and estimates, `billing@` for invoices, proformas, receipts, credit/debit notes and statements (the example above is a tax invoice).

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
   - logo top-left, verdigris rule
   - the title in Archivo Expanded 32 pt (e.g. "Invoice-to-Tally automation pilot")
   - "Prepared for ‹Client›", the date, "Version 2", "Valid until ‹date›", the proposal number
   - the contact person at TecHaust
2. **Summary** (≤ ½ page): the outcome, the price headline, the timeline headline.
3. **Your goals / the problem**, **Scope** (in / out), **Deliverables**, **Timeline** (milestone table: milestone · what you get · target date · payment %), **Team** (roles), **How we work** (shared text).
4. **Investment**: the estimate table + tax summary + payment schedule table (instalment · trigger · % · amount).
5. **Assumptions & exclusions**, **Terms** (versioned, shared with the website "How we work" text).
6. **Acceptance**: an instruction box ("Accept online at portal.techaust.com"). Acceptance is recorded in a separate acceptance-certificate PDF ([05 §8](05-architecture.md)); the accepted proposal PDF is never changed.

Headings are Archivo Expanded; body text is Archivo 10 pt / 14 pt; each section starts on a new page only if less than 40 % of the current page remains.

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

## 9. What the owner approved in this document (approved 2026-10-06)

1. **Identity "Patina" (§1):** the TH-ligature mark with its one-stroke diagonal channel, the custom Archivo wordmark, and the lockup rules. Concepts and the audit: [11](11-brand-audit.md).
2. **Palette (§2):** ink + verdigris on stone, with a dark theme; verdigris primary buttons.
3. **Fonts (§3):** Archivo (Expanded for display, Normal for text) + IBM Plex Mono (code).
4. **Signature detail:** the diagonal cut, used sparingly.
5. **PDF layouts (§7):** A4, the header structure, and the per-document blocks.
6. **Print (§1.6):** the CMYK starting values; Pantone matching and the business-card phone number are owner actions.

---

## 10. Status
- [x] Design system, brand identity "Patina", documents and email layouts reviewed
- [x] **Approved by owner 2026-10-06**
