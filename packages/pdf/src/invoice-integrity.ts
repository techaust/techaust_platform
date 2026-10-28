// The last check before an invoice PDF is rendered (M5.2, LD33; Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)): an export invoice's HTML must carry its FROZEN endorsement, and a
// proforma's its FROZEN notice, each byte for byte as ONE text node. Rule 46's endorsement and the "not a tax invoice" notice are the statutory
// lines of those documents: a layout that drops, rewords or splits one must never reach Browser Run. The check reads the sealed header of the
// envelope (not live settings and not the view), so what is checked is what was issued.
// M5.3 (LD54; Rule 53(1A), Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): a credit or debit note's HTML must carry the FROZEN number of the invoice it is against as ONE text node: a note that
// does not name its invoice is not a document to send.
import { esc } from "./escape.ts";
import type { InvoiceEnvelope } from "./invoice-types.ts";

export type MissingStatutoryLine = "endorsement" | "notice" | "parent_number";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** True when `html` holds `text` (escaped as the layout escapes it) as the whole content of a text node: between a `>` and the next `<`, with only white space around it. */
export function hasTextNode(html: string, text: string): boolean {
  if (text.length === 0) return false;
  return new RegExp(`>\\s*${escapeRegExp(esc(text))}\\s*<`).test(html);
}

/** The statutory line an invoice's HTML lacks (null when it has the one its type requires, or needs none). */
export function missingStatutoryLine(envelope: InvoiceEnvelope, html: string): MissingStatutoryLine | null {
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
