// The TecHaust identity ("Patina", owner-chosen 2026-10-06) as numbers. Everything in brand/ is drawn from this.
//
// Mark: a TH ligature on a 100 × 100 grid: one block split by a single diagonal channel. The T and the H
// share a stem; the end of the T bar and the top of the H's right stem are cut at 45°, and the channel between
// the two cuts is exactly one stroke wide. Optical corrections (brand audit, docs/11): horizontals are drawn
// 8 % thinner than verticals, and the crossbar sits 1.5 units above the geometric centre.

export type MarkParams = {
  /** vertical stroke */ v: number;
  /** horizontal stroke (T bar, crossbar) */ h: number;
  /** left edge of the shared stem */ stemX: number;
  /** centre line of the crossbar */ crossbarY: number;
  /** grid size */ size: number;
};

export const MARK_PARAMS: MarkParams = { v: 19, h: 17.5, stemX: 19.5, crossbarY: 48.5, size: 100 };
/** Clear space on every side, and the unit for the lockup gap. */
export const STROKE = MARK_PARAMS.v;

const r = (n: number) => Math.round(n * 100) / 100;

/** The mark's two paths. `snap` rounds every coordinate to whole units (pixel-fitted favicons). */
export function markPaths(p: MarkParams, snap = false) {
  const q = snap ? Math.round : r;
  const v = q(p.v);
  const h = q(p.h);
  const s1 = q(p.stemX);
  const s2 = s1 + v;
  const rx = p.size - v; // right stem
  const barEnd = q(p.size - v * Math.SQRT2); // channel (perpendicular) = one stroke
  const cTop = q(p.crossbarY - p.h / 2);
  return {
    base: `M0 0H${barEnd}L${r(barEnd - h)} ${h}H0ZM${s1} 0H${s2}V${p.size}H${s1}Z`,
    accent: `M${s2} ${cTop}H${rx}V${r(cTop + h)}H${s2}ZM${rx} ${v}L${p.size} 0V${p.size}H${rx}Z`,
  };
}

export const MARK = markPaths(MARK_PARAMS);

/**
 * A pixel-fitted mark `px` pixels wide: strokes and edges land on whole pixels, so 16 / 32 px icons stay crisp.
 * Below ~40 px horizontals equal verticals (a 1 px optical correction would be bigger than the 8 % intended).
 */
export function pixelMark(px: number) {
  const v = Math.max(2, Math.round(px * 0.19));
  const h = px < 40 ? v : Math.round(px * 0.175);
  return markPaths({ v, h, stemX: Math.round(px * 0.195), crossbarY: px * 0.485, size: px }, true);
}

// Wordmark: "TecHaust" in Archivo (OFL) at weight 620, width 116, outlined with HarfBuzz (real kerning).
// Bespoke edits: the T bar gets the mark's 45° cut; the letters after it move 9 units closer; three pairs are
// optically re-spaced (measured white area against the font's own "no" rhythm, docs/11 §2.3).
export const WORDMARK = {
  text: "TecHaust",
  font: "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
  axes: { wght: 620, wdth: 116 },
  cap: 100, // cap height in master units
  tracking: -6, // font units per glyph
  kernAfterT: 9, // master units
  /** extra tightening before glyph i (master units), e.g. 3 → between "c" and "H" */
  pairs: { 3: 4, 4: 2, 7: 2 } as Record<number, number>,
} as const;

// Horizontal lockup: the mark is 1.28 × the cap height, centred on the caps; the gap is two mark strokes.
const MARK_SCALE = 1.28;
export const LOCKUP = { markScale: MARK_SCALE, markY: -14, gap: r(2 * STROKE * MARK_SCALE) } as const;

// Brand lines, outlined in Archivo like the wordmark. The strapline is the approved home-page H1 (docs/07 §3).
export const TYPE_LINES = {
  strapline: { text: "Build it right. Automate the rest.", axes: { wght: 560, wdth: 116 }, tracking: -4 },
  straplineA: { text: "Build it right.", axes: { wght: 560, wdth: 116 }, tracking: -4 },
  straplineB: { text: "Automate the rest.", axes: { wght: 560, wdth: 116 }, tracking: -4 },
  domain: { text: "techaust.com", axes: { wght: 500, wdth: 100 }, tracking: 0 },
} as const;
