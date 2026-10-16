// The social media kit (docs/runs/brand-social-kit.md): every platform's profile picture, cover or banner, the
// Instagram highlight covers and post templates, as data plus SVG compositions (pure string functions;
// scripts/build-social.ts renders them with sharp into packages/ui/brand/social/<platform>/).
//
// The look is the existing cover language (files.ts): ink ground, the mark very large and tone-on-tone bleeding off
// an edge, the dark lockup (mist + light verdigris), the strapline and the domain as outlined Archivo.
// Crispness: everything is composed at the output size. Marks are fitted to whole pixels (wallpapers.ts fitMark);
// type sits with its cap top and baseline on whole pixels (integer cap heights at integer y). An @2x file is drawn
// again at double size, never scaled up from the 1x render.
import { type Brand, color, SCHEMES } from "./compose.ts";
import { LOCKUP } from "./geometry.ts";
import { fitMark } from "./wallpapers.ts";

/**
 * The kit's PNGs wait for the owner's approval of the preview (decision 2026-10-12: large binaries only after
 * approval). While this is false the folder brand/social/ must not exist and the file tests are skipped; flip it to
 * true in the same commit that adds the approved files.
 */
export const SOCIAL_KIT_COMMITTED = false;

/** The wordmark's width in master units (checked against the master by the test). */
export const WORDMARK_UNITS = 734.05;

export type Box = { x: number; y: number; w: number; h: number };
/** Where content may sit: a rectangle, or a circle (profile pictures, highlight covers). */
export type Zone = ({ shape: "rect" } & Box) | { shape: "circle"; cx: number; cy: number; r: number };
/** Something the platform draws over the image (an avatar, a crop edge), for the preview mock-ups. */
export type Overlay = { label: string; zone: Zone };

export type SourceKind = "official" | "platform guide" | "third-party" | "none published";

export type SocialItem = {
  platform: string;
  /** file name without extension */
  name: string;
  width: number;
  height: number;
  /** also write <name>@2x.png at double size */
  x2: boolean;
  /** extra outputs: a JPG (Facebook cover, < 100 KB), an editable SVG (post templates) */
  jpg?: { maxBytes: number };
  svg?: true;
  /** transparent background (the lockup PNGs for directory sites); everything else is opaque */
  transparent?: true;
  /** upload limit per file, in bytes */
  maxBytes: number;
  /** how the platform shows it */
  shown: "circle" | "rounded square" | "square" | "banner" | "story circle" | "post";
  /** content (mark, lockup, type, motif) must lie inside one of these zones, in 1x pixels */
  safe: Zone[];
  overlays: Overlay[];
  source: SourceKind;
  /** owner-facing notes for the README */
  note: string;
};

const MB = 1024 * 1024;
const KB = 1024;
const rect = (x: number, y: number, w: number, h: number): Zone => ({ shape: "rect", x, y, w, h });
const circle = (cx: number, cy: number, r: number): Zone => ({ shape: "circle", cx, cy, r });
/** The inscribed circle of a square, less one mark stroke of clear space at the tile's mark ratio. */
const inscribed = (size: number): Zone => circle(size / 2, size / 2, size / 2);

/** The mark's share of a profile tile (the existing profile-400/800: inside the circle with clear space). */
export const TILE_MARK_RATIO = 0.46;

function tileItem(
  platform: string,
  name: string,
  size: number,
  x2: boolean,
  maxBytes: number,
  shown: SocialItem["shown"],
  source: SourceKind,
  note: string,
): SocialItem {
  return {
    platform,
    name,
    width: size,
    height: size,
    x2,
    maxBytes,
    shown,
    safe: [inscribed(size)],
    overlays: [],
    source,
    note,
  };
}

