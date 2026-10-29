// Shared types and helpers of the GST and report core (M5.5a; ADM-REP-04, ADM-REP-07, ADM-INV-17). Pure: no I/O, no zod, no
// floats, no module-level mutable state, deterministic. The report builders of `@techaust/core/gst` (sections, docs, EDF,
// realisation, classify and the CSV writers of `layouts.ts`) return a `GstResult` (codes only; M5.5b maps them to words) and
// none of them throws for any input of the declared types. The calendar and formatting helpers (`lastDayOfMonth`,
// `addMonthsClamped`, `format*`, `cell.*`) are exported too, are not wrapped, and throw a RangeError on a programming error
// (a value outside their declared domain).
// Every rule and every column here is a researched default: Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23).
import type { CalendarDate } from "../dates.ts";
import type { StateCode } from "../gstin.ts";
import type { Currency } from "../money.ts";
import type { Series } from "../numbering.ts";
import type { RecipientStatus, SupplyType } from "../tax/types.ts";
import type { RealisationSettings } from "./realisation.ts";

export type { CalendarDate, Currency, RecipientStatus, Series, StateCode, SupplyType };

/** The four document kinds that GSTR-1 reports (an invoice, an export invoice, and the two notes). */
export const GST_DOC_KINDS = ["tax_invoice", "export_invoice", "credit_note", "debit_note"] as const;
export type GstDocKind = (typeof GST_DOC_KINDS)[number];

