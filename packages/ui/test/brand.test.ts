// Brand files: the master is reproducible from the font + geometry, committed files match it, colours come
// from the palette, and rasters have the right sizes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrand, parseMaster, SCHEMES } from "../src/brand/compose.ts";
import { brandFiles, rasterPlan } from "../src/brand/files.ts";
import { MARK, MARK_PARAMS, pixelMark, STROKE } from "../src/brand/geometry.ts";
import { renderMaster } from "../src/brand/master.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import { PRINT_CMYK, PRINT_SOURCE_KEY, printSourceHash } from "../src/brand/print.ts";
import { tokens } from "../src/tokens/model.ts";

const root = join(import.meta.dirname, "..");
const brandDir = join(root, "brand");
const masterSvg = readFileSync(join(brandDir, "source", "techaust-master.svg"), "utf8");
const master = parseMaster(masterSvg);
const brand = createBrand(master);

describe("master", () => {
  it("is exactly what draw:master produces from Archivo + geometry.ts", async () => {
    expect(masterSvg).toBe(await renderMaster(root));
  });

  it("has the mark and all eight letters of TecHaust", () => {
    expect(master.glyphs).toHaveLength(8);
    expect(master.markBase).toBe(MARK.base);
    expect(master.markAccent).toBe(MARK.accent);
  });

  it("the wordmark T carries the mark's 45° cut (the bar's end is offset by its own height)", () => {
    const t = master.glyphs[0] ?? "";
    const pts = [...t.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const top = Math.max(...pts.filter(([, y]) => y === 0).map(([x]) => x ?? 0));
    const bar = Math.min(...pts.filter(([, y]) => (y ?? 0) > 1 && (y ?? 0) < 99).map(([, y]) => y ?? 0));
    const bottom = Math.max(...pts.filter(([, y]) => y === bar).map(([x]) => x ?? 0));
    expect(top - bottom).toBeCloseTo(bar, 1);
    // …and the mark's own cuts are 45°: bar end (x + y = barEnd) and right stem (x + y = 100).
    expect(MARK.accent).toContain(`M81 ${STROKE}L100 0`);
  });
});

describe("mark geometry (brand audit, docs/11)", () => {
  const nums = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

  it("the diagonal channel between the two cuts is exactly one stroke wide", () => {
    const barEnd = nums(MARK.base)[2] ?? 0; // "M0 0H<barEnd>L…"
    const channel = (100 - barEnd) / Math.SQRT2;
    expect(channel).toBeCloseTo(STROKE, 1);
  });

  it("horizontals are optically thinner than verticals, and the crossbar sits above centre", () => {
    expect(MARK_PARAMS.h).toBeLessThan(MARK_PARAMS.v);
    expect(MARK_PARAMS.h / MARK_PARAMS.v).toBeCloseTo(0.92, 2);
    expect(MARK_PARAMS.crossbarY).toBeLessThan(50);
  });

  it("pixel-fitted marks land every coordinate on a whole pixel", () => {
    for (const px of [10, 16, 20, 32]) {
      const p = pixelMark(px);
      for (const n of [...nums(p.base), ...nums(p.accent)])
        expect(Number.isInteger(n), `${px}px: ${n}`).toBe(true);
    }
    expect(pixelMark(16)).toEqual({
      base: "M0 0H12L9 3H0ZM3 0H6V16H3Z",
      accent: "M6 6H13V9H6ZM13 3L16 0V16H13Z",
    });
  });

  it("favicon.svg uses the 16-unit pixel grid", () => {
    expect(brand.faviconSvg()).toContain('viewBox="0 0 16 16"');
  });
});

describe("vector files are up to date with the master", () => {
  it.each(Object.entries(brandFiles(brand)))("%s", (file, expected) => {
    expect(readFileSync(join(brandDir, file), "utf8")).toBe(expected);
  });

  it("no stray files in brand/", () => {
    const expected = new Set([
      ...Object.keys(brandFiles(brand)),
      ...rasterPlan(brand).map((r) => r.file),
      "source",
      "print",
      "wallpapers",
      "social",
    ]);
    expect(readdirSync(brandDir).filter((f) => !expected.has(f))).toEqual([]);
  });
});

describe("colour versions", () => {
  const palette = new Set(Object.values(tokens.palette).map((h) => h.toUpperCase()));
  it.each(Object.keys(brandFiles(brand)))("%s uses only palette colours", (file) => {
    const svg = readFileSync(join(brandDir, file), "utf8");
    for (const m of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g))
      expect(palette.has(m[0].toUpperCase()), m[0]).toBe(true);
  });

  it("one-colour versions really are one colour", () => {
    for (const scheme of ["ink", "white", "black"] as const) {
      const svg = brand.lockupSvg("primary", scheme);
      const colours = new Set([...svg.matchAll(/fill="(#[0-9A-F]{6})"/g)].map((m) => m[1]));
      expect([...colours]).toEqual([SCHEMES[scheme].base]);
    }
  });

  it("the dark version uses mist + light verdigris and no ink", () => {
    const svg = brand.lockupSvg("primary", "dark");
    expect(svg).toContain(`fill="${SCHEMES.dark.base}"`);
    expect(svg).toContain(`fill="${SCHEMES.dark.accent}"`);
    expect(svg).not.toContain(SCHEMES.color.base);
  });

  it("favicon.svg adapts to a dark browser UI", () => {
    const svg = brand.faviconSvg();
    expect(svg).toContain("@media (prefers-color-scheme:dark)");
  });

  it("every lockup has a viewBox and an accessible name", () => {
    for (const lockup of ["primary", "stacked", "wordmark", "symbol"] as const) {
      const svg = brand.lockupSvg(lockup, "color");
      expect(svg).toMatch(/viewBox="[-\d. ]+"/);
      expect(svg).toContain("<title>TecHaust Technologies</title>");
    }
  });
});

