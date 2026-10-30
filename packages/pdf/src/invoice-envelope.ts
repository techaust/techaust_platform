// The invoice envelope (M5.1 stage B, LD4): build, store, read and verify. Written with `JSON.stringify` in a fixed key order, so the same invoice
// always gives the same bytes (the jobs Worker writes it once and compares a second write byte for byte). The number is NOT in the seal (it is taken
// inside the issue batch after the hash); the envelope pairs it with the seal, and verification recomputes every hash it can from the envelope alone:
//   - snapshotSha256 = core `invoiceSnapshotSha256` of the sealed header (the very function the issue route sealed it with)
//   - header.computedSha256 = sha256(computedJson)
//   - header.document.termsRef and the footer notes agree, and sha256(notes) = termsRef.sha256
//   - header.document.contentSha256 = core `contentHash` of the lines, the discount and the computed result (the issue route's own)
//   - (M5.3) a credit or debit note carries `header.noteOf` (and no other type does), its kind is its type's, it takes one line per take, and a credit note has no due date
//   - (T10) a Udyam block is only on a tax invoice, and of the canonical shape (`isUdyam`): anything else is not an envelope to print from
// A signature image is checked separately (`verifySignatureBytes`): the envelope holds only its key, SHA-256 and mime (LD11).
import { contentHash, type DraftContent } from "@techaust/core/documents";
import {
  invoiceSnapshotSha256,
  isNoteType,
  isUdyam,
  noteKindOf,
  noteOfFromStored,
  udyamPrintedOn,
} from "@techaust/core/invoices";
import type { ComputedDocument } from "@techaust/core/tax";
import { sha256Hex } from "./hash.ts";
import type { InvoiceEnvelope, InvoiceHeader, InvoiceIssuerSnap } from "./invoice-types.ts";
import type { RecipientSnap } from "./types.ts";

export type InvoiceVerifyCode =
  | "version"
  | "mismatch"
  | "snapshot_hash"
  | "computed_hash"
  | "computed_json"
  | "terms_hash"
  | "content_hash";
export type InvoiceVerifyResult = { ok: true } | { ok: false; code: InvoiceVerifyCode };

/** A copy with its keys in sorted order and no undefined values (unknown keys are kept, so the seal still matches). */
function sorted<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [
        k,
        typeof v === "object" && v !== null && !Array.isArray(v) ? sorted(v as object) : v,
      ]),
  ) as T;
}

/** The envelope with every key in its fixed place (a copy; the input is not changed). */
export function buildInvoiceEnvelope(
  e: Omit<InvoiceEnvelope, "v" | "kind"> & { v?: 3; kind?: "invoice" },
): InvoiceEnvelope {
  const s = e.snapshot;
  const h = s.header;
  return {
    v: 3,
    kind: "invoice",
    documentId: e.documentId,
    type: e.type,
    number: e.number,
    numberDisplay: e.numberDisplay,
    series: e.series,
    fy: e.fy,
    issuedAt: e.issuedAt,
    snapshotSha256: e.snapshotSha256,
    snapshot: {
      header: sorted<InvoiceHeader>(h),
      computedJson: s.computedJson,
      discountKind: s.discountKind,
      discountValue: s.discountValue,
      lines: s.lines.map((l) => ({
        catalogueItemId: l.catalogueItemId,
        description: l.description,
        detail: l.detail,
        sac: l.sac,
        qtyMilli: l.qtyMilli,
        unit: l.unit,
        rateMinor: l.rateMinor,
        discountKind: l.discountKind,
        discountValue: l.discountValue,
        gstRateBp: l.gstRateBp,
        catalogueRateMinor: l.catalogueRateMinor,
        catalogueLine: l.catalogueLine,
      })),
      terms: s.terms
        ? { id: s.terms.id, version: s.terms.version, sha256: s.terms.sha256, bodyMd: s.terms.bodyMd }
        : null,
    },
  };
}

/** The text stored in R2. */
export const serializeInvoiceEnvelope = (e: InvoiceEnvelope): string =>
  JSON.stringify(buildInvoiceEnvelope(e));

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === "string";

function validExport(v: unknown): boolean {
  if (!isObj(v)) return false;
  if ((v.mode !== "lut" && v.mode !== "igst_paid") || !isStr(v.endorsement)) return false;
  if (!isStr(v.countryCode) || !isStr(v.countryName)) return false;
  if (v.lut !== null && !(isObj(v.lut) && isStr(v.lut.fy) && isStr(v.lut.arn))) return false;
  const d = v.declarationRef;
  if (d === null) return v.declarationText === undefined;
  // a pinned note travels with its frozen text
  return (
    isObj(d) && isStr(d.id) && typeof d.version === "number" && isStr(d.sha256) && isStr(v.declarationText)
  );
}

