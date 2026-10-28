// 07-W 5.6 (08-C RA-06): with the checklist's "Authorised signatory" off at issue, the frozen issuer says so (`signatory: false`) and the PDF leaves the whole
// signature block out ("For {company}", the image, "Authorised signatory"). An envelope without the key (every earlier one) prints the block as before.
import { describe, expect, it } from "vitest";
import { parseInvoiceEnvelope } from "../src/invoice-envelope.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildInvoiceLayoutFixture, INVOICE_LAYOUT_FIXTURES } from "./fixtures/invoice-layout.ts";

const off = (e: InvoiceEnvelope): InvoiceEnvelope => {
  const c = JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
  c.snapshot.header.issuer.signatory = false;
  c.snapshot.header.issuer.signature = null;
  return c;
};

describe("signatory switched off at issue", () => {
  for (const name of INVOICE_LAYOUT_FIXTURES) {
    it(`${name}: no signature block, with or without a signature image handed in`, async () => {
      const { envelope, signature } = await buildInvoiceLayoutFixture(name);
      const on = renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature }));
      expect(on).toContain('data-testid="signatory"');
      expect(on).toContain("Authorised signatory");
      const view = toInvoiceView(off(envelope), DEFAULT_VIEW_CONFIG, { signature });
      expect(view.showSignatory).toBe(false);
      const full = renderDocumentHtml(view);
      const html = full.slice(full.indexOf("<body>"));
      expect(html).not.toContain("Authorised signatory");
      expect(html).not.toContain('data-testid="signatory"');
      expect(html).not.toContain('data-testid="signature"');
      expect(html).not.toContain("inv-sign__for");
      expect(html).not.toMatch(/>For [^<]*</);
    });
  }

  it("an envelope without the key shows the block; the key survives a parse, any other value is not an envelope", async () => {
    const { envelope } = await buildInvoiceLayoutFixture("short");
    expect(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, {}).showSignatory).toBe(true);
    const parsed = parseInvoiceEnvelope(JSON.stringify(off(envelope)));
    expect(parsed?.snapshot.header.issuer.signatory).toBe(false);
    const bad = JSON.parse(JSON.stringify(envelope));
    bad.snapshot.header.issuer.signatory = true;
    expect(parseInvoiceEnvelope(JSON.stringify(bad))).toBeNull();
  });
});
