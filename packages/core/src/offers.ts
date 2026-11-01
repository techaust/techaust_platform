// Pure helpers of sending, accepting and declining a proposal or estimate (M4.5; ADM-PROP-07..10, ADM-EST-01, POR-04, POR-05).
// Zod-free and I/O-free, so the admin, jobs and portal Workers can all use them. Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19): a typed name and a
// ticked box as acceptance, and the link lifetimes below (docs/runs/m4.5-send-accept.md §4).
import { addDays, fromIst, istDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { pdfKeys } from "./pdf-jobs.ts";
import type { SummaryRow } from "./tax/types.ts";

/** The reason codes of a decline, in the order the portal lists them. Their words are `DECLINE_REASON_LABELS`. */
export const DECLINE_REASONS = ["price", "timing", "other_option", "not_needed", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * 07-N §3 (approved by the owner with 07-Q, 2026-10-26), word for word: the words of each decline reason, held once (test-hardening item 6) for the portal's
 * decline dialog and record, the admin's document and lead pages, and the jobs Worker's bells. Keys in the order of `DECLINE_REASONS` (a test pins both).
 */
export const DECLINE_REASON_LABELS = {
  price: "The price doesn't fit our budget",
  timing: "The timing doesn't work for us",
  other_option: "We've chosen another option",
  not_needed: "We've decided not to go ahead",
  other: "Other",
} as const satisfies Record<DeclineReason, string>;
export const isDeclineReason = (v: unknown): v is DeclineReason =>
  typeof v === "string" && (DECLINE_REASONS as readonly string[]).includes(v);

/** The longest note a client can add to a decline. */
export const DECLINE_NOTE_MAX = 500;

export type DeclineCheck =
  | { readonly ok: true; readonly reason: DeclineReason; readonly note: string | null }
  | { readonly ok: false; readonly error: "reason_invalid" | "note_required" | "note_too_long" };

/** The note is required for "other", optional for the rest; it is trimmed and an empty one becomes null. */
export function checkDecline(reason: unknown, note: unknown): DeclineCheck {
  if (!isDeclineReason(reason)) return { ok: false, error: "reason_invalid" };
  const text = typeof note === "string" ? note.normalize("NFC").trim() : "";
  if (text.length > DECLINE_NOTE_MAX) return { ok: false, error: "note_too_long" };
  if (reason === "other" && text === "") return { ok: false, error: "note_required" };
  return { ok: true, reason, note: text === "" ? null : text };
}

export const TYPED_NAME_MIN = 2;
export const TYPED_NAME_MAX = 120;

export type TypedName =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: "name_too_short" | "name_too_long" | "name_invalid_characters" };

// Control characters, bidi overrides and isolates, zero-width characters and the byte-order mark. A typed name is shown in the
// certificate and in emails, so nothing invisible or direction-changing is allowed. The zero-width (non-)joiners U+200C and
// U+200D stay allowed: Bengali and Hindi names need them.
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const NAME_JOINERS = /[\u200C\u200D]/gu;

/** NFC, trimmed, spaces collapsed; 2 to 120 characters (code points); no control, format or bidi characters. */
export function normaliseTypedName(input: unknown): TypedName {
  if (typeof input !== "string") return { ok: false, error: "name_too_short" };
  const nfc = input.normalize("NFC");
  if (FORBIDDEN_IN_NAME.test(nfc.replace(NAME_JOINERS, "")))
    return { ok: false, error: "name_invalid_characters" };
  const value = nfc.replace(/\s+/gu, " ").trim();
  const length = [...value].length;
  if (length < TYPED_NAME_MIN) return { ok: false, error: "name_too_short" };
  if (length > TYPED_NAME_MAX) return { ok: false, error: "name_too_long" };
  return { ok: true, value };
}

const DAY_MS = 86_400_000;
/** An offer link lasts until the end of `valid_until` (IST) plus this many days. */
export const OFFER_LINK_GRACE_DAYS = 30;
/** A confirmation link lasts this many days from the acceptance. */
export const CONFIRMATION_LINK_DAYS = 90;

/** The instant a link stops working (exclusive): 00:00 IST on the day after `valid_until` plus the grace. */
export function offerLinkExpiry(validUntil: string): number {
  const date = parseIsoDate(validUntil);
  if (!date) throw new RangeError(`offerLinkExpiry: not a date: ${validUntil}`);
  return fromIst(addDays(date, 1 + OFFER_LINK_GRACE_DAYS));
}

export const confirmationLinkExpiry = (acceptedAt: number): number =>
  acceptedAt + CONFIRMATION_LINK_DAYS * DAY_MS;

/** Today in IST as `YYYY-MM-DD`: what `valid_until` is compared with. */
export const todayIst = (nowMs: number): string => toIsoDate(istDate(nowMs));

export type ClientOfferStatus = "sent" | "viewed" | "accepted" | "declined" | "expired" | "revised";

/**
 * What the client sees. A `sent` or `viewed` offer whose last valid day has passed reads as expired (the nightly job lags);
 * `rejected` reads as "declined" for the client (docs/06 §5.5 "Rejected" is staff wording).
 */
export function effectiveOfferStatus(
  row: { readonly status: string; readonly validUntil: string | null },
  today: string,
): ClientOfferStatus {
  switch (row.status) {
    case "sent":
    case "viewed":
      return row.validUntil !== null && row.validUntil < today ? "expired" : row.status;
    case "accepted":
    case "converted":
      // An estimate that staff turned into an invoice or a care plan still reads "Accepted" to the client (lead decision, 2026-10-26).
      return "accepted";
    case "expired":
    case "revised":
      return row.status;
    case "rejected":
      return "declined";
    default:
      throw new RangeError(`effectiveOfferStatus: not a client-visible status: ${row.status}`);
  }
}

/** The R2 key of the acceptance certificate: `docs/<type>/<fy>/<nnnn>-v<v>-certificate.pdf` (the rules of `pdfKeys`). */
export function certificateKey(i: { type: string; fy: string; number: number; version: number }): string {
  return pdfKeys(i).pdf.replace(/\.pdf$/, "-certificate.pdf");
}

/**
 * The attachment allow-list of the email consumer: a sent proposal or estimate PDF (or its certificate), and (M5.4) an issued invoice-family PDF, exactly as `pdfKeys` writes
 * them: the number is padded to AT LEAST four digits (`padStart(4)`), so 10,000 and above has five or more (up to nine); an invoice's version is always 1 and it has no certificate.
 */
export const ATTACHMENT_KEY =
  /^docs\/(?:(?:proposal|estimate)\/[0-9]{4}-[0-9]{2}\/[0-9]{4,9}-v[0-9]{1,3}(?:-certificate)?|(?:tax_invoice|export_invoice|proforma|credit_note|debit_note)\/[0-9]{4}-[0-9]{2}\/[0-9]{4,9}-v1)\.pdf$/;
/**
 * The largest attachment the email consumer will read. The brief said 5 MB; the Free plan's 10 ms CPU says less: the body is base64'd (native
 * in workerd, about 37 ms per MB without it), put in a JSON string and SHA-256'd by the SigV4 signer. Not measured in workerd (its clock does
 * not move in tests): 1 MB is the conservative cap until staging's `cpuTimeMs` of an email with a PDF says otherwise. Over the cap the email
 * goes link-only.
 */
export const ATTACHMENT_MAX_BYTES = 1024 * 1024;

/** The browser link of an offer: the token is in the URL FRAGMENT (never sent to a server, never in a log); the page reads it, strips it from the address bar and opens the offer at once (owner-approved preview: no Continue click). */
export const offerLinkUrl = (portalBase: string, token: string): string =>
  `${portalBase.replace(/\/+$/, "")}/o#t=${token}`;

/** An invoice link lives this many days from the moment it is minted (each email mints its own, LD63). "Paid + 30 days" is M6's (it needs `paid_at`). */
export const INVOICE_LINK_DAYS = 180;
export const invoiceLinkExpiry = (mintedAt: number): number => mintedAt + INVOICE_LINK_DAYS * DAY_MS;

/** The browser link of an invoice, proforma or note: the token is in the URL FRAGMENT, like an offer link's; the portal page reads it and opens the document at once. */
export const invoiceLinkUrl = (portalBase: string, token: string): string =>
  `${portalBase.replace(/\/+$/, "")}/i#t=${token}`;

const toBase64Url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

/** A new link token: 32 random bytes as 43 URL-safe characters, and the SHA-256 (hex) of it that the database keeps. */
export async function mintOfferToken(): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return { token, hash: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("") };
}

