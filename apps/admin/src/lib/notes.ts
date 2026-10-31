// The words and the pure rules of the credit and debit note screens (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note"): 07-T word for word, the reason
// lists, the deadline banner, the notes section's lines, the error and blocker sentences by API code, the request a dialog sends, and the annual
// return dates of Settings › Tax. Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-T (docs/07-content-appendix/T-m5.3-credit-debit-notes.md), approved by the lead on 2026-10-28 under the owner's delegation, word for word;
// the tax lines are Researched 2026-10-28 or OPEN per 08-C (the IDs are noted at each line). A line 07-T lacked is 07-W's (approved 2026-10-28,
// 07-W §1), never invented; where a line is used in its singular or for the debit note, the place says so.
//
// Money: amounts are the server's minor units, formatted through core (`moneyText`); typed amounts are parsed through core (`moneyFrom`). Nothing
// here adds, multiplies or rounds money: what can still be credited, the totals and the balance are the server's. A typed amount is only COMPARED
// with what the server said is left, so the person hears it before a request is sent; the server checks it again.
import { financialYear, fyOf } from "@techaust/core";
import { noteReasonLabel } from "@techaust/core/invoice-email";
import { CREDIT_REASONS, DEBIT_REASONS } from "@techaust/core/invoices";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import { Y } from "./copy-y.ts";
import {
  DEADLINE_QUARTER_LINE,
  deadlineBeforeLine,
  deadlinePassedLine,
  deadlineWarnLine,
  debitLutMissingLine,
} from "./copy-zd.ts";
import { dayText } from "./documents.ts";
import { fyLabel, INVT_COPY } from "./invoice-types.ts";
import { blockerLine, invErrorText, moneyText, typeLabel, UNKNOWN } from "./invoices.ts";
import type {
  CreditableLine,
  CreditDeadlineView,
  ImsStatus,
  NoteFieldsIn,
  NoteKind,
  NoteMode,
  NoteOfView,
  NoteRow,
  Take,
} from "./notes-api.ts";
import { moneyFrom, moneyInput } from "./settings-form.ts";

// ---- 07-T §3 to §6, word for word --------------------------------------------------------------------------------------------------------------

export const NOTE_COPY = {
  // §3
  issueCredit: "Issue credit note",
  issueDebit: "Issue debit note",
  modeLines: "Credit some lines",
  modeAmount: "Credit an amount",
  modeFull: "Credit the whole invoice",
  creditColumn: "Credit",
  amountLabel: "Amount to credit (GST included)",
  reasonLabel: "Reason (required, printed on the credit note)",
  describeReason: "Describe the reason",
  debitBody: "Use a debit note when the invoice amount was too low. It adds to the amount due.",
  finalStatement: "Once issued, this note can't be changed.",
  cancel: "Cancel",
  // §8 (as 07-R §3)
  requestIssue: "Request issue",
  // §4
  annualReturnLabel: "Annual return (GSTR-9) filed on",
  // Researched 2026-10-28, s.34(2) CGST and Notification 15/2025-CT (08-C RA-03).
  annualReturnHint:
    "Only if you file GSTR-9 for that year: it's optional up to ₹2 crore turnover. Once you enter the date, credit notes for that year are blocked.",
  // §9 (Q35, owner 2026-10-28; Researched 2026-10-28, 08-C RA-22): the tax-only debit note.
  taxTooLowHint: "Adds only the missing tax. The taxable value stays as invoiced.",
  taxToAdd: "Tax to add",
  // §9 (Researched 2026-10-28, 08-C RA-02, RA-04).
  discountAfterSaleHint:
    "For a discount agreed after the invoice. Your GST is reduced only once a registered client reverses the matching input tax credit.",
  // §5 (Researched 2026-10-28, 08-C RA-04; what a rejection means for the balance: Settled by the lead on the safest reading, 2026-10-30 (08-C RA-04): the note stays and the client's balance stays reduced; GST is reduced only once a registered client accepts it in IMS; a debit note if the credit was not due)
  imsLabel: "Client's response in IMS",
  imsHint:
    "For a GST-registered client, your GST is reduced only once they accept the credit note in the GST portal's Invoice Management System. Update this from the portal.",
  imsSaved: "IMS status saved.",
  // §6
  notesHeading: "Credit and debit notes",
  // §1 (the PDF's labels, which the screen shows beside the same facts)
  againstInvoice: "Against invoice",
  invoiceDate: "Invoice date",
  totalCredited: "Total credited",
  totalAdded: "Total added",
} as const;

