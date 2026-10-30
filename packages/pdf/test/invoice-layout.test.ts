// The tax invoice layout (M5.1 phase 2: layout/invoice.ts; docs/06 §7.3; words 07-R §6) and the skeleton it replaced for tax invoices only.
// Every Rule 46 field the view carries is printed, the reverse-charge line exactly as frozen. Researched 2026-10-28, Rules 46(p), 50 and 51 CGST Rules (08-C RA-26) for every rule printed.
import { placeOfSupplyLabel } from "@techaust/core/pdf-jobs";
import { describe, expect, it } from "vitest";
import type { InvoiceEnvelope, InvoiceView } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { INVOICE_PDF_COPY } from "../src/layout/copy.ts";
import { bankRows, splitPlaceOfSupply, TAX_INVOICE_CSS } from "../src/layout/invoice.ts";
import { pdfOptionsFor } from "../src/options.ts";
import { DOCUMENT_CSP, isInvoiceView, renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import {
  buildInvoiceLayoutFixture,
  INVOICE_LAYOUT_FIXTURES,
  type InvoiceLayoutFixture,
  sampleSignatureOf,
} from "./fixtures/invoice-layout.ts";

/** The house style writes a percent with a no-break space before the sign (view.ts `pct`). */
const nb = (t: string) => t.replace(" %", " %");
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
const body = (h: string) => h.slice(h.indexOf("<body>"));
/** The HTML between two markers (the first one included). */
const between = (h: string, from: string, to: string) =>
  h.slice(h.indexOf(from), h.indexOf(to, h.indexOf(from) + 1));

async function viewOf(name: InvoiceLayoutFixture, withSignature = true): Promise<InvoiceView> {
  const { envelope, signature } = await buildInvoiceLayoutFixture(name);
  return toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, withSignature ? { signature } : {});
}
const htmlOf = async (name: InvoiceLayoutFixture, withSignature = true) =>
  renderDocumentHtml(await viewOf(name, withSignature));

