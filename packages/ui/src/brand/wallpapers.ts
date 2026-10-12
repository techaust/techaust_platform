// Brand wallpapers (docs/runs/brand-wallpapers.md): three concepts × desktop and mobile, drawn from the tokens
// and the mark's geometry as SVG in output pixels (pure string functions; scripts/build-wallpapers.ts renders
// them to PNG). Dark ink only, flat tones only, the TH mark only, no text.
//
// One light for all three: it comes from the top left. Faces that look up or left are lighter, shadows fall
// down and right at 45° (the mark's own cut), and depth is built from small tone steps (ΔL* about 2–6).
// Crispness: every axis-aligned edge and hairline lands on a whole pixel; only 45° edges are anti-aliased.
// No seams: wherever two tones meet along a diagonal, the lower one runs on underneath the upper one.
import { color } from "./compose.ts";
import { MARK_PARAMS, markPaths } from "./geometry.ts";

export const CONCEPTS = ["monolith", "cut", "construction"] as const;
export type Concept = (typeof CONCEPTS)[number];
export const FORMAT_NAMES = ["desktop", "mobile"] as const;
export type Format = (typeof FORMAT_NAMES)[number];
export type Rect = { x: number; y: number; w: number; h: number };
type Pt = [number, number];

/** Frame sizes and the quiet zones (icons, taskbar, clock, dock): the ground, or one plane within ΔL* 3. */
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

/** The tone ladder (L*): ink-950 6.4 · 750 9.1 · 800 11.5 · 700 15.2 · 600 20.7 · verdigris-900 28.3 · 800 32.1 · 700 40.5. */
const T = {
  ground: color("ink-950"),
  low: color("ink-750"), // the one plane allowed in the quiet zones (ΔL* 2.7)
  i800: color("ink-800"),
  i700: color("ink-700"),
  i600: color("ink-600"),
  i400: color("ink-400"),
  i300: color("ink-300"),
  v900: color("verdigris-900"),
  v800: color("verdigris-800"),
  v700: color("verdigris-700"),
  v500: color("verdigris-500"),
  v300: color("verdigris-300"),
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
  // The same rounding as markPaths(p, true), so the outlines and solids below match the filled shapes exactly.
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
    /** Filled shapes: base = the T and the shared stem, accent = the crossbar and the right stem. */
    fill: markPaths(p, true),
    /** Each colour as one closed outline (the union of its two shapes), for the hairline trace. */
    outline: {
      base: `M0 0H${barEnd}L${barEnd - h} ${h}H${s2}V${S}H${s1}V${h}H0Z`,
      accent: `M${s2} ${cTop}H${rx}V${v}L${S} 0V${S}H${rx}V${cBot}H${s2}Z`,
    },
    /** The four convex pieces (bar, stem | crossbar, right stem), for the solid and its shadow. */
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

// ── SVG helpers (whole-pixel coordinates) ───────────────────────────────────────────────────────────────────

const r = (n: number) => Math.round(n * 100) / 100;
const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="${fill}"/>`;
const d = (pts: Pt[]) => `M${pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L")}Z`;
const poly = (pts: Pt[], fill: string, part = "") =>
  `<path${part ? ` data-part="${part}"` : ""} fill="${fill}" d="${d(pts)}"/>`;
const at = (x: number, y: number, body: string) => `<g transform="translate(${x} ${y})">${body}</g>`;
const shift = (pts: Pt[], dx: number, dy: number): Pt[] => pts.map(([x, y]) => [x + dx, y + dy]);

/** Convex hull (monotone chain): the swept solid of a convex piece and its extruded copy. */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as Pt, out[out.length - 1] as Pt, q) <= 0)
        out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

function frame(format: Format, body: string): string {
  const { width, height } = FORMATS[format];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `${rect(0, 0, width, height, T.ground)}${body}</svg>\n`
  );
}

/**
 * A 45° "/" band along x + y = k (its upper-left edge), `width` px thick measured square to the band, between
 * the horizontals y0 and y1 (whole pixels, so its ends are crisp).
 */
function band(k: number, width: number, y0: number, y1: number, fill: string, part = "") {
  const w = width * Math.SQRT2; // the band's width along a horizontal
  return poly(
    [
      [k - y0, y0],
      [k + w - y0, y0],
      [k + w - y1, y1],
      [k - y1, y1],
    ],
    fill,
    part,
  );
}

/** Everything on the lower-right side of x + y = k, between the horizontals y0 and y1 (a plate). */
function plate(k: number, y0: number, y1: number, right: number, fill: string) {
  return poly(
    [
      [k - y0, y0],
      [right, y0],
      [right, y1],
      [k - y1, y1],
    ],
    fill,
  );
}

