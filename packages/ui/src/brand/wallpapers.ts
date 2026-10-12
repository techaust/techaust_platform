// Brand wallpapers (docs/runs/brand-wallpapers.md, round 3): soft abstract folds in mid-tone verdigris, signed
// by a small tone-on-tone TH mark. Three concepts × desktop and phone, rendered pixel by pixel with
// wallpaper-render.ts (pure and deterministic; scripts/build-wallpapers.ts writes the PNGs).
//
// One family: the same key light (top left), the same colour ramp (palette tokens, OKLab-interpolated), the same
// fold language (smooth surfaces whose creases and cuts echo the mark's 45°), and the same small mark in the same
// place (bottom right, above the taskbar or dock band). The quiet zones carry only the smooth background field.

import { color } from "./compose.ts";
import { MARK_PARAMS, markPaths } from "./geometry.ts";
import {
  clamp01,
  convexInside,
  cover,
  hexLinear,
  makeRamp,
  type RGB,
  ramp,
  render,
  type Shader,
  shade,
  smoothstep,
} from "./wallpaper-render.ts";

export const CONCEPTS = ["ribbon", "fold", "drape"] as const;
export type Concept = (typeof CONCEPTS)[number];
export const FORMAT_NAMES = ["desktop", "mobile"] as const;
export type Format = (typeof FORMAT_NAMES)[number];
export type Rect = { x: number; y: number; w: number; h: number };
type Pt = [number, number];

/** Frame sizes, the quiet zones (icons, taskbar, clock, dock) and the phone's focal band. */
export const FORMATS: Record<Format, { width: number; height: number; quiet: Rect[]; focus?: Rect }> = {
  desktop: {
    width: 3840,
    height: 2160,
    quiet: [
      { x: 0, y: 0, w: 1152, h: 2160 },
      { x: 0, y: 1987, w: 3840, h: 173 },
    ],
  },
  mobile: {
    width: 2160,
    height: 4680,
    quiet: [
      { x: 0, y: 0, w: 2160, h: 702 },
      { x: 0, y: 4118, w: 2160, h: 562 },
    ],
    focus: { x: 0, y: 1560, w: 2160, h: 1560 },
  },
};

export const wallpaperFile = (concept: Concept, format: Format) => `wallpaper-${concept}-${format}.png`;

// ── Palette ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The ramp: deepest shade (ink-700, never black) through the verdigris family to mist (never white). */
export const RAMP_STOPS: [number, string][] = [
  [0, "ink-700"],
  [0.14, "verdigris-900"],
  [0.27, "verdigris-800"],
  [0.42, "verdigris-700"],
  [0.6, "verdigris-500"],
  [0.77, "verdigris-300"],
  [0.87, "verdigris-200"],
  [0.95, "verdigris-100"],
  [1, "mist"],
];
const LUT = makeRamp(RAMP_STOPS);
const INK = hexLinear(color("ink-700"));
const PALE = hexLinear(color("verdigris-200"));

const mix = (o: RGB, c: RGB, f: number) => {
  o[0] += (c[0] - o[0]) * f;
  o[1] += (c[1] - o[1]) * f;
  o[2] += (c[2] - o[2]) * f;
};
const darken = (o: RGB, f: number) => {
  o[0] *= 1 - f;
  o[1] *= 1 - f;
  o[2] *= 1 - f;
};

// ── The mark: small, tone-on-tone, same place in all three ──────────────────────────────────────────────────

/** The mark `size` px wide with every stroke and edge on a whole pixel (geometry.ts `markPaths`, snapped). */
export function fitMark(size: number) {
  const k = size / MARK_PARAMS.size;
  const p = {
    v: MARK_PARAMS.v * k,
    h: MARK_PARAMS.h * k,
    stemX: MARK_PARAMS.stemX * k,
    crossbarY: MARK_PARAMS.crossbarY * k,
    size,
  };
  const v = Math.round(p.v);
  const h = Math.round(p.h);
  const s1 = Math.round(p.stemX);
  const s2 = s1 + v;
  const rx = size - v;
  const barEnd = Math.round(size - v * Math.SQRT2);
  const cTop = Math.round(p.crossbarY - p.h / 2);
  const cBot = cTop + h;
  const S = size;
  return {
    size,
    v,
    h,
    s1,
    s2,
    rx,
    barEnd,
    cTop,
    cBot,
    fill: markPaths(p, true),
    /** The four convex pieces in clockwise screen order: base = bar + stem, accent = crossbar + right stem. */
    pieces: {
      base: [
        [
          [0, 0],
          [barEnd, 0],
          [barEnd - h, h],
          [0, h],
        ],
        [
          [s1, 0],
          [s2, 0],
          [s2, S],
          [s1, S],
        ],
      ] as Pt[][],
      accent: [
        [
          [s2, cTop],
          [rx, cTop],
          [rx, cBot],
          [s2, cBot],
        ],
        [
          [rx, v],
          [S, 0],
          [S, S],
          [rx, S],
        ],
      ] as Pt[][],
    },
  };
}
export type FittedMark = ReturnType<typeof fitMark>;

