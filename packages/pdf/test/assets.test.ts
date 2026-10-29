// The build-time assets: no drift from the generator, exact font bytes, the rupee range, nothing external.
import { readFileSync } from "node:fs";
import { BRAND_LOGOS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { PDF_FALLBACK_FONTS, pdfFallbackFileName } from "../../ui/src/fonts/config.ts";
import { buildAssetsSource, cleanSvg, FONT_FILES } from "../scripts/build-assets.ts";
import {
  PDF_ASSETS_SHA256,
  PDF_LOGOS,
  PDF_PRINT_CSS,
  PDF_SYMBOL,
  TECHAUST_PDF_FONT_DATA,
} from "../src/generated/assets.ts";

const file = (rel: string) => new URL(rel, import.meta.url);
const ui = (rel: string) => readFileSync(file(`../../ui/${rel}`));

describe("generated assets", () => {
  it("match a fresh build byte for byte", () => {
    expect(readFileSync(file("../src/generated/assets.ts"), "utf8")).toBe(buildAssetsSource());
  });

  it("embed each UI font file exactly", () => {
    const uris = [...TECHAUST_PDF_FONT_DATA.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)];
    // FX-5: the Archivo files, then the Bengali and Devanagari fallbacks
    const files = [...FONT_FILES, ...PDF_FALLBACK_FONTS.map(pdfFallbackFileName)];
    expect(uris).toHaveLength(files.length);
    files.forEach((name, i) => {
      const bytes = Buffer.from(uris[i]?.[1] as string, "base64");
      expect(bytes.equals(ui(`fonts/${name}`))).toBe(true);
    });
  });

  it("FX-5 (full audit A4 3): the Bengali and Devanagari faces join the Archivo family for their own scripts only", () => {
    const faces = TECHAUST_PDF_FONT_DATA.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const bengali = faces.find((f) => f.includes("U+0980-09FE"));
    const devanagari = faces.find((f) => f.includes("U+0900-097F"));
    expect(bengali).toContain("unicode-range: U+0964-0965, U+0980-09FE, U+200C-200D, U+25CC;");
    expect(devanagari).toContain("unicode-range: U+0900-097F, U+200C-200D, U+25CC;");
    // never a Latin letter or the rupee sign, so Archivo keeps every character it has
    for (const f of [bengali, devanagari]) expect(f).not.toMatch(/U\+00|U\+20B9/);
  });

  it("declares Archivo 400 to 600 (never 700), and the rupee face with U+20B9", () => {
    const faces = TECHAUST_PDF_FONT_DATA.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(2 + PDF_FALLBACK_FONTS.length);
    for (const f of faces) {
      expect(f).toContain('font-family: "Archivo"');
      expect(f).toContain("font-weight: 400 600");
      expect(f).toContain("font-stretch: 100% 116%");
    }
    const rupee = faces.find((f) => f.includes("unicode-range: U+20B9"));
    expect(rupee).toBeDefined();
    const latin = faces.find((f) => !f.includes("U+20B9"));
    expect(latin).not.toMatch(/U\+20B9/);
  });

  it("holds no http: or https: reference in the CSS", () => {
    expect(TECHAUST_PDF_FONT_DATA).not.toMatch(/https?:/);
    expect(PDF_PRINT_CSS).not.toMatch(/https?:/);
  });

  it("carries print.css unchanged", () => {
    expect(PDF_PRINT_CSS).toBe(ui("generated/print.css").toString("utf8").replace(/\r\n/g, "\n"));
  });

  it("has every brand logo, safe to inline", () => {
    expect(Object.keys(PDF_LOGOS).sort()).toEqual([...BRAND_LOGOS].sort());
    for (const svg of [...Object.values(PDF_LOGOS), PDF_SYMBOL]) {
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).not.toMatch(/<\?xml|<script|\son[a-z]+\s*=|href\s*=/i);
    }
  });

  it("has a sha-256", () => {
    expect(PDF_ASSETS_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cleanSvg", () => {
  it("strips the XML prolog", () => {
    expect(cleanSvg("a", '<?xml version="1.0"?>\n<svg></svg>')).toBe("<svg></svg>");
  });
  it.each([
    ["not svg", "<div></div>"],
    ["script", "<svg><script>1</script></svg>"],
    ["handler", '<svg onload="x()"></svg>'],
    ["external href", '<svg><a href="https://example.test"></a></svg>'],
    ["xlink", '<svg><use xlink:href="http://example.test/a.svg#b"/></svg>'],
    ["foreignObject", "<svg><foreignObject/></svg>"],
    ["url()", '<svg><path style="fill:url(https://example.test/x)"/></svg>'],
  ])("refuses %s", (_name, svg) => {
    expect(() => cleanSvg("x", svg)).toThrow();
  });
  it("allows a local fragment reference", () => {
    expect(cleanSvg("a", '<svg><use href="#a"/><path fill="url(#g)"/></svg>')).toContain("#a");
  });
});
