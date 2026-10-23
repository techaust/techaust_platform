// Share images, Node-only half (M2.5, WEB-OG): sets a page's title and category as outlines (HarfBuzz, the brand
// fonts), wraps the title and rasterises src/brand/og.ts's layout with sharp. Used by apps/web's build step
// (scripts/build-og.mjs, after `astro build`) and by tests; never by an app bundle. Fonts: Archivo Expanded (the site's
// headings and the strapline: weight 560, width 116) for the title, IBM Plex Mono for the category; the lockup and the
// domain come from brand/source/techaust-master.svg, like every other brand file.
//
// Title rule (the brief: at most three lines, then a shorter fallback):
//   1. the whole title, at the first step of TITLE_STEPS where it fits: large on one or two lines, then three lines
//      at 50, then three at 44; lines are balanced (no long line over a lone last word), preferring a break after ":"
//      or ",", and never wider than OG_FRAME.textWidth;
//   2. else the part before the first ": " (the titles' own short form, "How we work: process…" → "How we work"),
//      under the same rule;
//   3. else as many whole words as fit in three lines (in practice at the smallest size), ending with an ellipsis.
// A character the fonts lack still fails (it would print as an empty box).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createBrand, parseMaster } from "./compose.ts";
import { WORDMARK } from "./geometry.ts";
import { OG_FRAME, OG_SIZE, ogSvg } from "./og.ts";
import { createOutliner } from "./outline-set.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(root, "package.json"));

/**
 * Title sizes (cap height in px) and the most lines allowed at each, tried in order. Three lines at 50 read calmer than
 * two long lines at 44; the smallest still reads at 600 × 315 (a 22 px cap there).
 */
export const TITLE_STEPS = [
  { cap: 64, lines: 2 },
  { cap: 56, lines: 2 },
  { cap: 50, lines: 2 },
  { cap: 50, lines: 3 },
  { cap: 44, lines: 2 },
  { cap: 44, lines: 3 },
] as const;
export const MAX_TITLE_LINES = 3;
/** Category: cap height and tracking (font units), as the site's eyebrow (uppercase, tracked). */
const CATEGORY = { cap: 20, tracking: 90 } as const;
/** A break right after one of these is a phrase boundary; each such break is worth this share of the line width. */
const PHRASE_END = /[:,]$/;
const PHRASE_BONUS = 0.12;
/** A one-word last line shorter than this share of the longest line is a widow. */
const WIDOW_RATIO = 0.4;
const ELLIPSIS = "…";

export type OgText = { title: string; category: string };
export type OgLayout = { lines: string[]; cap: number; fallback: "none" | "before-colon" | "ellipsis" };

