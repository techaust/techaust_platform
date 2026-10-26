// The catalogue screens' pure helpers [ADM-CAT-02..05]: form conversions without floats, what an edit sends, the drafts rebase,
// the price history in words, the publish paths mapped to services, the template placeholders, and the copy markers.
import { createEntry, patchEntry } from "@techaust/core/catalogue";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry, SiteNeedAnswer } from "../api.ts";
import {
  blankForm,
  buildEntry,
  COPY,
  changedKeys,
  ERRORS,
  entryPatch,
  formOf,
  historyText,
  insertPlaceholder,
  isTooLong,
  maxItemIndex,
  milliToQty,
  PENDING,
  PLACEHOLDER_TAG,
  publishProblems,
  qtyToMilli,
  rebaseEntry,
  saveFailureText,
  scheduleTotal,
  splitPlaceholders,
  templateTitle,
  unknownIn,
} from "./catalogue.ts";

const ENTRY: CatalogueEntry = {
  id: "i1",
  code: "S16",
  name: "Care Plans",
  category: "run",
  short: "Monitoring and small changes.",
  unit: "month",
  priceInrMinor: 9_99_900,
  priceUsdMinor: 29_900,
  slug: "care-plans",
  showOnSite: true,
  active: true,
  updatedAt: 100,
  longMd: null,
  sac: "998313",
  gstRateBp: null,
  defaultLines: [
    {
      description: "Essential",
      unit: "month",
      qtyMilli: 1_000,
      rateInrMinor: 9_99_900,
      rateUsdMinor: 29_900,
    },
  ],
  deliverablesMd: null,
  assumptionsMd: null,
  exclusionsMd: null,
  schedule: [{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }],
  createdAt: 1,
};

describe("quantities and the schedule total (no floats)", () => {
  it("turns typed quantities into milli-units and back", () => {
    expect(qtyToMilli("1")).toBe(1_000);
    expect(qtyToMilli("2.5")).toBe(2_500);
    expect(qtyToMilli("0.125")).toBe(125);
    expect(qtyToMilli("0")).toBeNull();
    expect(qtyToMilli("1.2345")).toBeNull();
    expect(qtyToMilli("-1")).toBeNull();
    expect(milliToQty(2_500)).toBe("2.5");
    expect(milliToQty(1_000)).toBe("1");
  });

  it("adds the shares in basis points, or null while one isn't a percentage", () => {
    expect(scheduleTotal([{ pct: "40" }, { pct: "30" }, { pct: "30" }])).toBe(10_000);
    expect(scheduleTotal([{ pct: "33.33" }, { pct: "33.33" }, { pct: "33.34" }])).toBe(10_000);
    expect(scheduleTotal([{ pct: "" }])).toBeNull();
  });
});

describe("the entry form [ADM-CAT-02]", () => {
  it("round-trips an entry into a value the shared create schema accepts", () => {
    const built = buildEntry(formOf(ENTRY));
    expect("value" in built).toBe(true);
    if (!("value" in built)) return;
    expect(built.value).toMatchObject({
      code: "S16",
      priceInrMinor: 9_99_900,
      priceUsdMinor: 29_900,
      defaultLines: ENTRY.defaultLines,
      schedule: ENTRY.schedule,
      slug: "care-plans",
    });
    expect(createEntry.safeParse(built.value).success).toBe(true);
  });

  it("refuses a schedule that doesn't add up, with the 07-L sentence", () => {
    const f = formOf(ENTRY);
    f.schedule = [...f.schedule, { uid: "x", label: "Kick-off", pct: "20", trigger: "milestone" }];
    const built = buildEntry(f);
    expect("errors" in built && built.errors["ce-schedule"]).toBe(COPY.scheduleRule);
  });

  it("names every field the form refuses, by its id", () => {
    const f = blankForm();
    f.code = "X1";
    f.sac = "12";
    f.gstRate = "abc";
    f.slug = "Not A Slug";
    f.priceInr = "-5";
    f.lines = [
      { uid: "a", description: "Setup", unit: "fixed", qty: "0", rateInr: "", rateUsd: "" },
      { uid: "b", description: "Setup", unit: "fixed", qty: "1", rateInr: "", rateUsd: "" },
    ];
    const built = buildEntry(f);
    expect("errors" in built).toBe(true);
    if (!("errors" in built)) return;
    expect(Object.keys(built.errors).sort()).toEqual(
      [
        "ce-code",
        "ce-name",
        "ce-short",
        "ce-sac",
        "ce-gstRate",
        "ce-slug",
        "ce-priceInr",
        "ce-line-0-qty",
        "ce-line-1-description",
      ].sort(),
    );
  });

  it("an empty price or GST rate is none, not zero", () => {
    const f = formOf(ENTRY);
    f.priceUsd = "";
    f.lines = [];
    const built = buildEntry(f);
    expect("value" in built && built.value.priceUsdMinor).toBeNull();
    expect("value" in built && built.value.gstRateBp).toBeNull();
    expect("value" in built && built.value.defaultLines).toBeNull();
  });
});

