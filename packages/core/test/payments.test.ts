// Payment providers and the payment bodies [ADM-PAY-01, ADM-PAY-05, ADM-INV-16, Q60; M6.1]: the live-mode guard (CLAUDE.md rule 7: sandbox only until the owner's
// go-live), the manual provider, the contract helper M6.2 to M6.4 reuse (proved to catch a broken provider), and the zod/mini bodies.
import { describe, expect, it } from "vitest";
import {
  checkProviderContract,
  isProviderMode,
  liveModeAllowed,
  manualProvider,
  type PaymentProvider,
} from "../src/payments.ts";
import {
  creditApplyBody,
  creditReleaseBody,
  paymentsListQuery,
  proofMeta,
  realisationExtensionBody,
  recordPaymentBody,
  tdsCertificateBody,
  verifyPaymentBody,
  warmPayments,
  withdrawPaymentBody,
} from "../src/schemas/payments.ts";

describe("liveModeAllowed [ADM-PAY-01, rule 7]", () => {
  it("test mode always; live only while the flag is exactly true", () => {
    expect(liveModeAllowed("test", false)).toBe(true);
    expect(liveModeAllowed("live", true)).toBe(true);
    expect(liveModeAllowed("live", "true")).toBe(true);
    for (const flag of [false, "false", undefined, null, 1, "TRUE", " true", "yes"])
      expect(liveModeAllowed("live", flag), String(flag)).toBe(false);
    expect(liveModeAllowed("other" as never, true)).toBe(false);
    expect(isProviderMode("live")).toBe(true);
    expect(isProviderMode("prod")).toBe(false);
  });
});

describe("the manual provider and the provider contract [ADM-PAY-01]", () => {
  it("manual answers unsupported to every gateway method and passes the contract", async () => {
    expect(manualProvider.name).toBe("manual");
    expect(manualProvider.mode).toBeNull();
    expect(await manualProvider.fetchStatus("x")).toEqual({ ok: false, code: "unsupported" });
    expect(await checkProviderContract(manualProvider, { liveAllowed: false })).toEqual([]);
  });

  it("the contract catches a provider that throws, answers a bad shape, verifies an empty webhook or runs live while it may not", async () => {
    const ok = { ok: true, value: true } as const;
    const broken: PaymentProvider = {
      name: "",
      mode: "prod" as never,
      createCheckout: async () => ({
        ok: true,
        value: { providerRef: "r", redirectUrl: "https://x.invalid", expiresAt: 1 },
      }),
      verifyWebhook: async () => ok,
      parseEvent: () => ({
        ok: true,
        value: { id: "e", type: "other", providerRef: "r", currency: "INR", amountMinor: 1, occurredAt: 1 },
      }),
      fetchStatus: async () => {
        throw new Error("network");
      },
      refund: async () => ({ ok: false, code: "nope" }) as never,
    };
    const found = await checkProviderContract(broken, { liveAllowed: false });
    expect(found).toEqual(
      expect.arrayContaining([
        "name",
        "mode",
        "verifyWebhook(empty): verified an empty webhook",
        "parseEvent(empty): parsed an empty webhook",
        "fetchStatus: threw",
        "refund: not a ProviderResult",
      ]),
    );
    const live = await checkProviderContract(
      { ...broken, name: "g", mode: "live" },
      { liveAllowed: "false" },
    );
    expect(live).toContain("createCheckout: live mode ran while it is not allowed");
    expect(
      await checkProviderContract({ ...broken, name: "g", mode: "live" }, { liveAllowed: true }),
    ).not.toContain("createCheckout: live mode ran while it is not allowed");
  });

  it("with a valid webhook, the contract wants it verified and parsed into a safe, positive amount", async () => {
    const hook = { rawBody: "{}", headers: { "x-sig": "good" } };
    const good: PaymentProvider = {
      ...manualProvider,
      name: "fake",
      mode: "test",
      verifyWebhook: async (i) =>
        i.headers["x-sig"] === "good" ? { ok: true, value: true } : { ok: false, code: "invalid_signature" },
      parseEvent: (i) =>
        i.rawBody === "{}"
          ? {
              ok: true,
              value: {
                id: "e1",
                type: "payment.captured",
                providerRef: "r",
                currency: "INR",
                amountMinor: 100,
                occurredAt: 1,
              },
            }
          : { ok: false, code: "invalid_event" },
    };
    expect(await checkProviderContract(good, { liveAllowed: false, validWebhook: hook })).toEqual([]);
    const badAmount: PaymentProvider = {
      ...good,
      parseEvent: (i) =>
        i.rawBody === "{}"
          ? {
              ok: true,
              value: {
                id: "e1",
                type: "weird" as never,
                providerRef: "r",
                currency: "INR",
                amountMinor: 0.5,
                occurredAt: 1,
              },
            }
          : { ok: false, code: "invalid_event" },
    };
    expect(await checkProviderContract(badAmount, { liveAllowed: false, validWebhook: hook })).toEqual([
      "parseEvent(valid): amount",
      "parseEvent(valid): type",
    ]);
    expect(await checkProviderContract(manualProvider, { liveAllowed: false, validWebhook: hook })).toEqual([
      "verifyWebhook(valid): refused the valid webhook",
      "parseEvent(valid): did not parse the valid webhook",
    ]);
  });
});

