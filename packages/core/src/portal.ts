// The full client portal's rules (M7.1; POR-06, POR-09, POR-11, ADM-PAY-05; run file docs/runs/m7.1-portal.md B, L8, L10, L12). Pure: no I/O, no zod, no
// floats; codes only (the screens hold the words). Subpath export `@techaust/core/portal`.
//
//   - the requests a contact sends from the Profile page (`client_requests`, L8): five kinds, one open request per kind per contact, five a day. Each of the
//     DPDP Act's rights of the data principal (ss.11 to 13) gets a portal channel: access, Researched 2026-10-29, DPDP Act s.11(1) and Rule 14 (08-C RB-36);
//     erasure, Researched 2026-10-29, DPDP Act s.8(7) and s.12(3) (08-C RB-37); grievances redressed within one month: Researched 2026-10-28, SPDI Rules 2011
//     Rule 5(9) (08-C RB-13). Correction through the portal: OPEN (08-C RB-44): does a portal self-edit of name and phone, plus a `data_correction`
//     request for anything else, meet s.12's duty to correct, or must every correction be logged as a request? Until the lead researches it, both channels
//     exist and both are audited;
//   - "I've paid" (`payment_notices`, L10): a notice is never a payment and never money (a proforma is not a tax document, and its tax invoice follows only a
//     recorded and confirmed payment: Researched 2026-10-28, s.13(2) and s.31(2) CGST Act (08-C RA-17)); which documents may take one (`noticeAllowed`) and whether a
//     notice's facts can be right (`paidNoticeVerdict`). The SQL twins are `@techaust/db/sql-rules` `noticeAllowedSql` / `paidNoticeVerdictSql` (a db test
//     compares the two);
//   - the "View & pay" link's end, 30 days after the document is settled (L12, `viewPayLive`; the SQL twin is `viewPayLiveSql`).

const DAY_MS = 86_400_000;

// ---- requests (POR-09, POR-11, L8) ------------------------------------------------------------------------------------------------------------------------

/**
 * The kinds of request a contact can send (L8). Pinned to the installed trigger `client_requests_kind` (0072) by a db test; M7.4 adds `consent_withdrawal` and
 * `nomination` in both places.
 */
