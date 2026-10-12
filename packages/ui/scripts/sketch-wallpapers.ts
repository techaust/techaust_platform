// Wallpaper sketches (round 4): quick, low-resolution explorations of directions where the subject IS the
// TecHaust geometry (the mark, the 45° cut, the one-stroke channel, the 100-unit grid) in soft light.
// Output: <repo>/.logs/wallpapers/sketches.png (git-ignored). Not part of the brand build; nothing is committed
// from here but this script.   Run: node packages/ui/scripts/sketch-wallpapers.ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  clamp01,
  convexInside,
  cover,
  makeRamp,
  type RGB,
  ramp,
  render,
  type Shader,
  shade,
  smoothstep,
} from "../src/brand/wallpaper-render.ts";
import { fitMark, RAMP_STOPS } from "../src/brand/wallpapers.ts";

type Fmt = "desktop" | "mobile";
const DIM: Record<Fmt, [number, number]> = { desktop: [3840, 2160], mobile: [2160, 4680] };
const LUT = makeRamp(RAMP_STOPS);
const R2 = Math.SQRT1_2;

/** The mark as signed distances (px, positive inside), placed at (ox, oy), `size` px wide. */
function markSD(size: number, ox: number, oy: number) {
  const m = fitMark(size);
  const [bar, stem] = m.pieces.base as [[number, number][], [number, number][]];
  const [cross, right] = m.pieces.accent as [[number, number][], [number, number][]];
  return {
    m,
    at(x: number, y: number) {
      const lx = x - ox;
      const ly = y - oy;
      const b = Math.max(convexInside(bar, lx, ly), convexInside(stem, lx, ly));
      const a = Math.max(convexInside(cross, lx, ly), convexInside(right, lx, ly));
      return { b, a, u: Math.max(a, b), lx, ly };
    },
  };
}

/** A soft pool of light (0–1). */
const pool = (x: number, y: number, cx: number, cy: number, r: number) =>
  Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r));

const tone = (t: number, o: RGB) => ramp(LUT, t, o);

// ── A. Monolith, lit: the whole TH as a sculpted volume, a long soft 45° shadow, gallery haze ───────────────
function monolith(f: Fmt): Shader {
  const [W, H] = DIM[f];
  const p = f === "desktop" ? { s: 1350, x: 2250, y: 330 } : { s: 1300, x: 430, y: 1690 };
  const mk = markSD(p.s, p.x, p.y);
  const L = 0.5 * p.s;
  return (x, y, px, o) => {
    let t = 0.34 + 0.07 * (1 - y / H) + 0.1 * pool(x, y, p.x - 150, p.y - 150, 0.9 * p.s) + 0.03 * (x / W);
    let sh = 0;
    for (let k = 1; k <= 40; k++) {
      const kk = (k * L) / 40;
      const soft = 10 + kk * 0.7;
      sh = Math.max(sh, smoothstep(-soft, soft, mk.at(x - kk, y - kk).u) * (1 - (0.75 * kk) / L));
    }
    t -= 0.13 * sh;
    const d = mk.at(x, y);
    const a = cover(d.u / px);
    if (a > 0) {
      const face = d.a > d.b ? 0.5 : 0.3; // the crossbar and right stem verdigris, the T and stem ink
      const grad = 0.09 * (1 - d.ly / p.s) + 0.03 * (1 - d.lx / p.s);
      const rim = 1 - smoothstep(-9, 9, mk.at(x - 10, y - 10).u); // light catching the top-left edges
      const ft = face + grad + 0.13 * rim;
      t = t * (1 - a) + ft * a;
    }
    return tone(t, o);
  };
}