/** Where the mark sits: bottom right, clear of the taskbar / dock band, the same in all three concepts. */
export const MARK_PLACE: Record<Format, { size: number; x: number; y: number }> = {
  desktop: { size: 144, x: 3840 - 144 - 192, y: 1987 - 144 - 144 },
  mobile: { size: 112, x: 2160 - 112 - 160, y: 4118 - 112 - 160 },
};
/** Tone-on-tone strength: the T and stem lean to ink, the crossbar and right stem to light verdigris. */
export const MARK_TONE = { base: 0.22, accent: 0.2 };

function markLayer(format: Format): (x: number, y: number, px: number, o: RGB) => void {
  const p = MARK_PLACE[format];
  const m = fitMark(p.size);
  const base = m.pieces.base.map((q) => q.map(([a, b]) => [a + p.x, b + p.y] as const));
  const accent = m.pieces.accent.map((q) => q.map(([a, b]) => [a + p.x, b + p.y] as const));
  return (x, y, px, o) => {
    if (x < p.x - 2 || y < p.y - 2 || x > p.x + p.size + 2 || y > p.y + p.size + 2) return;
    const db = Math.max(...base.map((q) => convexInside(q, x, y)));
    const da = Math.max(...accent.map((q) => convexInside(q, x, y)));
    const cb = cover(db / px);
    const ca = cover(da / px) * (1 - cb);
    if (cb > 0) mix(o, INK, MARK_TONE.base * cb);
    if (ca > 0) mix(o, PALE, MARK_TONE.accent * ca);
  };
}

// ── The background field: one smooth mid-tone, a little lighter where the light falls ───────────────────────

function background(format: Format): (x: number, y: number) => number {
  const { width: W, height: H } = FORMATS[format];
  const g = format === "desktop" ? { x: 2900, y: 500, r: 2000 } : { x: 1400, y: 2000, r: 1800 };
  return (x, y) => {
    const diag = (x / W) * 0.55 + (1 - y / H) * 0.45; // a touch darker toward the bottom left
    const glow = Math.exp(-((x - g.x) ** 2 + (y - g.y) ** 2) / (2 * g.r * g.r));
    return 0.35 + 0.09 * diag + 0.11 * glow;
  };
}

// ── Bands: the shared form ──────────────────────────────────────────────────────────────────────────────────
// Every form is a broad band sweeping diagonally down and right, defined by where its centre line enters and
// leaves the frame. On the desktop it enters at the top edge, clear of the icons, and leaves at the right edge,
// clear of the taskbar, along the diagonal of the free area; on the phone it crosses the whole width through the
// middle third. A bend bows it toward the centre (its ends stay put) and a slow wave lets it breathe.

type Band = {
  a: Pt; // where the centre line enters the frame
  b: Pt; // where it leaves
  w: number; // full width (px)
  wave: [number, number, number]; // amplitude (px), wavelength (px along the band), phase
  bend: number; // bow: px at the middle, toward the lower left (+) or upper right (−)
};

const R2 = Math.SQRT1_2;

/** Position relative to a band: along it (px from a), signed distance from its centre line, its normal. */
function bandAt(b: Band, x: number, y: number) {
  const ex = b.b[0] - b.a[0];
  const ey = b.b[1] - b.a[1];
  const len = Math.hypot(ex, ey);
  const cx = ex / len;
  const cy = ey / len;
  const nx = cy; // in-plane normal, pointing up and right
  const ny = -cx;
  const ux = x - b.a[0];
  const uy = y - b.a[1];
  const along = ux * cx + uy * cy;
  const across = ux * nx + uy * ny;
  const [amp, wl, phase] = b.wave;
  const k = (2 * Math.PI) / wl;
  const f = along / len;
  const centre = amp * Math.sin(k * along + phase) - 4 * b.bend * f * (1 - f);
  const slope = amp * k * Math.cos(k * along + phase) - (4 * b.bend * (1 - 2 * f)) / len;
  const off = (across - centre) / Math.hypot(1, slope);
  return { along, off, nx, ny };
}

