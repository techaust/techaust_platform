// Brand wallpapers (docs/runs/brand-wallpapers.md): three concepts × desktop and mobile, drawn from the tokens
// and the mark's geometry as SVG in output pixels (pure string functions; scripts/build-wallpapers.ts renders
// them to PNG). Dark ink only, flat tones only, the TH mark only, no text.
// Crispness: every axis-aligned edge and hairline lands on a whole pixel; only the 45° cuts are anti-aliased.
// Shapes that meet along a diagonal overlap underneath, so no background seam shows through a shared edge.
import { color } from "./compose.ts";
import { MARK_PARAMS, markPaths } from "./geometry.ts";

export const CONCEPTS = ["monolith", "cut", "construction"] as const;
export type Concept = (typeof CONCEPTS)[number];
export const FORMAT_NAMES = ["desktop", "mobile"] as const;
export type Format = (typeof FORMAT_NAMES)[number];
export type Rect = { x: number; y: number; w: number; h: number };

/** Frame sizes and the quiet zones (icons, taskbar, clock, dock) that hold only the background tones. */
export const FORMATS: Record<Format, { width: number; height: number; quiet: Rect[]; focus?: Rect }> = {
  // Desktop: icons down the left 30 %, taskbar or dock along the bottom 8 %.
  desktop: {
    width: 3840,
    height: 2160,
    quiet: [
      { x: 0, y: 0, w: 1152, h: 2160 },
      { x: 0, y: 1987, w: 3840, h: 173 },
    ],
  },
  // Mobile: clock and notifications in the top 15 %, dock and home bar in the bottom 12 %; the focal point
  // sits in the middle third.
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

/** The palette roles. Background and tone-on-tone shapes stay within a small lightness step of each other. */
const TONE = {
  ground: color("ink-950"), // the background of every wallpaper
  raised: color("ink-800"), // tone-on-tone: the monolith's T, the second plane of the cut
  accent: color("verdigris-900"), // the monolith's crossbar: deep, restrained
  channel: color("verdigris-700"), // the cut's channel
  grid: color("ink-800"), // construction: the 10-unit grid
  line: color("ink-600"), // construction: lines through the mark's edges and cuts
  traceBase: color("ink-300"), // construction: the T and the shared stem (the ink role, on dark)
  traceAccent: color("verdigris-300"), // construction: the crossbar and the right stem (the accent role, on dark)
  dimension: color("verdigris-500"), // construction: the channel's one-stroke dimension
};

// ── The mark, fitted to whole pixels ────────────────────────────────────────────────────────────────────────

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
  // The same rounding as markPaths(p, true), so the outlines below trace exactly the filled shapes.
  const v = Math.round(p.v);
  const h = Math.round(p.h);
  const s1 = Math.round(p.stemX);
  const s2 = s1 + v;
  const rx = size - v;
  const barEnd = Math.round(size - v * Math.SQRT2);
  const cTop = Math.round(p.crossbarY - p.h / 2);
  const cBot = cTop + h;
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
    /** Filled shapes: base = the T and the shared stem, accent = the crossbar and the right stem. */
    fill: markPaths(p, true),
    /** Each colour as one closed outline (the union of its two shapes), for the hairline trace. */
    outline: {
      base: `M0 0H${barEnd}L${barEnd - h} ${h}H${s2}V${size}H${s1}V${h}H0Z`,
      accent: `M${s2} ${cTop}H${rx}V${v}L${size} 0V${size}H${rx}V${cBot}H${s2}Z`,
    },
  };
}
export type FittedMark = ReturnType<typeof fitMark>;

// ── SVG helpers (whole-pixel coordinates) ───────────────────────────────────────────────────────────────────

const r = (n: number) => Math.round(n * 100) / 100;
const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const poly = (pts: [number, number][], fill: string) =>
  `<path fill="${fill}" d="M${pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L")}Z"/>`;
const at = (x: number, y: number, body: string) => `<g transform="translate(${x} ${y})">${body}</g>`;

