// M7.1: the client lines C1 to C24 and the gap lines G1 to G12 of 07-ZP, approved by the owner on 2026-11-05 (C25 withdrawn, L27), all shown unmarked.
// The checks the M7.1 screens make before sending, and the words of each refusal by its
// CODE (never the server's message, which is "[Placeholder] C15" and the like).
import { findBannedPhrases, hasAmpersand } from "@techaust/core/public-text";
import { describe, expect, it } from "vitest";
import { RequestError } from "./api.ts";
import { COPY } from "./copy.ts";
import { INV } from "./copy-invoices.ts";
import { APPROVED_07ZP, GAP, ZP, zpAllText } from "./copy-zp.ts";
import {
  checkNotice,
  forText,
  noticeRefusal,
  profileRefusal,
  refusedFields,
  requestRefusal,
  requestState,
  sizeText,
} from "./lib/m71.ts";

const MARK = "[Placeholder]";

describe("07-ZP, owner-approved [POR-04, POR-06 to POR-11]", () => {
  it("shows every approved line unmarked (G11 and G12 approved 2026-11-05)", () => {
    expect(APPROVED_07ZP).toBe(true);
    const lines = zpAllText();
    expect(lines.length).toBeGreaterThan(90);
    for (const line of lines) expect(line.includes(MARK), line).toBe(false);
    expect(GAP.fileSize("1.8 MB")).toBe("1.8 MB");
    // re-check 6: the owner's new G12 words (a refusal is a pasted control character; the box stops more than 300)
    expect(GAP.noteRefused).toBe("We couldn't save this note. Remove any unusual characters and try again.");
  });
  it("carries the owner's Requests empty line (audit AU14, 2026-11-07), unmarked", () => {
    expect(GAP.requestsEmpty).toBe("You haven't sent any requests yet.");
  });
  it("pass the banned-phrase list (07 §1.3), say 'and', never '&', and name no card or bank field to fill in", () => {
    for (const line of zpAllText()) {
      expect(findBannedPhrases(line), line).toEqual([]);
      expect(hasAmpersand(line), line).toBe(false);
      expect(line, line).not.toMatch(/card number|account number:/i);
    }
  });
  it("hold 07-ZP's words", () => {
    expect(ZP.paidThanks).toBe(
      "Thanks. We'll check our bank and confirm the payment. Until then the balance stays as it is.",
    );
    expect(ZP.requestSent).toBe("Request sent. We'll reply by email within 30 days.");
    expect(ZP.kinds.data_erasure).toBe("Erase my personal data");
    expect(ZP.noticeErrors.amount_above_balance("₹1,000.00")).toBe(
      "That's more than the balance due (₹1,000.00).",
    );
    expect(ZP.colleaguesTitle("Kestrel (sample)")).toBe("People from Kestrel (sample) with portal access");
    expect("linkFooter" in ZP).toBe(false);
  });
  it("hold the owner's words for G1 to G10", () => {
    expect(GAP.forMore(2)).toBe("and 2 more");
    expect(GAP.nameMissing).toBe("Enter your name.");
    expect(GAP.detailsRefused).toBe("We couldn't save these details. Check your name and phone number.");
    expect(GAP.kindMissing).toBe("Choose what your request is about.");
    expect(GAP.detailsMissing).toBe("Tell us a little about what you need.");
    expect(GAP.detailsTooLong).toBe("Keep it under 1,000 characters.");
    expect(GAP.amountMissing).toBe("Enter the amount you paid.");
    expect(GAP.amountUnread).toBe("Enter the amount in numbers, for example 23,600.00.");
    expect(GAP.dateMissing).toBe("Enter the date you paid.");
    expect(GAP.referenceMissing).toBe("Enter the transaction reference from your bank.");
    expect(GAP.referenceRefused).toBe("We couldn't read this reference. Check it and try again.");
    expect(GAP.dateInvalid).toBe("Enter the date as DD/MM/YYYY, for example 26/10/2026.");
    expect(GAP.choosePicker).toBe("Choose a date");
    expect(GAP.milestonesEmpty).toBe("No milestones yet.");
  });
});

const err = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new RequestError(status, code, "[Placeholder] C15", null, null, extra);