// ── B. Light through the mark: a TH-shaped window throws a long, soft, skewed patch of light (a gobo) ──────
function gobo(f: Fmt): Shader {
  const [, H] = DIM[f];
  const g =
    f === "desktop"
      ? { o: [1950, 230], u: [1450, 170], v: [880, 1420] }
      : { o: [260, 1520], u: [1250, 140], v: [700, 1250] };
  const mk = markSD(1000, 0, 0);
  const det = g.u[0] * g.v[1] - g.u[1] * g.v[0];
  const scale = Math.min(Math.hypot(g.u[0], g.u[1]), Math.hypot(g.v[0], g.v[1])) / 1000;
  const mist = [0, 0, 0] as RGB;
  const verd = [0, 0, 0] as RGB;
  tone(0.97, mist);
  tone(0.78, verd);
  return (x, y, _px, o) => {
    const dx = x - g.o[0];
    const dy = y - g.o[1];
    const a = (dx * g.v[1] - dy * g.v[0]) / det; // mark x, 0–1
    const b = (g.u[0] * dy - g.u[1] * dx) / det; // mark y, 0–1
    const d = mk.at(a * 1000, b * 1000);
    const soft = (5 + 70 * clamp01(b)) / scale; // penumbra grows away from the window
    const ib = smoothstep(-soft, soft, d.b);
    const ia = smoothstep(-soft, soft, d.a);
    const cx = g.o[0] + 0.5 * (g.u[0] + g.v[0]);
    const cy = g.o[1] + 0.5 * (g.u[1] + g.v[1]);
    const t = 0.26 + 0.05 * (1 - y / H) + 0.1 * pool(x, y, cx, cy, 900);
    tone(t, o);
    const k = 0.72;
    for (let c = 0; c < 3; c++)
      o[c] =
        (o[c] as number) * (1 - k * ib - k * ia) +
        (mist[c] as number) * k * ib +
        (verd[c] as number) * k * ia;
    return o;
  };
}

// ── C. Cut of light: the 45° one-stroke channel as a slot of light between two softly lit planes ───────────
function cutLight(f: Fmt): Shader {
  const [, H] = DIM[f];
  const c =
    f === "desktop" ? { x: 2700, y: 880, stop: 1987, w: 112 } : { x: 1080, y: 2340, stop: 4680, w: 100 };
  const d = c.w * Math.SQRT2;
  const k = c.x + c.y - d / 2;
  return (x, y, px, o) => {
    const u = x + y;
    const perp = (u - k) * R2; // px from the slot's upper-left edge, along (1, 1)/√2
    const inSlot = cover(perp / px) * cover((c.w - perp) / px);
    const fade = 1 - smoothstep(c.stop - 260, c.stop, y); // the slot's light dies before the taskbar
    const fromSlot = perp < 0 ? -perp : Math.max(0, perp - c.w);
    const bounce = Math.exp(-fromSlot / 240) * fade;
    let t = perp < c.w / 2 ? 0.31 + 0.05 * (1 - y / H) : 0.39 + 0.04 * (1 - y / H); // two planes
    t += 0.2 * bounce;
    const core = 0.82 + 0.15 * Math.sin(Math.PI * clamp01(perp / c.w));
    t = t * (1 - inSlot * fade) + core * inSlot * fade;
    return tone(t, o);
  };
}

// ── D. Debossed: a huge TH pressed into a matte surface under raking light ─────────────────────────────────
function deboss(f: Fmt): Shader {
  const [, H] = DIM[f];
  const p = f === "desktop" ? { s: 1980, x: 1760, y: -70 } : { s: 2300, x: -70, y: 1190 };
  const mk = markSD(p.s, p.x, p.y);
  const r = 70;
  const hgt = (x: number, y: number) => -smoothstep(-r, r, mk.at(x, y).u);
  return (x, y, px, o) => {
    const e = px;
    const h0 = hgt(x, y);
    const gx = ((hgt(x + e, y) - h0) / e) * 90;
    const gy = ((hgt(x, y + e) - h0) / e) * 90;
    const d = mk.at(x, y);
    let t = 0.45 + 0.06 * (1 - y / H) + 0.06 * pool(x, y, p.x + 0.3 * p.s, p.y + 0.4 * p.s, 1400);
    t += shade(gx, gy, 0.55, 0.15, 12);
    if (d.u > 0) t += (d.a > d.b ? 0.05 : -0.04) - 0.05 * (1 - smoothstep(0, 140, d.u)); // floor + occlusion
    return tone(t, o);
  };
}

