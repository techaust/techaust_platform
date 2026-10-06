// Composes every lockup + colour version from brand/source/techaust-master.svg (pure string functions).
import { resolveColor, tokens } from "../tokens/model.ts";
import { LOCKUP } from "./geometry.ts";

export type Master = {
  markBase: string;
  markAccent: string;
  glyphs: string[];
  wordWidth: number;
  viewBox: number[];
};

function pathById(svg: string, id: string): string {
  const d = new RegExp(`<path id="${id}"[^>]*? d="([^"]+)"`).exec(svg)?.[1];
  if (!d) throw new Error(`master.svg: #${id} not found`);
  return d;
}

export function parseMaster(svg: string): Master {
  const glyphs = [...svg.matchAll(/<path id="glyph-[^"]+" d="([^"]+)"/g)].map((m) => m[1] ?? "");
  const viewBox = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  const wx = 100 * LOCKUP.markScale + LOCKUP.gap;
  return {
    markBase: pathById(svg, "mark-base"),
    markAccent: pathById(svg, "mark-accent"),
    glyphs,
    wordWidth: Math.round(((viewBox[2] ?? 0) - wx) * 100) / 100,
    viewBox,
  };
}

const c = (k: string) => resolveColor(k, tokens).toUpperCase();
/** Colour versions. base = the T and shared stem, accent = the H's crossbar and right stem, text = wordmark. */
export const SCHEMES = {
  color: {
    base: c("ink-900"),
    accent: c("verdigris-700"),
    text: c("ink-900"),
    label: "full colour, on light",
  },
  dark: { base: c("mist"), accent: c("verdigris-300"), text: c("mist"), label: "full colour, on dark" },
  ink: { base: c("ink-900"), accent: c("ink-900"), text: c("ink-900"), label: "one colour, ink" },
  white: { base: c("white"), accent: c("white"), text: c("white"), label: "one colour, white" },
  black: { base: c("black"), accent: c("black"), text: c("black"), label: "one colour, black" },
} as const;
export type SchemeName = keyof typeof SCHEMES;
export type Scheme = { base: string; accent: string; text: string };
export type LockupName = "primary" | "stacked" | "wordmark" | "symbol";

const TITLE = "TecHaust Technologies";
const STACK = { markSize: 168, gap: 44 }; // stacked lockup: mark above the wordmark, centred

export type Brand = ReturnType<typeof createBrand>;

export function createBrand(m: Master) {
  const mark = (k: Scheme) =>
    `<path fill="${k.base}" d="${m.markBase}"/><path fill="${k.accent}" d="${m.markAccent}"/>`;
  const word = (k: Scheme) => `<g fill="${k.text}">${m.glyphs.map((d) => `<path d="${d}"/>`).join("")}</g>`;
  const r = (n: number) => Math.round(n * 100) / 100;

  const layouts: Record<LockupName, { viewBox: number[]; body: (k: Scheme) => string }> = {
    primary: {
      viewBox: m.viewBox,
      body: (k) =>
        `<g transform="translate(0 ${LOCKUP.markY}) scale(${LOCKUP.markScale})">${mark(k)}</g>` +
        `<g transform="translate(${100 * LOCKUP.markScale + LOCKUP.gap} 0)">${word(k)}</g>`,
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

  /** A standalone SVG for one lockup + scheme. `width` sets the pixel size (for rasterising). */
  function lockupSvg(lockup: LockupName, scheme: SchemeName | Scheme, opts: { width?: number } = {}): string {
    const k = typeof scheme === "string" ? SCHEMES[scheme] : scheme;
    const [x, y, w, h] = layouts[lockup].viewBox as [number, number, number, number];
    const size = opts.width ? ` width="${opts.width}" height="${Math.round((opts.width * h) / w)}"` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${size} role="img" aria-label="${TITLE}">` +
      `<title>${TITLE}</title>${layouts[lockup].body(k)}</svg>\n`
    );
  }

  /** favicon.svg: the symbol, switching to its dark colours when the browser UI is dark. */
  function faviconSvg(): string {
    const L = SCHEMES.color;
    const D = SCHEMES.dark;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>${TITLE}</title>` +
      `<style>.b{fill:${L.base}}.a{fill:${L.accent}}@media (prefers-color-scheme:dark){.b{fill:${D.base}}.a{fill:${D.accent}}}</style>` +
      `<path class="b" d="${m.markBase}"/><path class="a" d="${m.markAccent}"/></svg>\n`
    );
  }

  /** The profile / app icon: the mark (dark colours) on an ink tile. `radius` 0 = full bleed (iOS, maskable). */
  function tileSvg(size: number, opts: { radius: number; markRatio: number }): string {
    const s = (size * opts.markRatio) / 100;
    const off = (size - 100 * s) / 2;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>${TITLE}</title>` +
      `<rect width="${size}" height="${size}" rx="${r(size * opts.radius)}" fill="${c("ink-900")}"/>` +
      `<g transform="translate(${r(off)} ${r(off)}) scale(${r(s)})">${mark(SCHEMES.dark)}</g></svg>\n`
    );
  }

  /** A lockup placed on a solid canvas (OG images, banners). Centred unless `x` is given. */
  function onCanvas(
    lockup: LockupName,
    scheme: SchemeName,
    canvas: {
      width: number;
      height: number;
      background: string;
      contentWidth: number;
      extra?: string;
      x?: number;
    },
  ): string {
    const [, , w, h] = layouts[lockup].viewBox as [number, number, number, number];
    const cw = canvas.contentWidth;
    const ch = (cw * h) / w;
    const x = canvas.x ?? (canvas.width - cw) / 2;
    const inner = lockupSvg(lockup, scheme).replace(
      "<svg ",
      `<svg x="${r(x)}" y="${r((canvas.height - ch) / 2)}" width="${cw}" height="${r(ch)}" `,
    );
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">` +
      `<rect width="100%" height="100%" fill="${canvas.background}"/>${canvas.extra ?? ""}${inner}</svg>`
    );
  }

  return { lockupSvg, faviconSvg, tileSvg, onCanvas, markPaths: [m.markBase, m.markAccent] as const };
}