describe("the M7.1 screens' checks and refusals", () => {
  it("check I've paid before sending: amount, date, reference; never above the balance", () => {
    const o = { currency: "INR", balanceMinor: 2_360_000, dateUnread: false };
    const empty = checkNotice({ amount: "", paidOn: "", reference: " ", note: "" }, o);
    expect(empty).toEqual({
      ok: false,
      errors: { amount: GAP.amountMissing, paidOn: GAP.dateMissing, reference: GAP.referenceMissing },
    });
    expect(
      checkNotice({ amount: "abc", paidOn: "2026-11-03", reference: "UTR1", note: "" }, o),
    ).toMatchObject({
      ok: false,
      errors: { amount: GAP.amountUnread },
    });
    expect(
      checkNotice({ amount: "23,600.01", paidOn: "2026-11-03", reference: "UTR1", note: "" }, o),
    ).toMatchObject({
      ok: false,
      errors: { amount: "That's more than the balance due (₹23,600.00)." },
    });
    expect(checkNotice({ amount: "₹23,600", paidOn: "2026-11-03", reference: "UTR1", note: "" }, o)).toEqual({
      ok: true,
      amountMinor: 2_360_000,
    });
    expect(
      checkNotice(
        { amount: "1,250.50", paidOn: "", reference: "R", note: "" },
        { ...o, currency: "USD", dateUnread: true },
      ),
    ).toMatchObject({ ok: false, errors: { paidOn: GAP.dateInvalid } });
  });
  it("word every notice refusal from its code, with the field it belongs to", () => {
    expect(noticeRefusal(err(400, "amount_above_balance", { balanceMinor: 100_000 }), "INR")).toEqual({
      amount: "That's more than the balance due (₹1,000.00).",
    });
    expect(noticeRefusal(err(400, "date_in_future"), "INR")).toEqual({
      paidOn: ZP.noticeErrors.date_in_future,
    });
    expect(noticeRefusal(err(400, "date_before_issue"), "INR")).toEqual({
      paidOn: ZP.noticeErrors.date_before_issue,
    });
    expect(noticeRefusal(err(409, "notice_duplicate"), "INR")).toEqual({
      reference: ZP.noticeErrors.notice_duplicate,
    });
    expect(noticeRefusal(err(409, "notice_open_limit"), "INR")).toEqual({
      form: ZP.noticeErrors.notice_open_limit,
    });
    expect(noticeRefusal(err(409, "not_payable", { reason: "paid" }), "INR")).toEqual({
      form: ZP.noticeErrors.not_payable,
    });
    expect(noticeRefusal(err(404, "not_found"), "INR")).toEqual({ form: ZP.noticeErrors.not_payable });
    // the emailed link's page: a 404 is the link that ended (07-U), never C15 (lead, question 2)
    expect(noticeRefusal(err(404, "not_found"), "INR", { link: true })).toEqual({
      form: "This link no longer works. Sign in to your client portal to see your invoices, or ask us for a new link at contact@techaust.com.",
    });
    // review M1: a 400 is worded by the fields it names (B4's `fields`); the note's is its own (G12), never the reference's (G8)
    const bad = (fields: unknown) => err(400, "bad_request", { fields });
    expect(noticeRefusal(bad(["note"]), "INR")).toEqual({ note: GAP.noteRefused });
    expect(noticeRefusal(bad(["reference"]), "INR")).toEqual({ reference: GAP.referenceRefused });
    expect(noticeRefusal(bad(["reference", "note"]), "INR")).toEqual({
      reference: GAP.referenceRefused,
      note: GAP.noteRefused,
    });
    expect(noticeRefusal(bad(["amountMinor", "paidOn"]), "INR")).toEqual({
      amount: GAP.amountUnread,
      paidOn: GAP.dateInvalid,
    });
    expect(noticeRefusal(bad(["token"]), "INR", { link: true })).toEqual({ form: INV.linkEnded });
    // no field named (or one we don't know): our side's words, never a field's
    expect(noticeRefusal(err(400, "bad_request"), "INR")).toEqual({ form: COPY.server });
    expect(noticeRefusal(bad(["somethingElse"]), "INR")).toEqual({ form: COPY.server });
    expect(refusedFields(bad(["note", 3, "reference"]))).toEqual(["note", "reference"]);
    expect(refusedFields(bad("note"))).toEqual([]);
    // the server's message is never shown
    for (const code of ["date_in_future", "notice_duplicate", "not_payable", "something_new"])
      expect(JSON.stringify(noticeRefusal(err(409, code), "INR"))).not.toContain("C15");
  });
  it("word request and profile refusals from their codes (C17, C24)", () => {
    expect(requestRefusal(err(409, "request_open"))).toBe(ZP.requestOpen);
    expect(requestRefusal(err(429, "too_many_requests"))).toBe(ZP.tooManyRequests);
    expect(profileRefusal(err(409, "stale_version"))).toBe(ZP.stale);
    expect(profileRefusal(err(400, "bad_request"))).toBe(GAP.detailsRefused);
  });
  it("say what a receipt is for, with the ones left out", () => {
    expect(forText({ numbers: ["TH/INV/2627/0001"], more: 0 })).toBe("TH/INV/2627/0001");
    expect(forText({ numbers: ["A", "B"], more: 2 })).toBe(`A, B ${GAP.forMore(2)}`);
    expect(forText({ numbers: [], more: 0 })).toBe("–");
  });
  it("read a request's state and a file's size", () => {
    expect(requestState({ status: "open", outcome: null, closedAt: null })).toEqual({
      open: true,
      text: ZP.open,
      outcome: null,
    });
    const closed = requestState({
      status: "closed",
      outcome: "declined",
      closedAt: Date.UTC(2026, 10, 3, 6),
    });
    expect(closed).toEqual({ open: false, text: ZP.closedOn("03 Nov 2026"), outcome: ZP.declined });
    expect(sizeText(512)).toBe("512 bytes");
    expect(sizeText(248_000)).toBe("248 KB");
    expect(sizeText(1_840_000)).toBe("1.8 MB");
  });
});
