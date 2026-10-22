// The public catalogue snapshot (ADM-CAT-05), the payment-schedule text (WEB-SVC-05) and whole-unit money formatting.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CatalogueSnapshot,
  catalogueSnapshot,
  formatMoney,
  money,
  percentFromBp,
  scheduleText,
  snapshotItem,
} from "../src/index.ts";

const item = {
  code: "S5",
  name: "Custom Web Apps and Business Portals",
  slug: "custom-web-apps",
  category: "build",
  showOnSite: true,
  unit: "milestone",
  priceInrMinor: 3_00_000_00,
  priceUsdMinor: 12_000_00,
  schedule: [
    { label: "On acceptance", pctBp: 4_000, trigger: "on_accept" },
    { label: "Midpoint milestone", pctBp: 3_000, trigger: "milestone" },
    { label: "On delivery", pctBp: 3_000, trigger: "delivery" },
  ],
  defaultLines: [],
};
const snapshot: CatalogueSnapshot = {
  version: 1,
  items: [item as CatalogueSnapshot["items"][number]],
  paymentTerms: {
    dueDays: 7,
    proposalValidityDays: 15,
    buildSchedule: [
      { label: "On acceptance", pctBp: 4_000 },
      { label: "Midpoint milestone", pctBp: 3_000 },
      { label: "On delivery", pctBp: 3_000 },
    ],
    smallJobThreshold: { INR: 1_00_000_00, USD: 2_000_00 },
  },
};

describe("catalogue snapshot schema", () => {
  it("accepts a public snapshot", () => {
    expect(catalogueSnapshot.safeParse(snapshot).success).toBe(true);
  });

  it.each([
    "sac",
    "gstRateBp",
    "internalNotes",
    "deliverablesMd",
    "assumptionsMd",
    "exclusionsMd",
    "id",
    "active",
  ])("rejects the internal field %s on an item", (field) => {
    expect(snapshotItem.safeParse({ ...item, [field]: "x" }).success).toBe(false);
    const bad = { ...snapshot, items: [{ ...item, [field]: "x" }] };
    expect(catalogueSnapshot.safeParse(bad).success).toBe(false);
  });

  it("rejects an internal field on a line, a step, the payment terms or the top level", () => {
    const withLine = {
      ...item,
      defaultLines: [
        {
          description: "Setup",
          unit: "fixed",
          qtyMilli: 1_000,
          rateInrMinor: 1,
          rateUsdMinor: null,
          sac: "998314",
        },
      ],
    };
    expect(snapshotItem.safeParse(withLine).success).toBe(false);
    const withStep = { ...item, schedule: [{ label: "x", pctBp: 10_000, trigger: "on_accept", note: "x" }] };
    expect(snapshotItem.safeParse(withStep).success).toBe(false);
    expect(
      catalogueSnapshot.safeParse({
        ...snapshot,
        paymentTerms: { ...snapshot.paymentTerms, reminderOffsetsDays: [0] },
      }).success,
    ).toBe(false);
    expect(catalogueSnapshot.safeParse({ ...snapshot, bank: "x" }).success).toBe(false);
  });

  it("rejects floats as amounts, a schedule that is not 100 %, duplicate codes and a wrong version", () => {
    expect(snapshotItem.safeParse({ ...item, priceInrMinor: 10.5 }).success).toBe(false);
    expect(snapshotItem.safeParse({ ...item, priceInrMinor: -1 }).success).toBe(false);
    expect(
      snapshotItem.safeParse({ ...item, schedule: [{ label: "x", pctBp: 9_000, trigger: "on_accept" }] })
        .success,
    ).toBe(false);
    expect(catalogueSnapshot.safeParse({ ...snapshot, items: [item, item] }).success).toBe(false);
    expect(catalogueSnapshot.safeParse({ ...snapshot, version: 2 }).success).toBe(false);
    expect(catalogueSnapshot.safeParse({ ...snapshot, items: [] }).success).toBe(false);
    expect(
      catalogueSnapshot.safeParse({
        ...snapshot,
        paymentTerms: { ...snapshot.paymentTerms, buildSchedule: [{ label: "x", pctBp: 5_000 }] },
      }).success,
    ).toBe(false);
  });
});