const SHADOW = { dx: 46, dy: 64, soft: 150, depth: 0.34 };

// ── 1. Ribbon: broad silk ribbons, twisting as they sweep ───────────────────────────────────────────────────
// The ribbon's width turns about its path (the twist), so it narrows where it turns edge-on and shows its lighter
// back face beyond. Across its width it is slightly domed, so the key light rolls a highlight over the crest.

type Ribbon = Band & {
  twist: [number, number]; // width angle φ = twist[0] + twist[1]·along (radians, per px)
  front: number; // ramp position of the front face
  back: number; // ramp position of the back face
};

const RIBBONS: Record<Format, Ribbon[]> = {
  desktop: [
    {
      a: [1850, 0],
      b: [3840, 1120],
      w: 760,
      wave: [90, 3000, 0.3],
      bend: 430,
      twist: [0.2, 1 / 950],
      front: 0.48,
      back: 0.68,
    },
    {
      a: [2250, 0],
      b: [3840, 980],
      w: 600,
      wave: [-110, 2600, 1.4],
      bend: 540,
      twist: [-0.9, 1 / 800],
      front: 0.54,
      back: 0.76,
    },
    {
      a: [1700, 0],
      b: [3840, 1260],
      w: 480,
      wave: [80, 2200, 2.4],
      bend: 360,
      twist: [0.7, -1 / 850],
      front: 0.62,
      back: 0.82,
    },
  ],
  mobile: [
    {
      a: [0, 1400],
      b: [2160, 3250],
      w: 640,
      wave: [100, 2400, 0.3],
      bend: 260,
      twist: [0.35, 1 / 1250],
      front: 0.48,
      back: 0.68,
    },
    {
      a: [0, 1700],
      b: [2160, 3000],
      w: 520,
      wave: [-100, 2000, 1.4],
      bend: -300,
      twist: [-0.7, 1 / 900],
      front: 0.54,
      back: 0.76,
    },
    {
      a: [0, 1300],
      b: [2160, 3400],
      w: 420,
      wave: [70, 1800, 2.4],
      bend: 200,
      twist: [0.6, -1 / 1000],
      front: 0.62,
      back: 0.82,
    },
  ],
};

function ribbon(format: Format): Shader {
  const bg = background(format);
  const list = RIBBONS[format];
  const mark = markLayer(format);
  const tmp: RGB = [0, 0, 0];
  const at = (rb: Ribbon, x: number, y: number) => {
    const q = bandAt(rb, x, y);
    const phi = rb.twist[0] + rb.twist[1] * q.along;
    const half = 0.5 * rb.w * Math.abs(Math.cos(phi));
    return { ...q, phi, half, d: half - Math.abs(q.off) };
  };
  return (x, y, px, o) => {
    ramp(LUT, bg(x, y), o);
    for (const rb of list) {
      const r = at(rb, x, y);
      const a = cover(r.d / px);
      const s = at(rb, x - SHADOW.dx, y - SHADOW.dy);
      darken(o, SHADOW.depth * smoothstep(-SHADOW.soft, SHADOW.soft, s.d) * (1 - a));
      if (a <= 0) continue;
      // Normal: the width direction is cos φ·n + sin φ·z (n = the band's in-plane normal); the surface normal is
      // perpendicular to it and to the path, tilted along it by the dome (s = −1 … 1 across the visible width).
      const c = Math.cos(r.phi);
      const sn = Math.sin(r.phi);
      const facing = c >= 0 ? 1 : -1;
      const sAcross = r.half > 0 ? r.off / r.half : 0;
      const dome = 0.5 * sAcross;
      const inPlane = -sn * facing + dome * c;
      let nx = inPlane * r.nx;
      let ny = inPlane * r.ny;
      let nz = (c + dome * sn) * facing;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const z = Math.max(nz, 0.2);
      const t =
        (facing > 0 ? rb.front : rb.back) +
        shade(-nx / z, -ny / z, 0.4, 0.34, 22) -
        0.05 * smoothstep(0.6, 1, Math.abs(sAcross));
      ramp(LUT, t, tmp);
      mix(o, tmp, a);
    }
    mark(x, y, px, o);
    return o;
  };
}

// ── 2. Fold: one large sheet of paper, folded on the mark's 45° ────────────────────────────────────────────
// A big sheet bleeding off the top and the right, with one long soft edge facing the free space, folded in a Z
// on three crisp creases along x + y = constant (the mark's cut). Each of the four facets bends a little (its slope
// changes across it), valleys gather a soft occlusion, mountain creases catch a fine sheen, and the paper's edge
// takes a hairline of light. The sheet lifts off the background with a broad, soft shadow.

