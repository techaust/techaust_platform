// M6.5's contracts in core [ADM-PAY-08 to -11, ADM-INV-17, JOB-HOOK-01..03, JOB-PDF-01; run file B, L3, L12, L33 to L38; 08-C RA-38, RA-41, RB-43]: the provider
// contract with refunds (a live key with the flag false refunds and fetches nothing), the RPC answers and their guards, the queue kinds, the request bodies, the
// settings default, and the realisation stage with its M6.5 facts. Invented test data.
import { describe, expect, it } from "vitest";
import { isIssueReceiptResult } from "../src/care-billing.ts";
import {
  CHECK_REFUND_RESULTS,
  isCheckRefundResult,
  isFetchSettlementsArgs,
  isFetchSettlementsResult,
  REFUND_CHECK_MAX_ATTEMPTS,
} from "../src/gateway-rpc.ts";
import { DEFAULT_REALISATION_RULES, realisationStatus, stageOf } from "../src/gst/index.ts";
import {
  checkProviderContract,
  manualProvider,
  type PaymentProvider,
  PROVIDER_EVENT_TYPES,
  REFUND_STATES,
  refundStateOf,
} from "../src/payments.ts";
import { isReceiptKind, isReceiptMessage, RECEIPT_SWEEP_MAX } from "../src/pdf-jobs.ts";
import {
  isRefundKind,
  reconFetchMessage,
  refundCheckMessage,
  refundSweepMessage,
} from "../src/schemas/messages.ts";
import {
  bankMatchBody,
  realisationReductionBody,
  reconFetchBody,
  refundBody,
  warmRefundBodies,
} from "../src/schemas/payments.ts";
import { resolveSetting, SETTINGS_DEFAULTS } from "../src/schemas/settings.ts";

const d = (year: number, month: number, day: number) => ({ year, month, day });

describe("the provider contract with refunds (ADM-PAY-11)", () => {
  it("the M6.5 event types are listed; the manual provider refunds and fetches nothing", async () => {
    for (const t of [
      "refund.created",
      "refund.failed",
      "dispute.opened",
      "dispute.closed",
      "refund.processed",
    ])
      expect(PROVIDER_EVENT_TYPES).toContain(t);
    expect(await checkProviderContract(manualProvider, { liveAllowed: false })).toEqual([]);
    expect(await manualProvider.fetchRefund?.({ refundRef: "x" })).toEqual({
      ok: false,
      code: "unsupported",
    });
    expect(REFUND_STATES).toEqual(["pending", "processed", "failed"]);
    expect(refundStateOf({ refundRef: "r" })).toBe("pending");
    expect(refundStateOf({ refundRef: "r", state: "processed" })).toBe("processed");
  });

  it("a live provider that refunds or fetches a refund while the flag is false fails the contract; one that refuses passes", async () => {
    const ok = { ok: true as const, value: { refundRef: "rfnd_1", state: "processed" as const } };
    const refused = { ok: false as const, code: "live_not_allowed" as const };
    const base: PaymentProvider = {
      ...manualProvider,
      name: "fake",
      mode: "live",
      createCheckout: async () => refused,
      fetchStatus: async () => refused,
      fetchCheckout: async () => refused,
      cancelCheckout: async () => refused,
      refund: async () => refused,
      fetchRefund: async () => refused,
    };
    expect(await checkProviderContract(base, { liveAllowed: false })).toEqual([]);
    expect(await checkProviderContract({ ...base, refund: async () => ok }, { liveAllowed: false })).toEqual([
      "refund: live mode ran while it is not allowed",
    ]);
    expect(
      await checkProviderContract({ ...base, fetchRefund: async () => ok }, { liveAllowed: false }),
    ).toEqual(["fetchRefund: live mode ran while it is not allowed"]);
    // the flag exactly true lets a live provider run
    expect(
      await checkProviderContract(
        { ...base, refund: async () => ok, fetchRefund: async () => ok },
        { liveAllowed: "true" },
      ),
    ).toEqual([]);
  });
});

