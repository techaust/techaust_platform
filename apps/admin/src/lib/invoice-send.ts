// The words and the pure rules of the M5.4 admin screens (ADM-INV-15, ADM-INV-13, ADM-CARE-02, POR-06; Q42 to Q51): emailing an issued document, its
// emails and links, its reminders, why a care draft wasn't issued by itself, and the client's automatic-issue switch.
//
// Copy: 07-U (docs/07-content-appendix/U-m5.4-send-recurring-reminders.md, branch docs/07-u-m5.4), drafted by the lead and PENDING the owner's word-for-word
// approval. Every line that comes only from 07-U is shown with the "[Placeholder] " mark (`U`), as the M5.1 to M5.3 screens mark unapproved lines; when the
// owner approves 07-U, `APPROVED_07U` turns to true and the marks go. A line 07-U doesn't have either is `INV_PLACEHOLDER` on its own, never invented.
// Lines reused from approved copy (07-N/07-Q, the M4.5 send dialog) carry no mark and say where they come from.
//
// The email preview repeats the words of the real templates (packages/email/src/billing.ts, which the admin does not bundle); a test renders the real
// template and compares, so the two can't drift. Money is formatted through core (`moneyText`); nothing here adds up or works out an amount or a date.
import { formatIstDateTime } from "@techaust/core/dates";
import { noteReasonWords } from "@techaust/core/invoice-email";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { dayText, formatIstDay, moneyText } from "./documents.ts";
import { INV_PLACEHOLDER } from "./invoice-types.ts";
import { invErrorText } from "./invoices.ts";
import type { InvoiceType } from "./invoices-api.ts";
import { MAX_RECIPIENTS, OFFER_COPY } from "./offers.ts";

/** Flip to true when the owner approves 07-U: every mark below disappears at once (the email package has the same switch). */
export const APPROVED_07U = false;
/** A 07-U line, marked until the owner approves it. */
export const U = (line: string): string => (APPROVED_07U ? line : `${INV_PLACEHOLDER} ${line}`);

export { MAX_RECIPIENTS };

// ---- the document's word ({document} in 07-U) ----------------------------------------------------------------------------------------------------

/** 07-U §1: what a document is called in a sentence ("invoice", "payment request", "credit note", "debit note"); an export invoice is an invoice. */
export function documentWord(type: InvoiceType | string): string {
  switch (type) {
    case "proforma":
      return "payment request";
    case "credit_note":
      return "credit note";
    case "debit_note":
      return "debit note";
    default:
      return "invoice";
  }
}

/** Whether a document of this type gets payment reminders (core `REMINDER_TYPES`: never a credit note). */
export const hasReminders = (type: InvoiceType | string) =>
  type === "tax_invoice" || type === "export_invoice" || type === "proforma" || type === "debit_note";

// ---- 07-U §4 sending ---------------------------------------------------------------------------------------------------------------------------------

export const SEND_COPY = {
  emailToClient: U("Email to client"),
  emailAgain: U("Email again"),
  dialogTitle: (type: InvoiceType | string, number: string) => U(`Email ${documentWord(type)} ${number}`),
  sendTo: U(`Send to (up to ${MAX_RECIPIENTS})`),
  sendToHint: U("Only contacts with portal access can receive documents."),
  noneWithPortal: U(
    "No contact of this client has portal access. Turn it on for a contact on the client's page, then send.",
  ),
  attach: U("Attach the PDF"),
  attachHint: U("Without it, the email has a link to the document only."),
  send: U("Send"),
  sent: (n: number) => U(n === 1 ? `Sent to ${n} contact.` : `Sent to ${n} contacts.`),
  queued: U("Queued. It will be emailed in a moment."),
  locked: (type: InvoiceType | string) =>
    U(
      `Emailed, so this ${documentWord(type)} can no longer be voided. Corrections are made with a credit note or a debit note.`,
    ),
  emailsHeading: U("Emails"),
  colTo: U("To"),
  colSentBy: U("Sent by"),
  colWhen: U("When"),
  colStatus: U("Status"),
  sentAutomatically: U("Sent automatically"),
  revoke: U("Revoke links"),
  revokeTitle: (number: string) => U(`Revoke every link to ${number}?`),
  revokeBody: (type: InvoiceType | string) =>
    U(
      `The links in the emails sent so far stop working. Contacts can still see the ${documentWord(type)} in the client portal.`,
    ),
  revoked: U("Links revoked."),
  // Approved (07-N/07-Q, the M4.5 send dialog): no mark.
  noPortal: OFFER_COPY.noPortal,
  chooseOne: OFFER_COPY.chooseOne,
  sending: OFFER_COPY.sending,
  contactsTab: OFFER_COPY.contactsTab,
  cancel: "Cancel",
  // The preview's frame: "From" and "Subject" are the M4.5 dialog's.
  from: "From",
  subject: "Subject",
  message: OFFER_COPY.message,
} as const;

