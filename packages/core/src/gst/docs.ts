// GSTR-1 Table 13, documents issued (M5.5a; ADM-REP-04). Table 13 is built by interface only: the caller (M5.5b's adapter over
// M5.1's summary) passes one `DocsIssuedInput` per series and number range; nothing here reads documents or counters. The
// "net issued" figure (total less cancelled) is left to the Offline Tool (UNVERIFIED). OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?.
import { SERIES } from "../numbering.ts";
import {
  type DocsIssuedInput,
  fail,
  type GstIssue,
  type GstResult,
  guard,
  isNonNegInt,
  issue,
  ok,
  type Series,
} from "./types.ts";

/** The series that Table 13 knows (the ones the numbering table marks as GST documents). */
export type GstSeries = {
  [K in Series]: (typeof SERIES)[K]["gst"] extends true ? K : never;
}[Series];

/**
 * The "Nature of Document" text of each GST series. The tax invoice and the export invoice both read "Invoices for outward
 * supply" and so become two rows of the same type (docs/08-A §4).
 */
export const NATURE_OF_DOCUMENT: Readonly<Record<GstSeries, string>> = Object.freeze({
  invoice: "Invoices for outward supply",
  export: "Invoices for outward supply",
  creditNote: "Credit Note",
  debitNote: "Debit Note",
  receiptVoucher: "Receipt voucher",
  refundVoucher: "Refund voucher",
});

export type DocsRow = {
  readonly series: GstSeries;
  readonly nature: string;
  readonly from: string;
  readonly to: string;
  readonly total: number;
  readonly cancelled: number;
};

const SERIES_KEYS = Object.keys(SERIES) as Series[];

export const isGstSeries = (series: unknown): series is GstSeries =>
  typeof series === "string" && Object.hasOwn(SERIES, series) && SERIES[series as Series].gst;

/** One row per input, in the order of the series table (inputs of the same series keep their order). */
export function docsRows(inputs: readonly DocsIssuedInput[]): GstResult<readonly DocsRow[]> {
  return guard(() => {
    const errors: GstIssue[] = [];
    inputs.forEach((input, index) => {
      if (!isGstSeries(input.series)) {
        errors.push(issue("series_not_gst", index));
        return;
      }
      const countsOk =
        isNonNegInt(input.total) &&
        isNonNegInt(input.cancelled) &&
        input.cancelled <= input.total &&
        typeof input.from === "string" &&
        input.from.length > 0 &&
        typeof input.to === "string" &&
        input.to.length > 0;
      if (!countsOk) errors.push(issue("docs_counts_invalid", index));
    });
    if (errors.length > 0) return fail(errors);
    const ordered = inputs
      .map((input, index) => ({ input, index }))
      .sort(
        (a, b) =>
          SERIES_KEYS.indexOf(a.input.series) - SERIES_KEYS.indexOf(b.input.series) || a.index - b.index,
      );
    return ok(
      ordered.map(({ input }) => ({
        series: input.series as GstSeries,
        nature: NATURE_OF_DOCUMENT[input.series as GstSeries],
        from: input.from,
        to: input.to,
        total: input.total,
        cancelled: input.cancelled,
      })),
    );
  });
}