/** One rate of a document, in INR minor units (the effective rate: 0 under LUT). */
export type RegisterRate = {
  readonly sac: string | null;
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

/** What a credit or debit note needs to know about the invoice it corrects. */
export type NoteParent = {
  readonly number: string;
  readonly issueDate: CalendarDate;
  readonly supplyType: SupplyType;
  readonly recipientStatus: RecipientStatus;
  readonly placeOfSupplyCode: StateCode | "96";
  readonly totalInrMinor: number;
};

/** One issued document, as the register produces it (M5.5b writes the query). INR amounts are safe-integer minor units. */
export type RegisterRow = {
  readonly id: string;
  readonly kind: GstDocKind;
  readonly voided: boolean;
  readonly number: string;
  /** The issue date in IST. */
  readonly issueDate: CalendarDate;
  readonly currency: Currency;
  /** In the invoice currency. */
  readonly totalMinor: number;
  readonly totalInrMinor: number;
  readonly roundOffInrMinor: number;
  readonly fxRateMicros: number | null;
  readonly supplyType: SupplyType;
  readonly placeOfSupplyCode: StateCode | "96";
  readonly reverseCharge: boolean;
  readonly recipient: {
    readonly status: RecipientStatus;
    readonly gstin: string | null;
    readonly name: string;
    readonly address: string | null;
    readonly stateCode: StateCode | null;
    readonly countryCode: string | null;
  };
  readonly rates: readonly RegisterRate[];
  /** Required for `credit_note` and `debit_note`, ignored otherwise. */
  readonly noteOf: NoteParent | null;
  /** In the invoice currency; before M6 it is total minus credits (LD17). */
  readonly outstandingMinor: number;
  /** EDF only (the M5.2 hint); may be null. */
  readonly purposeCode: string | null;
};

/**
 * One page row of `GET /reports/registers` (M5.5b, LD71): a register row plus what the Table 13 adapter and the screens need (the
 * series, FY and counter of the number, the client's id and code for the link to the document).
 */
export type RegisterApiRow = RegisterRow & {
  readonly series: Series;
  readonly fy: string;
  readonly seq: number;
  readonly clientId: string;
  readonly clientCode: string;
};

/** The `meta` of a register page: what the SPA needs to build the sections (the server's today, its settings). */
export type ReportMeta = {
  readonly today: CalendarDate;
  readonly supplierStateCode: StateCode;
  readonly b2clThresholdInrMinor: number;
  readonly realisation: RealisationSettings & { readonly inrMonths: number };
};

/** One line of the documents-issued summary (GSTR-1 Table 13), as a plain input: the adapter is M5.5b's. */
export type DocsIssuedInput = {
  readonly series: Series;
  readonly from: string;
  readonly to: string;
  readonly total: number;
  readonly cancelled: number;
};

/** A return period: a calendar month, or a QRMP quarter of a financial year (Q1 = April to June). */
export type GstPeriod =
  | { readonly kind: "month"; readonly year: number; readonly month: number }
  | { readonly kind: "quarter"; readonly fyStartYear: number; readonly quarter: 1 | 2 | 3 | 4 };

export type Gstr1Params = {
  readonly b2clThresholdInrMinor: number;
  readonly supplierStateCode: StateCode;
  readonly sacDescriptions: Readonly<Record<string, string>>;
};

export type GstErrorCode =
  | "kind_not_reportable"
  | "gstin_missing"
  | "gstin_invalid"
  | "parent_missing"
  | "parent_invalid"
  | "supply_mismatch"
  | "sac_missing"
  | "sac_invalid"
  | "params_invalid"
  | "rates_empty"
  | "rate_invalid"
  | "amount_invalid"
  | "amount_out_of_range"
  | "totals_mismatch"
  | "pos_invalid"
  | "export_pos_mismatch"
  | "number_invalid"
  | "duplicate_row"
  | "date_invalid"
  | "threshold_invalid"
  | "series_not_gst"
  | "docs_counts_invalid"
  | "fx_missing"
  | "rules_invalid"
  | "period_invalid"
  | "rates_sum_mismatch"
  | "layout_unknown"
  | "internal_error";

export type GstWarningCode =
  | "b2cs_negative_net"
  | "hsn_description_missing"
  | "before_fema_2026"
  | "tax_only_note_manual";

/**
 * What a person must enter by hand for one tax-only note (FX-4, full audit A5 1): the note, the recipient's GSTIN (null for an unregistered one), the section its row
 * is in, and each tax head with its amount, per rate and in total (INR minor units). OPEN (08-C RA-32): how is a tax-only debit note (taxable value nil, tax only)
 * reported in GSTR-1 Table 9B through the Offline Tool, and how does it flow to 3B Table 3? Our files carry a taxable value and a rate, no tax column, so the tax may
 * not come through on import (OPEN (08-C RA-23): untested); nothing here says how to file it, only what the files may leave out.
 */
export type ManualTaxEntry = {
  readonly docId: string;
  readonly kind: "credit_note" | "debit_note";
  readonly number: string;
  readonly date: CalendarDate;
  readonly section: "cdnr" | "cdnur" | "b2cs";
  readonly gstin: string | null;
  readonly receiverName: string;
  readonly posCode: StateCode | "96";
  /** The parent invoice's number (the note's `noteOf`). */
  readonly parentNumber: string;
  readonly byRate: readonly {
    readonly rateBp: number;
    readonly igstMinor: number;
    readonly cgstMinor: number;
    readonly sgstMinor: number;
  }[];
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

export type Path = readonly (string | number)[];
export type GstIssue = { readonly code: GstErrorCode; readonly path: Path };
/**
 * A finding that does not stop the files. `blocking` (only `tax_only_note_manual`): the files are made, but they are NOT complete for filing until the person has done
 * what the warning says; a screen never reports "No errors" while one is present. `manual` carries what to enter by hand.
 */
export type GstWarning = {
  readonly code: GstWarningCode;
  readonly path: Path;
  readonly blocking?: true;
  readonly manual?: ManualTaxEntry;
};

export type GstResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: GstWarning[] }
  | { readonly ok: false; readonly errors: GstIssue[] };

export const ok = <T>(value: T, warnings: GstWarning[] = []): GstResult<T> => ({ ok: true, value, warnings });
export const fail = (errors: GstIssue[]): GstResult<never> => ({ ok: false, errors });
export const issue = (code: GstErrorCode, ...path: (string | number)[]): GstIssue => ({ code, path });
export const warn = (code: GstWarningCode, ...path: (string | number)[]): GstWarning => ({ code, path });

/** A safe integer (not NaN, not infinite, not fractional, not beyond 2^53 - 1). */
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
/** A safe integer that is not negative. */
export const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;
export const isIntBetween = (v: unknown, min: number, max: number): v is number =>
  isInt(v) && v >= min && v <= max;

/** Thrown by `num` only: an amount beyond the safe-integer range. `guard` turns it into `amount_out_of_range`. */
export class GstOverflow extends RangeError {}

/** A bigint back to a safe-integer number; anything larger is an overflow, caught by `guard`. */
export function num(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new GstOverflow("Amount out of range");
  return n;
}

/**
 * Wraps a public function so it never throws: an overflow check (`num`) becomes `amount_out_of_range`, and anything else
 * that throws (a bug, or a value outside the declared types) becomes `internal_error`.
 */
export function guard<T>(run: () => GstResult<T>): GstResult<T> {
  try {
    return run();
  } catch (error) {
    return fail([issue(error instanceof GstOverflow ? "amount_out_of_range" : "internal_error")]);
  }
}

/** Drops repeated issues (same code and path), keeping the first of each. */
export function uniqueIssues(issues: readonly GstIssue[]): GstIssue[] {
  const seen = new Set<string>();
  const out: GstIssue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.path.join(".")}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}

/** -1 for a credit note (it reduces the sums), 1 for the other kinds. */
export const signOf = (kind: GstDocKind): 1n | -1n => (kind === "credit_note" ? -1n : 1n);

/** A calendar date as one comparable integer (yyyymmdd). */
export const dateKey = (d: CalendarDate): number => d.year * 10_000 + d.month * 100 + d.day;
export const compareDates = (a: CalendarDate, b: CalendarDate): -1 | 0 | 1 => {
  const x = dateKey(a);
  const y = dateKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
/** Code-unit order of two strings: stable and locale-free. */
export const compareText = (a: string, b: string): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
/** Document numbers in issue order ("/10" after "/9"); it lives with the numbering rules (Worker-safe, used by the SPA's lists too). */
export { compareDocNumbers } from "../numbering.ts";
