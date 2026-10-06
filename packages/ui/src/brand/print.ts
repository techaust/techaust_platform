// Print-ready PDFs (vector, CMYK, trim + bleed boxes, all text outlined): logos, business card, A4 letterhead.
// Node-only (HarfBuzz outlines from the font file). Written by scripts/build-brand.ts.
import { createRequire } from "node:module";
import { join } from "node:path";
import { cmyk, PDFDocument, type PDFPage } from "@cantoo/pdf-lib";
import printCmyk from "../../tokens/print-cmyk.json" with { type: "json" };
import type { Brand } from "./compose.ts";
import { LOCKUP, WORDMARK } from "./geometry.ts";
import { outlineText } from "./outline.ts";

const MM = 72 / 25.4;
const BLEED = 3 * MM;

/**
 * Print CMYK per brand colour, measured with a real ICC profile (scripts/measure-cmyk.py → tokens/print-cmyk.json).
 * Starting values: approve a printed proof against the hex colours before a full run (docs/06 §1.6).
 */
export const PRINT_CMYK = printCmyk.colours as Record<
  string,
  { hex: string; cmyk: number[]; deltaE76: number }
>;
const ink = (key: string) => {
  const c = PRINT_CMYK[key]?.cmyk;
  if (!c) throw new Error(`tokens/print-cmyk.json has no ${key}; rerun scripts/measure-cmyk.py`);
  const [cc = 0, m = 0, y = 0, k = 0] = c.map((v) => v / 100);
  return cmyk(cc, m, y, k);
};

/** Business card content (3.5 × 2 in, the common Indian size). Phone/WhatsApp is added once the owner confirms it. */
export const CARD = {
  name: "Rupak Sarkar",
  role: "Founder",
  lines: ["contact@techaust.com", "techaust.com", "Balurghat, West Bengal, India"],
} as const;

/** Letterhead footer (no GSTIN: that appears on tax documents only, owner decision 04 §0). */
export const LETTERHEAD_FOOTER = [
  "TecHaust Technologies",
  "Balurghat, West Bengal, India",
  "contact@techaust.com",
  "techaust.com",
];

type Text = { d: string; width: number };