/** The 07-T §3 button and toast words of each kind. */
export const issueLabel = (kind: NoteKind) =>
  kind === "credit" ? NOTE_COPY.issueCredit : NOTE_COPY.issueDebit;
export const noteDialogTitle = (kind: NoteKind, invoiceNumber: string) =>
  `${kind === "credit" ? "Credit" : "Debit"} note against ${invoiceNumber}`;
export const noteIssuedToast = (kind: NoteKind, number: string) =>
  `${kind === "credit" ? "Credit" : "Debit"} note ${number} issued.`;
/** 07-T §8, the owner's bell, which the approvals queue shows for a note's request. */
export const noteRequestRow = (requester: string, kind: NoteKind, client: string) =>
  `${requester} asked you to issue a ${kind} note for ${client}.`;
/** 07-T §8 (replaces §3's line hint). */
export const lineHint = (remaining: string) =>
  `Before GST. Up to ${remaining} can still be credited on this line.`;
export const amountHint = (remaining: string) => `Up to ${remaining} can still be credited on this invoice.`;
/** 07-T §8 "Against line {n}": `n` as the invoice numbers its lines (1-based). */
export const againstLine = (n: number) => `Against line ${n}`;
/** 07-T §1, the line beside the total (the screens show it in the preview, where it is about to be true). */
export const effectLine = (kind: NoteKind, invoiceNumber: string, total: string) =>
  kind === "credit"
    ? `This credit note reduces the amount due on invoice ${invoiceNumber} by ${total}.`
    : `This debit note increases the amount due on invoice ${invoiceNumber} by ${total}.`;
/** 07-T §1 (credit) and §8 (debit). OPEN (08-C RA-21): which day's rate a note on a USD export uses; the invoice's rate is our default. */
export const rateLine = (rate: string, invoiceNumber: string) =>
  `Exchange rate: 1 USD = ₹${rate} (the rate of invoice ${invoiceNumber})`;
/** 07-T §1: "Reason: {reason}". */
export const reasonLine = (reason: string) => `Reason: ${reason}`;
/** The label of a note's total (07-T §1). */
export const totalLabel = (kind: NoteKind) =>
  kind === "credit" ? NOTE_COPY.totalCredited : NOTE_COPY.totalAdded;
/** 07-T §9: "Up to the difference between the tax due and the tax on invoice {invoice number}." */
export const taxToAddHint = (invoiceNumber: string) =>
  `Up to the difference between the tax due and the tax on invoice ${invoiceNumber}.`;

/**
 * The debit note's labels 07-T does not have: the reason field (§3's says "printed on the credit note"), 07-W §1,
 * and the amount typed on each line, "Taxable value" (07-R §6's column word, which is what the amount is).
 */
export const DEBIT_REASON_LABEL = "Reason (required, printed on the debit note)";
export const DEBIT_LINE_LABEL = "Taxable value";

// ---- the reasons (07-T §3, §9 Q35; Researched 2026-10-28, 08-C RA-02, RA-22) ------------------------------------------------------------------

/** The tax-only debit note's reason (Q35, owner 2026-10-28): taxable value 0, the tax only. */
export const TAX_TOO_LOW = "tax_charged_too_low";

/**
 * The debit reasons in 07-T §9's order: core's `DEBIT_REASONS` (price correction, tax charged too low, other), the one list the screen and the API share.
 */
export const DEBIT_REASON_CODES: readonly string[] = DEBIT_REASONS;

/** The reasons a person can pick for this kind, in core's order, with their 07-T words (a code without words is the gap mark). */
export const reasonsOf = (
  kind: NoteKind,
  /** The invoice's supply: an export under LUT carries no tax, so "Tax charged too low" is not offered on it (07-W 5.11; the server refuses it too). */
  supplyType?: string | null,
): { code: string; label: string }[] =>
  (kind === "credit" ? (CREDIT_REASONS as readonly string[]) : DEBIT_REASON_CODES)
    .filter((code) => !(code === TAX_TOO_LOW && supplyType === "export_lut"))
    .map((code) => ({
      code,
      label: noteReasonLabel(code),
    }));

