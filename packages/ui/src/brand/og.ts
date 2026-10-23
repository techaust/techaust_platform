// The share image of a page (1200 × 630, M2.5 WEB-OG), pure: places outlined text on the frame of the approved link
// preview (brand/og-default.png, files.ts): a stone ground, the primary lockup top left, the mark very large and
// tone-on-tone bleeding off the right edge, the domain at the foot. In place of the strapline: the page's category
// (IBM Plex Mono, verdigris, as the site's eyebrow) above its title (Archivo Expanded, ink). The title is anchored on the
// strapline's last baseline and grows upwards, so a one-line and a three-line title end on the same line. Light only:
// one image per page. The Node-only step (og-render.ts) sets and wraps the text; this file only places it.
import { type Brand, color } from "./compose.ts";
import type { Outlined } from "./outline-set.ts";

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The frame of og-default (the same numbers as its layout in files.ts): margin, lockup, watermark, domain line. */
export const OG_FRAME = {
  margin: 96,
  lockup: { y: 92, width: 290 },
  watermark: { x: 712, y: -34, size: 600 },
  /** The title's last baseline: where og-default's strapline ends (its second line's caps 380–440). */
  baseline: 440,
  domain: { y: 520, cap: 22 },
  /**
   * The widest a title line may be. It may cross the tone-on-tone mark, as the strapline does, but stops well short of
   * the edge (og-default's longest line ends near x = 955), so no line crowds the right side.
   */
  textWidth: 940,
} as const;

/** Line pitch as a multiple of the cap height (og-default: cap 60, lines 80 apart). */
export const OG_PITCH = 4 / 3;
/** Gap between the category's baseline and the first title line's cap top, as a multiple of the title's cap height. */
const CATEGORY_GAP = 0.62;

export type OgInput = {
  /** The composed brand (lockup, mark, outlined domain line) from brand/source/techaust-master.svg. */
  brand: Pick<Brand, "scene">;
  /** The title, already wrapped (one to three lines), all at one cap height; pen origin left, baseline at y = cap. */
  titleLines: readonly Outlined[];
  /** The page's category (Services, Industries, Company, Blog, Legal, Pricing), outlined in IBM Plex Mono. */
  category: Outlined;
};

const r = (n: number) => Math.round(n * 100) / 100;

/** One outlined line with its pen origin at x and its cap top at y. */
const place = (l: Outlined, x: number, y: number, fill: string): string =>
  `<g fill="${fill}" transform="translate(${r(x)} ${r(y)})">${l.glyphs.map((d) => `<path d="${d}"/>`).join("")}</g>`;

/** Cap top of each title line: bottom-anchored on OG_FRAME.baseline. */
export function titleTops(lines: number, cap: number): number[] {
  const pitch = Math.round(cap * OG_PITCH);
  const last = OG_FRAME.baseline - cap;
  return Array.from({ length: lines }, (_, i) => last - (lines - 1 - i) * pitch);
}

export function ogSvg(input: OgInput): string {
  const { width, height } = OG_SIZE;
  const { margin, lockup, watermark, domain } = OG_FRAME;
  const stone = color("stone-200");
  const base = input.brand.scene(width, height, color("stone-50"), [
    { kind: "mark", ...watermark, base: stone, accent: stone },
    { kind: "lockup", lockup: "primary", scheme: "color", x: margin, y: lockup.y, width: lockup.width },
    { kind: "line", id: "domain", x: margin, y: domain.y, cap: domain.cap, fill: color("ink-400") },
  ]);
  const lines = input.titleLines;
  if (lines.length === 0) throw new Error("share image: no title");
  const cap = lines[0]?.cap ?? 0;
  const tops = titleTops(lines.length, cap);
  const firstTop = tops[0] ?? 0;
  const categoryTop = firstTop - Math.round(cap * CATEGORY_GAP) - input.category.cap;
  const text = [
    place(input.category, margin, categoryTop, color("verdigris-700")),
    ...lines.map((l, i) => place(l, margin, tops[i] ?? 0, color("ink-900"))),
  ].join("");
  if (!base.endsWith("</svg>")) throw new Error("share image: unexpected scene output");
  return `${base.slice(0, -"</svg>".length)}${text}</svg>\n`;
}
