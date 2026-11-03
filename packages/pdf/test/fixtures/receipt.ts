// M6.5 (ADM-PAY-09; run file G8): the receipt PDF's fixtures, made the way the jobs Worker makes a receipt (core `receiptHeaderOf`, then `receiptView`): both
// currencies, long names, ten "Applied to" lines, the credit remainder, and the longest list (50 lines and "and {n} more"). Invented sample data only: every
// name, number and reference is made up (example.test addresses, a made-up GSTIN).
import { receiptHeaderOf } from "@techaust/core/receipts";
import { type ReceiptLayoutView, receiptView } from "../../src/receipt-view.ts";

export type ReceiptFixtureName = "inr-one" | "usd-credit" | "long-ten" | "longest";

const ISSUER = {
  tradeName: "TecHaust Technologies",
  legalName: "Sample Legal Name (sample data)",
  address: "1 Sample Road, Sample Town, West Bengal 733101 · State West Bengal (19)",
  gstin: "19AAAAA0000A1Z5",
  email: "billing@example.test",
};

const inv = (n: number, amountMinor: number) => ({
  documentId: `doc-${n}`,
  number: `TH/INV/2627/${String(n).padStart(4, "0")}`,
  type: "tax_invoice",
  amountMinor,
});

/** One receipt fixture as the layout receives it. */
export function receiptFixture(name: ReceiptFixtureName): ReceiptLayoutView {
  const common = { issuer: ISSUER, issuedOn: "2026-11-03" };
  const h =
    name === "inr-one"
      ? receiptHeaderOf({
          ...common,
          payment: {
            id: "pay-sample-1",
            currency: "INR",
            amountMinor: 11_80_000,
            receivedOn: "2026-11-02",
            provider: "manual",
            mode: "neft",
            referenceNorm: "SAMPLEUTR0001",
            refundedMinor: 0,
          },
          allocations: [inv(12, 11_80_000)],
          client: { name: "Sample Client Private Limited", gstin: "29AAAAA0000A1Z5" },
        })
      : name === "usd-credit"
        ? receiptHeaderOf({
            ...common,
            payment: {
              id: "pay-sample-2",
              currency: "USD",
              amountMinor: 2_500_00,
              receivedOn: "2026-11-01",
              provider: "paypal",
              mode: null,
              referenceNorm: "SAMPLECAPTURE00002",
              refundedMinor: 0,
            },
            allocations: [{ ...inv(7, 2_000_00), type: "export_invoice" }],
            client: { name: "Sample Overseas Client LLC", gstin: null },
          })
        : receiptHeaderOf({
            ...common,
            payment: {
              id: "pay-sample-3",
              currency: "INR",
              amountMinor: name === "longest" ? 9_99_99_999_99 : 1_23_45_678_90,
              receivedOn: "2026-10-28",
              provider: "razorpay",
              mode: "upi",
              referenceNorm: "SAMPLEPAYMENTIDWITHAVERYLONGREFERENCE0003",
              refundedMinor: 25_000_00,
            },
            allocations: Array.from({ length: name === "longest" ? 60 : 10 }, (_, i) =>
              inv(100 + i, 1_00_000_00 + i * 1_234_00),
            ),
            client: {
              name: "The Sample Long-Named Educational and Charitable Society of North Bengal and the Dooars (Registered)",
              gstin: "19AAAAA0000A1Z5",
            },
          });
  if (!h.ok) throw new Error(`fixture ${name}: ${h.code}`);
  return receiptView(h.value, name === "usd-credit" ? "TH/RCT/2627/0002" : "TH/RCT/2627/0001");
}
