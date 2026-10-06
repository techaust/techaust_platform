// Composes every lockup, colour version and layout from brand/source/techaust-master.svg (pure string functions).
import { resolveColor, tokens } from "../tokens/model.ts";
import { LOCKUP, pixelMark } from "./geometry.ts";

export type Line = { d: string; width: number };
export type Master = {
  markBase: string;
  markAccent: string;
  glyphs: string[];
  wordWidth: number;
  viewBox: number[];
  lines: Record<string, Line>;
};

function pathById(svg: string, id: string): string {
  const d = new RegExp(`<path id="${id}"[^>]*? d="([^"]+)"`).exec(svg)?.[1];
  if (!d) throw new Error(`master.svg: #${id} not found`);
  return d;
}

export function parseMaster(svg: string): Master {
  const glyphs = [...svg.matchAll(/<path id="glyph-[^"]+" d="([^"]+)"/g)].map((m) => m[1] ?? "");
  const viewBox = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  const lines: Record<string, Line> = {};
  for (const m of svg.matchAll(/<path id="([a-zA-Z]+)" data-width="([\d.]+)" display="none" d="([^"]+)"/g))
    lines[m[1] ?? ""] = { width: Number(m[2]), d: m[3] ?? "" };
  const wx = 100 * LOCKUP.markScale + LOCKUP.gap;
  return {
    markBase: pathById(svg, "mark-base"),
    markAccent: pathById(svg, "mark-accent"),
    glyphs,
    wordWidth: Math.round(((viewBox[2] ?? 0) - wx) * 100) / 100,
    viewBox,
    lines,
  };
}

export const color = (k: string) => resolveColor(k, tokens).toUpperCase();
/** Colour versions. base = the T and shared stem, accent = the H's crossbar and right stem, text = wordmark. */
export const SCHEMES = {
  color: {
    base: color("ink-900"),
    accent: color("verdigris-700"),
    text: color("ink-900"),
    label: "full colour, on light",
  },
  dark: {
    base: color("mist"),
    accent: color("verdigris-300"),
    text: color("mist"),
    label: "full colour, on dark",
  },
  ink: { base: color("ink-900"), accent: color("ink-900"), text: color("ink-900"), label: "one colour, ink" },
  white: { base: color("white"), accent: color("white"), text: color("white"), label: "one colour, white" },
  black: { base: color("black"), accent: color("black"), text: color("black"), label: "one colour, black" },
} as const;
export type SchemeName = keyof typeof SCHEMES;
export type Scheme = { base: string; accent: string; text: string };
export type LockupName = "primary" | "stacked" | "wordmark" | "symbol";
type Paths = { base: string; accent: string };
type Colours = { base: string; accent: string };

/** Something placed on a scene canvas. Lines are positioned by the top of their caps; `cap` is in px. */
export type SceneItem =
  | { kind: "lockup"; lockup: LockupName; scheme: SchemeName; x: number; y: number; width: number }
  | { kind: "line"; id: string; x: number; y: number; cap: number; fill: string; align?: "left" | "right" }
  | { kind: "mark"; x: number; y: number; size: number; base: string; accent: string };

const TITLE = "TecHaust Technologies";
const STACK = { markSize: 168, gap: 44 }; // stacked lockup: mark above the wordmark, centred
const r = (n: number) => Math.round(n * 100) / 100;
const scale = (n: number) => Math.round(n * 10000) / 10000;

export type Brand = ReturnType<typeof createBrand>;

export function createBrand(m: Master) {
  const vector: Paths = { base: m.markBase, accent: m.markAccent };
  const mark = (k: Colours, p: Paths = vector) =>
    `<path fill="${k.base}" d="${p.base}"/><path fill="${k.accent}" d="${p.accent}"/>`;
  const word = (k: Scheme) => `<g fill="${k.text}">${m.glyphs.map((d) => `<path d="${d}"/>`).join("")}</g>`;

  const layouts: Record<LockupName, { viewBox: number[]; body: (k: Scheme) => string }> = {
    primary: {
      viewBox: m.viewBox,
      body: (k) =>
        `<g transform="translate(0 ${LOCKUP.markY}) scale(${LOCKUP.markScale})">${mark(k)}</g>` +
        `<g transform="translate(${r(100 * LOCKUP.markScale + LOCKUP.gap)} 0)">${word(k)}</g>`,
    },
    stacked: {
      viewBox: [0, 0, m.wordWidth, STACK.markSize + STACK.gap + 102],
      body: (k) =>
        `<g transform="translate(${r((m.wordWidth - STACK.markSize) / 2)} 0) scale(${STACK.markSize / 100})">${mark(k)}</g>` +
        `<g transform="translate(0 ${STACK.markSize + STACK.gap})">${word(k)}</g>`,
    },
    wordmark: { viewBox: [0, 0, m.wordWidth, 102], body: (k) => word(k) },
    symbol: { viewBox: [0, 0, 100, 100], body: (k) => mark(k) },
  };
  const box = (l: LockupName) => layouts[l].viewBox as [number, number, number, number];

  /** A standalone SVG for one lockup + scheme. `width` sets the pixel size (for rasterising). */
  function lockupSvg(lockup: LockupName, scheme: SchemeName | Scheme, opts: { width?: number } = {}): string {
    const k = typeof scheme === "string" ? SCHEMES[scheme] : scheme;
    const [x, y, w, h] = box(lockup);
    const size = opts.width ? ` width="${opts.width}" height="${Math.round((opts.width * h) / w)}"` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${size} role="img" aria-label="${TITLE}">` +
      `<title>${TITLE}</title>${layouts[lockup].body(k)}</svg>\n`
    );
  }

  /** favicon.svg: drawn on a 16-unit pixel grid (crisp at 16 and 32 px), switching colours in a dark browser. */
  function faviconSvg(): string {
    const L = SCHEMES.color;
    const D = SCHEMES.dark;
    const p = pixelMark(16);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><title>${TITLE}</title>` +
      `<style>.b{fill:${L.base}}.a{fill:${L.accent}}@media (prefers-color-scheme:dark){.b{fill:${D.base}}.a{fill:${D.accent}}}</style>` +
      `<path class="b" d="${p.base}"/><path class="a" d="${p.accent}"/></svg>\n`
    );
  }

  /**
   * The profile / app icon: the mark (dark colours) on an ink tile. `radius` 0 = full bleed (iOS, maskable).
   * At 64 px and below the mark is pixel-fitted and sits on whole pixels.
   */
  function tileSvg(size: number, opts: { radius: number; markRatio: number }): string {
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>${TITLE}</title>`;
    const bg = `<rect width="${size}" height="${size}" rx="${r(size * opts.radius)}" fill="${color("ink-900")}"/>`;
    if (size <= 64) {
      const px = Math.round((size * opts.markRatio) / 2) * 2; // even, so it centres on whole pixels
      const off = (size - px) / 2;
      return `${head}${bg}<g transform="translate(${off} ${off})">${mark(SCHEMES.dark, pixelMark(px))}</g></svg>\n`;
    }
    const s = (size * opts.markRatio) / 100;
    const off = (size - 100 * s) / 2;
    return `${head}${bg}<g transform="translate(${r(off)} ${r(off)}) scale(${r(s)})">${mark(SCHEMES.dark)}</g></svg>\n`;
  }

  function item(it: SceneItem): string {
    if (it.kind === "lockup") {
      const [x, y, w] = box(it.lockup);
      const s = it.width / w;
      return `<g transform="translate(${r(it.x - x * s)} ${r(it.y - y * s)}) scale(${scale(s)})">${layouts[it.lockup].body(SCHEMES[it.scheme])}</g>`;
    }
    if (it.kind === "mark")
      return `<g transform="translate(${r(it.x)} ${r(it.y)}) scale(${scale(it.size / 100)})">${mark(it)}</g>`;
    const line = m.lines[it.id];
    if (!line) throw new Error(`master.svg: line #${it.id} not found`);
    const s = it.cap / 100;
    const x = it.align === "right" ? it.x - line.width * s : it.x;
    return `<path fill="${it.fill}" transform="translate(${r(x)} ${r(it.y)}) scale(${scale(s)})" d="${line.d}"/>`;
  }

  /** A composed canvas: background, then items in order (banners, link previews, email badge). */
  function scene(width: number, height: number, background: string, items: SceneItem[], radius = 0): string {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${TITLE}</title>` +
      `<rect width="${width}" height="${height}" rx="${radius}" fill="${background}"/>${items.map(item).join("")}</svg>`
    );
  }

  return {
    lockupSvg,
    faviconSvg,
    tileSvg,
    scene,
    lineWidth: (id: string, cap: number) => ((m.lines[id]?.width ?? 0) * cap) / 100,
    lockupHeight: (l: LockupName, width: number) => (width * box(l)[3]) / box(l)[2],
    markPaths: vector,
    glyphs: m.glyphs,
    lines: m.lines,
    viewBox: m.viewBox,
  };
}
