// The last check before an invoice PDF is rendered (M5.2, LD33; Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)): an export invoice's HTML must carry its FROZEN endorsement, and a
// proforma's its FROZEN notice, each byte for byte as ONE text node. Rule 46's endorsement and the "not a tax invoice" notice are the statutory
// lines of those documents: a layout that drops, rewords or splits one must never reach Browser Run. The check reads the sealed header of the
// envelope (not live settings and not the view), so what is checked is what was issued.
// M5.3 (LD54; Rule 53(1A), Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): a credit or debit note's HTML must carry the FROZEN number of the invoice it is against as ONE text node: a note that
// does not name its invoice is not a document to send.
// T10 (rt2): a tax invoice sealed with a Udyam number must print 07-ZC line 6 as ONE text node (the owner's choice, Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a))).
// T4 (rt2): a credit note, a debit note and an invoice for a payment received are rendered only from an envelope that froze the signature (`signatureMissing`).
import { signatureRequired } from "@techaust/core/invoices";
import { esc } from "./escape.ts";
import type { InvoiceEnvelope } from "./invoice-types.ts";
import { UDYAM_COPY } from "./layout/copy.ts";

export type MissingStatutoryLine = "endorsement" | "notice" | "parent_number" | "udyam";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** True when `html` holds `text` (escaped as the layout escapes it) as the whole content of a text node: between a `>` and the next `<`, with only white space around it. */
export function hasTextNode(html: string, text: string): boolean {
  if (text.length === 0) return false;
  return new RegExp(`>\\s*${escapeRegExp(esc(text))}\\s*<`).test(html);
}

/** The line its type requires (null when it has it, or needs none). */
function missingTypeLine(envelope: InvoiceEnvelope, html: string): MissingStatutoryLine | null {
  const h = envelope.snapshot.header;
  if (envelope.type === "export_invoice") {
    return h.export && hasTextNode(html, h.export.endorsement) ? null : "endorsement";
  }
  if (envelope.type === "proforma") {
    return h.proforma && hasTextNode(html, h.proforma.notice) ? null : "notice";
  }
  // a credit or debit note: the number of its invoice, as sealed. Keyed on the envelope's type, so a note whose sealed header lost its `noteOf` is refused, not waved through.
  if (envelope.type === "credit_note" || envelope.type === "debit_note")
    return h.noteOf && hasTextNode(html, h.noteOf.parent.number) ? null : "parent_number";
  return null;
}

/** The statutory line an invoice's HTML lacks (null when it has every line its envelope requires, or needs none). */
export function missingStatutoryLine(envelope: InvoiceEnvelope, html: string): MissingStatutoryLine | null {
  const typeLine = missingTypeLine(envelope, html);
  if (typeLine !== null) return typeLine;
  // T10: a sealed Udyam number is printed as the one 07-ZC line 6 text node, or the PDF is refused (the envelope check keeps it to tax invoices)
  const udyam = envelope.snapshot.header.issuer.company.udyam;
  if (udyam !== undefined && !hasTextNode(html, UDYAM_COPY.line(udyam.number, udyam.category)))
    return "udyam";
  return null;
}

/**
 * T4 (L4): whether the envelope's type must carry the signature: a credit or debit note, or a tax or export invoice for a payment received (`header.advance` present).
 * Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17). Core `signatureRequired` is the one rule.
 */
export const requiresSignature = (envelope: InvoiceEnvelope): boolean =>
  signatureRequired(envelope.type, envelope.snapshot.header.advance !== undefined);

/**
 * T4 (L4): an envelope that must carry the signature but froze none (no reference, or the switch-off marker): the jobs Worker refuses it (`pdf.refused`, code
 * `signature_required`). Older staging documents issued before the rule are refused the same way unless their PDF is already stored (adopted first).
 */
export function signatureMissing(envelope: InvoiceEnvelope): boolean {
  if (!requiresSignature(envelope)) return false;
  const issuer = envelope.snapshot.header.issuer;
  return issuer.signature === null || issuer.signatory === false;
}
