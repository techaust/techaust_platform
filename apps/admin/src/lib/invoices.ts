// The words and the pure rules of the M5.1 invoice screens (ADM-INV-01..04, -07, ADM-APR-01/02, ADM-PRJ-02): 07-R word for word, the badges,
// the blocker lines with where each is fixed, the error sentences by API code, the series preview, and the draft editor's state with its two pure
// autosave steps (`buildInvoicePatch`, `applyInvoiceSave`). Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-R (docs/07-content-appendix/R-m5.1-invoice-screens.md), approved by the lead on 2026-10-28 under the owner's delegation, word for word. A
// line 07-R lacked is 07-W's (approved 2026-10-28), never invented. The type names are core's
// series labels (`@techaust/core/numbering`).
//
// Money: amounts are the server's minor units, formatted through core (`moneyText`); typed amounts are parsed through core. Nothing here adds,
// multiplies or rounds money. The due date and the number are the server's; the screen never works them out.
import { milestoneBillableRule } from "@techaust/core/invoices";
import { SERIES, type Series } from "@techaust/core/numbering";
import { PROFORMA_PDF_COPY } from "@techaust/pdf/copy";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { milliToQty } from "./catalogue.ts";
import { Y } from "./copy-y.ts";
import { VOID_VIEWED_COPY } from "./copy-z.ts";
import {
  dayText,
  docErrorText,
  formatIstDay,
  type LineDraft,
  type LineErrors,
  lineErrors,
  lineIn,
  moneyText,
  parseDiscount,
  uid,
} from "./documents.ts";
import type { ApprovalInfo, Discount, DiscountKind, LineFigures } from "./documents-api.ts";
import { sentence as sentenceOf } from "./format.ts";
import {
  advanceLutMissing,
  fyLabel,
  INVT_COPY,
  proformaDraftTitle,
  proformaLockedLine,
} from "./invoice-types.ts";
import type {
  InvoiceBlocker,
  InvoiceLine,
  InvoiceListRow,
  InvoicePatch,
  InvoiceStatus,
  InvoiceType,
  InvoiceView,
} from "./invoices-api.ts";
import { VOID_PAYMENT_PENDING, VOID_PAYMENT_RECORDED } from "./payments.ts";
import { bpToPercent, moneyInput } from "./settings-form.ts";

export { moneyText };

/** A fact the server didn't send (a name, a date): the screen shows that something is missing, never a guess. */
export const UNKNOWN = "…";

/** The list's empty state when filters hide every row: 07-R has no line, so the 07-O pattern ("No proposals or estimates match these filters.") is
 * proposed for invoices, 07-W §1. */
export const INV_NO_MATCH = "No invoices match these filters";

/** 07-R §7 (Q11, owner 2026-10-28): the stored supplier copy's download, for the Owner and the Accountant. */
export const SUPPLIER_COPY_LABEL = "Download supplier copy";

/**
 * FX-4 (early check M1; 07-Y, PENDING, marked until approved): the line under "Download supplier copy" when the API answers 409 `pdf_pending` for an
 * anonymised client: its copy is never made (no PDF work for an anonymised client), so the line says so and offers nothing.
 * FX-4 review L2: the button is drawn only once the client's PDF is ready (the PDF panel's `extra`), and the copy follows that PDF, so for a live
 * client the 409 can't follow from the screen. The old line for that case ("…made after the client's PDF…") had no way to show and is gone; a stale
 * page that ever met one says it like any other failure (`supplierCopyLine` is null, and the screen's toast says to try again).
 */
export const SUPPLIER_COPY_NONE = Y(
  "No supplier copy was made before this client was anonymised, and none can be made now.",
);

/**
 * FX-4 review M1 (A5 5): a proforma's tax head as an estimate, "CGST (estimate)", in the PDF's own words (`PROFORMA_PDF_COPY.estimate`, 07-Y, pending;
 * unmarked like the PDF, docs/13), so the screen and the PDF never differ. Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28).
 */
export const taxHeadEstimate: (head: string) => string = PROFORMA_PDF_COPY.estimate;

/** Whether the view's tax heads read as estimates: only a proforma with the marker (sealed with it, or a draft that will be); never an older seal. */
export const showsGstEstimate = (v: {
  type: string;
  proforma?: { gstEstimate?: boolean | undefined } | null | undefined;
}): boolean => v.type === "proforma" && v.proforma?.gstEstimate === true;

/** The line that stays under the supplier copy's button after an answer: only an anonymised client's 409 has one. */
export const supplierCopyLine = (state: string, anonymised: boolean): string | null =>
  state === "no_original" && anonymised ? SUPPLIER_COPY_NONE : null;

// ---- 07-R §1–§4, word for word ---------------------------------------------------------------------------------------------------------------