/** The hint under the reason (07-T §9): what "Discount after sale" and "Tax charged too low" do; none for the others. */
export const reasonHint = (code: string): string | undefined =>
  code === "discount_after_sale"
    ? NOTE_COPY.discountAfterSaleHint
    : code === TAX_TOO_LOW
      ? NOTE_COPY.taxTooLowHint
      : undefined;

/** A stored reason as the screens print it: "Other" is the words typed for it; any other code is its label. */
export const reasonText = (r: { code: string; text: string }): string =>
  r.code === "other" && r.text.trim() !== "" ? r.text.trim() : noteReasonLabel(r.code);

// ---- the deadline banner (07-ZD lines 2 to 5; Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)) ---------

export type DeadlineBanner = { tone: "info" | "warning" | "danger"; lines: string[] };

/**
 * What the invoice says about its credit deadline (rt1 T1, 07-ZD, replacing 07-T §4's lines). Before it: the last day a credit note may be dated (`lastDay`,
 * the end of the last return period before the return date) and the day its return must be filed by (`returnBy`; from an older API without it, `date`),
 * line 2; when the note goes in the quarterly GSTR-1 (`period` "quarter"), why, line 3. From `deadlineWarnFrom` (the first day of the month before
 * `lastDay`'s month, R2) the banner is a warning, led by the days left (line 4) while at least one is left; on the last day itself line 2 names that day.
 * After it (`passed`): line 5 in danger, and the credit actions are gone. An older API without `deadlineWarnFrom` warns within 30 days, as before. When the
 * supply's FY is earlier than the invoice's (a payment received or the work completed in the year before), 07-T's line that says so. `today` is today's
 * IST date (ISO). No line names a fixed day ("30 November") or sends the reader elsewhere: every date is the server's, for this invoice.
 */
export function deadlineBanner(
  d: CreditDeadlineView,
  invoiceFy: string | null,
  today: string,
): DeadlineBanner {
  const lastDay = dayText(d.lastDay) ?? d.lastDay;
  const lines: string[] = [];
  let tone: DeadlineBanner["tone"] = "info";
  if (d.passed) {
    tone = "danger";
    lines.push(deadlinePassedLine(lastDay));
  } else {
    const returnBy = d.returnBy ?? d.date;
    lines.push(deadlineBeforeLine(lastDay, dayText(returnBy) ?? returnBy));
    if (d.period === "quarter") lines.push(DEADLINE_QUARTER_LINE);
    const warn = d.deadlineWarnFrom ? today >= d.deadlineWarnFrom : d.daysLeft !== null && d.daysLeft <= 30;
    if (warn && d.daysLeft !== null && d.daysLeft >= 0) {
      tone = "warning";
      if (d.daysLeft >= 1) lines.unshift(deadlineWarnLine(d.daysLeft));
    }
  }
  if (invoiceFy !== null && d.supplyFy !== invoiceFy)
    lines.push(
      `The deadline counts from FY ${fyLabel(d.supplyFy, UNKNOWN)}, when the payment was received or the work was completed.`,
    );
  return { tone, lines };
}

// ---- the notes section (07-T §6, §8) -----------------------------------------------------------------------------------------------------------

/**
 * "Balance due: {balance} (after {count} credit notes)": the invoice's balance as the server holds it, after its credit notes (a debit note is its own
 * payable and does not move the invoice's balance, LD42, so only credit notes are counted, and the line says so: FX-4, full audit A5 6; 07-T's "notes" became
 * "credit notes", 07-Y, PENDING, marked). One credit note is said in the singular. `creditNotes` is `creditNoteCount` of the section.
 */
export const balanceLine = (balance: string, creditNotes: number) =>
  Y(
    creditNotes === 1
      ? `Balance due: ${balance} (after 1 credit note)`
      : `Balance due: ${balance} (after ${creditNotes} credit notes)`,
  );

/** How many issued credit notes the invoice's balance is after (debit notes are their own payables, LD42): what `balanceLine` counts. */
export const creditNoteCount = (notes: { credit: readonly NoteRow[] }): number => notes.credit.length;

/** One row of an invoice's notes ledger with its kind and its type's name ("Credit note", "Debit note": core's series labels), for the screen to show (FX-4, A5 6). */
export type NoteLedgerRow = NoteRow & {
  type: "credit_note" | "debit_note";
  kind: NoteKind;
  typeText: string;
};