/** The certificate key that belongs to a PDF key (`.../0003-v1.pdf` becomes `.../0003-v1-certificate.pdf`). */
export const certificateKeyOfPdfKey = (pdfKey: string): string =>
  pdfKey.replace(/\.pdf$/, "-certificate.pdf");

export type HeadRates = { readonly cgstBp: number; readonly sgstBp: number; readonly igstBp: number };

/**
 * The rate of each tax head of a summary row, from the stored effective rate (0 under LUT). Intra-state, CGST and SGST are each
 * half the rate; an odd rate cannot be written in basis points, so the heads are not given (null) and the caller prints the amounts only.
 */
export function headRatesBp(row: Pick<SummaryRow, "effectiveRateBp">, supplyType: string): HeadRates | null {
  const rate = row.effectiveRateBp;
  if (!Number.isInteger(rate) || rate < 0) throw new RangeError("headRatesBp: invalid rate");
  if (supplyType === "intra") {
    return (rate & 1) === 0 ? { cgstBp: rate >> 1, sgstBp: rate >> 1, igstBp: 0 } : null;
  }
  return { cgstBp: 0, sgstBp: 0, igstBp: rate };
}

// ---- 07-ZE section A: the offer lines shared by the email, the PDF, the portal and the admin (T6; approved by the owner, 2026-10-31) ----
// One source for each line, so the email, the PDF, the portal and the admin preview never word it differently. Never on a proforma, a due date
// or a staff list screen (07-ZE line 1).

