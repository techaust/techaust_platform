// Share images (WEB-OG): the path of a page's image, the category, the dist check (a wrong size fails) and the real
// renderer (a 1200 x 630 PNG; a title that cannot fit fails the build). Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createOgRenderer, type OgRenderer } from "../../../packages/ui/src/brand/og-render.ts";
// @ts-expect-error plain .mjs without types
import * as og from "../../../scripts/web-og.mjs";
// @ts-expect-error plain .mjs without types
import { walk } from "../../../scripts/web-shared.mjs";
import { ogPath } from "../src/lib/og";

describe("ogPath and ogCategory", () => {
  it("names the image after the page path", () => {
    expect(ogPath("/")).toBe("/og/index.png");
    expect(ogPath("/index.html")).toBe("/og/index.png");
    expect(ogPath("/services/app-rescue.html")).toBe("/og/services-app-rescue.png");
    expect(ogPath("/about")).toBe("/og/about.png");
  });

  it("gives each page a category from its path", () => {
    expect(og.ogCategory("/services/app-rescue")).toBe("Services");
    expect(og.ogCategory("/industries/saas-startups")).toBe("Industries");
    expect(og.ogCategory("/blog/x")).toBe("Blog");
    expect(og.ogCategory("/pricing")).toBe("Pricing");
    expect(og.ogCategory("/privacy")).toBe("Legal");
    expect(og.ogCategory("/about")).toBe("Company");
    expect(og.ogCategory("/")).toBe("Company");
  });

  it("prints the title without the site suffix, a second clause or a leading company name", () => {
    expect(og.imageTitle("Pricing: published starting prices | TecHaust")).toBe(
      "Pricing: published starting prices",
    );
    // The lockup above the title already names the company.
    expect(og.imageTitle("TecHaust Technologies: Software and AI automation studio")).toBe(
      "Software and AI automation studio",
    );
    expect(og.imageTitle("Thanks | TecHaust Technologies")).toBe("Thanks");
    expect(og.imageTitle("About TecHaust Technologies | Senior software studio, India")).toBe(
      "About TecHaust Technologies",
    );
    expect(og.imageTitle("TecHaust Technologies")).toBe("TecHaust Technologies");
  });
});

describe("the renderer", () => {
  // One renderer for the file: loading the fonts and the brand master is the slow part.
  let r: OgRenderer;
  beforeAll(async () => {
    r = await createOgRenderer();
  });

  it("renders a 1200 x 630 PNG", async () => {
    const png = await r.png({
      title: "Automation for CA firms, finance and legal teams",
      category: "Industries",
    });
    expect(og.pngSize(png)).toEqual({ width: 1200, height: 630 });
    expect(r.svg({ title: "Pricing", category: "Pricing" })).toContain('viewBox="0 0 1200 630"');
  });

  it("sets short titles large and long ones smaller, on at most three balanced lines", async () => {
    expect(r.layout("Privacy notice")).toEqual({ lines: ["Privacy notice"], cap: 64, fallback: "none" });
    const long = r.layout("Add AI features, MCP servers and agent-ready APIs");
    expect(long.fallback).toBe("none");
    expect(long.lines.length).toBeLessThanOrEqual(3);
    expect(long.cap).toBeLessThan(64);
    // Breaks where the title's own phrasing does, and never leaves one short word alone on the last line.
    expect(r.layout("Cross-platform mobile apps: React Native, Flutter").lines).toContain(
      "React Native, Flutter",
    );
    const rescue = r.layout("App rescue and production-readiness audit").lines;
    expect(rescue[rescue.length - 1]).not.toBe("audit");
  });

  it("falls back to the part before the colon, then to whole words and an ellipsis (never fails on length)", async () => {
    const colon = r.layout(
      "A deliberately overlong sample title: it runs on well past three lines to show the shorter fallback rule at work here",
    );
    expect(colon).toMatchObject({
      fallback: "before-colon",
      lines: ["A deliberately", "overlong sample title"],
    });
    const words = r.layout("word ".repeat(80));
    expect(words.fallback).toBe("ellipsis");
    expect(words.lines.length).toBeLessThanOrEqual(3);
    expect(words.lines.at(-1)).toMatch(/word…$/);
    expect(() => r.svg({ title: "word ".repeat(80), category: "Company" })).not.toThrow();
  });

  it("draws the lockup and the mark from the brand master, never the name in a live font", async () => {
    const svg = r.svg({ title: "Privacy notice", category: "Legal" });
    expect(svg).not.toMatch(/<text\b/);
    expect(svg).toContain("<title>TecHaust Technologies</title>");
  });

  it("fails on a character the font does not have (it would print as a box)", async () => {
    expect(() => r.svg({ title: "Price ₹ 5", category: "Company" })).toThrow(/no glyph/);
  });
});

describe("checkOgImage (WEB-OG)", () => {
  const html = (content: string) => `<meta property="og:image" content="${content}" />`;
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const read = (bytes: Buffer | undefined) => () => bytes;

  it("accepts a 1200 x 630 PNG", () => {
    expect(og.checkOgImage("a.html", html("https://techaust.com/og/a.png"), read(png(1200, 630)))).toEqual(
      [],
    );
  });

  it("fails on the wrong size, a file that is not a PNG, a missing file and a missing or relative og:image", () => {
    expect(
      og.checkOgImage("a.html", html("https://techaust.com/og/a.png"), read(png(1200, 627))).join(),
    ).toContain("1200x627");
    expect(
      og
        .checkOgImage(
          "a.html",
          html("https://techaust.com/og/a.png"),
          read(Buffer.from("GIF89a...........................")),
        )
        .join(),
    ).toContain("not a PNG");
    expect(
      og.checkOgImage("a.html", html("https://techaust.com/og/a.png"), read(undefined)).join(),
    ).toContain("not in dist");
    expect(og.checkOgImage("a.html", "<html></html>", read(undefined)).join()).toContain("no og:image");
    expect(og.checkOgImage("a.html", html("/og/a.png"), read(png(1200, 630))).join()).toContain("absolute");
  });
});

describe("the built site (needs apps/web/dist)", () => {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const has = existsSync(`${dist}/og`);

  it.skipIf(!has)("every page's image exists and every image is used once", () => {
    const targets = og.ogTargets(dist) as { name: string; image: string }[];
    expect(targets.length).toBeGreaterThan(30);
    expect(new Set(targets.map((t) => t.image)).size).toBe(targets.length);
    const problems: string[] = [];
    for (const f of (walk(dist) as string[]).filter((x) => x.endsWith(".html"))) {
      const name = f.slice(dist.length + 1).replaceAll("\\", "/");
      problems.push(...og.checkOgImage(name, readFileSync(f, "utf8"), og.readDist(dist)));
    }
    expect(problems).toEqual([]);
  });
});
