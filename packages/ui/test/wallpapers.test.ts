// Brand wallpapers: the committed PNGs are exactly what the generator draws today (each PNG carries the SHA-256
// of its SVG source, so nothing is re-rendered here), they are sRGB at the exact sizes, the quiet zones really
// are quiet, and the mark keeps its geometry and its colour logic.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { color } from "../src/brand/compose.ts";
import { markPaths } from "../src/brand/geometry.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import { FORMATS, fitMark, wallpaperPlan, wallpaperSvg } from "../src/brand/wallpapers.ts";
import { tokens } from "../src/tokens/model.ts";

const dir = join(import.meta.dirname, "..", "brand", "wallpapers");
const plan = wallpaperPlan();
const hex = (h: string) =>
  [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lstar = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

describe("wallpaper files", () => {
  it("there are six, named wallpaper-<concept>-<format>.png, and nothing else", () => {
    expect(plan).toHaveLength(6);
    expect(readdirSync(dir).sort()).toEqual(plan.map((w) => w.file).sort());
  });

  it.each(plan.map((w) => [w.file, w] as const))("%s is current, sRGB and the exact size", (file, w) => {
    const info = pngInfo(readFileSync(join(dir, file)));
    expect([info.width, info.height]).toEqual([w.width, w.height]);
    expect(info.colourType, "opaque RGB").toBe(2);
    expect(info.bitDepth).toBe(8);
    expect(info.srgb).toBe(true);
    expect(info.iccp).toBe(false);
    expect(info.source, "rendered from today's SVG: run build:wallpapers").toBe(sourceHash(w.svg));
  });

  it("the sizes are the brief's: desktop 3840 × 2160, mobile 2160 × 4680", () => {
    expect(FORMATS.desktop).toMatchObject({ width: 3840, height: 2160 });
    expect(FORMATS.mobile).toMatchObject({ width: 2160, height: 4680 });
  });
});

describe("drawing rules", () => {
  const palette = new Set(Object.values(tokens.palette).map((h) => h.toUpperCase()));

  it.each(plan.map((w) => [w.file, w.svg] as const))("%s uses only palette colours, flat", (_, svg) => {
    for (const m of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g))
      expect(palette.has(m[0].toUpperCase()), m[0]).toBe(true);
    expect(svg).not.toMatch(/Gradient|<filter|opacity|<text|<image/);
  });

  it("the fitted mark is geometry.ts snapped to whole pixels", () => {
    for (const size of [480, 1000, 1100, 1500, 1680]) {
      const m = fitMark(size);
      const k = size / 100;
      expect(m.fill).toEqual(
        markPaths({ v: 19 * k, h: 17.5 * k, stemX: 19.5 * k, crossbarY: 48.5 * k, size }, true),
      );
      const nums = [m.fill.base, m.fill.accent, m.outline.base, m.outline.accent].flatMap((d) =>
        (d.match(/-?\d*\.?\d+/g) ?? []).map(Number),
      );
      for (const n of nums) expect(Number.isInteger(n), `${size}: ${n}`).toBe(true);
      // The channel between the two 45° cuts stays one stroke wide (within half a pixel).
      expect(Math.abs((size - m.barEnd) / Math.SQRT2 - m.v)).toBeLessThan(0.5);
    }
  });

  it("colour logic: the T and shared stem are ink, the crossbar and right stem verdigris, never swapped", () => {
    const family = (prefix: string) =>
      new Set(
        Object.keys(tokens.palette)
          .filter((k) => k.startsWith(prefix))
          .map(color),
      );
    const want = { base: family("ink-"), accent: family("verdigris-") };
    const marks = { monolith: 2, cut: 0, construction: 2 };
    for (const w of plan) {
      const parts = [...w.svg.matchAll(/<path data-part="(base|accent)"([^>]*)>/g)];
      expect(parts, w.file).toHaveLength(marks[w.concept]);
      for (const [, part, attrs = ""] of parts) {
        const paint = /fill="none"/.test(attrs)
          ? /stroke="([^"]+)"/.exec(attrs)?.[1]
          : /fill="([^"]+)"/.exec(attrs)?.[1];
        expect(want[part as "base" | "accent"].has(paint ?? ""), `${w.file} ${part} ${paint}`).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    for (const w of plan) expect(wallpaperSvg(w.concept, w.format)).toBe(w.svg);
  });
});

describe("quiet zones (measured in the committed PNGs)", () => {
  const ground = lstar(hex(color("ink-950")));
  const verdigris = Object.entries(tokens.palette)
    .filter(([k]) => k.startsWith("verdigris-"))
    .map(([, v]) => v.toUpperCase());

  it.each(plan.map((w) => [w.file, w] as const))("%s: only the ground or tone-on-tone", async (file, w) => {
    for (const q of FORMATS[w.format].quiet) {
      const { data, info } = await sharp(join(dir, file))
        .extract({ left: q.x, top: q.y, width: q.w, height: q.h })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let worst = 0;
      const seen = new Set<string>();
      for (let o = 0; o < data.length; o += info.channels) {
        const c: [number, number, number] = [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0];
        const key = c.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        worst = Math.max(worst, Math.abs(lstar(c) - ground));
        const h = `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        expect(verdigris, `${file}: verdigris in a quiet zone`).not.toContain(h);
      }
      // ΔL* ≤ 6 on ink-950 keeps white icon labels (and their shadows) fully readable.
      expect(worst, `${file} ${q.x},${q.y}`).toBeLessThanOrEqual(6);
    }
  });
});
