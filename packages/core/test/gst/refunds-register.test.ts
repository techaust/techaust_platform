// The refunds register CSV (`refunds-v1`; M6.5, B4) [ADM-PAY-08, ADM-REP-04]: the file's columns and order, the INR value (the amount for INR, the bank's figure for
// USD where known, else blank: L15), blanks for what a row lacks, formula defence of text, and the refusals (a bad day or amount, an unknown version). Invented data.
import { describe, expect, it } from "vitest";
import {
  CURRENT_REFUNDS_LAYOUT,
  REFUNDS_LAYOUTS,
  type RefundsRegisterInput,
  refundsRegisterCsv,
  refundsRegisterRows,
} from "../../src/gst/index.ts";
import { d, hasBareLineBreak } from "./fixtures.ts";

const base: RefundsRegisterInput = {
  id: "r1",
  refundedOn: "2026-11-02",
  clientCode: "C-0001",
  clientName: "Sample client A (fake)",
  from: "TH/INV/2627/0007",
  creditNote: "TH/CN/2627/0001",
  paymentReference: "pay_SAMPLE0001",
  way: "Through Razorpay",
  gatewayRefundId: "rfnd_SAMPLE0001",
  bankReference: null,
  currency: "INR",
  amountMinor: 118_000,
  inrRefundedMinor: null,
  reason: "After a credit note",
  status: "Refunded",
};

describe("refunds-v1 [ADM-PAY-08]", () => {
  it("is the current layout, frozen", () => {
    expect(CURRENT_REFUNDS_LAYOUT).toBe("refunds-v1");
    expect(Object.isFrozen(REFUNDS_LAYOUTS)).toBe(true);
    expect(Object.isFrozen(REFUNDS_LAYOUTS["refunds-v1"].columns)).toBe(true);
  });

  it("writes one row per refund in the given order; INR value: the amount (INR), the bank's figure (USD) or blank", async () => {
    const rows: RefundsRegisterInput[] = [
      base,
      {
        ...base,
        id: "r2",
        refundedOn: "2026-11-03",
        clientCode: "C-0002",
        clientName: "=Overseas, Co",
        from: "Client's credit",
        creditNote: null,
        paymentReference: "UTRSAMPLE01",
        way: "By bank transfer",
        gatewayRefundId: null,
        bankReference: "UTRSAMPLE02",
        currency: "USD",
        amountMinor: 5_000,
        inrRefundedMinor: 417_500,
        reason: "Paid too much",
      },
      {
        ...base,
        id: "r3",
        currency: "USD",
        amountMinor: 2_500,
        inrRefundedMinor: null,
        paymentReference: null,
      },
    ];
    const csv = refundsRegisterCsv(rows);
    if (!csv.ok) throw new Error(JSON.stringify(csv.errors));
    expect(hasBareLineBreak(csv.value)).toBe(false);
    await expect(csv.value).toMatchFileSnapshot("./__snapshots__/refunds-v1.csv");
    const lines = csv.value.split("\r\n");
    expect(lines[0]).toBe(
      "Refund date,Client code,Client,Refunded from,Credit note,Payment reference,How,Gateway refund ID,Bank reference (UTR),Currency,Amount,INR value,Reason,Status",
    );
    expect(lines[1]).toContain(",INR,1180.00,1180.00,");
    // the formula defence on text, the bank's INR figure on a USD refund
    expect(lines[2]).toContain(`"'=Overseas, Co"`);
    expect(lines[2]).toContain(",USD,50.00,4175.00,");
    // USD with no INR figure: blank, never a guess
    expect(lines[3]).toContain(",USD,25.00,,");
    expect(lines).toHaveLength(5); // header, three rows, the final CRLF
    const parsed = refundsRegisterRows(rows);
    expect(parsed.ok && parsed.value[0]?.refundedOn).toEqual(d(2026, 11, 2));
  });

  it("refuses a bad day or amount at the refund's id, and an unknown version", () => {
    expect(refundsRegisterCsv([{ ...base, refundedOn: "2026-02-30" }])).toMatchObject({
      ok: false,
      errors: [{ code: "date_invalid", path: ["r1"] }],
    });
    for (const bad of [
      { ...base, amountMinor: -1 },
      { ...base, amountMinor: 1.5 },
      { ...base, currency: "USD" as const, inrRefundedMinor: -5 },
    ])
      expect(refundsRegisterRows([bad])).toMatchObject({
        ok: false,
        errors: [{ code: "amount_invalid", path: ["r1"] }],
      });
    expect(refundsRegisterCsv([base], "refunds-v9" as never)).toMatchObject({
      ok: false,
      errors: [{ code: "layout_unknown" }],
    });
    expect(refundsRegisterCsv([])).toEqual({
      ok: true,
      value:
        "Refund date,Client code,Client,Refunded from,Credit note,Payment reference,How,Gateway refund ID,Bank reference (UTR),Currency,Amount,INR value,Reason,Status\r\n",
      warnings: [],
    });
  });
});
