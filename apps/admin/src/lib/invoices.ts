// The words and the pure rules of the M5.1 invoice screens (ADM-INV-01..04, -07, ADM-APR-01/02, ADM-PRJ-02): 07-R word for word, the badges,
// the blocker lines with where each is fixed, the error sentences by API code, the series preview, and the draft editor's state with its two pure
// autosave steps (`buildInvoicePatch`, `applyInvoiceSave`). Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-R (docs/07-content-appendix/R-m5.1-invoice-screens.md), PENDING the owner's word-for-word approval. A line 07-R does not have is
// shown as "[Placeholder]" (`INV_PLACEHOLDER`), never invented. The type names are core's series labels (`@techaust/core/numbering`).
//
// Money: amounts are the server's minor units, formatted through core (`moneyText`); typed amounts are parsed through core. Nothing here adds,
// multiplies or rounds money. The due date and the number are the server's; the screen never works them out.
import { SERIES, type Series } from "@techaust/core/numbering";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { milliToQty } from "./catalogue.ts";
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
import type {
  InvoiceBlocker,
  InvoiceLine,
  InvoiceListRow,
  InvoicePatch,
  InvoiceStatus,
  InvoiceType,
  InvoiceView,
} from "./invoices-api.ts";
import { bpToPercent, moneyInput } from "./settings-form.ts";

export { moneyText };

/** A line 07-R does not have yet: shown as it is, so nobody mistakes it for approved copy. */
export const INV_PLACEHOLDER = "[Placeholder]";

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
  voidBody:
    "Voiding cancels this invoice. It keeps its number, which is reported as cancelled in your GST return. You can only void an invoice in the month it was issued, before it has been emailed, paid or corrected by a credit or debit note; after that, use a credit note.",
  voidReason: "Reason (required, kept with the invoice)",
  voidConfirm: "Void invoice",
  milestoneBack: "The milestone is back to Ready to bill.",
  createInvoice: "Create invoice",
} as const;

export const draftTitle = (client: string) => `Draft invoice for ${client}`;
export const dueNote = (date: string, days: number) =>
  `Due ${date}: ${days} days after the issue date (the client's terms, or Net 7).`;
export const fromMilestone = (milestone: string, project: string) =>
  `Created from the milestone "${milestone}" of ${project}. The total matches the milestone amount, GST included.`;
export const issueBody = (seriesPreview: string, example: string, issueDate: string) =>
  `This invoice will get the next number in the series (${seriesPreview}, for example ${example}) and the date ${issueDate}. Once issued it can't be edited or deleted. Corrections are made with a credit note or a debit note.`;
export const issuedToast = (number: string) => `Invoice ${number} issued.`;
export const waitingLine = (date: string) => `Waiting for the owner to issue it (requested ${date}).`;
export const requestRow = (requester: string, client: string, total: string) =>
  `${requester} asked to issue a draft invoice for ${client}: ${total}.`;
export const rejectReasonLabel = (requester: string) => `Reason (optional, shown to ${requester})`;
export const frozenBanner = (date: string, name: string) =>
  `Issued ${date} by ${name}. This invoice is locked: corrections are made with a credit note or a debit note.`;
export const voidTitle = (number: string) => `Void invoice ${number}`;
export const voidedLine = (date: string, name: string, reason: string) =>
  `Voided ${date} by ${name}: ${reason}`;
/** 07-R: "This milestone already has invoice {number or "a draft"}." */
export const milestoneHasInvoice = (number: string | null) =>
  `This milestone already has invoice ${number ?? "a draft"}.`;
/** 07-R (docs/13 2026-10-26): "Converted to invoice {number or "a draft"}." */
export const convertedToInvoice = (number: string | null) => `Converted to invoice ${number ?? "a draft"}.`;

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

/** The four badges of 07-R; Overdue is worked out by the server (a balance past its due date), never stored. */
export type Badge = "draft" | "issued" | "overdue" | "void";
export const BADGES: readonly Badge[] = ["draft", "issued", "overdue", "void"];
export const BADGE_LABELS: Record<Badge, string> = {
  draft: "Draft",
  issued: "Issued",
  overdue: "Overdue",
  void: "Void",
};
type Pill = { tone: PillTone; icon: "pencil" | "fileCheck" | "alert" | "xCircle" };
/** docs/06 §5.5: Draft neutral (pencil), Issued info (file-check), Overdue danger (alert-triangle), Void muted with a struck label (x-circle). */
export const BADGE_PILLS: Record<Badge, Pill> = {
  draft: { tone: "neutral", icon: "pencil" },
  issued: { tone: "info", icon: "fileCheck" },
  overdue: { tone: "danger", icon: "alert" },
  void: { tone: "muted", icon: "xCircle" },
};

