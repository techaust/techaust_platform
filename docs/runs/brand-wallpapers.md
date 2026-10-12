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

### Round 3: soft abstract folds (2026-10-12)

**The owner's decisions** (docs/13, merged from `brand/wallpapers` @ 9273cf8): round 2 was rejected (too flat and "vector", too dark, too technical and logo-heavy, awkward), and its 3D bevels are out. The new direction:
- soft abstract folds in the mood of Windows 11 Bloom or macOS
- mid-tone verdigris and teal
- a small, subtle mark
- a wallpaper-only exception that allows gradients, curves and soft light

The sizes, PNG sRGB, no text, the quiet zones, generation from code and no new packages all still stand. The concepts are now **ribbon**, **fold** and **drape**.

**Technique.** A small deterministic software renderer in pure TypeScript (`src/brand/wallpaper-render.ts`), with no new packages:
- Surfaces are analytic (bands swept along bowed, gently waving paths), shaded by one soft key light from the top left: Lambert plus a Blinn sheen, soft drop shadows and valley occlusion.
- Light is computed in linear float, then mapped through a colour ramp built from the palette tokens. The ramp runs ink-700 → verdigris-900 / 800 / 700 / 500 / 300 / 200 / 100 → mist, interpolated in OKLab so the teals between tokens stay clean. Nothing is black or white.
- Output is 8-bit sRGB with interleaved-gradient-noise dithering (±0.5 LSB), written through sharp from a raw buffer.
- Silhouettes and creases are anti-aliased analytically from signed distances, so they are crisp at 4K.
- Render times: 10–21 s per image, about 95 s for all six.

**The three concepts** share one shape language: broad bands that enter at the top edge (clear of the icons), bow through the free area and leave at the right edge (clear of the taskbar). On the phone they cross the full width through the middle third, recomposed rather than cropped.
- **Ribbon:** three silk ribbons modelled in 3D. Each ribbon's width turns about its path, so it pinches where it twists edge-on and shows its lighter back face beyond. A domed cross-section rolls the highlight over the crest, and the ribbons cast soft shadows on one another.
- **Fold:** one large sheet of paper, bleeding off the top and right, with one long, softly bowed edge.
  - Its creases run along x + y = constant, the mark's 45° cut: a big lit facet, then a narrow dark pleat (the mark's channel made physical), a second lit facet, and a facet turning away.
  - Each facet bends slightly. Valleys gather a soft occlusion, mountain creases catch a fine sheen, the paper's edge takes a hairline of light, and the sheet lifts off the field with a broad soft shadow.
  - The most brand-specific of the three.
- **Drape:** a backdrop silk sheet plus three translucent veils, lighter toward the front, each with a slow swell of light and a soft shadow on the layers behind. The lightest and most atmospheric of the three.
- **The field:** a smooth mid-tone, a touch deeper toward the bottom left, with a soft glow behind the forms.
- **The mark** sits in the same place in all three: bottom right, above the taskbar or dock band, on calm ground. It is 144 px on the desktop and 112 px on the phone, built from `geometry.ts` (snapped) and tone-on-tone. The T and stem lean 22 % toward ink-700; the crossbar and right stem lean 20 % toward verdigris-200. Anti-aliased, crisp at 100 %.

**Measured on the committed pixels** (`quiet-zones.json`), in every quiet zone of all six:
- brightness range ≤ 6.2 L* (a soft continuation of the field)
- largest step between neighbouring 8-px blocks ≤ 0.22 L* (no edge, crease or highlight)
- 0 banding steps
- icon-zone mean L* between 30 and 48, so white labels stay readable; also checked visually with the Windows label shadow on both taskbar themes