type Sheet = Band & {
  edge?: boolean; // the sheet is everything up-right of the band's centre line (only that edge is in frame)
  creases: number[]; // crease lines as x + y (px), upper left to lower right
  slopes: [number, number][]; // per facet: slope at its two sides (rise per px along (1, 1)/√2)
  t: number;
};

const FOLDS: Record<Format, Sheet> = {
  // The band is very wide: only its lower-left edge is in the frame; the rest of the sheet runs off it.
  desktop: {
    edge: true,
    a: [1520, 0],
    b: [3840, 1450],
    w: 0,
    wave: [40, 4200, 0.6],
    bend: 600,
    creases: [2750, 3000, 4150],
    slopes: [
      [0.24, 0.38],
      [-0.56, -0.4],
      [0.42, 0.18],
      [-0.32, -0.12],
    ],
    t: 0.54,
  },
  mobile: {
    a: [0, 1800],
    b: [2160, 3350],
    w: 1000,
    wave: [50, 3000, 0.6],
    bend: 220,
    creases: [2900, 3120, 4200],
    slopes: [
      [0.24, 0.38],
      [-0.56, -0.4],
      [0.42, 0.18],
      [-0.32, -0.12],
    ],
    t: 0.54,
  },
};

function fold(format: Format): Shader {
  const bg = background(format);
  const sh = FOLDS[format];
  const mark = markLayer(format);
  const tmp: RGB = [0, 0, 0];
  const n = sh.creases.length;
  const lo = (i: number) => (i === 0 ? (sh.creases[0] as number) - 2000 : (sh.creases[i - 1] as number));
  const hi = (i: number) => (i === n ? (sh.creases[n - 1] as number) + 2000 : (sh.creases[i] as number));
  const facetT = (i: number, k: number, along: number) => {
    const f = clamp01((k - lo(i)) / (hi(i) - lo(i)));
    const [s0, s1] = sh.slopes[i] ?? [0, 0];
    const flare = 0.8 + 0.2 * Math.sin(along / 900 + 1.3 * i); // each fold opens a little along its length
    const g = (s0 + (s1 - s0) * f) * flare * R2; // the slope lies along (1, 1)/√2
    let t = sh.t + shade(g, g, 0.55, 0.2, 16);
    for (const [ci, dist] of [
      [i - 1, (k - lo(i)) * R2],
      [i, (hi(i) - k) * R2],
    ] as const) {
      if (ci < 0 || ci >= n) continue;
      const valley = (sh.slopes[ci]?.[1] ?? 0) < (sh.slopes[ci + 1]?.[0] ?? 0);
      t += valley ? -0.09 * Math.exp(-dist / 220) : 0.06 * Math.exp(-dist / 30);
    }
    return t;
  };
  return (x, y, px, o) => {
    ramp(LUT, bg(x, y), o);
    const q = bandAt(sh, x, y);
    const d = sh.edge ? q.off : 0.5 * sh.w - Math.abs(q.off);
    const a = cover(d / px);
    const s = bandAt(sh, x - SHADOW.dx, y - SHADOW.dy);
    const sd = sh.edge ? s.off : 0.5 * sh.w - Math.abs(s.off);
    darken(o, SHADOW.depth * smoothstep(-SHADOW.soft, SHADOW.soft, sd) * (1 - a));
    if (a > 0) {
      const k = x + y;
      let i = 0;
      while (i < n && k >= (sh.creases[i] as number)) i++;
      let t = facetT(i, k, q.along);
      const dLo = ((k - lo(i)) * R2) / px;
      const dHi = ((hi(i) - k) * R2) / px;
      if (i > 0 && dLo < 0.5) t = t * cover(dLo) + facetT(i - 1, k, q.along) * (1 - cover(dLo));
      else if (i < n && dHi < 0.5) t = t * cover(dHi) + facetT(i + 1, k, q.along) * (1 - cover(dHi));
      t += 0.07 * Math.exp(-d / 6); // the paper's edge catches a hairline of light
      ramp(LUT, t, tmp);
      mix(o, tmp, a);
    }
    mark(x, y, px, o);
    return o;
  };
}

// ── 3. Drape: translucent silk veils, layered in depth ──────────────────────────────────────────────────────
// Four broad veils, back to front lighter and more translucent, each with soft waving edges and a slow swell
// that lays a band of light across it. Each lets the ones behind show through and casts a soft shadow on them:
// the lightest and most atmospheric of the three.