export const INV_COPY = {
  // §1
  nav: "Invoices",
  title: "Invoices",
  intro:
    "Tax invoices you've drafted or issued. A number is given only when an invoice is issued, and an issued invoice can't be changed.",
  filterType: "Type",
  filterStatus: "Status",
  filterClient: "Client",
  colNumber: "Number",
  colClient: "Client",
  colIssued: "Issued",
  colDue: "Due",
  colTotal: "Total",
  colBalance: "Balance",
  colStatus: "Status",
  notIssued: "Not issued yet",
  empty: "No invoices yet. Create one from a client, or from a milestone that's ready to bill.",
  newInvoice: "New invoice",
  clientTab: "Invoices",
  clientEmpty: "No invoices for this client yet.",
  // §2
  draftLede: "Drafts can be edited. Issuing gives the next number and locks the invoice.",
  contact: "Contact",
  lines: "Lines",
  documentDiscount: "Document discount",
  dueDate: "Due date",
  saveDraft: "Save draft",
  issue: "Issue invoice",
  requestIssue: "Request issue",
  deleteDraft: "Delete draft",
  deleteBody: "Delete this draft? It has no number yet, so nothing is lost from the series.",
  keepIt: "Keep it",
  saved: "Draft saved.",
  // §3
  issueTitle: "Issue invoice",
  fixFirst: "Fix these before issuing:",
  cancel: "Cancel",
  requestTitle: "Ask the owner to issue this invoice",
  requestBody:
    "The owner gets a request to issue this invoice. If you change the draft afterwards, the request is cancelled and you'll need to send a new one.",
  sendRequest: "Send request",
  requested: "Issue requested. You'll get a bell when the owner decides.",
  kindIssue: "Issue invoice",
  approveButton: "Issue invoice",
  rejectButton: "Reject",
  approveNote: "Approving issues the invoice now, with the next number. You'll be asked for your code.",
  // §4
  pdfPreparing: "PDF being prepared…",
  pdfDownload: "Download PDF",
  pdfFailed: "The PDF couldn't be made. Try again.",
  pdfTryAgain: "Try again",
  voidButton: "Void invoice",
  // OPEN (08-C RA-10): whether a never-delivered invoice may be reported as cancelled.
  voidBody:
    "Voiding cancels this invoice. It keeps its number, which is reported as cancelled in your GST return. You can only void an invoice in the month it was issued, before it has been emailed, opened by the client in the portal, paid or corrected by a credit or debit note; after that, use a credit note.",
  // 07-ZA item 9 (owner 2026-10-30): a proforma's own void dialog.
  voidProformaBody:
    "Voiding cancels this proforma. It keeps its number. You can void it only before it has been emailed, opened by the client in the portal, paid or converted into an invoice.",
  voidProformaConfirm: "Void proforma",
  voidReason: "Reason (required, kept with the invoice)",
  // 07-ZA item 18 (owner 2026-10-30): the reason box of a proforma's void dialog.
  voidProformaReason: "Reason (required, kept with the proforma)",
  voidReasonEmpty: "Enter a reason for voiding.",
  voidConfirm: "Void invoice",
  milestoneBackReady: "The milestone is back to Ready to bill.",
  milestoneBackPending: "The milestone is back to Pending.",
  createInvoice: "Create invoice",
} as const;

/**
 * 07-R §4 "Milestone after void", picked by the status the void left the milestone in (the server's rule: back to pending when the work was
 * never delivered, an advance invoice; else back to ready to bill). Any other status (or none read) gets no line rather than a wrong one.
 */
export const milestoneBackLine = (status: string | null | undefined): string | null =>
  status === "pending"
    ? INV_COPY.milestoneBackPending
    : status === "ready_to_bill"
      ? INV_COPY.milestoneBackReady
      : null;

/** 07-R "Draft invoice for {client}"; a proforma has its own (07-S §8). */
export const draftTitle = (client: string, type?: string) =>
  type === "proforma" ? proformaDraftTitle(client) : `Draft invoice for ${client}`;
/** 07-R's due-date note; "Net N" is Settings › Payment terms' number, never a fixed 7 (FX-5 review L6). */
export const dueNote = (date: string, days: number, netDays: number) =>
  `Due ${date}: ${days} days after the issue date (the client's terms, or Net ${netDays}).`;
export const fromMilestone = (milestone: string, project: string) =>
  `Created from the milestone "${milestone}" of ${project}. The total matches the milestone amount, GST included.`;
export const issueBody = (seriesPreview: string, example: string, issueDate: string) =>
  `This invoice will get the next number in the series (${seriesPreview}, for example ${example}) and the date ${issueDate}. Once issued it can't be edited or deleted. Corrections are made with a credit note or a debit note.`;
export const issuedToast = (number: string, type?: string) =>
  type === "proforma" ? `Proforma ${number} issued.` : `Invoice ${number} issued.`;
/** 07-S §8: a proforma's own draft lede and issue wording; every other type keeps 07-R's. */
export const draftLedeFor = (type: string) =>
  type === "proforma"
    ? "Drafts can be edited. Issuing gives the next proforma number and locks it."
    : INV_COPY.draftLede;
export const issueLabelFor = (type: string) => (type === "proforma" ? "Issue proforma" : INV_COPY.issue);
export const waitingLine = (date: string) => `Waiting for the owner to issue it (requested ${date}).`;
export const requestRow = (requester: string, client: string, total: string) =>
  `${requester} asked to issue a draft invoice for ${client}: ${total}.`;
