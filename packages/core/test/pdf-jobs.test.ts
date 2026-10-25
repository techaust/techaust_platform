// JOB-PDF-01: the message guard, the fixed R2 keys, the place-of-supply label and the next UTC midnight.
import { describe, expect, it } from "vitest";
import {
  fyLabelOfToken,
  isPdfKind,
  isPdfMessage,
  nextUtcMidnight,
  PDF_MAX_HOPS,
  pdfKeys,
  placeOfSupplyLabel,
  utcDateOf,
} from "../src/pdf-jobs.ts";

describe("isPdfMessage", () => {
  it("accepts the three kinds", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.snapshot", documentId: "d1", reason: "send" })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.snapshot", documentId: "d1", reason: "sweep" })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.render", documentId: "d1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.render", documentId: "d1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.sweep", asOf: 1_700_000_000_000 })).toBe(true);
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
    expect(placeOfSupplyLabel("96", "export_lut")).toBe("Outside India (96 – Other Territory)");
    expect(placeOfSupplyLabel("96", "export_igst")).toBe("Outside India (96 – Other Territory)");
    expect(placeOfSupplyLabel("96", "inter")).toBe("Outside India (96 – Other Territory)");
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
