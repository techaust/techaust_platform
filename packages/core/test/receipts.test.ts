// Payment receipts, pure [ADM-PAY-09, ADM-SET-04, JOB-PDF-01; M6.5 run file B, L4, L5; 08-C RA-39, RB-21]: the id, the frozen header (words in both currencies, the
// "applied to" lines, the credit left), the seal, the email window, and the PA-CB check and the settlement reader beside them. Invented test data.
import { describe, expect, it } from "vitest";
import { PA_CB_RATE_MAX_AGE_DAYS, paCbCheck } from "../src/pa-cb.ts";
import {
  paymentIdOfReceipt,
  RECEIPT_APPLIED_MAX,
  RECEIPT_EMAIL_WINDOW_MS,
  RECEIPT_LAYOUT_ID,
  type ReceiptPayment,
  receiptEmailDue,
  receiptHeaderOf,
  receiptIdOf,
  receiptSealOf,
} from "../src/receipts.ts";
import { matchItem, RECON_PAGE_MAX, readRazorpayRecon, reconQueryOf, warmRecon } from "../src/recon.ts";

const payment = (o: Partial<ReceiptPayment> = {}): ReceiptPayment => ({
  id: "pay-1",
  currency: "INR",
  amountMinor: 150_000,
  receivedOn: "2026-11-01",
  provider: "manual",
  mode: "neft",
  referenceNorm: "UTR123",
  refundedMinor: 0,
  ...o,
});
const issuer = {
  tradeName: "Supplier Co",
  legalName: null,
  address: null,
  gstin: null,
  email: "billing@example.test",
};
const client = { name: "Client Pvt Ltd", gstin: null };

describe("the receipt id (L4)", () => {
  it("is rct_ + the payment id, within the 64 characters of an RPC id; the payment is read back", () => {
    expect(receiptIdOf("pay-1")).toBe("rct_pay-1");
    expect(paymentIdOfReceipt("rct_pay-1")).toBe("pay-1");
    expect(paymentIdOfReceipt("rct_")).toBeNull();
    expect(paymentIdOfReceipt("inv-1")).toBeNull();
    expect(receiptIdOf("x".repeat(60))).toHaveLength(64);
    expect(() => receiptIdOf("x".repeat(61))).toThrow(RangeError);
    expect(() => receiptIdOf("")).toThrow(RangeError);
  });
});

