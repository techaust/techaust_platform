// Brand wallpapers (docs/runs/brand-wallpapers.md): three concepts × desktop and mobile, drawn from the tokens
// and the mark's geometry as SVG in output pixels (pure string functions; scripts/build-wallpapers.ts renders
// them to PNG). Dark ink only, flat tones only, no text: the TH mark, plus a brand-built node network on Cut and
// Construction.
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

// ── The node network (Construction and Cut) ──────────────────────────────────────────────────────────────────
// A routed system diagram, not a texture: nodes sit on the mark's construction grid or its geometry (or on stroke
// multiples of the channel); wires run only at 0°, 90° or 45° like circuit traces (orthogonal runs with 45°
// chamfers), 2 px on whole pixels; trunks branch at junctions and every wire ends at a node or on the mark or the
// channel (an anchor). Ink-400 wires and ink-500 nodes: second to the mark or the channel, above the grid. One
// verdigris signal runs as a single path across three to five nodes and arrives at the mark or the channel.

export type Pt = [number, number];
export type Network = {
  wires: { pts: Pt[]; signal: boolean }[];
  nodes: { at: Pt; signal: boolean }[];
  /** Points on the mark or the channel where a wire may end without a node. */
  anchors: Pt[];
};

const NET = {
  wire: color("ink-400"),
  node: color("ink-500"),
  signalWire: color("verdigris-300"),
  signalNode: color("verdigris-300"),
};

/** A node: a square `n` px wide, its top-left corner cut at 45° (the right stem's tip), centred on a point. */
function nodeShape([cx, cy]: Pt, n: number, fill: string, signal: boolean) {
  const x0 = cx - n / 2;
  const y0 = cy - n / 2;
  const c = Math.round(n * 0.4);
  const pts: Pt[] = [
    [x0 + c, y0],
    [x0 + n, y0],
    [x0 + n, y0 + n],
    [x0, y0 + n],
    [x0, y0 + c],
  ];
  return `<path data-net="${signal ? "signal-node" : "node"}" fill="${fill}" d="M${pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L")}Z"/>`;
}

function drawNetwork(net: Network, nodeSize: number, wire = NET.wire): string {
  const wires = net.wires
    .map(
      (w) =>
        `<path data-net="${w.signal ? "signal-wire" : "wire"}" fill="none" stroke="${w.signal ? NET.signalWire : wire}" stroke-width="${HAIR}" stroke-linejoin="miter" stroke-linecap="square" d="M${w.pts.map(([x, y]) => `${x} ${y}`).join("L")}"/>`,
    )
    .join("");
  const nodes = net.nodes
    .map((n) => nodeShape(n.at, nodeSize, n.signal ? NET.signalNode : NET.node, n.signal))
    .join("");
  return wires + nodes;
}

const shiftNet = (net: Network, dx: number, dy: number): Network => ({
  wires: net.wires.map((w) => ({ ...w, pts: w.pts.map(([x, y]) => [x + dx, y + dy] as Pt) })),
  nodes: net.nodes.map((n) => ({ ...n, at: [n.at[0] + dx, n.at[1] + dy] as Pt })),
  anchors: net.anchors.map(([x, y]) => [x + dx, y + dy] as Pt),
});

/** Builds a network from a compact description: wires as point lists, nodes and signal nodes by position. */
function net(wires: [Pt[], boolean?][], nodes: Pt[], signal: Pt[], anchors: Pt[]): Network {
  return {
    wires: wires.map(([pts, s]) => ({ pts, signal: s === true })),
    nodes: [...nodes.map((at) => ({ at, signal: false })), ...signal.map((at) => ({ at, signal: true }))],
    anchors,
  };
}

// ── 1. Monolith: the whole mark, very large and tone-on-tone, with one deep verdigris accent ────────────────
// The T and the shared stem in ink-800 on ink-950; the crossbar and the right stem in verdigris-900. Desktop: 1680
// px (78 % of the height), centred across the free area right of the icons and set a touch above the centre of the
// space over the taskbar (optical centre). Phone: 1560 px, the height of the middle third, set a touch above its
// centre and held by equal 300 px margins at the sides. Nothing enters a quiet zone.

