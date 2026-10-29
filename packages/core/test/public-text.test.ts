// The website's public-text rules [WEB-G-07, WEB-G-14; docs/07 section 1.3], one source for the website's lint and the admin's
// catalogue publish (audit A2 finding 2).
import { describe, expect, it } from "vitest";
import {
  BANNED_PHRASES,
  findBannedPhrases,
  hasAmpersand,
  hasTypedAmount,
  publicTextIssues,
  snapshotTextFields,
  snapshotTextIssues,
} from "../src/public-text.ts";

describe("banned phrases", () => {
  it("holds the docs/07 section 1.3 list plus the two prior-price rules, each a global regex", () => {
    const ids = BANNED_PHRASES.map((b) => b.id);
    for (const id of ["100%", "guarantee", "LIVE", "real-time", "#1", "certified", "act now", "% off"])
      expect(ids).toContain(id);
    expect(BANNED_PHRASES.every((b) => b.regex.global)).toBe(true);
  });

  it("finds each phrase with a little context, and only whole words", () => {
    expect(findBannedPhrases("We guarantee it")).toEqual([{ id: "guarantee", around: "We guarantee it" }]);
    expect(findBannedPhrases("A LIVE dashboard").map((f) => f.id)).toEqual(["LIVE"]);
    expect(findBannedPhrases("a live demo")).toEqual([]);
    expect(findBannedPhrases("uncertified, decertified")).toEqual([]);
    expect(findBannedPhrases("Was ₹5,000 now").map((f) => f.id)).toEqual(["prior price (was/now)"]);
  });

  it("can be called again on the same text (the global regexes keep no state between calls)", () => {
    expect(findBannedPhrases("guarantee")).toHaveLength(1);
    expect(findBannedPhrases("guarantee")).toHaveLength(1);
  });
});

describe("typed amounts and '&'", () => {
  it.each([
    "₹5,000",
    "Rs. 500",
    "Rs 500",
    "INR 100",
    "USD 40",
    "$40",
    "US$ 40",
    "5000 INR",
    "40 USD",
    "&#8377;5",
  ])("%s is a typed amount", (t) => {
    expect(hasTypedAmount(`Setup for ${t}`)).toBe(true);
  });

  it.each(["Monthly in advance", "2 revisions", "Rs", "per month", "Phase 2"])("%s is not", (t) => {
    expect(hasTypedAmount(t)).toBe(false);
  });

  it("any '&' is refused (the site writes 'and')", () => {
    expect(hasAmpersand("Audit & fix")).toBe(true);
    expect(hasAmpersand("Audit and fix")).toBe(false);
  });
});

describe("publicTextIssues", () => {
  it("lists every rule broken, in rule order, a banned phrase once by its id", () => {
    expect(publicTextIssues("Guaranteed & certified for ₹500, guaranteed")).toEqual([
      { rule: "ampersand" },
      { rule: "banned_phrase", phrase: "guarantee" },
      { rule: "banned_phrase", phrase: "certified" },
      { rule: "typed_amount" },
    ]);
    expect(publicTextIssues("Discovery Sprint")).toEqual([]);
  });
});

describe("the snapshot's text", () => {
  const snap = {
    items: [
      {
        code: "S5",
        name: "App Rescue",
        unit: "fixed",
        schedule: [{ label: "On acceptance" }, { label: "On delivery" }],
        defaultLines: [{ description: "Setup", unit: "fixed" }],
      },
    ],
    paymentTerms: { buildSchedule: [{ label: "On acceptance" }] },
  };

  it("names every printable field by its path; identifiers are not text", () => {
    expect(snapshotTextFields(snap).map((f) => f.path)).toEqual([
      "items.S5.name",
      "items.S5.unit",
      "items.S5.schedule.0.label",
      "items.S5.schedule.1.label",
      "items.S5.defaultLines.0.description",
      "items.S5.defaultLines.0.unit",
      "paymentTerms.buildSchedule.0.label",
    ]);
  });

  it("a clean snapshot has no issues; a broken field is named with its rules", () => {
    expect(snapshotTextIssues(snap)).toEqual([]);
    const bad = {
      ...snap,
      items: [
        {
          ...snap.items[0],
          name: "Rescue & rebuild",
          defaultLines: [{ description: "From $99", unit: "fixed" }],
        },
      ],
      paymentTerms: { buildSchedule: [{ label: "Act now" }] },
    } as typeof snap;
    expect(snapshotTextIssues(bad)).toEqual([
      { path: "items.S5.name", issues: [{ rule: "ampersand" }] },
      { path: "items.S5.defaultLines.0.description", issues: [{ rule: "typed_amount" }] },
      { path: "paymentTerms.buildSchedule.0.label", issues: [{ rule: "banned_phrase", phrase: "act now" }] },
    ]);
  });
});
