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

**Round 1: preview only (2026-10-12).** Branch `brand/wallpapers-design` (from `brand/wallpapers` @ 19b16b0), commit 73715e7 plus this report. Awaiting the owner's approval; nothing is wired anywhere else and no PR is open.

**What the three concepts are**
- **Monolith:** the mark at 3300 px (desktop) / 3200 px (phone), tone-on-tone (ink-800 on ink-950), rising past the top edge and running off the right edge just before the right stem. The accent left in the frame is the crossbar alone, in verdigris-900: one deep, restrained bar under the bar's 45° cut. This is the same crop as the brand's banner watermark (`og-default`), which also drops the right stem. On the desktop the shared stem passes under the taskbar, tone-on-tone only (ΔL* 5.1).
- **Cut:** a 45° verdigris-700 channel exactly one stroke wide (the stroke of a 480 px mark, 91 px) splitting ink-950 from ink-800. On the phone it crosses the whole frame through the middle third. On the desktop a "/" line can't cross a 16:9 frame without entering the icon column or the taskbar, so it runs from the top edge and stops square on the taskbar line (y = 1987). The two tones meet below it, tone-on-tone only.
- **Construction:** the mark traced on its true geometry, with the T and shared stem in ink-300 and the crossbar and right stem in verdigris-300 (4 px). It sits on three layers that stop at three distances: the 10-unit grid fills the clear space (ink-800, 2 px), and the lines through the mark's own edges plus its two 45° cuts reach one stroke further (ink-600, 2 px). One verdigris-500 dimension across the channel shows it is one stroke wide.
- **One family:** the same ink-950 ground and ink-800 second plane everywhere, and one verdigris rule: the larger the area, the deeper the tone (900 for a fill, 700 for a band, 300 for a hairline). No gradients, filters, opacity or text (the test enforces it).

**Files changed**
- `packages/ui/src/brand/wallpapers.ts` (new, pure): formats and quiet zones, `fitMark` (geometry.ts `markPaths` snapped to whole pixels, plus union outlines for the trace), the three compositions, `wallpaperPlan()`, `previewFocus()`
- `packages/ui/src/brand/png.ts` (new, Node-only): PNG chunk helpers; tags each PNG `sRGB` and stamps a `tEXt` `techaust:svg-sha256` with the hash of its SVG source
- `packages/ui/scripts/build-wallpapers.ts` (new) and the `build:wallpapers` script in `packages/ui/package.json`: sharp → opaque 8-bit RGB PNG, about 2.5 s for all six
- `packages/ui/scripts/preview-wallpapers.ts` (new): writes the preview sheets, 100 % crops, quiet-zone guides and `quiet-zones.json` to `.logs/wallpapers/` (run with `node packages/ui/scripts/preview-wallpapers.ts`)
- `packages/ui/brand/wallpapers/wallpaper-{monolith,cut,construction}-{desktop,mobile}.png` (6 outputs, 30–50 KB each)
- `packages/ui/test/wallpapers.test.ts` (new, 23 tests, about 3 s): six files and no strays; exact sizes, RGB 8-bit, sRGB, no ICC; each PNG's embedded hash matches today's SVG (drift without re-rendering 4K); palette colours only and nothing but flat fills; `fitMark` equals geometry.ts snapped, with all integer coordinates and a channel within 0.5 px of one stroke; colour logic per tagged part (base = ink family, accent = verdigris family); the quiet zones are measured in the committed PNG pixels (no verdigris, ΔL* ≤ 6 against ink-950)
- `packages/ui/scripts/build-brand.ts` and `packages/ui/test/brand.test.ts`: `wallpapers/` added to the keep and no-strays lists, so `build:brand` doesn't delete it

