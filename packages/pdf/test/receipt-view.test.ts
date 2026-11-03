// M6.5 (ADM-PAY-09, JOB-PDF-01; run file D, L4): the receipt's view from its sealed `receiptOf` (core `receiptHeaderOf`): the issuer's legal or trade name and
// the lines it has, the client, the amount and words in its currency, how it was paid, the invoices it is on and the credit it leaves. The layout itself is the
// builder's placeholder (`RECEIPT_LAYOUT_PLACEHOLDER`), designed and tested by the designer. Invented test data.
import { receiptHeaderOf } from "@techaust/core/receipts";
import { describe, expect, it } from "vitest";
import { receiptView } from "../src/receipt-view.ts";

const header = (o: {
  currency?: "INR" | "USD";
  amountMinor?: number;
  provider?: string;
  mode?: string | null;
  legalName?: string | null;
  address?: string | null;
  gstin?: string | null;
  email?: string | null;
  clientGstin?: string | null;
  allocations?: { documentId: string; number: string; type: string; amountMinor: number }[];
  refundedMinor?: number;
}) => {
  const h = receiptHeaderOf({
    payment: {
      id: "pay-1",
      currency: o.currency ?? "INR",
      amountMinor: o.amountMinor ?? 150_000,
      receivedOn: "2026-11-01",
      provider: o.provider ?? "manual",
      mode: o.mode === undefined ? "neft" : o.mode,
      referenceNorm: "UTR12345",
      refundedMinor: o.refundedMinor ?? 0,
    },
    allocations: o.allocations ?? [],
    client: { name: "Example Client Pvt Ltd", gstin: o.clientGstin ?? null },
    issuer: {
      tradeName: "Example Trade",
      legalName: o.legalName === undefined ? "Example Legal" : o.legalName,
      address: o.address === undefined ? "1 Example Road, Example Town" : o.address,
      gstin: o.gstin === undefined ? "19ABCDE1234F1Z5" : o.gstin,
      email: o.email === undefined ? "billing@example.test" : o.email,
    },
    issuedOn: "2026-11-03",
  });
  if (!h.ok) throw new Error(h.code);
  return h.value;
};

describe("receiptView [ADM-PAY-09]", () => {
  it("an INR bank transfer put whole on one invoice: the legal name, every issuer line, no credit left", () => {
    const v = receiptView(
      header({
        allocations: [
          { documentId: "d1", number: "TH/INV/2627/0001", type: "tax_invoice", amountMinor: 150_000 },
        ],
      }),
      "TH/RCT/2627/0001",
    );
    expect(v.number).toBe("TH/RCT/2627/0001");
    expect(v.issuer).toEqual({
      name: "Example Legal",
      lines: ["1 Example Road, Example Town", "GSTIN 19ABCDE1234F1Z5", "billing@example.test"],
    });
    expect(v.receivedFrom).toEqual({ name: "Example Client Pvt Ltd", gstin: null });
    expect(v.amount).toContain("₹");
    expect(v.amount).toContain("1,500.00");
    expect(v.appliedTo).toEqual([
      { number: "TH/INV/2627/0001", amount: expect.stringContaining("1,500.00") },
    ]);
    expect(v.appliedMore).toBe(0);
    expect(v.heldAsCredit).toBeNull();
    expect(v.paidBy).toContain("Bank transfer");
    expect(v.reference).toBe("UTR12345");
    expect(v.issuedOn).toBeTruthy();
    expect(v.receivedOn).toBeTruthy();
  });

  it("a USD PayPal payment of a client with a GSTIN, nothing applied: the trade name with no missing lines, all of it held as credit", () => {
    const v = receiptView(
      header({
        currency: "USD",
        amountMinor: 50_000,
        provider: "paypal",
        mode: "paypal",
        legalName: null,
        address: null,
        gstin: null,
        email: "",
        clientGstin: "29ABCDE1234F1Z5",
      }),
      "TH/RCT/2627/0002",
    );
    expect(v.issuer).toEqual({ name: "Example Trade", lines: [] });
    expect(v.receivedFrom.gstin).toBe("29ABCDE1234F1Z5");
    expect(v.amount).toContain("$");
    expect(v.heldAsCredit).toContain("500.00");
    expect(v.paidBy).toContain("PayPal");
    expect(v.appliedTo).toEqual([]);
  });

  it("part on an invoice and a refund that succeeded: the credit left is the rest", () => {
    const v = receiptView(
      header({
        amountMinor: 200_000,
        mode: "upi",
        provider: "razorpay",
        allocations: [
          { documentId: "d2", number: "TH/INV/2627/0002", type: "tax_invoice", amountMinor: 118_000 },
        ],
        refundedMinor: 2_000,
      }),
      "TH/RCT/2627/0003",
    );
    expect(v.heldAsCredit).toContain("800.00");
    expect(v.paidBy).toContain("UPI");
  });
});
