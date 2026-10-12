// A tiny deterministic software renderer for the brand wallpapers (pure: no I/O, no randomness).
// Surfaces are shaded with one soft key light from the top left (Lambert + a gentle sheen) in linear light,
// mapped through a colour ramp built from the palette tokens (interpolated in OKLab, so the teals between the
// tokens stay clean), and written as 8-bit sRGB with interleaved-gradient-noise dithering (±0.5 LSB), so smooth
// gradients never band. Edges are anti-aliased analytically from signed distances, so silhouettes stay crisp.
import { color } from "./compose.ts";

export type RGB = [number, number, number];

// ── Colour ──────────────────────────────────────────────────────────────────────────────────────────────────

export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexLinear(hex: string): RGB {
  return [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as RGB;
}

function linearToOklab([r, g, b]: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** A colour ramp from palette tokens: `stops` are [position 0–1, token]. Returns a linear-RGB lookup table. */
export function makeRamp(stops: [number, string][], size = 4096): Float32Array {
  const labs = stops.map(([t, k]) => [t, linearToOklab(hexLinear(color(k)))] as const);
  const lut = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let j = 0;
    while (j < labs.length - 2 && t > (labs[j + 1]?.[0] ?? 1)) j++;
    const [t0, c0] = labs[j] as (typeof labs)[number];
    const [t1, c1] = labs[j + 1] as (typeof labs)[number];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const lin = oklabToLinear([
      c0[0] + (c1[0] - c0[0]) * f,
      c0[1] + (c1[1] - c0[1]) * f,
      c0[2] + (c1[2] - c0[2]) * f,
    ]);
    lut.set(
      lin.map((v) => Math.max(0, v)),
      i * 3,
    );
  }
  return lut;
}

/** Samples a ramp at t (clamped) into `out` (linear RGB). */
export function ramp(lut: Float32Array, t: number, out: RGB): RGB {
  const n = lut.length / 3 - 1;
  const x = Math.min(n, Math.max(0, t * n));
  const i = Math.floor(x);
  const f = x - i;
  const j = Math.min(n, i + 1);
  out[0] = (lut[i * 3] ?? 0) * (1 - f) + (lut[j * 3] ?? 0) * f;
  out[1] = (lut[i * 3 + 1] ?? 0) * (1 - f) + (lut[j * 3 + 1] ?? 0) * f;
  out[2] = (lut[i * 3 + 2] ?? 0) * (1 - f) + (lut[j * 3 + 2] ?? 0) * f;
  return out;
}

// ── Light ───────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (x: number, y: number, z: number): RGB => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
/** The key light: from the top left, above the screen (x right, y down, z toward the viewer). */
export const LIGHT = norm(-0.55, -0.7, 0.75);
const HALF = norm(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const FLAT_LAMBERT = LIGHT[2];

/**
 * Brightness change of a surface with height gradient (gx, gy) relative to a flat one: Lambert plus a soft sheen.
 * Returns a shift in ramp position (positive = lighter).
 */
export function shade(gx: number, gy: number, diffuse: number, sheen: number, sharp = 24): number {
  const l = Math.hypot(gx, gy, 1);
  const nx = -gx / l;
  const ny = -gy / l;
  const nz = 1 / l;
  const lam = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  const nh = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
  const nh0 = HALF[2];
  return diffuse * (lam - FLAT_LAMBERT) + sheen * (nh ** sharp - nh0 ** sharp);
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────────────────

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Box-filter coverage of a pixel by a straight edge at signed distance d (px, positive = inside). */
export const cover = (d: number) => clamp01(d + 0.5);

/** Signed distance (px, positive inside) to a convex polygon given as points in clockwise screen order. */
export function convexInside(pts: readonly (readonly [number, number])[], x: number, y: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as readonly [number, number];
    const b = pts[(i + 1) % pts.length] as readonly [number, number];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    // inward normal for clockwise (screen) winding
    const dist = ((x - a[0]) * -ey + (y - a[1]) * ex) / len;
    if (dist < d) d = dist;
  }
  return d;
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Interleaved gradient noise (Jimenez 2014): a deterministic, blue-ish dither in [0, 1). */
export const ign = (x: number, y: number) => {
  const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
  return v - Math.floor(v);
};

/** Linear RGB → dithered 8-bit sRGB, written into `out` at byte offset `o`. */
export function writePixel(out: Uint8Array, o: number, rgb: RGB, x: number, y: number) {
  const n = ign(x, y) - 0.5;
  for (let c = 0; c < 3; c++) {
    const v = Math.round(toSrgb(clamp01(rgb[c] as number)) * 255 + n);
    out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

// ── Measuring ───────────────────────────────────────────────────────────────────────────────────────────────

/** CIE L* of an 8-bit sRGB pixel. */
export function lstar(r: number, g: number, b: number): number {
  const y = 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/**
 * How quiet a region of a packed RGB image is:
 * - `range`: L* between its darkest and lightest 8 × 8 block (block means, so dithering doesn't count)
 * - `step`: the largest L* step between neighbouring blocks: an edge, crease or highlight shows up here
 * - `bands`: clean one-level steps along rows (16 px of one green value, then 16 px of the next, with no dithered
 *   transition between them): visible banding shows up here, a smooth dithered gradient has none
 */
export function zoneStats(
  data: Uint8Array,
  width: number,
  zone: { x: number; y: number; w: number; h: number },
  block = 8,
) {
  const bw = Math.floor(zone.w / block);
  const bh = Math.floor(zone.h / block);
  const grid = new Float64Array(bw * bh);
  for (let j = 0; j < bh; j++)
    for (let i = 0; i < bw; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < block; y++)
        for (let x = 0; x < block; x++) {
          const o = ((zone.y + j * block + y) * width + zone.x + i * block + x) * 3;
          r += data[o] ?? 0;
          g += data[o + 1] ?? 0;
          b += data[o + 2] ?? 0;
        }
      const n = block * block;
      grid[j * bw + i] = lstar(r / n, g / n, b / n);
    }
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let step = 0;
  for (let j = 0; j < bh; j++)
    for (let i = 0; i < bw; i++) {
      const v = grid[j * bw + i] as number;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (i > 0) step = Math.max(step, Math.abs(v - (grid[j * bw + i - 1] as number)));
      if (j > 0) step = Math.max(step, Math.abs(v - (grid[(j - 1) * bw + i] as number)));
    }
  let bands = 0;
  const K = 16;
  for (let y = zone.y; y < zone.y + zone.h; y += 4) {
    let len = 0; // length of the current run
    let prevRun = 0; // length of the run before it
    let prevVal = -1;
    let val = -1;
    for (let x = zone.x; x < zone.x + zone.w; x++) {
      const g = data[(y * width + x) * 3 + 1] as number;
      if (g === val) len++;
      else {
        if (len >= K && prevRun >= K && Math.abs(val - prevVal) === 1) bands++;
        prevRun = len;
        prevVal = val;
        val = g;
        len = 1;
      }
    }
    if (len >= K && prevRun >= K && Math.abs(val - prevVal) === 1) bands++;
  }
  return { range: hi - lo, step, bands };
}

/** A shader gets full-size pixel coordinates and the size of one output pixel in full-size pixels (for AA). */
export type Shader = (x: number, y: number, px: number, out: RGB) => RGB;

/**
 * Renders `width × height` pixels of a shader defined in full-size pixel coordinates, at `scale` (1 = full
 * size; 0.25 for fast previews). Returns tightly packed 8-bit sRGB.
 */
export function render(width: number, height: number, shader: Shader, scale = 1): Uint8Array {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const out = new Uint8Array(w * h * 3);
  const px: RGB = [0, 0, 0];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      shader((i + 0.5) / scale, (j + 0.5) / scale, 1 / scale, px);
      writePixel(out, (j * w + i) * 3, px, i, j);
    }
  return out;
}