type Veil = Band & { t: number; alpha: number; swell: [number, number]; edge?: boolean };

const DRAPES: Record<Format, Veil[]> = {
  desktop: [
    {
      edge: true,
      a: [1650, 0],
      b: [3840, 1420],
      w: 0,
      wave: [60, 3600, 0.2],
      bend: 560,
      t: 0.46,
      alpha: 0.95,
      swell: [2600, 0.3],
    },
    {
      a: [2000, 0],
      b: [3840, 1150],
      w: 760,
      wave: [-100, 3000, 1.3],
      bend: 460,
      t: 0.6,
      alpha: 0.72,
      swell: [1700, 1.5],
    },
    {
      a: [2250, 0],
      b: [3840, 1000],
      w: 600,
      wave: [80, 2600, 2.4],
      bend: 300,
      t: 0.7,
      alpha: 0.6,
      swell: [1400, 2.6],
    },
    {
      a: [2100, 0],
      b: [3840, 1100],
      w: 340,
      wave: [-60, 2200, 0.7],
      bend: 520,
      t: 0.8,
      alpha: 0.5,
      swell: [1100, 0.9],
    },
  ],
  mobile: [
    {
      a: [0, 1750],
      b: [2160, 3250],
      w: 1000,
      wave: [90, 2800, 0.2],
      bend: 220,
      t: 0.5,
      alpha: 0.9,
      swell: [1800, 0.3],
    },
    {
      a: [0, 1950],
      b: [2160, 3150],
      w: 760,
      wave: [-80, 2400, 1.3],
      bend: -240,
      t: 0.6,
      alpha: 0.72,
      swell: [1400, 1.5],
    },
    {
      a: [0, 1750],
      b: [2160, 3350],
      w: 560,
      wave: [70, 2000, 2.4],
      bend: 180,
      t: 0.7,
      alpha: 0.6,
      swell: [1150, 2.6],
    },
    {
      a: [0, 1900],
      b: [2160, 3200],
      w: 320,
      wave: [-50, 1700, 0.7],
      bend: -200,
      t: 0.8,
      alpha: 0.5,
      swell: [900, 0.9],
    },
  ],
};

function drape(format: Format): Shader {
  const bg = background(format);
  const list = DRAPES[format];
  const mark = markLayer(format);
  const tmp: RGB = [0, 0, 0];
  return (x, y, px, o) => {
    ramp(LUT, bg(x, y), o);
    for (const v of list) {
      const q = bandAt(v, x, y);
      const d = v.edge ? q.off : 0.5 * v.w - Math.abs(q.off);
      const cov = cover(d / px);
      const sq = bandAt(v, x - SHADOW.dx, y - SHADOW.dy);
      const sd = v.edge ? sq.off : 0.5 * v.w - Math.abs(sq.off);
      darken(o, 0.8 * SHADOW.depth * smoothstep(-SHADOW.soft, SHADOW.soft, sd) * (1 - cov));
      if (cov <= 0) continue;
      // a slow swell across the veil (its gradient lies across the band)
      const [len, phase] = v.swell;
      const k = (2 * Math.PI) / len;
      const dz = 0.34 * Math.cos(k * q.off + phase + 0.0006 * q.along);
      const t = v.t + shade(dz * q.nx, dz * q.ny, 0.42, 0.3, 16) + 0.05 * Math.exp(-d / 40);
      ramp(LUT, t, tmp);
      mix(o, tmp, cov * v.alpha);
    }
    mark(x, y, px, o);
    return o;
  };
}

// ── The six files ──────────────────────────────────────────────────────────────────────────────────────────

const SHADERS: Record<Concept, (f: Format) => Shader> = { ribbon, fold, drape };

export type Wallpaper = { file: string; concept: Concept; format: Format; width: number; height: number };

export function wallpaperPlan(): Wallpaper[] {
  return CONCEPTS.flatMap((concept) =>
    FORMAT_NAMES.map((format) => ({
      file: wallpaperFile(concept, format),
      concept,
      format,
      width: FORMATS[format].width,
      height: FORMATS[format].height,
    })),
  );
}

/** Renders one wallpaper as packed 8-bit sRGB (scale < 1 for quick previews). */
export function renderWallpaper(concept: Concept, format: Format, scale = 1) {
  const { width, height } = FORMATS[format];
  const data = render(width, height, SHADERS[concept](format), scale);
  return { width: Math.round(width * scale), height: Math.round(height * scale), data };
}
