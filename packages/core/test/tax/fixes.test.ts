// The fixes after the M4.2 early check [ADM-INV-05, ADM-PROP-03, ADM-INV-11]: typed internal errors, fixed supplies, hostile
// dates, the state list for overrides, and schedules. The golden table has the credit-note numbers.
import { describe, expect, it } from "vitest";
import {
  computeDocument,
  computeSchedule,
  creditNote,
  determineSupply,
  type ScheduleStep,
  type Supply,
  splitInclusive,
  type TaxContext,
  usableDate,
} from "../../src/tax/index.ts";
import { clamp, TaxOverflow } from "../../src/tax/types.ts";
import {
  DATE,
  DEFAULTS,
  errorsOf,
  good,
  inrDoc,
  line,
  OVERSEAS_US,
  REG_WB,
  unregistered,
  warningCodes,
} from "./fixtures.ts";

const pct = (label: string, pctBp: number): ScheduleStep => ({ label, trigger: "milestone", pctBp });
const amount = (label: string, amountMinor?: number): ScheduleStep => ({
  label,
  trigger: "milestone",
  amountMinor,
});

describe("guard: an overflow and a defect are told apart", () => {
  it("an amount beyond the safe-integer range is amount_out_of_range", () => {
    // A gross of 2 x (2^53 - 1) discounted 100 % to nothing: the total is 0 but the subtotal cannot be a safe integer
    const r = computeDocument(
      {
        currency: "INR",
        documentDate: DATE,
        recipient: REG_WB,
        lines: [
          {
            sac: "998314",
            qtyMilli: 2000,
            rateMinor: Number.MAX_SAFE_INTEGER,
            discount: { kind: "percent", bp: 10_000 },
          },
        ],
      },
      DEFAULTS,
    );
    expect(errorsOf(r)).toEqual(["amount_out_of_range@"]);
  });

  it("anything else that throws is internal_error, in every public function", () => {
    const broken = {} as unknown as TaxContext;
    expect(errorsOf(computeSchedule(100, "INR", [pct("All", 10_000)], broken))).toEqual(["internal_error@"]);
    expect(
      errorsOf(
        computeDocument(
          { currency: "INR", documentDate: DATE, recipient: REG_WB, lines: [line(100)] },
          broken,
        ),
      ),
    ).toEqual(["internal_error@"]);
    expect(errorsOf(determineSupply(OVERSEAS_US, broken, { documentDate: DATE, currency: "INR" }))).toEqual([
      "internal_error@",
    ]);
    const original = good(inrDoc(REG_WB, [line(100)]));
    expect(
      errorsOf(
        creditNote(
          original,
          { lines: [{ taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 }], creditedTotalMinor: 0 },
          { kind: "amount", taxableMinor: 1 },
          broken,
        ),
      ),
    ).toEqual(["internal_error@"]);
    const supply = original.supply;
    expect(
      errorsOf(
        splitInclusive(
          100_000,
          [{ sac: null, gstRateBp: 1800, weightMinor: 1 }],
          supply,
          "INR",
          null,
          broken,
        ),
      ),
    ).toEqual(["internal_error@"]);
  });

  it("TaxOverflow is a RangeError", () => {
    const e = new TaxOverflow("x");
    expect(e).toBeInstanceOf(RangeError);
    expect(e).toBeInstanceOf(TaxOverflow);
  });
});

describe("clamp", () => {
  it("limits a value to the range", () => {
    expect(clamp(5n, 0n, 10n)).toBe(5n);
    expect(clamp(-5n, 0n, 10n)).toBe(0n);
    expect(clamp(15n, 0n, 10n)).toBe(10n);
    expect(clamp(0n, 0n, 10n)).toBe(0n);
    expect(clamp(10n, 0n, 10n)).toBe(10n);
  });
});