describe("the tax invoice layout prints every Rule 46 field the view carries", () => {
  it("an intra-state invoice: supplier, number, dates, recipient with GSTIN and State, place of supply with its code, lines, CGST and SGST per head, words, reverse charge, copy mark, bank, notes, signatory", async () => {
    const h = body(await htmlOf("intra"));
    for (const must of [
      // (a) the supplier
      "TecHaust Technologies",
      "Proprietor: Sample Proprietor",
      "1 Sample Supplier Road, Balurghat, West Bengal 733101",
      "Principal place of business: 2 Sample Office Lane, Balurghat",
      '<span class="keep">GSTIN 19ABCDE1234F1ZX</span>',
      // (b), (c) and the due date
      ">Invoice number<",
      "TH/INV/2627/0012",
      "<dt>Invoice date</dt><dd>28 Oct 26</dd>",
      "<dt>Due date</dt><dd>04 Nov 26</dd>",
      // (d), (e) the recipient
      ">Billed to<",
      "Sample Client",
      "Sample Client Private Limited",
      "1 Sample Road",
      "<dt>GSTIN</dt><dd>19ABCDE1234F1ZX</dd>",
      "<dt>State</dt><dd>West Bengal (19)</dd>",
      "Sample Contact",
      // (n) the place of supply with its State code
      "<dt>Place of supply</dt><dd>West Bengal</dd>",
      "<dt>State code</dt><dd>19</dd>",
      // (g), (h), quantity and unit, (j), (k)
      '<td class="c-sac">998314</td>',
      '<td class="c-sac">998315</td>',
      "Sample design work",
      "Two sample screens and their states",
      '1.5 <span class="unit">days</span>',
      ">Discount<",
      ">10 %<",
      ">Taxable value<",
      // (l), (m) per head in the tax summary
      ">Tax summary<",
      '<th scope="colgroup" colspan="2" class="inv-head">CGST</th>',
      '<th scope="colgroup" colspan="2" class="inv-head">SGST</th>',
      ">Rate<",
      ">Amount<",
      ">9 %<",
      ">Round-off<",
      "Amount in words: Rupees",
      // (p), Rule 48(2), (q)
      '<p class="inv-rc" data-testid="reverse-charge">Tax payable on reverse charge: No</p>',
      '<p class="inv-copy" data-testid="copy-label">ORIGINAL FOR RECIPIENT</p>',
      "For Sample Proprietor",
      ">Balance due<",
      'data-testid="signatory">Authorised signatory<',
      // paying, the notes, the last line
      "How to pay",
      "Bank transfer (NEFT, RTGS or IMPS) to:",
      "<dt>Account name</dt><dd>Sample Proprietor</dd>",
      "<dt>Account number</dt><dd>SAMPLE0001234567</dd>",
      "<dt>IFSC</dt><dd>SAMP0000001</dd>",
      "<dt>Bank and branch</dt><dd>Sample Bank, Sample Branch, Balurghat</dd>",
      "Please quote TH/INV/2627/0012 as the payment reference.",
      "Notes, version 2",
      "Sample notes pinned at issue.",
      'data-testid="integrity"',
      'data-testid="total"',
      'data-testid="rupee"',
    ])
      expect(h, must).toContain(/>[0-9.]+ %</.test(must) ? nb(must) : must);
    expect(h).not.toContain("IGST");
    expect(h).toContain('class="doc doc--invoice doc--tax-invoice"');
    expect(h).toContain(`<h1 class="masthead__title">${INVOICE_PDF_COPY.title}</h1>`);
  });

  it("a registration line of parts never leaves a separator dangling: each part is whole on its own line, with no ' · ' between them (re-check)", async () => {
    const h = body(await htmlOf("intra"));
    expect(h).toContain(
      '<span class="keep">GSTIN 19ABCDE1234F1ZX</span><br><span class="keep">State West Bengal (19)</span>',
    );
    expect(h).not.toContain("</span> · <span");
    expect(h).not.toMatch(/ · <\/p>/);
  });

  it("an inter-state invoice prints IGST 18 % under its own head and neither CGST nor SGST; no line discount means no discount column", async () => {
    const h = body(await htmlOf("inter"));
    expect(h).toContain('<th scope="colgroup" colspan="2" class="inv-head">IGST</th>');
    expect(h).toContain(nb(">18 %<"));
    expect(h).toContain("<dt>State</dt><dd>Maharashtra (27)</dd>");
    expect(h).toContain("<dt>Place of supply</dt><dd>Maharashtra</dd>");
    expect(h).toContain("<dt>State code</dt><dd>27</dd>");
    expect(h).not.toContain("CGST");
    expect(h).not.toContain("SGST");
    expect(h).not.toContain(">Discount<");
  });

  it("the reverse-charge line is the text frozen at issue, never a constant", async () => {
    const { envelope } = await buildInvoiceLayoutFixture("short");
    const e = clone(envelope);
    e.snapshot.header.issuer.reverseChargeText = "Sample frozen statement: Yes";
    const h = body(renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG)));
    expect(h).toContain('data-testid="reverse-charge">Sample frozen statement: Yes</p>');
    expect(h).not.toContain("Tax payable on reverse charge: No");
  });

  it("with bank.inr = null and signature = null nothing is invented: no bank lines, no image, the reference and the signatory stay", async () => {
    const h = body(await htmlOf("bare"));
    expect(h).toContain("How to pay");
    expect(h).toContain("Please quote TH/INV/2627/0012 as the payment reference.");
    expect(h).not.toContain("Bank transfer");
    expect(h).not.toContain("Account number");
    expect(h).not.toContain("<img");
    expect(h).toContain('class="inv-sign__space"');
    expect(h).toContain('data-testid="signatory">Authorised signatory<');
    expect(h).not.toContain("Notes, version");
    // an unregistered recipient: no GSTIN under "Billed to", but its State
    const billedTo = between(h, ">Billed to<", "party--doc");
    expect(billedTo).toContain("Sample Unregistered Person");
    expect(billedTo).toContain("<dt>State</dt><dd>West Bengal (19)</dd>");
    expect(billedTo).not.toContain("GSTIN");
    // a supplier without legal name, address or GSTIN prints only what it has
    const from = between(h, ">From<", ">Billed to<");
    expect(from).not.toContain("Proprietor");
    expect(from).not.toContain("GSTIN");
  });

  it("a signature image appears only when the caller hands in verified bytes; the signatory line is always there", async () => {
    const withSig = body(await htmlOf("signed"));
    const sig = sampleSignatureOf("signed");
    expect(sig).not.toBeNull();
    expect(withSig).toContain(
      '<img data-testid="signature" class="inv-sign__img" alt="" src="data:image/png;base64,',
    );
    expect(withSig).toContain(sig?.base64.slice(0, 40));
    const without = body(await htmlOf("signed", false));
    expect(without).not.toContain("<img");
    expect(without).toContain('data-testid="signatory"');
  });

  it("the long fixture prints all 40 lines with one header row set that repeats on each page (print.css)", async () => {
    const h = body(await htmlOf("long"));
    expect(h.match(/<tr><td class="c-n num">/g)).toHaveLength(40);
    expect(h.match(/<thead>/g)).toHaveLength(2); // the items table and the tax summary
    expect(h).toContain("Sample line 40:");
  });

  it("long names and an unbroken word are printed whole (the CSS wraps them; nothing is cut)", async () => {
    const h = body(await htmlOf("long-names"));
    expect(h).toContain(
      "Sample Extraordinarily Long Named Technology and Consultancy Services Private Limited",
    );
    expect(h).toContain("Sample_unbroken_identifier_without_spaces_that_must_still_wrap_inside_the_cell");
    expect(h).toContain("Sample Contact With An Unusually Long Full Name And Designation");
  });
});

