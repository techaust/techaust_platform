// M6.5 early check 1, the core side [ADM-PAY-08, ADM-PAY-10, ADM-PAY-13, ADM-INV-17; findings 1, 2, 4, 5, 6, 9, 11, 12; L40]: a second full refund of a pending
// payment, the chargeback path, the manual recipient and day rules, the refund body's pending + outside case, the GST stage before `reduction_pending`, the fee
// rule of a recon match, the PayPal cap, and "held as credit" counting only refunds that succeeded. Invented test data.
import { describe, expect, it } from "vitest";
import { stageOf } from "../src/gst/realisation.ts";
import { PA_CB_CAP_INR_MINOR, paCbCapFor, paCbCheck } from "../src/pa-cb.ts";
import { receiptHeaderOf } from "../src/receipts.ts";
import { matchItem } from "../src/recon.ts";
import { planRefund, type RefundDocument, type RefundSourcePayment } from "../src/refunds.ts";
import { refundBody } from "../src/schemas/payments.ts";

const pay = (o: Partial<RefundSourcePayment> = {}): RefundSourcePayment => ({
  id: "pay-1",
  clientId: "c-1",
  currency: "INR",
  kind: "payment",
  status: "confirmed",
  provider: "razorpay",
  amountMinor: 118_000,
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
  creditedMinor: 0,
  tdsMinor: 0,
  isAdvanceInvoice: false,
  ...o,
});
const today = "2026-11-03";

describe("planRefund after early check 1", () => {
  it("finding 1: a pending payment with a refund that has not failed is never refunded again", () => {
    const pending = pay({ status: "pending_verification", netAllocatedMinor: 0, amountMinor: 50_000 });
    expect(
      planRefund({ payment: pending, from: "pending", via: "gateway", amountMinor: 50_000, today }),
    ).toEqual({
      ok: true,
      rejectsPayment: true,
    });
    expect(
      planRefund({
        payment: { ...pending, refundedMinor: 50_000 },
        from: "pending",
        via: "gateway",
        amountMinor: 50_000,
        today,
      }),
    ).toEqual({ ok: false, code: "exceeds_refundable", refundableMinor: 0 });
  });

  it("L40 (finding 5): a chargeback from a fully paid invoice needs no excess, only the holding; an Owner's refund there needs a credit note", () => {
    const base = {
      payment: pay(),
      from: "document" as const,
      via: "gateway" as const,
      doc: doc(),
      holdingMinor: 118_000,
      today,
    };
    expect(planRefund({ ...base, amountMinor: 10_000 })).toMatchObject({
      ok: false,
      code: "credit_note_needed",
      excessMinor: 0,
    });
    expect(
      planRefund({ ...base, amountMinor: 10_000, origin: "chargeback", settledOn: "2026-11-02" }),
    ).toEqual({
      ok: true,
      release: { documentId: "inv-1", amountMinor: 10_000 },
    });
    expect(planRefund({ ...base, amountMinor: 118_001, origin: "chargeback" })).toEqual({
      ok: false,
      code: "exceeds_holding",
      holdingMinor: 118_000,
    });
    // a recorded dispute or outside refund is not held to Razorpay's 6-month window (it already happened)
    expect(
      planRefund({
        ...base,
        amountMinor: 10_000,
        origin: "chargeback",
        today: "2027-08-01",
        settledOn: "2027-07-30",
      }),
    ).toMatchObject({ ok: true });
    expect(planRefund({ ...base, amountMinor: 10_000, today: "2027-08-01" })).toEqual({
      ok: false,
      code: "gateway_refund_window",
    });
  });

  it("finding 9: a manual refund of a gateway payment goes to the payer's own other account; days are real and never after today", () => {
    const base = {
      payment: pay({ netAllocatedMinor: 100_000 }),
      from: "credit" as const,
      via: "manual" as const,
      amountMinor: 1_000,
      today,
    };
    expect(planRefund({ ...base, paidTo: "original" })).toEqual({ ok: false, code: "paid_to_invalid" });
    expect(planRefund(base)).toEqual({ ok: false, code: "paid_to_invalid" });
    expect(planRefund({ ...base, paidTo: "own_account", settledOn: "2026-11-03" })).toEqual({ ok: true });
    expect(planRefund({ ...base, paidTo: "own_account", settledOn: "2026-11-04" })).toEqual({
      ok: false,
      code: "day_invalid",
    });
    expect(planRefund({ ...base, paidTo: "own_account", settledOn: "3 Nov" })).toEqual({
      ok: false,
      code: "day_invalid",
    });
    // a manual payment goes back to its original account
    expect(
      planRefund({
        ...base,
        payment: pay({ provider: "manual", netAllocatedMinor: 100_000 }),
        paidTo: "original",
      }),
    ).toEqual({ ok: true });
  });
});

describe("the refund body: pending + outside (finding 4)", () => {
  const body = {
    id: "01900000-0000-7000-8000-000000000009",
    amountMinor: 50_000,
    from: "pending",
    reasonCode: "other",
  };
  it("records a refund made in the gateway's dashboard of a pending payment; never a manual one", () => {
    expect(
      refundBody.safeParse({
        ...body,
        outside: { providerRefundId: "rfnd_X", origin: "outside", settledOn: "2026-11-02" },
      }).success,
    ).toBe(true);
    expect(refundBody.safeParse(body).success).toBe(true);
    expect(
      refundBody.safeParse({
        ...body,
        manual: { mode: "neft", reference: "UTR1", paidOn: "2026-11-02", paidTo: "own_account" },
      }).success,
    ).toBe(false);
  });
});

