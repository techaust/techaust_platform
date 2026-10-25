// Pure helpers of sending, accepting and declining a proposal or estimate (M4.5; ADM-PROP-07..10, ADM-EST-01, POR-04, POR-05).
// Zod-free and I/O-free, so the admin, jobs and portal Workers can all use them. VERIFY WITH CA/LEGAL: a typed name and a
// ticked box as acceptance, and the link lifetimes below (docs/runs/m4.5-send-accept.md §4).
import { addDays, fromIst, istDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { pdfKeys } from "./pdf-jobs.ts";
import type { SummaryRow } from "./tax/types.ts";

/** The reason codes of a decline. The words are the owner's (07-N); only the codes are fixed here. */
export const DECLINE_REASONS = ["price", "timing", "other_option", "not_needed", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
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

/** The attachment allow-list of the email consumer: only a sent proposal or estimate PDF (or its certificate). */
export const ATTACHMENT_KEY =
  /^docs\/(proposal|estimate)\/[0-9]{4}-[0-9]{2}\/[0-9]{4}-v[0-9]{1,3}(-certificate)?\.pdf$/;
/** The largest attachment the email consumer will read (the CPU budget on the Free plan decides; measured in stage B). */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** The browser link of an offer: the token is in the URL FRAGMENT (never sent to a server, never in a log) and is used after a click. */
export const offerLinkUrl = (portalBase: string, token: string): string =>
  `${portalBase.replace(/\/+$/, "")}/o#t=${token}`;

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
