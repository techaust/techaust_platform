// Shared fixtures for the tax tests (M4.2): settings variants, recipients and small builders. The golden values are never
// built here: they are typed by hand in golden-cases.ts.
import type { TaxInput } from "../../src/clients.ts";
import type { StateCode } from "../../src/gstin.ts";
import { SETTINGS_DEFAULTS, type Settings } from "../../src/schemas/settings.ts";
import type { LineInput, Supply, TaxContext, TaxResult } from "../../src/tax/index.ts";
import { computeDocument, type DocumentInput } from "../../src/tax/index.ts";

/** 25 October 2026: in FY 2026-27 (token "2627"). */
export const DATE = { year: 2026, month: 10, day: 25 } as const;
/** 31 March 2026: the last day of FY 2025-26 (token "2526"). */
export const DATE_OLD_FY = { year: 2026, month: 3, day: 31 } as const;

type TaxSettings = Settings["tax"];

export function makeCtx(
  options: {
    supplier?: StateCode;
    tax?: Partial<TaxSettings>;
    luts?: readonly { fy: string; arn: string }[];
  } = {},
): TaxContext {
  return {
    tax: { ...SETTINGS_DEFAULTS.tax, ...options.tax },
    supplierStateCode: options.supplier ?? "19",
    luts: options.luts ?? [],
  };
}

/** The settings as shipped: supplier West Bengal, 18 %, line overrides allowed, export under LUT, no LUT saved. */
export const DEFAULTS = makeCtx();
/** Supplier in Maharashtra instead. */
export const SUPPLIER_27 = makeCtx({ supplier: "27" });
/** A 5 % default rate. */
export const RATE_500 = makeCtx({ tax: { defaultRateBp: 500 } });
/** Line rates other than the default are not allowed. */
export const NO_OVERRIDE = makeCtx({ tax: { allowLineOverride: false } });
/** Exports with IGST paid by default. */
export const EXPORT_IGST = makeCtx({ tax: { exportMode: "igst_paid" } });
/** A saved LUT for FY 2026-27. */
export const WITH_LUT = makeCtx({ luts: [{ fy: "2627", arn: "TEST-ARN-2627" }] });
/** A saved LUT for FY 2025-26 only. */
export const WITH_OLD_LUT = makeCtx({ luts: [{ fy: "2526", arn: "TEST-ARN-2526" }] });

// GSTINs with valid check characters (made with gstinCheckChar on a test PAN).
export const GSTIN_19 = "19ABCDE1234F1ZX";
export const GSTIN_27 = "27ABCDE1234F1Z0";
export const GSTIN_29 = "29ABCDE1234F1ZW";

export const registered = (gstin: string, stateCode?: string): TaxInput => ({
  gstStatus: "registered",
  country: "IN",
  gstin,
  ...(stateCode === undefined ? {} : { stateCode }),
});
export const unregistered = (stateCode: string | null): TaxInput => ({
  gstStatus: "unregistered",
  country: "IN",
  stateCode,
});
export const overseas = (country = "US"): TaxInput => ({ gstStatus: "overseas", country });

export const REG_WB = registered(GSTIN_19);
export const REG_MH = registered(GSTIN_27);
export const OVERSEAS_US = overseas("US");

/** A line of quantity 1 under SAC 998314 at the default rate. */
export const line = (rateMinor: number, extra: Partial<LineInput> = {}): LineInput => ({
  sac: "998314",
  qtyMilli: 1000,
  rateMinor,
  ...extra,
});

export const supplyOf = (
  type: Supply["type"],
  placeOfSupplyCode: Supply["placeOfSupplyCode"],
  supplierStateCode: StateCode = "19",
): Supply => ({ type, placeOfSupplyCode, supplierStateCode });
export const EXPORT_LUT_SUPPLY = supplyOf("export_lut", "96");
export const EXPORT_IGST_SUPPLY = supplyOf("export_igst", "96");
export const INTRA_SUPPLY = supplyOf("intra", "19");
export const INTER_27_SUPPLY = supplyOf("inter", "27");

/** An INR document to a recipient on DATE. */
export const inrDoc = (
  recipient: TaxInput,
  lines: LineInput[],
  extra: Partial<DocumentInput> = {},
  ctx: TaxContext = DEFAULTS,
) => computeDocument({ currency: "INR", documentDate: DATE, recipient, lines, ...extra }, ctx);

/** The value of a successful result, or a thrown error naming the codes (so a failing golden case says why). */
export function good<T>(result: TaxResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got errors: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** The errors of a failed result as "code@path" strings. */
export function errorsOf<T>(result: TaxResult<T>): string[] {
  if (result.ok) throw new Error("expected errors, got ok");
  return result.errors.map((e) => `${e.code}@${e.path.join(".")}`);
}

export const warningCodes = <T>(result: TaxResult<T>): string[] =>
  result.ok ? result.warnings.map((w) => w.code) : [];