/** The email statuses of 07-U §4 by the send row and its email log status (bounced and complained read as failed; skipped as cancelled). */
export type SendState = "queued" | "sent" | "delivered" | "failed" | "cancelled";
export function sendState(s: { cancelledAt: number | null; emailStatus: string | null }): SendState {
  if (s.cancelledAt !== null) return "cancelled";
  switch (s.emailStatus) {
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
    case "bounced":
    case "complained":
      return "failed";
    case "skipped":
      return "cancelled";
    default:
      return "queued";
  }
}
const SEND_STATE_WORDS: Record<SendState, string> = {
  queued: U("Queued"),
  sent: U("Sent"),
  delivered: U("Delivered"),
  failed: U("Failed"),
  cancelled: U("Cancelled"),
};
export const sendStateLabel = (s: SendState) => SEND_STATE_WORDS[s];
/** Icon and text, never colour alone (docs/06 §5.5). */
export function sendStateLook(s: SendState): {
  tone: PillTone;
  icon: "clock" | "send" | "check" | "ban";
} {
  switch (s) {
    case "queued":
      return { tone: "neutral", icon: "clock" };
    case "sent":
      return { tone: "info", icon: "send" };
    case "delivered":
      return { tone: "success", icon: "check" };
    case "failed":
      return { tone: "danger", icon: "ban" };
    case "cancelled":
      return { tone: "muted", icon: "ban" };
  }
}

/** "25 Oct 2026, 11:42 IST": when an email was made. */
export const sendWhen = (ms: number) => formatIstDateTime(ms);

// ---- 07-U §5 reminders -----------------------------------------------------------------------------------------------------------------------------

export const REMINDER_COPY = {
  heading: U("Reminders"),
  notStarted: (type: InvoiceType | string) =>
    U(`Reminders start when the ${documentWord(type)} is first emailed.`),
  pause: U("Pause reminders"),
  resume: U("Resume reminders"),
  paused: U("Reminders are paused. Nothing is sent until you resume them."),
  window: U("Reminders go out between 09:00 and 19:00 IST."),
} as const;

/** 07-U §5 schedule row: "3 days before the due date", "On the due date", "7 days after the due date" (the offset is signed: −3 is before). */
export function reminderDayLabel(offset: number): string {
  if (offset === 0) return U("On the due date");
  const n = Math.abs(offset);
  return U(`${n} ${n === 1 ? "day" : "days"} ${offset < 0 ? "before" : "after"} the due date`);
}

/** 07-U §5 skip reasons; a reason it doesn't name (superseded, policy off, anonymised…) is the plain placeholder. */
const SKIP_WORDS: Record<string, string> = {
  paid: "paid",
  credited: "credited in full",
  void: "void",
  paused: "paused",
  no_recipient: "no contact with portal access",
};

export type ReminderRowView = {
  offset: number;
  dueAt: number;
  sentAt: number | null;
  skippedReason: string | null;
};
export type ReminderState = "sent" | "due" | "paused" | "skipped";
export const reminderState = (r: ReminderRowView): ReminderState =>
  r.sentAt !== null ? "sent" : r.skippedReason === "paused" ? "paused" : r.skippedReason ? "skipped" : "due";

