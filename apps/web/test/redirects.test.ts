// The website's _redirects (apps/web/public/_redirects): the old site's paths (owner Q3, 2026-11-07) and any page asked for with a
// trailing slash (production check, 2026-11-08), all permanent. Cloudflare applies the first matching rule, wants static rules before
// dynamic ones, and allows 2,000 static and 100 dynamic rules (developers.cloudflare.com/workers/static-assets/redirects). Runs in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const rules = text
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"))
  .map((l) => l.split(/\s+/));
const dynamic = (source: string) => /[:*]/.test(source);

/** The first rule matching a path, as Cloudflare reads a source (placeholders match one segment, never a slash). */
function target(path: string): [string, string] | null {
  for (const [source = "", to = "", code = ""] of rules) {
    const names: string[] = [];
    const pattern = source
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([A-Za-z]\w*)/g, (_m, n: string) => {
        names.push(n);
        return "([^/]+)";
      });
    const m = new RegExp(`^${pattern}$`).exec(path);
    if (!m) continue;
    let out = to;
    names.forEach((n, i) => {
      out = out.replace(`:${n}`, m[i + 1] ?? "");
    });
    return [out, code];
  }
  return null;
}

describe("apps/web/public/_redirects", () => {
  it("every rule is `source destination 301`, local, and every source is unique", () => {
    for (const r of rules) {
      expect(r, r.join(" ")).toHaveLength(3);
      expect(r[2]).toBe("301");
      expect(r[0]).toMatch(/^\//);
      expect(r[1]).toMatch(/^\/(?!\/)/);
    }
    const sources = rules.map((r) => r[0]);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("static rules all come before dynamic ones, within Cloudflare's limits", () => {
    const kinds = rules.map((r) => dynamic(r[0] ?? ""));
    expect(kinds.indexOf(true)).toBe(kinds.lastIndexOf(false) + 1);
    expect(kinds.filter((k) => !k).length).toBeLessThanOrEqual(2000);
    expect(kinds.filter(Boolean).length).toBeLessThanOrEqual(100);
  });

  it.each([
    ["/pricing/", "/pricing"],
    ["/services/", "/services"],
    ["/services/custom-web-apps/", "/services/custom-web-apps"],
    ["/industries/saas-startups/", "/industries/saas-startups"],
    ["/calculator/", "/pricing"],
    ["/calculator", "/pricing"],
    ["/services/knowledge-systems/", "/services/ai-knowledge-assistants"],
  ])("%s goes to %s", (from, to) => {
    expect(target(from)).toEqual([to, "301"]);
  });

  it.each(["/", "/pricing", "/services/custom-web-apps", "/_astro/x.css", "/a/b/c/"])(
    "%s is left alone",
    (path) => {
      expect(target(path)).toBeNull();
    },
  );
});