export const rejectReasonLabel = (requester: string) => `Reason (optional, shown to ${requester})`;
/** 07-R's locked banner; a proforma is corrected by voiding it, not by a note (07-S §8). */
export const frozenBanner = (date: string, name: string, type?: string) =>
  type === "proforma"
    ? proformaLockedLine(date, name)
    : `Issued ${date} by ${name}. This invoice is locked: corrections are made with a credit note or a debit note.`;
export const voidTitle = (number: string, type?: string) =>
  type === "proforma" ? `Void proforma ${number}` : `Void invoice ${number}`;
export const voidedLine = (date: string, name: string, reason: string) =>
  `Voided ${date} by ${name}: ${reason}`;
/** 07-R §4: "This milestone already has invoice {number}." or, for a draft, "This milestone already has a draft invoice." */
export const milestoneHasInvoice = (number: string | null) =>
  number === null
    ? "This milestone already has a draft invoice."
    : `This milestone already has invoice ${number}.`;
/** 07-R §4 (docs/13 2026-10-26): "Converted to invoice {number}." or, for a draft, "Converted to a draft invoice." */
export const convertedToInvoice = (number: string | null) =>
  number === null ? "Converted to a draft invoice." : `Converted to invoice ${number}.`;

/**
 * May a draft invoice be made from this milestone? The server's rule, shared from core (`milestoneBillableRule`): Ready to bill, or the pending
 * advance (marked when Start project made it, so a reorder never moves it), billable again after its invoice is voided.
 */
export function milestoneBillable(m: {
  status: string;
  isAdvance: boolean;
  documentId: string | null;
}): boolean {
  if (m.documentId !== null) return false;
  return milestoneBillableRule(m);
}

// ---- types and badges --------------------------------------------------------------------------------------------------------------------------

const SERIES_OF_TYPE: Record<InvoiceType, Series> = {
  tax_invoice: "invoice",
  export_invoice: "export",
  credit_note: "creditNote",
  debit_note: "debitNote",
  proforma: "proforma",
};
export const INVOICE_TYPES: readonly InvoiceType[] = [
  "tax_invoice",
  "export_invoice",
  "proforma",
  "credit_note",
  "debit_note",
];
/** The type's name: core's series label ("Tax invoice", "Export invoice", …). */
export const typeLabel = (t: InvoiceType | string): string =>
  Object.hasOwn(SERIES_OF_TYPE, t) ? SERIES[SERIES_OF_TYPE[t as InvoiceType]].label : t;

/**
 * The badges: 07-R's four, M5.2's "Converted" (07-S §6: a proforma a tax invoice was issued from) and "Paid" (docs/06 §5.5: the tax invoice issued for a
 * payment received is paid at issue). Overdue is worked out by the server (a balance past its due date), never stored.
 */
export type Badge =
  | "draft"
  | "issued"
  | "overdue"
  | "void"
  | "converted"
  | "paid"
  | "partly_credited"
  | "credited";
export const BADGES: readonly Badge[] = [
  "draft",
  "issued",
  "overdue",
  "void",
  "converted",
  "paid",
  "partly_credited",
  "credited",
];
export const BADGE_LABELS: Record<Badge, string> = {
  draft: "Draft",
  issued: "Issued",
  overdue: "Overdue",
  void: "Void",
  converted: "Converted",
  paid: "Paid",
  // 07-T §6
  partly_credited: "Partly credited",
  credited: "Credited",
};
type Pill = {
  tone: PillTone;
  icon: "pencil" | "fileCheck" | "alert" | "xCircle" | "check" | "progress" | "undo";
  outline?: boolean;
};
/**
 * docs/06 §5.5: Draft neutral (pencil), Issued info (file-check), Overdue danger (alert-triangle), Void muted with a struck label (x-circle), Paid
 * success (check-circle). Converted (a proforma money came in against) is success too, with the turning-arrows icon, so it is told from Paid without
 * colour.
 */
export const BADGE_PILLS: Record<Badge, Pill> = {
  draft: { tone: "neutral", icon: "pencil" },
  issued: { tone: "info", icon: "fileCheck" },
  overdue: { tone: "danger", icon: "alert" },
  void: { tone: "muted", icon: "xCircle" },
  converted: { tone: "success", icon: "progress" },
  paid: { tone: "success", icon: "check" },
  // M5.3: a credit note turned part of the invoice back: still owed, so it reads as Partially paid does (docs/06 §5.5: warning, outline); turned all
  // of it back: nothing is owed and nothing was paid, so it is muted, not struck (it is not void). Both carry the turning-back arrow.
  partly_credited: { tone: "warning", icon: "undo", outline: true },
  credited: { tone: "muted", icon: "undo" },
};