**Files changed (round 3)**
- `packages/ui/src/brand/wallpaper-render.ts` (new, pure): colour (OKLab ramp from tokens), light, shapes, dithered output, `render()`, `lstar()`, `zoneStats()`
- `packages/ui/src/brand/wallpapers.ts` (rewritten): formats, quiet zones, ramp, the mark (`fitMark`, `MARK_PLACE`, `MARK_TONE`), the field, the band primitive, and the three shaders
- `packages/ui/src/brand/wallpaper-source.ts` (new, Node-only): the sources whose hash each PNG carries (renderer, concepts, geometry.ts, tokens.json)
- `packages/ui/src/brand/png.ts`: the stamp is now a source hash (`techaust:source-sha256`)
- `packages/ui/scripts/build-wallpapers.ts`: renders through sharp's raw input; `--draft <scale> [concept]` writes quick untagged previews to `.logs/wallpapers/draft`
- `packages/ui/scripts/preview-wallpapers.ts`: crops on the mark and the focal area; zone report = range, step, bands
- `packages/ui/test/wallpapers.test.ts` (rewritten, 29 tests):
  - files, sizes, RGB 8-bit, sRGB, no ICC
  - the drift hash against today's sources
  - determinism (a small render, twice)
  - quiet zones per zone: step < 0.5, range < 8, no banding
  - mid-tone behind the icons
  - the mark: geometry snapped to `geometry.ts`, placement clear of every quiet zone, colour logic measured in each PNG (stem darker than the ground between the stems, right stem lighter, never swapped)
  - the round-2 palette-only and flat-fill checks are dropped, since gradients make them invalid
- `packages/ui/brand/wallpapers/wallpaper-{ribbon,fold,drape}-{desktop,mobile}.png` (the round-2 monolith/cut/construction files are deleted)

**Preview** (`.logs/wallpapers/`): `overview.png`, `sheet-ribbon.png`, `sheet-fold.png`, `sheet-drape.png`, `crop-<concept>-<format>-1.png` (the mark at 100 %), `crop-…-2.png` (the focal area at 100 %), `guides-*.png`, `quiet-zones.json`.

**Commands (round 3)**
- `bash tools/heavy.sh --log wp3-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp3-build pnpm --filter @techaust/ui build:wallpapers`: 6 PNGs, 10–21 s each
- `pnpm exec vitest run test/wallpapers.test.ts`: 29 passed
- `bash tools/heavy.sh --log wp3-ui-test pnpm --filter @techaust/ui test`: 5 files, 216 passed
- `bash tools/heavy.sh --log wp3-lint pnpm lint`: 171 files, no fixes

**Not verified / open**
- Nothing has been seen on a real Windows screen or phone. The overlays are mock-ups (translucent bars, no real Mica or acrylic blur).
- The PNGs are about 2.2 MB each (13 MB per set), because dithered gradients compress far less than flat fills. Every re-render adds about 13 MB to the public repo's history. **Question for the lead:** keep committing each round, or commit PNGs only after approval (the drift test would then wait for them)?
- The `CLAUDE.md` Commands line and the docs/06 §1 line still wait for approval.

### Round 4: sketches (2026-10-12)

**The owner's verdict on round 3:** the wallpapers read as generic, "downloaded from anywhere" with a logo placed on top. **New aim:** the subject must be TecHaust's own geometry (the mark, the 45° cut, the one-stroke channel, the 100-unit grid), lit with round 3's soft light, depth and mid-tone richness, and recognisable even without a corner mark.

**The sketches.** Seven directions are on one contact sheet, `.logs/wallpapers/sketches.png`. Each has a desktop draft at 960 × 540 and a phone thumbnail, made by the new `packages/ui/scripts/sketch-wallpapers.ts`, which reuses the round-3 renderer and the mark's real geometry. All seven respect the quiet zones and the phone's middle third.
- **A. Monolith, lit:** the whole TH as a stone or anodised volume in a gallery haze, rim light on its top-left edges, a long soft 45° shadow.
- **B. Light through the mark:** light through a TH-shaped window throws a long, soft-edged patch across the wall. The T and stem fall as mist light and the crossbar and right stem as verdigris-300 light, the brand's on-dark colour scheme expressed as light.
- **C. Cut of light:** the 45° one-stroke channel as a glowing slot between two planes, with bounce light. It stops before the taskbar on the desktop and crosses the full width on the phone.
- **D. Debossed:** a huge TH pressed into a matte surface under raking light, with the T-bar's 45° cut and the channel clearly visible. The crossbar and right stem have a slightly lighter floor.
- **E. Facade:** 45° louvres, each one stroke wide; the TH emerges where the slats turn toward the light.
- **F. Construction, lit:** the drawing sheet (grid and sub-grid, the mark filled and outlined) as a real object on a softly lit desk, with its corner cut at 45° and a soft shadow.
- **G. Glass mark** (replaces "folded mark", which read as flat shapes): the four pieces as frosted glass planes at different depths, overlapping translucently, with lit rims and soft depth shadows.

