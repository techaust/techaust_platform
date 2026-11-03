// The refunds register as a CSV (`refunds-v1`; M6.5, B4; ADM-PAY-08, ADM-REP-04): one row per refund that went out in the financial year (the SUCCEEDED refunds of
// confirmed payments, by the IST day each went out: `REFUNDS_REGISTER_SQL`), oldest first, for the accountant beside the payments and TDS register. SPA only, like
// the rest of `gst/`. The words of a row (the way, the reason, the state, "the client's credit") are staff lines the caller passes already written (07-ZO "Staff
// lines"), so this core holds no invented text; it checks the day and the amounts and writes the file. The INR value is the amount itself for an INR refund and the
// bank's INR figure of a USD refund where one is known (L15: never a GST figure), else blank, never a guess.
import { parseIsoDate } from "../dates.ts";
import { type Cell, type CsvOptions, cell } from "./csv.ts";
import { col, type FileLayout, file, render } from "./layouts.ts";
import {
  type CalendarDate,
  type Currency,
  fail,
  type GstIssue,
  type GstResult,
  guard,
  isNonNegInt,
  issue,
  ok,
} from "./types.ts";

/** One refund as the SPA hands it to the file: codes already in words, amounts in minor units of `currency`. */
export type RefundsRegisterInput = {
  readonly id: string;
  /** ISO day the refund went out (IST). */
  readonly refundedOn: string;
  readonly clientCode: string;
  readonly clientName: string;
  /** The invoice whose excess it came from (its number), or the words for the client's credit. */
  readonly from: string;
  /** The credit note it followed (its number), if any. */
  readonly creditNote: string | null;
  /** The source payment's reference: the gateway's payment id, else its bank reference. */
  readonly paymentReference: string | null;
  readonly way: string;
  readonly gatewayRefundId: string | null;
  /** The bank's reference (UTR) of a refund we paid by bank transfer. */
  readonly bankReference: string | null;
  readonly currency: Currency;
  readonly amountMinor: number;
  /** The bank's INR amount of a USD refund, where recorded; ignored for an INR refund. */
  readonly inrRefundedMinor: number | null;
  readonly reason: string;
  readonly status: string;
};

/** One row of the file. */
export type RefundsRegisterRow = Omit<RefundsRegisterInput, "refundedOn" | "inrRefundedMinor"> & {
  readonly refundedOn: CalendarDate;
  readonly inrMinor: number | null;
};

const textOrBlank = (v: string | null): Cell => (v === null || v === "" ? cell.blank() : cell.text(v));

const refundsV1: FileLayout<RefundsRegisterRow> = file<RefundsRegisterRow>("refunds_register", [
  col("Refund date", (r) => cell.date(r.refundedOn)),
  col("Client code", (r) => cell.text(r.clientCode)),
  col("Client", (r) => cell.text(r.clientName)),
  col("Refunded from", (r) => cell.text(r.from)),
  col("Credit note", (r) => textOrBlank(r.creditNote)),
  col("Payment reference", (r) => textOrBlank(r.paymentReference)),
  col("How", (r) => cell.text(r.way)),
  col("Gateway refund ID", (r) => textOrBlank(r.gatewayRefundId)),
  col("Bank reference (UTR)", (r) => textOrBlank(r.bankReference)),
  col("Currency", (r) => cell.text(r.currency)),
  col("Amount", (r) => cell.amount(r.amountMinor)),
  col("INR value", (r) => (r.inrMinor === null ? cell.blank() : cell.amount(r.inrMinor))),
  col("Reason", (r) => cell.text(r.reason)),
  col("Status", (r) => cell.text(r.status)),
]);
export const REFUNDS_LAYOUTS = Object.freeze({ "refunds-v1": refundsV1 } as const);
export type RefundsLayoutId = keyof typeof REFUNDS_LAYOUTS;
export const CURRENT_REFUNDS_LAYOUT: RefundsLayoutId = "refunds-v1";

/** The rows of the file, in the order given (the API's: refund day, then id). A bad day or amount is an error at its id; nothing is skipped. */
export function refundsRegisterRows(
  input: readonly RefundsRegisterInput[],
): GstResult<readonly RefundsRegisterRow[]> {
  return guard(() => {
    const errors: GstIssue[] = [];
    const rows: RefundsRegisterRow[] = [];
    for (const r of input) {
      const day = parseIsoDate(r.refundedOn);
      if (day === null) {
        errors.push(issue("date_invalid", r.id));
        continue;
      }
      const inr = r.currency === "INR" ? r.amountMinor : r.inrRefundedMinor;
      if (!isNonNegInt(r.amountMinor) || (inr !== null && !isNonNegInt(inr))) {
        errors.push(issue("amount_invalid", r.id));
        continue;
      }
      const { inrRefundedMinor: _drop, ...rest } = r;
      rows.push({ ...rest, refundedOn: day, inrMinor: inr });
    }
    return errors.length > 0 ? fail(errors) : ok(rows);
  });
}

/** The refunds register file (`refunds-v1` by default). */
export function refundsRegisterCsv(
  input: readonly RefundsRegisterInput[],
  version: RefundsLayoutId = CURRENT_REFUNDS_LAYOUT,
  opts: CsvOptions = {},
): GstResult<string> {
  return guard(() => {
    if (!Object.hasOwn(REFUNDS_LAYOUTS, version)) return fail([issue("layout_unknown", "version")]);
    const rows = refundsRegisterRows(input);
    return rows.ok ? ok(render(REFUNDS_LAYOUTS[version], rows.value, opts)) : rows;
  });
}
