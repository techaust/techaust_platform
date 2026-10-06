// Self-hosted web fonts (SIL OFL 1.1). Source files come from the pinned @fontsource packages;
// scripts/build-fonts.ts subsets them into packages/ui/fonts/ and writes generated/fonts.css.

export type Range = readonly [number, number];

/** Latin + Latin-1 + the punctuation we actually typeset. Not in these fonts, so never typeset:
 * → (U+2192: use Lucide arrow icons, docs/06 §4.5), thin and narrow no-break spaces (U+2009, U+202F:
 * the en-IN / en-US number formats we use don't produce them). */
export const MAIN_RANGES: readonly Range[] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2013, 0x2014], // – —
  [0x2018, 0x2019], // ‘ ’
  [0x201c, 0x201d], // “ ”
  [0x2022, 0x2022], // •
  [0x2026, 0x2026], // …
  [0x20ac, 0x20ac], // €
  [0x2122, 0x2122], // ™
  [0x2212, 0x2212], // − (minus)
];

/** The rupee sign lives in each family's latin-ext file, so it ships as a tiny second file
 * that the browser loads only on pages that contain ₹ (unicode-range). */
export const RUPEE_RANGES: readonly Range[] = [[0x20b9, 0x20b9]];

export type FaceFile = { suffix: "latin" | "rupee"; source: string; ranges: readonly Range[] };
/** A metric-matched fallback face: Arial resized to the web font's metrics at one instance (no layout shift). */
export type MetricFallback = { family: string; local: string; instance: Record<string, number> };
export type Face = {
  id: string;
  family: string;
  weight: string;
  stretch?: string;
  display: "swap" | "optional";
  axes?: Record<string, number | { min: number; max: number }>;
  files: readonly FaceFile[];
  fallbacks?: readonly MetricFallback[];
};

const fs = (pkg: string, file: string) => `${pkg}/files/${file}`;

export const FACES: readonly Face[] = [
  {
    // One family for everything: Expanded (116 %) for the wordmark and headings, Normal (100 %) for text.
    id: "archivo",
    family: "Archivo",
    weight: "400 600",
    stretch: "100% 116%",
    display: "swap",
    axes: { wght: { min: 400, max: 600 }, wdth: { min: 100, max: 116 } },
    files: [
      {
        suffix: "latin",
        source: fs("@fontsource-variable/archivo", "archivo-latin-wdth-normal.woff2"),
        ranges: MAIN_RANGES,
      },
      {
        suffix: "rupee",
        source: fs("@fontsource-variable/archivo", "archivo-latin-ext-wdth-normal.woff2"),
        ranges: RUPEE_RANGES,
      },
    ],
    fallbacks: [
      { family: "Archivo Fallback", local: "Arial", instance: { wght: 400, wdth: 100 } },
      { family: "Archivo Expanded Fallback", local: "Arial", instance: { wght: 560, wdth: 116 } },
    ],
  },
  {
    id: "ibm-plex-mono",
    family: "IBM Plex Mono",
    weight: "400",
    display: "swap",
    files: [
      {
        suffix: "latin",
        source: fs("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"),
        ranges: MAIN_RANGES,
      },
      {
        suffix: "rupee",
        source: fs("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-ext-400-normal.woff2"),
        ranges: RUPEE_RANGES,
      },
    ],
  },
];

export const fontFileName = (face: Face, file: FaceFile) => `${face.id}-${file.suffix}.woff2`;

export const codePoints = (ranges: readonly Range[]) =>
  ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

export const unicodeRange = (ranges: readonly Range[]) =>
  ranges
    .map(([a, b]) => {
      const h = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
      return a === b ? `U+${h(a)}` : `U+${h(a)}-${h(b)}`;
    })
    .join(", ");

/** Approximate English character frequencies (%, space included), used to compare the average
 * glyph width of a web font with its fallback (the same idea as Capsize's xWidthAvg). */
export const LETTER_WEIGHTS: Record<string, number> = {
  " ": 18.3,
  e: 10.2,
  t: 7.5,
  a: 6.5,
  o: 6.2,
  i: 5.7,
  n: 5.7,
  s: 5.3,
  h: 5.0,
  r: 5.0,
  d: 3.5,
  l: 3.3,
  c: 2.2,
  u: 2.3,
  m: 2.0,
  w: 1.7,
  f: 1.8,
  g: 1.6,
  y: 1.6,
  p: 1.5,
  b: 1.3,
  v: 0.8,
  k: 0.6,
  j: 0.1,
  x: 0.1,
  q: 0.1,
  z: 0.1,
};