function validFx(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v.rateMicros === "number" &&
    isStr(v.date) &&
    isStr(v.source) &&
    (v.noRateDay === undefined || isStr(v.noRateDay))
  );
}

function validAdvance(v: unknown): boolean {
  return (
    isObj(v) &&
    isStr(v.proformaId) &&
    isStr(v.proformaNumber) &&
    isStr(v.proformaIssueDate) &&
    isStr(v.receivedOn) &&
    isStr(v.receiptId) &&
    (v.igstNoLutFy === undefined || isStr(v.igstNoLutFy))
  );
}

/** Parses stored text; null unless it has the invoice envelope's shape (format 3, `kind: "invoice"`, and its parts). */
export function parseInvoiceEnvelope(text: string): InvoiceEnvelope | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isObj(v) ||
    v.v !== 3 ||
    v.kind !== "invoice" ||
    typeof v.documentId !== "string" ||
    typeof v.snapshotSha256 !== "string" ||
    typeof v.type !== "string" ||
    typeof v.number !== "number" ||
    typeof v.numberDisplay !== "string" ||
    typeof v.series !== "string" ||
    typeof v.fy !== "string" ||
    typeof v.issuedAt !== "number"
  )
    return null;
  const s = v.snapshot;
  if (!isObj(s) || typeof s.computedJson !== "string" || !isObj(s.header) || !Array.isArray(s.lines))
    return null;
  if (s.terms !== null && !isObj(s.terms)) return null;
  const h = s.header;
  if (!isObj(h.document) || !isObj(h.supply) || !isObj(h.recipient) || !isObj(h.issuer)) return null;
  if (typeof h.computedSha256 !== "string") return null;
  const i = h.issuer;
  if (!isObj(i.company) || !isObj(i.bank) || !isObj(i.sender) || typeof i.reverseChargeText !== "string")
    return null;
  if (i.signature !== null && !isObj(i.signature)) return null;
  if (i.signatory !== undefined && i.signatory !== false) return null;
  // T10: a present Udyam block has the canonical shape (`{number, category}`, 07-ZC), else the text is not an envelope.
  if (i.company.udyam !== undefined && !isUdyam(i.company.udyam)) return null;
  // M5.2: the optional header keys are absent on an M5.1 envelope; when present they must have their shape (a wrong shape is not an envelope).
  if (h.export !== undefined && !validExport(h.export)) return null;
  if (h.fx !== undefined && !validFx(h.fx)) return null;
  // FX-4 (A5 5): the GST estimate marker, when present, is the literal `true` (the only value the issue path seals); anything else is not an envelope.
  if (
    h.proforma !== undefined &&
    !(
      isObj(h.proforma) &&
      typeof h.proforma.notice === "string" &&
      (h.proforma.gstEstimate === undefined || h.proforma.gstEstimate === true)
    )
  )
    return null;
  if (h.advance !== undefined && !validAdvance(h.advance)) return null;
  // M5.3: a note's request, read back without zod (a wrong shape is not an envelope); a due date is a string or null.
  if (h.noteOf !== undefined && noteOfFromStored(h.noteOf) === null) return null;
  if (h.document.dueDate !== null && typeof h.document.dueDate !== "string") return null;
  if (i.bank.swift !== undefined && i.bank.swift !== null && !isObj(i.bank.swift)) return null;
  if (isObj(h.recipient) && h.recipient.deliveryAddress !== undefined && !isObj(h.recipient.deliveryAddress))
    return null;
  return v as unknown as InvoiceEnvelope;
}

/** The draft a content hash is computed over, from an envelope (the same mapping as db `invoiceDraftOfBundle`). */
export function invoiceDraftOf(e: InvoiceEnvelope): DraftContent {
  const h = e.snapshot.header;
  return {
    type: h.document.type,
    clientId: h.document.clientId,
    contactId: (h.recipient as RecipientSnap).contactId ?? null,
    title: null,
    currency: h.document.currency,
    validityDays: null,
    termsVersionId: null,
    discountKind: e.snapshot.discountKind,
    discountValue: e.snapshot.discountValue,
    exportMode: h.document.exportMode,
    lines: e.snapshot.lines,
    sections: [],
    schedule: [],
    // M5.2 (LD24): the rate typed on the draft is part of its content hash (no key at all when there was none: an M5.1 hash is unchanged).
    ...(h.fx
      ? {
          fx: {
            rateMicros: h.fx.rateMicros,
            date: h.fx.date,
            source: h.fx.source,
            ...(h.fx.noRateDay ? { noRateDay: h.fx.noRateDay } : {}),
          },
        }
      : {}),
    // M5.3 (LD39): a note's request is part of its content hash, exactly as db `noteContentOf` reads it from `header_extras`.
    ...(h.noteOf
      ? {
          note: {
            parentId: h.noteOf.parent.id,
            kind: h.noteOf.kind,
            reasonCode: h.noteOf.reason.code,
            reasonText: h.noteOf.reason.text,
            mode: h.noteOf.request.mode,
            grossMinor: h.noteOf.request.grossMinor ?? null,
            takes: h.noteOf.request.takes,
          },
        }
      : {}),
  };
}

