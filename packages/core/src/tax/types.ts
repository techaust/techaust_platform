// Shared types and tiny helpers of the tax engine (M4.2; ADM-INV-05, docs/05 §10). Pure: no I/O, no zod, no floats, no
// module-level mutable state, deterministic. Every public function of `@techaust/core/tax` returns a `TaxResult`:
// codes only (M4.3 maps them to words), and none of them throws for any input of the declared types.
// Every rule here is a researched default: VERIFY WITH CA/LEGAL.
import type { TaxErrorCode as ClientTaxErrorCode, TaxWarning as ClientTaxWarning } from "../clients.ts";
import type { CalendarDate } from "../dates.ts";
import type { StateCode } from "../gstin.ts";
import type { Currency } from "../money.ts";
import type { ScheduleTrigger } from "../schedule-text.ts";
import type { Settings } from "../schemas/settings.ts";

/** The four supply types, written exactly as the `documents.supply_type` column (packages/db `SUPPLY_TYPES`). */
export const SUPPLY_TYPES = ["intra", "inter", "export_lut", "export_igst"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];
export type ExportMode = Settings["tax"]["exportMode"];
/** The export modes the settings allow (`tax.exportMode`). */
export const EXPORT_MODES: readonly ExportMode[] = ["lut", "igst_paid"];
/** Who a document is for, given where only a fixed supply is (the recipient itself is not): it picks the B2C details warning. */
export type RecipientStatus = "registered" | "unregistered" | "overseas";
export const RECIPIENT_STATUSES: readonly RecipientStatus[] = ["registered", "unregistered", "overseas"];

/** The settings the engine reads, as an input: nothing about the supplier or the rules is a constant here. */
export type TaxContext = {
  readonly tax: Settings["tax"];
  /** `company.stateCode` from the settings. */
  readonly supplierStateCode: StateCode;
  /** The saved letters of undertaking (one per FY); see `lutsOf`. */
  readonly luts: readonly { readonly fy: string; readonly arn: string }[];
};

export type Supply = {
  readonly type: SupplyType;
  readonly placeOfSupplyCode: StateCode | "96";
  readonly supplierStateCode: StateCode;
};

export type TaxErrorCode =
  | ClientTaxErrorCode
  | "recipient_or_supply_required"
  | "date_invalid"
  | "currency_invalid"
  | "pos_override_not_domestic"
  | "pos_override_invalid_state"
  | "pos_override_reason_required"
  | "no_lines"
  | "too_many_lines"
  | "qty_invalid"
  | "rate_invalid"
  | "gst_rate_invalid"
  | "rate_override_not_allowed"
  | "sac_invalid"
  | "discount_invalid"
  | "discount_exceeds_line"
  | "document_discount_exceeds_subtotal"
  | "fx_not_applicable"
  | "fx_invalid"
  | "target_out_of_band"
  | "target_not_whole_unit"
  | "total_too_large"
  | "amount_out_of_range"
  | "total_invalid"
  | "total_not_whole_unit"
  | "supply_invalid"
  | "internal_error"
  | "schedule_empty"
  | "schedule_too_many"
  | "schedule_mixed_kinds"
  | "schedule_step_invalid"
  | "schedule_pct_sum"
  | "schedule_amount_not_whole_unit"
  | "schedule_exceeds_total"
  | "no_groups"
  | "too_many_groups"
  | "group_weight_invalid"
  | "gross_invalid"
  | "gross_not_whole_unit"
  | "credit_shape_mismatch"
  | "credit_line_invalid"
  | "credit_empty"
  | "exceeds_creditable";

export type TaxWarningCode =
  | ClientTaxWarning["code"]
  | "export_in_inr"
  | "pos_overridden"
  | "lut_missing_for_fy"
  | "sac_missing"
  | "b2c_details_required"
  | "schedule_zero_instalment"
  | "inclusive_residual";

export type Path = readonly (string | number)[];
export type TaxIssue = { readonly code: TaxErrorCode; readonly path: Path };
export type TaxWarning = { readonly code: TaxWarningCode; readonly path: Path };

export type TaxResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: TaxWarning[] }
  | { readonly ok: false; readonly errors: TaxIssue[] };

export const ok = <T>(value: T, warnings: TaxWarning[] = []): TaxResult<T> => ({ ok: true, value, warnings });
export const fail = (errors: TaxIssue[]): TaxResult<never> => ({ ok: false, errors });
export const issue = (code: TaxErrorCode, ...path: (string | number)[]): TaxIssue => ({ code, path });
export const warn = (code: TaxWarningCode, ...path: (string | number)[]): TaxWarning => ({ code, path });