/** A document number as its series part and the integer at its end ("TH/CN/2627/10" -> "TH/CN/2627/", 10); no integer -> null. */
const numberParts = (n: string | null): { series: string; seq: number | null } => {
  const m = n === null ? null : /^(.*?)(\d+)$/.exec(n);
  return m ? { series: m[1] as string, seq: Number(m[2]) } : { series: n ?? "", seq: null };
};

/** null after any number, so a missing value never jumps the queue. */
const byNumber = (a: number | null | undefined, b: number | null | undefined): number =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b;

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Two document numbers: by series (text), then by the integer at the end, never by the text of the whole ("/10" after "/9"). */
const byDocNumber = (a: string | null, b: string | null): number => {
  const [x, y] = [numberParts(a), numberParts(b)];
  return byText(x.series, y.series) || byNumber(x.seq, y.seq);
};

/**
 * The issued notes of an invoice as one ledger, oldest first, each row with its type: by issue date, then the instant it was issued, then the number (series, then its
 * integer: "TH/CN/2627/10" comes after "/9", early check L4), then the id, a stable order. The type comes from the row (the API sends it) or, from an older API, from the
 * list it came in.
 */
export function noteLedgerRows(notes: {
  credit: readonly NoteRow[];
  debit: readonly NoteRow[];
}): NoteLedgerRow[] {
  const tag = (r: NoteRow, fallback: "credit_note" | "debit_note"): NoteLedgerRow => {
    const type = r.type ?? fallback;
    return { ...r, type, kind: type === "credit_note" ? "credit" : "debit", typeText: typeLabel(type) };
  };
  return [
    ...notes.credit.map((r) => tag(r, "credit_note")),
    ...notes.debit.map((r) => tag(r, "debit_note")),
  ].sort(
    (a, b) =>
      byText(a.issueDate ?? "", b.issueDate ?? "") ||
      byNumber(a.issuedAt, b.issuedAt) ||
      byDocNumber(a.number, b.number) ||
      byText(a.id, b.id),
  );
}
export const refundLine = (amount: string) =>
  `Refund due to the client: ${amount}. Refunds are recorded with payments.`;

export const IMS_LABELS: Record<ImsStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  not_applicable: "Not applicable",
};

// ---- errors (07-T §7, §8) ------------------------------------------------------------------------------------------------------------------------

const noteWord = (kind: NoteKind) => (kind === "credit" ? "credit" : "debit");

export const NOTE_ERRORS = {
  credit_deadline_passed: "The deadline for a credit note on this invoice has passed.",
  parent_not_issued: "Notes can only be issued against an issued invoice.",
  parent_void: "This invoice is void, so no note can be issued against it.",
  note_reason_required: "Enter a reason.",
  nothing_to_credit: "Choose at least one line or an amount above zero.",
  ims_not_applicable: "IMS status only applies to credit notes for GST-registered clients.",
  parent_fully_credited: "This invoice has already been credited in full.",
  debit_parent_fully_credited:
    "This invoice has been credited in full, so a debit note can't be issued against it. Issue a new invoice instead.",
  // §9 (Q35; Researched 2026-10-28, 08-C RA-22)
  debit_tax_only_invalid: 'Enter tax only: the taxable value of a "Tax charged too low" note is zero.',
  // 07-W 5.9: the tax to add is odd on an intra-state invoice (CGST must equal SGST); `debit_tax_only_invalid` with `details.reason` "odd_amount", and the screen's own check before sending
  debit_tax_odd_amount: "Enter an even amount: it is split equally between CGST and SGST.",
  // §9 (Researched 2026-10-28, 08-C RA-02)
  discount_reason_not_in_force: "A credit note for a discount after sale can be dated from 1 November 2026.",
  // §9: a note draft whose invoice changed (replaces 07-R's content_changed for a note)
  content_changed:
    "Another note was issued on this invoice since this draft was saved. Open the draft and save it again.",
  parent_changed:
    "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left.",
  note_lines_derived: "A note's lines come from its invoice and can't be edited directly.",
  note_not_voidable:
    "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note.",
  ims_not_pending: "The client's IMS response is already recorded.",
  annual_return_future: "The filing date can't be in the future.",
  credit_shape_mismatch: "This credit note doesn't match its invoice any more. Start again from the invoice.",
} as const;

/** 07-T §9 (Q66): `credit_amount_unfit` when rounding leaves no amount to offer. */
export const AMOUNT_TOO_SMALL = "This amount is too small to credit after rounding. Enter a larger amount.";

