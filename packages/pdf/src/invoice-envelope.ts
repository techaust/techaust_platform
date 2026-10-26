// The invoice envelope (M5.1 stage B, LD4): build, store, read and verify. Written with `JSON.stringify` in a fixed key order, so the same invoice
// always gives the same bytes (the jobs Worker writes it once and compares a second write byte for byte). The number is NOT in the seal (it is taken
// inside the issue batch after the hash); the envelope pairs it with the seal, and verification recomputes every hash it can from the envelope alone:
//   - snapshotSha256 = core `invoiceSnapshotSha256` of the sealed header (the very function the issue route sealed it with)
//   - header.computedSha256 = sha256(computedJson)
//   - header.document.termsRef and the footer notes agree, and sha256(notes) = termsRef.sha256
//   - header.document.contentSha256 = core `contentHash` of the lines, the discount and the computed result (the issue route's own)
// A signature image is checked separately (`verifySignatureBytes`): the envelope holds only its key, SHA-256 and mime (LD11).
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { invoiceSnapshotSha256 } from "@techaust/core/invoices";
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
  };
}

/** The input of the seal, rebuilt from the envelope's header (an object made of its sealed parts only). */
export const invoiceSnapshotInputOf = (e: InvoiceEnvelope) => {
  const h = e.snapshot.header;
  return {
    document: h.document,
    supply: h.supply,
    recipient: h.recipient,
    issuer: h.issuer as InvoiceIssuerSnap,
    computedSha256: h.computedSha256,
  };
};

/** Recomputes every hash of the envelope. A render never starts from an envelope that fails. */
export async function verifyInvoiceEnvelope(e: InvoiceEnvelope): Promise<InvoiceVerifyResult> {
  const s = e.snapshot;
  const h = s.header;
  if (e.v !== 3 || e.kind !== "invoice") return { ok: false, code: "version" };
  const ref = h.document.termsRef;
  if (
    e.type !== h.document.type ||
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