describe("the view's legal name, portal address and balance due", () => {
  it("the portal line is left out when the view has no address; with one it names it", async () => {
    const view = await viewOf("short");
    expect(view.portalLink).toBeNull();
    expect(body(renderDocumentHtml(view))).not.toContain("client portal");
    const { envelope } = await buildInvoiceLayoutFixture("short");
    const withPortal = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { portalLink: "portal.example.test" });
    expect(withPortal.portalLink).toBe("portal.example.test");
    expect(body(renderDocumentHtml(withPortal))).toContain(
      'Or pay in the client portal: <span class="accept__link">portal.example.test</span>',
    );
  });

  it("'For {legal name}' uses the frozen legal name, else the trade name", async () => {
    const view = await viewOf("short");
    expect(view.supplier.legalName).toBe("Sample Proprietor");
    expect(body(renderDocumentHtml(view))).toContain(">For Sample Proprietor<");
    const bare = await viewOf("bare");
    expect(bare.supplier.legalName).toBeNull();
    expect(body(renderDocumentHtml(bare))).toContain(">For TecHaust Technologies<");
    const blank = { ...view, supplier: { ...view.supplier, legalName: " " } } as InvoiceView;
    expect(body(renderDocumentHtml(blank))).toContain(">For TecHaust Technologies<");
  });

  it("'Balance due' equals the total at issue and prints under it", async () => {
    const view = await viewOf("intra");
    const total = view.totals.find((t) => t.key === "total")?.value;
    expect(view.balanceDue).toBe(total);
    const h = body(renderDocumentHtml(view));
    expect(h).toContain(">Balance due<");
    expect(h).toContain(`data-testid="balance-due">${view.balanceDue}<`);
    expect(h.indexOf('data-testid="total"')).toBeLessThan(h.indexOf('data-testid="balance-due"'));
  });
});

describe("the layout's formatting helpers", () => {
  it("bankRows: 07-R's labels, 'Bank' and 'Branch' as one 'Bank and branch', anything else as given", () => {
    expect(
      bankRows([
        { label: "Account name", value: "A" },
        { label: "Account number", value: "1" },
        { label: "IFSC", value: "I" },
        { label: "Bank", value: "B" },
        { label: "Branch", value: "Br" },
        { label: "Sample other", value: "X" },
      ]),
    ).toEqual([
      { label: "Account name", value: "A" },
      { label: "Account number", value: "1" },
      { label: "IFSC", value: "I" },
      { label: "Bank and branch", value: "B, Br" },
      { label: "Sample other", value: "X" },
    ]);
    expect(bankRows([{ label: "Bank", value: "B" }])).toEqual([{ label: "Bank and branch", value: "B" }]);
    expect(bankRows([{ label: "Branch", value: "" }])).toEqual([]);
  });

  it("splitPlaceOfSupply: a State with its two-digit code splits; anything else stays whole", () => {
    expect(splitPlaceOfSupply("West Bengal (19)")).toEqual({ name: "West Bengal", code: "19" });
    expect(splitPlaceOfSupply("Andaman and Nicobar Islands (35)")).toEqual({
      name: "Andaman and Nicobar Islands",
      code: "35",
    });
    expect(splitPlaceOfSupply("Outside India")).toEqual({
      name: "Outside India",
      code: null,
    });
    expect(splitPlaceOfSupply("97")).toEqual({ name: "97", code: null });
  });

  it("splitPlaceOfSupply on the real labels (core placeOfSupplyLabel): a State splits, 96 and 97 never do (review M1)", () => {
    expect(splitPlaceOfSupply(placeOfSupplyLabel("19", "intra"))).toEqual({
      name: "West Bengal",
      code: "19",
    });
    expect(splitPlaceOfSupply(placeOfSupplyLabel("27", "inter"))).toEqual({
      name: "Maharashtra",
      code: "27",
    });
    // 96 is no State: an overseas supply's label stays whole, as 07-S §1 prints it
    for (const supply of ["export_lut", "export_igst"]) {
      const label = placeOfSupplyLabel("96", supply);
      expect(label).toBe("Outside India (96)");
      expect(splitPlaceOfSupply(label)).toEqual({ name: "Outside India (96)", code: null });
    }
    expect(splitPlaceOfSupply(placeOfSupplyLabel("96", "inter"))).toEqual({
      name: "Outside India (96)",
      code: null,
    });
    // 97 is in the master as "Other Territory", not a State: whole too
    expect(splitPlaceOfSupply(placeOfSupplyLabel("97", "inter"))).toEqual({
      name: "Other Territory (97)",
      code: null,
    });
    // a two-digit number that is no code at all stays whole
    expect(splitPlaceOfSupply("Somewhere (99)")).toEqual({ name: "Somewhere (99)", code: null });
  });

  it("every rule of the layout's CSS is scoped to .doc--tax-invoice, so the skeleton and the proposal never change", () => {
    const selectors = TAX_INVOICE_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((r) => r.split("{")[0]?.trim() ?? "")
      .filter((s) => s !== "");
    expect(selectors.length).toBeGreaterThan(20);
    for (const s of selectors)
      for (const part of s.split(",")) expect(part.trim(), s).toMatch(/^\.doc--tax-invoice\b/);
  });
});

