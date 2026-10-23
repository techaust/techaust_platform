// The SEO tags on every built page (WEB-G-09) and the JavaScript budget (WEB-G-13, NFR-1): each check must FAIL on bad
// input (fixtures), and the real built site must pass when apps/web/dist exists. Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as seo from "../../../scripts/web-seo-checks.mjs";
// @ts-expect-error plain .mjs without types
import { walk } from "../../../scripts/web-shared.mjs";

const full = (over: Record<string, string | null> = {}, name = "about") => {
  const v: Record<string, string | null> = {
    title: "About TecHaust Technologies",
    description: "A small studio.",
    canonical: `https://techaust.com/${name}`,
    "og:title": "About TecHaust Technologies",
    "og:description": "A small studio.",
    "og:url": `https://techaust.com/${name}`,
    "og:image": "https://techaust.com/og/about.png",
    "twitter:card": "summary_large_image",
    robots: null,
    ...over,
  };
  const meta = (k: string, attr = "property") =>
    v[k] === null ? "" : `<meta ${attr}="${k}" content="${v[k]}" />`;
  return `<html><head>${v.title === null ? "" : `<title>${v.title}</title>`}${meta("description", "name")}${
    v.canonical === null ? "" : `<link rel="canonical" href="${v.canonical}" />`
  }${meta("og:title")}${meta("og:description")}${meta("og:url")}${meta("og:image")}${meta("twitter:card", "name")}${meta("robots", "name")}</head><body><h1>x</h1></body></html>`;
};

describe("checkSeoTags (WEB-G-09)", () => {
  it("accepts a complete indexable page", () => {
    expect(seo.checkSeoTags("about.html", full())).toEqual([]);
  });

  it("fails on a title over 60 characters, a missing title and a differing og:title", () => {
    expect(
      seo.checkSeoTags("about.html", full({ title: "x".repeat(61), "og:title": "x".repeat(61) })).join(),
    ).toContain("61 characters");
    expect(seo.checkSeoTags("about.html", full({ title: null })).join()).toContain("no <title>");
    expect(seo.checkSeoTags("about.html", full({ "og:title": "Other" })).join()).toContain(
      "og:title differs",
    );
  });

  it("counts a decoded character reference as one character", () => {
    const t = `${"x".repeat(59)}&amp;`;
    expect(seo.checkSeoTags("about.html", full({ title: t, "og:title": t }))).toEqual([]);
  });

  it("fails on a canonical that is missing, off the site or not this page's URL (a .html file name)", () => {
    expect(seo.checkSeoTags("about.html", full({ canonical: null })).join()).toContain("no canonical");
    expect(
      seo.checkSeoTags("about.html", full({ canonical: "https://techaust.com/about.html" })).join(),
    ).toContain("canonical");
    expect(seo.checkSeoTags("about.html", full({ canonical: "https://example.com/about" })).join()).toContain(
      "canonical",
    );
  });

  it("fails on a missing og:image, og:url, og:description, twitter:card or description", () => {
    for (const k of ["og:image", "og:url", "og:description", "twitter:card", "description"])
      expect(seo.checkSeoTags("about.html", full({ [k]: null })).join(), k).toContain(k);
  });

  it("allows noindex only on the 404 and /thanks, and requires it there", () => {
    expect(seo.checkSeoTags("about.html", full({ robots: "noindex, nofollow" })).join()).toContain(
      "noindex is only for",
    );
    const noindex = full(
      { robots: "noindex, nofollow", canonical: null, description: null, "og:description": null },
      "thanks",
    );
    expect(seo.checkSeoTags("thanks.html", noindex)).toEqual([]);
    expect(seo.checkSeoTags("404.html", noindex)).toEqual([]);
    expect(
      seo
        .checkSeoTags(
          "404.html",
          full({ robots: null, canonical: null, description: null, "og:description": null }),
        )
        .join(),
    ).toContain("must be noindex");
  });

  it("titles must be unique across pages", () => {
    const a = full();
    expect(
      seo
        .checkUniqueTitles([
          ["a.html", a],
          ["b.html", full()],
        ])
        .join(),
    ).toContain("also the title of a.html");
    expect(
      seo.checkUniqueTitles([
        ["a.html", a],
        ["b.html", full({ title: "Other" })],
      ]),
    ).toEqual([]);
  });
});

describe("JavaScript budget (WEB-G-13, NFR-1)", () => {
  const files: Record<string, string> = {
    "/_astro/a.js": 'import"./b.js";console.log(1)',
    "/_astro/b.js": 'import{x}from"./c.js";export const b=x',
    "/_astro/c.js": "export const x=1",
    "/_astro/big.js": Array.from({ length: 20000 }, (_, i) => `var v${i}=${Math.random()};`).join(""),
  };
  const read = (u: string) => files[u];
  const html = (...srcs: string[]) => srcs.map((s) => `<script type="module" src="${s}"></script>`).join("");

  it("lists the scripts a page loads from its own origin and ignores other origins and inline code", () => {
    const h = `${html("/_astro/a.js")}<script src="https://challenges.cloudflare.com/x.js"></script><script>inline()</script><link rel="modulepreload" href="/_astro/c.js">`;
    expect(seo.pageScripts(h).sort()).toEqual(["/_astro/a.js", "/_astro/c.js"]);
  });

  it("follows static imports, counts each file once and gzips them", () => {
    const { total, files: list } = seo.pageJs(html("/_astro/a.js", "/_astro/b.js"), read);
    expect(list.map((f: { file: string }) => f.file).sort()).toEqual([
      "/_astro/a.js",
      "/_astro/b.js",
      "/_astro/c.js",
    ]);
    expect(total).toBe(
      ["/_astro/a.js", "/_astro/b.js", "/_astro/c.js"].reduce(
        (n, f) => n + gzipSync(Buffer.from(files[f] ?? ""), { level: 9 }).length,
        0,
      ),
    );
  });

  it("does not follow a dynamic import()", () => {
    expect(seo.staticImports('const m=()=>import("./lazy.js");import"./a.js"')).toEqual(["./a.js"]);
  });

  it("measureJs fails a page over 50 KB and a script that is not in dist", () => {
    const over = seo.pageJs(html("/_astro/big.js"), read).total;
    expect(over).toBeGreaterThan(seo.JS_BUDGET_BYTES);
    expect(seo.pageJs(html("/_astro/missing.js"), read).files[0].bytes).toBe(-1);
  });
});

describe("the built site (needs apps/web/dist)", () => {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const names: string[] = existsSync(dist)
    ? (walk(dist) as string[])
        .filter((f) => f.endsWith(".html"))
        .map((f) => f.slice(dist.length + 1).replaceAll("\\", "/"))
    : [];

  it.skipIf(names.length === 0)("every page has its SEO tags, a unique title and its share image", () => {
    const pages: [string, string][] = names.map((n) => [n, readFileSync(`${dist}/${n}`, "utf8")]);
    const problems = [...pages.flatMap(([n, h]) => seo.checkSeoTags(n, h)), ...seo.checkUniqueTitles(pages)];
    expect(problems).toEqual([]);
  });

  it.skipIf(names.length === 0)("no page loads more than 50 KB of gzipped JavaScript", () => {
    const { problems, rows } = seo.measureJs(dist);
    expect(problems).toEqual([]);
    expect(rows[0].total).toBeLessThanOrEqual(seo.JS_BUDGET_BYTES);
  });
});