describe("payment bodies (zod/mini) [ADM-PAY-05, ADM-INV-16, Q60]", () => {
  const base = {
    id: "01900000-0000-7000-8000-000000000001",
    clientId: "c1",
    kind: "payment",
    currency: "INR",
    amountMinor: 1000,
    receivedOn: "2026-10-31",
    mode: "neft",
  };
  const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
    r.error?.issues.map((i) => i.message) ?? [];

  it("a payment needs a mode and no TDS; ids are UUIDv7; dates are real", () => {
    expect(recordPaymentBody.safeParse(base).success).toBe(true);
    expect(issues(recordPaymentBody.safeParse({ ...base, mode: null }))).toContain("payment_needs_mode");
    expect(
      issues(recordPaymentBody.safeParse({ ...base, id: "01900000-0000-4000-8000-000000000001" })),
    ).toContain("id_invalid");
    expect(issues(recordPaymentBody.safeParse({ ...base, receivedOn: "2026-02-30" }))).toContain(
      "date_invalid",
    );
    expect(recordPaymentBody.safeParse({ ...base, amountMinor: 0 }).success).toBe(false);
    expect(recordPaymentBody.safeParse({ ...base, amountMinor: 1.5 }).success).toBe(false);
    expect(recordPaymentBody.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      recordPaymentBody.safeParse({
        ...base,
        allocations: Array.from({ length: 11 }, () => ({ documentId: "d", amountMinor: 1 })),
      }).success,
    ).toBe(false);
  });

  it("a TDS row: the TDS block, no mode, no charges, INR, whole onto one invoice; the INR amount is for USD only", () => {
    const tds = {
      ...base,
      kind: "tds",
      mode: undefined,
      tds: { section: "as given by the client", rateBp: 1000 },
      allocations: [{ documentId: "d1", amountMinor: 1000 }],
    };
    expect(recordPaymentBody.safeParse(tds).success).toBe(true);
    expect(issues(recordPaymentBody.safeParse({ ...tds, mode: "neft" }))).toContain("tds_shape");
    expect(issues(recordPaymentBody.safeParse({ ...tds, chargesMinor: 5 }))).toContain("tds_shape");
    expect(
      issues(recordPaymentBody.safeParse({ ...tds, allocations: [{ documentId: "d1", amountMinor: 500 }] })),
    ).toContain("tds_shape");
    expect(issues(recordPaymentBody.safeParse({ ...tds, tds: undefined }))).toContain("tds_shape");
    expect(recordPaymentBody.safeParse({ ...tds, tds: { section: "x", rateBp: 0 } }).success).toBe(false);
    expect(recordPaymentBody.safeParse({ ...tds, tds: { section: "x", rateBp: 10_001 } }).success).toBe(
      false,
    );
    expect(issues(recordPaymentBody.safeParse({ ...base, tds: tds.tds }))).toContain("payment_needs_mode");
    expect(issues(recordPaymentBody.safeParse({ ...base, inrReceivedMinor: 5 }))).toContain(
      "inr_received_usd_only",
    );
    expect(
      recordPaymentBody.safeParse({ ...base, currency: "USD", mode: "swift", inrReceivedMinor: 5 }).success,
    ).toBe(true);
  });

  it("verify, withdraw, certificate, credit, extension and list bodies", () => {
    expect(verifyPaymentBody.safeParse({ decision: "reject", expectedRecordedAt: 1 }).success).toBe(true);
    expect(
      issues(verifyPaymentBody.safeParse({ decision: "reject", expectedRecordedAt: 1, allocations: [] })),
    ).toContain("reject_has_no_allocations");
    expect(withdrawPaymentBody.safeParse({ reason: "  " }).success).toBe(false);
    expect(tdsCertificateBody.safeParse({ certificateNo: "ABC", certificateOn: "2026-13-01" }).success).toBe(
      false,
    );
    expect(
      creditApplyBody.safeParse({ documentId: "d", amountMinor: -1, expectedUpdatedAt: 1 }).success,
    ).toBe(false);
    expect(creditReleaseBody.safeParse({ amountMinor: 1, expectedUpdatedAt: 1 }).success).toBe(true);
    expect(
      realisationExtensionBody.safeParse({ extendedTo: "2027-10-31", bankRef: "x".repeat(65) }).success,
    ).toBe(false);
    expect(paymentsListQuery.safeParse({ status: "lost" }).success).toBe(false);
    expect(proofMeta.safeParse({ kind: "FIRC", ref: "X1" }).success).toBe(true);
  });

  it("the warm-up parses one sample of each of the nine bodies", () => {
    expect(warmPayments()).toBe(9);
  });
});
