Status: open
Tier: C
Usage:

# Brand wallpapers (desktop + mobile)

## Brief

**What:** three wallpaper concepts for company PCs and phones, each in a desktop and a mobile version, so 6 PNGs. They are brand assets generated from the brand sources (identity "Patina", [06 §1](../06-design-system.md)), not drawn by hand and not made by an AI image model. No PRD ID applies (it's internal brand collateral).

**Owner's decisions (2026-10-12, [13](../13-decisions.md)):**
- one **dark (ink)** image per concept; no light variants
- **flat tones only**, with no gradients, glows or noise (the brand rule "no curves, swooshes or gradients" holds)
- **the TH mark only**: no wordmark, no strapline and no text of any kind
- the files live in the repo at `packages/ui/brand/wallpapers/`, with the script that makes them

**Output specs**
- Desktop: 3840 × 2160 px, landscape. Mobile: 2160 × 4680 px, portrait, **recomposed** for the vertical frame (not a crop of the desktop version).
- PNG, sRGB, lossless. Flat tones mean no banding is possible; there must be no anti-aliasing seams between adjacent tones beyond normal edge AA.
- Names: `wallpaper-<concept>-desktop.png` and `wallpaper-<concept>-mobile.png`, with concepts `monolith`, `cut` and `construction`.

**Concepts** (palette from `tokens/tokens.json` only: ink-950 … ink-600, verdigris-900 … verdigris-300; the mark from `src/brand/geometry.ts`)
1. **Monolith:** the TH mark very large and tone-on-tone (for example ink-800/ink-700 on ink-950), bleeding off an edge, with a single restrained verdigris accent that follows the mark's colour logic (crossbar and right stem are the accent, never swapped). The calmest of the three.
2. **Cut:** the mark's 45° diagonal cut taken across the whole frame: two deep tones split by a channel exactly one mark stroke wide (19/100 of the mark's unit, scaled), in verdigris. Architectural and minimal.
3. **Construction:** the mark's 100-unit construction grid as faint hairlines, with the mark traced on it in verdigris-300/500 hairlines or thin fills ("built properly"). The grid must fade out *by stopping*, not by gradient: drawn only in a bounded region, with sparse lines, so it is never busy.

**Usability (hard requirements)**
- Desktop: the **left 30 %** (icons) and the **bottom 8 %** (taskbar/dock) stay quiet: only the background tone, or tone-on-tone with ΔL small enough that white icon labels and their shadows stay fully readable.
- Mobile: the **top 15 %** (clock, notifications) and the **bottom 12 %** (dock, home bar) stay quiet; the focal point sits in the **middle third**.
- The images must work behind both light- and dark-theme system UI (Windows 11 taskbar in light and dark, translucent docks), and stay calm over long hours: no high-contrast detail behind icons and no busy repetition.
- The mark is never stretched, rotated, outlined (except the deliberate hairline trace in concept 3, which keeps the true geometry) or recoloured outside the ink/verdigris logic. Respect the brand don'ts in [06 §1](../06-design-system.md).
- Everything should be crisp at 100 % zoom: compute geometry in output pixels, and snap axis-aligned edges and hairlines to whole pixels.

**Files (designer)**
- `packages/ui/src/brand/wallpapers.ts`: pure composition (tokens + geometry → SVG strings per concept and format), alongside `compose.ts`
- `packages/ui/scripts/build-wallpapers.ts`, plus a `build:wallpapers` script in `packages/ui/package.json`: renders the SVGs to PNG with `sharp` (already a dependency). **No new packages.**
- `packages/ui/brand/wallpapers/*.png` (the 6 outputs, committed)
- a drift test in `packages/ui/test/` (for example `wallpapers.test.ts`): it regenerates the SVGs and checks them against committed sources or hashes, and checks each PNG's dimensions. Keep it fast. If rendering 4K PNGs in CI is slow, compare the SVGs and check the PNGs' size and colour space only.
- the `CLAUDE.md` Commands block and [06 §1](../06-design-system.md): one line each naming the new script and the wallpapers

**Preview first.** Before polishing, produce a **preview sheet** for the owner (under `.logs/wallpapers/`, which is git-ignored): each wallpaper scaled down, overlaid with
- desktop: a column of placeholder icons with white labels down the left, plus a Windows 11-style taskbar in both light and dark theme
- mobile: a status bar with a clock at the top, a dock and a home bar at the bottom

Then stop and report, with the paths. The lead shows the owner and comes back with approval or changes.

**Done means:** the owner has approved the preview; the 6 PNGs are at the exact sizes; `pnpm --filter @techaust/ui test` passes; the whole-repo lint (`bash tools/heavy.sh --log lint pnpm lint`) and `pnpm --filter @techaust/ui typecheck` pass; and the designer report below is filled in.

**Out of scope:** light variants, a wordmark or text, animated or live wallpapers, lock-screen-specific versions, and any change to the mark's geometry or the tokens.

## Designer report

## Review

## Integration notes

## Handover