/** The platform table (sizes checked 2026-10-16; see the run file for the sources). */
export const SOCIAL_ITEMS: SocialItem[] = [
  // LinkedIn (official: Page logo 400 × 400, min 268; cover 1512 × 256; PNG/JPEG ≤ 3 MB)
  tileItem(
    "linkedin",
    "company-logo",
    400,
    true,
    3 * MB,
    "rounded square",
    "official",
    "Page logo. LinkedIn shows it on light and dark backgrounds; the ink tile works on both.",
  ),
  {
    platform: "linkedin",
    name: "company-cover",
    width: 1512,
    height: 256,
    x2: true,
    maxBytes: 3 * MB,
    shown: "banner",
    // the Page logo overlaps the lower left; LinkedIn asks for key details away from the edges, especially the
    // lower-right corner
    safe: [rect(378, 32, 1038, 192)],
    overlays: [{ label: "Page logo (desktop)", zone: rect(24, 168, 152, 152) }],
    source: "official",
    note: "Page cover. LinkedIn may trim it to fit the screen; everything sits in the middle band.",
  },
  {
    platform: "linkedin",
    name: "founder-background",
    width: 1584,
    height: 396,
    x2: true,
    maxBytes: 8 * MB,
    shown: "banner",
    safe: [rect(560, 32, 944, 232)],
    overlays: [
      { label: "profile photo (desktop)", zone: circle(160, 396, 152) },
      { label: "profile photo (phone)", zone: circle(792, 396, 140) },
    ],
    source: "third-party",
    note: "Background image for a personal profile (the founder's). The photo itself is not part of this kit.",
  },
  // X (official: profile 400 × 400, header 1500 × 500, ≤ 2 MB; up to 60 px top and bottom may be cropped)
  tileItem("x", "profile", 400, true, 2 * MB, "circle", "official", "Profile photo, shown as a circle."),
  {
    platform: "x",
    name: "header",
    width: 1500,
    height: 500,
    x2: true,
    maxBytes: 2 * MB,
    shown: "banner",
    safe: [rect(480, 80, 960, 340)],
    overlays: [
      { label: "cropped on some screens", zone: rect(0, 0, 1500, 60) },
      { label: "cropped on some screens", zone: rect(0, 440, 1500, 60) },
      { label: "profile photo", zone: circle(200, 500, 168) },
    ],
    source: "official",
    note: "Header. X may crop 60 px off the top and bottom; everything sits in the middle 380 px.",
  },
  // Facebook (official: profile 320 × 320, a circle; cover 851 × 315, sRGB JPG < 100 KB loads fastest; desktop
  // shows it left-aligned at 16:9, phones at 2.4:1; the profile picture overlaps the left side, ~40 px on phones)
  tileItem(
    "facebook",
    "profile",
    320,
    true,
    4 * MB,
    "circle",
    "official",
    "Page profile picture: shown at 176 px on computers and 196 px on phones, cropped to a circle.",
  ),
  {
    platform: "facebook",
    name: "cover",
    width: 851,
    height: 315,
    x2: true,
    jpg: { maxBytes: 100 * KB },
    maxBytes: 4 * MB,
    shown: "banner",
    // the zone that survives a left-aligned 16:9 crop (x < 560), a centred one (x > 146) and the 2.4:1 phone crop,
    // above the profile picture's overlap
    safe: [rect(150, 30, 410, 225)],
    overlays: [
      { label: "desktop crop, 16:9 from the left", zone: rect(560, 0, 291, 315) },
      { label: "phone crop, 2.4:1 from the left", zone: rect(756, 0, 95, 315) },
      { label: "profile picture (phone, ~40 px overlap)", zone: circle(110, 355, 80) },
    ],
    source: "official",
    note: "Page cover. Upload the PNG for the sharpest type; the JPG (under 100 KB) is Facebook's fastest-loading format.",
  },
  // Instagram (third-party: profile 320 × 320 shown ~110 px; highlights 1080 × 1920 cropped to a centre circle;
  // posts 1080 × 1080 and 1080 × 1350)
  tileItem(
    "instagram",
    "profile",
    320,
    false,
    8 * MB,
    "circle",
    "third-party",
    "Profile photo, shown as a circle.",
  ),
  tileItem(
    "instagram",
    "profile-1080",
    1080,
    false,
    8 * MB,
    "circle",
    "third-party",
    "The same profile photo at 1080 × 1080, for apps that ask for a larger file.",
  ),
  ...(["services", "work", "about", "contact"] as const).map(
    (motif): SocialItem => ({
      platform: "instagram",
      name: `highlight-${motif}`,
      width: 1080,
      height: 1920,
      x2: false,
      maxBytes: 30 * MB,
      shown: "story circle",
      safe: [circle(540, 960, 360)],
      overlays: [{ label: "highlight circle", zone: circle(540, 960, 540) }],
      source: "third-party",
      note: `Story highlight cover for "${motif[0]?.toUpperCase()}${motif.slice(1)}". Instagram prints the highlight's name under the circle, so the image has no text.`,
    }),
  ),
  {
    platform: "instagram",
    name: "post-template-square",
    width: 1080,
    height: 1080,
    x2: false,
    svg: true,
    maxBytes: 30 * MB,
    shown: "post",
    // the 88 px margin, less a few pixels for the round letters' overshoot below the baseline
    safe: [rect(80, 80, 920, 920)],
    overlays: [{ label: "headline area", zone: rect(88, 200, 784, 300) }],
    source: "third-party",
    note: "Square post frame. Add a headline in the empty area (edit the SVG, or place the PNG in any editor).",
  },
  {
    platform: "instagram",
    name: "post-template-portrait",
    width: 1080,
    height: 1350,
    x2: false,
    svg: true,
    maxBytes: 30 * MB,
    shown: "post",
    safe: [rect(80, 80, 920, 1190)],
    overlays: [{ label: "headline area", zone: rect(88, 200, 784, 480) }],
    source: "third-party",
    note: "Portrait (4:5) post frame, the tallest Instagram shows in the feed.",
  },
  // Threads (owner addition 2026-10-16; third-party: profile 320 × 320, a circle; no cover or banner)
  tileItem(
    "threads",
    "profile",
    320,
    false,
    8 * MB,
    "circle",
    "third-party",
    "Profile picture, shown as a circle (the same art as Instagram's).",
  ),
  tileItem(
    "threads",
    "profile-1080",
    1080,
    false,
    8 * MB,
    "circle",
    "third-party",
    "The same profile picture at 1080 × 1080.",
  ),
  // WhatsApp Business (third-party: profile 640 × 640, ≤ 5 MB; the cover has no published spec)
  tileItem(
    "whatsapp-business",
    "profile",
    640,
    false,
    5 * MB,
    "circle",
    "third-party",
    "Business profile photo, shown very small as a circle: the mark only.",
  ),
  tileItem(
    "whatsapp-business",
    "profile-1080",
    1080,
    false,
    5 * MB,
    "circle",
    "third-party",
    "The same profile photo at 1080 × 1080.",
  ),
  {
    platform: "whatsapp-business",
    name: "cover",
    width: 1920,
    height: 1080,
    x2: false,
    maxBytes: 5 * MB,
    shown: "banner",
    // survives a centred square crop (x 420–1500) and a 3:1 band (y 220–860), above a centred photo on the lower edge
    safe: [rect(480, 280, 960, 280)],
    overlays: [
      { label: "square crop", zone: rect(420, 0, 1080, 1080) },
      { label: "3:1 band", zone: rect(0, 220, 1920, 640) },
    ],
    source: "third-party",
    note: "Cover photo. No official size is published: check on a real phone after uploading.",
  },
  // Google Business Profile (official: JPG/PNG, 10 KB–5 MB, 720 × 720 recommended, 250 × 250 minimum)
  tileItem(
    "google-business",
    "logo",
    720,
    true,
    5 * MB,
    "circle",
    "official",
    "Logo: square, often shown as a circle.",
  ),
  {
    platform: "google-business",
    name: "cover",
    width: 1920,
    height: 1080,
    x2: false,
    maxBytes: 5 * MB,
    shown: "banner",
    safe: [rect(480, 360, 960, 360)],
    overlays: [
      { label: "square crop", zone: rect(420, 0, 1080, 1080) },
      { label: "3:1 band", zone: rect(0, 220, 1920, 640) },
    ],
    source: "third-party",
    note: "Cover photo (16:9). Google may show another photo first; the lockup stays centred for any crop.",
  },
  // YouTube (official: banner 2560 × 1440 recommended, 2048 × 1152 minimum, safe area for text and logos 1235 ×
  // 338 at the minimum (= 1546 × 423 at 2560), ≤ 6 MB; profile picture renders at 98 × 98, ≤ 15 MB)
  tileItem(
    "youtube",
    "profile",
    800,
    true,
    15 * MB,
    "circle",
    "third-party",
    "Channel picture, shown as a circle as small as 98 px.",
  ),
  {
    platform: "youtube",
    name: "banner",
    width: 2560,
    height: 1440,
    x2: false,
    maxBytes: 6 * MB,
    shown: "banner",
    safe: [rect(507, 509, 1546, 423)],
    overlays: [
      { label: "desktop", zone: rect(0, 509, 2560, 423) },
      { label: "phone and every device", zone: rect(507, 509, 1546, 423) },
    ],
    source: "official",
    note: "Channel banner. Only the centre 1546 × 423 shows on every device (TV shows the whole image).",
  },
  // Upwork (Upwork's own guide: logo 250 × 250 minimum; banner 3200 × 320 recommended, 1600 wide minimum)
  tileItem("upwork", "agency-logo", 250, true, 5 * MB, "square", "platform guide", "Agency logo (square)."),
  {
    platform: "upwork",
    name: "agency-banner",
    width: 3200,
    height: 320,
    x2: false,
    maxBytes: 5 * MB,
    shown: "banner",
    safe: [rect(900, 64, 1400, 192)],
    overlays: [{ label: "narrow screen (1600 px, centred)", zone: rect(800, 0, 1600, 320) }],
    source: "platform guide",
    note: "Agency banner. Upwork scales and crops it to the screen; the lockup sits centre-right.",
  },
  // Clutch and GoodFirms publish no logo spec: a 1000 × 1000 tile plus the lockup on a transparent background.
  tileItem("clutch", "logo", 1000, false, 5 * MB, "square", "none published", "Company logo (square tile)."),
  {
    platform: "clutch",
    name: "lockup",
    ...lockupCanvas(),
    x2: false,
    transparent: true,
    maxBytes: 5 * MB,
    shown: "square",
    safe: [rect(0, 0, lockupCanvas().width, lockupCanvas().height)],
    overlays: [],
    source: "none published",
    note: "The primary lockup in full colour on a transparent background, for places that ask for a wide logo.",
  },
  tileItem(
    "goodfirms",
    "logo",
    1000,
    false,
    5 * MB,
    "square",
    "none published",
    "Company logo (square tile).",
  ),
  {
    platform: "goodfirms",
    name: "lockup",
    ...lockupCanvas(),
    x2: false,
    transparent: true,
    maxBytes: 5 * MB,
    shown: "square",
    safe: [rect(0, 0, lockupCanvas().width, lockupCanvas().height)],
    overlays: [],
    source: "none published",
    note: "The primary lockup in full colour on a transparent background.",
  },
  // GitHub (no size published; keep ≤ 1 MB; cropped to a circle in places)
  tileItem(
    "github",
    "org-avatar",
    1000,
    false,
    1 * MB,
    "circle",
    "none published",
    "Organisation profile picture; GitHub shows it as a circle in places.",
  ),
];

