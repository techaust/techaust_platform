// JOB-PDF-01: the message guard, the fixed R2 keys, the place-of-supply label and the next UTC midnight.
import { describe, expect, it } from "vitest";
import {
  fyLabelOfToken,
  hasSupplierCopy,
  isPdfKind,
  isPdfMessage,
  nextUtcMidnight,
  PDF_MAX_HOPS,
  pdfKeys,
  placeOfSupplyLabel,
  supplierPdfKey,
  utcDateOf,
} from "../src/pdf-jobs.ts";

describe("the supplier copy (Q11, owner 2026-10-28)", () => {
  it("pdf.supplier is a message of the PDF family, with an id and a bounded hop", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.supplier", documentId: "d1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.supplier", documentId: "d1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfKind({ v: 1, kind: "pdf.supplier" })).toBe(true);
    for (const bad of [
      { v: 1, kind: "pdf.supplier", documentId: "", hop: 0 },
      { v: 1, kind: "pdf.supplier", documentId: "d1", hop: -1 },
      { v: 1, kind: "pdf.supplier", documentId: "d1", hop: PDF_MAX_HOPS + 1 },
      { v: 1, kind: "pdf.supplier", documentId: "d1", hop: 1.5 },
      { v: 1, kind: "pdf.supplier", hop: 0 },
    ])
      expect(isPdfMessage(bad), JSON.stringify(bad)).toBe(false);
  });

  it("pdf.deed (T11) is a message of the PDF family, with a deed id and a bounded hop", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.deed", deedId: "deed_1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.deed", deedId: "deed_1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfKind({ v: 1, kind: "pdf.deed" })).toBe(true);
    for (const bad of [
      { v: 1, kind: "pdf.deed", deedId: "", hop: 0 },
      { v: 1, kind: "pdf.deed", deedId: "x".repeat(65), hop: 0 },
      { v: 1, kind: "pdf.deed", deedId: "deed_1", hop: PDF_MAX_HOPS + 1 },
      { v: 1, kind: "pdf.deed", documentId: "deed_1", hop: 0 },
    ])
      expect(isPdfMessage(bad), JSON.stringify(bad)).toBe(false);
  });

  it("the key is the original's own stem with -supplier, never the original's key; the same checks as pdfKeys", () => {
    const input = { type: "tax_invoice", fy: "2026-27", number: 12, version: 1 };
    expect(supplierPdfKey(input)).toBe("docs/tax_invoice/2026-27/0012-v1-supplier.pdf");
    expect(supplierPdfKey(input)).not.toBe(pdfKeys(input).pdf);
    expect(() => supplierPdfKey({ ...input, fy: "2026" })).toThrow(RangeError);
    expect(() => supplierPdfKey({ ...input, type: "../x" })).toThrow(RangeError);
  });

  it("a supplier copy is for a tax invoice, an export invoice, a credit note and a debit note; never a proforma or a proposal", () => {
    for (const t of ["tax_invoice", "export_invoice", "credit_note", "debit_note"])
      expect(hasSupplierCopy(t), t).toBe(true);
    for (const t of ["proforma", "proposal", "estimate", "receipt", ""])
      expect(hasSupplierCopy(t), t).toBe(false);
  });
});