describe("the RPC answers and their guards (L34)", () => {
  it("checkRefund, fetchSettlements, issueReceipt", () => {
    for (const result of CHECK_REFUND_RESULTS) expect(isCheckRefundResult({ result })).toBe(true);
    expect(isCheckRefundResult({ result: "done" })).toBe(false);
    expect(isCheckRefundResult({ result: "succeeded", extra: 1 })).toBe(false);
    expect(REFUND_CHECK_MAX_ATTEMPTS).toBe(10);
    expect(isFetchSettlementsArgs({ provider: "razorpay", day: "2026-11-02", skip: 0 })).toBe(true);
    expect(isFetchSettlementsArgs({ provider: "stripe", day: "2026-11-02", skip: 0 })).toBe(false);
    expect(isFetchSettlementsArgs({ provider: "razorpay", day: "2026-11-2", skip: 0 })).toBe(false);
    expect(isFetchSettlementsArgs({ provider: "razorpay", day: "2026-11-02", skip: -1 })).toBe(false);
    expect(isFetchSettlementsResult({ result: "stored", next: { skip: 100 } })).toBe(true);
    expect(isFetchSettlementsResult({ result: "stored", next: { skip: 0 } })).toBe(false);
    expect(isFetchSettlementsResult({ result: "empty" })).toBe(true);
    expect(isFetchSettlementsResult({ result: "nope" })).toBe(false);
    expect(isFetchSettlementsResult({ result: "empty", other: 1 })).toBe(false);
    expect(isIssueReceiptResult({ result: "issued", number: "TH/RCT/2627/0001" })).toBe(true);
    expect(isIssueReceiptResult({ result: "not_eligible", why: "tds" })).toBe(true);
    expect(isIssueReceiptResult({ result: "issued", number: 1 })).toBe(false);
    expect(isIssueReceiptResult({ result: "issued", amount: 1 })).toBe(false);
    expect(isIssueReceiptResult(null)).toBe(false);
  });
});

describe("the queue kinds (one unit of work each)", () => {
  it("receipt.issue and receipt.sweep on PDF_QUEUE; refund.check, refund.sweep and recon.fetch on the leads queue", () => {
    expect(isReceiptMessage({ v: 1, kind: "receipt.issue", paymentId: "pay-1" })).toBe(true);
    expect(isReceiptMessage({ v: 1, kind: "receipt.issue", paymentId: "x".repeat(61) })).toBe(false);
    expect(isReceiptMessage({ v: 1, kind: "receipt.sweep", asOf: 5 })).toBe(true);
    expect(isReceiptMessage({ v: 1, kind: "receipt.sweep", asOf: -5 })).toBe(false);
    expect(isReceiptMessage({ v: 2, kind: "receipt.issue", paymentId: "p" })).toBe(false);
    expect(isReceiptMessage({ v: 1, kind: "pdf.render" })).toBe(false);
    expect(isReceiptKind({ kind: "receipt.issue" })).toBe(true);
    expect(isReceiptKind({ kind: "pdf.render" })).toBe(false);
    expect(isReceiptKind(null)).toBe(false);
    expect(RECEIPT_SWEEP_MAX).toBe(20);
    expect(refundCheckMessage.safeParse({ kind: "refund.check", refundId: "r-1" }).success).toBe(true);
    expect(refundSweepMessage.safeParse({ kind: "refund.sweep", asOf: 1 }).success).toBe(true);
    expect(
      reconFetchMessage.safeParse({ kind: "recon.fetch", provider: "razorpay", day: "2026-11-02", skip: 0 })
        .success,
    ).toBe(true);
    expect(
      reconFetchMessage.safeParse({ kind: "recon.fetch", provider: "stripe", day: "2026-11-02", skip: 0 })
        .success,
    ).toBe(false);
    expect(isRefundKind({ kind: "recon.fetch" })).toBe(true);
    expect(isRefundKind({ kind: "gateway.event" })).toBe(false);
  });
});

describe("the request bodies (codes only)", () => {
  const id = "01900000-0000-7000-8000-000000000009";
  it("a refund: one way, a document only from a document, chargeback with its reason, pending only through the gateway", () => {
    expect(
      refundBody.safeParse({ id, amountMinor: 100, from: "credit", reasonCode: "overpayment" }).success,
    ).toBe(true);
    expect(
      refundBody.safeParse({ id, amountMinor: 100, from: "document", reasonCode: "credit_note" }).success,
    ).toBe(false);
    expect(
      refundBody.safeParse({ id, amountMinor: 100, from: "credit", documentId: "inv", reasonCode: "other" })
        .success,
    ).toBe(false);
    expect(
      refundBody.safeParse({
        id,
        amountMinor: 100,
        from: "document",
        documentId: "inv",
        creditNoteId: "cn",
        reasonCode: "credit_note",
      }).success,
    ).toBe(true);
    expect(
      refundBody.safeParse({
        id,
        amountMinor: 100,
        from: "credit",
        reasonCode: "chargeback",
        outside: { providerRefundId: "dp_1", origin: "chargeback", settledOn: "2026-11-02" },
      }).success,
    ).toBe(true);
    expect(
      refundBody.safeParse({
        id,
        amountMinor: 100,
        from: "credit",
        reasonCode: "other",
        outside: { providerRefundId: "dp_1", origin: "chargeback", settledOn: "2026-11-02" },
      }).success,
    ).toBe(false);
    const manual = { mode: "neft", reference: "UTR1", paidOn: "2026-11-02", paidTo: "original" };
    expect(
      refundBody.safeParse({ id, amountMinor: 100, from: "pending", reasonCode: "duplicate", manual })
        .success,
    ).toBe(false);
    expect(
      refundBody.safeParse({
        id,
        amountMinor: 100,
        from: "credit",
        reasonCode: "other",
        manual,
        outside: { providerRefundId: "r", origin: "outside", settledOn: "2026-11-02" },
      }).success,
    ).toBe(false);
    expect(refundBody.safeParse({ id, amountMinor: 0, from: "credit", reasonCode: "other" }).success).toBe(
      false,
    );
    expect(
      refundBody.safeParse({ id: "not-a-uuid", amountMinor: 1, from: "credit", reasonCode: "other" }).success,
    ).toBe(false);
    expect(
      bankMatchBody.safeParse({ id, target: { kind: "settlement", id: "s" }, statementOn: "2026-11-03" })
        .success,
    ).toBe(true);
    expect(reconFetchBody.safeParse({ day: "2026-13-01" }).success).toBe(false);
    expect(
      realisationReductionBody.safeParse({
        id,
        amountMinor: 1,
        approvedOn: "2026-11-03",
        bankRef: "R",
        declaration: false,
      }).success,
    ).toBe(true);
    expect(warmRefundBodies()).toBe(5);
  });
});

