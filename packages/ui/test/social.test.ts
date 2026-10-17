// The social media kit (docs/runs/brand-social-kit.md): the platform table matches the brief, every composition
// keeps to the brand rules (palette only, flat, whole pixels, the mark's colour logic), content stays inside each
// platform's safe zone (checked on the geometry and on rendered pixels), and, once the owner has approved the
// preview and the files are committed, the files are current, exact, sRGB and under each platform's limit.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { outDir } from "../scripts/out-dir.ts";
import { createBrand, parseMaster, SCHEMES } from "../src/brand/compose.ts";
import { LOCKUP } from "../src/brand/geometry.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import {
  type Box,
  lockupCanvas,
  PLATFORMS,
  SOCIAL_ITEMS,
  SOCIAL_KIT_COMMITTED,
  type SocialFile,
  socialPlan,
  socialReadme,
  TILE_MARK_RATIO,
  WORDMARK_UNITS,
  type Zone,
} from "../src/brand/social.ts";
import { fitMark } from "../src/brand/wallpapers.ts";
import { tokens } from "../src/tokens/model.ts";

const root = join(import.meta.dirname, "..");
const dir = join(root, "brand", "social");
const brand = createBrand(parseMaster(readFileSync(join(root, "brand/source/techaust-master.svg"), "utf8")));
const plan = socialPlan(brand);
const scaleOf = (f: SocialFile) => f.width / f.item.width;
const MB = 1024 * 1024;

