// The catalogue screens' pure helpers [ADM-CAT-02..05]: form conversions without floats, what an edit sends, the drafts rebase,
// the price history in words, the publish paths mapped to services, the template placeholders, and the copy markers.
import { createEntry, patchEntry } from "@techaust/core/catalogue";
import { describe, expect, it } from "vitest";
import type { CatalogueEntry } from "../api.ts";
import {
  blankForm,
  buildEntry,
  COPY,
  changedKeys,
  entryPatch,
  formOf,
  historyText,
  insertPlaceholder,
  maxItemIndex,
  milliToQty,
  PENDING,
  PLACEHOLDER_TAG,
  publishProblems,
  qtyToMilli,
  rebaseEntry,
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
    ).toBe(
      `Growth, rate in US dollars changed from ${PLACEHOLDER_TAG} not set to $899 by A former staff member`,
    );
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
  it("every sentence 07-L lacks is marked as a placeholder", () => {
    for (const v of Object.values(PENDING)) {
      const text = typeof v === "function" ? (v as (n: number) => string)(1) : v;
      expect(text.startsWith(`${PLACEHOLDER_TAG} `)).toBe(true);
    }
  });

  it("the confirmations are 07-L word for word", () => {
    expect(COPY.retire("S3", "DPDP Readiness for Apps")).toBe(
      "Retire S3 DPDP Readiness for Apps? It can't be added to new proposals or estimates. Documents that already include it don't change.",
    );
  });
});
