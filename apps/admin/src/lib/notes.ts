// The words and the pure rules of the credit and debit note screens (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note"): 07-T word for word, the reason
// lists, the deadline banner, the notes section's lines, the error and blocker sentences by API code, the request a dialog sends, and the annual
// return dates of Settings › Tax. Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-T (docs/07-content-appendix/T-m5.3-credit-debit-notes.md), PENDING the owner's word-for-word approval; every tax and legal line is
// VERIFY WITH CA/LEGAL. A line 07-T does not have is "[Placeholder]" (`INV_PLACEHOLDER`), never invented; where a line is used in its singular or
// for the debit note, the place says so (and the run file lists it).
//
// Money: amounts are the server's minor units, formatted through core (`moneyText`); typed amounts are parsed through core (`moneyFrom`). Nothing
// here adds, multiplies or rounds money: what can still be credited, the totals and the balance are the server's. A typed amount is only COMPARED
// with what the server said is left, so the person hears it before a request is sent; the server checks it again.
import { financialYear, fyOf } from "@techaust/core";
import { CREDIT_REASONS, DEBIT_REASONS } from "@techaust/core/invoices";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import { dayText } from "./documents.ts";
import { fyLabel, INV_PLACEHOLDER } from "./invoice-types.ts";
import { blockerLine, invErrorText, moneyText } from "./invoices.ts";
import type {
  CreditableLine,
  CreditDeadlineView,
  ImsStatus,
  NoteFieldsIn,
  NoteKind,
  NoteMode,
  NoteOfView,
  Take,
} from "./notes-api.ts";
import { moneyFrom, moneyInput } from "./settings-form.ts";

export { INV_PLACEHOLDER };

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
  annualReturnHint: "Once filed, credit notes for that year are blocked.",
  // §5
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
/** 07-T §1 (credit) and §8 (debit). VERIFY WITH CA/LEGAL. */
export const rateLine = (rate: string, invoiceNumber: string) =>
  `Exchange rate: 1 USD = ₹${rate} (the rate of invoice ${invoiceNumber})`;
/** 07-T §1: "Reason: {reason}". */
export const reasonLine = (reason: string) => `Reason: ${reason}`;
/** The label of a note's total (07-T §1). */
export const totalLabel = (kind: NoteKind) =>
  kind === "credit" ? NOTE_COPY.totalCredited : NOTE_COPY.totalAdded;
/**
 * The debit note's labels 07-T does not have: the reason field (§3's says "printed on the credit note") and the amount typed on each line. Shown as
 * "[Placeholder]" and "Taxable value" (07-R §6's column word, which is what the amount is) until the owner's lines exist.
 */
export const DEBIT_REASON_LABEL = INV_PLACEHOLDER;
export const DEBIT_LINE_LABEL = "Taxable value";

// ---- the reasons (07-T §3, §8 Q35; VERIFY WITH CA/LEGAL) --------------------------------------------------------------------------------------

const REASON_WORDS: Record<string, string> = {
  price_correction: "Price correction",
  service_not_delivered: "Service not delivered",
  service_deficient: "Service deficient",
  discount_after_sale: "Discount after sale",
  other: "Other",
};

/** The reasons a person can pick for this kind, in core's order, with their 07-T words (a code without words keeps the placeholder). */
export const reasonsOf = (kind: NoteKind): { code: string; label: string }[] =>
  (kind === "credit" ? CREDIT_REASONS : DEBIT_REASONS).map((code) => ({
    code,
    label: REASON_WORDS[code] ?? INV_PLACEHOLDER,
  }));

/** A stored reason as the screens print it: "Other" is the words typed for it; any other code is its label. */
export const reasonText = (r: { code: string; text: string }): string =>
  r.code === "other" && r.text.trim() !== "" ? r.text.trim() : (REASON_WORDS[r.code] ?? r.code);

// ---- the deadline banner (07-T §4; s.34(2), Q32, Q33; VERIFY WITH CA/LEGAL) -----------------------------------------------------------------

export type DeadlineBanner = { tone: "info" | "warning" | "danger"; lines: string[] };

/**
 * What the invoice says about its credit deadline: before it, the date (the last day a credit note may be dated: the cutoff, or the day before the annual
 * return was filed); within 30 days of it, the days left as well; after it, that it has passed (and the credit actions are gone). When the supply's FY is
 * earlier than the invoice's (a payment received or the work completed in the year before), the line that says so.
 */
export function deadlineBanner(d: CreditDeadlineView, invoiceFy: string | null): DeadlineBanner {
  const date = dayText(d.lastDay) ?? d.lastDay;
  const lines: string[] = [];
  let tone: DeadlineBanner["tone"] = "info";
  if (d.passed) {
    tone = "danger";
    lines.push(
      `The deadline for a credit note on this invoice was ${date}. A refund now can't reduce the GST already paid. Talk to your CA.`,
    );
  } else {
    lines.push(
      `Credit notes for this invoice must be issued by ${date} (30 November after its financial year, or earlier if the annual return is filed).`,
    );
    if (d.daysLeft !== null && d.daysLeft <= 30) {
      tone = "warning";
      // The days left lead (they are the news), the date follows. 07-T §4 has the plural; one day is said in its singular (run file). On the last day the date says it.
      if (d.daysLeft >= 2)
        lines.unshift(`Only ${d.daysLeft} days left to issue a credit note for this invoice.`);
      else if (d.daysLeft === 1) lines.unshift("Only 1 day left to issue a credit note for this invoice.");
    }
  }
  if (invoiceFy !== null && d.supplyFy !== invoiceFy)
    lines.push(
      `The deadline counts from FY ${fyLabel(d.supplyFy)}, when the payment was received or the work was completed.`,
    );
  return { tone, lines };
}

