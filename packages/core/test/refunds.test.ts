// Refunds, pure [ADM-PAY-08, ADM-PAY-11, ADM-INV-09, ADM-INV-11; M6.5 run file B, I, L1, L2, L8, L33; 08-C RA-40, RA-41, RB-43]: every `planRefund` code, the
// status moves, what a payment can give back, the Razorpay window, the warnings, and a fast-check model of a payment's life with refunds (request, success,
// failure, release) holding net + refunds ≤ amount and credit ≥ 0 at every step. All amounts are invented test data.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { creditBalance, creditSources, freeOf } from "../src/ledger.ts";
import {
  ADVANCE_REFUND_NOTE_REASON,
  addMonthsIso,
  canMoveRefund,
  creditCrossedPeriod,
  isRefundMode,
  isRefundPaidTo,
  isRefundReason,
  isRefundStatus,
  overpaymentAdvanceLine,
  planRefund,
  REFUND_REFUSALS,
  REFUND_STATUSES,
  type RefundDocument,
  type RefundSourcePayment,
  refundableOf,
  refundExportWarning,
  returnPeriodOf,
} from "../src/refunds.ts";

const pay = (o: Partial<RefundSourcePayment> = {}): RefundSourcePayment => ({
  id: "pay-1",
  clientId: "c-1",
  currency: "INR",
  kind: "payment",
  status: "confirmed",
  provider: "manual",
  amountMinor: 150_000,
  netAllocatedMinor: 118_000,
  refundedMinor: 0,
  receivedOn: "2026-11-01",
  hasOpenRefund: false,
  ...o,
});
const doc = (o: Partial<RefundDocument> = {}): RefundDocument => ({
  id: "inv-1",
  clientId: "c-1",
  currency: "INR",
  type: "tax_invoice",
  status: "paid",
  frozen: true,
  totalMinor: 118_000,
  paidMinor: 118_000,
  creditedMinor: 18_000,
  tdsMinor: 0,
  isAdvanceInvoice: false,
  ...o,
});
const today = "2026-11-03";

describe("the lists and the status moves (the twin of payment_refunds_status_flow)", () => {
  it("requested → processing | succeeded | failed; processing → succeeded | failed; terminal states never move", () => {
    const allowed = new Set([
      "requested>processing",
      "requested>succeeded",
      "requested>failed",
      "processing>succeeded",
      "processing>failed",
    ]);
    for (const a of REFUND_STATUSES)
      for (const b of REFUND_STATUSES)
        expect(canMoveRefund(a, b), `${a}>${b}`).toBe(allowed.has(`${a}>${b}`));
    expect(canMoveRefund("unknown", "failed")).toBe(false);
  });
  it("guards the enumerations", () => {
    expect(isRefundStatus("succeeded")).toBe(true);
    expect(isRefundStatus("done")).toBe(false);
    expect(isRefundReason("tds_payback")).toBe(true);
    expect(isRefundReason("gift")).toBe(false);
    expect(isRefundMode("neft")).toBe(true);
    expect(isRefundMode("card")).toBe(false);
    expect(isRefundPaidTo("own_account")).toBe(true);
    expect(isRefundPaidTo("anyone")).toBe(false);
  });
});