// PNG: width/height are big-endian at bytes 16 and 20 of the IHDR chunk.
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

describe("raster files", () => {
  const pngs = rasterPlan(brand).filter((r) => r.kind === "png");
  it.each(pngs.map((r) => [r.file, r.width, r.height] as const))("%s is %i×%i", (file, w, h) => {
    const buf = readFileSync(join(brandDir, file));
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(pngSize(buf)).toEqual([w, h]);
  });

  // Drift: each PNG is tagged sRGB and carries the hash of the SVG it was rendered from (as the wallpapers do), so a
  // changed master, geometry or palette fails here until `build:brand` is run again.
  it.each(pngs.map((r) => [r.file, r.svg] as const))("%s was rendered from today's SVG", (file, svg) => {
    const info = pngInfo(readFileSync(join(brandDir, file)));
    expect(info.srgb, "tagged sRGB").toBe(true);
    expect(info.source, "rendered from today's SVG: run build:brand").toBe(sourceHash(svg));
  });

  it("favicon.ico's embedded PNGs were rendered from today's SVGs", () => {
    const plan = rasterPlan(brand).find((r) => r.kind === "ico");
    if (plan?.kind !== "ico") throw new Error("no ico in the raster plan");
    const ico = readFileSync(join(brandDir, plan.file));
    expect(ico.readUInt16LE(4)).toBe(plan.sizes.length);
    plan.sizes.forEach((s, i) => {
      const length = ico.readUInt32LE(6 + 16 * i + 8);
      const offset = ico.readUInt32LE(6 + 16 * i + 12);
      const info = pngInfo(ico.subarray(offset, offset + length));
      expect(info.width, `${s.size}px entry`).toBe(s.size);
      expect(info.source, "run build:brand").toBe(sourceHash(s.svg));
    });
  });

  it("favicon.ico holds 16, 32 and 48 px PNGs", () => {
    const ico = readFileSync(join(brandDir, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    const off = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(off + 1, off + 4).toString()).toBe("PNG");
  });
});

/** The Info dictionary's /Keywords string (pdf-lib writes it as UTF-16BE hex). */
function pdfKeywords(pdf: string): string | undefined {
  const hex = /\/Keywords\s*<([0-9A-Fa-f]+)>/.exec(pdf)?.[1];
  if (hex) return Buffer.from(hex, "hex").subarray(2).swap16().toString("utf16le");
  return /\/Keywords\s*\(([^)]*)\)/.exec(pdf)?.[1];
}

describe("print files", () => {
  const files = [
    "logo-primary-cmyk.pdf",
    "logo-primary-cmyk-on-dark.pdf",
    "business-card.pdf",
    "letterhead-a4.pdf",
  ];
  it.each(files)("%s is a PDF", (f) => {
    const buf = readFileSync(join(brandDir, "print", f));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it.each(files)("%s was built from today's master, print CMYK and layout code", (f) => {
    const keywords = pdfKeywords(readFileSync(join(brandDir, "print", f), "latin1"));
    expect(keywords, "run build:brand").toBe(`${PRINT_SOURCE_KEY}=${printSourceHash(root)}`);
  });

  it("the print source hash is a stable SHA-256", () => {
    expect(printSourceHash(root)).toMatch(/^[0-9a-f]{64}$/);
    expect(printSourceHash(root)).toBe(printSourceHash(root));
  });

  it("the print source hash covers every input of the print layout (outliner, composer, font bytes)", () => {
    const source = readFileSync(join(root, "src/brand/print.ts"), "utf8");
    for (const input of ["./print.ts", "./geometry.ts", "./outline.ts", "./compose.ts", "WORDMARK.font"]) {
      expect(source, input).toContain(input);
    }
    // print.ts must not import a layout module that the hash does not read.
    const imports = [...source.matchAll(/from "(\.\/[a-z]+\.ts)"/g)].map((m) => m[1]);
    for (const file of imports) expect(source.split(`here("${file}")`).length, file).toBe(2);
  });

  it("the business card has trim and bleed boxes (3 mm bleed) on both sides", () => {
    const pdf = readFileSync(join(brandDir, "print", "business-card.pdf"), "latin1");
    expect(pdf.match(/\/TrimBox/g)?.length).toBe(2);
    expect(pdf.match(/\/BleedBox/g)?.length).toBe(2);
  });

  it("uses only measured CMYK values, each within a small colour error of the brand colour", () => {
    for (const [key, c] of Object.entries(PRINT_CMYK)) {
      expect(c.hex, key).toBe(tokens.palette[key]);
      expect(
        c.cmyk.reduce((a, b) => a + b, 0),
        `${key} total ink`,
      ).toBeLessThanOrEqual(300);
      expect(c.deltaE76, key).toBeLessThanOrEqual(4);
    }
  });
});
