// 07-ZO's client lines (M6.5; ADM-PAY-09, ADM-MAIL-01): every line goes through the one switch (`[Placeholder] ` until the owner approves 07-ZO, lines 12b and
// 18 included), and none calls the receipt a tax invoice or a voucher or makes a stamp or signature claim (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50
// CGST Rules (08-C RA-39); OPEN (08-C RB-21): is an emailed, computer-generated receipt chargeable to stamp duty?).
import { describe, expect, it } from "vitest";
import { APPROVED_07ZO, RECEIPT_COPY, RECEIPT_EMAIL_COPY, zoAllText } from "../src/copy-zo.ts";

describe("07-ZO client lines [ADM-PAY-09]", () => {
  it("every line carries the mark exactly while 07-ZO is unapproved", () => {
    for (const line of zoAllText()) expect(line.startsWith("[Placeholder] ")).toBe(!APPROVED_07ZO);
  });

  it("line 12b (the email's closing) and line 18 ('and {n} more') are in the list", () => {
    const all = zoAllText();
    expect(all).toContain(RECEIPT_EMAIL_COPY.closing);
    expect(RECEIPT_EMAIL_COPY.closing).toMatch(/Questions\? Just reply to this email\.$/);
    expect(all).toContain(RECEIPT_COPY.appliedMore(2));
    expect(RECEIPT_COPY.appliedMore(7)).toMatch(/and 7 more$/);
  });

  it("forbidden words: no voucher, stamp or signature; 'tax invoice' only in line 8's denial", () => {
    for (const line of zoAllText()) {
      expect(line).not.toMatch(/voucher|stamp|signat|signed/i);
      if (/tax invoice/i.test(line)) expect(line).toMatch(/It is not a tax invoice\.$/);
    }
  });
});
