// What the M7.1 screens share (POR-04, POR-06 to POR-11): dates in IST, file sizes, the words of every refusal BY ITS CODE (never the server's message: the
// new routes answer "[Placeholder] C15" and the like), and the checks "I've paid", Profile and a new request make before sending (the server checks again).
// Money is parsed and formatted only through core (`parseMoney`, `formatMoney`): nothing here adds amounts up.
import { formatDate, istDate } from "@techaust/core/dates";
import { compare, formatMoney, money, parseMoney } from "@techaust/core/money";
import { RequestError } from "../api.ts";
import { COPY, waitText } from "../copy.ts";
import { INV } from "../copy-invoices.ts";
import { PENDING } from "../copy-documents.ts";
import { GAP, ZP } from "../copy-zp.ts";

export type Cur = "INR" | "USD";
export const curOf = (c: string): Cur => (c === "USD" ? "USD" : "INR");
export const moneyOf = (minor: number, currency: string) => money(minor, curOf(currency));

/** "06 Oct 2026": the IST day of a moment (UTC ms), as the portal writes dates. */
export const istDayText = (ms: number) => formatDate(istDate(ms));

/** 2.4 MB, 820 KB, 512 bytes: decimal units, as people read file sizes (the admin's `sizeText`). */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  const kb = Math.round(bytes / 1000);
  if (kb < 1000) return `${kb} KB`;
  const mb = Math.round(bytes / 100_000) / 10;
  return `${mb} MB`;
}

/** The words of a failed request that has no line of its own: the network, or our side. */
export const plainProblem = (e: unknown) =>
  e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.network;

/** The receipt list's "For" cell: the invoice numbers, and how many more were left out (G1, marked until the owner gives the words). */
export function forText(f: { numbers: readonly string[]; more: number }): string {
  const list = f.numbers.join(", ");
  if (f.more > 0) return list ? `${list} ${GAP.forMore(f.more)}` : GAP.forMore(f.more);
  return list || "–";
}

// ---- "I've paid" ------------------------------------------------------------------------------------------------------------------------------------------

export type NoticeForm = { amount: string; paidOn: string; reference: string; note: string };
export type NoticeErrors = Partial<Record<"amount" | "paidOn" | "reference" | "note" | "form", string>>;

/**
 * The body fields a 400 `bad_request` names (review M1, builder B4: `{ error, fields: ["note"], request_id }`, field names only, never a value); none when
 * the answer names none. A refusal of the note is never worded as the reference's.
 */
export function refusedFields(e: RequestError): string[] {
  const f = e.extra.fields;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The form's own checks (amount readable and above zero, not above the balance; a date; a reference), in the field order. The date's range (not in the
 * future, not before the invoice) is the server's (IST day; L21), answered by code.
 */
export function checkNotice(
  f: NoticeForm,
  o: { currency: string; balanceMinor: number; dateUnread: boolean },
): { ok: true; amountMinor: number } | { ok: false; errors: NoticeErrors } {
  const errors: NoticeErrors = {};
  let amountMinor = 0;
  if (f.amount.trim() === "") errors.amount = GAP.amountMissing;
  else {
    const r = parseMoney(f.amount, curOf(o.currency));
    if (!r.ok || r.value.amount <= 0) errors.amount = GAP.amountUnread;
    else if (compare(r.value, moneyOf(o.balanceMinor, o.currency)) > 0)
      errors.amount = ZP.noticeErrors.amount_above_balance(formatMoneyOf(o.balanceMinor, o.currency));
    else amountMinor = r.value.amount;
  }
  if (o.dateUnread) errors.paidOn = GAP.dateInvalid;
  else if (!f.paidOn) errors.paidOn = GAP.dateMissing;
  if (f.reference.trim() === "") errors.reference = GAP.referenceMissing;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, amountMinor };
}

export const formatMoneyOf = (minor: number, currency: string) => formatMoney(moneyOf(minor, currency));