// ── E. Facade: 45° louvres, each one stroke wide; the TH emerges where the slats turn to the light ─────────
function facade(f: Fmt): Shader {
  const [W, H] = DIM[f];
  const P = 96;
  const p =
    f === "desktop"
      ? { s: 1250, x: 2420, y: 330, left: 1480, bottom: 1900 }
      : { s: 1300, x: 430, y: 1690, left: 0, bottom: 3900 };
  const mk = markSD(p.s, p.x, p.y);
  const top = f === "desktop" ? 0 : 860;
  return (x, y, px, o) => {
    const inside = cover((x - p.left) / px) * cover((p.bottom - y) / px) * cover((y - top) / px);
    let t = 0.36 + 0.06 * (1 - y / H) + 0.02 * (x / W);
    if (inside > 0) {
      const u = (x + y) * R2;
      const i = Math.floor(u / P);
      const s = u / P - i;
      const shift = ((i + 0.5) * P - u) * R2; // move to the slat's centre line
      const lit = mk.at(x + shift, y + shift).u > 0;
      const g = (lit ? 0.62 : -0.34) + 0.9 * (s - 0.5);
      let ft = (lit ? 0.5 : 0.36) + shade(g * R2, g * R2, 0.5, 0.25, 16);
      ft -= 0.1 * Math.exp((-s * P) / 6); // the gap between slats
      t = t * (1 - inside) + ft * inside;
    }
    return tone(t, o);
  };
}

// ── F. Construction, lit: the drawing sheet as a real object on a desk under a soft light ──────────────────
function sheet(f: Fmt): Shader {
  const q =
    f === "desktop"
      ? { x0: 1720, y0: 160, x1: 3480, y1: 1840, s: 1000, mx: 2100, my: 500 }
      : { x0: 200, y0: 1460, x1: 1960, y1: 3220, s: 1000, mx: 580, my: 1840 };
  const mk = markSD(q.s, q.mx, q.my);
  const u = q.s / 100;
  const cut = 0.19 * q.s;
  const inSheet = (x: number, y: number) =>
    Math.min(x - q.x0, q.x1 - x, y - q.y0, q.y1 - y, (x - q.x0 + (y - q.y0) - cut) * R2);
  return (x, y, px, o) => {
    let t = 0.3 + 0.12 * pool(x, y, (q.x0 + q.x1) / 2 - 200, (q.y0 + q.y1) / 2 - 200, 1300);
    t -= 0.12 * smoothstep(-70, 70, inSheet(x - 40, y - 56)); // the sheet's soft shadow
    const a = cover(inSheet(x, y) / px);
    if (a > 0) {
      let st = 0.9 - (0.08 * ((x - q.x0) / (q.x1 - q.x0) + (y - q.y0) / (q.y1 - q.y0))) / 2;
      const gx = (x - q.mx) / u;
      const gy = (y - q.my) / u;
      const near = (v: number, step: number) => {
        const r = Math.abs(v - step * Math.round(v / step)) * u;
        return 1 - smoothstep(0.5, 1.6, r);
      };
      const inGrid = gx > -19 && gx < 119 && gy > -19 && gy < 119;
      if (inGrid)
        st -= 0.05 * Math.max(near(gx, 5), near(gy, 5)) + 0.07 * Math.max(near(gx, 10), near(gy, 10));
      const d = mk.at(x, y);
      if (d.b > 0) st = st * 0.82 + 0.16 * 0.18;
      else if (d.a > 0) st = st * 0.82 + 0.45 * 0.18;
      const edge = 1 - smoothstep(1, 2.5, Math.abs(d.u));
      if (edge > 0) st = st * (1 - edge) + (d.a > d.b ? 0.45 : 0.16) * edge;
      t = t * (1 - a) + st * a;
    }
    return tone(t, o);
  };
}