describe("refundableOf (the twin of paymentFreeSql)", () => {
  it("amount − net − refunds not failed, never below zero; unsafe numbers throw", () => {
    expect(refundableOf({ amountMinor: 150_000, netAllocatedMinor: 118_000, refundedMinor: 2_000 })).toBe(
      30_000,
    );
    expect(refundableOf({ amountMinor: 100, netAllocatedMinor: 100, refundedMinor: 50 })).toBe(0);
    expect(() => refundableOf({ amountMinor: 0.5, netAllocatedMinor: 0, refundedMinor: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("planRefund: every refusal, in the route's order [ADM-PAY-08, L2, L33]", () => {
  it("from credit: up to what the payment can give back", () => {
    expect(planRefund({ payment: pay(), from: "credit", via: "manual", amountMinor: 32_000, today })).toEqual(
      { ok: true },
    );
    expect(planRefund({ payment: pay(), from: "credit", via: "manual", amountMinor: 32_001, today })).toEqual(
      {
        ok: false,
        code: "exceeds_refundable",
        refundableMinor: 32_000,
      },
    );
    expect(
      planRefund({
        payment: pay({ refundedMinor: 30_000 }),
        from: "credit",
        via: "manual",
        amountMinor: 2_001,
        today,
      }),
    ).toMatchObject({ code: "exceeds_refundable", refundableMinor: 2_000 });
  });

  it("refuses a bad amount, TDS, money not confirmed, an open refund", () => {
    for (const amountMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])
      expect(planRefund({ payment: pay(), from: "credit", via: "manual", amountMinor, today })).toEqual({
        ok: false,
        code: "invalid_amount",
      });
    expect(
      planRefund({ payment: pay({ kind: "tds" }), from: "credit", via: "manual", amountMinor: 1, today }),
    ).toEqual({
      ok: false,
      code: "not_refundable_kind",
    });
    for (const status of ["pending_verification", "rejected", "withdrawn"])
      expect(
        planRefund({ payment: pay({ status }), from: "credit", via: "manual", amountMinor: 1, today }),
      ).toEqual({
        ok: false,
        code: "payment_not_confirmed",
      });
    expect(
      planRefund({
        payment: pay({ hasOpenRefund: true }),
        from: "credit",
        via: "manual",
        amountMinor: 1,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "refund_in_progress",
    });
  });

  it("through a gateway: a gateway payment only, and Razorpay's 6-month window (refused on the anniversary itself)", () => {
    expect(planRefund({ payment: pay(), from: "credit", via: "gateway", amountMinor: 1, today })).toEqual({
      ok: false,
      code: "not_gateway_payment",
    });
    const rzp = pay({ provider: "razorpay", receivedOn: "2026-05-03" });
    expect(
      planRefund({ payment: rzp, from: "credit", via: "gateway", amountMinor: 1, today: "2026-11-02" }),
    ).toEqual({ ok: true });
    expect(
      planRefund({ payment: rzp, from: "credit", via: "gateway", amountMinor: 1, today: "2026-11-03" }),
    ).toEqual({
      ok: false,
      code: "gateway_refund_window",
    });
    expect(
      planRefund({
        payment: pay({ provider: "razorpay", receivedOn: "bad" }),
        from: "credit",
        via: "gateway",
        amountMinor: 1,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "gateway_refund_window",
    });
    // Stripe and PayPal: no window here (their limits are UNCONFIRMED, the gateway's refusal answers)
    expect(
      planRefund({
        payment: pay({ provider: "stripe", currency: "USD", receivedOn: "2025-01-01" }),
        from: "credit",
        via: "gateway",
        amountMinor: 1,
        today,
      }),
    ).toEqual({ ok: true });
    // a gateway payment may still be paid back by a bank transfer (another account of the payer's own, RB-24)
    expect(
      planRefund({
        payment: rzp,
        from: "credit",
        via: "manual",
        paidTo: "own_account",
        amountMinor: 1,
        today: "2027-06-01",
      }),
    ).toEqual({ ok: true });
  });

  it("from a pending gateway payment (L33): in full only, through its own gateway; rejects the payment on success", () => {
    const pending = pay({ status: "pending_verification", provider: "razorpay", netAllocatedMinor: 0 });
    expect(
      planRefund({ payment: pending, from: "pending", via: "gateway", amountMinor: 150_000, today }),
    ).toEqual({ ok: true, rejectsPayment: true });
    expect(
      planRefund({ payment: pending, from: "pending", via: "gateway", amountMinor: 149_999, today }),
    ).toEqual({ ok: false, code: "pending_full_only" });
    expect(
      planRefund({ payment: pending, from: "pending", via: "manual", amountMinor: 150_000, today }),
    ).toEqual({ ok: false, code: "pending_gateway_only" });
    expect(
      planRefund({
        payment: pay({ status: "pending_verification" }),
        from: "pending",
        via: "gateway",
        amountMinor: 150_000,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "pending_gateway_only",
    });
    expect(
      planRefund({ payment: pay(), from: "pending", via: "gateway", amountMinor: 150_000, today }),
    ).toEqual({ ok: false, code: "payment_not_pending" });
  });

  it("from a document: the holding first (exceeds_holding), then the excess (credit_note_needed, RA-40's reason for an advance invoice); the release is exactly the amount", () => {
    const p = pay({ amountMinor: 118_000 });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 18_000,
        doc: doc(),
        holdingMinor: 118_000,
        today,
      }),
    ).toEqual({
      ok: true,
      release: { documentId: "inv-1", amountMinor: 18_000 },
    });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 18_000,
        doc: doc(),
        holdingMinor: 10_000,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "exceeds_holding",
      holdingMinor: 10_000,
    });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 18_001,
        doc: doc(),
        holdingMinor: 118_000,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "credit_note_needed",
      excessMinor: 18_000,
      noteReason: null,
    });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 1,
        doc: doc({ creditedMinor: 0, isAdvanceInvoice: true }),
        holdingMinor: 118_000,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "credit_note_needed",
      excessMinor: 0,
      noteReason: ADVANCE_REFUND_NOTE_REASON,
    });
    expect(ADVANCE_REFUND_NOTE_REASON).toBe("service_not_delivered");
    // the document must be the client's issued, live invoice or debit note in the payment's currency
    for (const bad of [
      undefined,
      doc({ frozen: false }),
      doc({ clientId: "c-2" }),
      doc({ type: "proforma" }),
      doc({ type: "credit_note" }),
      doc({ status: "void" }),
    ])
      expect(
        planRefund({
          payment: p,
          from: "document",
          via: "manual",
          amountMinor: 1,
          doc: bad,
          holdingMinor: 1,
          today,
        }),
      ).toEqual({
        ok: false,
        code: "document_mismatch",
      });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 1,
        doc: doc({ currency: "USD" }),
        holdingMinor: 1,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "currency_mismatch",
    });
    expect(
      planRefund({
        payment: p,
        from: "document",
        via: "manual",
        amountMinor: 1,
        doc: doc(),
        holdingMinor: 0.5,
        today,
      }),
    ).toEqual({
      ok: false,
      code: "invalid_amount",
    });
    expect(
      planRefund({ payment: p, from: "document", via: "manual", amountMinor: 1, doc: doc(), today }),
    ).toMatchObject({ code: "exceeds_holding", holdingMinor: 0 });
  });

  it("every refusal code is listed once", () => {
    expect(new Set(REFUND_REFUSALS).size).toBe(REFUND_REFUSALS.length);
  });
});