// ---- the notes section (07-T §6, §8) -----------------------------------------------------------------------------------------------------------

/**
 * "Balance due: {balance} (after {count} notes)": the invoice's balance as the server holds it, after its credit notes (a debit note is its own
 * payable and does not move the invoice's balance, LD42, so only credit notes are counted). One note is said in the singular (listed in the run file).
 */
export const balanceLine = (balance: string, count: number) =>
  count === 1 ? `Balance due: ${balance} (after 1 note)` : `Balance due: ${balance} (after ${count} notes)`;
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
  debit_parent_fully_credited: "[Placeholder]",
  parent_changed:
    "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left.",
  note_lines_derived: "A note's lines come from its invoice and can't be edited directly.",
  note_not_voidable:
    "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note.",
  ims_not_pending: "The client's IMS response is already recorded.",
  annual_return_future: "The filing date can't be in the future.",
  credit_shape_mismatch: "This credit note doesn't match its invoice any more. Start again from the invoice.",
} as const;

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
      case "note_draft_exists":
        return noteDraftExists(kind);
      case "notes_limit":
        return notesLimit(kind);
      case "credit_amount_unfit":
        return typeof e.extra.closestMinor === "number"
          ? amountUnfit(moneyText(e.extra.closestMinor, currency))
          : e.message;
    }
    if (Object.hasOwn(NOTE_ERRORS, e.code)) return (NOTE_ERRORS as Record<string, string>)[e.code] as string;
  }
  return invErrorText(e);
}

/** A note blocker as the server sends it: the code, the invoice's line (0-based), what is left, the last day. */
export type NoteBlockerIn = { code: string; line?: number; remaining?: number; date?: string };

/**
 * One line per note blocker (`NOTE_BLOCKER_CODES`): the note's own codes in 07-T's words; the supplier's details, the tax, the reverse-charge line and
 * the bank in 07-R's (the same fix, in the same place, as for an invoice).
 */
export function noteBlockerLine(b: NoteBlockerIn, kind: NoteKind, currency: Currency): string {
  switch (b.code) {
    case "parent_not_issued":
    case "parent_void":
    case "parent_fully_credited":
    case "debit_parent_fully_credited":
    case "nothing_to_credit":
    case "credit_deadline_passed":
    case "note_reason_required":
      return NOTE_ERRORS[b.code];
    case "credit_exceeds_remaining":
      return b.remaining !== undefined ? exceedsRemaining(moneyText(b.remaining, currency)) : INV_PLACEHOLDER;
    case "line_credit_exceeds":
      return b.remaining !== undefined && b.line !== undefined
        ? lineExceeds(b.line + 1, moneyText(b.remaining, currency))
        : INV_PLACEHOLDER;
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
};

export const emptyNoteForm = (): NoteForm => ({
  mode: "lines",
  lines: {},
  amount: "",
  reasonCode: "",
  reasonText: "",
});

/** A stored request as the dialog shows it again (a draft opened later). */
export function noteFormOf(n: NoteOfView, currency: Currency): NoteForm {
  const lines: Record<number, string> = {};
  if (n.request.mode === "lines")
    for (const t of n.request.takes) lines[t.line] = moneyInput(t.taxableMinor, currency);
  return {
    mode: n.request.mode,
    lines,
    amount: n.request.grossMinor !== undefined ? moneyInput(n.request.grossMinor, currency) : "",
    reasonCode: n.reason.code,
    reasonText: n.reason.text,
  };
}

/** Field keys of the dialog's errors: `line-{index}`, `lines`, `amount`, `reason`, `reasonText`. */
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
  },
): { ok: true; fields: NoteFieldsIn } | { ok: false; errors: NoteFormErrors } {
  const errors: NoteFormErrors = {};
  const mode: NoteMode = kind === "debit" ? "lines" : f.mode;
  const takes: Take[] = [];
  let grossMinor: number | undefined;
  if (mode === "lines") {
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
      ...(mode === "lines" ? { lines: takes } : {}),
      ...(grossMinor !== undefined ? { grossMinor } : {}),
      reasonCode: f.reasonCode,
      // only "Other" is described in words (07-T §3); the words of an earlier "Other" are not sent with another reason
      ...(f.reasonCode === "other" && text !== "" ? { reasonText: text } : {}),
    },
  };
}

/** The order the dialog's errors are focused in (the first one takes the cursor). */
export function firstErrorKey(errors: NoteFormErrors, lines: readonly { line: number }[]): string | null {
  for (const l of lines) if (errors[`line-${l.line}`]) return `line-${l.line}`;
  for (const k of ["lines", "amount", "reason", "reasonText"]) if (errors[k]) return k;
  return null;
}

// ---- Settings › Tax: the annual return of each FY (07-T §4, §8; Q33; VERIFY WITH CA/LEGAL) ----------------------------------------------------

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