export const exceedsRemaining = (remaining: string) =>
  `That's more than can still be credited on this invoice (${remaining}).`;
/** `n` is the invoice's line as the invoice numbers it (1-based). */
export const lineExceeds = (n: number, remaining: string) =>
  `Line ${n} can only be credited up to ${remaining}.`;
export const noteDraftExists = (kind: NoteKind) =>
  `There's already a draft ${noteWord(kind)} note for this invoice. Open it to continue.`;
export const notesLimit = (kind: NoteKind) =>
  `This invoice already has 20 ${noteWord(kind)} notes, the most it can have.`;
/** 07-T §8 `credit_amount_unfit`: the question, and the button that takes the amount. */
export const amountUnfit = (closest: string) =>
  `Because of rounding, the nearest amount this credit note can be is ${closest}. Use that amount instead?`;
export const closestButton = (closest: string) => `Use ${closest}`;

/** "Open it to continue." of `note_draft_exists`, cut off so it can be the link to the draft. */
export function splitDraftLine(kind: NoteKind): [string, string] {
  const t = noteDraftExists(kind);
  const at = t.indexOf("Open it");
  return [t.slice(0, at), t.slice(at)];
}

/** The sentence for a failed note request: 07-T by code (with the figures the 409 carries), else the invoice screens' sentences. */
export function noteErrorText(e: unknown, kind: NoteKind, currency: Currency): string {
  if (e instanceof RequestError) {
    const left = typeof e.extra.remaining === "number" ? moneyText(e.extra.remaining, currency) : null;
    switch (e.code) {
      case "credit_exceeds_remaining":
        return left ? exceedsRemaining(left) : e.message;
      case "line_credit_exceeds":
        return left && typeof e.extra.line === "number" ? lineExceeds(e.extra.line + 1, left) : e.message;
      case "debit_tax_only_invalid":
        return e.extra.reason === "odd_amount"
          ? NOTE_ERRORS.debit_tax_odd_amount
          : NOTE_ERRORS.debit_tax_only_invalid;
      case "note_draft_exists":
        return noteDraftExists(kind);
      case "notes_limit":
        return notesLimit(kind);
      case "credit_amount_unfit":
        return typeof e.extra.closestMinor === "number"
          ? amountUnfit(moneyText(e.extra.closestMinor, currency))
          : AMOUNT_TOO_SMALL;
    }
    if (Object.hasOwn(NOTE_ERRORS, e.code)) return (NOTE_ERRORS as Record<string, string>)[e.code] as string;
  }
  return invErrorText(e);
}

/** A note blocker as the server sends it: the code, the invoice's line (0-based), what is left, the last day, the FY token whose LUT is missing. */
export type NoteBlockerIn = { code: string; line?: number; remaining?: number; date?: string; fy?: string };

/**
 * One line per note blocker (`NOTE_BLOCKER_CODES`): the note's own codes in 07-T's words; the supplier's details, the tax, the reverse-charge line and
 * the bank in 07-R's (the same fix, in the same place, as for an invoice); the debit note's LUT in 07-ZD's (line 6; Researched 2026-10-30, Rule 96A(1)
 * CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)).
 */
export function noteBlockerLine(b: NoteBlockerIn, kind: NoteKind, currency: Currency): string {
  switch (b.code) {
    case "debit_lut_missing":
      // The FY of the debit note's date, as a label ("2027-28") through the admin's one helper; "…" (UNKNOWN) when the server sent none or a damaged token.
      return debitLutMissingLine(fyLabel(b.fy, UNKNOWN));
    case "parent_not_issued":
    case "parent_void":
    case "parent_fully_credited":
    case "debit_parent_fully_credited":
    case "nothing_to_credit":
    case "credit_deadline_passed":
    case "note_reason_required":
      return NOTE_ERRORS[b.code];
    case "debit_tax_only_invalid":
    case "discount_reason_not_in_force":
      return NOTE_ERRORS[b.code];
    case "credit_exceeds_remaining":
      // An answer without the figure keeps 07-T's sentence with "…" for it (UNKNOWN), as the other blockers do.
      return exceedsRemaining(b.remaining !== undefined ? moneyText(b.remaining, currency) : UNKNOWN);
    case "line_credit_exceeds":
      return b.line !== undefined
        ? lineExceeds(b.line + 1, b.remaining !== undefined ? moneyText(b.remaining, currency) : UNKNOWN)
        : exceedsRemaining(b.remaining !== undefined ? moneyText(b.remaining, currency) : UNKNOWN);
    case "notes_limit":
      return notesLimit(kind);
    default:
      return blockerLine(b, currency);
  }
}

