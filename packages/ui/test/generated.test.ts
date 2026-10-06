// The generated files are committed (packages are source-only). These tests fail when they drift from
// tokens/tokens.json or the committed fonts; fix with `pnpm --filter @techaust/ui build:tokens` / `build:fonts`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";
import { fontsCssFromDisk } from "../src/fonts/disk.ts";
import { fluidSize, tokens } from "../src/tokens/model.ts";
import { generatedFiles } from "../src/tokens/outputs.ts";

const root = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(root, f), "utf8");

describe("generated token files are up to date", () => {
  it.each(Object.entries(generatedFiles()))("%s", (file, expected) => {
    expect(read(file)).toBe(expected);
  });

  it("generated/fonts.css", () => {
    expect(read("generated/fonts.css")).toBe(fontsCssFromDisk(root));
  });
});

describe("token outputs", () => {
  it("fluid type hits the documented min and max at the 360/1280 px viewports", () => {
    const at = (css: string, vw: number) => {
      const m = /clamp\(([\d.]+)rem, ([\d.]+)rem \+ ([\d.]+)vw, ([\d.]+)rem\)/.exec(css);
      if (!m) throw new Error(css);
      const [, lo, b, s, hi] = m.map(Number) as [number, number, number, number, number];
      return Math.min(hi * 16, Math.max(lo * 16, b * 16 + (s * vw) / 100));
    };
    for (const tok of Object.values(tokens.text)) {
      if ("size" in tok) continue;
      const css = fluidSize(tok.min, tok.max);
      expect(at(css, 360)).toBeCloseTo(tok.min, 1);
      expect(at(css, 1280)).toBeCloseTo(tok.max, 1);
    }
  });

  it("no text token is below 12 px, and body text is at least 16 px (docs/06 §3.2)", () => {
    for (const [name, tok] of Object.entries(tokens.text)) {
      expect("size" in tok ? tok.size : tok.min, name).toBeGreaterThanOrEqual(12);
    }
    expect(tokens.email.bodySize).toBeGreaterThanOrEqual(16);
    const body = tokens.text.body;
    expect(body && "size" in body ? body.size : 0).toBeGreaterThanOrEqual(16);
  });

  it("dark mode follows the OS, honours data-theme, and reduced motion zeroes durations", () => {
    const css = read("generated/tokens.css");
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
    expect(css).toContain(':root[data-theme="dark"] {');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\n {2}:root \{\n {4}--duration-fast: 0ms;/);
  });
});

describe("Tailwind v4 theme", async () => {
  const compiler = await compile(`${read("generated/theme.css")}\n@tailwind utilities;`, {
    base: root,
    loadStylesheet: async (id) => {
      throw new Error(`unexpected @import ${id}`);
    },
  });
  const css = compiler.build([
    "bg-bg",
    "text-text-muted",
    "font-display",
    "text-display-1",
    "shadow-1",
    "rounded-md",
    "md:p-4",
    "bg-red-500",
    "text-xl",
  ]);

  it("generates utilities from our tokens, as CSS variables (so dark mode switches them)", () => {
    expect(css).toMatch(/\.bg-bg \{\s*background-color: var\(--color-bg\);/);
    expect(css).toMatch(/\.text-text-muted \{\s*color: var\(--color-text-muted\);/);
    expect(css).toMatch(/\.font-display \{\s*font-family: var\(--font-display\);/);
    expect(css).toContain("font-size: var(--text-display-1)");
    expect(css).toContain("--tw-shadow: var(--elevation-1)");
    expect(css).toContain("@media (width >= 48rem)");
  });

  it("removes Tailwind's default palette and scales (tokens only)", () => {
    expect(css).not.toContain(".bg-red-500");
    expect(css).not.toContain(".text-xl");
  });
});