/** 07-U §5 states: "Sent {date}", "Due {date}", "Skipped: {reason}". */
export function reminderStateText(r: ReminderRowView): string {
  if (r.sentAt !== null) return U(`Sent ${formatIstDay(r.sentAt)}`);
  if (r.skippedReason) {
    const why = SKIP_WORDS[r.skippedReason];
    return why ? U(`Skipped: ${why}`) : `${U("Skipped:")} ${INV_PLACEHOLDER}`;
  }
  return U(`Due ${formatIstDay(r.dueAt)}`);
}

/** Pause is offered while a reminder is still waiting; resume while one is paused and still in the future (the server resumes only those). */
export function reminderActions(rows: readonly ReminderRowView[], now: number) {
  return {
    canPause: rows.some((r) => r.sentAt === null && r.skippedReason === null),
    canResume: rows.some((r) => r.sentAt === null && r.skippedReason === "paused" && r.dueAt > now),
  };
}

// ---- 07-U §5 errors --------------------------------------------------------------------------------------------------------------------------------

export function sendErrors(type: InvoiceType | string): Record<string, string> {
  const doc = documentWord(type);
  return {
    reminders_not_started: U(`Reminders haven't started: email the ${doc} first.`),
    not_issued: U("Only an issued document can be emailed."),
    invoice_void: U(`This ${doc} is void, so it can't be emailed.`),
    owner_only: U("Only an owner can do this."),
    recipient_invalid: U(
      "One of the contacts can't receive documents. Check that they still have portal access.",
    ),
    send_refused: U("This can't be sent right now. Reload the page and try again."),
  };
}

/** The sentence for a failed send, revoke or reminder request: 07-U by code, else the invoices' own (07-R), else the server's words. */
export function sendErrorText(e: unknown, type: InvoiceType | string): string {
  if (e instanceof RequestError) {
    const known = sendErrors(type)[e.code];
    if (known) return known;
  }
  return invErrorText(e);
}

/** The same failure with that sentence as its message (the confirm dialog shows a request error's message as it is). */
export const sendMapped = (e: unknown, type: InvoiceType | string): unknown =>
  e instanceof RequestError ? new RequestError(e.status, e.code, sendErrorText(e, type), e.requestId) : e;

// ---- the email as it will go (07 §8 subjects; 07-U bodies) -----------------------------------------------------------------------------------------

/** The facts the preview fills in, already formatted as the jobs Worker formats them. */
export type PreviewFacts = {
  type: InvoiceType | string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: string;
  parentNumber: string;
  /** A note's reason in the words the email prints (core `noteReasonWords`, as the jobs Worker fills `reason`); "" when there is none. */
  reason: string;
  /** A credit note: the invoice's balance after the note, as the email prints it; "" otherwise. */
  parentBalance: string;
};

export function previewFacts(v: {
  type: InvoiceType | string;
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalMinor: number | null;
  currency: Currency;
  parentNumber?: string | null | undefined;
  reason?: { code: string; text: string } | null | undefined;
  parentBalanceMinor?: number | null | undefined;
}): PreviewFacts {
  return {
    type: v.type,
    number: v.number ?? "…",
    issueDate: dayText(v.issueDate) ?? "…",
    dueDate: dayText(v.dueDate) ?? "…",
    total: v.totalMinor === null ? "…" : moneyText(v.totalMinor, v.currency),
    parentNumber: v.parentNumber ?? "…",
    reason: v.reason ? noteReasonWords(v.reason.code, v.reason.text) : "",
    parentBalance:
      v.parentBalanceMinor === null || v.parentBalanceMinor === undefined
        ? ""
        : moneyText(v.parentBalanceMinor, v.currency),
  };
}