describe("receiptHeaderOf: the frozen header [RA-39: no tax fields]", () => {
  it("INR: words, the applied lines by number (one per document), the credit left", () => {
    const r = receiptHeaderOf({
      payment: payment(),
      allocations: [
        { documentId: "b", number: "TH/INV/2627/0002", type: "tax_invoice", amountMinor: 30_000 },
        { documentId: "a", number: "TH/INV/2627/0001", type: "tax_invoice", amountMinor: 100_000 },
        { documentId: "b", number: "TH/INV/2627/0002", type: "tax_invoice", amountMinor: -10_000 },
        { documentId: "c", number: "TH/INV/2627/0003", type: "tax_invoice", amountMinor: 0 },
      ],
      client,
      issuer,
      issuedOn: "2026-11-03",
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.value).toMatchObject({
      v: 1,
      layout: RECEIPT_LAYOUT_ID,
      amountWords: "Rupees One Thousand Five Hundred Only",
      appliedTo: [
        { documentId: "a", amountMinor: 100_000 },
        { documentId: "b", amountMinor: 20_000 },
      ],
      appliedMore: 0,
      heldAsCreditMinor: 30_000,
    });
    // no tax field, no voucher, no stamp or signature claim (RA-39, RB-21): the keys of the header
    const keys = JSON.stringify(r.value).match(/"[A-Za-z_]+":/g) ?? [];
    expect(keys.filter((k) => /tax|gst_?rate|igst|cgst|sgst|place|voucher|stamp|signat/i.test(k))).toEqual(
      [],
    );
  });

  it("USD with cents; a refund lowers the credit left, never below zero", () => {
    const r = receiptHeaderOf({
      payment: payment({ currency: "USD", amountMinor: 2_360, refundedMinor: 3_000 }),
      allocations: [],
      client,
      issuer,
      issuedOn: "2026-11-03",
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.value.amountWords).toBe("US Dollars Twenty-Three and Sixty Cents Only");
    expect(r.value.heldAsCreditMinor).toBe(0);
  });

  it("caps the applied lines and counts the rest; refuses bad amounts, days, lines and an over-applied payment", () => {
    const many = Array.from({ length: RECEIPT_APPLIED_MAX + 3 }, (_, i) => ({
      documentId: `d${String(i).padStart(3, "0")}`,
      number: `N/${String(i).padStart(3, "0")}`,
      type: "tax_invoice",
      amountMinor: 1,
    }));
    const r = receiptHeaderOf({
      payment: payment(),
      allocations: many,
      client,
      issuer,
      issuedOn: "2026-11-03",
    });
    expect(r.ok && r.value.appliedTo.length).toBe(RECEIPT_APPLIED_MAX);
    expect(r.ok && r.value.appliedMore).toBe(3);
    expect(
      receiptHeaderOf({
        payment: payment({ amountMinor: 0 }),
        allocations: [],
        client,
        issuer,
        issuedOn: "2026-11-03",
      }),
    ).toEqual({ ok: false, code: "amount_invalid" });
    expect(
      receiptHeaderOf({ payment: payment(), allocations: [], client, issuer, issuedOn: "3 Nov" }),
    ).toEqual({ ok: false, code: "date_invalid" });
    expect(
      receiptHeaderOf({
        payment: payment(),
        allocations: [{ documentId: "a", number: "N", type: "t", amountMinor: 1.5 }],
        client,
        issuer,
        issuedOn: "2026-11-03",
      }),
    ).toEqual({ ok: false, code: "allocation_invalid" });
    expect(
      receiptHeaderOf({
        payment: payment(),
        allocations: [{ documentId: "a", number: "N", type: "t", amountMinor: 150_001 }],
        client,
        issuer,
        issuedOn: "2026-11-03",
      }),
    ).toEqual({ ok: false, code: "over_applied" });
  });

  it("the seal is the SHA-256 of the canonical header: the same header, the same seal; a changed one, another", async () => {
    const a = receiptHeaderOf({
      payment: payment(),
      allocations: [],
      client,
      issuer,
      issuedOn: "2026-11-03",
    });
    const b = receiptHeaderOf({
      payment: payment(),
      allocations: [],
      client,
      issuer,
      issuedOn: "2026-11-04",
    });
    if (!a.ok || !b.ok) throw new Error("header");
    expect(await receiptSealOf(a.value)).toMatch(/^[0-9a-f]{64}$/);
    expect(await receiptSealOf(a.value)).toBe(await receiptSealOf({ ...a.value }));
    expect(await receiptSealOf(a.value)).not.toBe(await receiptSealOf(b.value));
  });

  it("L5: emailed only within 3 days of the confirmation", () => {
    expect(receiptEmailDue(1_000, 1_000 + RECEIPT_EMAIL_WINDOW_MS)).toBe(true);
    expect(receiptEmailDue(1_000, 1_001 + RECEIPT_EMAIL_WINDOW_MS)).toBe(false);
    expect(receiptEmailDue(Number.NaN, 1)).toBe(false);
  });
});

describe("paCbCheck: the ₹25 lakh warning (bigint) [ADM-PAY-13, L12; 08-C RB-07]", () => {
  const cap = 25_00_000_00;
  it("exactly at the cap is not above it; one paisa over is; the INR value rounds up", () => {
    // USD 31,250.00 at ₹80.000000 is exactly ₹25,00,000.00: not above
    expect(
      paCbCheck({
        usdMinor: 3_125_000,
        rateMicros: 80_000_000,
        rateDate: "2026-11-01",
        today: "2026-11-03",
        capInrMinor: cap,
      }),
    ).toEqual({
      ok: true,
      inrMinor: 250_000_000,
    });
    expect(
      paCbCheck({
        usdMinor: 3_125_001,
        rateMicros: 80_000_000,
        rateDate: "2026-11-01",
        today: "2026-11-03",
        capInrMinor: cap,
      }),
    ).toEqual({
      ok: false,
      code: "above_pa_cb_cap",
      inrMinor: 250_000_080,
    });
    // 249,999,999.000000… exactly at 83.333333; one cent more is 250,000,082.333333, rounded UP to …083
    expect(
      paCbCheck({
        usdMinor: 3_000_000,
        rateMicros: 83_333_333,
        rateDate: "2026-11-01",
        today: "2026-11-03",
        capInrMinor: cap,
      }),
    ).toEqual({ ok: true, inrMinor: 249_999_999 });
    expect(
      paCbCheck({
        usdMinor: 3_000_001,
        rateMicros: 83_333_333,
        rateDate: "2026-11-01",
        today: "2026-11-03",
        capInrMinor: cap,
      }),
    ).toEqual({
      ok: false,
      code: "above_pa_cb_cap",
      inrMinor: 250_000_083,
    });
  });
  it("no rate, a rate of 0, a rate older than 30 days or after today: rate unknown; bad inputs throw", () => {
    const base = { usdMinor: 100, capInrMinor: cap, today: "2026-11-03" };
    expect(paCbCheck({ ...base, rateMicros: null, rateDate: null })).toEqual({
      ok: false,
      code: "rate_unknown",
    });
    expect(paCbCheck({ ...base, rateMicros: 0, rateDate: "2026-11-01" })).toEqual({
      ok: false,
      code: "rate_unknown",
    });
    expect(paCbCheck({ ...base, rateMicros: 83_000_000, rateDate: "2026-10-04" })).toEqual({
      ok: true,
      inrMinor: 8_300,
    });
    expect(PA_CB_RATE_MAX_AGE_DAYS).toBe(30);
    expect(paCbCheck({ ...base, rateMicros: 83_000_000, rateDate: "2026-10-03" })).toEqual({
      ok: false,
      code: "rate_unknown",
    });
    expect(paCbCheck({ ...base, rateMicros: 83_000_000, rateDate: "2026-11-04" })).toEqual({
      ok: false,
      code: "rate_unknown",
    });
    expect(() => paCbCheck({ ...base, usdMinor: -1, rateMicros: 1, rateDate: "2026-11-01" })).toThrow(
      RangeError,
    );
  });
});

describe("the Razorpay recon reader (whitelisted facts only) and the match [ADM-PAY-10, L11]", () => {
  const item = {
    entity_id: "pay_ABC",
    type: "payment",
    amount: 10_000,
    fee: 236,
    tax: 36,
    credit: 9_764,
    debit: 0,
    currency: "INR",
    settlement_id: "setl_1",
    settlement_utr: "UTR9",
    settled_at: 1_762_000_000,
    card_network: "Visa",
    notes: { email: "someone@example.test" },
  };
  it("reads the whitelisted fields, drops everything else, skips unreadable or non-INR items, says whether the page was full", () => {
    const r = readRazorpayRecon(
      {
        count: 3,
        items: [
          item,
          {
            ...item,
            entity_id: "rfnd_1",
            type: "refund",
            credit: 0,
            debit: 5_000,
            amount: 5_000,
            fee: null,
            tax: null,
          },
          { amount: "x" },
          { ...item, currency: "USD" },
        ],
      },
      4,
    );
    expect(r?.items).toEqual([
      {
        entityType: "payment",
        entityId: "pay_ABC",
        direction: "credit",
        amountMinor: 10_000,
        feeMinor: 236,
        taxMinor: 36,
        currency: "INR",
        settlementId: "setl_1",
        settlementUtr: "UTR9",
        settledAt: 1_762_000_000_000,
      },
      {
        entityType: "refund",
        entityId: "rfnd_1",
        direction: "debit",
        amountMinor: 5_000,
        feeMinor: 0,
        taxMinor: 0,
        currency: "INR",
        settlementId: "setl_1",
        settlementUtr: "UTR9",
        settledAt: 1_762_000_000_000,
      },
    ]);
    expect(r?.skipped).toBe(2);
    expect(r?.full).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/Visa|example\.test/);
    expect(
      readRazorpayRecon(
        { items: [{ ...item, type: "something_new", credit: null, debit: null, settled_at: null }] },
        100,
      )?.items[0],
    ).toMatchObject({
      entityType: "other",
      direction: "credit",
      settledAt: null,
    });
    expect(
      readRazorpayRecon({ items: [{ ...item, type: "refund", credit: null, debit: null }] }, 100)?.items[0]
        ?.direction,
    ).toBe("debit");
    expect(readRazorpayRecon({ nope: 1 }, 10)).toBeNull();
    expect(readRazorpayRecon({ items: [] }, 10)?.full).toBe(false);
    expect(warmRecon()).toBe(1);
  });
  it("matches by amount, then flags a fee or tax that differs; a refund (no fee on record) is not compared on fees", () => {
    expect(
      matchItem(
        { amountMinor: 10_000, feeMinor: 236, taxMinor: 36 },
        { amountMinor: 10_000, feeMinor: 236, feeTaxMinor: 36 },
      ),
    ).toBe("matched");
    expect(
      matchItem(
        { amountMinor: 10_000, feeMinor: 236, taxMinor: 36 },
        { amountMinor: 9_999, feeMinor: 236, feeTaxMinor: 36 },
      ),
    ).toBe("amount_mismatch");
    expect(
      matchItem(
        { amountMinor: 10_000, feeMinor: 200, taxMinor: 36 },
        { amountMinor: 10_000, feeMinor: 236, feeTaxMinor: 36 },
      ),
    ).toBe("fee_mismatch");
    expect(
      matchItem(
        { amountMinor: 10_000, feeMinor: 236, taxMinor: 0 },
        { amountMinor: 10_000, feeMinor: 236, feeTaxMinor: null },
      ),
    ).toBe("matched");
    expect(
      matchItem(
        { amountMinor: 5_000, feeMinor: 9, taxMinor: 9 },
        { amountMinor: 5_000, feeMinor: null, feeTaxMinor: null },
      ),
    ).toBe("matched");
  });
  it("the page query: an ISO day and a skip, at most 100 a page", () => {
    expect(reconQueryOf("2026-11-02", 0)).toEqual({
      year: 2026,
      month: 11,
      day: 2,
      count: RECON_PAGE_MAX,
      skip: 0,
    });
    expect(RECON_PAGE_MAX).toBe(100);
    expect(reconQueryOf("2026/11/02", 0)).toBeNull();
    expect(reconQueryOf("2026-11-02", -1)).toBeNull();
  });
});