describe("the platform table (the brief, plus Threads: owner addition 2026-10-16)", () => {
  // folder/name → [width, height, @2x]
  const brief: Record<string, [number, number, boolean]> = {
    "linkedin/company-logo": [400, 400, true],
    "linkedin/company-cover": [1512, 256, true],
    "linkedin/founder-background": [1584, 396, true],
    "x/profile": [400, 400, true],
    "x/header": [1500, 500, true],
    "facebook/profile": [320, 320, true],
    "facebook/cover": [851, 315, true],
    "instagram/profile": [320, 320, false],
    "instagram/profile-1080": [1080, 1080, false],
    "instagram/highlight-services": [1080, 1920, false],
    "instagram/highlight-work": [1080, 1920, false],
    "instagram/highlight-about": [1080, 1920, false],
    "instagram/highlight-contact": [1080, 1920, false],
    "instagram/post-template-square": [1080, 1080, false],
    "instagram/post-template-portrait": [1080, 1350, false],
    "threads/profile": [320, 320, false],
    "threads/profile-1080": [1080, 1080, false],
    "whatsapp-business/profile": [640, 640, false],
    "whatsapp-business/profile-1080": [1080, 1080, false],
    "whatsapp-business/cover": [1920, 1080, false],
    "google-business/logo": [720, 720, true],
    "google-business/cover": [1920, 1080, false],
    "youtube/profile": [800, 800, true],
    "youtube/banner": [2560, 1440, false],
    "upwork/agency-logo": [250, 250, true],
    "upwork/agency-banner": [3200, 320, false],
    "clutch/logo": [1000, 1000, false],
    "goodfirms/logo": [1000, 1000, false],
    "github/org-avatar": [1000, 1000, false],
  };

  it("has exactly the brief's items at the brief's sizes (plus the two transparent lockups)", () => {
    const got = Object.fromEntries(
      SOCIAL_ITEMS.filter((i) => !i.transparent).map((i) => [
        `${i.platform}/${i.name}`,
        [i.width, i.height, i.x2],
      ]),
    );
    expect(got).toEqual(brief);
    expect(SOCIAL_ITEMS.filter((i) => i.transparent).map((i) => `${i.platform}/${i.name}`)).toEqual([
      "clutch/lockup",
      "goodfirms/lockup",
    ]);
  });

  it("the files: <name>.png, @2x at exactly double size, the Facebook JPG and the two template SVGs", () => {
    for (const f of plan) {
      const k = f.file.includes("@2x") ? 2 : 1;
      expect([f.width, f.height], f.file).toEqual([f.item.width * k, f.item.height * k]);
    }
    expect(plan.filter((f) => f.kind === "jpg").map((f) => f.file)).toEqual(["facebook/cover.jpg"]);
    expect(plan.filter((f) => f.kind === "svg").map((f) => f.file)).toEqual([
      "instagram/post-template-square.svg",
      "instagram/post-template-portrait.svg",
    ]);
    expect(new Set(plan.map((f) => f.file)).size).toBe(plan.length);
  });

  it("an @2x file is drawn again at double size, not scaled from the 1x drawing", () => {
    for (const f of plan.filter((x) => x.file.includes("@2x"))) {
      const one = plan.find((x) => x.file === f.file.replace("@2x", "")) as SocialFile;
      expect(f.svg).not.toBe(one.svg);
      expect(f.svg).not.toMatch(/scale\(2\)/);
    }
  });

  it("every platform has README text, and the README links the bios instead of repeating them", () => {
    const readme = socialReadme(plan);
    for (const p of PLATFORMS) expect(readme, p).toContain(`(\`${p}/\`)`);
    expect(readme).toContain("(../../../../docs/07-content-appendix/B-social-profiles.md)");
    expect(readme).not.toMatch(/https?:\/\//); // no account URLs
  });

  it("a minimum file size only where a platform states one (Google Business: 10 KB, both items)", () => {
    expect(
      SOCIAL_ITEMS.filter((i) => i.minBytes !== undefined).map((i) => [
        `${i.platform}/${i.name}`,
        i.minBytes,
      ]),
    ).toEqual([
      ["google-business/logo", 10 * 1024],
      ["google-business/cover", 10 * 1024],
    ]);
  });

  it("the README gives @2x rows as double size and states Google's 10 KB floor", () => {
    const readme = socialReadme(plan);
    for (const row of readme.split("\n").filter((l) => l.includes("@2x.png`")))
      expect(row).toMatch(
        /\| Double size of the above\.( At least 10 KB, the platform's minimum file size\.)? \|$/,
      );
    expect(readme).toContain(
      "| `logo.png` | 720 × 720 | Logo: square, often shown as a circle. At least 10 KB",
    );
  });

  it("the transparent lockup's canvas matches the master's wordmark width", () => {
    const vb = brand.viewBox[2] ?? 0;
    expect(vb - (100 * LOCKUP.markScale + LOCKUP.gap)).toBeCloseTo(WORDMARK_UNITS, 2);
    const c = lockupCanvas();
    const lockup = plan.find((f) => f.file === "clutch/lockup.png") as SocialFile;
    const box = lockup.parts[0]?.box as Box;
    expect(box.x).toBe(c.pad);
    expect(box.y).toBe(c.pad);
    expect(box.x + box.w).toBeLessThanOrEqual(c.width - c.pad + 1);
  });
});

describe("drawing rules", () => {
  const palette = new Set(Object.values(tokens.palette).map((h) => h.toUpperCase()));

  it.each(plan.map((f) => [f.file, f.svg] as const))("%s: palette colours only, flat", (_, svg) => {
    for (const m of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g))
      expect(palette.has(m[0].toUpperCase()), m[0]).toBe(true);
    // every colour attribute is a palette hex (or none): no named colours, #fff, rgb() or hsl()
    const colours = [
      ...svg.matchAll(/\b(fill|stroke|stop-color|flood-color|lighting-color|color)="([^"]*)"/g),
    ];
    expect(colours.length).toBeGreaterThan(0);
    for (const [, attr, value] of colours)
      expect(value === "none" || /^#[0-9A-F]{6}$/i.test(value ?? ""), `${attr}="${value}"`).toBe(true);
    expect(svg).not.toMatch(/rgba?\(|hsla?\(|style=|currentColor/i);
    expect(svg).not.toMatch(/Gradient|<filter|opacity|<text|<image|<style/);
  });

  it.each(plan.map((f) => [f.file, f.svg] as const))("%s: every placement is on whole pixels", (_, svg) => {
    for (const m of svg.matchAll(/translate\(([-\d.]+) ([-\d.]+)\)/g))
      expect(Number.isInteger(Number(m[1])) && Number.isInteger(Number(m[2])), m[0]).toBe(true);
    // type is set at integer cap heights (scale = cap / 100)
    for (const m of svg.matchAll(/scale\(([\d.]+)\)/g))
      expect(Number.isInteger(Math.round(Number(m[1]) * 1e4) / 100), m[0]).toBe(true);
  });

  it("colour logic: the T and shared stem mist (ink on light), the crossbar and right stem verdigris, never swapped", () => {
    const want = {
      base: new Set<string>([SCHEMES.dark.base, SCHEMES.color.base]),
      accent: new Set<string>([SCHEMES.dark.accent, SCHEMES.color.accent]),
    };
    for (const f of plan) {
      const parts = [...f.svg.matchAll(/<path data-part="(base|accent)" fill="([^"]+)" d="([^"]+)"\/>/g)];
      const isMotif = f.item.name.startsWith("highlight-") && f.item.name !== "highlight-about";
      if (isMotif) continue;
      expect(parts.length, f.file).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < parts.length; i += 2) {
        const [, p1, fill1, d1] = parts[i] as RegExpMatchArray;
        const [, p2, fill2, d2] = parts[i + 1] as RegExpMatchArray;
        expect([p1, p2], f.file).toEqual(["base", "accent"]);
        // the shapes are geometry.ts's, fitted at the mark's size (the base path ends "V<size>H<s1>Z")
        const size = Number(/V(\d+)H\d+Z$/.exec(d1 ?? "")?.[1]);
        expect(d1, `${f.file} base shape`).toBe(fitMark(size).fill.base);
        expect(d2, `${f.file} accent shape`).toBe(fitMark(size).fill.accent);
        expect(want.base.has(fill1 ?? ""), `${f.file} base ${fill1}`).toBe(true);
        expect(want.accent.has(fill2 ?? ""), `${f.file} accent ${fill2}`).toBe(true);
      }
    }
  });

  it("watermarks are tone-on-tone (ink-700 on the ink ground)", () => {
    for (const f of plan)
      for (const m of f.svg.matchAll(/data-role="watermark" fill="([^"]+)"/g))
        expect(m[1], f.file).toBe(tokens.palette["ink-700"]?.toUpperCase());
  });

  it("is deterministic", () => {
    expect(socialPlan(brand).map((f) => f.svg)).toEqual(plan.map((f) => f.svg));
  });
});

describe("safe zones", () => {
  const inside = (b: Box, z: Zone, k: number, clear = 0) => {
    if (z.shape === "rect")
      return b.x >= z.x * k && b.y >= z.y * k && b.x + b.w <= (z.x + z.w) * k && b.y + b.h <= (z.y + z.h) * k;
    const corners = [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ];
    return corners.every(([x, y]) => Math.hypot((x ?? 0) - z.cx * k, (y ?? 0) - z.cy * k) <= z.r * k - clear);
  };

  it.each(plan.map((f) => [f.file, f] as const))("%s: the mark, type and motifs stay inside", (file, f) => {
    const k = scaleOf(f);
    const content = f.parts.filter((p) => p.role !== "watermark");
    expect(content.length, file).toBeGreaterThan(0);
    for (const p of content) {
      // profile pictures: the mark inside the inscribed circle with one stroke of clear space
      const clear = p.role === "mark" && f.item.shown !== "story circle" ? 0.19 * p.box.w : 0;
      expect(
        f.item.safe.some((z) => inside(p.box, z, k, clear)),
        `${file}: ${p.role} at ${Math.round(p.box.x)},${Math.round(p.box.y)} ${Math.round(p.box.w)}×${Math.round(p.box.h)}`,
      ).toBe(true);
    }
  });

  it("profile tiles use the reference mark ratio and centre the mark on whole pixels", () => {
    for (const f of plan.filter(
      (x) => x.item.width === x.item.height && x.parts.length === 1 && !x.item.transparent,
    )) {
      if (f.item.name.startsWith("post-template")) continue;
      const b = f.parts[0]?.box as Box;
      expect(Math.abs(b.w / f.width - TILE_MARK_RATIO), f.file).toBeLessThan(0.01);
      expect(Math.abs(b.x + b.w / 2 - f.width / 2), f.file).toBeLessThanOrEqual(0.5);
    }
  });

  // Rendered pixels: outside every safe zone a cover holds only the ground and the tone-on-tone watermark.
  const hex = (h: string) =>
    [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const lstar = ([r, g, b]: [number, number, number]) => {
    const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
    const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  };
  const ground = lstar(hex(tokens.palette["ink-900"] ?? ""));
  const banners = plan.filter(
    (f) => f.kind === "png" && !f.file.includes("@2x") && f.item.shown === "banner",
  );

  it.each(banners.map((f) => [f.file, f] as const))(
    "%s: quiet outside the safe zone (rendered)",
    async (file, f) => {
      const { data, info } = await sharp(Buffer.from(f.svg), { limitInputPixels: false })
        .flatten()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const zones = f.item.safe.filter((z): z is Extract<Zone, { shape: "rect" }> => z.shape === "rect");
      let worst = 0;
      for (let y = 0; y < info.height; y += 2)
        for (let x = 0; x < info.width; x += 2) {
          if (zones.some((z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h)) continue;
          const o = (y * info.width + x) * info.channels;
          worst = Math.max(
            worst,
            Math.abs(lstar([data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0]) - ground),
          );
        }
      expect(worst, file).toBeLessThanOrEqual(6);
    },
  );
});

describe("build:social --out (the folder is emptied first, so only inside .logs/)", () => {
  const repo = resolve("/repo");
  const fallback = join(repo, "packages", "ui", "brand", "social");
  const run = (...args: string[]) => outDir(args, repo, fallback, repo);

  it("accepts a folder strictly inside .logs/, relative or absolute", () => {
    expect(run()).toBe(fallback);
    expect(run("--zip")).toBe(fallback);
    expect(run("--out", ".logs/social/kit")).toBe(join(repo, ".logs", "social", "kit"));
    expect(run("--out", join(repo, ".logs", "x"), "--zip")).toBe(join(repo, ".logs", "x"));
    expect(run("--out", ".logs/..x")).toBe(join(repo, ".logs", "..x"));
  });

  it.each([
    ["a missing value", ["--out"]],
    ["an empty value", ["--out", ""]],
    ["another flag", ["--out", "--zip"]],
    [".logs itself", ["--out", ".logs"]],
    [".logs with a trailing slash", ["--out", ".logs/"]],
    ["the repository", ["--out", "."]],
    ["a source folder", ["--out", "packages/ui"]],
    ["an escape from .logs", ["--out", ".logs/../packages"]],
    ["a folder outside the repository", ["--out", resolve(repo, "..", "elsewhere")]],
    ["another drive", ["--out", process.platform === "win32" ? "Z:\\kit" : "/elsewhere/kit"]],
  ])("rejects %s", (_, args) => {
    expect(() => run(...args)).toThrow(/--out/);
  });
});

describe.runIf(SOCIAL_KIT_COMMITTED)("committed files (after the owner's approval)", () => {
  const all = (d: string): string[] =>
    readdirSync(d).flatMap((n) =>
      statSync(join(d, n)).isDirectory() ? all(join(d, n)) : [relative(dir, join(d, n))],
    );

  it("every file is present, and nothing else", () => {
    const want = [...plan.map((f) => f.file), "README.md"].sort();
    expect(
      all(dir)
        .map((f) => f.replaceAll("\\", "/"))
        .sort(),
    ).toEqual(want);
  });

  it("the README is current", () => {
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(socialReadme(plan));
  });

  it.each(plan.map((f) => [f.file, f] as const))(
    "%s: current, exact, sRGB 8-bit, within the limits",
    async (file, f) => {
      const buf = readFileSync(join(dir, file));
      if (f.kind === "svg") {
        expect(buf.toString("utf8")).toBe(f.svg);
        return;
      }
      if (f.kind === "jpg") {
        expect(buf.length).toBeLessThan(f.item.jpg?.maxBytes ?? 0);
        expect(buf.toString("latin1")).toContain(`techaust:svg-sha256=${sourceHash(f.svg)}`);
        const m = await sharp(buf).metadata();
        expect([m.width, m.height]).toEqual([f.width, f.height]);
        expect([m.format, m.space, m.channels, m.depth]).toEqual(["jpeg", "srgb", 3, "uchar"]);
        expect(m.icc, "no ICC profile: untagged JPEGs are read as sRGB").toBeUndefined();
        return;
      }
      const info = pngInfo(buf);
      expect([info.width, info.height]).toEqual([f.width, f.height]);
      expect(info.colourType, f.item.transparent ? "RGBA" : "opaque RGB").toBe(f.item.transparent ? 6 : 2);
      expect(info.bitDepth).toBe(8);
      expect(info.srgb).toBe(true);
      expect(info.iccp).toBe(false);
      expect(info.source, "rendered from today's SVG: run build:social").toBe(sourceHash(f.svg));
      expect(buf.length).toBeLessThan(f.item.maxBytes);
      expect(buf.length, "the platform's minimum file size").toBeGreaterThanOrEqual(f.item.minBytes ?? 0);
    },
  );
});

describe.runIf(!SOCIAL_KIT_COMMITTED)("before approval", () => {
  it("brand/social/ does not exist yet (the PNGs wait for the owner's approval of the preview)", () => {
    expect(existsSync(dir)).toBe(false);
  });

  it("every item's limit is sane", () => {
    for (const i of SOCIAL_ITEMS) expect(i.maxBytes, i.name).toBeGreaterThanOrEqual(MB);
  });
});
