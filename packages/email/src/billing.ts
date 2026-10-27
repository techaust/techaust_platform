// M5.4: the client emails of an issued document (invoice, proforma, credit note, debit note), the payment reminder, and the three staff alerts
// (ADM-INV-15, ADM-INV-13, ADM-INV-19, ADM-INV-10, ADM-INV-18, POR-06), in the brand layout of every other email (the subject as the heading, the
// sentences, the 48 px verdigris button with the plain address under it, light and dark), each with its plain-text twin saying the same words.
//
// Words: docs/07-content-appendix/U-m5.4-send-recurring-reminders.md (07-U), drafted by the lead and PENDING the owner's word-for-word approval. So every
// line that comes only from 07-U carries the "[Placeholder] " mark (`U`), in the subject, the HTML and the text alike, exactly as the M5.1 to M5.3 screens
// mark unapproved lines; when the owner approves 07-U, `APPROVED_07U` turns to true and nothing else changes. The LUT email's body is 07-S §5 (its words
// are not 07-U's, so they carry no mark); the "running year has no letter" form is 07-U §8's. Tax and legal sentences: VERIFY WITH CA/LEGAL.
//
// The data is exactly `INVOICE_EMAIL_DATA` (@techaust/core/invoices): every value a string, money and dates already formatted by the jobs Worker
// (nothing is added up or worked out here), flags "1" or "". Two 07-U sentences need data the queue does not carry, so they are left out rather than
// guessed (the designer's report names them): the credit and debit notes' "Reason: {reason}." and the credit note's "The amount due on the invoice is now
// {balance}." (`balance` is empty on a credit note).
//
// Presentation only, never new words: the document's number and the amounts are bold in HTML (kept on one line); every variable is escaped.
import { escapeHtml, headerValue } from "./headers.ts";
import { type LayoutOptions, type Para, para, type Rendered, securityEmail } from "./templates.ts";

/** Flip to true when the owner approves 07-U word for word: every mark below disappears at once. */
export const APPROVED_07U = false;
/** The mark on an unapproved 07-U line (the screens' `INV_PLACEHOLDER`, followed by the draft's words). */
export const PLACEHOLDER_MARK = "[Placeholder] ";
/** A 07-U line, marked until the owner approves it. */
const U = (line: string): string => (APPROVED_07U ? line : `${PLACEHOLDER_MARK}${line}`);

/** One piece of a sentence: plain text, or a value set in bold (a number or an amount) in HTML. */
type Piece = string | { b: string };
const B = (v: string): Piece => ({ b: v });

const esc = escapeHtml;

/** A 07-U sentence from its pieces: the mark in front (until approved), the values bold in HTML; the text twin says the same words. */
function line(pieces: Piece[], mark = true): Para {
  const text = pieces.map((p) => (typeof p === "string" ? p : p.b)).join("");
  const html = pieces
    .map((p) =>
      typeof p === "string"
        ? esc(p)
        : `<strong style="font-weight:600;white-space:nowrap;">${esc(p.b)}</strong>`,
    )
    .join("");
  if (!mark || APPROVED_07U) return { text, html };
  return { text: `${PLACEHOLDER_MARK}${text}`, html: `${esc(PLACEHOLDER_MARK)}${html}` };
}

// ---- 1. Document emails (client-facing, from billing@) ------------------------------------------------------------------------------------------

export type DocumentEmailData = {
  first_name: string;
  number: string;
  issue_date: string;
  due_date: string;
  total: string;
  balance: string;
  url: string;
  attached: string;
  parent_number: string;
  sender_name: string;
};

/** What a document is called in a sentence, and its button (07-U §1). */
export const DOCUMENT_WORDS = {
  invoice: { word: "invoice", button: "View invoice" },
  proforma: { word: "payment request", button: "View payment request" },
  credit_note: { word: "credit note", button: "View credit note" },
  debit_note: { word: "debit note", button: "View debit note" },
} as const;
export type DocumentKind = keyof typeof DOCUMENT_WORDS;

/** 07-U §1: the closing sentence, attached or link only. */
export function closingSentence(kind: DocumentKind, attached: boolean): string {
  return attached
    ? `The ${DOCUMENT_WORDS[kind].word} is attached as a PDF, and it's also in your client portal.`
    : "You can view and download it with the button below or in your client portal.";
}

/** "Hi {first name}, " (a missing first name reads "Hi, ", as the M5.1 emails do). */
const hi = (first: string) => (first.trim() ? `Hi ${first.trim()}, ` : "Hi, ");
const isAttached = (v: string) => v === "1";