describe("a fixed supply is checked, not trusted", () => {
  const doc = (supply: Supply, extra = {}) =>
    computeDocument(
      { currency: "INR", documentDate: DATE, supply, lines: [line(100_000)], ...extra },
      DEFAULTS,
    );

  it("a type that does not exist, a state that does not exist, or a place of supply that does not fit the type is supply_invalid", () => {
    const bad: Supply[] = [
      { type: "reverse" as unknown as "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
      { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "99" as unknown as "19" },
      { type: "intra", placeOfSupplyCode: "27", supplierStateCode: "19" },
      { type: "inter", placeOfSupplyCode: "19", supplierStateCode: "19" },
      { type: "inter", placeOfSupplyCode: "96", supplierStateCode: "19" },
      { type: "inter", placeOfSupplyCode: "99" as unknown as "27", supplierStateCode: "19" },
      { type: "export_lut", placeOfSupplyCode: "27", supplierStateCode: "19" },
      { type: "export_igst", placeOfSupplyCode: "19", supplierStateCode: "19" },
    ];
    for (const supply of bad) expect(errorsOf(doc(supply))).toEqual(["supply_invalid@supply"]);
  });

  it("a supply from an old supplier state is fine: it is not compared with today's", () => {
    // Intra for a supplier in Maharashtra (27), while today's settings say West Bengal (19): 100,000 x 0.09 = 9,000 each
    const d = good(doc({ type: "intra", placeOfSupplyCode: "27", supplierStateCode: "27" }));
    expect(d).toMatchObject({ cgstMinor: 9_000, sgstMinor: 9_000, igstMinor: 0, totalMinor: 118_000 });
    const inter = good(doc({ type: "inter", placeOfSupplyCode: "19", supplierStateCode: "27" }));
    expect(inter).toMatchObject({ cgstMinor: 0, igstMinor: 18_000 });
    const lut = good(doc({ type: "export_lut", placeOfSupplyCode: "96", supplierStateCode: "27" }));
    expect(lut).toMatchObject({ igstMinor: 0, totalMinor: 100_000 });
  });

  it("an export mode or an override beside a fixed supply is refused, not ignored; a null override is no override", () => {
    const supply: Supply = { type: "inter", placeOfSupplyCode: "27", supplierStateCode: "19" };
    expect(errorsOf(doc(supply, { exportMode: "lut" }))).toEqual(["supply_invalid@exportMode"]);
    expect(
      errorsOf(doc(supply, { placeOfSupplyOverride: { code: "29", reason: "Used in Bengaluru" } })),
    ).toEqual(["supply_invalid@placeOfSupplyOverride"]);
    expect(good(doc(supply, { placeOfSupplyOverride: null })).supply).toEqual(supply);
  });

  it("a recipient together with a supply is still only recipient_or_supply_required", () => {
    const r = computeDocument(
      {
        currency: "INR",
        documentDate: DATE,
        recipient: REG_WB,
        supply: { type: "intra", placeOfSupplyCode: "27", supplierStateCode: "19" },
        lines: [line(100)],
      },
      DEFAULTS,
    );
    expect(errorsOf(r)).toEqual(["recipient_or_supply_required@"]);
  });
});

describe("dates the financial year cannot be built for", () => {
  it("usableDate refuses a real date from 1 April 9999 and keeps the earlier ones", () => {
    expect(usableDate({ year: 9999, month: 4, day: 1 })).toBe(false);
    expect(usableDate({ year: 9999, month: 12, day: 31 })).toBe(false);
    expect(usableDate({ year: 9999, month: 3, day: 31 })).toBe(true);
    expect(usableDate({ year: 2026, month: 10, day: 25 })).toBe(true);
    expect(usableDate({ year: 2026, month: 2, day: 30 })).toBe(false);
  });

  it("determineSupply and computeDocument return date_invalid instead of throwing", () => {
    const documentDate = { year: 9999, month: 4, day: 1 };
    expect(errorsOf(determineSupply(OVERSEAS_US, DEFAULTS, { documentDate, currency: "USD" }))).toEqual([
      "date_invalid@documentDate",
    ]);
    expect(
      errorsOf(
        computeDocument(
          { currency: "USD", documentDate, recipient: OVERSEAS_US, lines: [line(100)] },
          DEFAULTS,
        ),
      ),
    ).toEqual(["date_invalid@documentDate"]);
    const last = { year: 9999, month: 3, day: 31 };
    expect(determineSupply(OVERSEAS_US, DEFAULTS, { documentDate: last, currency: "USD" }).ok).toBe(true);
  });
});

describe("the place-of-supply override uses the states that can be picked today", () => {
  it("legacy codes 25 and 28 are refused; 97 (Other Territory) is allowed", () => {
    const run = (code: string) =>
      inrDoc(unregistered("29"), [line(100_000)], {
        placeOfSupplyOverride: { code, reason: "Service used there" },
      });
    expect(errorsOf(run("25"))).toEqual(["pos_override_invalid_state@placeOfSupplyOverride.code"]);
    expect(errorsOf(run("28"))).toEqual(["pos_override_invalid_state@placeOfSupplyOverride.code"]);
    const ok97 = run("97");
    expect(good(ok97).supply).toEqual({ type: "inter", placeOfSupplyCode: "97", supplierStateCode: "19" });
    expect(warningCodes(ok97)).toEqual(["pos_overridden"]);
  });
});

describe("schedules after the early check", () => {
  it("an amount typed on the last step must be exactly the remainder", () => {
    // 11,800,000 total, the first step 5,000,000: the remainder is 6,800,000
    const first = amount("Deposit", 5_000_000);
    expect(
      good(computeSchedule(11_800_000, "INR", [first, amount("Rest", 6_800_000)], DEFAULTS)).map(
        (i) => i.amountMinor,
      ),
    ).toEqual([5_000_000, 6_800_000]);
    expect(
      errorsOf(computeSchedule(11_800_000, "INR", [first, amount("Rest", 6_800_100)], DEFAULTS)),
    ).toEqual(["schedule_step_invalid@steps.1"]);
    for (const bad of [Number.NaN, -1, 1.5]) {
      expect(errorsOf(computeSchedule(11_800_000, "INR", [first, amount("Rest", bad)], DEFAULTS))).toEqual([
        "schedule_step_invalid@steps.1",
      ]);
    }
  });

  it("a step before the last without an amount is still invalid", () => {
    expect(errorsOf(computeSchedule(11_800_000, "INR", [amount("A"), amount("B")], DEFAULTS))).toEqual([
      "schedule_step_invalid@steps.0",
    ]);
  });

  it("an INR total that is not a whole rupee is refused in amount mode too", () => {
    expect(
      errorsOf(computeSchedule(11_800_050, "INR", [amount("A", 5_000_000), amount("B")], DEFAULTS)),
    ).toEqual(["total_not_whole_unit@totalMinor"]);
  });

  it("returns the trimmed label", () => {
    const out = good(computeSchedule(100_000, "INR", [pct("  Deposit  ", 10_000)], DEFAULTS));
    expect(out[0]?.label).toBe("Deposit");
  });
});
