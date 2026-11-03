// The tax facts the refund dialog shows (M6.5; ADM-PAY-08, ADM-INV-09; lead's answer to B2 Q3: the API carries them, the dialog only shows them). Codes and days,
// never sentences (the words are the designer's, from 07-ZO and the staff lines). In the finance Worker: core readers only, never the invoice chain
// (note-model.ts holds INVOICE_CODE; `creditDeadlineOf` there is mirrored here from the same core function and the same frozen facts).
//   - RA-40 (Researched 2026-11-03, Circular 137/07/2020-GST issue 1; GST Council flyer ch. 6 (08-C RA-40)): an advance refunded with no supply is corrected by a
//     credit note under s.34, subject to its last issue day (Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)); after
//     that day the dialog says no credit note is possible (`open: false`).
//   - RA-41 (Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41)): credit that may be an advance (`overpaymentAdvanceLine`) refunded in a later
//     GSTR-3B period than the one its money arrived in (`creditCrossedPeriod`) gets the RA-41 line.
import { type CreditDeadline, creditNoteAdvice, creditNoteDeadline } from "@techaust/core/invoices";
import { creditCrossedPeriod, overpaymentAdvanceLine, returnPeriodOf } from "@techaust/core/refunds";
import { cachedSetting, type StoredSetting } from "./settings-cache.ts";

type TaxSettings = ReturnType<typeof cachedSetting<"tax">>;

/** The invoice's frozen facts the deadline reads (as `creditDeadlineOf` in note-model.ts): its FY, issue day, service completion, header extras, recipient. */
export type DeadlineDoc = {
  type: string;
  fy: string | null;
  issue_date: string | null;
  service_completed_on: string | null;
  header_extras: string | null;
  recipient: string | null;
};
/** The SQL columns of `DeadlineDoc` on a `documents` row aliased `d`. */
export const DEADLINE_DOC_COLUMNS =
  "d.fy, d.issue_date, d.service_completed_on, d.header_extras, d.recipient";

const RECIPIENT_STATUSES = ["registered", "unregistered", "overseas"] as const;
const parse = (raw: string | null): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(raw ?? "null") as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** RA-40: the credit-note facts of an invoice whose excess a refund would draw on; null for a type that takes no credit note. */
export type CreditNoteFacts = CreditDeadline & {
  /** A credit note may still be dated today (`today` ≤ `lastDay`); false: none is possible any more (RA-40's dialog line). */
  readonly open: boolean;
  /** 07-ZD's advice days: the banner warns from this day, and advises issuing by `lastDay`. */
  readonly deadlineWarnFrom: string | null;
};

export function creditNoteFactsOf(d: DeadlineDoc, tax: TaxSettings, today: string): CreditNoteFacts | null {
  if (d.type !== "tax_invoice" && d.type !== "export_invoice") return null;
  const extras = parse(d.header_extras);
  const advance = extras?.advance as { receivedOn?: unknown } | undefined;
  const frozen = parse(d.recipient)?.gstStatus;
  // A damaged recipient is judged as unregistered, the earlier and stricter last day (lead D2, as `creditDeadlineOf`).
  const recipientStatus = RECIPIENT_STATUSES.find((s) => s === frozen) ?? "unregistered";
  const dl = creditNoteDeadline(
    {
      parentFy: d.fy ?? "",
      parentIssueDate: d.issue_date ?? "",
      advanceReceivedOn: typeof advance?.receivedOn === "string" ? advance.receivedOn : null,
      serviceCompletedOn: d.service_completed_on,
    },
    tax.creditNoteCutoff,
    tax.annualReturnsFiled,
    { frequency: tax.gstr1Frequency, recipientStatus },
  );
  return { ...dl, open: today <= dl.lastDay, deadlineWarnFrom: creditNoteAdvice(dl).deadlineWarnFrom };
}

/** RA-41: the facts of credit left on one payment, refunded today. */
export type CreditRefundFacts = {
  /** `credit_may_be_advance` when the credit may be an advance whose GST was due on receipt; null: no line. */
  readonly advanceLine: "credit_may_be_advance" | null;
  /** The credit's money arrived in an earlier GSTR-3B period than today's. */
  readonly creditCrossedPeriod: boolean;
  /** Both: the dialog shows the RA-41 line. */
  readonly showLine: boolean;
  readonly receivedOn: string;
  readonly receivedPeriod: string;
  readonly refundPeriod: string;
};

export function creditRefundFactsOf(
  p: { currency: "INR" | "USD"; freeMinor: number; netMinor: number; receivedOn: string },
  tax: TaxSettings,
  today: string,
): CreditRefundFacts {
  const advanceLine = overpaymentAdvanceLine({
    currency: p.currency,
    creditMinor: p.freeMinor,
    allocatedAny: p.netMinor > 0,
    excessProvisoMinor: tax.excessProvisoMinor,
  });
  const crossed = creditCrossedPeriod(p.receivedOn, today, tax.gstr1Frequency);
  return {
    advanceLine,
    creditCrossedPeriod: crossed,
    showLine: advanceLine !== null && crossed,
    receivedOn: p.receivedOn,
    receivedPeriod: returnPeriodOf(p.receivedOn, tax.gstr1Frequency),
    refundPeriod: returnPeriodOf(today, tax.gstr1Frequency),
  };
}

/** The stored `tax` settings row, parsed once per isolate and version. */
export const taxOf = (row: StoredSetting | undefined): TaxSettings => cachedSetting("tax", row);