**My top 3**
1. **D, Debossed:** the most "our own". The brand is carved into the material, calm and tone-on-tone, and the 45° cut is legible at any size.
2. **B, Light through the mark:** the most ownable and poetic. The colour logic becomes light itself.
3. **A, Monolith, lit:** a direct successor to round 1's Monolith, now with real light.

F is the runner-up: clean and very on-brand, but closest to "a logo on a card".

**Commands:**
- `node scripts/sketch-wallpapers.ts`: the sheet in about 7 s
- `pnpm exec biome check` on the script: clean
- `bash tools/heavy.sh --log wp4-typecheck pnpm --filter @techaust/ui typecheck`: exit 0 after one type fix

No PNGs or tests changed this round. From now on the 4K PNGs are committed only once the owner approves the finals (the lead's decision). The round-3 PNGs and tests remain on the branch until the finals replace them.

### Round 5: finals (2026-10-12)

**The owner's decision** (docs/13, merged from `brand/wallpapers` @ e067f28): go back to the round-1 set (Monolith, Cut, Construction as built at 73715e7) with flat tones and dark ink. Show Monolith's whole TH, keep Cut's desktop channel ending square on the taskbar line, keep Construction as it was, and polish only.

**What changed from round 1**
- **Monolith:** the whole mark is now in view, large and dark-on-dark: the T and stem in ink-800, the crossbar and right stem in verdigris-900.
  - Desktop: 1680 px (78 % of the height), centred across the free area right of the icons (x = 1656), and set a touch above the centre of the space over the taskbar (y = 140, the optical centre).
  - Phone: 1500 px, centred in the middle third (y = 1590 to 3090).
- **Cut and Construction:** exactly as round 1.
- **Code:** the round-1 approach is restored from 73715e7: flat SVG composition through sharp, `png.ts` stamping the SVG's hash, `build-wallpapers.ts`, `preview-wallpapers.ts`, and the round-1 test suite.
  - The test suite's geometry sizes are updated (480, 1000, 1100, 1500, 1680).
  - Removed: `wallpaper-render.ts`, `wallpaper-source.ts`, `sketch-wallpapers.ts`, the `--draft` mode and the round-3 PNGs.
- **docs/06 §1.5:** one line naming the wallpapers and `build:wallpapers`. The `CLAUDE.md` line is left to the lead.

**Quiet zones** (`quiet-zones.json`): Monolith and Construction are pure ground in all their zones. Cut's bottom zone holds only the ink-800 plane (ΔL\* 5.1), as approved in round 1.

**Commands**
- `bash tools/heavy.sh --log wp5-build pnpm --filter @techaust/ui build:wallpapers`: 6 PNGs
- `bash tools/heavy.sh --log wp5-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp5-ui-test pnpm --filter @techaust/ui test`: 5 files, 210 passed
- `bash tools/heavy.sh --log wp5-lint pnpm lint`: 169 files, no fixes

**Not verified:** nothing has been seen on a real screen or phone; the overlays are mock-ups.

### Round 6: a brand-built node network (2026-10-12)

**The owner's decision** (docs/13, merged from `brand/wallpapers` @ 640f976): add a node network to Construction and Cut, keep Monolith clean, and make all three 10/10.

**The network** is a designed system diagram, not a texture.
- Every wire runs at 0°, 90° or 45° (orthogonal runs with 45° chamfers), 2 px on whole pixels.
- Each node is a small square with its top-left corner cut at 45°, the shape of the right stem's tip, so there are no circles.
- Wires and nodes are tone-on-tone ink: ink-700 wires and ink-600 nodes on Construction, ink-600 on Cut.
- One verdigris signal per wallpaper: a verdigris-500 wire with two verdigris-300 nodes.

Placement:
- **Construction:** the mark is wired to its own clear space. Its four outer points (the bar's corner, the stem-cut tip, the stem's foot and the right stem's foot) link to the four corners of the clear space. The links run at 45° (the stem-cut tip follows the cut itself), except the stem's foot, which drops square, turns with a chamfer and runs level. The signal leaves through the right stem's foot (the accent), away from the channel dimension. Nodes are 2 units square.
- **Cut:** two traces run parallel to the channel, 2.5 strokes before it on the ground and 1.5 strokes after it on the raised plane. Each ends in a square turn with a 45° corner and a node. One short level signal trace meets the channel's lower edge at a verdigris node. The channel stays the hero. Nodes are 18 px, about a fifth of the stroke.
- **Monolith:** no network. On the phone the mark grows from 1500 to 1560 px, exactly the height of the middle third, with equal 300 px side margins, set a touch above centre. It now holds the phone as strongly as 1680 px holds the desktop. The desktop is unchanged: 1680 px, centred across the free area at its optical centre. The tones stay ink-800 and verdigris-900 on ink-950.

**Tests:** `wallpapers.test.ts` gains a network suite, driven by the exported `wallpaperNetwork()`:
- no network on the Monolith
- between 4 and 12 nodes, 2–4 signal nodes and one signal wire
- the SVG draws exactly that network
- every point in frame and on whole pixels
- every segment at 0°, 90° or 45°
- every node and wire segment at least 60 px clear of every quiet zone

The pixel-measured quiet-zone test is unchanged and still passes on the new renders: ΔL\* ≤ 6 and no verdigris in any zone.

**Previews** (rendered locally, then the committed PNGs were restored): `.logs/wallpapers/overview.png`, `sheet-{monolith,cut,construction}.png`, and the network crops `crop-cut-{desktop,mobile}-{1,2}.png` and `crop-construction-{desktop,mobile}-{1,2}.png`.

**Commands**
- `bash tools/heavy.sh --log wp6-build pnpm --filter @techaust/ui build:wallpapers`: rendered for the preview only; the PNGs were restored with `git checkout`, not committed
- `bash tools/heavy.sh --log wp6-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp6-ui-test pnpm --filter @techaust/ui test`: 211 passed, 5 failed. All 5 are the expected drift checks for the images whose source changed (Monolith phone, both Cuts, both Constructions); they clear when the PNGs are rebuilt on approval. Against the new local renders, all 29 wallpaper tests passed.
- `bash tools/heavy.sh --log wp6-lint pnpm lint`: 169 files, no fixes

### Round 7: a real network (2026-10-12)

**The owner's request:** make the network on Cut and Construction more visible and a real network: 12–20 nodes, branching, junctions on the mark's or channel's geometry, no floating traces, and the signal as one continuous path across 3–5 nodes. Monolith is approved as rendered in round 6 and is unchanged.

**Tones:** wires ink-400, nodes ink-500, the signal (wire and nodes) verdigris-300. Hierarchy at 25 %: the mark or channel first, the network second, the grid third. Nodes are slightly larger (Construction 2 × round(1.2 units): 24 px on the desktop, 26 px on the phone; Cut 22 px).

- **Construction** (14 nodes on the desktop, 13 on the phone), routed on the 100-unit grid like a board:
  - a bus 10 units below the mark, and side buses 10 units out
  - drops into the shared stem's foot and the right stem's foot
  - feeds from the left bus into the stem's side (at 60) and the bar's end (at 10)
  - the right bus turns 45° into the stem-cut tip, and a spur leaves the tip along the cut
  - **Desktop signal:** from the clear space's lower-right corner, up the right bus, arriving in the right stem (4 nodes).
  - **Phone (recomposed for portrait):** the signal rises from below the drawing, runs along the bus and climbs into the right stem's foot (3 nodes); the left bus and the tip spur reach further up.
- **Cut** (13 nodes on each format):
  - two trunks parallel to the channel on the raised plane (1.5 and 3.5 strokes past its lower edge) and one on the ground (1.5 strokes before its upper edge)
  - junctions with level or plumb branches, four of which land on the channel's edges
  - **Signal:** from the outer trunk's lower node, up to a junction, across the inner trunk, arriving at the channel (3 nodes)
  - **Phone:** recomposed across the middle third
  - The round-6 "floating trace" is gone: every wire ends at a node or on the channel. A wire crossing without a junction, found at 100 %, was removed.
- **Tests:** the network suite now requires:
  - 12–20 nodes
  - one signal wire carrying all 3–5 signal nodes and ending on the mark or channel (an anchor)
  - every wire end at a node or an anchor
  - at least two junctions of degree ≥ 3
  - plus, as before: whole pixels, 0°/90°/45° only, ≥ 60 px clear of every quiet zone, SVG ↔ geometry match
  The pixel quiet-zone test is unchanged and passes on the new renders.

**Previews:** `.logs/wallpapers/overview.png`, `sheet-cut.png`, `sheet-construction.png`, and `crop-cut-{desktop,mobile}-{1,2}.png` (the signal's arrival at the channel; a junction) and `crop-construction-{desktop,mobile}-{1,2}.png` (the signal's arrival; the bus under the stems). They were rendered locally, then the committed PNGs were restored.

**Commands**
- `bash tools/heavy.sh --log wp7-build pnpm --filter @techaust/ui build:wallpapers`: preview only
- `pnpm exec vitest run test/wallpapers.test.ts` against the new renders: 29 passed
- `bash tools/heavy.sh --log wp7-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log wp7-ui-test pnpm --filter @techaust/ui test`: 211 passed; the 5 failures are only the drift checks, cleared when the PNGs are rebuilt on approval
- `bash tools/heavy.sh --log wp7-lint pnpm lint`: 169 files, no fixes

**Approved:** the owner approved round 7 as shown (all three wallpapers) on 2026-10-12. The six 4K PNGs were built from the round-7 code and committed.

**Final checks** (through the queue):
- `build:wallpapers`: 6 PNGs
- `pnpm --filter @techaust/ui test`: 5 files, 216 passed (drift included)
- `pnpm --filter @techaust/ui typecheck`: exit 0
- `pnpm lint`: 169 files, no fixes

**Final files**
- `packages/ui/brand/wallpapers/wallpaper-monolith-desktop.png`, `wallpaper-monolith-mobile.png`
- `packages/ui/brand/wallpapers/wallpaper-cut-desktop.png`, `wallpaper-cut-mobile.png`
- `packages/ui/brand/wallpapers/wallpaper-construction-desktop.png`, `wallpaper-construction-mobile.png`
- `packages/ui/src/brand/wallpapers.ts`: compositions, network, `fitMark`, `wallpaperPlan`, `wallpaperNetwork`, `previewFocus`
- `packages/ui/src/brand/png.ts`: sRGB tag and SVG source-hash stamp
- `packages/ui/scripts/build-wallpapers.ts` (`build:wallpapers` in `packages/ui/package.json`) and `packages/ui/scripts/preview-wallpapers.ts`
- `packages/ui/test/wallpapers.test.ts`, plus `wallpapers/` added to `scripts/build-brand.ts` and `test/brand.test.ts`
- `docs/06-design-system.md` §1.5: the wallpapers line. The `CLAUDE.md` Commands line is left to the lead.

## Review

## Integration notes

## Handover

### Fixes after review (designer, 2026-10-12)
- **Dimension vs spur (Medium):** the Construction's tip spur now stops at (105, −5) on both formats, clear of the channel dimension's lower tick (the phone loses the spur's short vertical climb; node counts unchanged: desktop 14, phone 13). The dimension is now one function (`channelDimension`, exported in frame coordinates as `wallpaperDimension`); new test: no network node (as its square) or wire comes within 2 × tick of either dimension end.
- **Colour logic (Medium):** the test now asserts each `data-part` path's `d` equals `fitMark(size).fill[part]` (Monolith) or `.outline[part]` (Construction), via the new `wallpaperMarkSize`, so a swap of shape or paint fails.
- **Wording (Low):** `docs/06-design-system.md` and the `wallpapers.ts` header now say the mark plus a brand-built node network on Cut and Construction.
- `build:wallpapers`: only the two Construction PNGs changed. `@techaust/ui` tests 218/218, typecheck clean, biome clean on the changed files. 100 % crops: `.logs/shots/brand-wallpapers/fix-dimension-{desktop,mobile}-100.png`.
