// The share image of a page (1200 × 630, M2.5 WEB-OG): a pure layout from outlined text. The Node-only step
// (og-render.ts) sets the title, the category and the domain as outlines and wraps the title; this file only places
// them and draws the mark from the brand geometry. PLACEHOLDER layout (ink ground, the mark, category, title, domain):
// the designer replaces it in M2.5 step 2b, keeping the input shape and the 1200 × 630 size.
import { color, SCHEMES } from "./compose.ts";
import type { Outlined } from "./outline-set.ts";
import { fitMark } from "./wallpapers.ts";

export const OG_SIZE = { width: 1200, height: 630 } as const;

export type OgInput = {
  /** The title, already wrapped: one outlined line each, left to right from the pen origin. */
  titleLines: readonly Outlined[];
  /** The page's category (Services, Industries, Company, Blog, Legal, Pricing), outlined in IBM Plex Mono. */
  category: Outlined;
  /** "techaust.com", outlined. */
  domain: Outlined;
};

const MARGIN = 80;
const LEADING = 1.45;

/** One outlined line with its pen origin at x and its cap top at y. */
const place = (l: Outlined, x: number, y: number, fill: string): string =>
  `<g fill="${fill}" transform="translate(${x} ${y})">${l.glyphs.map((d) => `<path d="${d}"/>`).join("")}</g>`;

export function ogSvg(input: OgInput): string {
  const { width, height } = OG_SIZE;
  const k = SCHEMES.dark;
  const mark = fitMark(72);
  const ground = color("ink-900");
  const parts = [
    `<rect width="${width}" height="${height}" fill="${ground}"/>`,
    `<g transform="translate(${MARGIN} ${MARGIN})"><path fill="${k.base}" d="${mark.fill.base}"/><path fill="${k.accent}" d="${mark.fill.accent}"/></g>`,
    place(input.category, MARGIN, 200, color("verdigris-300")),
  ];
  let y = 252;
  for (const line of input.titleLines) {
    parts.push(place(line, MARGIN, y, k.text));
    y += Math.round(line.cap * LEADING);
  }
  parts.push(place(input.domain, MARGIN, height - MARGIN - input.domain.cap, color("ink-300")));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>\n`;
}