describe("isPdfMessage", () => {
  it("accepts the three kinds", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.snapshot", documentId: "d1", reason: "send" })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.snapshot", documentId: "d1", reason: "sweep" })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.render", documentId: "d1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.render", documentId: "d1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.sweep", asOf: 1_700_000_000_000 })).toBe(true);
  });

  it("accepts the M4.5 kinds: the acceptance certificate and the offer sweep", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.certificate", acceptanceId: "a1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.certificate", acceptanceId: "a1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "offer.sweep", asOf: 1_700_000_000_000 })).toBe(true);
  });

  it.each([
    { v: 1, kind: "pdf.certificate", acceptanceId: "", hop: 0 },
    { v: 1, kind: "pdf.certificate", acceptanceId: "x".repeat(65), hop: 0 },
    { v: 1, kind: "pdf.certificate", acceptanceId: 7, hop: 0 },
    { v: 1, kind: "pdf.certificate", acceptanceId: "a", hop: PDF_MAX_HOPS + 1 },
    { v: 1, kind: "pdf.certificate", acceptanceId: "a", hop: -1 },
    { v: 1, kind: "pdf.certificate", acceptanceId: "a", hop: 0.5 },
    { v: 1, kind: "pdf.certificate", documentId: "a", hop: 0 },
    { v: 1, kind: "offer.sweep", asOf: "now" },
    { v: 1, kind: "offer.sweep", asOf: -1 },
    { v: 2, kind: "offer.sweep", asOf: 1 },
  ])("refuses the M4.5 body %j", (body) => {
    expect(isPdfMessage(body)).toBe(false);
  });

  it.each([
    null,
    "pdf.sweep",
    42,
    {},
    { v: 2, kind: "pdf.sweep", asOf: 1 },
    { v: 1, kind: "pdf.other", documentId: "d" },
    { v: 1, kind: "pdf.snapshot", documentId: "", reason: "send" },
    { v: 1, kind: "pdf.snapshot", documentId: "d", reason: "later" },
    { v: 1, kind: "pdf.snapshot", documentId: "x".repeat(65), reason: "send" },
    { v: 1, kind: "pdf.render", documentId: "d", hop: PDF_MAX_HOPS + 1 },
    { v: 1, kind: "pdf.render", documentId: "d", hop: -1 },
    { v: 1, kind: "pdf.render", documentId: "d", hop: 1.5 },
    { v: 1, kind: "pdf.render", documentId: 7, hop: 1 },
    { v: 1, kind: "pdf.sweep", asOf: "now" },
    { v: 1, kind: "pdf.sweep", asOf: -1 },
  ])("refuses %j", (body) => {
    expect(isPdfMessage(body)).toBe(false);
  });

  it("isPdfKind sees the family even when the body is malformed", () => {
    expect(isPdfKind({ kind: "pdf.render" })).toBe(true);
    expect(isPdfKind({ kind: "pdf.certificate" })).toBe(true);
    expect(isPdfKind({ kind: "offer.sweep" })).toBe(true); // rides the PDF queue, so a malformed one is never a lead
    expect(isPdfKind({ kind: "offer.send" })).toBe(false); // an email-queue message
    expect(isPdfKind({ kind: "lead.purge" })).toBe(false);
    expect(isPdfKind(null)).toBe(false);
    expect(isPdfKind({ kind: 3 })).toBe(false);
  });
});

describe("pdfKeys", () => {
  it("builds the fixed keys", () => {
    expect(pdfKeys({ type: "proposal", fy: "2026-27", number: 3, version: 2 })).toEqual({
      snapshot: "docs/proposal/2026-27/0003-v2.json",
      pdf: "docs/proposal/2026-27/0003-v2.pdf",
    });
    expect(pdfKeys({ type: "estimate", fy: "2026-27", number: 12345, version: 1 }).pdf).toBe(
      "docs/estimate/2026-27/12345-v1.pdf",
    );
  });

  it.each([
    { type: "../x", fy: "2026-27", number: 1, version: 1 },
    { type: "proposal", fy: "2026/27", number: 1, version: 1 },
    { type: "proposal", fy: "2026-27", number: 0, version: 1 },
    { type: "proposal", fy: "2026-27", number: 1.5, version: 1 },
    { type: "proposal", fy: "2026-27", number: 1, version: 0 },
    { type: "proposal", fy: "2026-27", number: 1, version: 1000 },
  ])("refuses %j", (input) => {
    expect(() => pdfKeys(input)).toThrow(RangeError);
  });
});

describe("placeOfSupplyLabel", () => {
  it("names the state with its code", () => {
    expect(placeOfSupplyLabel("19", "intra")).toBe("West Bengal (19)");
    expect(placeOfSupplyLabel("27", "inter")).toBe("Maharashtra (27)");
  });
  it("writes Outside India for exports", () => {
    expect(placeOfSupplyLabel("96", "export_lut")).toBe("Outside India (96)");
    expect(placeOfSupplyLabel("96", "export_igst")).toBe("Outside India (96)");
    expect(placeOfSupplyLabel("96", "inter")).toBe("Outside India (96)");
  });
  it("falls back to the code for an unknown one", () => {
    expect(placeOfSupplyLabel("ZZ", "inter")).toBe("ZZ");
  });
});

describe("nextUtcMidnight", () => {
  it("is the start of the next UTC day", () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 26, 13, 5))).toBe(Date.UTC(2026, 9, 27));
  });
  it("moves on from exactly midnight", () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 26))).toBe(Date.UTC(2026, 9, 27));
  });
  it("crosses a month and year end", () => {
    expect(nextUtcMidnight(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("utcDateOf and fyLabelOfToken", () => {
  it("gives the UTC date, not the IST one", () => {
    expect(utcDateOf(Date.UTC(2026, 9, 26, 23, 59))).toBe("2026-10-26");
    expect(utcDateOf(Date.UTC(2026, 9, 27))).toBe("2026-10-27");
  });
  it("turns an FY token into the label the keys use", () => {
    expect(fyLabelOfToken("2627")).toBe("2026-27");
    expect(fyLabelOfToken("9900")).toBe("2099-00");
  });
  it.each(["", "26-27", "2628", "2026", "abcd", "26277"])("refuses %j", (t) => {
    expect(fyLabelOfToken(t)).toBeNull();
  });
});