export const PLATFORMS = [...new Set(SOCIAL_ITEMS.map((i) => i.platform))];

// ── Composition ────────────────────────────────────────────────────────────────────────────────────────────

/** A placed thing and its ink box (for the safe-zone tests). Watermarks are tone-on-tone and may go anywhere. */
export type Part = { role: "mark" | "lockup" | "text" | "motif" | "watermark"; box: Box; svg: string };
export type Drawing = { width: number; height: number; svg: string; parts: Part[] };

const TONE = {
  ground: color("ink-900"),
  watermark: color("ink-700"),
  strapline: color("ink-300"),
  domain: color("verdigris-300"),
  base: SCHEMES.dark.base, // mist: the T and the shared stem, on dark
  accent: SCHEMES.dark.accent, // verdigris-300: the crossbar and the right stem, on dark
};
const TITLE = "TecHaust Technologies";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ink bounds of an outlined path in its own units (M/L/Q only, absolute: control points bound the curve). */
function bounds(d: string) {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A block element: measured first, then rendered with its layout box's top-left at (x, y). */
type El = { w: number; h: number; render: (x: number, y: number) => Part };

function markPart(x: number, y: number, size: number, base: string, accent: string): Part {
  const m = fitMark(size);
  return {
    role: "mark",
    box: { x, y, w: size, h: size },
    svg:
      `<g transform="translate(${x} ${y})"><path data-part="base" fill="${base}" d="${m.fill.base}"/>` +
      `<path data-part="accent" fill="${accent}" d="${m.fill.accent}"/></g>`,
  };
}

function watermark(x: number, y: number, size: number): Part {
  const m = fitMark(size);
  return {
    role: "watermark",
    box: { x, y, w: size, h: size },
    svg: `<path data-role="watermark" fill="${TONE.watermark}" transform="translate(${x} ${y})" d="${m.fill.base}${m.fill.accent}"/>`,
  };
}

export function createSocial(brand: Brand) {
  const wordX = 100 * LOCKUP.markScale + LOCKUP.gap; // the wordmark's left edge in lockup units
  const wordW = (brand.viewBox[2] ?? 0) - wordX; // the wordmark's width (the lockup's own box)

  /**
   * The primary lockup with the cap height `cap` px: the fitted mark (cap + 2 × the 14-unit overhang, so it stays
   * centred on the caps), the gap of two mark strokes, the wordmark with its cap top and baseline on whole pixels.
   */
  function lockup(cap: number, scheme: "dark" | "color" = "dark"): El {
    const s = cap / 100;
    const over = Math.round((-LOCKUP.markY / 100) * cap);
    const markPx = cap + 2 * over;
    const wx = markPx + Math.round((wordX - 100 * LOCKUP.markScale) * s);
    const w = Math.ceil(wx + wordW * s);
    const k = SCHEMES[scheme];
    return {
      w,
      h: markPx,
      render: (x, y) => ({
        role: "lockup",
        box: { x, y, w, h: markPx },
        svg:
          markPart(x, y, markPx, k.base, k.accent).svg +
          `<g fill="${k.text}" transform="translate(${x + wx} ${y + over}) scale(${s})">${brand.glyphs.map((d) => `<path d="${d}"/>`).join("")}</g>`,
      }),
    };
  }

  /** A brand line (outlined Archivo) with an integer cap height; the layout box is its ink width × the cap. */
  function line(id: string, cap: number, fill: string): El {
    const l = brand.lines[id];
    if (!l) throw new Error(`master.svg: line #${id} not found`);
    const b = bounds(l.d);
    const s = cap / 100;
    const w = (b.maxX - b.minX) * s;
    return {
      w,
      h: cap,
      render: (x, y) => {
        const tx = Math.round(x - b.minX * s);
        return {
          role: "text",
          box: { x: tx + b.minX * s, y: y + b.minY * s, w, h: (b.maxY - b.minY) * s },
          svg: `<path fill="${fill}" transform="translate(${tx} ${y}) scale(${s})" d="${l.d}"/>`,
        };
      },
    };
  }

  type Align = "left" | "right" | "centre";
  /** Elements stacked with gaps, aligned on `ax`, the stack centred vertically on `cy`. */
  function stack(els: El[], gaps: number[], align: Align, ax: number, cy: number): Part[] {
    const h = els.reduce((n, e) => n + e.h, 0) + gaps.reduce((n, g) => n + g, 0);
    const width = Math.max(...els.map((e) => e.w));
    // centre alignment centres the block; its lines stay left-aligned inside it
    const left = align === "centre" ? Math.round(ax - width / 2) : ax;
    let y = Math.round(cy - h / 2);
    return els.map((e, i) => {
      const x = align === "right" ? Math.round(ax - e.w) : left;
      const p = e.render(x, y);
      y += e.h + (gaps[i] ?? 0);
      return p;
    });
  }

  /**
   * The cover block: the lockup (cap `c`), the strapline (cap `strap`, on one line or split in two like the link
   * preview), the domain (cap `domain`). Gaps scale with the type: half the lockup cap, then a little over one
   * strapline cap before the domain (it clears the strapline's descenders).
   */
  function block(c: number, strap: number, domain: number, split = false) {
    const sl = split
      ? [line("straplineA", strap, TONE.strapline), line("straplineB", strap, TONE.strapline)]
      : [line("strapline", strap, TONE.strapline)];
    return {
      els: [lockup(c), ...sl, line("domain", domain, TONE.domain)],
      gaps: [Math.round(c / 2), ...(split ? [Math.round(strap * 0.42)] : []), Math.round(strap * 1.15)],
    };
  }

  /**
   * Wide, shallow banners: the lockup, then the strapline over the domain in one row. The strapline's cap top lines
   * up with the wordmark's, the domain's baseline with the wordmark's baseline.
   */
  function row(c: number, anchor: "right" | "centre", ax: number, cy: number): Part[] {
    const l = lockup(c);
    const cs = Math.round(c * 0.45);
    const cd = Math.round(c * 0.3);
    const sl = line("strapline", cs, TONE.strapline);
    const dm = line("domain", cd, TONE.domain);
    const gap = Math.round(c * 1.25);
    const w = l.w + gap + Math.max(sl.w, dm.w);
    const x0 = anchor === "right" ? Math.round(ax - w) : Math.round(ax - w / 2);
    const y0 = Math.round(cy - l.h / 2);
    const capTop = y0 + (l.h - c) / 2; // the wordmark's cap top (the mark overhangs it equally above and below)
    const tx = x0 + l.w + gap;
    return [l.render(x0, y0), sl.render(tx, capTop), dm.render(tx, capTop + c - cd)];
  }

  function frame(
    width: number,
    height: number,
    parts: Part[],
    background: string | null = TONE.ground,
  ): Drawing {
    const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : "";
    return {
      width,
      height,
      parts,
      svg:
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${TITLE}</title>` +
        `${bg}${parts.map((p) => p.svg).join("")}</svg>\n`,
    };
  }

  /** Profile picture: the mark on an ink tile, inside the inscribed circle with clear space. */
  function tile(size: number): Drawing {
    const px = 2 * Math.round((size * TILE_MARK_RATIO) / 2);
    const off = Math.round((size - px) / 2);
    return frame(size, size, [markPart(off, off, px, TONE.base, TONE.accent)]);
  }

  // ── Covers and banners (k = 1 or 2: every number is multiplied, then the mark is fitted at that size) ─────

  // Every watermark bleeds off the top left, never off the right edge: the mark's character (its 45° cut and the
  // right stem) is on its right side and must stay in the frame.
  const covers: Record<string, (k: number) => Drawing> = {
    // LinkedIn may trim the cover to the screen; a compact block just right of centre survives a phone-width trim
    // (x 256–1256 at 375 px) and stays clear of the logo tile.
    "linkedin/company-cover": (k) => {
      const b = block(36 * k, 18 * k, 14 * k);
      return frame(1512 * k, 256 * k, [
        watermark(-17 * k, -46 * k, 380 * k),
        ...stack(b.els, b.gaps, "centre", 940 * k, 128 * k),
      ]);
    },
    "linkedin/founder-background": (k) => {
      const b = block(48 * k, 24 * k, 18 * k);
      return frame(1584 * k, 396 * k, [
        watermark(-25 * k, -67 * k, 560 * k),
        ...stack(b.els, b.gaps, "right", 1472 * k, 148 * k),
      ]);
    },
    "x/header": (k) => {
      const b = block(52 * k, 26 * k, 20 * k);
      return frame(1500 * k, 500 * k, [
        watermark(-29 * k, -77 * k, 640 * k),
        ...stack(b.els, b.gaps, "right", 1380 * k, 250 * k),
      ]);
    },
    // Facebook: everything inside x 150–560, the part every crop keeps; the right of the frame is calm ground, so a
    // cropped cover loses nothing.
    "facebook/cover": (k) => {
      const b = block(26 * k, 15 * k, 12 * k, true);
      return frame(851 * k, 315 * k, [
        watermark(-40 * k, -34 * k, 280 * k),
        ...stack(b.els, b.gaps, "right", 520 * k, 142 * k),
      ]);
    },
    "whatsapp-business/cover": (k) => centred16x9(k, 392, 48),
    "google-business/cover": (k) => centred16x9(k, 540, 56),
    // YouTube: TV shows the whole frame, desktop the full-width band, phones only the centre 1546 × 423.
    "youtube/banner": (k) => {
      const b = block(72 * k, 36 * k, 27 * k, true);
      return frame(2560 * k, 1440 * k, [
        watermark(-52 * k, -138 * k, 1150 * k),
        ...stack(b.els, b.gaps, "right", 1953 * k, 720 * k),
      ]);
    },
    "upwork/agency-banner": (k) =>
      frame(3200 * k, 320 * k, [
        watermark(-23 * k, -62 * k, 520 * k),
        ...row(56 * k, "centre", 1660 * k, 160 * k),
      ]),
  };

  /**
   * WhatsApp and Google: the block centred across for any crop, the watermark in the top-left corner. WhatsApp sets
   * the block a size smaller and higher (centre y 392): between the 3:1 band's top and a profile photo that may sit
   * centred over the band's lower edge.
   */
  function centred16x9(k: number, cy: number, c: number): Drawing {
    const b = block(c * k, (c / 2) * k, Math.round(c * 0.38) * k, true);
    return frame(1920 * k, 1080 * k, [
      watermark(-29 * k, -77 * k, 640 * k),
      ...stack(b.els, b.gaps, "centre", 960 * k, cy * k),
    ]);
  }

  // ── Instagram highlight covers: four motifs from the mark's geometry, in a 500 px box on the story centre ──
  // Each reads at 60 px (the box is ~28 px there). Flat mist and light verdigris on ink, like the mark on dark.

  const HL = { size: 500, x: 290, y: 710 };
  const poly = (pts: [number, number][], fill: string, extra = "") =>
    `<path${extra} fill="${fill}" d="M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z"/>`;
  const motif = (svg: string, box: Box = { x: HL.x, y: HL.y, w: HL.size, h: HL.size }): Part => ({
    role: "motif",
    box,
    svg: `<g transform="translate(${box.x} ${box.y})">${svg}</g>`,
  });

  const highlights: Record<string, () => Part[]> = {
    // About: the mark itself.
    about: () => [markPart(HL.x, HL.y, HL.size, TONE.base, TONE.accent)],
    // Services: four blocks on the mark's grid; one is light verdigris with the right stem's 45° cut.
    services: () => {
      const g = 48;
      const c = (HL.size - g) / 2; // 226
      const cut = Math.round(c * 0.4);
      const sq = (x: number, y: number) =>
        `<rect x="${x}" y="${y}" width="${c}" height="${c}" fill="${TONE.base}"/>`;
      const x2 = c + g;
      return [
        motif(
          sq(0, 0) +
            sq(0, x2) +
            sq(x2, x2) +
            poly(
              [
                [x2 + cut, 0],
                [x2 + c, 0],
                [x2 + c, c],
                [x2, c],
                [x2, cut],
              ],
              TONE.accent,
            ),
        ),
      ];
    },
    // Work: one block split by the mark's diagonal channel, exactly one stroke wide.
    work: () => {
      const S = HL.size;
      const v = fitMark(S).v;
      const d = v * Math.SQRT2; // the channel's width along a horizontal
      const k1 = S - d / 2; // the channel's edges: x + y = k1 and x + y = k2
      const k2 = S + d / 2;
      return [
        motif(
          poly(
            [
              [0, 0],
              [k1, 0],
              [0, k1],
            ],
            TONE.base,
          ) +
            poly(
              [
                [S, k2 - S],
                [S, S],
                [k2 - S, S],
              ],
              TONE.accent,
            ),
        ),
      ];
    },
    // Contact: two nodes (squares with the stem's cut corner) joined at 45°, like the mark's channel; the signal
    // arrives at the verdigris node.
    contact: () => {
      const S = HL.size;
      const n = 170;
      const w = 64;
      const cut = Math.round(n * 0.4);
      const node = (x: number, y: number, fill: string) =>
        poly(
          [
            [x + cut, y],
            [x + n, y],
            [x + n, y + n],
            [x, y + n],
            [x, y + cut],
          ],
          fill,
        );
      // the link: a band w px wide along the diagonal x + y = S, from one node's centre to the other's
      const o = w / 2 / Math.SQRT2;
      const a: [number, number] = [n / 2, S - n / 2];
      const b: [number, number] = [S - n / 2, n / 2];
      const link = poly(
        [
          [a[0] - o, a[1] - o],
          [b[0] - o, b[1] - o],
          [b[0] + o, b[1] + o],
          [a[0] + o, a[1] + o],
        ],
        TONE.accent,
      );
      return [motif(link + node(0, S - n, TONE.base) + node(S - n, 0, TONE.accent))];
    },
  };

  // ── Instagram post templates: the frame is complete with nothing on it ──────────────────────────────────

  function postTemplate(height: number): Drawing {
    const m = 88;
    const head = lockup(34);
    const dm = line("domain", 20, TONE.domain);
    const area = SOCIAL_ITEMS.find((i) => i.height === height && i.shown === "post")?.overlays[0]?.zone;
    const parts = [watermark(480, height - 560, 640), head.render(m, m), dm.render(m, height - m - 20)];
    const d = frame(1080, height, parts);
    // An empty, named group marks where the headline goes, for editing the SVG.
    const hint =
      area?.shape === "rect"
        ? `<g id="headline" data-area="${area.x} ${area.y} ${area.w} ${area.h}"><!-- headline here: mist (#E4EBE7), Archivo, left-aligned at x ${area.x} --></g>`
        : "";
    return { ...d, svg: d.svg.replace("</svg>", `${hint}</svg>`) };
  }

  // ── The transparent lockup for directory sites ─────────────────────────────────────────────────────────

  function transparentLockup(): Drawing {
    const c = lockupCanvas();
    const l = lockup(c.cap, "color");
    return frame(c.width, c.height, [l.render(c.pad, c.pad)], null);
  }

  /** The drawing of one item at scale k (1, or 2 for the @2x file). */
  function draw(item: SocialItem, k = 1): Drawing {
    const key = `${item.platform}/${item.name}`;
    if (item.transparent) return transparentLockup();
    if (item.name.startsWith("highlight-")) {
      const fn = highlights[item.name.slice("highlight-".length)];
      if (!fn) throw new Error(`no highlight motif for ${key}`);
      return frame(1080, 1920, fn());
    }
    if (item.name.startsWith("post-template-")) return postTemplate(item.height);
    const cover = covers[key];
    if (cover) return cover(k);
    if (item.width === item.height) return tile(item.width * k);
    throw new Error(`no drawing for ${key}`);
  }

  return { draw, lockup, line, tile };
}

/** The transparent lockup canvas: cap 160 px, one mark stroke of clear space on every side. */
export function lockupCanvas() {
  const cap = 160;
  const over = Math.round((-LOCKUP.markY / 100) * cap);
  const markPx = cap + 2 * over;
  const pad = Math.round(markPx * 0.19);
  // the wordmark's width in master units (viewBox 910.69 less the mark and gap; the test checks it)
  const w = Math.ceil(markPx + Math.round(LOCKUP.gap * (cap / 100)) + WORDMARK_UNITS * (cap / 100));
  return { cap, pad, width: w + 2 * pad, height: markPx + 2 * pad };
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────

export type SocialFile = {
  /** path under brand/social/ */
  file: string;
  item: SocialItem;
  kind: "png" | "jpg" | "svg";
  width: number;
  height: number;
  svg: string;
  parts: Part[];
};

export function socialPlan(brand: Brand): SocialFile[] {
  const s = createSocial(brand);
  const out: SocialFile[] = [];
  for (const item of SOCIAL_ITEMS) {
    const base = `${item.platform}/${item.name}`;
    const d = s.draw(item);
    out.push({
      file: `${base}.png`,
      item,
      kind: "png",
      width: d.width,
      height: d.height,
      svg: d.svg,
      parts: d.parts,
    });
    if (item.x2) {
      const d2 = s.draw(item, 2);
      out.push({
        file: `${base}@2x.png`,
        item,
        kind: "png",
        width: d2.width,
        height: d2.height,
        svg: d2.svg,
        parts: d2.parts,
      });
    }
    if (item.jpg)
      out.push({
        file: `${base}.jpg`,
        item,
        kind: "jpg",
        width: d.width,
        height: d.height,
        svg: d.svg,
        parts: d.parts,
      });
    if (item.svg)
      out.push({
        file: `${base}.svg`,
        item,
        kind: "svg",
        width: d.width,
        height: d.height,
        svg: d.svg,
        parts: d.parts,
      });
  }
  return out;
}

// ── README (owner-facing, plain English) ───────────────────────────────────────────────────────────────────

const PLATFORM_INFO: Record<string, { title: string; where: string[] }> = {
  linkedin: {
    title: "LinkedIn",
    where: [
      "Company Page: open the Page as an admin, then Edit page. Upload `company-logo.png` as the logo and `company-cover.png` as the cover image.",
      "Founder's profile: on the profile, click the camera icon on the background and upload `founder-background.png`.",
    ],
  },
  x: {
    title: "X",
    where: [
      "Profile, then Edit profile. Upload `profile.png` as the photo and `header.png` as the header, then Apply.",
    ],
  },
  facebook: {
    title: "Facebook",
    where: [
      "On the Page, click the camera icon on the profile picture and upload `profile.png`.",
      "Click Edit cover photo, then Upload photo, and choose `cover.png` (sharpest) or `cover.jpg` (smallest).",
    ],
  },
  instagram: {
    title: "Instagram",
    where: [
      "Profile, then Edit profile, then Change profile picture: `profile.png` (or `profile-1080.png`).",
      "Highlights: press and hold a highlight, then Edit highlight, then Edit cover, and choose the matching `highlight-*.png` from your photos. Name them Services, Work, About and Contact.",
      "Posts: open `post-template-square.svg` or `post-template-portrait.svg` in a design app, add a headline in the empty area, and export a PNG at the same size.",
    ],
  },
  threads: {
    title: "Threads",
    where: [
      "Threads uses the Instagram profile picture by default. To set it separately: Threads, then Profile, then Edit profile, and upload `profile.png` (or `profile-1080.png`). Threads has no cover or banner.",
    ],
  },
  "whatsapp-business": {
    title: "WhatsApp Business",
    where: [
      "Settings, then Business tools, then Business profile. Tap the photo to upload `profile.png`; add `cover.png` as the cover photo where the app offers it.",
    ],
  },
  "google-business": {
    title: "Google Business Profile",
    where: [
      "Search Google for the business name and city, then Photos. Choose Add a logo for `logo.png` and Add a cover photo for `cover.png` (official steps). Google may still show another photo first.",
    ],
  },
  youtube: {
    title: "YouTube",
    where: [
      "YouTube Studio, then Customization, then Profile. Upload `profile.png` as the picture and `banner.png` as the banner image, then Publish (official steps).",
    ],
  },
  upwork: {
    title: "Upwork",
    where: ["Agency profile, then edit the logo (`agency-logo.png`) and the banner (`agency-banner.png`)."],
  },
  clutch: {
    title: "Clutch",
    where: [
      "Vendor dashboard, then the profile editor: upload `logo.png`. Use `lockup.png` wherever a wide logo is asked for. Clutch takes 1–2 minutes to show a new logo.",
    ],
  },
  goodfirms: {
    title: "GoodFirms",
    where: ["Company profile editor: upload `logo.png`; use `lockup.png` wherever a wide logo is asked for."],
  },
  github: {
    title: "GitHub",
    where: ["The organisation's Settings, then Profile picture: upload `org-avatar.png`."],
  },
};

const fmtBytes = (n: number) => (n >= MB ? `${n / MB} MB` : `${n / KB} KB`);
const sourceText: Record<SourceKind, string> = {
  official: "size from the platform's own help page",
  "platform guide": "size from the platform's own guide",
  "third-party": "size from several guides, not an official page: **check on a real device**",
  "none published": "the platform publishes no size: **check on a real device**",
};

export function socialReadme(plan: SocialFile[]): string {
  const lines = [
    "# TecHaust social media kit",
    "",
    "The bios and profile text for each platform: [docs/07-content-appendix/B-social-profiles.md](../../../../docs/07-content-appendix/B-social-profiles.md).",
    "",
    "Generated from the brand sources by `pnpm --filter @techaust/ui build:social`. Do not edit these files by hand;",
    "change `packages/ui/src/brand/social.ts` and rebuild. One folder per platform. Files ending in `@2x` are the same",
    "image at double size: upload the `@2x` file where the platform accepts it (it looks sharper on high-resolution",
    "screens), otherwise the plain one.",
    "",
    "Menu names change from time to time. If a step doesn't match what you see, look for Edit profile or the camera",
    "icon on the picture.",
  ];
  for (const p of PLATFORMS) {
    const info = PLATFORM_INFO[p];
    if (!info) throw new Error(`README: no text for ${p}`);
    lines.push("", `## ${info.title} (\`${p}/\`)`, "", ...info.where.map((w) => `- ${w}`), "");
    lines.push("| File | Size (px) | Notes |", "|---|---|---|");
    for (const f of plan.filter((x) => x.item.platform === p)) {
      const i = f.item;
      const note =
        f.kind === "png" && !f.file.includes("@2x")
          ? i.note
          : f.kind === "svg"
            ? "Editable version of the same frame."
            : "";
      const limit =
        f.kind === "jpg" ? `under ${fmtBytes(i.jpg?.maxBytes ?? 0)}` : `limit ${fmtBytes(i.maxBytes)}`;
      lines.push(
        `| \`${f.file.slice(p.length + 1)}\` | ${f.width} × ${f.height} | ${[note, `${limit}; ${sourceText[i.source]}`].filter(Boolean).join(" ")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