// ── G. Glass mark: the four pieces as frosted glass planes at different depths, overlapping in soft light ───
function glass(f: Fmt): Shader {
  const [, H] = DIM[f];
  const p = f === "desktop" ? { s: 1350, x: 2250, y: 330 } : { s: 1300, x: 430, y: 1690 };
  const m = fitMark(p.s);
  // pieces back to front, each with its depth (shadow offset) and glass tone: T and stem deep, the rest light
  const pieces = [
    { q: m.pieces.base[1] as [number, number][], depth: 30, t: 0.3, alpha: 0.62 }, // stem
    { q: m.pieces.accent[1] as [number, number][], depth: 60, t: 0.72, alpha: 0.55 }, // right stem
    { q: m.pieces.base[0] as [number, number][], depth: 95, t: 0.34, alpha: 0.6 }, // bar
    { q: m.pieces.accent[0] as [number, number][], depth: 130, t: 0.78, alpha: 0.5 }, // crossbar
  ];
  const tmp: RGB = [0, 0, 0];
  return (x, y, px, o) => {
    const t = 0.38 + 0.07 * (1 - y / H) + 0.1 * pool(x, y, p.x + 0.3 * p.s, p.y + 0.2 * p.s, 1100);
    tone(t, o);
    const lx = x - p.x;
    const ly = y - p.y;
    for (const g of pieces) {
      // its soft shadow on everything behind
      const sd = convexInside(g.q, lx - g.depth * 0.7, ly - g.depth);
      const sh = smoothstep(-20 - g.depth * 0.5, 20 + g.depth * 0.5, sd) * 0.28;
      for (let c = 0; c < 3; c++) o[c] = (o[c] as number) * (1 - sh);
      const d = convexInside(g.q, lx, ly);
      const a = cover(d / px);
      if (a <= 0) continue;
      // frosted glass: its own tone, lighter toward the top left, a bright rim where the edge meets the light
      const rim = 1 - smoothstep(0, 5, d);
      const top = 1 - smoothstep(-6, 6, convexInside(g.q, lx - 8, ly - 8));
      const gt = g.t + 0.07 * (1 - ly / p.s) + 0.16 * rim * (0.4 + 0.6 * top);
      tone(gt, tmp);
      const k = a * (g.alpha + 0.35 * rim);
      for (let c = 0; c < 3; c++) o[c] = (o[c] as number) * (1 - k) + (tmp[c] as number) * k;
    }
    return o;
  };
}

const SKETCHES: [string, string, (f: Fmt) => Shader][] = [
  ["A", "Monolith, lit", monolith],
  ["B", "Light through the mark", gobo],
  ["C", "Cut of light", cutLight],
  ["D", "Debossed", deboss],
  ["E", "Facade", facade],
  ["F", "Construction, lit", sheet],
  ["G", "Glass mark", glass],
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "..", ".logs", "wallpapers");
mkdirSync(out, { recursive: true });

const png = async (f: Fmt, sh: Shader, scale: number) => {
  const [W, H] = DIM[f];
  const data = render(W, H, sh, scale);
  return sharp(Buffer.from(data.buffer), {
    raw: { width: Math.round(W * scale), height: Math.round(H * scale), channels: 3 },
  })
    .png()
    .toBuffer();
};

const CELL = { w: 960 + 24 + 250, h: 540 + 70 };
const cols = 2;
const tiles: sharp.OverlayOptions[] = [];
for (const [i, [letter, name, make]] of SKETCHES.entries()) {
  const cx = 40 + (i % cols) * (CELL.w + 60);
  const cy = 40 + Math.floor(i / cols) * (CELL.h + 30);
  const desk = await png("desktop", make("desktop"), 0.25);
  const phone = await sharp(await png("mobile", make("mobile"), 0.125))
    .resize(250, 540)
    .png()
    .toBuffer();
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL.w}" height="64"><text x="0" y="52" font-family="Segoe UI, Arial" font-size="56" font-weight="700" fill="#14231F">${letter}</text><text x="56" y="50" font-family="Segoe UI, Arial" font-size="30" fill="#14231F">${name}</text></svg>`,
  );
  tiles.push({ input: label, left: cx, top: cy }, { input: desk, left: cx, top: cy + 70 });
  tiles.push({ input: phone, left: cx + 960 + 24, top: cy + 70 });
  console.log(`${letter} ${name}`);
}
const rows = Math.ceil(SKETCHES.length / cols);
await sharp({
  create: {
    width: 80 + cols * CELL.w + (cols - 1) * 60,
    height: 80 + rows * (CELL.h + 30),
    channels: 3,
    background: "#D9DDDA",
  },
})
  .composite(tiles)
  .png()
  .toFile(join(out, "sketches.png"));
console.log(join(out, "sketches.png"));
