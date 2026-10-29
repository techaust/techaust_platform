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
/** M4.5: the acceptance certificate of one acceptance (`hop` counts pacing re-sends like `pdf.render`'s). */
export type PdfCertificateMessage = { v: 1; kind: "pdf.certificate"; acceptanceId: string; hop: number };
/** M4.5, from the daily cron: the consumer picks the send rows still waiting for their PDF and the acceptances without a certificate (<= 20 each). */
export type OfferSweepMessage = { v: 1; kind: "offer.sweep"; asOf: number };

/** M5.5b (LD79): the PDF of one `statement_pdfs` row (`hop` counts pacing re-sends like `pdf.render`'s). Ids only: the consumer reads the row. */
export type PdfStatementMessage = { v: 1; kind: "pdf.statement"; statementId: string; hop: number };

/**
 * The stored DUPLICATE FOR SUPPLIER copy of one issued tax invoice, export invoice, credit note or debit note (Rule 48(2); owner 2026-10-28, Q11). One unit of work: it renders the same
 * frozen envelope as the original, with the other copy mark, and stores it write-once in `DOCS` under its own key (`supplierPdfKey`). It is never attached, emailed or linked to a client.
 * `hop` counts pacing re-sends like `pdf.render`'s.
 */
export type PdfSupplierMessage = { v: 1; kind: "pdf.supplier"; documentId: string; hop: number };

export type PdfMessage =
  | PdfSnapshotMessage
  | PdfRenderMessage
  | PdfSweepMessage
  | PdfCertificateMessage
  | PdfStatementMessage
  | PdfSupplierMessage
  | OfferSweepMessage;

/** The invoice-family types that have a supplier copy (Rule 48(2): the services invoice and, by Rule 53, the notes; never a proforma, which is no tax invoice). */
export const SUPPLIER_COPY_TYPES = ["tax_invoice", "export_invoice", "credit_note", "debit_note"] as const;
export const hasSupplierCopy = (type: string): boolean =>
  (SUPPLIER_COPY_TYPES as readonly string[]).includes(type);

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
    case "pdf.supplier":
      return (
        isId(body.documentId) &&
        typeof body.hop === "number" &&
        Number.isInteger(body.hop) &&
        body.hop >= 0 &&
        body.hop <= PDF_MAX_HOPS
      );
    case "pdf.statement":
      return (
        isId(body.statementId) &&
        typeof body.hop === "number" &&
        Number.isInteger(body.hop) &&
        body.hop >= 0 &&
        body.hop <= PDF_MAX_HOPS
      );
    case "pdf.certificate":
      return (
        isId(body.acceptanceId) &&
        typeof body.hop === "number" &&
        Number.isInteger(body.hop) &&
        body.hop >= 0 &&
        body.hop <= PDF_MAX_HOPS
      );
    case "pdf.sweep":
    case "offer.sweep":
      return typeof body.asOf === "number" && Number.isSafeInteger(body.asOf) && body.asOf >= 0;
    default:
      return false;
  }
}

/** True for any body of the PDF family (valid or not; `offer.sweep` rides this queue too), so a malformed one is never handed to another consumer. */
export const isPdfKind = (body: unknown): boolean =>
  isObject(body) &&
  typeof body.kind === "string" &&
  (body.kind.startsWith("pdf.") || body.kind === "offer.sweep");

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
 * The R2 key of a document's DUPLICATE FOR SUPPLIER copy: the original's own stem with `-supplier.pdf`, so it is its own object, written once, and no row has to
 * name it (the object's existence is its state). The same checks as `pdfKeys`.
 */
export function supplierPdfKey(i: PdfKeyInput): string {
  return pdfKeys(i).pdf.replace(/\.pdf$/, "-supplier.pdf");
}

/**
 * The place of supply as printed: "West Bengal (19)"; for an export "Outside India (96)", as invoices print it (07-S §1). Researched 2026-10-29,
 * Rule 46(n), e-invoice master code 96 (08-C RA-35): 96 is "other countries" (97 is "Other Territory"); on a proposal or estimate it is a preview
 * (08-C RA-12, RA-28). Stored PDFs are write-once and keep the words they were made with.
 */
export function placeOfSupplyLabel(code: string, supplyType: string): string {
  if (supplyType === "export_lut" || supplyType === "export_igst" || code === EXPORT_PLACE_OF_SUPPLY) {
    return `Outside India (${EXPORT_PLACE_OF_SUPPLY})`;
  }
  return isStateCode(code) ? `${STATE_CODES[code].name} (${code})` : code;
}

const DAY_MS = 86_400_000;

/** The first instant of the next UTC day after `nowMs` (the Browser Run daily quota resets at 00:00 UTC). */
export function nextUtcMidnight(nowMs: number): number {
  return (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
}

/** The UTC date ("2026-10-26") of an instant: the day Browser Run's quota counts. */
export const utcDateOf = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/**
 * The FY label of an FY token ("2627" -> "2026-27"). `documents.fy` holds the token (it is part of the number); the R2 keys and the
 * envelope use the label. Null for anything that is not two consecutive years.
 */
export function fyLabelOfToken(token: string): string | null {
  if (!/^\d{4}$/.test(token)) return null;
  const a = Number(token.slice(0, 2));
  const b = Number(token.slice(2));
  if ((a + 1) % 100 !== b) return null;
  return `${2000 + a}-${token.slice(2)}`;
}