/** The subject and opening sentences of each document email (07-U §1; 07-T §2's subjects for the notes). */
function documentBody(kind: DocumentKind, d: DocumentEmailData): { subject: string; body: Piece[][] } {
  const h = hi(d.first_name);
  switch (kind) {
    case "invoice":
      return {
        subject: `Invoice ${d.number} from TecHaust Technologies: ${d.total} due ${d.due_date}`,
        body: [
          [
            `${h}please find invoice `,
            B(d.number),
            " for ",
            B(d.total),
            `, issued on ${d.issue_date} and due on ${d.due_date}. You can pay by bank transfer; the bank details are on the invoice.`,
          ],
        ],
      };
    case "proforma":
      return {
        subject: `Payment request ${d.number}: ${d.total}`,
        body: [
          [
            `${h}please find payment request `,
            B(d.number),
            " for ",
            B(d.total),
            `, valid until ${d.due_date}. You can pay by bank transfer; the bank details are on the payment request. A tax invoice will be issued when payment is received.`,
          ],
        ],
      };
    case "credit_note":
      // 07-T §2's subject. "Reason: {reason}." and "The amount due on the invoice is now {balance}." need data the queue does not carry (left out).
      return {
        subject: `Credit note ${d.number} for invoice ${d.parent_number}`,
        body: [
          [
            `${h}we've issued credit note `,
            B(d.number),
            " for ",
            B(d.total),
            " against invoice ",
            B(d.parent_number),
            ".",
          ],
          ...(d.balance.trim() ? [["The amount due on the invoice is now ", B(d.balance), "."]] : []),
        ],
      };
    case "debit_note":
      return {
        subject: `Debit note ${d.number} for invoice ${d.parent_number}`,
        body: [
          [
            `${h}we've issued debit note `,
            B(d.number),
            " for ",
            B(d.total),
            " against invoice ",
            B(d.parent_number),
            ", because the invoice amount needed correcting upwards.",
          ],
          ["Please pay ", B(d.total), ` by ${d.due_date}.`],
        ],
      };
  }
}

/**
 * An issued document emailed to one contact (from billing@): the 07-U §1 body ending with its closing sentence (attached or link only; the link-only one
 * points at "the button below"), then the button.
 */
export function documentSent(kind: DocumentKind, d: DocumentEmailData, opts: LayoutOptions): Rendered {
  const { subject, body } = documentBody(kind, d);
  // Every subject here is approved already (07 §8 for the invoice and the payment request; 07 §8 and 07-T §2 for the notes): no mark.
  return securityEmail(headerValue(subject), opts, {
    before: [...body.map((pieces) => line(pieces)), line([closingSentence(kind, isAttached(d.attached))])],
    action: { label: U(DOCUMENT_WORDS[kind].button), url: d.url },
  });
}

// ---- 2. Payment reminders (client-facing, from billing@, link only) -------------------------------------------------------------------------------

export type ReminderEmailData = DocumentEmailData & {
  /** The distance from the due date in days, never negative ("3"). */
  offset_days: string;
  /** "before", "on" or "after" the due date. */
  when: string;
  /** "invoice", "proforma" or "debit_note". */
  kind: string;
};

/** The reminder's document: an unknown kind reads as an invoice. */
export const reminderKindOf = (kind: string): "invoice" | "proforma" | "debit_note" =>
  kind === "proforma" || kind === "debit_note" ? kind : "invoice";

/** Which row of 07-U §2's table a reminder uses. The table's days are the defaults (−3, 0, +3, +7, +14); a client's own days take the row of the nearest default at or below them. */
export type ReminderStage = "before" | "on" | "after" | "second" | "final";
export function reminderStage(when: string, offsetDays: number): ReminderStage {
  if (when === "before") return "before";
  if (when !== "after" || offsetDays <= 0) return "on";
  if (offsetDays >= 14) return "final";
  if (offsetDays >= 7) return "second";
  return "after";
}

/** "3 days" (and "1 day"): the number of days, as the table writes it. */
const days = (n: string) => (n === "1" ? "1 day" : `${n} days`);
/** "Invoice" at the start of a subject. */
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** 07-U §2: the subject and the body of a reminder, by stage and document (the payment-request and debit-note variants). */
function reminderBody(d: ReminderEmailData): { subject: string; body: Piece[][] } {
  const kind = reminderKindOf(d.kind);
  const word = DOCUMENT_WORDS[kind].word;
  const n = Number.parseInt(d.offset_days, 10);
  const stage = reminderStage(d.when, Number.isFinite(n) ? n : 0);
  const h = hi(d.first_name);
  // "was due on {due date}"; a payment request "was requested by {due date}" (the three bodies after the due date)
  const wasDue = kind === "proforma" ? `was requested by ${d.due_date}` : `was due on ${d.due_date}`;
  const doc = (rest: Piece[]): Piece[] => [`${h}${word} `, B(d.number), ...rest];
  switch (stage) {
    case "before":
      return {
        subject: `${capital(word)} ${d.number} is due on ${d.due_date}`,
        body: [
          [
            `${h}a friendly reminder that ${word} `,
            B(d.number),
            " (",
            B(d.balance),
            `) is due in ${days(d.offset_days)}, on ${d.due_date}.`,
          ],
        ],
      };
    case "on":
      return {
        subject: `${capital(word)} ${d.number} is due today`,
        body: [[`${h}a friendly reminder that ${word} `, B(d.number), " (", B(d.balance), ") is due today."]],
      };
    case "after":
      return {
        subject: `${capital(word)} ${d.number} is now overdue`,
        body: [
          doc([
            ` ${wasDue} and shows `,
            B(d.balance),
            " outstanding. If there's a problem with the ",
            `${word}, reply to this email and we'll sort it out.`,
          ]),
        ],
      };
    case "second":
      return {
        subject: `Second reminder: ${word} ${d.number}`,
        body: [
          doc([
            ` ${wasDue} and `,
            B(d.balance),
            " is still outstanding. Could you let us know when we can expect payment? If it would help to talk it through, reply and we'll arrange a call.",
          ]),
        ],
      };
    case "final":
      return {
        subject: `Action needed: ${word} ${d.number} is ${days(d.offset_days)} overdue`,
        body: [
          doc([
            ` ${wasDue} and `,
            B(d.balance),
            " is still outstanding. Please arrange payment, or reply to this email so we can agree a date. You can also contact Rupak Sarkar, the owner, directly at contact@techaust.com.",
          ]),
        ],
      };
  }
}

