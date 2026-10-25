// What the website needs from the snapshot (M4.1 review finding 2; ADM-CAT-05): the list and the gap check, pure.
import { describe, expect, it } from "vitest";
import {
  firstWord,
  isSiteReferenced,
  SITE_REFERENCES,
  type SiteNeed,
  siteGaps,
} from "../src/site-references.ts";

type Item = Parameters<typeof siteGaps>[0][number];
const line = (description: string, inr: number | null = 100, usd: number | null = null) => ({
  description,
  rateInrMinor: inr,
  rateUsdMinor: usd,
});
/** A snapshot that has everything the website needs. */
const full = (): Item[] =>
  SITE_REFERENCES.map((n) => ({
    code: n.code,
    priceInrMinor: n.price.includes("inr") ? 5_000_000 : null,
    priceUsdMinor: null,
    defaultLines: Object.keys(n.lines).map((w) => line(`${w[0]?.toUpperCase()}${w.slice(1)} thing`)),
  }));
const without = (items: Item[], code: string) => items.filter((i) => i.code !== code);
const change = (items: Item[], code: string, patch: Partial<Item>) =>
  items.map((i) => (i.code === code ? { ...i, ...patch } : i));

describe("the list", () => {
  it("has each code once, in the form S<number>", () => {
    const codes = SITE_REFERENCES.map((n) => n.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^S\d+$/);
  });

  it("asks for rupees on every price and line (the site prints USD only where there is one)", () => {
    for (const n of SITE_REFERENCES) {
      expect(n.price.every((c) => c === "inr")).toBe(true);
      for (const cs of Object.values(n.lines)) expect(cs).toEqual(["inr"]);
    }
  });

  it("names the default lines the pages read: S11 setup and monthly, S16 essential, growth and scale", () => {
    const by = (c: string) => SITE_REFERENCES.find((n) => n.code === c);
    expect(Object.keys(by("S11")?.lines ?? {})).toEqual(["setup", "monthly"]);
    expect(Object.keys(by("S16")?.lines ?? {})).toEqual(["essential", "growth", "scale"]);
  });

  it("isSiteReferenced is true for listed codes only", () => {
    expect(isSiteReferenced("S1")).toBe(true);
    expect(isSiteReferenced("S3")).toBe(false);
    expect(isSiteReferenced("S8")).toBe(false);
    expect(isSiteReferenced("S99")).toBe(false);
  });
});

describe("siteGaps", () => {
  it("finds nothing in a snapshot that has everything", () => {
    expect(siteGaps(full())).toEqual([]);
  });

  it("an extra, unreferenced service is fine", () => {
    expect(
      siteGaps([...full(), { code: "S3", priceInrMinor: null, priceUsdMinor: null, defaultLines: [] }]),
    ).toEqual([]);
  });

  it("a retired or off-site service (absent from the snapshot) is a gap at items.<code>", () => {
    expect(siteGaps(without(full(), "S7"))).toEqual([{ code: "S7", kind: "service", path: "items.S7" }]);
  });

  it("a cleared INR price is a gap at items.<code>.priceInrMinor", () => {
    expect(siteGaps(change(full(), "S5", { priceInrMinor: null }))).toEqual([
      { code: "S5", kind: "price", currency: "inr", path: "items.S5.priceInrMinor" },
    ]);
  });

  it("a cleared USD price is not a gap", () => {
    expect(siteGaps(change(full(), "S5", { priceUsdMinor: null }))).toEqual([]);
  });

  it("a renamed referenced line is a gap at items.<code>.lines.<word>", () => {
    const items = change(full(), "S11", { defaultLines: [line("Initial fee"), line("Monthly thing")] });
    expect(siteGaps(items)).toEqual([
      {
        code: "S11",
        kind: "line",
        word: "setup",
        currency: null,
        ambiguous: false,
        path: "items.S11.lines.setup",
      },
    ]);
  });

  it("matches the first word without case or leading space", () => {
    const items = change(full(), "S11", { defaultLines: [line("  SETUP and launch"), line("monthly care")] });
    expect(siteGaps(items)).toEqual([]);
  });

  it("a line whose INR rate is cleared is a gap with its currency", () => {
    const items = change(full(), "S16", {
      defaultLines: [line("Essential"), line("Growth", null), line("Scale")],
    });
    expect(siteGaps(items)).toEqual([
      {
        code: "S16",
        kind: "line",
        word: "growth",
        currency: "inr",
        ambiguous: false,
        path: "items.S16.lines.growth",
      },
    ]);
  });

  it("two lines that start with the same word are ambiguous (the site throws on them)", () => {
    const items = change(full(), "S11", {
      defaultLines: [line("Setup one"), line("Setup two"), line("Monthly")],
    });
    expect(siteGaps(items)).toEqual([
      {
        code: "S11",
        kind: "line",
        word: "setup",
        currency: null,
        ambiguous: true,
        path: "items.S11.lines.setup",
      },
    ]);
  });

  it("reports every gap, in list order", () => {
    const items = change(without(full(), "S1"), "S2", { priceInrMinor: null });
    expect(siteGaps(items).map((g) => g.path)).toEqual(["items.S1", "items.S2.priceInrMinor"]);
  });

  it("a custom list needs USD where it says so", () => {
    const needs: SiteNeed[] = [{ code: "S1", price: ["inr", "usd"], lines: {} }];
    const items = [{ code: "S1", priceInrMinor: 1, priceUsdMinor: null, defaultLines: [] }];
    expect(siteGaps(items, needs).map((g) => g.path)).toEqual(["items.S1.priceUsdMinor"]);
  });

  it("firstWord", () => {
    expect(firstWord("  Monthly   management")).toBe("monthly");
    expect(firstWord("")).toBe("");
  });
});
