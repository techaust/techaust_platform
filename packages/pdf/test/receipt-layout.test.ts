// M6.5 (ADM-PAY-09, JOB-PDF-01; run file G8): the designer's receipt page. Every fixture is made as the jobs Worker makes it (core `receiptHeaderOf`, then
// `receiptView`): the contract's test ids, both currencies, ten "Applied to" lines, the credit left as the closing row, the longest list with "and {n} more",
// escaping, the footer, and the forbidden words on the final page (RA-39: never a tax invoice or a voucher; RB-21 (b): no stamp or signature claim either way).
// Invented sample data only.
import { describe, expect, it } from "vitest";
import {
  RECEIPT_LAYOUT_PLACEHOLDER,
  RECEIPT_PDF_LAYOUT_ID,
  type ReceiptLayoutView,
  receiptBody,
  receiptPageCss,
  renderReceiptHtml,
} from "../src/layout/receipt.ts";
import { receiptFixture } from "./fixtures/receipt.ts";

const count = (html: string, testid: string) => html.split(`data-testid="${testid}"`).length - 1;
/** The page's visible words: tags, the CSS and the inline fonts taken out. */
const textOf = (html: string) =>
  (html.split("<body>")[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ");

describe("the receipt page [ADM-PAY-09][JOB-PDF-01]", () => {
  it("is the designed layout, no longer the placeholder", () => {
    expect(RECEIPT_LAYOUT_PLACEHOLDER).toBe(false);
    expect(RECEIPT_PDF_LAYOUT_ID).toBe("receipt-page-1");
  });

  it("an INR transfer on one invoice: title, number, amount on the band, words, one applied line, no credit row", () => {
    const html = renderReceiptHtml(receiptFixture("inr-one"));
    for (const id of ["receipt-title", "receipt-number", "receipt-amount", "receipt-words", "receipt-notice"])
      expect(count(html, id), id).toBe(1);
    expect(count(html, "receipt-applied")).toBe(1);
    expect(count(html, "receipt-credit")).toBe(0);
    expect(count(html, "receipt-more")).toBe(0);
    expect(html).toContain('data-testid="rupee"');
    expect(html).toContain("TH/RCT/2627/0001");
    expect(html).toContain("GSTIN 29AAAAA0000A1Z5");
    // the brand line and the number in the page footer
    expect(html).toContain("@bottom-left");
    expect(html).toContain("billing@example.test");
    expect(html).toContain("Page");
  });

  it("a USD PayPal payment: the dollar sign, the credit left closes the list", () => {
    const html = renderReceiptHtml(receiptFixture("usd-credit"));
    expect(html).toContain('data-testid="currency-symbol"');
    expect(count(html, "receipt-applied")).toBe(1);
    expect(count(html, "receipt-credit")).toBe(1);
    expect(html.indexOf('data-testid="receipt-credit"')).toBeGreaterThan(
      html.indexOf('data-testid="receipt-applied"'),
    );
  });

  it("ten lines and a long name; the longest list stops at 50 with 'and 10 more'", () => {
    expect(count(renderReceiptHtml(receiptFixture("long-ten")), "receipt-applied")).toBe(10);
    const longest = renderReceiptHtml(receiptFixture("longest"));
    expect(count(longest, "receipt-applied")).toBe(50);
    expect(count(longest, "receipt-more")).toBe(1);
    expect(longest).toContain("and 10 more");
  });

  it("nothing applied and nothing left: no Applied to block; no reference: no reference fact; no brand line: no left footer", () => {
    const base = receiptFixture("inr-one");
    const v: ReceiptLayoutView = {
      ...base,
      appliedTo: [],
      appliedMore: 0,
      heldAsCredit: null,
      reference: null,
      footerBrand: undefined,
      logo: "no-such-logo.svg",
      receivedFrom: { name: base.receivedFrom.name, gstin: null },
    };
    const html = renderReceiptHtml(v);
    expect(html).not.toContain("rct-applied");
    expect(html).not.toContain(">Reference<");
    expect(receiptPageCss(v)).not.toContain("@bottom-left");
    expect(html).not.toContain("GSTIN 29");
    // an unknown logo falls back to the colour logo
    expect(html).toContain("<svg");
  });

  it("a credit with nothing applied shows the credit row without the Invoice header", () => {
    const base = receiptFixture("usd-credit");
    const body = receiptBody({ ...base, appliedTo: [], appliedMore: 0 });
    expect(body).toContain('data-testid="receipt-credit"');
    expect(body).not.toContain("<thead>");
  });

  it("escapes every value", () => {
    const base = receiptFixture("inr-one");
    const html = renderReceiptHtml({
      ...base,
      receivedFrom: { name: '<script>alert("x")</script>', gstin: null },
      issuer: { name: "A & B", lines: ["<b>bold</b>"] },
      reference: "<i>",
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("A &amp; B");
  });

  it("forbidden words: never a voucher, a stamp or a signature, no tax line; 'tax invoice' only in the closing 'not a tax invoice' (RA-39, RB-21 (b))", () => {
    for (const name of ["inr-one", "usd-credit", "long-ten", "longest"] as const) {
      const text = textOf(renderReceiptHtml(receiptFixture(name)));
      expect(text, name).not.toMatch(
        /voucher|stamp|signat|signed|authori[sz]ed|IGST|CGST|SGST|HSN|SAC\b|place of supply/i,
      );
      expect(text.match(/tax invoice/gi) ?? [], name).toHaveLength(1);
      expect(text, name).toMatch(/not a tax invoice/i);
    }
  });
});
