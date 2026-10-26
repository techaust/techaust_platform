import { describe, expect, it } from "vitest";
import { fromIst } from "../src/dates.ts";
import {
  ATTACHMENT_KEY,
  CONFIRMATION_LINK_DAYS,
  certificateKey,
  certificateKeyOfPdfKey,
  checkDecline,
  confirmationLinkExpiry,
  DECLINE_NOTE_MAX,
  DECLINE_REASONS,
  effectiveOfferStatus,
  headRatesBp,
  isDeclineReason,
  mintOfferToken,
  normaliseTypedName,
  offerLinkExpiry,
  offerLinkUrl,
  todayIst,
} from "../src/offers.ts";
import { pdfKeys } from "../src/pdf-jobs.ts";
import { scheduleWhen } from "../src/schedule-text.ts";
import { headsFor } from "../src/tax/index.ts";

describe("normaliseTypedName", () => {
  it("normalises to NFC, trims and collapses spaces", () => {
    const nbsp = String.fromCodePoint(0xa0);
    expect(normaliseTypedName(`  Asha ${nbsp}  Rao  `)).toEqual({ ok: true, value: "Asha Rao" });
    const decomposed = `Jose${String.fromCodePoint(0x301)} Silva`;
    expect(normaliseTypedName(decomposed)).toEqual({
      ok: true,
      value: `Jos${String.fromCodePoint(0xe9)} Silva`,
    });
  });
  it("refuses a non-string, empty and one-character name", () => {
    for (const bad of [undefined, null, 5, "", "   ", "A"]) {
      expect(normaliseTypedName(bad)).toEqual({ ok: false, error: "name_too_short" });
    }
  });
  it("counts code points and caps at 120", () => {
    expect(normaliseTypedName("a".repeat(120)).ok).toBe(true);
    expect(normaliseTypedName("a".repeat(121))).toEqual({ ok: false, error: "name_too_long" });
    expect(normaliseTypedName("\u{1F600}".repeat(60)).ok).toBe(true);
  });
  it("refuses control, bidi, isolate, zero-width and line characters", () => {
    const bad = [0x0, 0xa, 0x9, 0x202e, 0x2066, 0x200b, 0xfeff, 0x200e, 0x2028, 0xad].map((c) =>
      String.fromCodePoint(c),
    );
    for (const ch of bad) {
      expect(normaliseTypedName(`Asha${ch}Rao`), JSON.stringify(ch)).toEqual({
        ok: false,
        error: "name_invalid_characters",
      });
    }
  });
  it("allows the joiners that Bengali and Hindi names need", () => {
    const zwj = String.fromCodePoint(0x200d);
    const zwnj = String.fromCodePoint(0x200c);
    expect(
      normaliseTypedName(`${String.fromCodePoint(0x9b0)}${zwj}${String.fromCodePoint(0x9af)} Sen`).ok,
    ).toBe(true);
    expect(
      normaliseTypedName(`${String.fromCodePoint(0x915)}${zwnj}${String.fromCodePoint(0x937)} Rao`).ok,
    ).toBe(true);
  });
});

describe("checkDecline", () => {
  it("knows the codes", () => {
    expect(DECLINE_REASONS).toHaveLength(5);
    expect(isDeclineReason("price")).toBe(true);
    expect(isDeclineReason("nope")).toBe(false);
    expect(isDeclineReason(3)).toBe(false);
  });
  it("needs a known reason; 'other' needs words; the note is trimmed and capped", () => {
    expect(checkDecline("bogus", undefined)).toEqual({ ok: false, error: "reason_invalid" });
    expect(checkDecline(undefined, "x")).toEqual({ ok: false, error: "reason_invalid" });
    expect(checkDecline("other", undefined)).toEqual({ ok: false, error: "note_required" });
    expect(checkDecline("other", "   ")).toEqual({ ok: false, error: "note_required" });
    expect(checkDecline("price", "x".repeat(DECLINE_NOTE_MAX + 1))).toEqual({
      ok: false,
      error: "note_too_long",
    });
    expect(checkDecline("price", undefined)).toEqual({ ok: true, reason: "price", note: null });
    expect(checkDecline("price", "  too dear ")).toEqual({ ok: true, reason: "price", note: "too dear" });
    expect(checkDecline("other", "x".repeat(DECLINE_NOTE_MAX)).ok).toBe(true);
    expect(checkDecline("price", 12)).toEqual({ ok: true, reason: "price", note: null });
  });
});

