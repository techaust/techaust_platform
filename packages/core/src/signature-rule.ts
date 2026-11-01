// The must-be-signed rule (T4, rt2; L1: keyed on the document, never on the checklist), held once (test-hardening item 4a): core's invoice and note blockers,
// the admin issuer block (`issuerOf`) and the PDF integrity check (`@techaust/pdf` `requiresSignature`, which the jobs Worker's refusal uses) all read it. Pure,
// no imports, exported through `@techaust/core/invoices`. The db side keeps pinned copies for the bytes of migration 0055 (`SIGNED_ALWAYS_TYPES_0055` and the
// advance types in the trigger `documents_signature_required`); db tests compare both to these lists.

/**
 * The types that always carry the signature, whatever the checklist's signatory switch says: a credit or debit note (Researched 2026-10-30, Rule 53(1A) CGST Rules
 * (08-C RA-22)). OPEN (08-C RA-22): do Rules 50 and 53 carry Rule 46(q)'s electronic-issue proviso, and does a stored image meet "signature" on an electronic document?
 * The safest reading is built (no CA is engaged): the signature is required. A DSC is out of scope. Pinned by a db test to the 0055 trigger's list.
 */
export const SIGNED_ALWAYS_TYPES = ["credit_note", "debit_note"] as const;

/**
 * The types that carry the signature when they are the invoice for a payment received (`header_extras.advance`; Researched 2026-10-30, s.31(3)(d) CGST Act and
 * Rule 50 CGST Rules (08-C RA-17), the safest reading). Pinned by a db test to the 0055 trigger's advance clause.
 */
export const SIGNED_ADVANCE_TYPES = ["tax_invoice", "export_invoice"] as const;

/**
 * Whether a document must be issued with the signature: a credit or debit note, or a tax or export invoice for a payment received (`header_extras.advance`; Researched
 * 2026-10-30, s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17), the safest reading, docs/13 2026-10-30). Every other invoice keeps the Owner's signatory switch
 * (Researched 2026-10-28, Rule 46(q) proviso CGST Rules (08-C RA-06)). The twin of db `signedIssuerSql` in the freeze WHERE and of the trigger `documents_signature_required`.
 */
export function signatureRequired(type: string, isAdvance: boolean): boolean {
  if ((SIGNED_ALWAYS_TYPES as readonly string[]).includes(type)) return true;
  return isAdvance && (SIGNED_ADVANCE_TYPES as readonly string[]).includes(type);
}
