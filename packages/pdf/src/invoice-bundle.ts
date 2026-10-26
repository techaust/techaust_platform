// The envelope of an ISSUED invoice, made from the rows that were read (the jobs snapshot step; also what the admin test of the real issue path
// calls). The seal is checked with the ISSUE ROUTE'S OWN functions (`@techaust/db/documents`: `invoiceSealPartsOfBundle`, `invoiceSealOf`,
// `invoiceContentHashOfBundle`), not with a copy: a row that does not reproduce its `snapshot_sha256` and `content_sha256` is refused, and nothing is
// written to R2 from it. The number is outside the seal, so it is read from the row and paired with it here (LD4).
import { INVOICE_SERIES_OF, isInvoiceFlowType } from "@techaust/core/invoices";
import { fyLabelOfToken } from "@techaust/core/pdf-jobs";
import {
  type DocumentBundle,
  invoiceContentHashOfBundle,
  invoiceDraftOfBundle,
  invoiceSealOf,
  invoiceSealPartsOfBundle,
  type TermsRow,
} from "@techaust/db/documents";
import { sha256Hex } from "./hash.ts";
import { buildInvoiceEnvelope } from "./invoice-envelope.ts";
import type { InvoiceEnvelope, InvoiceHeader } from "./invoice-types.ts";

export type InvoiceBundleRefusal =
  /** Not an invoice-family document (the proposal path is `envelopeOfBundle`). */
  | "unsupported_type"
  /** Not frozen, or a frozen block, number, series or FY is missing, or the number is not the series' own. */
  | "not_issued"
  /** The rows do not reproduce `snapshot_sha256`. */
  | "snapshot_hash"
  /** The rows do not reproduce `content_sha256`. */
  | "content_hash"
  /** The notes text does not match its stored SHA-256. */
  | "terms_hash";

export type InvoiceBundleResult =
  | { ok: true; envelope: InvoiceEnvelope }
  | { ok: false; code: InvoiceBundleRefusal };

/** The envelope of a loaded, issued invoice, or the reason it cannot be made. A void invoice is rendered from its issued snapshot: nothing here reads `voided_at` (LD7). */
export async function invoiceEnvelopeOfBundle(b: DocumentBundle<TermsRow>): Promise<InvoiceBundleResult> {
  const d = b.document;
  if (!isInvoiceFlowType(d.type)) return { ok: false, code: "unsupported_type" };
  const parts = invoiceSealPartsOfBundle(b);
  const contentHash = invoiceContentHashOfBundle(b);
  const fy = d.fy === null ? null : fyLabelOfToken(d.fy);
  const terms = b.terms;
  if (
    !parts ||
    !contentHash ||
    fy === null ||
    d.series === null ||
    d.series !== INVOICE_SERIES_OF[d.type] ||
    d.number === null ||
    d.number_display === null ||
    d.frozen_at === null ||
    d.snapshot_sha256 === null ||
    (d.terms_version_id !== null && !terms)
  ) {
    return { ok: false, code: "not_issued" };
  }
  const seal = await invoiceSealOf(parts);
  if (seal.snapshotSha256 !== d.snapshot_sha256) return { ok: false, code: "snapshot_hash" };
  if ((await contentHash) !== d.content_sha256) return { ok: false, code: "content_hash" };
  if (terms && (await sha256Hex(terms.body_md)) !== terms.sha256) return { ok: false, code: "terms_hash" };
  const draft = invoiceDraftOfBundle(b);
  return {
    ok: true,
    envelope: buildInvoiceEnvelope({
      documentId: d.id,
      type: d.type,
      number: d.number,
      numberDisplay: d.number_display,
      series: d.series,
      fy,
      issuedAt: d.frozen_at,
      snapshotSha256: seal.snapshotSha256,
      snapshot: {
        header: seal.input as unknown as InvoiceHeader,
        computedJson: seal.computedJson,
        discountKind: draft.discountKind,
        discountValue: draft.discountValue,
        lines: draft.lines.map((l) => ({ ...l })),
        terms: terms
          ? { id: terms.id, version: terms.version, sha256: terms.sha256, bodyMd: terms.body_md }
          : null,
      },
    }),
  };
}