const MONOLITH: Record<Format, { size: number; x: number; y: number }> = {
  desktop: { size: 1680, x: 1656, y: 140 },
  mobile: { size: 1560, x: 300, y: 1520 },
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
  return frame(
    format,
    raised + band(k, w, 0, stop, TONE.channel) + drawNetwork(cutNetwork(format), CUT_NODE, NET.node),
  );
}

/** Node size on the Cut: about a quarter of the channel's stroke, an even number of pixels. */
const CUT_NODE = 22;

/**
 * The Cut's network. Trunks run parallel to the channel (the mark's cut) at stroke multiples: 1.5 and 3.5 strokes
 * past its lower edge on the raised plane, 1.5 strokes before its upper edge on the ground. They branch at
 * junctions into level or plumb runs; several branches land on the channel's edges (anchors). The signal starts at
 * the outer trunk's lower node, climbs it to a junction, crosses the inner trunk and arrives at the channel.
 * Points are whole pixels; a "/" run keeps x + y constant, so every diagonal is exactly 45°.
 */
export function cutNetwork(format: Format): Network {
  const { w, k } = cutGeometry(format);
  const d = w * Math.SQRT2; // one stroke measured along a horizontal
  const upper = k; // x + y of the channel's upper edge
  const lower = k + d; // x + y of its lower edge
  const inner = Math.round(lower + 1.5 * d); // trunk 1, raised plane
  const outer = Math.round(lower + 3.5 * d); // trunk 2, raised plane
  const ground = Math.round(upper - 1.5 * d); // trunk 3, ground
  const on = (xy: number, y: number): Pt => [xy - y, y]; // the point of a "/" line at height y
  const edge = (xy: number, y: number): Pt => [Math.round(xy - y), y]; // where a level run meets a channel edge
  if (format === "desktop") {
    const t1 = [300, 700, 900, 1100, 1500].map((y) => on(inner, y));
    const t2 = [500, 900, 1300].map((y) => on(outer, y));
    const t3 = [150, 550, 1150].map((y) => on(ground, y));
    const [a, b, c, e, f] = t1 as [Pt, Pt, Pt, Pt, Pt];
    const [g, h, i] = t2 as [Pt, Pt, Pt];
    const [j, l, m] = t3 as [Pt, Pt, Pt];
    const eDown: Pt = [e[0], e[1] + 300];
    const mLeft: Pt = [m[0] - 300, m[1]];
    const toChannel = edge(lower, b[1]);
    const signalIn = edge(lower, h[1]);
    const fIn = edge(lower, f[1]);
    const lIn = edge(upper, l[1]);
    return net(
      [
        [[a, b, c, e, f]], // trunk 1
        [[g, h]], // trunk 2, upper part (ink)
        [[j, l, m]], // trunk 3
        [[b, toChannel]], // branch into the channel
        [[e, eDown]], // a plumb branch from the junction
        [[f, fIn]], // trunk 1's foot into the channel
        [[l, lIn]], // trunk 3 into the channel's upper edge
        [[m, mLeft]], // trunk 3's foot, level out to its end node
        [[i, h, c, signalIn], true], // the signal: up trunk 2, across trunk 1, into the channel
      ],
      [a, b, e, f, g, j, l, m, eDown, mLeft],
      [i, h, c],
      [toChannel, signalIn, fIn, lIn],
    );
  }
  const t1 = [1900, 2200, 2450, 2650, 2950].map((y) => on(inner, y));
  const t2 = [2050, 2450, 2800].map((y) => on(outer, y));
  const t3 = [1500, 1800, 2300].map((y) => on(ground, y));
  const [a, b, c, e, f] = t1 as [Pt, Pt, Pt, Pt, Pt];
  const [g, h, i] = t2 as [Pt, Pt, Pt];
  const [j, l, m] = t3 as [Pt, Pt, Pt];
  const eDown: Pt = [e[0], e[1] + 150];
  const mLeft: Pt = [m[0] - 300, m[1]];
  const toChannel = edge(lower, b[1]);
  const signalIn = edge(lower, h[1]);
  const fIn = edge(lower, f[1]);
  const lIn = edge(upper, l[1]);
  return net(
    [
      [[a, b, c, e, f]],
      [[g, h]],
      [[j, l, m]],
      [[b, toChannel]],
      [[e, eDown]],
      [[f, fIn]],
      [[l, lIn]],
      [[m, mLeft]],
      [[i, h, c, signalIn], true],
    ],
    [a, b, e, f, g, j, l, m, eDown, mLeft],
    [i, h, c],
    [toChannel, signalIn, fIn, lIn],
  );
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

/**
 * The channel dimension in the drawing's own coordinates (the mark's top-left corner = 0, 0): its two ends `a` (on
 * the bar-end cut, x + y = barEnd) and `b` (on the stem cut, x + y = S), and the tick half-length along (1, -1).
 */
function channelDimension(format: Format): { a: Pt; b: Pt; tick: number } {
  const u = CONSTRUCTION[format].unit;
  const m = fitMark(100 * u);
  const S = m.size;
  const s = (S - m.barEnd) / 2; // the run along (1, 1) from one cut to the other
  const my = -Math.round(0.8 * 19 * u); // inside the clear space above the mark
  const mx = (m.barEnd + S) / 2 - my;
  return { a: [mx - s / 2, my - s / 2], b: [mx + s / 2, my + s / 2], tick: 1.5 * u };
}

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
  const { a, b, tick: t } = channelDimension(format);
  const seg = ([x1, y1]: [number, number], [x2, y2]: [number, number]) =>
    `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`;
  const tick = ([x, y]: [number, number]) => seg([x - t, y + t], [x + t, y - t]);
  parts.push(
    `<path d="${seg(a, b)}${tick(a)}${tick(b)}" fill="none" stroke="${TONE.dimension}" stroke-width="${HAIR}"/>`,
  );
  // The network: the mark wired to its own clear space.
  parts.push(drawNetwork(markNetwork(format), constructionNodeSize(format)));
  return frame(format, at(x0, y0, parts.join("")));
}