/** A registration mark: a 2 px cross on whole pixels. */
const cross = (x: number, y: number, arm: number, fill: string) =>
  rect(x - arm, y - 1, 2 * arm, 2, fill) + rect(x - 1, y - arm, 2, 2 * arm, fill);

/** A 2 px hairline segment (any angle; axis-aligned ones are drawn as whole-pixel rects by the callers). */
const segment = (a: Pt, b: Pt, stroke: string, width = 2) =>
  `<path fill="none" stroke="${stroke}" stroke-width="${width}" d="M${r(a[0])} ${r(a[1])}L${r(b[0])} ${r(b[1])}"/>`;

// ── 1. Monolith: the whole mark as a machined solid on a wall plane ──────────────────────────────────────────
// The mark is a relief, drawn in cabinet projection: its depth runs up and left by half the channel, so the faces
// that catch the light show (tops, left sides and the right stem's 45° cut, which becomes a bevel). Its hard
// shadow falls down and right onto an ink-750 wall plane, the one plane allowed in the quiet zones. The wall's
// own corner is cut at 45°, one stroke from the solid; four registration marks sit one stroke outside the mark's
// clear space; a verdigris-300 glint runs along the cut's arris.

const MONOLITH: Record<Format, { size: number; centre: Pt; wall: number }> = {
  // wall: the x of the wall plane's left edge
  desktop: { size: 1300, centre: [2688, 960], wall: 1536 },
  mobile: { size: 1400, centre: [1080, 2340], wall: 216 },
};

function monolithGeometry(format: Format) {
  const p = MONOLITH[format];
  const m = fitMark(p.size);
  const x = p.centre[0] - p.size / 2;
  const y = p.centre[1] - p.size / 2;
  const e = Math.round(m.v * 0.22); // depth: a low relief; the cut's bevel takes about a third of the channel
  return { p, m, x, y, e };
}

function monolith(format: Format): string {
  const { height, width } = FORMATS[format];
  const { p, m, x, y, e } = monolithGeometry(format);
  // The wall: from its left edge to the right of the frame, top to bottom, its top-left corner cut at 45° one
  // stroke (measured square) above-left of the solid's own top-left corner.
  const cut = x - e + (y - e) - Math.round(m.v * Math.SQRT2); // the chamfer: x + y = cut
  const wall = poly(
    [
      [p.wall, cut - p.wall],
      [cut, 0],
      [width, 0],
      [width, height],
      [p.wall, height],
    ],
    T.low,
  );
  const all = [...m.pieces.base, ...m.pieces.accent];
  // The hard shadow: the silhouette, moved down and right by the depth.
  const shadow = `<path fill="${T.ground}" d="${all.map((q) => d(shift(q, x + e, y + e))).join("")}"/>`;
  // The solid: each convex piece swept up-left (in its side tone), then its lit faces, then the front.
  const swept = (q: Pt[]) => hull([...q, ...shift(q, -e, -e)]);
  const face = (a: Pt, b: Pt): Pt[] => [a, b, [b[0] - e, b[1] - e], [a[0] - e, a[1] - e]];
  const body =
    m.pieces.base.map((q) => poly(swept(q), T.i700, "base")).join("") +
    m.pieces.accent.map((q) => poly(swept(q), T.v800, "accent")).join("") +
    poly(face([0, 0], [m.barEnd, 0]), T.i600, "base") + // the bar's top
    poly(face([m.s2, m.cTop], [m.rx, m.cTop]), T.v700, "accent") + // the crossbar's top
    poly(face([m.rx, m.v], [m.size, 0]), T.v700, "accent") + // the right stem's cut, as a bevel
    `<path data-part="base" fill="${T.i800}" d="${m.fill.base}"/>` +
    `<path data-part="accent" fill="${T.v900}" d="${m.fill.accent}"/>` +
    // The glint on the cut's arris: 3 px, just inside the bevel.
    band(m.size - 3 * Math.SQRT2, 3, 0, m.v, T.v300, "accent");
  // Registration: at the four corners of the mark's clear space (one stroke out).
  const o = m.v;
  const arm = Math.round(m.v / 8);
  const marks = [
    [-o, -o],
    [m.size + o, -o],
    [-o, m.size + o],
    [m.size + o, m.size + o],
  ]
    .map(([a, b]) => cross(a as number, b as number, arm, T.i600))
    .join("");
  return frame(format, wall + shadow + at(x, y, marks + body));
}

// ── 2. Cut: a field of plates split by 45° cuts, the verdigris channel the hero ─────────────────────────────
// Plates step up toward the top-right corner (ink-750 → 800 → 700 → 600) at stroke-multiple distances from the
// hero channel (3 and 1 stroke before it; 1 and 2 strokes after it). Each raised plate shows a reveal along its
// cut edge in a deeper verdigris (800, then 900), and ends square on a horizontal set by the golden section. The
// hero channel is one stroke of a 480 px mark, with a verdigris-300 edge where the light catches it.