/** The badge of a row or a view. The ledger states of M5.3 and M6 (paid, credited) read as Issued until their badges exist. */
export function badgeOf(d: { status: InvoiceStatus | string; overdue: boolean }): Badge {
  if (d.status === "draft") return "draft";
  if (d.status === "void") return "void";
  return d.overdue ? "overdue" : "issued";
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

/** 07-R §2 "Blockers": one line each. `{n}` is the line's position; `{currency}` the client's. */
export function blockerLine(b: InvoiceBlocker, currency: string): string {
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
    case "computed_errors":
      return "The totals couldn't be worked out. Check the lines and the discount.";
    case "zero_total":
      return "An invoice can't be issued for ₹0 or $0.";
    case "reverse_charge_text":
      return "Set the reverse-charge line in Settings › Tax.";
    case "currency_mismatch":
      return `The invoice currency must be the client's currency (${currency}).`;
    case "type_not_allowed":
      return "This client is outside India, so this needs an export invoice. Export invoices arrive in the next update.";
    default:
      return INV_PLACEHOLDER;
  }
}

/** Where a blocker is fixed: a settings page, the client, a line of this draft (by position), or the lines panel; null when nothing can. */
export type BlockerTarget =
  | { kind: "page"; to: string; place?: string }
  | { kind: "line"; n: number }
  | { kind: "lines" }
  | null;

export function blockerTarget(b: InvoiceBlocker, clientId: string): BlockerTarget {
  const client = `/clients/${encodeURIComponent(clientId)}`;
  switch (b.code) {
    case "supplier_legal_name":
    case "supplier_trade_name":
    case "supplier_address":
    case "supplier_gstin":
    case "supplier_state":
      return { kind: "page", to: "/settings/company", place: "Settings › Company" };
    case "reverse_charge_text":
      return { kind: "page", to: "/settings/tax", place: "Settings › Tax" };
    case "recipient_legal_name":
    case "recipient_address":
    case "recipient_gstin":
    case "recipient_state":
    case "currency_mismatch":
      return { kind: "page", to: client };
    case "line_sac_missing":
    case "line_description_missing":
      return b.line ? { kind: "line", n: b.line } : { kind: "lines" };
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
  return_period_closed:
    "This invoice's GST return period has ended, so it can't be voided. Use a credit note instead.",
  contact_changed: "The contact's details changed a moment ago. Try again.",
  milestone_has_invoice: "This milestone already has an invoice.",
  milestone_not_ready: "Only a milestone that's Ready to bill can be invoiced.",
} as const;

/** "This invoice was already issued as {number}." (07-R §5 `already_issued`; the number rides on the 409). */
export const alreadyIssued = (number: string) => `This invoice was already issued as ${number}.`;

/** The sentence for a failed invoice request: 07-R by code, else the proposals' sentences (07-O), else the server's own words. */
export function invErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "already_issued")
      return e.extra.number ? alreadyIssued(e.extra.number) : sentenceOf(e.message);
    if (Object.hasOwn(INV_ERRORS, e.code)) return (INV_ERRORS as Record<string, string>)[e.code] as string;
    if (e.code === "step_up_cancelled" || e.code === "invalid_code") return e.message;
  }
  return docErrorText(e);
}

/** The same failure with 07-R's sentence as its message (the confirm dialog shows a request error's message as it is). */
export const invMapped = (e: unknown): unknown =>
  e instanceof RequestError ? new RequestError(e.status, e.code, invErrorText(e), e.requestId) : e;

/** What stops a void, as one sentence (07-R §5): void already, the return period over, or the rest (emailed, paid, corrected). */
export function voidBlockedText(codes: readonly string[]): string | null {
  if (codes.length === 0) return null;
  if (codes.includes("already_void")) return INV_ERRORS.already_void;
  if (codes.includes("return_period_closed")) return INV_ERRORS.return_period_closed;
  return INV_ERRORS.void_not_allowed;
}

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