/**
 * A notice the server refused, by its code (C15; G6, G8, G9 and G12 for a 400 `bad_request`, by the fields it names), with the field each belongs to. `link`: the emailed
 * "View & pay" page, where a 404 means the link ended (07-U's approved "This link no longer works"; lead, 2026-11-05, question 2), never C15.
 */
export function noticeRefusal(e: unknown, currency: string, o: { link?: boolean } = {}): NoticeErrors {
  if (!(e instanceof RequestError) || e.code === "network") return { form: COPY.network };
  switch (e.code) {
    case "amount_above_balance": {
      const b = e.extra.balanceMinor;
      return typeof b === "number"
        ? { amount: ZP.noticeErrors.amount_above_balance(formatMoneyOf(b, currency)) }
        : { form: ZP.noticeErrors.not_payable };
    }
    case "date_in_future":
      return { paidOn: ZP.noticeErrors.date_in_future };
    case "date_before_issue":
      return { paidOn: ZP.noticeErrors.date_before_issue };
    case "notice_duplicate":
      return { reference: ZP.noticeErrors.notice_duplicate };
    case "notice_open_limit":
      return { form: ZP.noticeErrors.notice_open_limit };
    case "not_payable":
      return { form: ZP.noticeErrors.not_payable };
    case "bad_request": {
      // each named field gets its own words; a link's token refused is the link that ended; an answer that names no field we know is our side's problem
      const out: NoticeErrors = {};
      for (const f of refusedFields(e)) {
        if (f === "note") out.note = GAP.noteRefused;
        else if (f === "reference") out.reference = GAP.referenceRefused;
        else if (f === "amountMinor") out.amount = GAP.amountUnread;
        else if (f === "paidOn") out.paidOn = GAP.dateInvalid;
        else if (f === "token") out.form = INV.linkEnded;
      }
      return Object.keys(out).length > 0 ? out : { form: COPY.server };
    }
    case "not_found":
      return { form: o.link ? INV.linkEnded : ZP.noticeErrors.not_payable };
    case "rate_limited":
      return { form: PENDING.linkRateLimited(waitText(e.retryAfterS)) };
  }
  return { form: COPY.server };
}

// ---- Profile and requests ---------------------------------------------------------------------------------------------------------------------------------

/** A request refused, by its code (C24; G5 for the details). */
export function requestRefusal(e: unknown): string {
  if (!(e instanceof RequestError) || e.code === "network") return COPY.network;
  if (e.code === "request_open") return ZP.requestOpen;
  if (e.code === "too_many_requests") return ZP.tooManyRequests;
  if (e.code === "bad_request") return GAP.detailsMissing;
  return COPY.server;
}

/** A save refused, by its code (C17; G3). */
export function profileRefusal(e: unknown): string {
  if (!(e instanceof RequestError) || e.code === "network") return COPY.network;
  if (e.code === "stale_version") return ZP.stale;
  if (e.code === "bad_request") return GAP.detailsRefused;
  return COPY.server;
}

/** The kinds whose details are required (core `DETAILS_REQUIRED_KINDS`, the server's rule). */
export const DETAILS_REQUIRED: ReadonlySet<string> = new Set([
  "contact_change",
  "data_correction",
  "grievance",
]);
export const DETAILS_MAX = 1000;

/** A request's state line (C23): "Open", or "Closed {date}" and its outcome. */
export function requestState(r: { status: string; outcome: string | null; closedAt: number | null }): {
  open: boolean;
  text: string;
  outcome: string | null;
} {
  if (r.status === "open") return { open: true, text: ZP.open, outcome: null };
  return {
    open: false,
    text: r.closedAt ? ZP.closedOn(istDayText(r.closedAt)) : ZP.closedOn(""),
    outcome: r.outcome === "done" ? ZP.done : r.outcome === "declined" ? ZP.declined : null,
  };
}