/** The badge of a row or a view: a debt still owed past its due date reads Overdue before it reads Partly credited. */
export function badgeOf(d: { status: InvoiceStatus | string; overdue: boolean }): Badge {
  if (d.status === "draft") return "draft";
  if (d.status === "void") return "void";
  if (d.status === "paid") return "paid";
  if (d.status === "credited") return "credited";
  if (d.overdue) return "overdue";
  if (d.status === "partially_credited") return "partly_credited";
  return d.status === "converted" ? "converted" : "issued";
}

// ---- the series preview ------------------------------------------------------------------------------------------------------------------------

/**
 * The number a draft would be given, as the issue dialog shows it: the series with its financial year ("TH/INV/2627/") and the slot the number
 * takes at issue ("…"), and an example ("TH/INV/2627/0001": the first number of the year, to show the form; the real one is taken in the batch).
 */
export function seriesPreview(p: { template: string; fy: string; padding: number }): {
  before: string;
  after: string;
  text: string;
  example: string;
} {
  const withFy = p.template.replace("{FY}", p.fy);
  const at = withFy.indexOf("{N}");
  const before = at < 0 ? withFy : withFy.slice(0, at);
  const after = at < 0 ? "" : withFy.slice(at + 3);
  return {
    before,
    after,
    text: `${before}…${after}`,
    example: `${before}${"1".padStart(Math.max(1, p.padding), "0")}${after}`,
  };
}

// ---- blockers --------------------------------------------------------------------------------------------------------------------------------

/**
 * The blockers a screen lists (sweep finding 15): with no lines at all, "Add at least one line." says it all, so the totals that can't be
 * worked out and the ₹0 total, both caused by it, are left out. The server's list is unchanged.
 */
export function shownBlockers<B extends { code: string }>(blockers: readonly B[]): B[] {
  if (!blockers.some((b) => b.code === "no_lines")) return [...blockers];
  return blockers.filter((b) => b.code !== "computed_errors" && b.code !== "zero_total");
}

/**
 * 07-R §2 "Blockers" and 07-S §3, §8: one line each. `{n}` is the line's position; `{currency}` the client's; `ctx.maxAgeDays` the oldest a rate may be
 * (Settings › Tax). The server sends `unregistered_high_value` WITH the address or State blocker it explains, and both lines are shown (lead, Q4).
 */
export function blockerLine(
  b: InvoiceBlocker,
  currency: string,
  ctx: { maxAgeDays?: number | undefined } = {},
): string {
  const n = b.line ?? 0;
  switch (b.code) {
    case "supplier_legal_name":
      return "Add the company's legal name in Settings › Company.";
    case "supplier_trade_name":
      return "Add the trade name in Settings › Company.";
    case "supplier_address":
      return "Add the company's registered address in Settings › Company.";
    case "supplier_gstin":
      return "Add the company's GSTIN in Settings › Company.";
    case "supplier_state":
      return "Add the company's state in Settings › Company.";
    // T4 (rt2): 07-ZC line 1 (approved 2026-10-31). A note shows the same line (`noteBlockerLine` falls through to here).
    case "signature_missing":
      return "Add the signature in Settings › Company. Credit notes, debit notes and invoices for a payment received always carry it.";
    case "recipient_legal_name":
      return "Add the client's legal name.";
    case "recipient_address":
      return "Add the client's billing address.";
    case "recipient_gstin":
      return "This client is GST-registered: add their GSTIN.";
    case "recipient_state":
      return "Add the client's state.";
    case "no_lines":
      return "Add at least one line.";
    case "line_sac_missing":
      return `Line ${n} needs a 6-digit SAC code.`;
    case "line_description_missing":
      return `Line ${n} needs a description.`;
    // M5.4 (early check finding 4): a line still carries "[Placeholder" text, so it can't go out on a legal invoice (the safety net stays). 07-W §1.
    case "line_text_placeholder":
      return `Line ${n}: a line's wording isn't approved yet.`;
    case "computed_errors":
      return "The totals couldn't be worked out. Check the lines and the discount.";
    case "zero_total":
      // Researched 2026-10-28, s.7(1)(a) CGST (08-C RA-11).
      return "An invoice can't be issued for ₹0 or $0.";
    case "reverse_charge_text":
      return "Set the reverse-charge line in Settings › Tax.";
    case "currency_mismatch":
      return `The invoice currency must be the client's currency (${currency}).`;
    case "type_not_allowed":
      return "This client is outside India, so this needs an export invoice.";
    // 07-S §3
    case "country_missing":
      return "Add the client's country.";
    case "fx_missing":
      return `Enter the exchange rate for ${b.date ? (dayText(b.date) ?? b.date) : UNKNOWN} before issuing a USD invoice.`;
    case "lut_missing":
      return `Save the LUT ARN for FY ${fyLabel(b.fy, UNKNOWN)} in Settings › Tax before issuing an export invoice under LUT. Or issue it with IGST paid.`;
    case "unregistered_high_value":
      return "For an unregistered client and an invoice of ₹50,000 or more, add the client's name, address and state.";
    case "bank_missing":
      return "Add an active bank account in Settings › Bank.";
    case "swift_missing":
      return "Add the SWIFT details of a bank account in Settings › Bank for export invoices.";
    // 07-S §8 (Researched 2026-10-28, Rule 34(2) CGST, 08-C RA-21). `date` is the day the rate was judged against: the invoice's, or for the advance
    // the day the payment was received (M5.2 re-check M1); the sentence names the same day either way.
    case "fx_date_invalid":
      return `Use the rate published on ${dateOr(b.date)}. If none was published that day, use the last one published before it, at most ${ctx.maxAgeDays ?? UNKNOWN} days earlier.`;
    case "fx_same_day_exists":
      return `A rate was published on ${dateOr(b.date)}, so use that day's rate.`;
    case "advance_lut_missing":
      return advanceLutMissing(fyLabel(b.fy, UNKNOWN));
    default:
      // A code this screen has no words for (a newer server): its code, never invented words (a test keeps every core code covered above).
      return b.code;
  }
}

