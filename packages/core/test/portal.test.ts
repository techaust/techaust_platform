// The full client portal's pure rules [M7.1; POR-06, POR-09, POR-11, ADM-PAY-05; run file B, L8, L10, L12]: the request kinds, which kinds Staff may close, which
// documents take an "I've paid" notice and in what order a refusal is named, the notice's facts, and the "View & pay" link's 30 days. The SQL twins are compared
// in packages/db/test/portal-rules.test.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DATA_REQUEST_KINDS,
  DETAILS_REQUIRED_KINDS,
  detailsRequired,
  isRequestKind,
  NOTICE_OPEN_STATUSES,
  NOTICE_REFUSALS,
  NOTICE_TYPES,
  noticeAllowed,
  paidNoticeVerdict,
  REQUEST_KINDS,
  REQUESTS_PER_DAY,
  STAFF_CLOSE_KINDS,
  staffMayClose,
  VIEW_PAY_GRACE_DAYS,
  VIEW_PAY_GRACE_MS,
  viewPayLive,
} from "../src/portal.ts";

describe("request kinds [L8]", () => {
  it("five kinds; the data-rights ones and the ones needing details are among them; five a day", () => {
    expect(REQUEST_KINDS).toEqual([
      "contact_change",
      "data_access",
      "data_correction",
      "data_erasure",
      "grievance",
    ]);
    for (const k of [...DATA_REQUEST_KINDS, ...DETAILS_REQUIRED_KINDS, ...STAFF_CLOSE_KINDS])
      expect(isRequestKind(k)).toBe(true);
    expect(isRequestKind("nomination")).toBe(false);
    expect(isRequestKind(7)).toBe(false);
    expect(REQUESTS_PER_DAY).toBe(5);
  });

  it("details are required for a contact change, a correction and a grievance only", () => {
    expect(REQUEST_KINDS.filter(detailsRequired)).toEqual(["contact_change", "data_correction", "grievance"]);
  });

  it("Staff may close only a contact change or a grievance: never a data-rights kind, M7.4's kinds or an unknown value", () => {
    expect(REQUEST_KINDS.filter(staffMayClose)).toEqual(["contact_change", "grievance"]);
    for (const k of DATA_REQUEST_KINDS) expect(staffMayClose(k)).toBe(false);
    for (const k of ["consent_withdrawal", "nomination", "", "GRIEVANCE", null, undefined, 1])
      expect(staffMayClose(k)).toBe(false);
    // The two lists never overlap.
    expect(STAFF_CLOSE_KINDS.some((k) => (DATA_REQUEST_KINDS as readonly string[]).includes(k))).toBe(false);
  });
});

