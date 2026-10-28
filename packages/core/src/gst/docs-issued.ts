// The adapter from the register page to GSTR-1 Table 13 (M5.5b, LD73; ADM-REP-04). M5.1's `documentsIssuedSummary` stays the one place
// that works out "from, to, total, cancelled" per series: this file only turns register rows into its input and its output into the
// `DocsIssuedInput` that `docsRows` takes. Only TYPES come from `../invoices.ts` (the summary function itself runs in the SPA through
// `@techaust/core/invoices`, and the gst core must not pull it in). SPA ONLY, like the rest of `gst/`. Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23).
import type { IssuedRow, IssuedSummary } from "../invoices.ts";
import { isGstSeries } from "./docs.ts";
import {
  type DocsIssuedInput,
  fail,
  type GstIssue,
  type GstResult,
  guard,
  issue,
  ok,
  type RegisterApiRow,
} from "./types.ts";

/** The register rows (voided ones included, they count as cancelled) as `documentsIssuedSummary`'s input. */
export function issuedRowsOf(rows: readonly RegisterApiRow[]): IssuedRow[] {
  return rows.map((r) => ({
    series: r.series,
    fy: r.fy,
    number: r.seq,
    numberDisplay: r.number,
    void: r.voided,
  }));
}

/**
 * The summary as Table 13 inputs. A series that is not a GST document is `series_not_gst` at its index (it cannot happen with the
 * register's four kinds, so it is a bug if it does). Table 13 is per return period and a period lies inside one financial year
 * (the register route refuses a longer range), so a summary of more than one FY is `period_invalid`. The `net` figure is dropped:
 * the Offline Tool works it out (UNVERIFIED).
 */
export function docsIssuedInputs(summary: readonly IssuedSummary[]): GstResult<DocsIssuedInput[]> {
  return guard(() => {
    const errors: GstIssue[] = [];
    summary.forEach((s, index) => {
      if (!isGstSeries(s.series)) errors.push(issue("series_not_gst", index));
    });
    if (new Set(summary.map((s) => s.fy)).size > 1) errors.push(issue("period_invalid", "period"));
    if (errors.length > 0) return fail(errors);
    return ok(
      summary.map((s) => ({
        series: s.series as DocsIssuedInput["series"],
        from: s.from,
        to: s.to,
        total: s.total,
        cancelled: s.cancelled,
      })),
    );
  });
}