describe("the warnings (RB-43, RA-41)", () => {
  it("export money: an export invoice's excess, or credit of a client outside India", () => {
    expect(refundExportWarning({ docType: "export_invoice", clientOverseas: false })).toBe(true);
    expect(refundExportWarning({ docType: null, clientOverseas: true })).toBe(true);
    expect(refundExportWarning({ docType: "tax_invoice", clientOverseas: false })).toBe(false);
  });

  it("RA-41: credit on no invoice, or in USD, or above the ₹1,000 proviso, may be an advance", () => {
    const base = { currency: "INR" as const, excessProvisoMinor: 100_000 };
    expect(overpaymentAdvanceLine({ ...base, creditMinor: 0, allocatedAny: true })).toBeNull();
    expect(overpaymentAdvanceLine({ ...base, creditMinor: 100_000, allocatedAny: true })).toBeNull();
    expect(overpaymentAdvanceLine({ ...base, creditMinor: 100_001, allocatedAny: true })).toBe(
      "credit_may_be_advance",
    );
    expect(overpaymentAdvanceLine({ ...base, creditMinor: 1, allocatedAny: false })).toBe(
      "credit_may_be_advance",
    );
    expect(overpaymentAdvanceLine({ ...base, currency: "USD", creditMinor: 1, allocatedAny: true })).toBe(
      "credit_may_be_advance",
    );
    expect(overpaymentAdvanceLine({ ...base, creditMinor: 0.5, allocatedAny: false })).toBeNull();
  });

  it("RA-41: the GSTR-3B period by filing frequency, and credit refunded in a later period", () => {
    expect(returnPeriodOf("2026-11-03", "monthly")).toBe("2026-11");
    expect(returnPeriodOf("2026-11-03", "quarterly")).toBe("2026-Q4");
    expect(returnPeriodOf("2027-03-31", "quarterly")).toBe("2027-Q1");
    expect(returnPeriodOf("2026-04-01", "quarterly")).toBe("2026-Q2");
    expect(creditCrossedPeriod("2026-10-05", "2026-12-31", "quarterly")).toBe(false);
    expect(creditCrossedPeriod("2026-10-05", "2026-11-01", "monthly")).toBe(true);
    expect(creditCrossedPeriod("2026-09-30", "2026-10-01", "quarterly")).toBe(true);
  });

  it("addMonthsIso clamps to a shorter month", () => {
    expect(addMonthsIso("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsIso("2027-08-31", 6)).toBe("2028-02-29");
    expect(addMonthsIso("2026-05-03", 6)).toBe("2026-11-03");
    expect(addMonthsIso("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("a payment's life with refunds: net + refunds ≤ amount and credit ≥ 0 at every step (fast-check) [L1, L2, L8]", () => {
  type Step =
    | { kind: "allocate"; amount: number }
    | { kind: "release"; amount: number }
    | { kind: "refund"; amount: number; from: "credit" | "document" }
    | { kind: "settle"; outcome: "succeeded" | "failed" };
  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant("allocate" as const), amount: fc.integer({ min: 1, max: 60_000 }) }),
    fc.record({ kind: fc.constant("release" as const), amount: fc.integer({ min: 1, max: 60_000 }) }),
    fc.record({
      kind: fc.constant("refund" as const),
      amount: fc.integer({ min: 1, max: 60_000 }),
      from: fc.constantFrom("credit" as const, "document" as const),
    }),
    fc.record({
      kind: fc.constant("settle" as const),
      outcome: fc.constantFrom("succeeded" as const, "failed" as const),
    }),
  );

  it("the plan never lets a refund or an allocation draw money the payment does not hold free", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200_000 }),
        fc.array(stepArb, { maxLength: 40 }),
        (amount, steps) => {
          const total = 100_000;
          let net = 0; // on the one invoice
          let credited = 0;
          const refunds: { amount: number; status: "requested" | "succeeded" | "failed" }[] = [];
          const live = () => refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0);
          for (const s of steps) {
            const payment = pay({
              amountMinor: amount,
              netAllocatedMinor: net,
              refundedMinor: live(),
              hasOpenRefund: refunds.some((r) => r.status === "requested"),
            });
            if (s.kind === "allocate") {
              const balance = Math.max(0, total - net - credited);
              if (s.amount <= balance && s.amount <= refundableOf(payment)) net += s.amount;
            } else if (s.kind === "release") {
              const excess = Math.max(0, net + credited - total);
              if (s.amount <= excess && s.amount <= net) net -= s.amount;
            } else if (s.kind === "refund") {
              const d = doc({ totalMinor: total, paidMinor: net, creditedMinor: credited });
              const plan = planRefund({
                payment,
                from: s.from,
                via: "manual",
                amountMinor: s.amount,
                doc: d,
                holdingMinor: net,
                today,
              });
              if (plan.ok) {
                if (plan.release) net -= plan.release.amountMinor;
                refunds.push({ amount: s.amount, status: "requested" });
              }
              // a credit note arrives now and then, so a document refund has something to take
              credited = Math.min(total, credited + 7_000);
            } else {
              const open = refunds.find((r) => r.status === "requested");
              if (open) open.status = s.outcome;
            }
            expect(net + live()).toBeLessThanOrEqual(amount);
            const cp = {
              id: "p",
              kind: "payment",
              status: "confirmed",
              receivedOn: "2026-11-01",
              amountMinor: amount,
              netAllocatedMinor: net,
              refundedMinor: live(),
            };
            expect(creditBalance([cp])).toBeGreaterThanOrEqual(0);
            expect(freeOf(cp)).toBe(amount - net - live());
            // never two open refunds at once (L8)
            expect(refunds.filter((r) => r.status === "requested").length).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it("creditSources never draws refunded money; a failed refund gives it back", () => {
    const p = {
      id: "a",
      kind: "payment",
      status: "confirmed",
      receivedOn: "2026-10-01",
      amountMinor: 10_000,
      netAllocatedMinor: 4_000,
      refundedMinor: 5_000,
    };
    const q = {
      id: "b",
      kind: "payment",
      status: "confirmed",
      receivedOn: "2026-10-02",
      amountMinor: 3_000,
      netAllocatedMinor: 0,
    };
    expect(creditBalance([p, q])).toBe(4_000);
    expect(creditSources([p, q], 4_000)).toEqual({
      ok: true,
      sources: [
        { paymentId: "a", amountMinor: 1_000 },
        { paymentId: "b", amountMinor: 3_000 },
      ],
    });
    expect(creditSources([p, q], 4_001)).toEqual({ ok: false, code: "exceeds_credit" });
    expect(creditBalance([{ ...p, refundedMinor: 0 }, q])).toBe(9_000);
  });
});
