// Pure SQL text of the tax rules that both the issue statements (`issue.ts`, a Worker module) and the generated triggers (`triggers.ts`, also read by the
// Node-only script `scripts/write-triggers.ts`) use. No D1 types and no imports, so either side can take it. `issue.ts` re-exports every name.

/** The first IST day a credit note for "Discount after sale" may be dated (core `DISCOUNT_AFTER_SALE_FROM`: a test compares the two; Researched 2026-10-28, 08-C RA-02). */
export const DISCOUNT_AFTER_SALE_FROM_SQL = "2026-11-01";

/**
 * Q37: a letter of undertaking with an ARN is saved in the `tax` setting for the FY token `?FY`: a `luts` list entry of that FY, or the one legacy `lut {arn, fy}`
 * of M3 of that FY, each with an ARN not blank once its spaces are trimmed. The pure twins are core `lutFor(fy, lutsOf(tax))` (export invoice and advance) and
 * core `lutForFy` (a debit note; the same rule), and both are STRICTER than this in one case, failing closed: they count the legacy `lut` only when
 * `legacyLutFate` folds it, so a legacy ARN the list would refuse (or one a full list leaves out) is refused by the blocker before this would pass it (a db test,
 * `note-rules-rt1.test.ts`, pins that core never allows what this refuses). Used inside a freeze WHERE, so a LUT removed between the read and the freeze refuses
 * the batch; and, with `?FY` replaced by `fyTokenOfDateSql` of the receipt day, by the trigger `documents_advance_lut_fy` (0050) and of the note's issue day by
 * `documents_debit_note_lut_fy` (0054).
 */
export const LUT_FOR_FY_SQL = `EXISTS (SELECT 1 FROM settings ts WHERE ts.key = 'tax' AND (
           EXISTS (SELECT 1 FROM json_each(ts.value, '$.luts') l WHERE json_extract(l.value, '$.fy') = ?FY AND trim(coalesce(json_extract(l.value, '$.arn'), '')) <> '')
           OR (json_extract(ts.value, '$.lut.fy') = ?FY AND trim(coalesce(json_extract(ts.value, '$.lut.arn'), '')) <> '')))`;

/**
 * FX-4 (full audit A5 11): a tax-only debit note ("Tax charged too low", Researched 2026-10-28, s.34(3) CGST Act (08-C RA-22); or any debit note with a taxable value of
 * nil) carries no round-off: its total is exactly its tax, in its own currency and in its INR view (`computed.inr.roundOffMinor`). True when the row `n` (a table name or
 * `NEW`) may freeze; every other document passes. The twin of core `taxOnlyDebitNote` (which never rounds); used by the note freeze's WHERE (`noteIssueTail`) and by the
 * trigger `documents_tax_only_note_exact` (0052). OPEN (08-C RA-33): may a tax-only debit note's total be rounded to the nearest rupee, and in which direction? Not
 * rounding is the engine's existing "none" mode: no direction is invented and the total is never below the tax.
 */
export const taxOnlyNoteExactSql = (n: string): string =>
  `(${n}.type IS NOT 'debit_note' OR (json_extract(${n}.header_extras, '$.noteOf.reason.code') IS NOT 'tax_charged_too_low' AND ${n}.taxable_minor IS NOT 0) OR (${n}.taxable_minor IS 0 AND ${n}.round_off_minor IS 0 AND ${n}.total_minor IS ${n}.cgst_minor + ${n}.sgst_minor + ${n}.igst_minor AND coalesce(json_extract(${n}.computed, '$.inr.roundOffMinor'), 0) IS 0))`;

/**
 * T4 (rt2): an issuer block (`issuer`, an SQL expression holding its JSON: a bound parameter or `NEW.issuer`) that carries the signature: a signature reference
 * with its SHA-256, and no `signatory` key (the switch-off marker never appears on a document that must be signed). The twin of core `signatureRequired` with a saved
 * signature; used by the note and advance freeze WHEREs (`issue.ts`) and the trigger `documents_signature_required` (0055). Researched 2026-10-30, Rule 53(1A) CGST
 * Rules (08-C RA-22) for notes; s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17) for the invoice for a payment received.
 */
export const signedIssuerSql = (issuer: string): string =>
  `(json_extract(${issuer}, '$.signature.sha256') IS NOT NULL AND json_type(${issuer}, '$.signatory') IS NULL)`;

/**
 * The FY token ("2627") of an ISO date given as an SQL expression (`date`), the twin of core `fyOfDate(...).token` (1 April to 31 March; a test compares the
 * two day by day). Used by the trigger `documents_advance_lut_fy` (0050), which has only the receipt day to go on; the advance freeze binds the token.
 */
export const fyTokenOfDateSql = (date: string): string =>
  `(CASE WHEN CAST(substr(${date}, 6, 2) AS INTEGER) >= 4 THEN substr(${date}, 3, 2) || printf('%02d', (CAST(substr(${date}, 3, 2) AS INTEGER) + 1) % 100) ELSE printf('%02d', (CAST(substr(${date}, 3, 2) AS INTEGER) + 99) % 100) || substr(${date}, 3, 2) END)`;

/**
 * ADM-INV-10 (owner, 2026-10-30, docs/13; runs/proforma-withdraw L1): the document `a` (a table alias or `NEW`/`OLD`) reached the client: it was opened
 * in the portal (`viewed_at`) or emailed (any `document_sends` row). The withdraw route's freeze WHERE and the readers of a withdrawn proforma use it.
 */
export const proformaDeliveredSql = (a: string): string =>
  `(${a}.viewed_at IS NOT NULL OR EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = ${a}.id))`;

/**
 * A withdrawn proforma: a void proforma that had reached the client (the twin of core `isWithdrawn`; a db test compares the two). Unambiguous because
 * a delivered proforma reaches `void` only through the withdraw route (the void route refuses a send row or a view, and so does trigger
 * `documents_viewed_no_void`); triggers `documents_void_no_view` and `document_sends_not_void` (0056) keep the facts from changing after the void.
 */
export const withdrawnSql = (a: string): string =>
  `(${a}.type = 'proforma' AND ${a}.status = 'void' AND ${proformaDeliveredSql(a)})`;