describe("what an edit sends (the M3.2 drafts pattern)", () => {
  it("sends only the changed fields, with the version, and never the code", () => {
    const base = formOf(ENTRY);
    const value = { ...base, priceInr: "10,999", exclusionsMd: "" };
    const draft = { base, value };
    expect(changedKeys(draft)).toEqual(["priceInr"]);
    const built = buildEntry(value);
    if (!("value" in built)) throw new Error("should build");
    const patch = entryPatch(draft, built.value, 100);
    expect(patch).toEqual({ expectedUpdatedAt: 100, priceInrMinor: 10_99_900 });
    expect(patchEntry.safeParse(patch).success).toBe(true);
  });

  it("an emptied Markdown field is sent as an empty text (stored as none)", () => {
    const base = { ...formOf(ENTRY), deliverablesMd: "- Backups" };
    const value = { ...base, deliverablesMd: "" };
    const built = buildEntry(value);
    if (!("value" in built)) throw new Error("should build");
    expect(entryPatch({ base, value }, built.value, 5)).toEqual({ expectedUpdatedAt: 5, deliverablesMd: "" });
  });

  it("the list rows' keys never count as a change", () => {
    const a = formOf(ENTRY);
    const b = formOf(ENTRY);
    expect(a.lines[0]?.uid).not.toBe(b.lines[0]?.uid);
    expect(changedKeys({ base: a, value: b })).toEqual([]);
  });

  it("a reload keeps the person's edits, follows the store elsewhere, and drops only a clashing field", () => {
    const base = formOf(ENTRY);
    const draft = { base, value: { ...base, name: "Care Plans (mine)", priceInr: "11,000" } };
    const now = { ...formOf(ENTRY), short: "Theirs.", priceInr: "12,000" };
    const r = rebaseEntry(draft, now);
    expect(r.conflict).toBe(true);
    expect(r.draft?.value.name).toBe("Care Plans (mine)");
    expect(r.draft?.value.short).toBe("Theirs.");
    expect(r.draft?.value.priceInr).toBe("12,000");
    expect(rebaseEntry(null, now)).toEqual({ draft: null, conflict: false });
  });
});

describe("the price history in words [ADM-CAT-04]", () => {
  it("reads as the 07-L row, money through core, a missing value marked", () => {
    expect(
      historyText({
        field: "price_inr_minor",
        oldMinor: 50_000_00,
        newMinor: 60_000_00,
        changedByName: "Asha (sample)",
      }),
    ).toBe("From price in rupees changed from ₹50,000 to ₹60,000 by Asha (sample)");
    expect(
      historyText({
        field: "line:Growth:rate_usd_minor",
        oldMinor: null,
        newMinor: 899_00,
        changedByName: null,
      }),
    ).toBe(`Growth, rate in US dollars changed from Not set to $899 by A former staff member`);
  });
});