/**
 * 07-ZE line 1: a proposal's or estimate's validity date with its time zone, "15 Nov 2026 (IST)". `date` is already formatted by the caller
 * (short on the PDF, long on screen); an empty date stays empty, so no lone "(IST)" is printed. OPEN (08-C RB-35(a)) answered by naming IST:
 * the validity ends at midnight India Standard Time, whoever reads it.
 */
export const validityDateIst = (date: string): string => (date.trim() === "" ? "" : `${date} (IST)`);

/**
 * 07-ZE line 2: the portal's notice once a proposal or estimate has expired (`date` its last valid day, formatted, without "(IST)": the line
 * adds it). OPEN (08-C RB-35(a)) answered by naming IST.
 */
export const offerExpiredNotice = (kind: string, date: string): string =>
  `This ${kind === "estimate" ? "estimate" : "proposal"} expired at the end of ${date} (IST). Reply to our email or contact us if you'd still like to go ahead.`;

/**
 * 07-ZE line 3: from version 2 onwards (PDF under the validity note, email after the first paragraph, portal under the title); null for
 * version 1 or a value that is not a whole version number. A revision is made only from the newest sent version, so `version − 1` is the
 * version the client last received. Researched 2026-10-29, Contract Act s.6 (08-C RB-35); OPEN (08-C RB-35(b)): s.5 not read.
 */
export function offerReplacesLine(version: number | string): string | null {
  const n = typeof version === "string" && /^\d+$/.test(version) ? Number(version) : version;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 2) return null;
  return `This is version ${n}. It replaces version ${n - 1} and any earlier version, which can no longer be accepted.`;
}

/** A contact's first name as the offer emails and the staff reply greet them: the first word of the name; "" for a blank name. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/**
 * 07-ZE line 4: the closing line of the proposal and estimate email (it replaced "Questions? Just reply to this email."). Researched
 * 2026-10-31, Contract Act s.7(2) (08-C RB-35): the offer prescribes the manner of acceptance.
 */
export const OFFER_EMAIL_CLOSING =
  "Questions? Just reply to this email. To accept, use Review and accept: a reply by email isn't an acceptance.";

export type StaffAcceptReplyFields = {
  /** The client contact's first name. */
  firstName: string;
  /** The document number as printed ("TH/PRP/2627/0001"). */
  number: string;
  version: number;
  /** The portal address the client signs in at. */
  portalLink: string;
};

/**
 * 07-ZE line 5: the reply staff send, the same working day, when a client "accepts" a proposal or estimate by email. Filled here, sent by a
 * person (nothing is sent automatically). Researched 2026-10-31, Contract Act s.7(2) (08-C RB-35).
 */
export const staffAcceptReply = (f: StaffAcceptReplyFields): string =>
  `Thank you, ${f.firstName}. To accept ${f.number} v${f.version}, please use the Review and accept button in our email, or sign in at ${f.portalLink}, and click Accept there. As our terms say, a reply by email isn't an acceptance, so we haven't treated it as one. If it has expired or we've sent a newer version, tell us and we'll send you the current one.`;
