// The Lighthouse CI wrapper (scripts/web-lhci.mjs): only the noindex header and robots.txt differ in the copy it serves,
// the config points at the copy, and the thresholds in lighthouserc.json are the ones the brief sets. Runs in Node.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as lhci from "../../../scripts/web-lhci.mjs";

const rc = JSON.parse(readFileSync(fileURLToPath(new URL("../lighthouserc.json", import.meta.url)), "utf8"));

describe("web-lhci", () => {
  it("removes the X-Robots-Tag line from _headers and nothing else", () => {
    const headers = "/*\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n  Referrer-Policy: x\n";
    expect(lhci.withoutNoindex(headers)).toBe(
      "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: x\n",
    );
  });

  it("serves the production robots.txt (allow all)", () => {
    expect(lhci.PRODUCTION_ROBOTS).toContain("Allow: /");
    expect(lhci.PRODUCTION_ROBOTS).not.toContain("Disallow");
  });

  it("points the Worker config's assets at the copy, and refuses a config it does not recognise", () => {
    const cfg = '{ "assets": { "directory": "./dist", "not_found_handling": "404-page" } }';
    expect(lhci.pointAssetsAt(cfg, "./.lhci/site")).toContain('"directory": "./.lhci/site"');
    expect(() => lhci.pointAssetsAt("{}", "./x")).toThrow(/no longer has/);
  });

  it("keeps the full browser when no headless shell sits next to it", () => {
    expect(lhci.headlessShell("/no/such/dir/chromium-1/chrome-linux/chrome")).toBe(
      "/no/such/dir/chromium-1/chrome-linux/chrome",
    );
    expect(lhci.headlessShell("/somewhere/else/chrome")).toBe("/somewhere/else/chrome");
  });
});

describe("lighthouserc.json (WEB-G-13)", () => {
  it("is mobile (no desktop preset), 3 runs, one URL per template, reports to the filesystem only", () => {
    expect(rc.ci.collect.numberOfRuns).toBe(3);
    expect(rc.ci.collect.url.length).toBe(10);
    expect(rc.ci.upload.target).toBe("filesystem");
    expect(JSON.stringify(rc)).not.toMatch(/desktop|temporary-public-storage|"target":"lhci"/);
  });

  it("asserts performance 0.95 and accessibility, best practices and SEO 1 (the 404 has noindex, so no SEO score)", () => {
    const [pages, notFound] = rc.ci.assert.assertMatrix;
    expect(pages.assertions["categories:performance"][1].minScore).toBe(0.95);
    for (const c of ["accessibility", "best-practices", "seo"])
      expect(pages.assertions[`categories:${c}`][1].minScore).toBe(1);
    expect(notFound.assertions["categories:seo"]).toBeUndefined();
    expect(notFound.assertions["categories:accessibility"][1].minScore).toBe(1);
  });
});