/** A date the server sent, as the admin writes it; "…" when it sent none. */
const dateOr = (iso: string | undefined) => (iso ? (dayText(iso) ?? iso) : UNKNOWN);

/** Where a blocker is fixed: a settings page, the client, a field of one line of this draft (by position), or the lines panel; null when nothing can. */
export type BlockerTarget =
  | { kind: "page"; to: string; place?: string }
  | { kind: "line"; n: number; field: "description" | "sac" }
  | { kind: "lines" }
  /** M5.2: the exchange rate of this draft (the editor opens its dialog). */
  | { kind: "fx" }
  | null;

export function blockerTarget(b: InvoiceBlocker, clientId: string): BlockerTarget {
  const client = `/clients/${encodeURIComponent(clientId)}`;
  switch (b.code) {
    case "supplier_legal_name":
    case "supplier_trade_name":
    case "supplier_address":
    case "supplier_gstin":
    case "supplier_state":
    case "signature_missing":
      return { kind: "page", to: "/settings/company", place: "Settings › Company" };
    case "reverse_charge_text":
      return { kind: "page", to: "/settings/tax", place: "Settings › Tax" };
    case "lut_missing":
    case "advance_lut_missing":
    // rt1 T2 (07-ZD line 6): a debit note on an LUT export needs the LUT of its own FY, saved in the same list.
    case "debit_lut_missing":
      return { kind: "page", to: "/settings/tax#luts", place: "Settings › Tax" };
    case "bank_missing":
    case "swift_missing":
      return { kind: "page", to: "/settings/bank", place: "Settings › Bank" };
    case "fx_missing":
    case "fx_date_invalid":
    case "fx_same_day_exists":
      return { kind: "fx" };
    case "recipient_legal_name":
    case "recipient_address":
    case "recipient_gstin":
    case "recipient_state":
    case "currency_mismatch":
    case "country_missing":
    case "unregistered_high_value":
      return { kind: "page", to: client };
    case "line_sac_missing":
      return b.line ? { kind: "line", n: b.line, field: "sac" } : { kind: "lines" };
    case "line_description_missing":
    case "line_text_placeholder":
      return b.line ? { kind: "line", n: b.line, field: "description" } : { kind: "lines" };
    case "no_lines":
    case "computed_errors":
    case "zero_total":
      return { kind: "lines" };
    default:
      return null;
  }
}

/** A blocker line cut around the place it names, so only "Settings › Company" is the link (the rest stays plain text). */
export function splitAtPlace(line: string, place: string | undefined): [string, string, string] | null {
  if (!place) return null;
  const at = line.indexOf(place);
  return at < 0 ? null : [line.slice(0, at), place, line.slice(at + place.length)];
}

// ---- errors (07-R §5) ------------------------------------------------------------------------------------------------------------------------