export async function buildPrintFiles(
  brand: Brand,
  packageRoot: string,
): Promise<Record<string, Uint8Array>> {
  const require = createRequire(join(packageRoot, "package.json"));
  const font = require.resolve(WORDMARK.font);
  const text = async (s: string, wght: number, wdth = 100): Promise<Text> => {
    const d = (await outlineText(font, s, { axes: { wght, wdth }, cap: 100, tracking: 0 })).join("");
    const width = Math.max(...(d.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter((_, i) => i % 2 === 0));
    return { d, width };
  };
  /** Draw outlined text with its cap top at (x, top) in points from the page's top-left. */
  const put = (page: PDFPage, t: Text, x: number, top: number, cap: number, colour: string) =>
    page.drawSvgPath(t.d, {
      x,
      y: page.getHeight() - top,
      scale: cap / 100,
      color: ink(colour),
      borderWidth: 0,
    });

  const [vb0, vb1, vbW, vbH] = brand.viewBox as [number, number, number, number];
  /** The primary lockup `width` pt wide with its top-left at (x, top). */
  const lockup = (page: PDFPage, x: number, top: number, width: number, dark: boolean) => {
    const s = width / vbW;
    const H = page.getHeight();
    const mx = x - vb0 * s;
    const my = top - vb1 * s;
    const mark = (d: string, key: string, dx: number, dy: number, k: number) =>
      page.drawSvgPath(d, { x: dx, y: H - dy, scale: k, color: ink(key), borderWidth: 0 });
    const ms = LOCKUP.markScale * s;
    mark(brand.markPaths.base, dark ? "mist" : "ink-900", mx, my + LOCKUP.markY * s, ms);
    mark(brand.markPaths.accent, dark ? "verdigris-300" : "verdigris-700", mx, my + LOCKUP.markY * s, ms);
    const wx = mx + (100 * LOCKUP.markScale + LOCKUP.gap) * s;
    for (const g of brand.glyphs) mark(g, dark ? "mist" : "ink-900", wx, my, s);
    return (vbH * s) as number;
  };
  const doc = async () => {
    const d = await PDFDocument.create({ updateMetadata: false });
    d.setTitle("TecHaust Technologies");
    d.setAuthor("TecHaust Technologies");
    d.setCreationDate(new Date("2026-10-06T00:00:00Z"));
    d.setModificationDate(new Date("2026-10-06T00:00:00Z"));
    return d;
  };
  const sized = (d: PDFDocument, w: number, h: number) => {
    const p = d.addPage([w + 2 * BLEED, h + 2 * BLEED]);
    p.setBleedBox(0, 0, w + 2 * BLEED, h + 2 * BLEED);
    p.setTrimBox(BLEED, BLEED, w, h);
    return p;
  };
  const out: Record<string, Uint8Array> = {};

  // Logos for print (no bleed; artwork box = the logo + one stroke of clear space).
  for (const [name, dark] of [
    ["logo-primary-cmyk.pdf", false],
    ["logo-primary-cmyk-on-dark.pdf", true],
  ] as const) {
    const d = await doc();
    const w = 100 * MM;
    const pad = (w * (19 * LOCKUP.markScale)) / vbW;
    const p = d.addPage([w + 2 * pad, (vbH * w) / vbW + 2 * pad]);
    if (dark)
      p.drawRectangle({ x: 0, y: 0, width: p.getWidth(), height: p.getHeight(), color: ink("ink-900") });
    lockup(p, pad, pad, w, dark);
    out[name] = await d.save({ useObjectStreams: false });
  }

  // Business card, 3.5 × 2 in (88.9 × 50.8 mm) + 3 mm bleed. Front: lockup, name, contact. Back: ink with the mark.
  {
    const d = await doc();
    const W = 3.5 * 72;
    const Hh = 2 * 72;
    const m = 6 * MM; // inner margin from trim
    const front = sized(d, W, Hh);
    lockup(front, BLEED + m, BLEED + m, 30 * MM, false);
    const name = await text(CARD.name, 600);
    const role = await text(CARD.role, 400);
    put(front, name, BLEED + m, BLEED + Hh - m - 32, 7.6, "ink-900");
    put(front, role, BLEED + m, BLEED + Hh - m - 21.5, 5.4, "ink-400");
    let y = BLEED + Hh - m - 32;
    for (const l of CARD.lines) {
      const t = await text(l, 400);
      put(front, t, BLEED + W - m - (t.width * 5.4) / 100, y, 5.4, "ink-900");
      y += 10.5;
    }
    const back = sized(d, W, Hh);
    back.drawRectangle({
      x: 0,
      y: 0,
      width: back.getWidth(),
      height: back.getHeight(),
      color: ink("ink-900"),
    });
    const size = 16 * MM;
    const cx = (back.getWidth() - size) / 2;
    const top = (back.getHeight() - size) / 2;
    back.drawSvgPath(brand.markPaths.base, {
      x: cx,
      y: back.getHeight() - top,
      scale: size / 100,
      color: ink("mist"),
      borderWidth: 0,
    });
    back.drawSvgPath(brand.markPaths.accent, {
      x: cx,
      y: back.getHeight() - top,
      scale: size / 100,
      color: ink("verdigris-300"),
      borderWidth: 0,
    });
    out["business-card.pdf"] = await d.save({ useObjectStreams: false });
  }

  // A4 letterhead (no bleed needed: nothing touches the edge). Header lockup 42 mm; verdigris rule; footer.
  {
    const d = await doc();
    const p = d.addPage([210 * MM, 297 * MM]);
    const left = 16 * MM;
    const h = lockup(p, left, 16 * MM, 42 * MM, false);
    p.drawRectangle({
      x: left,
      y: p.getHeight() - (16 * MM + h + 6 * MM),
      width: 178 * MM,
      height: 0.8,
      color: ink("verdigris-700"),
    });
    const cap = 5.2;
    const col = (178 * MM) / LETTERHEAD_FOOTER.length;
    for (const [i, l] of LETTERHEAD_FOOTER.entries()) {
      put(
        p,
        await text(l, i === 0 ? 600 : 400),
        left + i * col,
        297 * MM - 14 * MM,
        cap,
        i === 0 ? "ink-900" : "ink-400",
      );
    }
    out["letterhead-a4.pdf"] = await d.save({ useObjectStreams: false });
  }
  return out;
}
