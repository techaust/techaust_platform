// Share images (WEB-OG): the path of a page's image, the category, the dist check (a wrong size fails) and the real
// renderer (a 1200 x 630 PNG; a title that cannot fit fails the build). Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOgRenderer } from "../../../packages/ui/src/brand/og-render.ts";
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

  it("prints the title without the site suffix", () => {
    expect(og.imageTitle("Pricing: published starting prices | TecHaust")).toBe(
      "Pricing: published starting prices",
    );
    expect(og.imageTitle("TecHaust Technologies: Software and AI automation studio")).toBe(
      "TecHaust Technologies: Software and AI automation studio",
    );
    expect(og.imageTitle("Thanks | TecHaust Technologies")).toBe("Thanks");
  });
});

describe("the renderer", () => {
  it("renders a 1200 x 630 PNG", async () => {
    const r = await createOgRenderer();
    const png = await r.png({
      title: "Automation for CA firms, finance and legal teams",
      category: "Industries",
    });
    expect(og.pngSize(png)).toEqual({ width: 1200, height: 630 });
    expect(r.svg({ title: "Pricing", category: "Pricing" })).toContain('viewBox="0 0 1200 630"');
  });

  it("shrinks a long title to fit three lines and refuses one that cannot fit", async () => {
    const r = await createOgRenderer();
    expect(() =>
      r.svg({
        title: "A fairly long title for a page that wraps over several lines of the share image",
        category: "Company",
      }),
    ).not.toThrow();
    expect(() => r.svg({ title: "word ".repeat(80), category: "Company" })).toThrow(/does not fit/);
  });

  it("fails on a character the font does not have (it would print as a box)", async () => {
    const r = await createOgRenderer();
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
