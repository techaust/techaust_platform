// Pure helpers of the PDF queue (M4.4, JOB-PDF-01): the message union, its guard, the fixed R2 keys, the place-of-supply label and
// the next UTC midnight. Zod-free and I/O-free, so the admin, jobs and portal Workers can all use it.
// One unit of work per message; ids only, never personal data.
import { EXPORT_PLACE_OF_SUPPLY, isStateCode, STATE_CODES } from "./gstin.ts";

export type PdfSnapshotReason = "send" | "retry" | "sweep";

export type PdfSnapshotMessage = {
  v: 1;
  kind: "pdf.snapshot";
  documentId: string;
  reason: PdfSnapshotReason;
};
/** `hop` counts pacing re-sends (a 429 sends a delayed copy), capped at `PDF_MAX_HOPS`. */
export type PdfRenderMessage = { v: 1; kind: "pdf.render"; documentId: string; hop: number };
/** From the cron: enqueues the documents whose PDF is still missing (the worker caps a run at 20). */
export type PdfSweepMessage = { v: 1; kind: "pdf.sweep"; asOf: number };
// M4.5 adds { v: 1; kind: "pdf.certificate"; acceptanceId: string; hop: number }

export type PdfMessage = PdfSnapshotMessage | PdfRenderMessage | PdfSweepMessage;

export const PDF_MAX_HOPS = 30;
export const PDF_SNAPSHOT_REASONS: readonly PdfSnapshotReason[] = ["send", "retry", "sweep"];

const isObject = (b: unknown): b is Record<string, unknown> => typeof b === "object" && b !== null;
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** A hand-written guard (like `isPurgeMessage`): the shape, the version, and ids and counters within their bounds. */
export function isPdfMessage(body: unknown): body is PdfMessage {
  if (!isObject(body) || body.v !== 1) return false;
  switch (body.kind) {
    case "pdf.snapshot":
      return isId(body.documentId) && PDF_SNAPSHOT_REASONS.includes(body.reason as PdfSnapshotReason);
    case "pdf.render":
      return (
        isId(body.documentId) &&
        typeof body.hop === "number" &&
        Number.isInteger(body.hop) &&
        body.hop >= 0 &&
        body.hop <= PDF_MAX_HOPS
      );
    case "pdf.sweep":
      return typeof body.asOf === "number" && Number.isSafeInteger(body.asOf) && body.asOf >= 0;
    default:
      return false;
  }
}

/** True for any body of the PDF family (valid or not), so a malformed one is never handed to another consumer. */
export const isPdfKind = (body: unknown): boolean =>
  isObject(body) && typeof body.kind === "string" && body.kind.startsWith("pdf.");

export type PdfKeyInput = { type: string; fy: string; number: number; version: number };

/**
 * The fixed R2 keys of one sent version: `docs/<type>/<fy>/<number padded to 4>-v<version>.{json,pdf}`. The FY is the label
 * ("2026-27"); the number is the integer sequence of the document number (the 3 of TH/PRP/2627/0003), padded to 4. Anything else is refused,
 * so a key can never carry a path or a personal detail.
 */
export function pdfKeys(i: PdfKeyInput): { snapshot: string; pdf: string } {
  if (!/^[a-z_]{1,24}$/.test(i.type)) throw new RangeError("pdfKeys: invalid type");
  if (!/^\d{4}-\d{2}$/.test(i.fy)) throw new RangeError("pdfKeys: invalid fy");
  if (!Number.isInteger(i.number) || i.number < 1 || i.number > 999_999_999) {
    throw new RangeError("pdfKeys: invalid number");
  }
  if (!Number.isInteger(i.version) || i.version < 1 || i.version > 999)
    throw new RangeError("pdfKeys: invalid version");
  const stem = `docs/${i.type}/${i.fy}/${String(i.number).padStart(4, "0")}-v${i.version}`;
  return { snapshot: `${stem}.json`, pdf: `${stem}.pdf` };
}

/**
 * The place of supply as printed: "West Bengal (19)"; for an export "Outside India (96 – Other Territory)".
 * VERIFY WITH CA/LEGAL: the wording and showing it on a proposal at all.
 */
export function placeOfSupplyLabel(code: string, supplyType: string): string {
  if (supplyType === "export_lut" || supplyType === "export_igst" || code === EXPORT_PLACE_OF_SUPPLY) {
    return "Outside India (96 – Other Territory)";
  }
  return isStateCode(code) ? `${STATE_CODES[code].name} (${code})` : code;
}

const DAY_MS = 86_400_000;

/** The first instant of the next UTC day after `nowMs` (the Browser Run daily quota resets at 00:00 UTC). */
export function nextUtcMidnight(nowMs: number): number {
  return (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
}