/** A safe integer (not NaN, not infinite, not fractional, not beyond 2^53 - 1). */
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
export const isIntBetween = (v: unknown, min: number, max: number): v is number =>
  isInt(v) && v >= min && v <= max;

/** The largest total that `amountInWords` can write: 99,99,99,999.99 rupees (`MAX_WORDS` × 100 + 99). */
export const MAX_TOTAL_MINOR = 99_999_999_999n;
/** FX is stored as INR micros per USD. */
export const MICROS = 1000000n;
/** Basis points: 10,000 = 100 %. */
export const BP = 10000n;

/** Thrown by `num` only: an amount beyond the safe-integer range. `guard` turns it into `amount_out_of_range`. */
export class TaxOverflow extends RangeError {}

/** A bigint back to a safe-integer number; anything larger is an overflow, caught by `guard`. */
export function num(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new TaxOverflow("Amount out of range");
  return n;
}

/** Floor division of two non-negative bigints (all uses are non-negative). */
export const floorDiv = (a: bigint, b: bigint): bigint => BigInt(a) / BigInt(b);

/** `value` limited to `low` and `high` (low <= high). */
export const clamp = (value: bigint, low: bigint, high: bigint): bigint =>
  value < low ? low : value > high ? high : value;

/**
 * Wraps a public function so it never throws: an overflow check (`num`) becomes `amount_out_of_range`, and anything else
 * that throws (a bug, or a value outside the declared types) becomes `internal_error`, so a defect cannot hide as a
 * routine input error.
 */
export function guard<T>(run: () => TaxResult<T>): TaxResult<T> {
  try {
    return run();
  } catch (error) {
    return fail([issue(error instanceof TaxOverflow ? "amount_out_of_range" : "internal_error")]);
  }
}

/** Drops repeated issues (same code and path), keeping the first of each. */
export function uniqueIssues(issues: readonly TaxIssue[]): TaxIssue[] {
  const seen = new Set<string>();
  const out: TaxIssue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.path.join(".")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}

export type Discount =
  | { readonly kind: "fixed"; readonly minor: number }
  | { readonly kind: "percent"; readonly bp: number };

/** One input line. `gstRateBp` missing means the default rate from the settings. */
export type LineInput = {
  readonly sac: string | null;
  readonly qtyMilli: number;
  readonly rateMinor: number;
  readonly gstRateBp?: number | undefined;
  readonly discount?: Discount | null | undefined;
};

export type Fx = { readonly rateMicros: number };

export type ComputedLineInr = {
  readonly taxableMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
  readonly lineTotalMinor: number;
};

/** One computed line; the names mirror the `document_lines` columns. */
export type ComputedLine = {
  readonly index: number;
  readonly sac: string | null;
  readonly grossMinor: number;
  readonly lineDiscountMinor: number;
  readonly documentDiscountMinor: number;
  readonly discountMinor: number;
  readonly taxableMinor: number;
  readonly gstRateBp: number;
  /** 0 under LUT (the rate that was applied). */
  readonly effectiveRateBp: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
  readonly lineTotalMinor: number;
  readonly inr: ComputedLineInr | null;
};

export type SummaryRow = {
  readonly sac: string | null;
  readonly gstRateBp: number;
  /** The rate that was applied (0 under LUT); `gstRateBp` is the line's own rate. */
  readonly effectiveRateBp: number;
  readonly taxableMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
};

export type ComputedInr = {
  readonly taxableMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
  readonly roundOffMinor: number;
  /** → `documents.total_inr_minor`. */
  readonly totalMinor: number;
};

/** A computed document; the names mirror the `documents` columns. */
export type ComputedDocument = {
  readonly currency: Currency;
  readonly supply: Supply;
  /** The INR micros per USD the INR figures were computed at (→ `fx_rate_micros`); null on INR and on USD without FX. */
  readonly fxRateMicros: number | null;
  readonly lines: readonly ComputedLine[];
  readonly summary: readonly SummaryRow[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxableMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
  readonly roundOffMinor: number;
  readonly totalMinor: number;
  readonly words: string;
  readonly inr: ComputedInr | null;
};

export type ScheduleStep =
  | { readonly label: string; readonly trigger: ScheduleTrigger; readonly pctBp: number }
  | { readonly label: string; readonly trigger: ScheduleTrigger; readonly amountMinor?: number | undefined };

export type ScheduleInstalment = {
  readonly label: string;
  readonly trigger: ScheduleTrigger;
  readonly pctBp: number;
  readonly amountMinor: number;
};

export type { CalendarDate };