export async function createOgRenderer() {
  const brand = createBrand(
    parseMaster(readFileSync(join(root, "brand/source/techaust-master.svg"), "utf8")),
  );
  const title = await createOutliner(require.resolve(WORDMARK.font), { wght: 560, wdth: 116 });
  const mono = await createOutliner(
    require.resolve("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"),
    {},
  );
  const TRACKING = -4; // font units, as the strapline (geometry.ts TYPE_LINES)
  const widths = new Map<string, number>();
  const measure = (s: string, cap: number) => {
    const key = `${cap}\u0000${s}`;
    let w = widths.get(key);
    if (w === undefined) {
      w = title(s, { cap, tracking: TRACKING }).width;
      widths.set(key, w);
    }
    return w;
  };

  /** A lone short word on the last line, under a much longer line. */
  const widow = (lines: string[], cap: number) => {
    const last = lines[lines.length - 1] ?? "";
    if (lines.length < 2 || /\s/.test(last)) return false;
    return measure(last, cap) < WIDOW_RATIO * Math.max(...lines.map((l) => measure(l, cap)));
  };

  /**
   * The best split of `words` into exactly `n` lines that each fit, at one size: the smallest widest line, less
   * PHRASE_BONUS for each break after ":" or "," (the title's own phrasing), so lines come out balanced and break where
   * the sentence does. Null when no split fits.
   */
  function split(words: string[], n: number, cap: number): string[] | null {
    let best: { lines: string[]; cost: number } | null = null;
    const go = (start: number, left: number, acc: string[]) => {
      if (left === 1) {
        const last = words.slice(start).join(" ");
        if (!last || measure(last, cap) > OG_FRAME.textWidth) return;
        const lines = [...acc, last];
        const phraseBreaks = acc.filter((l) => PHRASE_END.test(l)).length;
        const cost =
          Math.max(...lines.map((l) => measure(l, cap))) - phraseBreaks * PHRASE_BONUS * OG_FRAME.textWidth;
        if (!best || cost < best.cost) best = { lines, cost };
        return;
      }
      for (let end = start + 1; end <= words.length - (left - 1); end++) {
        const line = words.slice(start, end).join(" ");
        if (measure(line, cap) > OG_FRAME.textWidth) break;
        go(end, left - 1, [...acc, line]);
      }
    };
    go(0, n, []);
    return (best as { lines: string[] } | null)?.lines ?? null;
  }

  /**
   * Rule 1: the first step of TITLE_STEPS where the text fits (the fewest lines at that size) without a widow; if every
   * step leaves one, the first step that fits at all. Null when no step fits.
   */
  const wrapRule = (text: string): { lines: string[]; cap: number } | null => {
    const words = text.split(/\s+/).filter(Boolean);
    let withWidow: { lines: string[]; cap: number } | null = null;
    for (const step of TITLE_STEPS) {
      for (let n = 1; n <= Math.min(step.lines, words.length); n++) {
        const lines = split(words, n, step.cap);
        if (!lines) continue;
        if (!widow(lines, step.cap)) return { lines, cap: step.cap };
        withWidow ??= { lines, cap: step.cap };
      }
    }
    return withWidow;
  };

  /** How a title is set (exported for tests and the build log). */
  function layout(text: string): OgLayout {
    const full = wrapRule(text);
    if (full) return { ...full, fallback: "none" };
    const colon = text.indexOf(": ");
    if (colon > 0) {
      const short = wrapRule(text.slice(0, colon));
      if (short) return { ...short, fallback: "before-colon" };
    }
    const words = text.split(/\s+/).filter(Boolean);
    // Start from what a greedy fill of three lines holds at the smallest size (nothing longer can fit), not from every
    // word: the answer is the same, found in a few tries instead of one per word.
    const last = TITLE_STEPS[TITLE_STEPS.length - 1];
    let upper = 0;
    for (let line = 0, used = 0; line < MAX_TITLE_LINES && upper < words.length; line++, used = 0) {
      let text = "";
      while (upper < words.length) {
        const next = text ? `${text} ${words[upper]}` : (words[upper] ?? "");
        if (used > 0 && measure(next, last.cap) > OG_FRAME.textWidth) break;
        text = next;
        used++;
        upper++;
      }
    }
    for (let k = Math.min(words.length - 1, upper); k >= 1; k--) {
      const kept = words
        .slice(0, k)
        .join(" ")
        .replace(/[\s,:;.]+$/, "");
      const lines = wrapRule(`${kept}${ELLIPSIS}`);
      if (lines) return { ...lines, fallback: "ellipsis" };
    }
    throw new Error(`share image: a single word of the title is too wide for one line: "${text}"`);
  }

  /** The SVG for a page. */
  function svg({ title: text, category }: OgText): string {
    const { lines, cap } = layout(text);
    return ogSvg({
      brand,
      titleLines: lines.map((l) => title(l, { cap, tracking: TRACKING })),
      category: mono(category.toUpperCase(), CATEGORY),
    });
  }

  async function png(text: OgText): Promise<Buffer> {
    return sharp(Buffer.from(svg(text)), { density: 72 })
      .resize(OG_SIZE.width, OG_SIZE.height)
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
  }

  return { svg, png, layout };
}

export type OgRenderer = Awaited<ReturnType<typeof createOgRenderer>>;
