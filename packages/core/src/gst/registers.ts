// The sales register and the output-tax summary (M5.5b, LD71, LD83; ADM-REP-04, ADM-REP-06): working reports for the owner and the
// CA, built from the same register rows as GSTR-1 so their totals can be compared with it. Pure and deterministic; a bad row fails
// the whole report (the same checks as `gstr1Sections`). A credit note is negative, a debit note positive. A voided document appears
// in the sales register only, as "cancelled" with zero amounts, and nowhere in the output tax. Every rule is OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?.
import { isValidDate } from "../dates.ts";
import type { StateCode } from "../gstin.ts";
import { SERIES } from "../numbering.ts";
import { inPeriod, type PeriodRange } from "./period.ts";
import { registerKeyIssues, rowChecks } from "./sections.ts";
import {
  type CalendarDate,
  type Currency,
  compareDates,
  compareText,
  fail,
  type GstIssue,
  type GstResult,
  guard,
  issue,
  num,
  ok,
  type RegisterApiRow,
  type RegisterRow,
  type SupplyType,
  signOf,
  uniqueIssues,
} from "./types.ts";

export type RegisterStatus = "issued" | "cancelled";

/** One row of the sales register: per (document, rate), the document's own values repeated on each row of it. */
export type SalesRegisterRow = {
  readonly docId: string;
  readonly date: CalendarDate;
  readonly number: string;
  /** The label of the document's series (Tax invoice, Export invoice, Credit note, Debit note). */
  readonly typeLabel: string;
  readonly client: string;
  readonly gstin: string | null;
  readonly posCode: RegisterRow["placeOfSupplyCode"];
  readonly supplyType: SupplyType;
  readonly currency: Currency;
  /** In the document's currency, signed (a credit note is negative); zero for a cancelled document. */
  readonly totalMinor: number;
  readonly fxRateMicros: number | null;
  /** INR, signed; zero for a cancelled document. */
  readonly totalInrMinor: number;
  readonly sac: string | null;
  readonly rateBp: number | null;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly status: RegisterStatus;
};

export type OutputTaxBucket = "intra" | "inter" | "zero_rated_wopay" | "zero_rated_wpay";
export const OUTPUT_TAX_BUCKETS: readonly OutputTaxBucket[] = Object.freeze([
  "intra",
  "inter",
  "zero_rated_wopay",
  "zero_rated_wpay",
]);

