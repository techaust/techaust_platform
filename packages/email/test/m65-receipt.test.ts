// M6.5 (ADM-MAIL-01, ADM-PAY-09; run file D, L5, L41): the `receipt.sent` email in the house layout: 07-ZO lines 11 and 12 (marked "[Placeholder]" until the
// owner approves 07-ZO), the receipt's three facts under the PDF's labels, the portal button only without the PDF, from billing@; and the forbidden words
// (RA-39: never a tax invoice or a voucher; RB-21 (b): no stamp or signature claim either way). Invented sample data.
import { APPROVED_07ZO, RECEIPT_COPY, RECEIPT_EMAIL_COPY } from "@techaust/core/copy-zo";
import { describe, expect, it } from "vitest";
import { renderEmail } from "../src/index.ts";
import { RECEIPT_PORTAL_BUTTON, RECEIPT_SENT_KEYS, receiptSent } from "../src/receipts.ts";

const opts = { assetBase: "https://example.test/email" };
const data = (attached: "0" | "1") => ({
  number: "TH/RCT/2627/0001",
  amount: "₹11,800.00",
  date: "2 Nov 2026",
  attached,
  url: "https://portal.example.test/invoices",
});

describe("receipt.sent [ADM-MAIL-01][ADM-PAY-09]", () => {
  it("with the PDF attached: line 12's first sentence, the three facts, no portal button", () => {
    const r = receiptSent(data("1"), opts);
    expect(r.subject).toContain("Receipt TH/RCT/2627/0001 for your payment of ₹11,800.00");
    expect(r.text).toContain(
      "Thank you. We received ₹11,800.00 on 2 Nov 2026. Your receipt TH/RCT/2627/0001 is attached.",
    );
    expect(r.text).toContain("Receipt number: ");
    expect(r.text).toContain("Amount received: ");
    expect(r.text).toContain("Received on: ");
    expect(r.html).not.toContain(RECEIPT_PORTAL_BUTTON);
    expect(r.text).not.toContain("https://portal.example.test/invoices");
  });

  it("without the PDF: the portal sentence and the button, with the plain link in the text twin", () => {
    const r = receiptSent(data("0"), opts);
    expect(r.text).toContain("You can download receipt TH/RCT/2627/0001 from your client portal.");
    expect(r.html).toContain(RECEIPT_PORTAL_BUTTON);
    expect(r.text).toContain(`${RECEIPT_PORTAL_BUTTON}: https://portal.example.test/invoices`);
  });

  it("is marked until the owner approves 07-ZO", () => {
    const r = receiptSent(data("1"), opts);
    expect(r.subject.startsWith("[Placeholder]")).toBe(!APPROVED_07ZO);
    expect(RECEIPT_EMAIL_COPY.closing.startsWith("[Placeholder]")).toBe(!APPROVED_07ZO);
    expect(RECEIPT_COPY.appliedMore(3).startsWith("[Placeholder]")).toBe(!APPROVED_07ZO);
  });

  it("ends with 07-ZO line 12b, in the HTML and the text, after the portal button when there is one", () => {
    for (const a of ["0", "1"] as const) {
      const r = receiptSent(data(a), opts);
      expect(r.text).toContain("Questions? Just reply to this email.");
      // the last paragraph of the body (the house footer follows it)
      const close = r.text.indexOf("Questions? Just reply to this email.");
      for (const earlier of ["Thank you.", "Received on: ", ...(a === "0" ? [RECEIPT_PORTAL_BUTTON] : [])])
        expect(r.text.indexOf(earlier)).toBeLessThan(close);
      expect(r.html).toContain("Questions? Just reply to this email.");
    }
    const portal = receiptSent(data("0"), opts);
    expect(portal.html.indexOf(RECEIPT_PORTAL_BUTTON)).toBeLessThan(
      portal.html.indexOf("Questions? Just reply to this email."),
    );
  });

  it("escapes what it is given", () => {
    const r = receiptSent({ ...data("0"), number: "<b>x</b>", amount: "<i>" }, opts);
    expect(r.html).not.toContain("<b>x</b>");
    expect(r.html).not.toContain("<i>");
  });

  it("goes out from billing@ through renderEmail with the keys the jobs Worker sends", () => {
    const d = data("0");
    const r = renderEmail("receipt.sent", Object.fromEntries(RECEIPT_SENT_KEYS.map((k) => [k, d[k]])), opts);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).toContain("billing@");
  });

  it("forbidden words: never a voucher, a stamp or a signature, never called a tax invoice (RA-39, RB-21 (b))", () => {
    for (const a of ["0", "1"] as const) {
      const r = receiptSent(data(a), opts);
      const all = `${r.subject}\n${r.text}\n${r.html.replace(/<[^>]+>/g, " ")}`;
      expect(all).not.toMatch(/voucher|stamp|signat|signed|tax invoice|GST/i);
    }
  });
});
