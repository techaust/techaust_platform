// The gateway RPC contracts and the gateway queue messages [ADM-PAY-02, -07, JOB-HOOK-02, POR-06; M6.2 run file B]: what crosses a service binding is checked at
// run time (a malformed answer is refused, so the jobs consumer retries), and the gateway message family is recognised before the lead fall-through.
import { describe, expect, it } from "vitest";
import {
  isCreateLinkArgs,
  isCreateLinkResult,
  isIssueAdvanceResult,
  isProcessEventResult,
  isRefreshResult,
  isRpcId,
} from "../src/gateway-rpc.ts";
import {
  GATEWAY_KINDS,
  gatewayAdvanceMessage,
  gatewayEventMessage,
  gatewaySweepMessage,
  isBillingKind,
  isGatewayKind,
  isReportKind,
} from "../src/schemas/messages.ts";
import { warmGatewayMessages } from "../src/warm.ts";

describe("isRpcId", () => {
  it("1 to 64 characters", () => {
    expect(isRpcId("a")).toBe(true);
    expect(isRpcId("a".repeat(64))).toBe(true);
    for (const bad of ["", "a".repeat(65), 1, null, undefined]) expect(isRpcId(bad)).toBe(false);
  });
});

describe("GatewayEvents answers", () => {
  it("processEvent: a known result, and `next` only as a gateway.advance with an id", () => {
    for (const result of ["processed", "ignored", "needs_review", "duplicate", "retry"])
      expect(isProcessEventResult({ result })).toBe(true);
    expect(
      isProcessEventResult({
        result: "processed",
        next: { kind: "gateway.advance", paymentId: "rzp_pay_1" },
      }),
    ).toBe(true);
    for (const bad of [
      null,
      { result: "done" },
      { result: "processed", next: { kind: "care.issue", paymentId: "x" } },
      { result: "processed", next: { kind: "gateway.advance", paymentId: "" } },
      { result: "processed", next: "x" },
    ])
      expect(isProcessEventResult(bad), JSON.stringify(bad)).toBe(false);
  });

  it("issueGatewayAdvance: a known result, an optional number and blocker codes", () => {
    expect(isIssueAdvanceResult({ result: "issued", number: "TH/INV/2627/0001" })).toBe(true);
    expect(isIssueAdvanceResult({ result: "blocked", blockers: ["company_missing"] })).toBe(true);
    expect(isIssueAdvanceResult({ result: "already_issued" })).toBe(true);
    for (const bad of [
      { result: "maybe" },
      { result: "blocked", blockers: [1] },
      { result: "issued", number: 1 },
      7,
    ])
      expect(isIssueAdvanceResult(bad)).toBe(false);
  });
});

describe("PortalPayments arguments and answers", () => {
  const args = {
    provider: "razorpay",
    clientId: "c1",
    contactId: "k1",
    tokenHash: null,
    documentId: "d1",
    amountMinor: 1_000_000,
    returnTo: "invoice",
  };

  it("createLink arguments: ids, a positive safe amount, exactly one of contact or token, a known return page", () => {
    expect(isCreateLinkArgs(args)).toBe(true);
    expect(
      isCreateLinkArgs({ ...args, contactId: null, tokenHash: "h".repeat(64), returnTo: "pay_return" }),
    ).toBe(true);
    for (const bad of [
      { ...args, tokenHash: "h" },
      { ...args, contactId: null },
      { ...args, amountMinor: 0 },
      { ...args, amountMinor: 1.5 },
      { ...args, returnTo: "https://evil.test" },
      { ...args, documentId: "" },
      { ...args, contactId: 5 },
      { ...args, provider: "stripe" },
      { ...args, provider: undefined },
    ])
      expect(isCreateLinkArgs(bad), JSON.stringify(bad)).toBe(false);
    expect(isCreateLinkArgs(null)).toBe(false);
  });

  it("createLink answers: a link, or a known error with its numbers", () => {
    expect(
      isCreateLinkResult({ ok: true, shortUrl: "https://rzp.io/i/x", expiresAt: 1, reused: false }),
    ).toBe(true);
    expect(isCreateLinkResult({ ok: false, error: "amount_below_minimum", minimumMinor: 1_000_000 })).toBe(
      true,
    );
    expect(isCreateLinkResult({ ok: false, error: "not_payable_online", reason: "void" })).toBe(true);
    for (const bad of [
      { ok: true, shortUrl: "x", expiresAt: 1.5, reused: false },
      { ok: true, shortUrl: "x", expiresAt: 1 },
      { ok: false, error: "teapot" },
      { ok: false, error: "amount_above_balance", balanceMinor: -1 },
      { ok: false, error: "not_payable_online", reason: 3 },
      { ok: "yes" },
    ])
      expect(isCreateLinkResult(bad), JSON.stringify(bad)).toBe(false);
  });

  it("refreshForClient answers", () => {
    expect(isRefreshResult({ result: "too_soon" })).toBe(true);
    expect(isRefreshResult({ result: "paid" })).toBe(false);
  });
});

describe("gateway queue messages (L9: the leads queue)", () => {
  it("parse their one id or time, and are recognised as their own family, never as billing or report work", () => {
    expect(gatewayEventMessage.safeParse({ kind: "gateway.event", eventId: "e1" }).success).toBe(true);
    expect(gatewayEventMessage.safeParse({ kind: "gateway.event", eventId: "e".repeat(65) }).success).toBe(
      false,
    );
    expect(gatewayAdvanceMessage.safeParse({ kind: "gateway.advance", paymentId: "" }).success).toBe(false);
    expect(gatewaySweepMessage.safeParse({ kind: "gateway.sweep", asOf: -1 }).success).toBe(false);
    for (const kind of GATEWAY_KINDS) {
      expect(isGatewayKind({ kind })).toBe(true);
      expect(isBillingKind({ kind })).toBe(false);
      expect(isReportKind({ kind })).toBe(false);
    }
    for (const bad of [null, "gateway.event", { kind: "gateway.other" }, { kind: "care.bill" }])
      expect(isGatewayKind(bad)).toBe(false);
  });

  it("the warm-up parses one sample of each of the three", () => {
    expect(warmGatewayMessages()).toBe(3);
  });
});
