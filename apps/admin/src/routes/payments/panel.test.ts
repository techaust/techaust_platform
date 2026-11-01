// The Payments panel's reference column [ADM-PAY-06; M6.2 review finding 13, re-check medium 1]: each entry carries its own label, so the cards below md
// never put a Razorpay payment id under "Bank reference (UTR)" or a TDS certificate under "Payment ID"; the column says "Payment ID" only when every entry
// came through Razorpay. Sample rows only (fake ids).
import { describe, expect, it } from "vitest";
import type { GatewayPaymentRow, InvoicePaymentsPanel } from "../../api.ts";
import { GW_UI } from "../../lib/gateway.ts";
import { PAY_COPY } from "../../lib/payments.ts";
import { referenceHeading, referenceLabel } from "./panel.tsx";
import panelSource from "./panel.tsx?raw";

type Entry = InvoicePaymentsPanel["payments"][number];

const entry = (paymentId: string, over: Partial<Entry> = {}): Entry => ({
  paymentId,
  kind: "payment",
  status: "confirmed",
  receivedOn: "2026-11-01",
  mode: "neft",
  reference: "UTRSAMPLE000123",
  currency: "INR",
  amountMinor: 500_000,
  heldMinor: 500_000,
  tds: null,
  hasProof: false,
  ...over,
});
const tds = (paymentId: string) =>
  entry(paymentId, {
    kind: "tds",
    mode: null,
    reference: null,
    tds: { section: "194J", rateBp: 1000, certificateNo: "SAMPLECERT01", certificateAwaited: false },
  });
const online = (paymentId: string): GatewayPaymentRow =>
  ({ paymentId, provider: "razorpay", providerPaymentId: `pay_SAMPLE${paymentId}` }) as GatewayPaymentRow;

const panelOf = (payments: Entry[], gateway: GatewayPaymentRow[]): InvoicePaymentsPanel =>
  ({
    payments,
    gateway: { payments: gateway, links: [], openReviewCount: 0 },
  }) as unknown as InvoicePaymentsPanel;

describe("the reference column's labels", () => {
  const bank = entry("p-bank");
  const rzp = entry("p-rzp", { mode: "upi", reference: "PAY-SAMPLEP-RZP" });
  const cert = tds("p-tds");

  it("labels each row by what its reference is: UTR, Payment ID, Form 16A number", () => {
    const p = panelOf([bank, rzp, cert], [online("p-rzp")]);
    expect(referenceLabel(p, bank)).toBe(PAY_COPY.reference);
    expect(referenceLabel(p, rzp)).toBe(GW_UI.paymentId);
    expect(referenceLabel(p, cert)).toBe(PAY_COPY.tdsCertificate);
  });

  it("heads the column 'Payment ID' only when every entry came through Razorpay", () => {
    expect(referenceHeading(panelOf([rzp], [online("p-rzp")]))).toBe(GW_UI.paymentId);
    expect(referenceHeading(panelOf([bank, rzp], [online("p-rzp")]))).toBe(PAY_COPY.reference);
    // the code review's case: a TDS entry in an otherwise online table keeps the UTR heading, never "Payment ID" over a certificate number
    expect(referenceHeading(panelOf([rzp, cert], [online("p-rzp")]))).toBe(PAY_COPY.reference);
    expect(referenceHeading(panelOf([bank, cert], []))).toBe(PAY_COPY.reference);
  });

  it("an older API without gateway rows reads every payment as a bank payment", () => {
    const p = { payments: [rzp] } as unknown as InvoicePaymentsPanel;
    expect(referenceLabel(p, rzp)).toBe(PAY_COPY.reference);
    expect(referenceHeading(p)).toBe(PAY_COPY.reference);
  });

  it("the cell carries the row's own label, and its inline label shows only at table width", () => {
    expect(panelSource).toContain("<td data-label={refLabel}>");
    expect(panelSource).not.toContain("data-label={refHead}");
    // the Razorpay row shows Razorpay's own id, not the ledger's normalised reference
    expect(panelSource).toContain("online?.providerPaymentId ?? r.reference");
    // the inline label carries the class payments.css hides below md (the cards' label column says it there)
    expect(panelSource).toContain('className="pay-lines__meta pay-lines__ref-label"');
  });
});
