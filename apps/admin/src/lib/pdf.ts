// The PDF of a sent proposal or estimate and the signature image, as staff see them (M4.4): the wording, word for word from 07-P §3
// and §4 (PENDING the owner's word-for-word approval), and the pure rules the screens follow. No I/O here.
import { SIGNATURE_MAX_BYTES, SIGNATURE_MIMES } from "@techaust/core/settings";

export const PDF_COPY = {
  download: "Download PDF",
  ready: "PDF ready",
  making: "Making the PDF…",
  slow: "The PDF is taking longer than usual.",
  tryAgain: "Try again",
  retried: "We'll make the PDF again.",
  fingerprint: (twelve: string) => `Fingerprint ${twelve}`,
  /** 07-P §4: answers of the API, said in the screen's words. */
  pending: "The PDF is still being made. Try again in a minute.",
  done: "The PDF is already made.",
} as const;

export const SIGNATURE_COPY = {
  heading: "Signature",
  hint: 'Printed on tax invoices above "Authorised signatory". PNG or JPEG, up to 256 KB.',
  upload: "Upload signature",
  replace: "Replace",
  remove: "Remove",
  removeQuestion: "Remove the signature? Invoices issued already keep theirs.",
  wrongFile: "Use a PNG or JPEG image up to 256 KB.",
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

/** The upload's refusals that 07-P words as "wrong type or size"; any other answer keeps the server's own sentence. */
const WRONG_FILE_CODES = new Set(["file_too_large", "type_not_allowed"]);
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