**Preview sheets** (`.logs/wallpapers/` in this worktree, git-ignored)
- `overview.png`: all six side by side
- `sheet-monolith.png`, `sheet-cut.png`, `sheet-construction.png`: desktop at 50 % under Windows 11 desktop icons with white labels and a dark taskbar, the same with a light taskbar, and the phone at 25 % with a status bar and clock, a dock and a home bar
- `alt-cut-desktop-stop-two-thirds.png`: an alternative Cut desktop whose channel stops at two-thirds height (not chosen; see the open questions)
- `crop-<concept>-<format>-{1,2}.png`: 640 × 640 crops at 100 % of the cuts, joins and line ends
- `guides-<concept>-<format>.png`: the frame with the quiet zones (red) and the phone's middle third (yellow) outlined
- `quiet-zones.json`: the measured largest ΔL* and the colour count per quiet zone

**Checks**
- Crisp at 100 %: every axis-aligned edge and hairline is on whole pixels; the 45° edges have normal 2-pixel anti-aliasing. Seam check across the Cut channel: the anti-aliased pixels blend verdigris straight into ink-800 (22,39,33) and never dip to the ground, because the second tone starts under the channel.
- Quiet zones: icons and the phone's top zone are pure ground in all six. Bottom zones: Monolith desktop and both Cuts hold the ink-800 plane (ΔL* 5.1, no verdigris); the others are pure ground.
- Colour logic: the T and stem are ink, the crossbar and right stem verdigris, in Monolith and Construction (tested). The Cut has no mark.

**Commands and results**
- `bash tools/heavy.sh --log wp-install pnpm install --frozen-lockfile --prefer-offline`: exit 0 (worktree had no node_modules; lockfile only, nothing new)
- `node scripts/build-wallpapers.ts` and `node scripts/preview-wallpapers.ts` (in packages/ui): wrote 6 PNGs and the sheets
- `pnpm exec vitest run test/wallpapers.test.ts`: 23 passed
- `bash tools/heavy.sh --log wp-ui-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp-ui-test pnpm --filter @techaust/ui test`: 5 files, 210 tests passed
- `bash tools/heavy.sh --log wp-lint pnpm lint`: 169 files, no fixes

**Not verified / not done**
- Not seen on a real Windows desktop or phone. The overlays are drawn mock-ups (translucent bars, not real Mica or acrylic blur), and the preview ran with sharp, not a browser.
- The `CLAUDE.md` Commands line and the docs/06 §1 line are not added yet. They wait for approval, since the files may still change. `CLAUDE.md` is the lead's to edit.
- No text appears in any wallpaper. The preview-sheet captions and the placeholder icon labels ("Recycle Bin", "Sample.pdf" …) are mock-up only.

**Open questions (owner)**
1. Cut, desktop: should the channel stop on the taskbar line (current, closest to "across the whole frame") or at two-thirds height (see `alt-cut-desktop-stop-two-thirds.png`)?
2. Monolith: is dropping the right stem off-frame acceptable? It's the banner-watermark crop; keeping the stem in frame would put verdigris inside the taskbar zone or shrink the mark below "very large".
3. Construction: the T and stem are traced in ink-300, the ink role on dark, rather than verdigris-500 as the brief's "verdigris-300/500" might suggest. That keeps the colour logic (T = ink, accent = verdigris). Is that right?

The owner answered all three in round 2 (below).

### Round 2: richer compositions (2026-10-12)

**Owner's decisions on round 1** (via the lead): the Monolith shows the whole mark, smaller but still large; the Cut's desktop channel ends on the taskbar line, and the two-thirds alternative is deleted; the Construction's ink-300 T and stem are correct. New direction: all three were too empty. Richness should come from depth (layered planes in small tone steps), scale contrast, and a little precision detail, while staying calm. Commit 02dd4bb, plus this report.

**What changed**
- **One system for all three.**
  - Tone ladder (L*): ink-950 6.4 · ink-750 9.1 · ink-800 11.5 · ink-700 15.2 · ink-600 20.7 · verdigris-900 28.3 · verdigris-800 32.1 · verdigris-700 40.5.
  - One light from the top left: faces looking up or left are lighter, and hard shadows fall down and right at 45°, the mark's own cut.
  - Each wallpaper has one very large ink-750 plane (ΔL* 2.7). It is the only thing allowed into the quiet zones, so the quiet zones stay part of the composition.
