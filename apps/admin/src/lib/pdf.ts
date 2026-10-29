// The PDF of a sent proposal or estimate and the signature image, as staff see them (M4.4): the wording, word for word from 07-P §3
// and §4 (approved with 07-Q), and the pure rules the screens follow. No I/O here.
import { SIGNATURE_MAX_BYTES, SIGNATURE_MIMES } from "@techaust/core/settings";
import { Y } from "./copy-y.ts";

export const PDF_COPY = {
  download: "Download PDF",
  ready: "PDF ready",
  making: "Making the PDF…",
  slow: "The PDF is taking longer than usual.",
  tryAgain: "Try again",
  retried: "We'll make the PDF again.",
  /** "Fingerprint {first 12 characters}": the screen sets the word and the characters apart (the characters as a code). */
  fingerprintLabel: "Fingerprint",
  fingerprint: (twelve: string) => `Fingerprint ${twelve}`,
  /** 07-P §4: answers of the API, said in the screen's words. */
  pending: "The PDF is still being made. Try again in a minute.",
  done: "The PDF is already made.",
  /** On a draft, where the PDF panel will be (owner, 2026-10-28): drafts have no PDF until they are sent. */
  afterSend: (type: "proposal" | "estimate") => `The PDF is made when you send this ${type}.`,
} as const;

export const SIGNATURE_COPY = {
  heading: "Signature",
  // 07-R §7 (Researched 2026-10-28, Rule 46 CGST proviso, 08-C RA-06); replaces 07-P's hint.
  hint: `Optional. Invoices you send electronically don't need a signature (GST Rule 46). If you add one, it prints above "Authorised signatory".`,
  upload: "Upload signature",
  replace: "Replace",
  remove: "Remove",
  removeQuestion: "Remove the signature? Invoices issued already keep theirs.",
  // FX-3 (A6 1c): a larger image is now scaled down before it uploads, so the pixel limit leaves the line (07-Y, pending the owner).
  wrongFile: Y("Use a PNG or JPEG image up to 256 KB."),
  /** FX-3 (07-Y, pending): after an upload the browser scaled down; the designer places it. */
  scaled: Y("We made the image smaller to fit 800 by 400 pixels."),
  /** FX-3 (07-Y, pending): the image read fine, but as a PNG it passes 256 KB (a photo-like scan); docs/13 2026-10-29, PNG only. */
  tooDetailed: Y(
    "This image is too detailed to keep as a signature. Use a scan on a plain white background.",
  ),
} as const;

/** After this long without a PDF the screen says so and offers "Try again" (07-P §3: "after 5 minutes"). */
export const PDF_SLOW_AFTER_MS = 5 * 60_000;
/** How often a waiting screen asks again (only while it waits, and never past the 5 minutes). */
export const PDF_POLL_MS = 10_000;

export type PdfPhase = "none" | "ready" | "making" | "slow";

/** What the panel shows: `since` is when the wait began (the send, or the last "Try again"), `now` the clock. */
export function pdfPhase(state: "none" | "pending" | "ready", since: number | null, now: number): PdfPhase {
  if (state === "none") return "none";
  if (state === "ready") return "ready";
  return since !== null && now - since < PDF_SLOW_AFTER_MS ? "making" : "slow";
}

/** The `accept` of the file input: the types the API takes (the server decides by the bytes, never by the name). */
export const SIGNATURE_ACCEPT = SIGNATURE_MIMES.join(",");
export const SIGNATURE_MAX = SIGNATURE_MAX_BYTES;
const SIGNATURE_TYPES = new Set<string>(SIGNATURE_MIMES);

/** The early check before an upload: a PNG or a JPEG of 1 byte to 256 KB. The server checks the bytes again. */
export const signatureFileOk = (file: { type: string; size: number }): boolean =>
  SIGNATURE_TYPES.has(file.type) && file.size > 0 && file.size <= SIGNATURE_MAX;

/** The upload's refusals that 07-Q Q6 words as one line (type, bytes or pixels); any other answer keeps the server's own sentence. */
const WRONG_FILE_CODES = new Set(["file_too_large", "type_not_allowed", "image_too_big"]);
export const signatureErrorIsWrongFile = (code: string): boolean => WRONG_FILE_CODES.has(code);

/** The answer to a "Try again" refused with a known code, in 07-P's words; null keeps the server's own sentence. */
export function pdfRetryText(code: string): string | null {
  if (code === "pdf_done") return PDF_COPY.done;
  if (code === "pdf_pending") return PDF_COPY.pending;
  return null;
}

/** The settings version the company form may take on after a signature change: only the very next one (nobody else saved between). */
export const adoptVersion = (current: number, next: number): number =>
  next === current + 1 ? next : current;
