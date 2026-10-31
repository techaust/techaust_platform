// Online payment rules [ADM-PAY-02, ADM-SET-05, POR-06; M6.2 run file B and H]: which documents may be paid online (every refusal reason, overseas refused: owner
// Q3 A) and which amounts (property-tested against a plain restatement of the rule), plus the review kinds' twin.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_MIN_MINOR,
  NOT_PAYABLE_REASONS,
  onlineMinimumOf,
  type PayableClient,
  type PayableDoc,
  payAmountVerdict,
  payableOnline,
  REVIEW_KINDS,
} from "../src/online-pay.ts";

const doc: PayableDoc = {
  type: "tax_invoice",
  currency: "INR",
  frozen: true,
  status: "issued",
  withdrawn: false,
  balanceMinor: 118_000,
};
const client: PayableClient = { country: "IN", gstStatus: "registered", anonymised: false };

describe("payableOnline [POR-06, Q3 A]", () => {
  it("a tax invoice, a debit note and a proforma of a domestic INR client, issued, with something due", () => {
    expect(payableOnline(doc, client)).toEqual({ ok: true });
    expect(payableOnline({ ...doc, type: "debit_note", status: "partially_paid" }, client)).toEqual({
      ok: true,
    });
    expect(payableOnline({ ...doc, type: "proforma" }, { ...client, gstStatus: "unregistered" })).toEqual({
      ok: true,
    });
    expect(
      payableOnline({ ...doc, type: "proforma", status: "converted", balanceMinor: 50_000 }, client),
    ).toEqual({
      ok: true,
    });
  });

  it.each([
    ["type_not_payable", { type: "export_invoice" }, {}],
    ["type_not_payable", { type: "credit_note" }, {}],
    ["type_not_payable", { type: "proposal" }, {}],
    ["client_anonymised", {}, { anonymised: true }],
    ["client_overseas", {}, { country: "US", gstStatus: "overseas" }],
    ["client_overseas", {}, { gstStatus: "overseas" }],
    ["client_overseas", {}, { country: "AE" }],
    ["not_inr", { currency: "USD" }, {}],
    ["not_issued", { frozen: false, status: "draft" }, {}],
    ["withdrawn", { type: "proforma", status: "void", withdrawn: true }, {}],
    ["void", { status: "void" }, {}],
    ["nothing_due", { status: "paid", balanceMinor: 0 }, {}],
    ["nothing_due", { balanceMinor: -5 }, {}],
    ["below_gateway_minimum", { balanceMinor: 99 }, {}],
    ["target_not_whole_unit", { type: "proforma", balanceMinor: 118_050 }, {}],
  ] as const)("refuses %s", (reason, d, c) => {
    expect(payableOnline({ ...doc, ...d }, { ...client, ...c })).toEqual({
      ok: false,
      code: "not_payable_online",
      reason,
    });
  });

  it("every reason is listed once", () => {
    expect(new Set(NOT_PAYABLE_REASONS).size).toBe(NOT_PAYABLE_REASONS.length);
    expect(GATEWAY_MIN_MINOR).toBe(100);
  });
});

describe("payAmountVerdict [07-ZI lines 4 to 7, RB-39]", () => {
  it("the examples: full, part above the floor, below the floor, above the balance, paise on a proforma", () => {
    const f = { balanceMinor: 5_000_000, floorMinor: 1_000_000, wholeRupees: false };
    expect(payAmountVerdict({ ...f, amountMinor: 5_000_000 })).toEqual({ ok: true });
    expect(payAmountVerdict({ ...f, amountMinor: 1_000_000 })).toEqual({ ok: true });
    expect(payAmountVerdict({ ...f, amountMinor: 999_999 })).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 1_000_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 5_000_001 })).toEqual({
      ok: false,
      code: "amount_above_balance",
      balanceMinor: 5_000_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 1_000_050, wholeRupees: true })).toEqual({
      ok: false,
      code: "amount_not_whole_rupee",
    });
    // A balance under the floor: the minimum is the whole balance.
    expect(payAmountVerdict({ ...f, balanceMinor: 300_000, amountMinor: 299_999 })).toEqual({
      ok: false,
      code: "amount_below_minimum",
      minimumMinor: 300_000,
    });
    expect(payAmountVerdict({ ...f, amountMinor: 0 })).toMatchObject({ code: "amount_below_minimum" });
    expect(payAmountVerdict({ ...f, amountMinor: 1.5 })).toMatchObject({ code: "amount_below_minimum" });
    expect(onlineMinimumOf(1_000_000, 300_000)).toBe(300_000);
  });

  it("agrees with the rule restated, for any amounts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10, max: 20_000_000 }),
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.integer({ min: 100, max: 5_000_000 }),
        fc.boolean(),
        (amountMinor, balanceMinor, floorMinor, wholeRupees) => {
          const v = payAmountVerdict({ amountMinor, balanceMinor, floorMinor, wholeRupees });
          const min = Math.min(floorMinor, balanceMinor);
          const ok =
            amountMinor > 0 &&
            amountMinor <= balanceMinor &&
            amountMinor >= min &&
            (!wholeRupees || amountMinor % 100 === 0);
          expect(v.ok).toBe(ok);
          if (!v.ok && v.code === "amount_above_balance") expect(amountMinor).toBeGreaterThan(balanceMinor);
          if (!v.ok && v.code === "amount_below_minimum") expect(v.minimumMinor).toBe(min);
        },
      ),
    );
  });

  it("the full balance is always accepted (whole rupees on a payable proforma)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 100, max: 5_000_000 }),
        (rupees, floor) => {
          expect(
            payAmountVerdict({
              amountMinor: rupees * 100,
              balanceMinor: rupees * 100,
              floorMinor: floor,
              wholeRupees: true,
            }),
          ).toEqual({ ok: true });
        },
      ),
    );
  });
});

describe("the review kinds (07-ZI line 20)", () => {
  it("are listed once each", () => {
    expect(new Set(REVIEW_KINDS).size).toBe(REVIEW_KINDS.length);
    expect(REVIEW_KINDS).toContain("advance_blocked");
  });
});
