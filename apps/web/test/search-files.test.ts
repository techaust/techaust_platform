// The sitemap, robots.txt and llms.txt (WEB-G-11, WEB-G-17): indexable pages only, a dated and stable lastmod, both
// robots modes, the llms.txt format. Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as seo from "../../../scripts/web-seo-checks.mjs";
import { pageDates } from "../src/content/page-dates";
import { liveServices } from "../src/content/services";
import { buildLlms, buildRobots, buildSitemap, pageUrl } from "../src/lib/search-files";
import { type PostLike, sitePages } from "../src/lib/site-pages";

const post = (id: string, date: string, updated?: string): PostLike => ({
  id,
  data: {
    title: `Post ${id}`,
    description: `About ${id} & more`,
    date: new Date(date),
    ...(updated ? { updated: new Date(updated) } : {}),
  },
});

describe("sitePages (WEB-G-11, WEB-G-17)", () => {
  const pages = sitePages([
    post("a-post", "2026-11-02T10:00:00Z"),
    post("b-post", "2026-11-03T10:00:00Z", "2026-12-01T10:00:00Z"),
  ]);
  const paths = pages.map((p) => p.path);

  it("lists the home page, every live service, the industries, the company pages, the blog and the legal pages", () => {
    expect(paths).toContain("/");
    for (const s of liveServices()) expect(paths).toContain(`/services/${s.slug}`);
    for (const p of [
      "/industries",
      "/pricing",
      "/about",
      "/contact",
      "/get-a-quote",
      "/blog",
      "/privacy",
      "/security",
    ])
      expect(paths).toContain(p);
    expect(paths).toContain("/blog/a-post");
  });

  it("never lists the 404, /thanks, a preview page, a draft or a flagged-off service", () => {
    expect(paths.some((p) => /404|thanks|preview/.test(p))).toBe(false);
    // S3 (DPDP Readiness) is flagged off: exactly the live services have a page.
    expect(paths.filter((p) => p.startsWith("/services/"))).toHaveLength(liveServices().length);
  });

  it("dates a post by updated ?? date (IST day), a legal page by its effective date, other pages by the map", () => {
    const by = Object.fromEntries(pages.map((p) => [p.path, p.lastmod]));
    expect(by["/blog/a-post"]).toBe("2026-11-02");
    expect(by["/blog/b-post"]).toBe("2026-12-01");
    expect(by["/privacy"]).toBe("2026-10-22");
    expect(by["/pricing"]).toBe(pageDates["/pricing"]);
  });

  it("fails the build for a page without a date", () => {
    const { "/pricing": _gone, ...rest } = pageDates;
    expect(() => sitePages([], [], rest)).toThrow(/no lastmod for \/pricing/);
    expect(() => sitePages([], [], { ...pageDates, "/pricing": "23 Oct 2026" })).toThrow(/YYYY-MM-DD/);
  });
});

describe("sitemap.xml", () => {
  const pages = sitePages([post("a-post", "2026-11-02T10:00:00Z")]);

  it("is XML with absolute URLs, a dated lastmod each, and no trailing slash except the home page", () => {
    const xml = buildSitemap(pages);
    const entries = seo.parseSitemap(xml);
    expect(entries).toHaveLength(pages.length);
    expect(entries.map((e: { loc: string }) => e.loc)).toContain("https://techaust.com/");
    expect(entries.map((e: { loc: string }) => e.loc)).toContain("https://techaust.com/services/app-rescue");
    for (const e of entries) expect(e.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("is byte-identical across builds, whatever order the pages come in", () => {
    const a = buildSitemap(pages);
    expect(buildSitemap(sitePages([post("a-post", "2026-11-02T10:00:00Z")]))).toBe(a);
    expect(buildSitemap([...pages].reverse())).toBe(a);
  });

  it("escapes XML characters in a URL", () => {
    const xml = buildSitemap([
      { path: "/a&b", section: "Company", name: "x", description: "x", lastmod: "2026-01-01" },
    ]);
    expect(xml).toContain("<loc>https://techaust.com/a&amp;b</loc>");
  });

  it("pageUrl keeps the slash of the home page only", () => {
    expect(pageUrl("/")).toBe("https://techaust.com/");
    expect(pageUrl("/about")).toBe("https://techaust.com/about");
  });

  it("the sitemap check fails for a missing page, an extra page and a missing date", () => {
    const xml = buildSitemap(pages);
    const built = [
      "index.html",
      "404.html",
      "thanks.html",
      ...pages.filter((p) => p.path !== "/").map((p) => `${p.path.slice(1)}.html`),
    ];
    expect(seo.checkSitemap(xml, built)).toEqual([]);
    expect(seo.checkSitemap(xml, [...built, "new-page.html"]).join()).toContain(
      "https://techaust.com/new-page is missing",
    );
    expect(
      seo
        .checkSitemap(
          xml,
          built.filter((n) => n !== "about.html"),
        )
        .join(),
    ).toContain("listed but not built");
    expect(
      seo.checkSitemap(xml.replace("<lastmod>2026-10-23</lastmod>", "<lastmod></lastmod>"), built).join(),
    ).toContain("no ISO lastmod");
  });
});

describe("robots.txt (WEB-G-11)", () => {
  it("closes the site to crawlers unless it is the production build", () => {
    expect(buildRobots(false)).toContain("Disallow: /");
    expect(buildRobots(false)).not.toContain("Allow:");
    expect(buildRobots(false)).not.toContain("Sitemap:");
  });

  it("allows everything and names the sitemap in production", () => {
    const r = buildRobots(true);
    expect(r).toContain("User-agent: *\nAllow: /");
    expect(r).not.toContain("Disallow");
    expect(r).toContain("Sitemap: https://techaust.com/sitemap.xml");
  });

  it("the built robots.txt matches the build environment (closed unless CLOUDFLARE_ENV=production)", () => {
    const file = fileURLToPath(new URL("../dist/robots.txt", import.meta.url));
    if (!existsSync(file)) return;
    expect(readFileSync(file, "utf8")).toBe(buildRobots(process.env.CLOUDFLARE_ENV === "production"));
  });
});

describe("llms.txt (llmstxt.org)", () => {
  const pages = sitePages();
  const txt = buildLlms(pages, "A summary line.", "TecHaust Technologies");

  it("starts with an H1 and a blockquote summary, then H2 sections of links with descriptions", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toBe("# TecHaust Technologies");
    expect(lines[2]).toBe("> A summary line.");
    expect(txt).toContain("## Services");
    expect(txt).toContain("## Industries");
    expect(txt).toContain("## Company");
    expect(txt).toContain("## Legal");
    for (const l of lines.filter((x) => x.startsWith("- ")))
      expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/techaust\.com[^)]*\): \S/);
    expect(txt.endsWith("\n")).toBe(true);
  });

  it("has no Blog section without a published post, and lists posts once there are some", () => {
    expect(txt).not.toContain("## Blog");
    expect(buildLlms(sitePages([post("a-post", "2026-11-02T10:00:00Z")]), "s", "n")).toContain("## Blog");
  });

  it("uses the pages' own meta descriptions, and only live pages", () => {
    const first = pages.find((p) => p.path === "/services/app-rescue");
    expect(first && txt).toContain(first?.description);
    expect(txt).not.toContain("/thanks");
    expect(txt).not.toContain("/404");
  });
});
