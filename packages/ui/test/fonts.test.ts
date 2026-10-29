// Glyph coverage (₹ especially, docs/06 §3.1) and the size budget for the committed font files.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codePoints,
  FACES,
  fontFileName,
  MAIN_RANGES,
  PDF_FALLBACK_FONTS,
  pdfFallbackFileName,
  RUPEE_RANGES,
} from "../src/fonts/config.ts";
import { parseFont } from "../src/fonts/metrics.ts";
import { tokens } from "../src/tokens/model.ts";

const fontsDir = join(import.meta.dirname, "..", "fonts");
const MAX_BYTES = 45 * 1024; // docs/06 §3.1: ≤ 45 KB per file
const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

describe.each(FACES.map((f) => [f.family, f] as const))("%s", (_family, face) => {
  const files = face.files.map((file) => ({
    file,
    buf: readFileSync(join(fontsDir, fontFileName(face, file))),
  }));

  it("covers every character we typeset, including ₹ (U+20B9)", () => {
    const fonts = files.map(({ buf }) => parseFont(buf));
    const missing = codePoints([...MAIN_RANGES, ...RUPEE_RANGES])
      .filter((cp) => cp !== 0xad) // soft hyphen is never drawn
      .filter((cp) => !fonts.some((f) => f.hasGlyphForCodePoint(cp)))
      .map(hex);
    expect(missing).toEqual([]);
  });

  it("puts ₹ in the small rupee file the browser loads on demand", () => {
    const rupee = files.find((f) => f.file.suffix === "rupee");
    expect(rupee && parseFont(rupee.buf).hasGlyphForCodePoint(0x20b9)).toBe(true);
  });

  it.each(face.files.map((f) => fontFileName(face, f)))("%s is within the 45 KB budget", (name) => {
    expect(statSync(join(fontsDir, name)).size).toBeLessThanOrEqual(MAX_BYTES);
  });
});

describe("fonts.css", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "generated", "fonts.css"), "utf8");

  it("references only files that exist", () => {
    const urls = [...css.matchAll(/url\("\.\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBe(FACES.reduce((n, f) => n + f.files.length, 0));
    for (const u of urls) expect(existsSync(join(fontsDir, u)), u).toBe(true);
  });

  it("declares a metric-matched fallback for every face the tokens name (no layout shift)", () => {
    for (const f of Object.values(tokens.font)) {
      if (!f.metricFallback) continue;
      expect(css).toContain(`font-family: "${f.metricFallback}";\n  src: local("Arial");`);
    }
    expect(css).toMatch(/size-adjust: \d+\.\d+%;/);
  });

  it("Archivo spans the text and expanded heading widths in one file", () => {
    expect(css).toMatch(/"Archivo";[^}]*font-weight: 400 600;[^}]*font-stretch: 100% 116%;/);
  });

  it("ships the OFL licence text with the fonts", () => {
    const licences = readFileSync(join(fontsDir, "LICENSES.md"), "utf8");
    expect(licences).toContain("SIL Open Font License, Version 1.1");
    expect(licences.match(/^## @fontsource/gm)?.length).toBe(FACES.length + PDF_FALLBACK_FONTS.length);
  });
});

describe("the PDF-only fallbacks (FX-5, full audit A4 3)", () => {
  // A name in each script: Bengali with a conjunct (ক্ষ) and a vowel sign, Devanagari with a conjunct (क्ष) and a matra.
  const SAMPLES: Record<string, string> = { Bengali: "রুপক সরকার ক্ষমা", Devanagari: "रूपक सरकार क्षमा" };

  it.each(PDF_FALLBACK_FONTS.map((f) => [f.script, f] as const))(
    "%s: covers its block, a sample name and the joiners, within 45 KB",
    (_s, f) => {
      const name = pdfFallbackFileName(f);
      const buf = readFileSync(join(fontsDir, name));
      expect(statSync(join(fontsDir, name)).size).toBeLessThanOrEqual(MAX_BYTES);
      const font = parseFont(buf);
      const sample = [...(SAMPLES[f.script] ?? "")]
        .map((c) => c.codePointAt(0) as number)
        .filter((cp) => cp !== 0x20);
      expect(sample.filter((cp) => !font.hasGlyphForCodePoint(cp)).map(hex)).toEqual([]);
      for (const cp of [0x200c, 0x200d, 0x25cc]) expect(font.hasGlyphForCodePoint(cp), hex(cp)).toBe(true);
      // never in the web pages' fonts.css
      const css = readFileSync(join(import.meta.dirname, "..", "generated", "fonts.css"), "utf8");
      expect(css).not.toContain(name);
    },
  );
});
