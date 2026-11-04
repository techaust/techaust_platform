// M7.1 (run file H): the client lines C1 to C25 are drafts until the owner approves them, so every one shows the mark while `APPROVED_07ZP` is false; the
// gaps (G1 to G10) keep it even after the switch. The checks the M7.1 screens make before sending, and the words of each refusal by its CODE (never the
// server's message, which is "[Placeholder] C15" and the like).
import { describe, expect, it } from "vitest";
import { RequestError } from "./api.ts";
import { APPROVED_07ZP, GAP, ZP, zpAllText } from "./copy-zp.ts";
import {
  checkNotice,
  forText,
  noticeRefusal,
  profileRefusal,
  requestRefusal,
  requestState,
  sizeText,
} from "./lib/m71.ts";

describe("07-ZP drafts [POR-04, POR-06 to POR-11]", () => {
  it("are marked while the owner hasn't approved them", () => {
    expect(APPROVED_07ZP).toBe(false);
    for (const line of zpAllText()) expect(line.startsWith("[Placeholder] "), line).toBe(true);
  });
  it("say 'and', never '&', and name no card or bank field to fill in", () => {
    for (const line of zpAllText()) expect(line, line).not.toMatch(/&|card number|account number:/i);
  });
  it("hold section H's words", () => {
    expect(ZP.paidThanks).toBe(
      "[Placeholder] Thanks. We'll check our bank and confirm the payment. Until then the balance stays as it is.",
    );
    expect(ZP.requestSent).toBe("[Placeholder] Request sent. We'll reply by email within 30 days.");
    expect(ZP.kinds.data_erasure).toBe("[Placeholder] Erase my personal data");
    expect(ZP.noticeErrors.amount_above_balance("₹1,000.00")).toBe(
      "[Placeholder] That's more than the balance due (₹1,000.00).",
    );
    expect(ZP.colleaguesTitle("Kestrel (sample)")).toBe(
      "[Placeholder] People from Kestrel (sample) with portal access",
    );
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
      errors: { amount: "[Placeholder] That's more than the balance due (₹23,600.00)." },
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
      amount: "[Placeholder] That's more than the balance due (₹1,000.00).",
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