describe("link lifetimes", () => {
  it("an offer link lasts to the end of valid_until (IST) plus 30 days", () => {
    // 2026-11-30 + 31 days = 2026-12-31 00:00 IST (exclusive).
    expect(offerLinkExpiry("2026-11-30")).toBe(fromIst({ year: 2026, month: 12, day: 31 }));
    expect(offerLinkExpiry("2026-11-30")).toBe(Date.UTC(2026, 11, 30, 18, 30, 0));
  });
  it("crosses a month and a year end", () => {
    expect(offerLinkExpiry("2026-12-31")).toBe(fromIst({ year: 2027, month: 1, day: 31 }));
  });
  it("refuses a bad date", () => {
    expect(() => offerLinkExpiry("2026-13-01")).toThrow(RangeError);
    expect(() => offerLinkExpiry("soon")).toThrow(RangeError);
  });
  it("a confirmation link lasts 90 days", () => {
    expect(CONFIRMATION_LINK_DAYS).toBe(90);
    expect(confirmationLinkExpiry(1000)).toBe(1000 + 90 * 86_400_000);
  });
});

describe("todayIst and effectiveOfferStatus", () => {
  it("the IST day turns at 18:30 UTC", () => {
    expect(todayIst(Date.UTC(2026, 10, 30, 18, 29, 59, 999))).toBe("2026-11-30");
    expect(todayIst(Date.UTC(2026, 10, 30, 18, 30, 0))).toBe("2026-12-01");
  });
  it("sent and viewed expire after the last valid day, not on it", () => {
    for (const status of ["sent", "viewed"]) {
      expect(effectiveOfferStatus({ status, validUntil: "2026-11-30" }, "2026-11-30")).toBe(status);
      expect(effectiveOfferStatus({ status, validUntil: "2026-11-30" }, "2026-12-01")).toBe("expired");
      expect(effectiveOfferStatus({ status, validUntil: null }, "2030-01-01")).toBe(status);
    }
  });
  it("maps the other statuses; rejected reads as declined", () => {
    const at = (status: string) => effectiveOfferStatus({ status, validUntil: "2020-01-01" }, "2026-01-01");
    expect(at("accepted")).toBe("accepted");
    expect(at("expired")).toBe("expired");
    expect(at("revised")).toBe("revised");
    expect(at("rejected")).toBe("declined");
  });
  it("a converted estimate reads as accepted: converting is internal to TecHaust (lead decision, 2026-10-26)", () => {
    expect(effectiveOfferStatus({ status: "converted", validUntil: "2020-01-01" }, "2026-01-01")).toBe(
      "accepted",
    );
    expect(effectiveOfferStatus({ status: "converted", validUntil: null }, "2030-01-01")).toBe("accepted");
  });
  it("a draft is not client-visible", () => {
    expect(() => effectiveOfferStatus({ status: "draft", validUntil: null }, "2026-01-01")).toThrow(
      RangeError,
    );
  });
});