- **Monolith:** the whole mark (1300 px on the desktop, 1400 px on the phone) as a low-relief machined solid, centred on the right 60 % or in the phone's middle third.
  - The depth runs up and left by 0.22 of a stroke. The lit faces show: the bar's top in ink-600, the left sides in ink-700, the crossbar's top and the right stem's 45° cut as a bevel in verdigris-700.
  - Fronts are ink-800 (base) and verdigris-900 (accent), with a 3 px verdigris-300 glint on the cut's arris.
  - The hard ink-950 shadow falls on an ink-750 wall plane whose corner is cut at 45°, exactly one stroke from the solid. Four small registration crosses mark the clear space.
- **Cut:** a field of plates at stroke-multiple distances from the hero channel: the ink-750 plane 3 strokes before it, the ink-800 working plane 1 stroke before it, and raised ink-700 and ink-600 plates 1 and 2 strokes after it.
  - The raised plates end square at golden-section heights. Each has a reveal along its edge, getting deeper with distance: a verdigris-900 channel, then a shadow gap in the ground tone.
  - The hero keeps a 3 px verdigris-300 lit edge. Two small registration crosses sit on the reveals' centre lines, one stroke past their ends. The desktop channel still ends on the taskbar line; the phone's crosses the frame through the middle third.
- **Construction:** an ink-800 drawing sheet, its corner cut at 45°, lying on an ink-750 table plane and casting a hard shadow. On it:
  - a 5-unit sub-grid engraved in ink-750, and the 10-unit grid in ink-700
  - ruler ticks along two edges, longer at 0, 50 and 100
  - lines through the mark's edges and its two cuts, out to the sheet's edge
  - the mark filled tone-on-tone (ink-700 and verdigris-900) under its ink-300 and verdigris-300 trace
  - three verdigris-500 dimensions (stroke, channel, height) and a 1:1 slope marker in place of an angle arc, since the brand has no curves
  - ink-400 registration crosses at the clear space's corners; the top-right one sits exactly on the extended stem cut, which is real geometry
- **Tests** (still 23, about 3 s):
  - Quiet zones are tightened to "the ground or one plane within ΔL* 3" (was 6), still measured on the committed pixels, still with no verdigris allowed.
  - Colour logic now covers every tagged part: fronts, facets, bevel, glint, fills and traces.
  - The geometry test covers the new sizes and checks that the solid's pieces use only the mark's own coordinates.
  - Palette-only, flat-fill-only and drift-by-hash checks are unchanged.

**Measured:** quiet zones max ΔL* 2.7 in all six (`quiet-zones.json`). Crisp at 100 % (crops checked). Shadows are physically consistent (the stem shades its right side, the bar shades below its cut). No seams, because each solid is drawn as its swept hull in its side tone before the facets go on top.

**Preview** (same paths; the two-thirds alternative is deleted): `overview.png`, `sheet-<concept>.png`, `crop-*`, `guides-*`, `quiet-zones.json` in `.logs/wallpapers/`.

**Commands (round 2):**
- `node scripts/build-wallpapers.ts` and `node scripts/preview-wallpapers.ts`: wrote the PNGs and the sheets
- `pnpm exec vitest run test/wallpapers.test.ts`: 23 passed
- `bash tools/heavy.sh --log wp2-ui-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp2-ui-test pnpm --filter @techaust/ui test`: 210 passed
- `bash tools/heavy.sh --log wp2-lint pnpm lint`: 169 files, no fixes

**Not verified:** the same as round 1. Nothing was seen on a real screen or phone (mock-up overlays only), and the `CLAUDE.md` and docs/06 lines still wait for approval.

## Review

## Integration notes

## Handover