/** A payment reminder (from billing@): never with the PDF, so it closes with the link-only sentence, then "If you've already paid…". */
export function reminderSent(d: ReminderEmailData, opts: LayoutOptions): Rendered {
  const kind = reminderKindOf(d.kind);
  const { subject, body } = reminderBody(d);
  // An invoice's five subjects are 07 §8's (approved); the payment-request and debit-note variants are 07-U's only, so they carry the mark.
  return securityEmail(headerValue(kind === "invoice" ? subject : U(subject)), opts, {
    // 07-U §2: the body ends with the link-only closing sentence ("…with the button below…"); then the button; then 07 §8's "already paid" line.
    before: [...body.map((pieces) => line(pieces)), line([closingSentence(kind, false)])],
    action: { label: U(DOCUMENT_WORDS[kind].button), url: d.url },
    // 07 §8 (approved): no mark.
    after: [line(["If you've already paid, thank you, and please ignore this."], false)],
    actionFirst: true,
  });
}

// ---- 3. Staff alerts (to every owner, from no-reply@) -----------------------------------------------------------------------------------------------

export type UnbilledAlertData = {
  owner_first_name: string;
  client_name: string;
  admin_url: string;
  milestone_title: string;
  delivered_date: string;
  days_since: string;
};
export type ProformaDueAlertData = UnbilledAlertData & { proforma_number: string; balance: string };
export type LutReminderData = {
  owner_first_name: string;
  fy_label: string;
  /** `next_fy_due` (from 1 March, 07-S §5) or `current_missing` (the running year has none, 07-U §8). */
  state: string;
  admin_url: string;
};

const OPEN_IN_ADMIN = "Open in admin";

/** 07-U §8: work delivered and not invoiced yet. */
export function alertUnbilled(d: UnbilledAlertData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(U(`Not invoiced yet: ${d.milestone_title} for ${d.client_name}`)), opts, {
    before: [
      line([
        `${hi(d.owner_first_name)}${d.milestone_title} for ${d.client_name} was delivered on ${d.delivered_date}, ${days(d.days_since)} ago, and has no invoice yet.`,
      ]),
    ],
    action: { label: OPEN_IN_ADMIN, url: d.admin_url },
  });
}

/** 07-U §8: a payment request still unpaid after the work was delivered (VERIFY WITH CA/LEGAL). */
export function alertProformaDue(d: ProformaDueAlertData, opts: LayoutOptions): Rendered {
  return securityEmail(
    headerValue(U(`Payment request ${d.proforma_number} still unpaid after delivery`)),
    opts,
    {
      before: [
        line([
          `${hi(d.owner_first_name)}${d.milestone_title} for ${d.client_name} was delivered on ${d.delivered_date}, ${days(d.days_since)} ago, and payment request `,
          B(d.proforma_number),
          " still shows ",
          B(d.balance),
          " unpaid. A tax invoice is due within 30 days of delivery even if payment hasn't arrived.",
        ]),
      ],
      action: { label: OPEN_IN_ADMIN, url: d.admin_url },
    },
  );
}

/** The weekly LUT email (VERIFY WITH CA/LEGAL): 07-S §5 while next year's letter is due; 07-U §8 while the running year has none. */
export function lutReminder(d: LutReminderData, opts: LayoutOptions): Rendered {
  if (d.state === "current_missing")
    return securityEmail(headerValue(U(`No LUT saved for FY ${d.fy_label}`)), opts, {
      before: [
        line([
          `${hi(d.owner_first_name)}there's no letter of undertaking saved for FY ${d.fy_label}, so export invoices without IGST are blocked. File it on the GST portal and save the ARN in Settings › Tax.`,
        ]),
      ],
      action: { label: OPEN_IN_ADMIN, url: d.admin_url },
    });
  // 07-S §5, word for word (no greeting: 07-S has none).
  return securityEmail(headerValue(`File the LUT for FY ${d.fy_label}`), opts, {
    before: [
      para(
        `Export invoices without IGST from 1 April need a letter of undertaking for FY ${d.fy_label}. File it on the GST portal (Services, User Services, Furnish Letter of Undertaking) and save the ARN in Settings › Tax. We'll remind you each week until it's saved.`,
      ),
    ],
    action: { label: OPEN_IN_ADMIN, url: d.admin_url },
  });
}