function frame(format: Format, body: string): string {
  const { width, height } = FORMATS[format];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${rect(0, 0, width, height, TONE.ground)}${body}</svg>\n`
  );
}

/**
 * A 45° band along x + y = k, `width` px thick (measured square to the band), between the horizontals y0 and y1
 * (whole pixels, so its ends are crisp). `k` is the band's upper-left edge.
 */
function band(k: number, width: number, y0: number, y1: number, fill: string) {
  const d = width * Math.SQRT2; // the band's width along a horizontal
  return poly(
    [
      [k - y0, y0],
      [k + d - y0, y0],
      [k + d - y1, y1],
      [k - y1, y1],
    ],
    fill,
  );
}

// ── 1. Monolith: the whole mark, very large and tone-on-tone, with one deep verdigris accent ────────────────
// The T and the shared stem in ink-800 on ink-950; the crossbar and the right stem in verdigris-900. Desktop: 1680
// px (78 % of the height), centred across the free area right of the icons and set a touch above the centre of the
// space over the taskbar (optical centre). Phone: 1500 px, centred in the middle third. Nothing enters a quiet zone.

const MONOLITH: Record<Format, { size: number; x: number; y: number }> = {
  desktop: { size: 1680, x: 1656, y: 140 },
  mobile: { size: 1500, x: 330, y: 1590 },
};

function monolith(format: Format): string {
  const p = MONOLITH[format];
  const m = fitMark(p.size);
  return frame(
    format,
    at(
      p.x,
      p.y,
      `<path data-part="base" fill="${TONE.raised}" d="${m.fill.base}"/>` +
        `<path data-part="accent" fill="${TONE.accent}" d="${m.fill.accent}"/>`,
    ),
  );
}

// ── 2. Cut: the mark's 45° cut across the frame, a verdigris channel one stroke wide between two deep tones ─
// The channel is one stroke of a 480 px mark (19 units of 100). On the phone it crosses the whole frame through
// the middle third; on the desktop it runs from the top edge and stops square on the taskbar line, while the two
// tones meet below it (a tone-on-tone step under the taskbar).

const CUT: Record<Format, { mark: number; centre: [number, number] }> = {
  desktop: { mark: 480, centre: [2304, 1000] },
  mobile: { mark: 480, centre: [1080, 2340] },
};
/** The desktop channel ends on the taskbar line. */
const CUT_STOP: Record<Format, number | undefined> = { desktop: 1987, mobile: undefined };

function cutGeometry(format: Format) {
  const p = CUT[format];
  const w = fitMark(p.mark).v;
  const d = w * Math.SQRT2;
  const k = p.centre[0] + p.centre[1] - d / 2; // the channel's upper-left edge: x + y = k
  return { w, d, k, stop: CUT_STOP[format] ?? FORMATS[format].height };
}

function cut(format: Format): string {
  const { width, height } = FORMATS[format];
  const { w, d, k, stop } = cutGeometry(format);
  const far = width + height;
  // The second tone starts under the middle of the channel (so its edge is hidden and no seam can show); below
  // the channel's end it meets the ground directly along the channel's upper-left edge.
  const mid = k + d / 2;
  const raised = poly(
    [
      [mid, 0],
      [far, 0],
      [far, height],
      [k - height, height],
      [k - stop, stop],
      [mid - stop, stop],
    ],
    TONE.raised,
  );
  return frame(format, raised + band(k, w, 0, stop, TONE.channel));
}

// ── 3. Construction: the mark's 100-unit grid as hairlines, the mark traced on it ("built properly") ────────
// Three layers that stop at three distances, so the drawing ends by stopping, never by fading: the 10-unit grid
// fills the clear space (one stroke round the mark); the lines through the mark's own edges and its two 45° cuts
// reach one stroke further. The mark is traced on its true geometry: the T and shared stem in ink, the crossbar
// and right stem in verdigris. One dimension across the channel shows it is exactly one stroke wide.

const CONSTRUCTION: Record<Format, { unit: number; centre: [number, number] }> = {
  desktop: { unit: 10, centre: [2496, 994] },
  mobile: { unit: 11, centre: [1080, 2340] },
};
const HAIR = 2; // px: one device pixel at 200 % scaling
const TRACE = 4; // px: the mark's outline

function construction(format: Format): string {
  const p = CONSTRUCTION[format];
  const u = p.unit;
  const m = fitMark(100 * u);
  const S = m.size;
  const x0 = p.centre[0] - S / 2;
  const y0 = p.centre[1] - S / 2;
  const near = 19 * u; // the clear space
  const reach = 38 * u; // the clear space plus one more stroke
  const parts: string[] = [];
  // The grid: every 10 units, inside the clear space.
  for (let g = 0; g <= 100; g += 10) {
    const q = g * u - HAIR / 2;
    parts.push(rect(q, -near, HAIR, S + 2 * near, TONE.grid), rect(-near, q, S + 2 * near, HAIR, TONE.grid));
  }
  // Lines through the mark's edges (stems, bar, crossbar), one stroke further out.
  for (const x of [m.s1, m.s2, m.rx]) parts.push(rect(x - HAIR / 2, -reach, HAIR, S + 2 * reach, TONE.line));
  for (const y of [m.h, m.cTop, m.cBot])
    parts.push(rect(-reach, y - HAIR / 2, S + 2 * reach, HAIR, TONE.line));
  // The two 45° cuts (x + y = barEnd and x + y = S) carried up and out of the mark to the same reach.
  for (const k of [m.barEnd, S]) {
    const top = Math.max(-reach, k - (S + reach));
    parts.push(band(k - HAIR / Math.SQRT2, HAIR, top, 0, TONE.line));
  }
  // The trace.
  const trace = (part: "base" | "accent", d: string, stroke: string) =>
    `<path data-part="${part}" fill="none" stroke="${stroke}" stroke-width="${TRACE}" stroke-linejoin="miter" d="${d}"/>`;
  parts.push(
    trace("base", m.outline.base, TONE.traceBase),
    trace("accent", m.outline.accent, TONE.traceAccent),
  );
  // The dimension: square across the channel, in the clear space above the mark, with ticks along the cuts.
  const s = (S - m.barEnd) / 2; // the run along (1, 1) from one cut to the other
  const my = -Math.round(0.8 * near);
  const mx = (m.barEnd + S) / 2 - my;
  const a: [number, number] = [mx - s / 2, my - s / 2];
  const b: [number, number] = [mx + s / 2, my + s / 2];
  const t = 1.5 * u; // tick half-length along the cut direction (1, -1)
  const seg = ([x1, y1]: [number, number], [x2, y2]: [number, number]) =>
    `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`;
  const tick = ([x, y]: [number, number]) => seg([x - t, y + t], [x + t, y - t]);
  parts.push(
    `<path d="${seg(a, b)}${tick(a)}${tick(b)}" fill="none" stroke="${TONE.dimension}" stroke-width="${HAIR}"/>`,
  );
  return frame(format, at(x0, y0, parts.join("")));
}

// ── Inspection helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Points with the finest detail (the cuts, joins and line ends), for the preview's 100 % crops. */
export function previewFocus(concept: Concept, format: Format): { x: number; y: number }[] {
  if (concept === "monolith") {
    const p = MONOLITH[format];
    const m = fitMark(p.size);
    return [
      { x: p.x + m.barEnd - Math.round(m.h / 2), y: p.y + Math.round(m.h / 2) },
      { x: p.x + m.s2, y: p.y + m.cTop },
    ];
  }
  if (concept === "cut") {
    const { d, k, stop } = cutGeometry(format);
    const y = Math.round(FORMATS[format].height / 2);
    return [
      { x: Math.round(k + d / 2 - y), y },
      { x: Math.round(k + d / 2 - stop), y: Math.min(stop, FORMATS[format].height - 320) },
    ];
  }
  const p = CONSTRUCTION[format];
  const m = fitMark(100 * p.unit);
  const x0 = p.centre[0] - m.size / 2;
  const y0 = p.centre[1] - m.size / 2;
  return [
    { x: x0 + m.barEnd, y: y0 },
    { x: x0 + m.s2, y: y0 + m.cTop },
  ];
}

// ── The six files ──────────────────────────────────────────────────────────────────────────────────────────

const DRAW: Record<Concept, (f: Format) => string> = { monolith, cut, construction };

export function wallpaperSvg(concept: Concept, format: Format): string {
  return DRAW[concept](format);
}

export type Wallpaper = {
  file: string;
  concept: Concept;
  format: Format;
  width: number;
  height: number;
  svg: string;
};

export function wallpaperPlan(): Wallpaper[] {
  return CONCEPTS.flatMap((concept) =>
    FORMAT_NAMES.map((format) => ({
      file: wallpaperFile(concept, format),
      concept,
      format,
      width: FORMATS[format].width,
      height: FORMATS[format].height,
      svg: wallpaperSvg(concept, format),
    })),
  );
}
