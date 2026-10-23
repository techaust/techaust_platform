// Sets many strings as outlines from one loaded font (the page share images, og-render.ts). Kept apart from outline.ts,
// whose source the print PDFs hash, so changing this file never makes the committed PDFs look stale.
import { readFileSync } from "node:fs";
import fontverter from "fontverter";
import { Blob, Face, Font, Buffer as HbBuffer, shape, Variation } from "harfbuzzjs";
import { pathBounds, transformPath } from "./outline.ts";

/** Text set as outlines at a known cap height: one path per glyph, origin at the pen start, baseline at y = cap. */
export type Outlined = { glyphs: string[]; width: number; cap: number };

/**
 * Loads a font once and returns a function that sets many strings (the share images: every page's title). Same
 * shaping as `outlineText`, but the pen origin is kept (no ink shift) and the advance width is returned, so lines can be
 * measured and wrapped. A character the font lacks throws (a missing glyph would print as an empty box).
 */
export async function createOutliner(fontFile: string, axes: Record<string, number>) {
  const sfnt = await fontverter.convert(readFileSync(fontFile), "sfnt");
  const font = new Font(new Face(new Blob(sfnt), 0));
  font.setVariations(Object.entries(axes).map(([tag, v]) => new Variation(tag, v)));
  const run = (s: string) => {
    const buf = new HbBuffer();
    buf.addText(s);
    buf.guessSegmentProperties();
    shape(font, buf);
    return buf.getGlyphInfosAndPositions();
  };
  const h = run("H")[0];
  if (!h) throw new Error("font has no H");
  const hBox = pathBounds(font.glyphToPath(h.codepoint));
  const capUnits = hBox.y1 - hBox.y0;
  return (text: string, opts: { cap: number; tracking?: number }): Outlined => {
    const s = opts.cap / capUnits;
    const tracking = opts.tracking ?? 0;
    let x = 0;
    const glyphs: string[] = [];
    for (const g of run(text)) {
      if (g.codepoint === 0) throw new Error(`the font has no glyph for a character in "${text}"`);
      const p = font.glyphToPath(g.codepoint);
      if (p)
        glyphs.push(transformPath(p, s, -s, (x + (g.xOffset ?? 0)) * s, opts.cap - (g.yOffset ?? 0) * s));
      x += (g.xAdvance ?? 0) + tracking;
    }
    return { glyphs, width: Math.round(x * s * 100) / 100, cap: opts.cap };
  };
}