/** The subject (07 §8 for the invoice and the payment request, 07 §8 and 07-T §2 for the notes: approved, no mark). */
export function previewSubject(f: PreviewFacts): string {
  switch (f.type) {
    case "proforma":
      return `Payment request ${f.number}: ${f.total}`;
    case "credit_note":
      return `Credit note ${f.number} for invoice ${f.parentNumber}`;
    case "debit_note":
      return `Debit note ${f.number} for invoice ${f.parentNumber}`;
    default:
      return `Invoice ${f.number} from TecHaust Technologies: ${f.total} due ${f.dueDate}`;
  }
}

/** 07-U §1 "Reason: {reason}." (the template's `reasonSentence`: a reason ending in its own full stop is not doubled); nothing when there is no reason. */
function reasonLine(reason: string): string[] {
  const r = reason.trim();
  if (!r) return [];
  return [/[.!?]$/.test(r) ? `Reason: ${r}` : `Reason: ${r}.`];
}

/** The body's paragraphs (07-U §1, marked), the button and the closing sentence, for one first name. */
export function previewBody(
  f: PreviewFacts,
  firstName: string,
  attached: boolean,
): { paragraphs: string[]; button: string; closing: string } {
  const hi = firstName.trim() ? `Hi ${firstName.trim()}, ` : "Hi, ";
  const word = documentWord(f.type);
  let paragraphs: string[];
  switch (f.type) {
    case "proforma":
      paragraphs = [
        `${hi}please find payment request ${f.number} for ${f.total}, valid until ${f.dueDate}. You can pay by bank transfer; the bank details are on the payment request. A tax invoice will be issued when payment is received.`,
      ];
      break;
    case "credit_note":
      paragraphs = [
        `${hi}we've issued credit note ${f.number} for ${f.total} against invoice ${f.parentNumber}.`,
        ...reasonLine(f.reason),
        ...(f.parentBalance ? [`The amount due on the invoice is now ${f.parentBalance}.`] : []),
      ];
      break;
    case "debit_note":
      paragraphs = [
        `${hi}we've issued debit note ${f.number} for ${f.total} against invoice ${f.parentNumber}, because the invoice amount needed correcting upwards.`,
        ...reasonLine(f.reason),
        `Please pay ${f.total} by ${f.dueDate}.`,
      ];
      break;
    default:
      paragraphs = [
        `${hi}please find invoice ${f.number} for ${f.total}, issued on ${f.issueDate} and due on ${f.dueDate}. You can pay by bank transfer; the bank details are on the invoice.`,
      ];
  }
  const buttons: Record<string, string> = {
    invoice: "View invoice",
    "payment request": "View payment request",
    "credit note": "View credit note",
    "debit note": "View debit note",
  };
  return {
    paragraphs: paragraphs.map(U),
    button: U(buttons[word] ?? "View invoice"),
    closing: U(
      attached
        ? `The ${word} is attached as a PDF, and it's also in your client portal.`
        : "You can view and download it with the button below or in your client portal.",
    ),
  };
}

/** The sender as the email shows it (SENDERS.billing in packages/email). */
export const BILLING_FROM = "TecHaust Technologies <billing@techaust.com>";

// ---- 07-U §6 recurring care invoices -----------------------------------------------------------------------------------------------------------------

const AUTO_REASON_WORDS: Record<string, string> = {
  toggle_off: "automatic issuing is off for this client",
  toggle_not_owner: "automatic issuing wasn't turned on by an owner",
  terms_not_owner: "the plan's current price wasn't set by an owner",
  usd_needs_fx: "a US dollar invoice needs the exchange rate entered",
  overage_present: "it includes extra hours, which you check first",
  blockers: "the invoice has a missing field (see the checklist)",
  copy_placeholder: "a line's wording isn't approved yet",
  export_inr_confirm: "an export invoice in rupees needs your confirmation",
};

/** "a, b and c" (the 07 house style: "and", never "&"). */
const joinAnd = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** 07-U §6: "Drafted, not issued automatically, because {reasons}." (null when there is no reason to give). */
export function draftedBecause(reasons: readonly string[]): string | null {
  if (reasons.length === 0) return null;
  const words = reasons.map((r) => AUTO_REASON_WORDS[r] ?? INV_PLACEHOLDER);
  return U(`Drafted, not issued automatically, because ${joinAnd(words)}.`);
}