describe("the refund body: the payer's written request with own_account (review part 1, finding 10; RB-24)", () => {
  const body = {
    id: "01900000-0000-7000-8000-00000000000a",
    amountMinor: 1_000,
    from: "credit",
    reasonCode: "overpayment",
  };
  const manual = (paidTo: "original" | "own_account", writtenRequest?: true) => ({
    ...body,
    manual: {
      mode: "neft",
      reference: "UTR1",
      paidOn: "2026-11-02",
      paidTo,
      ...(writtenRequest ? { writtenRequest } : {}),
    },
  });
  it("own_account needs writtenRequest: true; the original account doesn't", () => {
    expect(refundBody.safeParse(manual("own_account")).success).toBe(false);
    expect(refundBody.safeParse(manual("own_account", true)).success).toBe(true);
    expect(refundBody.safeParse(manual("original")).success).toBe(true);
    expect(
      refundBody.safeParse({
        ...manual("own_account"),
        manual: { ...manual("own_account").manual, writtenRequest: false },
      }).success,
    ).toBe(false);
  });
});

describe("stageOf: RA-38's GST stage before RB-43's reduction (finding 2)", () => {
  const dates = {
    femaDue: { year: 2027, month: 8, day: 1 },
    gstDue: { year: 2026, month: 12, day: 1 },
  } as never;
  const facts = { paidMinor: 6_000, totalMinor: 10_000, reductionsMinor: 0, proofMissing: true };
  it("an LUT export settled by a credit note with an unproven card payment is in its GST stage", () => {
    expect(stageOf(dates, 0, { year: 2026, month: 12, day: 2 }, 30, true, facts)).toBe("gst_overdue");
    expect(stageOf(dates, 0, { year: 2026, month: 11, day: 15 }, 30, true, facts)).toBe("gst_approaching");
    expect(
      stageOf(dates, 0, { year: 2026, month: 12, day: 2 }, 30, true, { ...facts, proofMissing: false }),
    ).toBe("reduction_pending");
    // with IGST paid there is no GST stage: the reduction shows
    expect(stageOf(dates, 0, { year: 2026, month: 12, day: 2 }, 30, false, facts)).toBe("reduction_pending");
  });
});

describe("recon, PA-CB and the receipt after early check 1", () => {
  it("finding 6: the fee is compared only when its tax is on record", () => {
    expect(
      matchItem(
        { amountMinor: 1_000, feeMinor: 24, taxMinor: 4 },
        { amountMinor: 1_000, feeMinor: 0, feeTaxMinor: null },
      ),
    ).toBe("matched");
    expect(
      matchItem(
        { amountMinor: 1_000, feeMinor: 24, taxMinor: 4 },
        { amountMinor: 1_000, feeMinor: 24, feeTaxMinor: 5 },
      ),
    ).toBe("fee_mismatch");
    expect(
      matchItem(
        { amountMinor: 1_000, feeMinor: 24, taxMinor: 4 },
        { amountMinor: 1_000, feeMinor: 24, feeTaxMinor: 4 },
      ),
    ).toBe("matched");
  });

  it("finding 11: for PayPal the Owner's setting can't lift the cap above the RBI's ₹25 lakh; Stripe takes the setting", () => {
    expect(paCbCapFor("paypal", 900_000_000)).toBe(PA_CB_CAP_INR_MINOR);
    expect(paCbCapFor("paypal", 100_000_000)).toBe(100_000_000);
    expect(paCbCapFor("stripe", 900_000_000)).toBe(900_000_000);
    const at = { usdMinor: 3_000_000, rateMicros: 90_000_000, rateDate: "2026-11-01", today };
    expect(paCbCheck({ ...at, capInrMinor: paCbCapFor("paypal", 900_000_000) })).toEqual({
      ok: false,
      code: "above_pa_cb_cap",
      inrMinor: 270_000_000,
    });
    expect(paCbCheck({ ...at, capInrMinor: paCbCapFor("stripe", 900_000_000) })).toEqual({
      ok: true,
      inrMinor: 270_000_000,
    });
  });

  it("finding 12: 'held as credit' takes off only refunds that succeeded (the caller passes those)", () => {
    const r = receiptHeaderOf({
      payment: {
        id: "pay-9",
        currency: "INR",
        amountMinor: 10_000,
        receivedOn: "2026-11-01",
        provider: "razorpay",
        mode: "upi",
        referenceNorm: "PAY9",
        refundedMinor: 2_000,
      },
      allocations: [
        { documentId: "d1", number: "TH/INV/2627/0001", type: "tax_invoice", amountMinor: 5_000 },
      ],
      client: { name: "Client A", gstin: null },
      issuer: {
        tradeName: "TecHaust Technologies",
        legalName: null,
        address: null,
        gstin: null,
        email: null,
      },
      issuedOn: "2026-11-03",
    });
    expect(r.ok && r.value.heldAsCreditMinor).toBe(3_000);
  });
});