export const INV_ERRORS = {
  approval_required: "Only the owner can issue invoices. Send a request instead.",
  issue_directly: "You can issue this invoice yourself.",
  approval_expired:
    "The draft changed after the request, so this request no longer applies. Ask for a new one.",
  type_not_issuable: "This type of invoice can't be issued yet.",
  stale_version: "Someone else changed this since you opened it. Reload to see the latest version.",
  content_changed:
    "The client or settings changed since this draft was saved, so the totals would differ. Open the draft and save it again.",
  issue_blocked: "Fix the items listed before issuing.",
  numbering_changed: "Company, tax, numbering or payment settings changed a moment ago. Try again.",
  settings_changed: "Company, tax, numbering or payment settings changed a moment ago. Try again.",
  client_changed: "The client's details changed a moment ago. Try again.",
  // The existing 07-Q line (PRJ21).
  client_anonymised: "This client's personal details were removed, so nothing new can be added to it.",
  series_full:
    "This invoice series has run out of numbers for the year. Change the numbering format in Settings › Numbering.",
  void_not_allowed:
    "This invoice can't be voided: it has been emailed, paid or corrected. Use a credit note instead.",
  already_void: "This invoice is already void.",
  // OPEN (08-C RA-10).
  return_period_closed:
    "This invoice's GST return period has ended, so it can't be voided. Use a credit note instead.",
  // FX-5 (owner decision 2026-10-30, 08-C RA-10): 07-Z §1, pending the owner.
  viewed_by_client: VOID_VIEWED_COPY.invoice,
  contact_changed: "The contact's details changed a moment ago. Try again.",
  contact_anonymised:
    "This draft's contact has been anonymised. Choose another contact, then save the draft.",
  milestone_has_invoice: "This milestone already has an invoice.",
  milestone_not_ready:
    "Only a milestone that's Ready to bill, or the advance payment of a started project, can be invoiced.",
  // 07-S §7
  export_currency_confirm: "Confirm that this export invoice should be in INR.",
  advance_reference_used: "This payment reference was already used for this proforma.",
  advance_exceeds_balance: "The amount can't be more than the proforma's balance.",
  proforma_not_issued: "Only an issued proforma can be converted.",
  // 07-S §8
  advance_date_invalid: "The date received can't be before the proforma's date or in the future.",
  already_set: "The service completion date is already set and can't be changed.",
  service_date_future: "The service completion date can't be in the future.",
  service_date_not_applicable: "This doesn't apply to this type of invoice.",
  export_mode_not_applicable: "This doesn't apply to this type of invoice.",
  export_declaration_not_applicable: "This doesn't apply to this type of invoice.",
  export_declaration_missing: "The export note in Settings › Terms was removed. Choose again.",
  export_declaration_changed:
    "The export note in Settings › Terms changed since this draft was saved. Save the draft again.",
  export_declaration_tampered:
    "The export note in Settings › Terms doesn't match its saved copy, so the invoice wasn't issued. A developer needs to look at it.",
  invoice_void: "This invoice is void.",
  fx_not_applicable: "An exchange rate is only needed for USD invoices.",
  advance_supply_changed:
    "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment.",
} as const;

/** "This invoice was already issued as {number}." (07-R §5 `already_issued`; the number rides on the 409). */
export const alreadyIssued = (number: string) => `This invoice was already issued as ${number}.`;

/** The sentence for a failed invoice request: 07-R by code, else the proposals' sentences (07-O), else the server's own words. */
export function invErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "already_issued")
      return e.extra.number ? alreadyIssued(e.extra.number) : sentenceOf(e.message);
    // 07-S §9 (Q37): the year that has no LUT rides on the 409 (contract: `details.fy`, "2027-28" or a token).
    if (e.code === "advance_lut_missing")
      return e.extra.fy ? advanceLutMissing(fyLabel(e.extra.fy, UNKNOWN)) : sentenceOf(e.message);
    // 07-S §8: as a 400 the server's own words are 07-S's line, with the day and the limit in it.
    if (e.code === "fx_same_day_exists" || e.code === "fx_date_invalid") return sentenceOf(e.message);
    if (Object.hasOwn(INV_ERRORS, e.code)) return (INV_ERRORS as Record<string, string>)[e.code] as string;
    if (e.code === "step_up_cancelled" || e.code === "invalid_code") return e.message;
  }
  return docErrorText(e);
}

/** The same failure with 07-R's sentence as its message (the confirm dialog shows a request error's message as it is). */
export const invMapped = (e: unknown): unknown =>
  e instanceof RequestError ? new RequestError(e.status, e.code, invErrorText(e), e.requestId) : e;

/** What stops a void, as one sentence (07-R §5): void already, the return period over, or the rest (emailed, paid, corrected). */
export function voidBlockedText(codes: readonly string[], type?: string): string | null {
  if (codes.length === 0) return null;
  if (codes.includes("already_void")) return INV_ERRORS.already_void;
  // M6.1: a payment waiting for the owner's check (07-ZH line 21, approved) says so first: rejecting it is the way on, for an invoice or a proforma.
  if (codes.includes("payment_pending")) return VOID_PAYMENT_PENDING;
  // M6.1 (second early check): a payment put on the invoice, even one withdrawn later (07-ZH line 25, marked until approved).
  if (codes.includes("payment_recorded") && type !== "proforma") return VOID_PAYMENT_RECORDED;
  // A proforma has no credit note and no return period (LD28): what stops its void is a payment recorded against it, or (from M5.4) that it was
  // emailed (07-S §8).
  // FX-5 (owner decision 2026-10-30, 08-C RA-10): a document the client opened in the portal says so, unless a payment, a credit or an issued child
  // is the stronger reason (07-Z §1).
  const viewedOnly =
    codes.includes("viewed_by_client") &&
    !codes.includes("has_payment") &&
    !codes.includes("has_credit") &&
    !codes.includes("has_child_document");
  if (type === "proforma")
    return codes.includes("has_payment") || codes.includes("has_child_document")
      ? INVT_COPY.proformaVoidBlocked
      : viewedOnly
        ? VOID_VIEWED_COPY.proforma
        : "This proforma has been emailed to the client, so it can't be voided.";
  if (codes.includes("return_period_closed")) return INV_ERRORS.return_period_closed;
  if (viewedOnly) return VOID_VIEWED_COPY.invoice;
  return INV_ERRORS.void_not_allowed;
}