// ---- the dialog's request ----------------------------------------------------------------------------------------------------------------------

export type NoteForm = {
  mode: NoteMode;
  /** The amount typed per invoice line (by the line's 0-based index), before GST. */
  lines: Record<number, string>;
  amount: string;
  reasonCode: string;
  reasonText: string;
  /** "Tax charged too low" (a debit note): the tax to add, as typed. */
  tax: string;
};

export const emptyNoteForm = (): NoteForm => ({
  mode: "lines",
  lines: {},
  amount: "",
  reasonCode: "",
  reasonText: "",
  tax: "",
});

/** A debit note that adds only tax (07-T §9): no lines are asked, the tax to add is. */
export const isTaxOnly = (kind: NoteKind, reasonCode: string) =>
  kind === "debit" && reasonCode === TAX_TOO_LOW;

/** A stored request as the dialog shows it again (a draft opened later). */
export function noteFormOf(n: NoteOfView, currency: Currency): NoteForm {
  const lines: Record<number, string> = {};
  // A tax-only debit note's takes are taxable 0 on every taxed line: nothing to show in the (hidden) line fields.
  if (n.request.mode === "lines" && n.request.taxMinor === undefined)
    for (const t of n.request.takes) lines[t.line] = moneyInput(t.taxableMinor, currency);
  return {
    mode: n.request.mode,
    lines,
    amount: n.request.grossMinor !== undefined ? moneyInput(n.request.grossMinor, currency) : "",
    reasonCode: n.reason.code,
    reasonText: n.reason.text,
    tax: n.request.taxMinor !== undefined ? moneyInput(n.request.taxMinor, currency) : "",
  };
}

/** Field keys of the dialog's errors: `line-{index}`, `lines`, `amount`, `tax`, `reason`, `reasonText`. */
export type NoteFormErrors = Partial<Record<string, string>>;

/**
 * The request the dialog sends, or what is wrong with what was typed. A typed amount is parsed through core; a credit is compared with what the
 * server says is left on its line or on the invoice (the server checks it again and decides). An empty or zero line is not part of the request.
 */
export function buildNoteFields(
  kind: NoteKind,
  f: NoteForm,
  ctx: {
    currency: Currency;
    /** The invoice's lines: a credit note's with what is left, a debit note's (anything can be added). */
    lines: readonly Pick<CreditableLine, "line" | "position" | "taxableLeftMinor">[];
    totalLeftMinor: number | null;
    /** The invoice's supply: on an intra-state one the tax to add is split equally between CGST and SGST, so an odd amount is refused here (07-W 5.9). */
    supplyType?: string | null | undefined;
  },
): { ok: true; fields: NoteFieldsIn } | { ok: false; errors: NoteFormErrors } {
  const errors: NoteFormErrors = {};
  const mode: NoteMode = kind === "debit" ? "lines" : f.mode;
  const takes: Take[] = [];
  let grossMinor: number | undefined;
  let taxAmountMinor: number | undefined;
  if (isTaxOnly(kind, f.reasonCode)) {
    // 07-T §9: the tax to add, above zero (07-S §8's "Enter an amount above zero."); no lines (the taxable value is 0, contract).
    const m = moneyFrom(f.tax, ctx.currency);
    if (f.tax.trim() === "" || (m.ok && m.minor === 0)) errors.tax = INVT_COPY.amountZero;
    else if (!m.ok) errors.tax = m.error;
    else if (ctx.supplyType === "intra" && m.minor % 2 !== 0) errors.tax = NOTE_ERRORS.debit_tax_odd_amount;
    else taxAmountMinor = m.minor;
  } else if (mode === "lines") {
    for (const l of ctx.lines) {
      const typed = (f.lines[l.line] ?? "").trim();
      if (typed === "") continue;
      const m = moneyFrom(typed, ctx.currency);
      if (!m.ok) {
        errors[`line-${l.line}`] = m.error;
        continue;
      }
      if (m.minor === 0) continue;
      if (kind === "credit" && m.minor > l.taxableLeftMinor) {
        errors[`line-${l.line}`] = lineExceeds(l.position, moneyText(l.taxableLeftMinor, ctx.currency));
        continue;
      }
      takes.push({ line: l.line, taxableMinor: m.minor });
    }
    if (takes.length === 0 && Object.keys(errors).length === 0) errors.lines = NOTE_ERRORS.nothing_to_credit;
  } else if (mode === "amount") {
    const m = moneyFrom(f.amount, ctx.currency);
    if (f.amount.trim() === "" || (m.ok && m.minor === 0)) errors.amount = NOTE_ERRORS.nothing_to_credit;
    else if (!m.ok) errors.amount = m.error;
    else if (ctx.totalLeftMinor !== null && m.minor > ctx.totalLeftMinor)
      errors.amount = exceedsRemaining(moneyText(ctx.totalLeftMinor, ctx.currency));
    else grossMinor = m.minor;
  }
  if (f.reasonCode === "") errors.reason = NOTE_ERRORS.note_reason_required;
  else if (f.reasonCode === "other" && f.reasonText.trim() === "")
    errors.reasonText = NOTE_ERRORS.note_reason_required;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const text = f.reasonText.trim();
  return {
    ok: true,
    fields: {
      mode,
      // a tax-only debit note sends no `lines` at all (the API refuses an empty list or lines with the tax)
      ...(mode === "lines" && taxAmountMinor === undefined ? { lines: takes } : {}),
      ...(grossMinor !== undefined ? { grossMinor } : {}),
      ...(taxAmountMinor !== undefined ? { taxAmountMinor } : {}),
      reasonCode: f.reasonCode,
      // only "Other" is described in words (07-T §3); the words of an earlier "Other" are not sent with another reason
      ...(f.reasonCode === "other" && text !== "" ? { reasonText: text } : {}),
    },
  };
}