describe("scheduleText", () => {
  it("words the 40/30/30 build schedule", () => {
    expect(scheduleText(item.schedule as never)).toBe(
      "40 % on acceptance, 30 % at the midpoint milestone, 30 % on delivery",
    );
  });

  it("words upfront and monthly schedules", () => {
    expect(scheduleText([{ label: "On acceptance", pctBp: 10_000, trigger: "on_accept" }])).toBe(
      "Paid in full upfront",
    );
    expect(scheduleText([{ label: "Monthly in advance", pctBp: 10_000, trigger: "monthly" }])).toBe(
      "Monthly in advance",
    );
    expect(scheduleText([{ label: "On delivery", pctBp: 10_000, trigger: "delivery" }])).toBe(
      "Paid in full on delivery",
    );
  });

  it("handles untyped steps (payment-terms settings) and labels that carry their own preposition", () => {
    expect(
      scheduleText([
        { label: "On acceptance", pctBp: 5_000 },
        { label: "At go-live", pctBp: 5_000, trigger: "milestone" },
      ]),
    ).toBe("50 % on acceptance, 50 % at go-live");
  });

  it("keeps acronyms and labels like 'UAT sign-off' intact (lower-cases only a lower-case word)", () => {
    expect(
      scheduleText([
        { label: "Deposit", pctBp: 5_000, trigger: "milestone" },
        { label: "UAT sign-off", pctBp: 5_000, trigger: "milestone" },
      ]),
    ).toBe("50 % at the deposit, 50 % at the UAT sign-off");
    expect(
      scheduleText([
        { label: "On UAT pass", pctBp: 5_000, trigger: "milestone" },
        { label: "Final", pctBp: 5_000, trigger: "milestone" },
      ]),
    ).toBe("50 % on UAT pass, 50 % at the final");
  });

  it("rejects an empty schedule or one that is not 100 %", () => {
    expect(() => scheduleText([])).toThrow(RangeError);
    expect(() => scheduleText([{ label: "x", pctBp: 9_000, trigger: "delivery" }])).toThrow(/100/);
  });

  it("formats basis points as an exact percentage, never through floats", () => {
    expect(percentFromBp(4_000)).toBe("40");
    expect(percentFromBp(3_350)).toBe("33.5");
    expect(percentFromBp(125)).toBe("1.25");
    expect(percentFromBp(0)).toBe("0");
    expect(() => percentFromBp(1.5)).toThrow(RangeError);
    expect(() => percentFromBp(-1)).toThrow(RangeError);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (bp) => {
        const [w = "0", f = ""] = percentFromBp(bp).split(".");
        expect(Number(w) * 100 + Number(f.padEnd(2, "0"))).toBe(bp);
      }),
    );
  });
});

describe("formatMoney wholeUnits", () => {
  it("drops a zero minor part", () => {
    expect(formatMoney(money(3_00_000_00, "INR"), { wholeUnits: true })).toBe("₹3,00,000");
    expect(formatMoney(money(12_000_00, "USD"), { wholeUnits: true })).toBe("$12,000");
    expect(formatMoney(money(0, "INR"), { wholeUnits: true })).toBe("₹0");
    expect(formatMoney(money(-1_000_00, "INR"), { wholeUnits: true })).toBe("−₹1,000");
    expect(formatMoney(money(40_000_00, "INR"), { wholeUnits: true, symbol: false })).toBe("40,000");
  });

  it("keeps a non-zero minor part", () => {
    expect(formatMoney(money(99_50, "INR"), { wholeUnits: true })).toBe("₹99.50");
    expect(formatMoney(money(5, "USD"), { wholeUnits: true })).toBe("$0.05");
  });

  it("property: it equals the normal format minus a trailing .00, and never anything else", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.constantFrom("INR" as const, "USD" as const),
        fc.boolean(),
        (amount, currency, symbol) => {
          const m = money(amount, currency);
          const normal = formatMoney(m, { symbol });
          expect(formatMoney(m, { symbol, wholeUnits: true })).toBe(normal.replace(/\.00$/, ""));
        },
      ),
    );
  });
});
