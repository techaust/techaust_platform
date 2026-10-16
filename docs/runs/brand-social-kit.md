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

_(designer)_

## Review

_(lead copies the reviewer's reply)_

## Integration notes

_(lead)_

## Handover

**2026-10-16:** brief written; the designer starts on the preview.