export type OutputTaxRow = {
  readonly bucket: OutputTaxBucket;
  readonly rateBp: number;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

type Checked = { readonly reported: readonly RegisterRow[]; readonly voided: readonly RegisterApiRow[] };

/** The rows of the range, checked like GSTR-1's: reported (not voided) and voided ones apart. */
function checked(
  register: readonly RegisterApiRow[],
  range: PeriodRange,
  supplierStateCode: StateCode,
): GstResult<Checked> {
  if (
    !isValidDate(range.from) ||
    !isValidDate(range.to) ||
    compareDates(range.from, range.to) > 0 ||
    typeof supplierStateCode !== "string"
  ) {
    return fail([issue("period_invalid", "period")]);
  }
  const keys = registerKeyIssues(register);
  if (keys.length > 0) return fail(uniqueIssues(keys));
  const inRange = register.filter((r) => inPeriod(r.issueDate, range));
  const reported = inRange.filter((r) => !r.voided);
  const issues: GstIssue[] = reported.flatMap((r) => rowChecks(r, supplierStateCode));
  if (issues.length > 0) return fail(uniqueIssues(issues));
  return ok({ reported, voided: inRange.filter((r) => r.voided) });
}

/** The sales register of a range: one row per (document, rate), voided documents as one cancelled row of zeros. */
export function salesRegisterRows(
  register: readonly RegisterApiRow[],
  range: PeriodRange,
  supplierStateCode: StateCode,
): GstResult<readonly SalesRegisterRow[]> {
  return guard(() => {
    const c = checked(register, range, supplierStateCode);
    if (!c.ok) return c;
    const rows: SalesRegisterRow[] = [];
    const base = (r: RegisterApiRow) => ({
      docId: r.id,
      date: r.issueDate,
      number: r.number,
      typeLabel: SERIES[r.series].label,
      client: r.recipient.name,
      gstin: r.recipient.gstin,
      posCode: r.placeOfSupplyCode,
      supplyType: r.supplyType,
      currency: r.currency,
      fxRateMicros: r.fxRateMicros,
    });
    for (const r of c.value.reported as readonly RegisterApiRow[]) {
      const s = (v: number): number => (r.kind === "credit_note" && v !== 0 ? -v : v);
      const rates = [...r.rates].sort(
        (a, b) => compareText(String(a.sac), String(b.sac)) || a.rateBp - b.rateBp,
      );
      for (const rate of rates) {
        rows.push({
          ...base(r),
          totalMinor: s(r.totalMinor),
          totalInrMinor: s(r.totalInrMinor),
          sac: rate.sac,
          rateBp: rate.rateBp,
          taxableMinor: s(rate.taxableMinor),
          igstMinor: s(rate.igstMinor),
          cgstMinor: s(rate.cgstMinor),
          sgstMinor: s(rate.sgstMinor),
          status: "issued",
        });
      }
    }
    for (const r of c.value.voided) {
      rows.push({
        ...base(r),
        totalMinor: 0,
        totalInrMinor: 0,
        sac: null,
        rateBp: null,
        taxableMinor: 0,
        igstMinor: 0,
        cgstMinor: 0,
        sgstMinor: 0,
        status: "cancelled",
      });
    }
    // date, number; a document's rate rows keep their SAC and rate order (the sort is stable)
    rows.sort((a, b) => compareDates(a.date, b.date) || compareText(a.number, b.number));
    return ok(rows);
  });
}

const bucketOf = (supply: SupplyType): OutputTaxBucket =>
  supply === "intra"
    ? "intra"
    : supply === "inter"
      ? "inter"
      : supply === "export_lut"
        ? "zero_rated_wopay"
        : "zero_rated_wpay";

/** The output tax of a range by supply bucket and rate, signed (credit notes reduce, debit notes add). Voided documents are left out. */
export function outputTaxRows(
  register: readonly RegisterApiRow[],
  range: PeriodRange,
  supplierStateCode: StateCode,
): GstResult<readonly OutputTaxRow[]> {
  return guard(() => {
    const c = checked(register, range, supplierStateCode);
    if (!c.ok) return c;
    type Acc = { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint };
    const map = new Map<string, { bucket: OutputTaxBucket; rateBp: number; sum: Acc }>();
    for (const r of c.value.reported) {
      const sign = signOf(r.kind);
      const bucket = bucketOf(r.supplyType);
      for (const rate of r.rates) {
        const key = `${bucket}|${rate.rateBp}`;
        let entry = map.get(key);
        if (entry === undefined) {
          entry = { bucket, rateBp: rate.rateBp, sum: { taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n } };
          map.set(key, entry);
        }
        entry.sum.taxable += sign * BigInt(rate.taxableMinor);
        entry.sum.igst += sign * BigInt(rate.igstMinor);
        entry.sum.cgst += sign * BigInt(rate.cgstMinor);
        entry.sum.sgst += sign * BigInt(rate.sgstMinor);
      }
    }
    const rows = [...map.values()]
      .sort(
        (a, b) =>
          OUTPUT_TAX_BUCKETS.indexOf(a.bucket) - OUTPUT_TAX_BUCKETS.indexOf(b.bucket) || a.rateBp - b.rateBp,
      )
      .map(
        ({ bucket, rateBp, sum }): OutputTaxRow => ({
          bucket,
          rateBp,
          taxableMinor: num(sum.taxable),
          igstMinor: num(sum.igst),
          cgstMinor: num(sum.cgst),
          sgstMinor: num(sum.sgst),
        }),
      );
    return ok(rows);
  });
}