describe("noticeAllowed [L10]", () => {
  const doc = (
    o: Partial<{ type: string; status: string; balanceMinor: number; withdrawn: boolean }> = {},
  ) => ({
    type: "tax_invoice",
    status: "issued",
    balanceMinor: 100,
    withdrawn: false,
    ...o,
  });

  it("accepts an open invoice, export invoice, debit note or issued proforma with something to pay", () => {
    for (const type of NOTICE_TYPES) expect(noticeAllowed(doc({ type }))).toEqual({ ok: true });
    for (const status of NOTICE_OPEN_STATUSES) expect(noticeAllowed(doc({ status }))).toEqual({ ok: true });
  });

  it("accepts a converted proforma with a balance left (early check 1 finding 1: part-paid through its first advance invoice)", () => {
    expect(noticeAllowed(doc({ type: "proforma", status: "converted", balanceMinor: 1 }))).toEqual({
      ok: true,
    });
    // An invoice is never `converted`.
    expect(noticeAllowed(doc({ status: "converted" }))).toEqual({ ok: false, reason: "not_open" });
  });

  it.each([
    [{ type: "proforma", status: "void", withdrawn: true }, "withdrawn"],
    [{ status: "void" }, "void"],
    [{ type: "proforma", status: "void" }, "void"],
    [{ type: "credit_note" }, "credit_note"],
    [{ type: "proposal" }, "not_payable_type"],
    [{ type: "receipt" }, "not_payable_type"],
    [{ type: "proforma", status: "converted", balanceMinor: 0 }, "no_balance"],
    [{ type: "proforma", status: "paid" }, "proforma_not_issued"],
    [{ type: "proforma", status: "draft" }, "proforma_not_issued"],
    [{ status: "paid", balanceMinor: 0 }, "paid"],
    [{ status: "credited", balanceMinor: 0 }, "not_open"],
    [{ status: "draft" }, "not_open"],
    [{ status: "pending_approval" }, "not_open"],
    [{ balanceMinor: 0 }, "no_balance"],
    [{ balanceMinor: -1 }, "no_balance"],
    [{ balanceMinor: 1.5 }, "no_balance"],
  ])("refuses %j as %s", (o, reason) => {
    expect(noticeAllowed(doc(o))).toEqual({ ok: false, reason });
  });

  it("names every refusal in the listed order, and only listed codes", () => {
    const types = [...NOTICE_TYPES, "credit_note", "proposal"];
    const statuses = [...NOTICE_OPEN_STATUSES, "paid", "credited", "void", "converted", "draft"];
    fc.assert(
      fc.property(
        fc.constantFrom(...types),
        fc.constantFrom(...statuses),
        fc.integer({ min: -5, max: 5 }),
        fc.boolean(),
        (type, status, balanceMinor, withdrawn) => {
          const r = noticeAllowed({ type, status, balanceMinor, withdrawn });
          if (!r.ok) expect(NOTICE_REFUSALS).toContain(r.reason);
          // ok only when nothing listed refuses it
          if (r.ok) {
            expect(withdrawn || status === "void" || balanceMinor <= 0).toBe(false);
            expect((NOTICE_TYPES as readonly string[]).includes(type)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("paidNoticeVerdict [L10, C15]", () => {
  const v = {
    amountMinor: 100,
    balanceMinor: 100,
    paidOn: "2026-11-04",
    issueDate: "2026-11-01",
    todayIst: "2026-11-04",
  };
  it("ok at the balance, today and on the issue day", () => {
    expect(paidNoticeVerdict(v)).toBe("ok");
    expect(paidNoticeVerdict({ ...v, paidOn: "2026-11-01" })).toBe("ok");
    expect(paidNoticeVerdict({ ...v, amountMinor: 1 })).toBe("ok");
  });
  it("refuses in order: above the balance, in the future, before the issue day", () => {
    expect(paidNoticeVerdict({ ...v, amountMinor: 101 })).toBe("amount_above_balance");
    expect(paidNoticeVerdict({ ...v, amountMinor: 101, paidOn: "2027-01-01" })).toBe("amount_above_balance");
    expect(paidNoticeVerdict({ ...v, paidOn: "2026-11-05" })).toBe("date_in_future");
    expect(paidNoticeVerdict({ ...v, paidOn: "2026-10-31" })).toBe("date_before_issue");
    // A broken number fails closed.
    expect(paidNoticeVerdict({ ...v, amountMinor: 0.5 })).toBe("amount_above_balance");
    expect(paidNoticeVerdict({ ...v, balanceMinor: Number.NaN })).toBe("amount_above_balance");
    // A missing day fails closed too (the SQL twin's NULL arm).
    expect(paidNoticeVerdict({ ...v, paidOn: null as unknown as string })).toBe("date_in_future");
  });
});

describe("viewPayLive [L12]", () => {
  it("30 days after settlement, strictly", () => {
    expect(VIEW_PAY_GRACE_DAYS).toBe(30);
    expect(VIEW_PAY_GRACE_MS).toBe(2_592_000_000);
    const settled = 1_870_000_000_000;
    const day = 86_400_000;
    expect(viewPayLive(null, settled * 2)).toBe(true); // still owed (or reopened by a refund)
    expect(viewPayLive(settled, settled + 29 * day)).toBe(true);
    expect(viewPayLive(settled, settled + 30 * day - 1)).toBe(true);
    expect(viewPayLive(settled, settled + 30 * day)).toBe(false);
    expect(viewPayLive(settled, settled + 31 * day)).toBe(false);
  });
});
