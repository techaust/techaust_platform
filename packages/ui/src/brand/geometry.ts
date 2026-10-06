// The TecHaust identity ("Patina", owner-chosen 2026-10-06) as numbers. Everything in brand/ is drawn from this.
//
// Mark: a TH ligature on a 100 × 100 grid. The T and the H share one stem; the end of the T bar and the top of
// the H's right stem carry parallel 45° cuts (the "machined" detail). Stroke = 19 units, which is also the
// clear-space unit. Base parts are ink, accent parts verdigris.
export const STROKE = 19;
export const MARK = {
  base: "M0 0H62L43 19H0ZM19.5 0H38.5V100H19.5Z",
  accent: "M38.5 40.5H81V59.5H38.5ZM81 19L100 0V100H81Z",
} as const;

// Wordmark: "TecHaust" in Archivo (OFL) at weight 620, width 116, outlined with HarfBuzz (real kerning).
// Bespoke edits: the T bar gets the mark's 45° cut, and everything after the T moves 9 units closer.
export const WORDMARK = {
  text: "TecHaust",
  font: "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2",
  axes: { wght: 620, wdth: 116 },
  cap: 100, // cap height in master units
  tracking: -6, // font units per glyph
  kernAfterT: 9, // master units
} as const;

// Horizontal lockup: the mark is 1.28 × the cap height, centred on the caps, then a 46-unit gap.
export const LOCKUP = { markScale: 1.28, markY: -14, gap: 46 } as const;