/** The order the dialog's errors are focused in (the first one takes the cursor). */
export function firstErrorKey(errors: NoteFormErrors, lines: readonly { line: number }[]): string | null {
  for (const l of lines) if (errors[`line-${l.line}`]) return `line-${l.line}`;
  for (const k of ["lines", "amount", "tax", "reason", "reasonText"]) if (errors[k]) return k;
  return null;
}

// ---- Settings › Tax: the annual return of each FY (07-T §4, §8; Q33; Researched 2026-10-28, 08-C RA-03) --------------------------------------

export const ANNUAL_RETURN_ERRORS = {
  fy: "Enter the financial year.",
  duplicate: "This year already has a filing date.",
  beforeEnd: "The filing date must be after the end of that financial year.",
  future: NOTE_ERRORS.annual_return_future,
} as const;

export type AnnualReturn = { fy: string; filedOn: string };

/** The financial years the screen offers a date for: the two last completed ones (a return is filed after its year ends) and any already saved. */
export function annualReturnYears(
  todayMs: number,
  saved: readonly AnnualReturn[],
): { token: string; label: string }[] {
  const now = fyOf(todayMs).startYear;
  const years = new Map<string, string>();
  for (const y of [now - 1, now - 2]) {
    const fy = financialYear(y);
    years.set(fy.token, fy.label);
  }
  for (const r of saved) if (!years.has(r.fy)) years.set(r.fy, fyLabel(r.fy));
  return [...years]
    .map(([token, label]) => ({ token, label }))
    .sort((a, b) => b.token.localeCompare(a.token));
}

/** The first day a return of FY `token` ("2627") can be filed on: 1 April after the year ("2027-04-01"). */
export const firstFilingDay = (token: string) => `${2000 + Number(token.slice(2, 4))}-04-01`;

/** The problem with one year's date as typed (an empty date is no return), or null. `today` is today's IST date. */
export function annualReturnError(fy: string, filedOn: string, today: string): string | null {
  if (filedOn === "") return null;
  if (!/^\d{4}$/.test(fy)) return ANNUAL_RETURN_ERRORS.fy;
  if (filedOn < firstFilingDay(fy)) return ANNUAL_RETURN_ERRORS.beforeEnd;
  if (filedOn > today) return ANNUAL_RETURN_ERRORS.future;
  return null;
}

/** The dates by year → the list the settings store (one per FY, newest first; an empty date is left out). */
export const annualReturnsOf = (byYear: Record<string, string>): AnnualReturn[] =>
  Object.entries(byYear)
    .filter(([, filedOn]) => filedOn !== "")
    .map(([fy, filedOn]) => ({ fy, filedOn }))
    .sort((a, b) => b.fy.localeCompare(a.fy));
