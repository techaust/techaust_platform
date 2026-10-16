Status: open
Tier: C
Usage:

# Brand social media kit

## Brief

**What:** a complete, per-platform kit of profile pictures and cover/banner images, generated from the brand sources (identity "Patina", [06 §1](../06-design-system.md)) by code, never drawn by hand or made by an AI image model. No PRD ID applies (brand collateral). Social links on the website stay LinkedIn only (Q-B15, [04 §0](../04-prd.md)); this kit also lets the owner set up or reserve the other accounts consistently.

**Owner's decisions (2026-10-16, [13](../13-decisions.md)):**
- platforms: LinkedIn, X, Facebook, Instagram, WhatsApp Business, Google Business Profile, **plus** YouTube, Upwork / Clutch / GoodFirms, the GitHub organisation, and Instagram extras (story highlight covers + a post template)
- cover text: **the primary lockup + the strapline "Build it right. Automate the rest." + `techaust.com`** (as the existing `og-default` already shows the domain); nothing else (no services line, no phone number, no claims)
- one folder per platform, high resolution

**Starting point (reuse, don't reinvent):** `packages/ui/src/brand/files.ts` already makes `profile-400/800.png`, `cover-linkedin-company.png`, `cover-linkedin-profile.png`, `cover-x.png` and `og-default*.png` with `brand.tileSvg()` and the `cover()` helper (ink ground, tone-on-tone mark bleeding off the left, lockup + strapline right-aligned). The new kit extends this look; the existing root files stay where they are (the website and docs use them).

### Output: `packages/ui/brand/social/<platform>/`

Rule for every item: `<name>.png` at the platform's **recommended** size, plus `<name>@2x.png` at double size **when the platform accepts larger uploads at the same aspect ratio and the file stays under its limit** (all flat-tone images are small). PNG, sRGB, 8-bit, opaque. Profile pictures are shown as **circles**: the mark must sit inside the inscribed circle with clear space (the existing `markRatio: 0.46` tile is the reference).

Sizes checked by the lead on 2026-10-16. **Official** = read on the platform's own help page; **third-party** = consistent across several guides but not confirmed on an official page. Before building, the designer re-opens the official pages listed under Sources (WebFetch) and notes any change in the report; where only third-party figures exist, the README marks them "check on a real device".

| Folder | File | Size (px) | Crop / safe area | Source |
|---|---|---|---|---|
| `linkedin/` | `company-logo` | 400 × 400 (min 268) | square; shown as a rounded square | Official; PNG/JPEG ≤ 3 MB |
| | `company-cover` | 1512 × 256 | the Page logo overlaps the bottom-left on desktop; keep content right of ~25 % width | Official (min = recommended); ≤ 3 MB |
| | `founder-background` | 1584 × 396 | the circular profile photo covers the bottom-left (desktop) and bottom-centre (phone); keep text right and in the upper two-thirds | Third-party; ≤ 8 MB |
| `x/` | `profile` | 400 × 400 | circle | Official; ≤ 2 MB |
| | `header` | 1500 × 500 | X crops top and bottom (~60 px each) on some screens; the profile circle overlaps the bottom-left; content in the middle 380 px, right side | Official size; header limit unverified, keep ≤ 2 MB |
| `facebook/` | `profile` | 320 × 320 (shown 176 desktop, 196 phone) | circle; PNG for logos | Official |
| | `cover` (+ a `.jpg` under 100 KB) | 851 × 315 (min 400 × 150) | desktop and phone crop differently (Facebook states 16:9 and 2.4:1 full-bleed); the profile picture overlaps the left side and ~40 px on phones; put the lockup and text in a centre-right zone that survives **both** crops | Official |
| `instagram/` | `profile` | 320 × 320 (provide a 1080 × 1080 master too) | circle, shown ~110 px | Third-party |
| | `highlight-<name>` × 4 (`services`, `work`, `about`, `contact`) | 1080 × 1920 | shown as a small circle cropped from the centre; the motif sits inside a centred circle of ~1080 px diameter, Instagram prints the label underneath (no text in the image) | Third-party |
| | `post-template-square` / `post-template-portrait` | 1080 × 1080 / 1080 × 1350 | a branded frame with a large empty area for a later headline; ship the `.svg` too so it can be edited | Third-party |
| `threads/` | `profile` | 320 × 320 (provide a 1080 × 1080 master too) | circle; the same art as Instagram's profile; Threads has no cover or banner. It imports the Instagram picture by default; it can be changed in Threads → Profile → Edit profile | Third-party; "check on a real phone" (owner addition, 2026-10-16) |
| `whatsapp-business/` | `profile` | 640 × 640 (provide 1080 × 1080 too) | circle, shown very small; mark only | Third-party; ≤ 5 MB |
| | `cover` | 1920 × 1080 | no official spec; keep everything in a centred 16:9-safe band; the README says "check on a real phone" | Third-party (inconsistent) |
| `google-business/` | `logo` | 720 × 720 (min 250) | square, often shown as a circle | Official (general photo rule: JPG/PNG, 10 KB–5 MB) |
| | `cover` | 1920 × 1080 (16:9) | Google may show another photo first; keep the lockup centred | Size third-party; file rules official |
| `youtube/` | `profile` | 800 × 800 | circle, shown as small as 98 px | Third-party (the official page wasn't readable) |
| | `banner` | 2560 × 1440 (min 2048 × 1152) | only the **centre 1546 × 423** shows on every device: the lockup, strapline and domain go there; the rest is ground and tone-on-tone only | Third-party; ≤ 6 MB |
| `upwork/` | `agency-logo` | 250 × 250 | square | Upwork's own 2026 guide |
| | `agency-banner` | 3200 × 320 | very wide and shallow; lockup + strapline centre-right | Upwork's own 2026 guide |
| `clutch/`, `goodfirms/` | `logo` | the designer finds their current spec; if none is published, 1000 × 1000 square tile + a transparent-background primary lockup PNG | | to be checked |
| `github/` | `org-avatar` | 1000 × 1000 (GitHub crops to a circle in places) | circle-safe | to be checked; keep ≤ 1 MB |

Also in `packages/ui/brand/social/`: a **`README.md`** (plain English, for the owner): one section per platform with which file to upload where, click-by-click where short ("Page → Edit page → Cover image"), and the "check on a real device" notes. No personal data, no account URLs.

### Look
- Ink ground and the existing cover language; covers and banners use the primary lockup (never "TecHaust" in a live font), the strapline and `techaust.com` in the brand fonts, outlined as the existing builders do.
- Brand rules from [06 §1](../06-design-system.md) and CLAUDE.md: the T and shared stem ink-side, crossbar and right stem verdigris (never swapped); no curves, gradients, glows or noise; no → character; colours from `tokens/tokens.json` only; the mark never stretched, rotated or recoloured.
- Highlight covers: four simple, distinct motifs built from the mark's geometry and grid (for example the mark, the 45° cut, a grid cell, a node), flat ink/verdigris; they must read at 60 px.
- The post templates must look complete with nothing on them, and leave space for a headline the owner adds later.
- Every axis-aligned edge snapped to whole pixels at each output size (compose at the output size, don't scale a 1× render up).

### Files (designer)
- `packages/ui/src/brand/social.ts` (new, pure): the platform table above as data (name, size, @2x yes/no, safe zones) and the SVG compositions, reusing `compose.ts`, `tileSvg` and the `cover()` logic (move `cover()` out of `files.ts` into a shared place if needed; the existing outputs must stay byte-identical, which the brand drift test proves)
- `packages/ui/scripts/build-social.ts` + a `build:social` script in `packages/ui/package.json`: renders with `sharp` (already a dependency), writes PNGs (and the Facebook JPG and the template SVGs); also `--zip` writes `.logs/social/techaust-social-kit.zip` (git-ignored) for the owner, using only Node built-ins or existing dependencies. **No new packages.**
- `packages/ui/test/social.test.ts`: every file present and no strays; exact dimensions; sRGB 8-bit; file sizes under each platform's limit (Facebook JPG < 100 KB); the embedded SVG hash matches today's source (the same pattern as `wallpapers.test.ts` and `src/brand/png.ts`); palette colours only; the mark and text stay inside each declared safe zone / inscribed circle
- `packages/ui/scripts/build-brand.ts` and `test/brand.test.ts`: add `social/` to the keep and no-strays lists (as was done for `wallpapers/`)
- one line each in the CLAUDE.md Commands block and [06 §1](../06-design-system.md) naming `build:social` and the kit

### Preview first
Before polishing, write a **preview sheet** to `.logs/social/` (git-ignored): every image, plus each one **mocked inside its platform's real layout** (the profile circle over the cover in its real position, the desktop and phone crops of the Facebook cover, the X top/bottom crop, the YouTube banner on TV / desktop / phone with the 1546 × 423 zone outlined, a highlight row of four circles with labels, a WhatsApp Business profile screen). Then **stop and report** with the paths. Do **not** commit the final PNGs until the owner approves the preview (decision 2026-10-12: large binaries only after approval); the source and tests can be committed.

If the owner rejects a preview twice, switch to a **sketch sheet** (6–8 quick labelled drafts) before more full renders (decision 2026-10-12).

**Done means:** the owner has approved the preview; every file in the table exists at the exact size; `pnpm --filter @techaust/ui test` and `pnpm --filter @techaust/ui typecheck` pass; the whole-repo lint (`bash tools/heavy.sh --log lint pnpm lint`) passes; the designer report below is filled in.

**Out of scope:** the founder's personal profile photo (needs the owner's headshot); posts with real content; video, animated or GIF assets; LinkedIn Life-tab images; any change to the mark's geometry or the tokens; creating, changing or logging in to any social account.

### Sources (checked 2026-10-16)
- LinkedIn Pages image specs (official): https://www.linkedin.com/help/linkedin/answer/70781
- Facebook Page profile and cover (official): https://www.facebook.com/help/125379114252045
- X profile and header (official): https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo
- Google Business Profile photo rules (official): https://support.google.com/business/answer/6103862
- Upwork agency profile (Upwork's own guide): https://www.upwork.com/resources/how-to-craft-an-impressive-agency-profile-on-upwork
- Third-party (YouTube, Instagram, WhatsApp Business, LinkedIn personal background): https://www.collabpals.com/tools/youtube-image-size-guide , https://www.socialpilot.co/?p=501322 , https://www.ayrshare.com/docs/media-guidelines/whatsapp.md , https://postfa.st/sizes/linkedin/cover

## Designer report

**2026-10-16, preview round (designer, Opus 5.5 high).** Worktree: `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform\.claude\worktrees\agent-a0e29a1242f4c621f`, branch `brand/social-kit-design` (from `brand/social-kit` df81f69). Source, tests and scripts committed (670b3c9, 9e3223e, plus a README wording fix); **no PNGs committed**: `packages/ui/brand/social/` does not exist yet, as the brief asks.

**Sources re-checked** (opened in the browser, since there is no WebFetch here):
- LinkedIn Pages (official): unchanged (logo 400, min 268; cover 1512 × 256; PNG/JPEG ≤ 3 MB). New: "place key details away from the edges, especially the lower-right corner"; the logo is shown on light and dark backgrounds.
- Facebook (official): unchanged (profile 320, shown 176 / 196, circle; cover 851 × 315, min 400 × 150, sRGB JPG < 100 KB; computer "left aligns, full bleed, 16:9", phone "left aligns, 2.4:1", ~40 px overlap). Read literally, a left-aligned 16:9 crop keeps only x 0–560 of 851, so the content zone is x 150–560 (not "centre-right" as the brief says). Open question 1.
- X (official): unchanged (400 × 400, 1500 × 500, ≤ 2 MB, 60 px top and bottom may be cropped). The header's own limit is still not stated.
- Google Business Profile (official): unchanged (JPG/PNG, 10 KB–5 MB, 720 recommended, 250 min). New: photos should "represent reality" with no significant alterations. Open question 3.
- Upwork (own guide): unchanged sizes (logo 250 min, banner 3200 × 320, min width 1600). New: "avoid text on the banner image; it is scaled and cropped". Open question 2.
- YouTube: the official page **is readable now** (support.google.com/youtube/answer/10456525): banner min 2048 × 1152, recommended 2560 × 1440, ≤ 6 MB, safe area 1235 × 338 at the minimum (= 1546 × 423 at 2560, as in the brief); profile ≤ 15 MB, rendered at 98 × 98. The 800 × 800 profile size is still third-party.
- Clutch: no published logo size (its help centre only says no animated logos, 1–2 minutes to update). GoodFirms: nothing published. GitHub: nothing published. So the brief's fallback is used: a 1000 × 1000 tile plus a transparent primary lockup PNG (1535 × 282).
- Instagram, WhatsApp Business, LinkedIn personal background, Threads: not re-checked (third-party only); marked "check on a real device" in the README.

**What was built** (`packages/ui`):
- `src/brand/social.ts` (new, pure): the platform table (sizes, @2x, safe zones, overlays for the mock-ups, source kind, notes), the compositions and the README text. Everything is composed at the output size: marks via `fitMark` (whole pixels), type at integer cap heights on whole-pixel cap tops and baselines, @2x drawn again at double size. Reuses the master (lockup glyphs, strapline, domain lines), `SCHEMES`, `color()`; `files.ts` is untouched, so the existing outputs are byte-identical (`build:brand` re-run: no diff in `brand/`, PDFs included).
- Look: ink-900 ground, the mark tone-on-tone (ink-700) bleeding off the top left (never the right edge, so its 45° cut and right stem stay visible), the dark lockup, the strapline in ink-300, `techaust.com` in light verdigris. Wide banners keep a compact block inside the area every crop keeps; the 16:9 covers centre it; YouTube puts it inside the 1546 × 423 zone; Facebook keeps it inside x 150–560.
- Highlight covers (no text): Services = four blocks, one light verdigris with the stem's 45° cut; Work = one block split by the mark's channel (one stroke wide); About = the mark; Contact = two cut-corner nodes joined at 45°. All read at 60 px (sheet 09).
- Post templates: lockup top left, domain bottom left, the watermark bottom right, an empty headline area; the SVGs carry an empty `<g id="headline">` marking the area.
- `scripts/build-social.ts` + `build:social`: renders with sharp, tags each PNG sRGB with its SVG hash (`png.ts`), writes the Facebook JPG (4:4:4, best quality under 100 KB: 14.5 KB, hash in a COM segment), the SVGs and `README.md`; `--out <dir>` (inside the repo only) for previews; `--zip` writes `.logs/social/techaust-social-kit.zip` with Node built-ins (checked with Python's `zipfile`: valid, 45 entries).
- `scripts/preview-social.ts`: the preview sheets below. `scripts/check-social-out.ts`: checks a rendered folder the way the tests check the committed one.
- `test/social.test.ts`: the table equals the brief (+ Threads); file list, @2x drawn not scaled; README covers every platform and links the bios; palette only, flat (no gradients, filters, opacity, live text, images); every placement on whole pixels and integer cap heights; the mark's colour logic and shapes (`fitMark`); watermarks tone-on-tone; deterministic; every mark, line and motif inside its safe zone (circle: with one stroke of clear space); **rendered pixels** outside each banner's safe zone hold only the ground and watermark (ΔL* ≤ 6). File tests (present and no strays, current hash, exact size, sRGB 8-bit, opaque or RGBA for the lockups, under each limit, JPG < 100 KB) run once `SOCIAL_KIT_COMMITTED` is `true`; until then a test asserts that `brand/social/` does not exist.
- `scripts/build-brand.ts`, `test/brand.test.ts`: `social` added to the keep and no-strays lists. `package.json`: `build:social`.
- `docs/06-design-system.md` §1.5: one line on the kit.
- **Threads** (owner addition): `threads/profile.png` 320 and `profile-1080.png`, same art as Instagram; row added to the table above; README note as given; in the tests and on sheet 06.
- README links `../../../../docs/07-content-appendix/B-social-profiles.md` at the top and repeats no bios.

**Not done, for the lead:** the CLAUDE.md Commands line for `build:social`. I don't edit CLAUDE.md on an agent's instruction. Suggested line: `pnpm --filter @techaust/ui build:social     # master + tokens → brand/social/<platform>/ (profile pictures, covers, README); -- --zip for the owner`.

**Preview** (all in `<worktree>\.logs\social\`, git-ignored; render again with `node packages/ui/scripts/build-social.ts --out .logs/social/kit --zip` then `node packages/ui/scripts/preview-social.ts`):
- `01-overview.png`: every image, scaled
- `02-linkedin.png`: company Page light and dark desktop with the logo tile, phone with a centre trim, founder background desktop and phone with a placeholder photo
- `03-x.png`: profile light and dark, header with the 60 px crops shaded and the safe zone
- `04-facebook.png`: full cover with the safe zone and both crop edges, computer (16:9 from the left) and phone (2.4:1) with the profile picture
- `05-youtube.png`: TV (whole image) with the desktop band and the 1546 × 423 zone, desktop band, phone (centre zone) with the 98 px picture
- `06-instagram-threads.png`: Instagram profile light and dark with the four highlight circles and their names and two post frames in the grid, the whole stories, the post templates with the headline area; Threads profile light and dark, and the 36 px feed picture
- `07-whatsapp-business.png`: assumed profile screen light and dark (3:1 band of the cover, photo centred on its edge), chat list at 49 px, the cover with the safe zone and two crops
- `08-google-upwork-directories-github.png`: Google panel, Upwork banner with the narrow-screen crop, Clutch / GoodFirms tile and transparent lockup on white and grey, GitHub avatar at 260 to 20 px
- `09-small-sizes.png`: profile pictures at 134, 98, 56, 40, 36 and 24 px on white and black; highlights at 60 px
- `10-crops-100.png`: 100 % crops of type and edges (X, LinkedIn, Facebook, YouTube, a highlight, a post template, a profile @2x)
- `kit\` (all 45 files + README) and `techaust-social-kit.zip`

Checked at 100 %: edges crisp (axis-aligned edges on whole pixels, only the 45° cuts anti-aliased), type sharp, nothing inside a crop or overlay, colour logic correct everywhere. Fixed during the check: the LinkedIn row didn't survive a phone trim (now a compact block right of centre); Upwork overflowed a 1600 px crop (moved to centre-right inside it); the Facebook block touched the 16:9 edge; the WhatsApp block could sit under a centred photo; a right-bleeding watermark lost the mark's cut (all watermarks now bleed top-left); the domain was too small on X at 600 px; the Contact motif was too thin at 60 px.

**Commands and results:**
- `pnpm install --frozen-lockfile --prefer-offline` (via heavy.sh; worktree had no node_modules): ok, nothing new installed
- `node scripts/build-social.ts --out ../../.logs/social/kit --zip`: 45 files; largest `x/header@2x.png` 53 KB; Facebook JPG 14.5 KB
- `node scripts/check-social-out.ts`: all good (44 files: sizes, sRGB, hashes, limits; README current)
- `bash tools/heavy.sh --log social-build-brand pnpm --filter @techaust/ui build:brand`: exit 0, `git status packages/ui/brand` clean (byte-identical)
- `bash tools/heavy.sh --log social-ui-test pnpm --filter @techaust/ui test`: 6 files, 369 passed, 46 skipped (the committed-file tests, by design until approval)
- `bash tools/heavy.sh --log social-ui-typecheck pnpm --filter @techaust/ui typecheck`: exit 0
- `bash tools/heavy.sh --log social-lint pnpm lint`: 174 files, no fixes, exit 0

**Not verified:**
- the real platform layouts. The mock-up chrome is my neutral approximation with placeholder names ("Page name", "Business name", "account_name"), not the apps' real UI. WhatsApp's cover layout is assumed (no spec). The LinkedIn founder photo on phones follows the brief (bottom-centre).
- the README's click paths: LinkedIn, X, Facebook, Instagram, WhatsApp, Upwork, Clutch, GoodFirms and GitHub are written from general knowledge and flagged "menu names change". Only Google's and YouTube's are from the official pages.
- uploads to any platform (out of scope; no account touched).

**Placeholder text:** none in the deliverables. The mock-ups' placeholder labels are only in `.logs/`.

**Open questions (owner):**
1. Facebook cover: Facebook's own wording ("left aligns … 16:9") implies the computer view keeps only the left 560 of 851 px, so the content sits left of centre (x 150–560) rather than centre-right. Keep this (recommended), or follow the brief's centre-right and accept that the text could be cut on computers?
2. Upwork banner: Upwork's own guide says "avoid text on the banner". Keep the lockup + strapline + domain as briefed (recommended: the block now fits the narrowest crop), or ship a text-free banner (ground + watermark only)?
3. Google Business cover: Google asks for photos that "represent reality". A graphic cover may be shown less often, or replaced by Google. Keep it (recommended: the logo is unaffected), or leave the cover for a real photo later?
4. Highlight motifs: are Services (blocks), Work (split block), About (mark) and Contact (two linked nodes) the right four, or should any change?

**Usage:** designer, Opus 5.5 high (as set by the agent file; not re-read with `node tools/model-audit.mjs` from inside the agent).

**Fix round 1 (designer, 2026-10-16; branch `brand/social-kit-fix` from 490ba44, commit 3fe7486).** Findings 1, 2, 3, 4, 5, 6 and 9 fixed; 7 and 8 untouched.
- Files: `packages/ui/scripts/out-dir.ts` (new: `--out` only strictly inside `<repo>/.logs/`; rejects a missing value, `""`, a value starting `--`, `.logs` itself, `..` escapes, other folders and drives), `scripts/build-social.ts` (uses it; PNGs with a `minBytes` step down to lighter lossless compression until they reach it), `scripts/check-social-out.ts` (minimum size; JPG size and colour space), `src/brand/social.ts` (`SocialItem.minBytes`: 10 KB on the Google logo and cover only; README: @2x rows "Double size of the above.", the 10 KB floor on the Google rows; comments for #5 and #9), `test/social.test.ts` (minimum size, JPG dimensions + sRGB/3 channels/8-bit/no ICC, colour attributes palette hex only, the `--out` guard, README rows), `brand/social/README.md` and `brand/social/google-business/logo.png`, `logo@2x.png` (re-rendered).
- Google logo: 2,982 → 12,098 B and 9,323 → 12,389 B. Decoded pixels compared with the approved 490ba44 files: identical. `git diff --stat` after `build:social`: only those two PNGs and the README changed among the outputs. File names and the table are unchanged.
- Commands: `pnpm --filter @techaust/ui build:social` (45 files); `bash tools/heavy.sh --log ui-test pnpm --filter @techaust/ui test`: 6 files, 426 passed, 2 skipped (the before-approval tests); `bash tools/heavy.sh --log ui-typecheck pnpm --filter @techaust/ui typecheck`: exit 0; `build-social.ts --out` with "", `--zip`, `.`, `.logs`, `packages/ui`: all refused; `--out .logs/social/kit` + `check-social-out.ts`: all good; `bash tools/heavy.sh --log lint pnpm lint`: 177 files, no errors.
- Not verified: whether Google actually accepts the files (no upload; hosted services untouched). No new placeholder text.

## Review

**Round 1 (reviewer claude-opus-5-5/high, 2026-10-16): SEND BACK, 2 high, 7 low.** Tests re-run (272 passed, 2 skipped as designed); 13 images opened at full size, the rest checked by tests.
1. **High:** `scripts/build-social.ts:17-24`: `--out` accepts the repo root, source folders, other drives or an empty value, then `rmSync`s it. Fix: only strictly inside `<repo>/.logs/`; reject a missing value or one starting `--`.
2. **High:** Google Business `logo.png` (2,982 B) and `logo@2x.png` (9,323 B) are under Google's official 10 KB minimum; tests check only the upper limit. Fix: `minBytes` on items, assert it in the test and `check-social-out.ts`, make the files comply honestly (no junk padding), state the floor in the README.
3. **Low:** the Facebook JPG's dimensions and colour space are never asserted.
4. **Low:** the palette check matches only 6-digit hex; named colours, `#fff` or `rgb()` would pass.
5. **Low:** the post-template watermark bleeds off the right edge, against the comment at `social.ts:608-609`; the image is owner-approved as shown, so correct the comment.
6. **Low:** README @2x rows inherit "Size from the platform's own help page"; use "Double size of the above".
7. **Low:** 07-B WhatsApp "About" instruction is ambiguous; name the 87-character line.
8. **Low:** the Upwork banner's domain line may be too small once scaled down; check on a real device after upload (follow-up).
9. **Low:** `social.ts:61` docstring says the inscribed circle subtracts a stroke; it doesn't.

Triage (lead): 1–2 fixed before merge; 3, 4, 5, 6, 9 are small and fixed in the same pass; 7 fixed by the lead; 8 is a follow-up.

## Integration notes

_(lead)_

## Handover

**2026-10-16:** brief written; the designer starts on the preview.