export const REQUEST_KINDS = [
  "contact_change",
  "data_access",
  "data_correction",
  "data_erasure",
  "grievance",
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** The data-rights kinds (s.11 access, s.12 correction and erasure): closed by the Owner only (`requests.close`, review fix 11). */
export const DATA_REQUEST_KINDS = [
  "data_access",
  "data_correction",
  "data_erasure",
] as const satisfies readonly RequestKind[];

/** The kinds whose `details` the contact must write: what to change, what is wrong, what the concern is. */
export const DETAILS_REQUIRED_KINDS = [
  "contact_change",
  "data_correction",
  "grievance",
] as const satisfies readonly RequestKind[];

/**
 * The kinds Staff may close (an ALLOW-LIST, so a kind added later, such as M7.4's `consent_withdrawal` and `nomination`, is the Owner's until decided): adding,
 * removing or changing a person's access, and a grievance. Every data-rights kind is the Owner's (`DATA_REQUEST_KINDS`).
 */
export const STAFF_CLOSE_KINDS = ["contact_change", "grievance"] as const satisfies readonly RequestKind[];

export const REQUEST_STATUSES = ["open", "closed"] as const;
export const REQUEST_OUTCOMES = ["done", "declined"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

/** The most a request's details may be (characters), and a staff member's close note. */
export const REQUEST_DETAILS_MAX = 1000;
export const REQUEST_CLOSE_NOTE_MAX = 500;
/** How many requests one contact may send in one IST day (L8; `REQUESTS_TODAY_SQL` counts them in SQL). */
export const REQUESTS_PER_DAY = 5;
/** Plain ids (a lead's or a contact's) kept as text in `lead_ref` / `contact_ref`, and a requester's email (RFC 5321's limit). */
export const REQUEST_REF_MAX = 64;
export const REQUESTER_EMAIL_MAX = 254;

export const isRequestKind = (v: unknown): v is RequestKind => REQUEST_KINDS.includes(v as RequestKind);
export const detailsRequired = (kind: RequestKind): boolean =>
  (DETAILS_REQUIRED_KINDS as readonly string[]).includes(kind);
/** True when Staff may close a request of this kind; an unknown kind is never Staff's (fails closed). */
export const staffMayClose = (kind: unknown): boolean =>
  typeof kind === "string" && (STAFF_CLOSE_KINDS as readonly string[]).includes(kind);

// ---- "I've paid" (ADM-PAY-05, L10) ------------------------------------------------------------------------------------------------------------------------

export const NOTICE_VIAS = ["portal", "link"] as const;
export type NoticeVia = (typeof NOTICE_VIAS)[number];
export const NOTICE_STATUSES = ["open", "recorded", "dismissed"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** The reference as typed (spaces included), and its stored form (`normaliseReference`: 1 to 60 of A-Z, 0-9, "/" and "-"). */
export const NOTICE_REFERENCE_MAX = 64;
export const NOTICE_REFERENCE_NORM_MAX = 60;
export const NOTICE_NOTE_MAX = 300;
/** The staff note on a dismissed notice (early check 1 finding 5; set only on dismiss, frozen after). */
export const NOTICE_CLOSE_NOTE_MAX = 300;
/** At most this many open notices on one document (409 `notice_open_limit`). */
export const NOTICES_OPEN_MAX = 3;

/** The document types a notice may be about: what a payment settles, and a proforma (whose payment is then recorded and its tax invoice issued, RA-17). */
export const NOTICE_TYPES = ["tax_invoice", "export_invoice", "debit_note", "proforma"] as const;
/** The statuses of an invoice or debit note that still has something to pay (an ALLOW-LIST: a draft, a request, `paid`, `credited` and `void` are not). */
export const NOTICE_OPEN_STATUSES = ["issued", "partially_paid", "partially_credited"] as const;
/**
 * The statuses of a proforma that may take a notice (early check 1 finding 1): `issued`, and `converted` while a balance is left (a proforma stays `converted`
 * after its first tax invoice for a payment received, and further payments are allowed: `@techaust/db` issue.ts, `payableOnline`). The balance rule below
 * refuses a settled one.
 */
export const NOTICE_PROFORMA_STATUSES = ["issued", "converted"] as const;

/** What `noticeAllowed` reads of a document: its frozen type, status and balance, and whether it is a withdrawn proforma (`withdrawnSql`). */
export type NoticeDoc = {
  readonly type: string;
  readonly status: string;
  readonly balanceMinor: number;
  readonly withdrawn: boolean;
};

/** Why a document can't take a notice, in the order they are checked (409 `not_payable` with `reason`). */
export const NOTICE_REFUSALS = [
  "withdrawn",
  "void",
  "credit_note",
  "not_payable_type",
  "proforma_not_issued",
  "paid",
  "not_open",
  "no_balance",
] as const;
export type NoticeRefusal = (typeof NOTICE_REFUSALS)[number];

/**
 * Whether a document can take an "I've paid" notice: refuses a withdrawn proforma (Q3 of runs/proforma-withdraw: nothing invites a payment), a void one, a credit
 * note (nothing is owed on it), any type that is not paid (a proposal, an estimate, a receipt), a proforma in any status but `issued` or `converted`
 * (`NOTICE_PROFORMA_STATUSES`), a paid one, an invoice or debit note in any other status not in `NOTICE_OPEN_STATUSES`, and a zero (or negative) balance (so a
 * converted proforma with nothing left is `no_balance`). Never throws.
 */
export function noticeAllowed(
  doc: NoticeDoc,
): { readonly ok: true } | { readonly ok: false; readonly reason: NoticeRefusal } {
  const no = (reason: NoticeRefusal) => ({ ok: false as const, reason });
  if (doc.withdrawn) return no("withdrawn");
  if (doc.status === "void") return no("void");
  if (doc.type === "credit_note") return no("credit_note");
  if (!(NOTICE_TYPES as readonly string[]).includes(doc.type)) return no("not_payable_type");
  const proforma = doc.type === "proforma";
  if (proforma && !(NOTICE_PROFORMA_STATUSES as readonly string[]).includes(doc.status))
    return no("proforma_not_issued");
  if (doc.status === "paid") return no("paid");
  if (!proforma && !(NOTICE_OPEN_STATUSES as readonly string[]).includes(doc.status)) return no("not_open");
  if (!Number.isSafeInteger(doc.balanceMinor) || doc.balanceMinor <= 0) return no("no_balance");
  return { ok: true };
}

export type PaidNoticeVerdict = "ok" | "amount_above_balance" | "date_in_future" | "date_before_issue";

/**
 * Whether a notice's facts can be right (C15): the amount at most the balance; the day paid not after today (IST) and not before the document's issue day. Days
 * are ISO "YYYY-MM-DD" strings (the schema checks that `paidOn` is a real date), so they compare as text. A non-integer amount or balance is refused as above
 * the balance (fails closed; the schema already refuses it).
 */
export function paidNoticeVerdict(v: {
  readonly amountMinor: number;
  readonly balanceMinor: number;
  readonly paidOn: string;
  readonly issueDate: string;
  readonly todayIst: string;
}): PaidNoticeVerdict {
  // A missing number or day fails closed (the SQL twin's `IS NULL` arms, early check 1 finding 7).
  if (
    !Number.isSafeInteger(v.amountMinor) ||
    !Number.isSafeInteger(v.balanceMinor) ||
    v.amountMinor > v.balanceMinor
  )
    return "amount_above_balance";
  if (typeof v.paidOn !== "string" || v.paidOn > v.todayIst) return "date_in_future";
  if (v.paidOn < v.issueDate) return "date_before_issue";
  return "ok";
}

// ---- the "View & pay" link (POR-06, L12) -------------------------------------------------------------------------------------------------------------------

/** A settled document's emailed "View & pay" link works this many days after it was settled (closes M5.4's open "paid + 30 days"). */
export const VIEW_PAY_GRACE_DAYS = 30;
export const VIEW_PAY_GRACE_MS = VIEW_PAY_GRACE_DAYS * DAY_MS;

/**
 * Whether the link still opens: `settledAt` is when the document was settled (the latest allocation or credit note while it is `paid` or `credited`), or null
 * while something is still owed (a refund reopens it). Live strictly before `settledAt` + 30 days (UTC ms).
 */
export const viewPayLive = (settledAt: number | null, now: number): boolean =>
  settledAt === null || now < settledAt + VIEW_PAY_GRACE_MS;
