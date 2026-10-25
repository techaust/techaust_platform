// Supply type and place of supply [ADM-INV-05, ADM-SET-03; docs/08 G-7, G-8]: the cases the golden table does not name.
import { describe, expect, it } from "vitest";
import { SETTINGS_DEFAULTS } from "../../src/schemas/settings.ts";
import { determineSupply, lutsOf } from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST,
  errorsOf,
  GSTIN_19,
  good,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
  registered,
  unregistered,
  warningCodes,
} from "./fixtures.ts";

const opts = { documentDate: DATE, currency: "INR" } as const;

describe("lutsOf: the one LUT of today's settings as a list", () => {
  const tax = SETTINGS_DEFAULTS.tax;
  it("is empty until both the ARN and the FY are saved", () => {
    expect(lutsOf({ ...tax, lut: { arn: null, fy: null } })).toEqual([]);
    expect(lutsOf({ ...tax, lut: { arn: "AD190000000001A", fy: null } })).toEqual([]);
    expect(lutsOf({ ...tax, lut: { arn: null, fy: "2627" } })).toEqual([]);
  });
  it("has one entry once both are saved", () => {
    expect(lutsOf({ ...tax, lut: { arn: "TEST-ARN-2627", fy: "2627" } })).toEqual([
      { fy: "2627", arn: "TEST-ARN-2627" },
    ]);
  });
});

describe("determineSupply", () => {
  it("registered: the GSTIN's state is the place of supply; a matching record state adds no warning", () => {
    const r = determineSupply(registered(GSTIN_19, "19"), DEFAULTS, opts);
    expect(good(r)).toEqual({ type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" });
    expect(warningCodes(r)).toEqual([]);
  });

  it("registered with a different record state: GSTIN state wins, the mismatch is a warning at the state field", () => {
    const r = determineSupply(registered(GSTIN_19, "27"), DEFAULTS, opts);
    expect(good(r).placeOfSupplyCode).toBe("19");
    expect(r.ok && r.warnings).toEqual([{ code: "gstin_state_mismatch", path: ["recipient", "stateCode"] }]);
  });

  it("unregistered in Other Territory (97) is inter-state", () => {
    expect(good(determineSupply(unregistered("97"), DEFAULTS, opts))).toEqual({
      type: "inter",
      placeOfSupplyCode: "97",
      supplierStateCode: "19",
    });
  });

  it("passes the client rule's error codes through unchanged, at the recipient", () => {
    expect(errorsOf(determineSupply(unregistered(null), DEFAULTS, opts))).toEqual([
      "state_required@recipient",
    ]);
    expect(errorsOf(determineSupply(unregistered("55"), DEFAULTS, opts))).toEqual([
      "state_invalid@recipient",
    ]);
    expect(
      errorsOf(determineSupply({ gstStatus: "registered", country: "IN", gstin: "nope" }, DEFAULTS, opts)),
    ).toEqual(["gstin_invalid@recipient"]);
    expect(
      errorsOf(determineSupply({ gstStatus: "overseas", country: "US", gstin: GSTIN_19 }, DEFAULTS, opts)),
    ).toEqual(["gstin_not_allowed@recipient"]);
    expect(
      errorsOf(determineSupply({ gstStatus: "overseas", country: "US", stateCode: "19" }, DEFAULTS, opts)),
    ).toEqual(["state_not_allowed@recipient"]);
  });

  it("an invalid date is an error, and is reported together with the recipient's", () => {
    const bad = { year: 2026, month: 2, day: 30 };
    expect(errorsOf(determineSupply(REG_WB, DEFAULTS, { ...opts, documentDate: bad }))).toEqual([
      "date_invalid@documentDate",
    ]);
    expect(
      errorsOf(
        determineSupply(unregistered(null), DEFAULTS, {
          ...opts,
          documentDate: { year: Number.NaN, month: 1, day: 1 },
        }),
      ),
    ).toEqual(["date_invalid@documentDate", "state_required@recipient"]);
  });

  it("an override applies to a registered recipient too, and a null override is none", () => {
    const o = { code: "19", reason: "Performed at the Kolkata site" };
    const r = determineSupply(REG_MH, DEFAULTS, { ...opts, placeOfSupplyOverride: o });
    expect(good(r)).toEqual({ type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" });
    expect(warningCodes(r)).toEqual(["pos_overridden"]);
    expect(
      good(determineSupply(REG_MH, DEFAULTS, { ...opts, placeOfSupplyOverride: null })).placeOfSupplyCode,
    ).toBe("27");
  });

  it("override errors are all reported at once, with the recipient's", () => {
    const r = determineSupply(unregistered(null), DEFAULTS, {
      ...opts,
      placeOfSupplyOverride: { code: "00", reason: "" },
    });
    expect(errorsOf(r)).toEqual([
      "state_required@recipient",
      "pos_override_invalid_state@placeOfSupplyOverride.code",
      "pos_override_reason_required@placeOfSupplyOverride.reason",
    ]);
  });

  it("a reason of exactly 500 characters (after trimming) is accepted", () => {
    const r = determineSupply(unregistered("29"), DEFAULTS, {
      ...opts,
      placeOfSupplyOverride: { code: "27", reason: ` ${"x".repeat(500)} ` },
    });
    expect(r.ok).toBe(true);
  });

  it("exports: place of supply 96, the mode from the options first, then the settings", () => {
    expect(good(determineSupply(OVERSEAS_US, DEFAULTS, opts)).type).toBe("export_lut");
    expect(good(determineSupply(OVERSEAS_US, EXPORT_IGST, opts)).type).toBe("export_igst");
    expect(good(determineSupply(OVERSEAS_US, DEFAULTS, { ...opts, exportMode: "igst_paid" })).type).toBe(
      "export_igst",
    );
    expect(
      good(determineSupply(OVERSEAS_US, EXPORT_IGST, { ...opts, exportMode: "lut" })).placeOfSupplyCode,
    ).toBe("96");
  });

  it("the LUT warning is for LUT exports only and follows the FY of the document date", () => {
    const usd = { documentDate: DATE, currency: "USD" } as const;
    expect(warningCodes(determineSupply(OVERSEAS_US, DEFAULTS, usd))).toEqual(["lut_missing_for_fy"]);
    expect(warningCodes(determineSupply(OVERSEAS_US, EXPORT_IGST, usd))).toEqual([]);
    expect(warningCodes(determineSupply(REG_WB, DEFAULTS, usd))).toEqual([]);
  });
});
