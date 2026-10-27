// The last check before an invoice PDF is rendered (M5.2, LD33; VERIFY WITH CA/LEGAL): an export invoice's HTML must carry its FROZEN endorsement, and a
// proforma's its FROZEN notice, each byte for byte as ONE text node. Rule 46's endorsement and the "not a tax invoice" notice are the statutory
// lines of those documents: a layout that drops, rewords or splits one must never reach Browser Run. The check reads the sealed header of the
// envelope (not live settings and not the view), so what is checked is what was issued.
import { esc } from "./escape.ts";
import type { InvoiceEnvelope } from "./invoice-types.ts";

export type MissingStatutoryLine = "endorsement" | "notice";

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
  return null;
}