describe("publish answers [ADM-CAT-05]", () => {
  const onSite = [
    { id: "a", code: "S1", name: "One" },
    { id: "b", code: "S2", name: "Two" },
  ];
  it("maps snapshot paths to the services to fix, with their fields, plus terms and the list", () => {
    const p = publishProblems(
      ["items.1.unit", "items.1.schedule.0.pctBp", "paymentTerms.dueDays", "items"],
      onSite,
    );
    expect(p).toEqual([
      { kind: "service", item: onSite[1], index: 1, fields: ["Unit", "Payment schedule"] },
      { kind: "terms" },
      { kind: "items" },
    ]);
    expect(maxItemIndex(["items.7.unit", "items.2", "paymentTerms"])).toBe(7);
    expect(maxItemIndex(["paymentTerms.dueDays"])).toBe(-1);
  });

  it("lists what the website needs by code first, one line each, and does not read a code path as an index", () => {
    const needs: SiteNeedAnswer[] = [
      { code: "S7", missing: "service" },
      { code: "S5", missing: "price", currency: "inr" },
      { code: "S11", missing: "line", line: "setup", currency: null, ambiguous: false },
      { code: "S16", missing: "line", line: "growth", currency: "inr", ambiguous: false },
      { code: "S11", missing: "line", line: "monthly", currency: null, ambiguous: true },
    ];
    const paths = [
      "items.S7",
      "items.S5.priceInrMinor",
      "items.S11.lines.setup",
      "items.S16.lines.growth",
      "items.S11.lines.monthly",
    ];
    const p = publishProblems(paths, [], needs);
    expect(p.map((x) => x.kind)).toEqual(["site", "site", "site", "site", "site"]);
    expect(p.map((x) => (x.kind === "site" ? x.code : null))).toEqual(["S7", "S5", "S11", "S16", "S11"]);
    // None of the code paths became a "items" problem or an index.
    expect(maxItemIndex(paths)).toBe(-1);
    const whats = p.map((x) => (x.kind === "site" ? x.what : ""));
    expect(whats[0]).toContain("this service");
    expect(whats[1]).toContain("rupees");
    expect(whats[2]).toContain('"setup"');
    expect(whats[3]).toContain("rupees");
    expect(whats[4]).toContain("only one");
    expect(ERRORS.siteNeeds("S7", "this service")).toBe("The website needs S7: this service.");
  });

  it("an index problem and a website need come out together, the needs first", () => {
    const p = publishProblems(
      ["items.0.unit", "items.S7"],
      [{ id: "a", code: "S1", name: "One" }],
      [{ code: "S7", missing: "service" }],
    );
    expect(p.map((x) => x.kind)).toEqual(["site", "service"]);
  });
});

describe("a save that is too long, and the version line [review findings 4, 5, 7]", () => {
  it("a 413 is the 07-L too-long line; anything else keeps the caller's words", () => {
    expect(isTooLong({ status: 413 })).toBe(true);
    expect(isTooLong({ status: 400 })).toBe(false);
    expect(isTooLong(new Error("x"))).toBe(false);
    expect(isTooLong(null)).toBe(false);
    expect(saveFailureText({ status: 413 }, () => "other")).toBe(
      "This is too long. Shorten the longest texts and save again.",
    );
    expect(saveFailureText({ status: 500 }, () => "other")).toBe("other");
  });

  it("a version with no person reads 'Version {n}, saved on {date}'", () => {
    expect(COPY.versionLine(2, "Asha", "25 Oct 2026")).toBe("Version 2, saved by Asha on 25 Oct 2026");
    expect(COPY.versionLine(1, null, "25 Oct 2026")).toBe("Version 1, saved on 25 Oct 2026");
    expect(COPY.versionLine(1, null, "25 Oct 2026")).not.toContain("saved by");
    expect(PENDING).not.toHaveProperty("seededBy");
  });
});

describe("templates [ADM-CAT-03]", () => {
  it("finds placeholders that don't exist, splits a text into tokens, and inserts at the caret", () => {
    expect(unknownIn("Hi {{client.name}} and {{client.nme}}")).toEqual(["client.nme"]);
    expect(splitPlaceholders("For {{client.name}}.")).toEqual([
      { text: "For ", placeholder: false },
      { text: "{{client.name}}", placeholder: true },
      { text: ".", placeholder: false },
    ]);
    expect(insertPlaceholder("For : x", "client.name", 4, 4)).toEqual({
      text: "For {{client.name}}: x",
      caret: 19,
    });
    expect(templateTitle({ kind: "proposal", category: "build" })).toBe("Build proposal");
    expect(templateTitle({ kind: "care_block", category: null })).toBe("Care plan block");
  });
});

describe("copy", () => {
  it("every sentence 07-L lacked has its 07-Q words, with no placeholder tag", () => {
    for (const v of Object.values(PENDING)) {
      const text = typeof v === "function" ? (v as (n: number) => string)(1) : v;
      expect(text.includes(PLACEHOLDER_TAG)).toBe(false);
    }
  });

  it("the confirmations are 07-L word for word", () => {
    expect(COPY.retire("S3", "DPDP Readiness for Apps")).toBe(
      "Retire S3 DPDP Readiness for Apps? It can't be added to new proposals or estimates. Documents that already include it don't change.",
    );
  });
});