/** The billed period as 07-U §6's lines write it: "{period start} to {period end}". */
export const periodText = (start: string, end: string) =>
  `${dayText(start) ?? start} to ${dayText(end) ?? end}`;

export const CARE_COPY = {
  toggle: U("Issue care invoices automatically"),
  toggleHint: U(
    "On the billing day, the invoice is issued and emailed to the client's billing contacts with portal access. Only an owner can turn this on; anyone can turn it off.",
  ),
  /** 07-U §6 "On, turned on by {name} on {date}"; the date part only when the audit log still says when (`careAutoIssueBy.at`), never guessed. */
  onBy: (name: string, at?: number | null) =>
    U(
      typeof at === "number" ? `On, turned on by ${name} on ${formatIstDay(at)}` : `On, turned on by ${name}`,
    ),
  ownerOnly: U("Only an owner can turn on automatic issuing."),
  /** The brief: "not in effect" when the owner who turned it on is no longer active. 07-U has no line yet. */
  notInEffect: `${INV_PLACEHOLDER} Not in effect`,
  /** The care plan the invoice bills (the admin's own section name). */
  carePlan: "Care plan",
} as const;

// ---- the care plan's billing section (GET /care-plans/:id `billing`; finance roles only) -------------------------------------------------------------

/** `GET /care-plans/:id` → `billing` (apps/admin/worker/care-authority.ts `careBillingView`). Absent for a role without finance access (Sales). */
export type CarePlanBilling = {
  /** The START of the last period billed (ISO), or null when the plan was never billed. */
  lastBilledPeriod: string | null;
  /** The day the job next bills (ISO); null for a cancelled plan. */
  nextBillingDay: string | null;
  /** The record of the last billed period; null when there is none, or it was deleted. */
  draft: { id: string; number: string | null; status: string } | null;
  /** Only for a draft not yet issued. `blockersChecked` is always false: the draft's own checklist decides whether it can be issued. */
  auto: { eligible: boolean; reasons: string[]; blockersChecked: false } | null;
};

/**
 * The section's words. 07-U has no line for the plan page's billing section, so every one is a marked placeholder (the plain `INV_PLACEHOLDER` mark, not
 * the 07-U switch: approving 07-U must not unmark them). Only the reasons line is 07-U §6's (`draftedBecause`).
 */
export const PLAN_BILLING_COPY = {
  heading: `${INV_PLACEHOLDER} Billing`,
  lastBilled: `${INV_PLACEHOLDER} Last billed period`,
  notBilled: `${INV_PLACEHOLDER} Not billed yet`,
  noRecord: `${INV_PLACEHOLDER} No invoice on record for this period`,
  nextDay: `${INV_PLACEHOLDER} Next billing day`,
  noNextDay: `${INV_PLACEHOLDER} None, the plan is cancelled`,
  /** The Owner's choices allow it; this never says the draft is ready (`blockersChecked` is false). */
  autoAllowed: `${INV_PLACEHOLDER} The owner's choices allow this draft to be issued automatically.`,
  /** Where the missing fields are: the draft's own page (its checklist). */
  checkDraft: `${INV_PLACEHOLDER} Any field still missing is listed on the draft's page.`,
  openDraft: `${INV_PLACEHOLDER} Open the draft`,
} as const;

/** The auto-issue lines of the section: 07-U §6's reasons (not eligible) or the allowed line, then always the pointer to the draft's own checklist. */
export function planAutoLines(
  auto: CarePlanBilling["auto"],
): { tone: "pending" | "info"; text: string; pointer: string } | null {
  if (!auto) return null;
  const because = auto.eligible ? null : draftedBecause(auto.reasons);
  return {
    tone: because ? "pending" : "info",
    text: because ?? PLAN_BILLING_COPY.autoAllowed,
    pointer: PLAN_BILLING_COPY.checkDraft,
  };
}