/**
 * The Construction's network, in the drawing's own coordinates (the mark's top-left corner = 0, 0), routed on the
 * 100-unit grid like a board around the mark:
 * - a bus 10 units below the mark, and side buses 10 units out to the left and the right
 * - drops from the bus into the shared stem's foot and the right stem's foot (centred on each stem)
 * - feeds from the left bus into the stem's side (at 60) and the bar's end (at 10)
 * - the right bus climbs to 10 and turns 45° into the stem-cut tip; a short spur leaves the tip along the cut and
 *   stops at 5, clear of the channel dimension's tick (which sits on the same cut, further out)
 * Desktop: the signal enters at the clear space's lower-right corner, runs up the right bus and arrives in the right
 * stem (the accent). Phone (recomposed for the tall frame): the signal rises from below the drawing into the bus and
 * up into the right stem's foot; the left bus reaches further up.
 */
function markNetwork(format: Format): Network {
  const u = CONSTRUCTION[format].unit;
  const m = fitMark(100 * u);
  const U = (n: number) => Math.round(n * u);
  const P = (x: number, y: number): Pt => [U(x), U(y)];
  const stem = Math.round((m.s1 + m.s2) / 2);
  const right = Math.round((m.rx + m.size) / 2);
  const S = m.size;
  const bus = U(110);
  const stemDrop: Pt[] = [
    [stem, S],
    [stem, bus],
  ];
  const rightFoot: Pt = [right, S];
  const rightBus: Pt = [right, bus];
  const stemBus: Pt = [stem, bus];
  const sideIn: Pt = [m.s1, U(60)];
  const barIn: Pt = [0, U(10)];
  const tip: Pt = [S, 0];
  if (format === "desktop") {
    const corner = P(119, 119);
    const rb = P(110, 110);
    return net(
      [
        [[P(-10, 110), stemBus, P(60, 110), rightBus, rb]], // the bus
        [stemDrop],
        [[rightBus, rightFoot]],
        [[P(-10, 110), P(-10, 60), P(-10, 10), P(-10, -10), P(-15, -15)]], // the left bus, out to the corner
        [[P(-10, 60), sideIn]],
        [[P(-10, 10), barIn]],
        [[P(110, 50), P(110, 10), tip]], // the right bus, turning 45° into the tip
        [[tip, P(105, -5)]], // a short spur along the cut, stopping before the dimension
        [[corner, rb, P(110, 80), P(110, 50), [S, U(50)]], true], // the signal, arriving in the right stem
      ],
      [
        P(-10, 110),
        stemBus,
        P(60, 110),
        rightBus,
        P(-10, 60),
        P(-10, 10),
        P(-15, -15),
        P(110, 10),
        tip,
        P(105, -5),
      ],
      [corner, rb, P(110, 80), P(110, 50)],
      [[stem, S], rightFoot, sideIn, barIn, [S, U(50)]],
    );
  }
  const below = P(60, 135);
  const mid = P(60, 110);
  return net(
    [
      [[P(-10, 110), stemBus, mid]], // the bus, left part
      [[rightBus, P(110, 110), P(110, 50), P(110, 10), tip]], // right part, the right bus and its turn into the tip
      [stemDrop],
      [[P(-10, 110), P(-10, 60), P(-10, 10), P(-10, -30)]], // the left bus, reaching up
      [[P(-10, 60), sideIn]],
      [[P(-10, 10), barIn]],
      [[P(110, 50), [S, U(50)]]],
      [[tip, P(105, -5)]], // a short spur along the cut, stopping before the dimension
      [[below, mid, rightBus, rightFoot], true], // the signal, rising into the right stem's foot
    ],
    [
      P(-10, 110),
      stemBus,
      P(110, 110),
      P(110, 50),
      P(110, 10),
      tip,
      P(-10, 60),
      P(-10, 10),
      P(-10, -30),
      P(105, -5),
    ],
    [below, mid, rightBus],
    [[stem, S], rightFoot, sideIn, barIn, [S, U(50)]],
  );
}

