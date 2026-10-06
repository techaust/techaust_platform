// Brand files: the master is reproducible from the font + geometry, committed files match it, colours come
// from the palette, and rasters have the right sizes.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBrand, parseMaster, SCHEMES } from "../src/brand/compose.ts";
import { brandFiles, rasterPlan } from "../src/brand/files.ts";
import { MARK, STROKE } from "../src/brand/geometry.ts";
import { renderMaster } from "../src/brand/master.ts";
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
    // …and the mark's own cuts are 45° too, sized to the stroke.
    expect(MARK.base).toContain(`H62L${62 - STROKE} ${STROKE}`);
    expect(MARK.accent).toContain(`M81 ${STROKE}L100 0`);
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

  it("favicon.ico holds 16, 32 and 48 px PNGs", () => {
    const ico = readFileSync(join(brandDir, "favicon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    const off = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(off + 1, off + 4).toString()).toBe("PNG");
  });
});