describe("the page around the layout", () => {
  it.each(INVOICE_LAYOUT_FIXTURES)(
    "%s is self-contained: the CSP, no script, no external URL; the footer and page numbers are in the page rules",
    async (name) => {
      const view = await viewOf(name);
      const full = renderDocumentHtml(view);
      expect(full).toContain(DOCUMENT_CSP);
      expect(full).not.toMatch(/<script|<link|@import|(?:src|href)=["']?https?:|url\(["']?https?:/i);
      expect(full).toContain("@bottom-left");
      expect(full).toContain(view.numberDisplay);
      expect(full.match(/<h1/g)).toHaveLength(1);
    },
  );

  it("the title is the metadata 06 §7.1 asks for", async () => {
    expect(await htmlOf("short")).toContain("<title>Tax Invoice TH/INV/2627/0012 – Sample Client</title>");
  });

  it("escapes what a person typed: a script in a description or a name never reaches the page as markup", async () => {
    const { envelope } = await buildInvoiceLayoutFixture("intra");
    const e = clone(envelope);
    (e.snapshot.lines[0] as { description: string }).description = '<script>alert("x")</script>';
    (e.snapshot.header.recipient as { legalName: string }).legalName = "A & B <b>Ltd</b>";
    (e.snapshot.header.recipient as { displayName?: string }).displayName = "";
    const h = renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG));
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("A &amp; B &lt;b&gt;Ltd&lt;/b&gt;");
  });

  it("renderDocumentHtml tells an invoice view from a proposal's; the PDF options are the same for both", async () => {
    const view = await viewOf("intra");
    expect(isInvoiceView(view)).toBe(true);
    expect(pdfOptionsFor(view)).toMatchObject({ format: "a4", tagged: true });
  });

  // Changed on purpose (M5.3): the credit and debit notes moved to the layout too, so the skeleton is left for a type the layout does not know.
  it("a type the layout does not know keeps the plain skeleton (M5.2 moved the export invoice and the proforma, M5.3 the notes)", async () => {
    const view = {
      ...(await viewOf("intra")),
      type: "sample_unknown_type",
      docLabel: "Credit note",
    } as InvoiceView;
    const h = body(renderDocumentHtml(view));
    expect(h).toContain('<div class="doc doc--invoice">');
    expect(h).not.toContain("doc--tax-invoice");
    expect(h).toContain(">Credit note<");
    expect(h).toContain('data-testid="reverse-charge"');
    // the skeleton prints the copy mark only when the view sets one: no empty paragraph
    const none = body(renderDocumentHtml({ ...view, copyLabel: null }));
    expect(none).not.toContain('data-testid="copy-label"');
  });

  it.each(["inter", "bare", "signed"] as const)(
    "the skeleton still prints %s whole (heads by supply type, no invented bank, the signature)",
    async (name) => {
      const view = { ...(await viewOf(name)), type: "sample_unknown_type" } as InvoiceView;
      const h = body(renderDocumentHtml(view));
      expect(h).toContain('<div class="doc doc--invoice">');
      expect(h).toContain('data-testid="signatory"');
      if (name === "inter") expect(h).toContain(">IGST %<");
      if (name === "bare") expect(h).not.toContain("Account number");
      if (name === "signed") expect(h).toContain('data-testid="signature"');
    },
  );
});