describe("settings: the RA-41 proviso default and the PA-CB figure", () => {
  it("₹1,000.00 by default and for a row saved before it; never above ₹1,000; the cross-border warning stays ₹25 lakh", () => {
    expect(SETTINGS_DEFAULTS.tax.excessProvisoMinor).toBe(1_000_00);
    expect(SETTINGS_DEFAULTS.tax.crossBorderWarnInrMinor).toBe(25_00_000_00);
    const stored = { ...SETTINGS_DEFAULTS.tax } as Record<string, unknown>;
    delete stored.excessProvisoMinor;
    expect(resolveSetting("tax", stored).excessProvisoMinor).toBe(1_000_00);
    expect(() => resolveSetting("tax", { ...SETTINGS_DEFAULTS.tax, excessProvisoMinor: 1_000_01 })).toThrow();
  });
});

describe("the realisation stage with M6.5's facts (RB-43, RA-38; the twin of stageSql)", () => {
  const dates = { femaDue: d(2027, 8, 3), gstDue: d(2027, 11, 18) };
  const facts = { paidMinor: 1_000, totalMinor: 1_000, reductionsMinor: 0, proofMissing: false };
  it("nothing outstanding but less received than the total: reduction pending until reductions cover it", () => {
    expect(stageOf(dates, 0, d(2026, 12, 1), 30, true, { ...facts, paidMinor: 600 })).toBe(
      "reduction_pending",
    );
    expect(
      stageOf(dates, 0, d(2026, 12, 1), 30, true, { ...facts, paidMinor: 600, reductionsMinor: 400 }),
    ).toBe("realised");
    expect(stageOf(dates, 0, d(2026, 12, 1), 30, false, { ...facts, paidMinor: 600 })).toBe(
      "reduction_pending",
    );
    // without facts the balance alone decides, as before M6.5
    expect(stageOf(dates, 0, d(2026, 12, 1), 30)).toBe("realised");
  });
  it("an LUT export with a card or PayPal payment lacking its proof: GST stages on its dates, else ok; never the FEMA stages", () => {
    const missing = { ...facts, proofMissing: true };
    expect(stageOf(dates, 0, d(2026, 12, 1), 30, true, missing)).toBe("ok");
    expect(stageOf(dates, 0, d(2027, 8, 10), 30, true, missing)).toBe("ok");
    expect(stageOf(dates, 0, d(2027, 11, 1), 30, true, missing)).toBe("gst_approaching");
    expect(stageOf(dates, 0, d(2027, 11, 19), 30, true, missing)).toBe("gst_overdue");
    // IGST paid (no LUT): the proof rule does not apply
    expect(stageOf(dates, 0, d(2027, 11, 19), 30, false, missing)).toBe("realised");
    // something outstanding: as before
    expect(stageOf(dates, 1, d(2027, 8, 4), 30, false, missing)).toBe("fema_overdue");
  });
  it("realisationStatus passes the facts and refuses a bad one", () => {
    const input = {
      invoiceDate: d(2026, 11, 3),
      currency: "USD" as const,
      supplyType: "export_lut" as const,
      outstandingMinor: 0,
    };
    const r = realisationStatus(
      { ...input, facts: { ...facts, paidMinor: 1 } },
      d(2026, 12, 1),
      DEFAULT_REALISATION_RULES,
    );
    expect(r.ok && r.value.stage).toBe("reduction_pending");
    const bad = realisationStatus(
      { ...input, facts: { ...facts, paidMinor: 0.5 } },
      d(2026, 12, 1),
      DEFAULT_REALISATION_RULES,
    );
    expect(bad.ok).toBe(false);
  });
});
