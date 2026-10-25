// The list of what the website needs from the catalogue snapshot (packages/core/src/site-references.ts) against what the pages
// really use [ADM-CAT-05, WEB-G-07, WEB-SVC-05; M4.1 review finding 2].
//
// Publishing refuses a snapshot that lacks anything on the list, because a build without it throws and every later staging deploy
// fails. The list is only worth that if it is complete, so this test reads the website's own sources for every price token,
// catalogue reference and service code, and fails if the list misses one (or lists one nothing uses). When it fails: the pages
// changed, so change the list (and tell the owner what publishing now insists on).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_REFERENCES, siteGaps } from "@techaust/core/site-references";
import { describe, expect, it } from "vitest";
import { snapshotFromSeed } from "../src/lib/catalogue";
import { priceOf, scheduleOf } from "../src/lib/prices";

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");

function files(dir: string, ext: readonly string[]): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && ext.some((x) => e.name.endsWith(x)))
    .map((e) => join(e.parentPath, e.name));
}
const sources = files(SRC, [".ts", ".astro", ".md"]).map((f) => ({
  path: relative(SRC, f).split(sep).join("/"),
  text: readFileSync(f, "utf8"),
}));

type Used = { price: Set<string>; lines: Set<string>; present: boolean };
const used = new Map<string, Used>();
function entry(code: string): Used {
  const found = used.get(code);
  if (found) return found;
  const u: Used = { price: new Set(), lines: new Set(), present: false };
  used.set(code, u);
  return u;
}
/** A price reference "S5" or "S16-essential": the headline price, or a default line. */
function priceRef(code: string, line: string | undefined) {
  const u = entry(code);
  u.present = true;
  if (line) u.lines.add(line);
  else u.price.add("inr");
}

for (const { path, text } of sources) {
  // {{price:S5}}, {{price-plain:S16-essential}}
  for (const m of text.matchAll(/\{\{price(?:-plain)?:(S\d+)(?:-([a-z]+))?\}\}/g))
    priceRef(m[1] as string, m[2]);
  // ref: "S11-setup", price: "S5" (the home cards and anchors; every one reaches priceOf)
  for (const m of text.matchAll(/\b(?:ref|price):\s*"(S\d+)(?:-([a-z]+))?"/g)) priceRef(m[1] as string, m[2]);
  // priceOf("S5") written out in code
  for (const m of text.matchAll(/\bpriceOf\("(S\d+)(?:-([a-z]+))?"\)/g)) priceRef(m[1] as string, m[2]);
  // scheduleOf("S5"), serviceLink("S5"), serviceContent("S5"): the service must exist, no price of its own
  for (const m of text.matchAll(/\b(?:scheduleOf|serviceLink|serviceContent)\("(S\d+)"\)/g))
    entry(m[1] as string).present = true;
  // A service page's own code, and the code of a pricing row with no page of its own
  if (/^content\/services\/(?!index\.ts)[a-z-]+\.ts$/.test(path) || path === "content/pricing.ts")
    for (const m of text.matchAll(/^\s*code:\s*"(S\d+)"/gm)) entry(m[1] as string).present = true;
}

describe("the site-reference list matches the website's sources", () => {
  it("the scan finds the pages (so an empty scan cannot pass)", () => {
    expect(used.size).toBeGreaterThanOrEqual(15);
    expect(sources.some((s) => s.path === "content/services/care-plans.ts")).toBe(true);
    expect(used.get("S16")?.lines.has("essential")).toBe(true);
    expect(used.get("S11")?.lines.has("monthly")).toBe(true);
  });

  it("every code the pages use is on the list", () => {
    const listed = new Set(SITE_REFERENCES.map((n) => n.code));
    const missing = [...used.keys()].filter((c) => !listed.has(c)).sort();
    expect(missing, "add these codes to SITE_REFERENCES in packages/core/src/site-references.ts").toEqual([]);
  });

  it("every code on the list is used by a page", () => {
    const unused = SITE_REFERENCES.map((n) => n.code).filter((c) => !used.has(c));
    expect(unused, "these codes are on the list but no page uses them: remove them").toEqual([]);
  });

  it("every price the pages print is required, and nothing else is", () => {
    for (const n of SITE_REFERENCES) {
      const u = used.get(n.code);
      expect(n.price.length > 0, `${n.code} headline price`).toBe((u?.price.size ?? 0) > 0);
    }
  });

  it("every default line the pages read is required, and nothing else is", () => {
    for (const n of SITE_REFERENCES) {
      const u = used.get(n.code);
      expect(Object.keys(n.lines).sort(), `${n.code} lines`).toEqual([...(u?.lines ?? [])].sort());
    }
  });
});

describe("the list against the real pages' price lookups", () => {
  const seed = snapshotFromSeed();

  it("the seed satisfies the list", () => {
    expect(siteGaps(seed.items)).toEqual([]);
  });

  it("each listed price and line resolves through priceOf, and each listed code has a schedule", () => {
    for (const n of SITE_REFERENCES) {
      if (n.price.length) expect(() => priceOf(n.code), n.code).not.toThrow();
      for (const word of Object.keys(n.lines))
        expect(() => priceOf(`${n.code}-${word}`), `${n.code}-${word}`).not.toThrow();
      expect(() => scheduleOf(n.code), n.code).not.toThrow();
    }
  });

  it("a snapshot without a listed price is named by the gap check (the build would throw on it)", () => {
    const cleared = seed.items.map((i) => (i.code === "S5" ? { ...i, priceInrMinor: null } : i));
    expect(siteGaps(cleared).map((g) => g.path)).toEqual(["items.S5.priceInrMinor"]);
  });
});