/** The Construction's node size in px (a square, its top-left corner cut). */
export const constructionNodeSize = (format: Format) => 2 * Math.round(1.2 * CONSTRUCTION[format].unit);

/** The Construction's channel dimension in frame coordinates: its two ends and the tick half-length. */
export function wallpaperDimension(format: Format): { a: Pt; b: Pt; tick: number } {
  const p = CONSTRUCTION[format];
  const S = 100 * p.unit;
  const { a, b, tick } = channelDimension(format);
  const dx = p.centre[0] - S / 2;
  const dy = p.centre[1] - S / 2;
  return { a: [a[0] + dx, a[1] + dy], b: [b[0] + dx, b[1] + dy], tick };
}

/** The size in px of the mark a wallpaper draws (filled on the Monolith, traced on the Construction; none on Cut). */
export function wallpaperMarkSize(concept: Concept, format: Format): number | undefined {
  if (concept === "monolith") return MONOLITH[format].size;
  if (concept === "construction") return 100 * CONSTRUCTION[format].unit;
  return undefined;
}

/** The node network drawn on a wallpaper, in frame coordinates (none on the Monolith). */
export function wallpaperNetwork(concept: Concept, format: Format): Network {
  if (concept === "cut") return cutNetwork(format);
  if (concept === "construction") {
    const p = CONSTRUCTION[format];
    const S = 100 * p.unit;
    return shiftNet(markNetwork(format), p.centre[0] - S / 2, p.centre[1] - S / 2);
  }
  return { wires: [], nodes: [], anchors: [] };
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
    // where the signal crosses the inner trunk and arrives at the channel; a junction with its branch
    const net = cutNetwork(format);
    const crossing = net.nodes.filter((n) => n.signal).at(-1)?.at ?? [0, 0];
    const junction = net.nodes[2]?.at ?? [0, 0];
    return [crossing, junction].map(([x, y]) => ({ x, y }));
  }
  const p = CONSTRUCTION[format];
  const m = fitMark(100 * p.unit);
  const x0 = p.centre[0] - m.size / 2;
  const y0 = p.centre[1] - m.size / 2;
  // the signal's arrival and the bus under the stems
  const u = p.unit;
  return [
    { x: x0 + m.size + 5 * u, y: y0 + (format === "desktop" ? 70 * u : 105 * u) },
    { x: x0 + 20 * u, y: y0 + 105 * u },
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