describe("certificateKey and the attachment allow-list", () => {
  const i = { type: "proposal", fy: "2026-27", number: 3, version: 2 };
  it("follows the rules of pdfKeys", () => {
    expect(certificateKey(i)).toBe("docs/proposal/2026-27/0003-v2-certificate.pdf");
    expect(certificateKey(i).startsWith(pdfKeys(i).pdf.replace(/\.pdf$/, ""))).toBe(true);
    expect(() => certificateKey({ ...i, type: "../x" })).toThrow(RangeError);
    expect(() => certificateKey({ ...i, version: 0 })).toThrow(RangeError);
  });
  it("only a proposal or estimate PDF or certificate matches", () => {
    expect(ATTACHMENT_KEY.test(pdfKeys(i).pdf)).toBe(true);
    expect(ATTACHMENT_KEY.test(certificateKey({ ...i, type: "estimate" }))).toBe(true);
    for (const bad of [
      "docs/tax_invoice/2026-27/0003-v1.pdf",
      "docs/proposal/2026-27/0003-v1.json",
      "docs/proposal/../x/0003-v1.pdf",
      "docs/proposal/2026-27/0003-v1.pdf/../../secret",
      "other/proposal/2026-27/0003-v1.pdf",
      "docs/proposal/2026-27/0003-v1.pdfx",
    ]) {
      expect(ATTACHMENT_KEY.test(bad), bad).toBe(false);
    }
  });
});

describe("headRatesBp", () => {
  it("intra-state: CGST and SGST are half the rate each, matching headsFor", () => {
    expect(headRatesBp({ effectiveRateBp: 1800 }, "intra")).toEqual({ cgstBp: 900, sgstBp: 900, igstBp: 0 });
    const heads = headsFor(100_000n, 1800, "intra");
    expect(heads.cgst).toBe(9000n);
    expect(heads.sgst).toBe(9000n);
  });
  it("inter-state: IGST is the whole rate; LUT export is zero", () => {
    expect(headRatesBp({ effectiveRateBp: 1800 }, "inter")).toEqual({ cgstBp: 0, sgstBp: 0, igstBp: 1800 });
    expect(headRatesBp({ effectiveRateBp: 0 }, "export_lut")).toEqual({ cgstBp: 0, sgstBp: 0, igstBp: 0 });
    expect(headRatesBp({ effectiveRateBp: 0 }, "intra")).toEqual({ cgstBp: 0, sgstBp: 0, igstBp: 0 });
  });
  it("an odd rate cannot be split in whole basis points", () => {
    expect(headRatesBp({ effectiveRateBp: 1801 }, "intra")).toBeNull();
  });
  it("refuses a negative or fractional rate", () => {
    expect(() => headRatesBp({ effectiveRateBp: -1 }, "intra")).toThrow(RangeError);
    expect(() => headRatesBp({ effectiveRateBp: 1.5 }, "inter")).toThrow(RangeError);
  });
});

describe("link tokens and urls", () => {
  it("a token is 43 URL-safe characters, its hash is the SHA-256 hex, and two tokens differ", async () => {
    const a = await mintOfferToken();
    const b = await mintOfferToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toBe(b.token);
    const again = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.token));
    expect(a.hash).toBe(Array.from(new Uint8Array(again), (x) => x.toString(16).padStart(2, "0")).join(""));
  });
  it("the link carries the token in the fragment only", () => {
    expect(offerLinkUrl("https://portal.example/", "abc")).toBe("https://portal.example/o#t=abc");
    expect(offerLinkUrl("https://portal.example", "abc")).toBe("https://portal.example/o#t=abc");
    expect(new URL(offerLinkUrl("https://portal.example", "abc")).search).toBe("");
  });
  it("the certificate key follows the PDF key", () => {
    const pdf = pdfKeys({ type: "proposal", fy: "2026-27", number: 3, version: 2 }).pdf;
    expect(certificateKeyOfPdfKey(pdf)).toBe(
      certificateKey({ type: "proposal", fy: "2026-27", number: 3, version: 2 }),
    );
  });
});

describe("scheduleWhen", () => {
  it("is the exported wording of a payment trigger", () => {
    expect(scheduleWhen({ label: "Start", pctBp: 4000, trigger: "on_accept" })).toBe("on acceptance");
    expect(scheduleWhen({ label: "End", pctBp: 4000, trigger: "delivery" })).toBe("on delivery");
    expect(scheduleWhen({ label: "Midpoint", pctBp: 4000, trigger: "milestone" })).toBe("at the midpoint");
  });
});