/** The input of the seal, rebuilt from the envelope's header (an object made of its sealed parts only; the M5.2 keys only when the header has them, LD25). */
export const invoiceSnapshotInputOf = (e: InvoiceEnvelope) => {
  const h = e.snapshot.header;
  return {
    document: h.document,
    supply: h.supply,
    recipient: h.recipient,
    issuer: h.issuer as InvoiceIssuerSnap,
    computedSha256: h.computedSha256,
    ...(h.export ? { export: h.export } : {}),
    ...(h.fx ? { fx: h.fx } : {}),
    ...(h.proforma ? { proforma: h.proforma } : {}),
    ...(h.advance ? { advance: h.advance } : {}),
    ...(h.noteOf ? { noteOf: h.noteOf } : {}),
  };
};

/** M5.3: `noteOf` only on a note, of the type's own kind, with one take per line; false for anything else. */
function noteShapeOk(e: InvoiceEnvelope): boolean {
  const n = e.snapshot.header.noteOf;
  if (!isNoteType(e.type)) return n === undefined;
  if (n === undefined) return false;
  return n.kind === noteKindOf(e.type) && n.request.takes.length === e.snapshot.lines.length;
}

/** Recomputes every hash of the envelope. A render never starts from an envelope that fails. */
export async function verifyInvoiceEnvelope(e: InvoiceEnvelope): Promise<InvoiceVerifyResult> {
  const s = e.snapshot;
  const h = s.header;
  if (e.v !== 3 || e.kind !== "invoice") return { ok: false, code: "version" };
  const ref = h.document.termsRef;
  if (
    e.type !== h.document.type ||
    // M5.2: an export invoice without its endorsement block, or a proforma without its notice, is not an envelope to print from (LD33's first line of defence)
    (e.type === "export_invoice" && !h.export) ||
    (e.type === "proforma" && !h.proforma) ||
    // M5.3: a note has its request and no other type does; the request's kind and its lines are the note's own; a credit note has no due date, every other type has one
    !noteShapeOk(e) ||
    (h.document.dueDate === null) !== (e.type === "credit_note") ||
    // T10: the Udyam line is printed on a tax invoice only (owner, 2026-10-31); a block on any other type was never issued that way
    (h.issuer.company.udyam !== undefined && !udyamPrintedOn(e.type)) ||
    (ref === null) !== (s.terms === null) ||
    (ref !== null &&
      s.terms !== null &&
      (ref.id !== s.terms.id || ref.version !== s.terms.version || ref.sha256 !== s.terms.sha256))
  ) {
    return { ok: false, code: "mismatch" };
  }
  if ((await invoiceSnapshotSha256(invoiceSnapshotInputOf(e))) !== e.snapshotSha256) {
    return { ok: false, code: "snapshot_hash" };
  }
  if ((await sha256Hex(s.computedJson)) !== h.computedSha256) return { ok: false, code: "computed_hash" };
  if (s.terms && (await sha256Hex(s.terms.bodyMd)) !== s.terms.sha256)
    return { ok: false, code: "terms_hash" };
  // the frozen extra export note must be the text its SHA-256 was taken from
  const note = h.export?.declarationRef;
  if (note && (await sha256Hex(h.export?.declarationText ?? "")) !== note.sha256)
    return { ok: false, code: "terms_hash" };
  let computed: ComputedDocument;
  try {
    computed = JSON.parse(s.computedJson) as ComputedDocument;
  } catch {
    return { ok: false, code: "computed_json" };
  }
  if ((await contentHash(invoiceDraftOf(e), computed)) !== h.document.contentSha256) {
    return { ok: false, code: "content_hash" };
  }
  return { ok: true };
}

/** The signature bytes a render may embed: only when their SHA-256 is the one frozen in the envelope. */
export async function verifySignatureBytes(e: InvoiceEnvelope, bytes: Uint8Array): Promise<boolean> {
  const ref = e.snapshot.header.issuer.signature;
  if (ref === null) return false;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return hex === ref.sha256;
}
