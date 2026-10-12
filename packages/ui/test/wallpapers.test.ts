// Brand wallpapers (round 3: rendered soft folds). The committed PNGs are what today's renderer draws (each PNG
// carries the SHA-256 of the renderer, the concepts, the mark's geometry and the tokens, so nothing 4K is
// re-rendered here); they are sRGB at the exact sizes; the quiet zones are measured on the pixels (a smooth field,
// no edges, no banding); and the small mark keeps its geometry, its place and its colour logic.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { markPaths } from "../src/brand/geometry.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import { lstar, zoneStats } from "../src/brand/wallpaper-render.ts";
import { wallpaperSource } from "../src/brand/wallpaper-source.ts";
import { FORMATS, fitMark, MARK_PLACE, renderWallpaper, wallpaperPlan } from "../src/brand/wallpapers.ts";

const root = join(import.meta.dirname, "..");
const dir = join(root, "brand", "wallpapers");
const plan = wallpaperPlan();
const raw = async (file: string) => {
  const { data, info } = await sharp(join(dir, file)).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width };
};

describe("wallpaper files", () => {
  it("there are six, named wallpaper-<concept>-<format>.png, and nothing else", () => {
    expect(plan).toHaveLength(6);
    expect(readdirSync(dir).sort()).toEqual(plan.map((w) => w.file).sort());
  });

  it("the sizes are the brief's: desktop 3840 × 2160, phone 2160 × 4680", () => {
    expect(FORMATS.desktop).toMatchObject({ width: 3840, height: 2160 });
    expect(FORMATS.mobile).toMatchObject({ width: 2160, height: 4680 });
  });

  it.each(plan.map((w) => [w.file, w] as const))("%s is current, sRGB and the exact size", (file, w) => {
    const info = pngInfo(readFileSync(join(dir, file)));
    expect([info.width, info.height]).toEqual([w.width, w.height]);
    expect(info.colourType, "opaque RGB").toBe(2);
    expect(info.bitDepth).toBe(8);
    expect(info.srgb).toBe(true);
    expect(info.iccp).toBe(false);
    expect(info.source, "rendered from today's sources: run build:wallpapers").toBe(
      sourceHash(wallpaperSource(root, w.concept, w.format)),
    );
  });

  it("the renderer is deterministic (a small render, twice)", () => {
    const a = renderWallpaper("fold", "desktop", 0.05);
    const b = renderWallpaper("fold", "desktop", 0.05);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});

describe("quiet zones (measured on the committed pixels)", () => {
  // A smooth continuation of the field only: no edge, crease or highlight (block-to-block step), a gentle overall
  // range (white icon labels stay readable), and no banding (clean one-level steps without dither).
  it.each(plan.map((w) => [w.file, w] as const))("%s", async (file, w) => {
    const img = await raw(file);
    for (const q of FORMATS[w.format].quiet) {
      const s = zoneStats(img.data, img.width, q);
      expect(s.step, `${file} ${q.x},${q.y}: an edge`).toBeLessThan(0.5);
      expect(s.range, `${file} ${q.x},${q.y}: too much contrast`).toBeLessThan(8);
      expect(s.bands, `${file} ${q.x},${q.y}: banding`).toBe(0);
    }
  });

  it.each(plan.map((w) => [w.file, w] as const))(
    "%s is mid-tone behind the icons and labels",
    async (file, w) => {
      const img = await raw(file);
      const q = FORMATS[w.format].quiet[0] as (typeof FORMATS)["desktop"]["quiet"][number];
      // mean L* of the zone: not black, not white; white labels keep at least 4.5 : 1 against it
      let sum = 0;
      let n = 0;
      for (let y = q.y; y < q.y + q.h; y += 16)
        for (let x = q.x; x < q.x + q.w; x += 16) {
          const o = (y * img.width + x) * 3;
          sum += lstar(img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0);
          n++;
        }
      const mean = sum / n;
      expect(mean).toBeGreaterThan(30);
      expect(mean).toBeLessThan(48);
    },
  );
});

describe("the mark", () => {
  it("is geometry.ts snapped to whole pixels", () => {
    for (const size of Object.values(MARK_PLACE).map((p) => p.size)) {
      const m = fitMark(size);
      const k = size / 100;
      expect(m.fill).toEqual(
        markPaths({ v: 19 * k, h: 17.5 * k, stemX: 19.5 * k, crossbarY: 48.5 * k, size }, true),
      );
      for (const n of [...m.pieces.base, ...m.pieces.accent].flat(2))
        expect(Number.isInteger(n), `${size}: ${n}`).toBe(true);
    }
  });

  it("sits in the same calm place in every format, clear of the quiet zones", () => {
    for (const [format, p] of Object.entries(MARK_PLACE) as [
      keyof typeof FORMATS,
      (typeof MARK_PLACE)["desktop"],
    ][]) {
      const f = FORMATS[format];
      expect(p.x + p.size).toBeLessThan(f.width);
      for (const q of f.quiet) {
        const apart = p.x + p.size <= q.x || p.x >= q.x + q.w || p.y + p.size <= q.y || p.y >= q.y + q.h;
        expect(apart, `${format} mark vs ${q.x},${q.y}`).toBe(true);
      }
    }
  });

  it.each(plan.map((w) => [w.file, w] as const))(
    "%s: the T and stem lean to ink, the crossbar and right stem to light verdigris (never swapped)",
    async (file, w) => {
      const img = await raw(file);
      const p = MARK_PLACE[w.format];
      const m = fitMark(p.size);
      const mean = (cx: number, cy: number) => {
        let s = 0;
        for (let y = -2; y <= 2; y++)
          for (let x = -2; x <= 2; x++) {
            const o = ((Math.round(cy) + y) * img.width + Math.round(cx) + x) * 3;
            s += lstar(img.data[o] ?? 0, img.data[o + 1] ?? 0, img.data[o + 2] ?? 0);
          }
        return s / 25;
      };
      const stem = mean(p.x + (m.s1 + m.s2) / 2, p.y + (m.h + m.size) / 2); // base: the shared stem
      const right = mean(p.x + (m.rx + m.size) / 2, p.y + (m.cBot + m.size) / 2); // accent: the right stem
      const ground = mean(p.x + (m.s2 + m.rx) / 2, p.y + (m.cBot + m.size) / 2); // between the stems
      expect(stem).toBeLessThan(ground - 1);
      expect(right).toBeGreaterThan(ground + 1);
    },
  );
});