/**
 * The void dialog's sentence for a failed void. A view that lands while the dialog is open answers 409 `viewed_by_client` (FX-5): the line is the
 * document's own (07-Z §1), so a proforma never shows the invoice's "Use a credit note instead."
 */
export function voidErrorText(e: unknown, type?: string): string {
  if (e instanceof RequestError && (e.code === "payment_pending" || e.code === "payment_recorded"))
    return voidBlockedText([e.code], type) ?? invErrorText(e);
  if (e instanceof RequestError && e.code === "viewed_by_client")
    return voidBlockedText([e.code], type) ?? invErrorText(e);
  // A proforma refused for a payment or a converted invoice (the server ranks those above a view): its own line, never the invoice's credit note
  // (FX-5 re-check, finding 2).
  if (e instanceof RequestError && e.code === "void_not_allowed" && type === "proforma")
    return INVT_COPY.proformaVoidBlocked;
  return invErrorText(e);
}

/**
 * Any refused void (409: viewed, paid, credited, converted, already void, the period closed) leaves the page behind the dialog out of date, perhaps
 * still offering Void, so it reloads its data when the dialog closes (FX-5 review L2, re-check finding 3). The dialog keeps its line until then.
 */
export const voidRefusalStalesPage = (e: unknown): boolean => e instanceof RequestError && e.status === 409;

/** "First. Rest." → ["First", "Rest."]: an empty state's title (without its full stop) and body, from one 07-R line. */
export function splitSentences(text: string): [string, string] {
  const i = text.indexOf(". ");
  return i < 0 ? [text.replace(/\.$/, ""), ""] : [text.slice(0, i), text.slice(i + 2)];
}

// ---- the list --------------------------------------------------------------------------------------------------------------------------------

/** A number cell: the issued number, or 07-R's "Not issued yet" for a draft. */
export const numberCell = (r: Pick<InvoiceListRow, "number">) => r.number ?? INV_COPY.notIssued;
export const dateCell = (iso: string | null) => dayText(iso);

// ---- the draft editor's state ------------------------------------------------------------------------------------------------------------------

export type InvFields = { contactId: string | null; discKind: DiscountKind; disc: string };
export type InvPart = "fields" | "lines";
export type InvSaveStatus = "idle" | "saving" | "saved" | "error" | "stale" | "frozen";

export type InvEditorState = {
  id: string;
  currency: Currency;
  updatedAt: number;
  fields: InvFields;
  lines: LineDraft[];
  /** The server's latest view (totals, blockers, approval, issue and PDF state); the typed fields above are never replaced by it. */
  view: InvoiceView;
  /** Each line's figures by its uid. */
  figures: Record<string, LineFigures>;
  /** The line uids in the order the server holds the rows. */
  server: string[];
  rev: Record<InvPart, number>;
  savedRev: Record<InvPart, number>;
  saving: boolean;
  status: InvSaveStatus;
  error: string | null;
  showErrors: boolean;
};

const discText = (d: Discount | null, currency: Currency) =>
  !d ? "" : d.kind === "percent" ? bpToPercent(d.value) : moneyInput(d.value, currency);

const figuresOfLine = (l: InvoiceLine): LineFigures => ({
  taxableMinor: l.taxableMinor,
  cgstMinor: l.cgstMinor,
  sgstMinor: l.sgstMinor,
  igstMinor: l.igstMinor,
  lineTotalMinor: l.lineTotalMinor,
});

/** A line of the view as the line editor holds it (the documents editor's `LineDraft`). */
export function lineDraftOf(l: InvoiceLine, currency: Currency): LineDraft {
  return {
    uid: uid("l"),
    id: l.id,
    catalogueItemId: l.catalogueItemId,
    catalogueLine: null,
    catalogueRateMinor: null,
    defaultLine: null,
    code: null,
    description: l.description,
    detail: l.detail ?? "",
    sac: l.sac ?? "",
    gstRate: bpToPercent(l.gstRateBp),
    unit: l.unit,
    qty: milliToQty(l.qtyMilli),
    rate: moneyInput(l.rateMinor, currency),
    discKind: l.discount?.kind ?? "percent",
    disc: discText(l.discount, currency),
  };
}

export function initInvoiceEditor(v: InvoiceView): InvEditorState {
  const lines = v.lines.map((l) => lineDraftOf(l, v.currency));
  const figures: Record<string, LineFigures> = {};
  v.lines.forEach((l, i) => {
    const u = lines[i]?.uid;
    if (u) figures[u] = figuresOfLine(l);
  });
  return {
    id: v.id,
    currency: v.currency,
    updatedAt: v.updatedAt,
    fields: {
      contactId: v.contact?.id ?? null,
      discKind: v.discount?.kind ?? "percent",
      disc: discText(v.discount, v.currency),
    },
    lines,
    view: v,
    figures,
    server: lines.map((l) => l.uid),
    rev: { fields: 0, lines: 0 },
    savedRev: { fields: 0, lines: 0 },
    saving: false,
    status: "idle",
    error: null,
    showErrors: false,
  };
}

export const invDirtyParts = (s: InvEditorState): InvPart[] =>
  (["fields", "lines"] as const).filter((p) => s.rev[p] !== s.savedRev[p]);