const CUT: Record<Format, { mark: number; centre: Pt; stop: number; plates: [number, number] }> = {
  // plates: the lower ends of the two raised plates (golden section of the frame height)
  desktop: { mark: 480, centre: [2360, 1000], stop: 1987, plates: [1335, 825] },
  mobile: { mark: 480, centre: [1080, 2340], stop: 4118, plates: [2892, 2340] },
};

function cutGeometry(format: Format) {
  const p = CUT[format];
  const w = fitMark(p.mark).v; // one stroke
  const s = w * Math.SQRT2; // one stroke measured along a horizontal
  const k = p.centre[0] + p.centre[1] - s / 2; // the hero's upper-left edge: x + y = k
  return { p, w, s, k };
}

function cut(format: Format): string {
  const { width, height } = FORMATS[format];
  const { p, w, s, k } = cutGeometry(format);
  const [yc, yd] = p.plates;
  return frame(
    format,
    // The low plane (ΔL* 2.7) three strokes before the hero, running on through the quiet zones.
    plate(k - 3 * s, 0, height, width, T.low) +
      // The working plane, one stroke before the hero, ending on the taskbar / dock line.
      plate(k - s, 0, p.stop, width, T.i800) +
      // Raised plates (each starts under its reveal, so no seam shows).
      plate(k + 2.5 * s, 0, yc, width, T.i700) +
      plate(k + 5.5 * s, 0, yd, width, T.i600) +
      // Reveals, one stroke wide along each raised plate's edge, deeper the further they are from the hero: a
      // verdigris-900 channel, then a shadow gap in the ground tone.
      band(k + 2 * s, w, 0, yc, T.v900) +
      band(k + 5 * s, w, 0, yd, T.ground) +
      // The hero channel and its lit edge (3 px on the upper-left side, where the light falls).
      band(k, w, 0, p.stop, T.v700) +
      band(k, 3, 0, p.stop, T.v300) +
      // Registration marks one stroke below each reveal's square end, on its centre line.
      [
        [k + 2.5 * s - yc, yc],
        [k + 5.5 * s - yd, yd],
      ]
        .map(([x, y]) => cross(Math.round((x as number) - w), Math.round((y as number) + w), 12, T.i600))
        .join(""),
  );
}

// ── 3. Construction: a drawing sheet ────────────────────────────────────────────────────────────────────────
// An ink-750 sheet, cut at 45° at one corner, carries the mark's construction: a 5-unit sub-grid and the 10-unit
// grid inside the clear space; ruler ticks along two edges; lines through the mark's edges and its two cuts out
// to the sheet's edge; the mark filled tone-on-tone and traced on its true geometry (T and stem in ink, crossbar
// and right stem in verdigris); three dimensions (stroke, channel, height), a 1:1 slope marker for the 45° (no
// arcs: the brand has no curves) and registration marks at the clear space's corners.

