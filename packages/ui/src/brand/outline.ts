// Text → vector outline with HarfBuzz (shaping, kerning and variable axes), for drawing the wordmark.
// Node-only (reads the font file); used by scripts/draw-master.ts and its drift test.
import { readFileSync } from "node:fs";
import fontverter from "fontverter";
import { Blob, Face, Font, Buffer as HbBuffer, shape, Variation } from "harfbuzzjs";

const round = (v: number) => Math.round(v * 100) / 100;

/** Applies x' = sx·x + dx, y' = sy·y + dy to an absolute SVG path (M/L/Q/C/Z, as HarfBuzz emits). */
export function transformPath(d: string, sx: number, sy: number, dx: number, dy: number): string {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const pairs: Record<string, number> = { M: 1, L: 1, Q: 2, C: 3, Z: 0 };
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const cmd = (tokens[i++] ?? "").toUpperCase();
    const pts: string[] = [];
    for (let k = 0; k < (pairs[cmd] ?? 0); k++) {
      const x = Number(tokens[i++]);
      const y = Number(tokens[i++]);
      pts.push(`${round(sx * x + dx)} ${round(sy * y + dy)}`);
    }
    out += cmd + pts.join(" ");
  }
  return out;
}

export function pathBounds(d: string) {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Outline of `text`, scaled so the cap height (of "H") is `cap`; baseline at y = cap, ink starting at x = 0. */
export async function outlineText(
  fontFile: string,
  text: string,
  opts: { axes: Record<string, number>; cap: number; tracking: number },
): Promise<string[]> {
  const sfnt = await fontverter.convert(readFileSync(fontFile), "sfnt");
  const font = new Font(new Face(new Blob(sfnt), 0));
  font.setVariations(Object.entries(opts.axes).map(([tag, v]) => new Variation(tag, v)));
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
  const s = opts.cap / (hBox.y1 - hBox.y0);
  let x = 0;
  const glyphs: string[] = [];
  for (const g of run(text)) {
    const p = font.glyphToPath(g.codepoint);
    if (p) glyphs.push(transformPath(p, s, -s, (x + (g.xOffset ?? 0)) * s, opts.cap - (g.yOffset ?? 0) * s));
    x += (g.xAdvance ?? 0) + opts.tracking;
  }
  const x0 = pathBounds(glyphs.join("")).x0;
  return glyphs.map((p) => transformPath(p, 1, 1, -x0, 0));
}