export const invIsDirty = (s: InvEditorState) => invDirtyParts(s).length > 0;

/** The document discount's problem as typed (empty: it can be saved). */
export function discountError(f: InvFields, currency: Currency): string | null {
  const d = parseDiscount(f.discKind, f.disc, currency);
  return d.ok ? null : d.error;
}

export type InvSent = { parts: InvPart[]; rev: Record<InvPart, number>; uids: string[] | null };

/**
 * The PATCH for the parts that changed since the last save, or the first problem that stops it. Never a number, a status, a hash, a type or a
 * due date (the API refuses them): only the contact, the document discount and the lines.
 */
export function buildInvoicePatch(
  s: InvEditorState,
  force = false,
):
  | { ok: true; patch: InvoicePatch; sent: InvSent }
  | { ok: false; error: string }
  | { ok: true; patch: null } {
  const parts = invDirtyParts(s);
  // "Save" on a draft whose figures are out of date sends its fields once, unchanged: the server works the draft out again and stores the hash.
  if (parts.length === 0 && !force) return { ok: true, patch: null };
  const patch: InvoicePatch = { expectedUpdatedAt: s.updatedAt };
  const send = parts.length === 0 ? (["fields"] as InvPart[]) : parts;
  let uids: string[] | null = null;
  for (const p of send) {
    if (p === "fields") {
      const d = parseDiscount(s.fields.discKind, s.fields.disc, s.currency);
      if (!d.ok) return { ok: false, error: d.error };
      patch.fields = { contactId: s.fields.contactId, discount: d.value };
    } else {
      for (const l of s.lines) {
        const first = Object.values(lineErrors(l, s.currency) as LineErrors)[0];
        if (first) return { ok: false, error: first };
      }
      patch.lines = s.lines.map((l) => lineIn(l, s.currency));
      uids = s.lines.map((l) => l.uid);
    }
  }
  return { ok: true, patch, sent: { parts: send, rev: { ...s.rev }, uids } };
}

/** A save's answer onto the screen: the new `updatedAt`, the ids of new rows (by position in what was sent) and every figure; typing stays. */
export function applyInvoiceSave(s: InvEditorState, a: InvoiceView, sent: InvSent): InvEditorState {
  const server = sent.uids ?? s.server;
  const ids = new Map<string, string>();
  const figures: Record<string, LineFigures> = {};
  a.lines.forEach((l, i) => {
    const u = server[i];
    if (!u) return;
    ids.set(u, l.id);
    figures[u] = figuresOfLine(l);
  });
  const savedRev = { ...s.savedRev };
  for (const p of sent.parts) savedRev[p] = sent.rev[p];
  const next: InvEditorState = {
    ...s,
    updatedAt: a.updatedAt,
    lines: s.lines.map((l) => (l.id === null && ids.has(l.uid) ? { ...l, id: ids.get(l.uid) as string } : l)),
    view: a,
    figures,
    server,
    savedRev,
    saving: false,
    error: null,
    showErrors: false,
  };
  return { ...next, status: invIsDirty(next) ? "idle" : "saved" };
}

export type InvAction =
  | { type: "fields"; patch: Partial<InvFields> }
  | { type: "line"; uid: string; patch: Partial<LineDraft> }
  | { type: "lines"; lines: LineDraft[] }
  | { type: "saving" }
  | { type: "saved"; answer: InvoiceView; sent: InvSent }
  | { type: "invalid"; error: string }
  | { type: "failed"; status: InvSaveStatus; error: string }
  | { type: "approval"; approval: ApprovalInfo };

const bump = (s: InvEditorState, p: InvPart): InvEditorState => ({
  ...s,
  rev: { ...s.rev, [p]: s.rev[p] + 1 },
  status: s.status === "stale" || s.status === "frozen" ? s.status : "idle",
});

export function invoiceEditor(s: InvEditorState, a: InvAction): InvEditorState {
  switch (a.type) {
    case "fields":
      return bump({ ...s, fields: { ...s.fields, ...a.patch } }, "fields");
    case "line":
      return bump({ ...s, lines: s.lines.map((l) => (l.uid === a.uid ? { ...l, ...a.patch } : l)) }, "lines");
    case "lines":
      return bump({ ...s, lines: a.lines }, "lines");
    case "saving":
      return { ...s, saving: true, status: "saving" };
    case "saved":
      return applyInvoiceSave(s, a.answer, a.sent);
    case "invalid":
      return { ...s, saving: false, status: "error", error: a.error, showErrors: true };
    case "failed":
      return { ...s, saving: false, status: a.status, error: a.error };
    case "approval":
      return { ...s, view: { ...s.view, issue: { ...s.view.issue, approval: a.approval } } };
  }
}

/** What the draft's state line says about an issue request (07-R §3): waiting since the day it was asked; null otherwise. */
export function requestLine(a: ApprovalInfo): string | null {
  return a.state === "pending" && a.requestedAt !== null ? waitingLine(formatIstDay(a.requestedAt)) : null;
}