const CONSTRUCTION: Record<Format, { unit: number; centre: Pt }> = {
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
  const C = 19 * u; // the clear space
  const R = 38 * u; // the sheet: the clear space plus one more stroke
  const { width, height } = FORMATS[format];
  const out: string[] = [];
  // The table: one very large ink-750 plane below a 45° edge one stroke beyond the sheet's cut corner.
  const sheetCut = -2 * R + C; // the sheet's corner cut, x + y in sheet units
  const tableK = x0 + y0 + sheetCut - Math.round(19 * u * Math.SQRT2);
  const table = plate(tableK, 0, height, width, T.low);
  // The sheet (ink-800), its top-left corner cut at 45° by one stroke, casting a hard shadow down and right.
  const sheet: Pt[] = [
    [-R + C, -R],
    [S + R, -R],
    [S + R, S + R],
    [-R, S + R],
    [-R, -R + C],
  ];
  const lift = Math.round(4 * u);
  out.push(poly(shift(sheet, lift, lift), T.ground), poly(sheet, T.i800));
  // Sub-grid (every 5 units, engraved: darker than the sheet) and grid (every 10, lighter), in the clear space.
  for (let g = -15; g <= 115; g += 5) {
    const q = g * u - HAIR / 2;
    const tone = g % 10 === 0 && g >= 0 && g <= 100 ? T.i700 : T.low;
    out.push(rect(q, -C, HAIR, S + 2 * C, tone), rect(-C, q, S + 2 * C, HAIR, tone));
  }
  // Ruler ticks along the sheet's top and left edges: every 10 units, longer at 0, 50 and 100.
  for (let g = 0; g <= 100; g += 10) {
    const len = g % 50 === 0 ? 3 * u : 1.5 * u;
    out.push(rect(g * u - HAIR / 2, -R, HAIR, len, T.i600), rect(-R, g * u - HAIR / 2, len, HAIR, T.i600));
  }
  // Lines through the mark's edges (stems, bar, crossbar) and its two 45° cuts, out to the sheet.
  for (const x of [m.s1, m.s2, m.rx]) out.push(rect(x - HAIR / 2, -R, HAIR, S + 2 * R, T.i600));
  for (const y of [m.h, m.cTop, m.cBot]) out.push(rect(-R, y - HAIR / 2, S + 2 * R, HAIR, T.i600));
  for (const k of [m.barEnd, S])
    out.push(band(k - HAIR / Math.SQRT2, HAIR, Math.max(-R, k - (S + R)), 0, T.i600));
  // The mark, filled tone-on-tone, then traced.
  out.push(`<path data-part="base" fill="${T.i700}" d="${m.fill.base}"/>`);
  out.push(`<path data-part="accent" fill="${T.v900}" d="${m.fill.accent}"/>`);
  const trace = (part: "base" | "accent", path: string, stroke: string) =>
    `<path data-part="${part}" fill="none" stroke="${stroke}" stroke-width="${TRACE}" stroke-linejoin="miter" d="${path}"/>`;
  out.push(trace("base", m.outline.base, T.i300), trace("accent", m.outline.accent, T.v300));
  // Dimensions, in verdigris-500 with square end ticks.
  const t = Math.round(1.5 * u);
  const dim: string[] = [];
  // 1. The channel: square across the two cuts, in the clear space above the mark.
  {
    const run = (S - m.barEnd) / 2;
    const my = -Math.round(0.8 * C);
    const mx = (m.barEnd + S) / 2 - my;
    const a: Pt = [mx - run / 2, my - run / 2];
    const b: Pt = [mx + run / 2, my + run / 2];
    dim.push(segment(a, b, T.v500));
    for (const [x, y] of [a, b]) dim.push(segment([x - t, y + t], [x + t, y - t], T.v500));
  }
  // 2. The stroke: across the shared stem, half a clear space below the mark.
  {
    const y = S + Math.round(C / 2);
    dim.push(rect(m.s1, y - 1, m.v, 2, T.v500));
    for (const x of [m.s1, m.s2]) dim.push(rect(x - 1, y - t, 2, 2 * t, T.v500));
  }
  // 3. The height (100 units): to the right of the mark, half a clear space out.
  {
    const x = S + Math.round(C / 2);
    dim.push(rect(x - 1, 0, 2, S, T.v500));
    for (const y of [0, S]) dim.push(rect(x - t, y - 1, 2 * t, 2, T.v500));
  }
  // 4. The 45°: a 1:1 slope marker against the bar's cut (two equal legs and the hypotenuse on the cut line).
  {
    const leg = Math.round(4 * u);
    const ax = m.barEnd - m.h; // the cut's lower end
    const ay = m.h;
    const c: Pt = [ax + leg, ay + Math.round(C / 2)];
    const tri: Pt[] = [
      [c[0] - leg, c[1]],
      [c[0], c[1]],
      [c[0], c[1] - leg],
    ];
    dim.push(
      `<path fill="none" stroke="${T.v500}" stroke-width="${HAIR}" stroke-linejoin="miter" d="${d(tri)}"/>`,
    );
  }
  out.push(...dim);
  // Registration marks at the clear space's four corners.
  const arm = Math.round(2 * u);
  for (const [a, b] of [
    [-C, -C],
    [S + C, -C],
    [-C, S + C],
    [S + C, S + C],
  ] as Pt[])
    out.push(cross(a, b, arm, T.i400));
  return frame(format, table + at(x0, y0, out.join("")));
}

// ── Inspection helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Points with the finest detail (the cuts, joins and line ends), for the preview's 100 % crops. */
export function previewFocus(concept: Concept, format: Format): { x: number; y: number }[] {
  if (concept === "monolith") {
    const { m, x, y } = monolithGeometry(format);
    return [
      { x: x + Math.round((m.barEnd + m.size) / 2), y: y + Math.round(m.v / 2) },
      { x: x + m.s2, y: y + m.cTop },
    ];
  }
  if (concept === "cut") {
    const { p, s, k } = cutGeometry(format);
    const y = p.plates[0];
    return [
      { x: Math.round(k + s / 2 - p.plates[1]), y: p.plates[1] },
      { x: Math.round(k + 2.5 * s - y), y },
    ];
  }
  const p = CONSTRUCTION[format];
  const m = fitMark(100 * p.unit);
  const x0 = p.centre[0] - m.size / 2;
  const y0 = p.centre[1] - m.size / 2;
  return [
    { x: x0 + m.barEnd, y: y0 },
    { x: x0 + m.s2, y: y0 + m.size },
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
