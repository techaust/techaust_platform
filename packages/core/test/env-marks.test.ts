// P7 payments (docs/runs/p7-payments.md): the environment marks of Razorpay links and PayPal orders (the analyst's Phase 7 finding 5), and the live-readiness
// rules A2.1 (PayPal hosts follow the mode) and A2.3 (a live mode while the go-live flag is off runs as test).
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/ids.ts";
import { effectiveMode, envMarkVerdict, isEnvMark } from "../src/payments.ts";
import {
  isPayPalApproveUrl,
  isPayPalCertUrl,
  orderRequestOf,
  PAYPAL_BRAND_NAME,
  parsePayPalEvent,
  payPalCustomIdOf,
  payPalEventFacts,
  payPalEventOwnership,
  readPayPalCapture,
  readPayPalMark,
  readPayPalOrder,
} from "../src/paypal.ts";
import {
  eventFacts,
  linkRequestOf,
  parseRazorpayEvent,
  razorpayEnvMarkOf,
  readRazorpayLink,
} from "../src/razorpay.ts";

const CHECKOUT = uuidv7();

describe("the shared rules (core payments.ts)", () => {
  it("envMarkVerdict: same, other, or unmarked (today's path)", () => {
    expect(envMarkVerdict("staging", "staging")).toBe("same");
    expect(envMarkVerdict("production", "staging")).toBe("other");
    expect(envMarkVerdict("staging", "production")).toBe("other");
    expect(envMarkVerdict(null, "staging")).toBe("unmarked");
    expect(envMarkVerdict(undefined, "staging")).toBe("unmarked");
    // A Worker with no ENVIRONMENT never takes a marked event as its own (the safe side).
    expect(envMarkVerdict("staging", null)).toBe("other");
  });

  it("isEnvMark: 1 to 16 lower-case letters", () => {
    for (const ok of ["local", "staging", "production", "warm"]) expect(isEnvMark(ok)).toBe(true);
    for (const bad of ["", "Staging", "prod-1", "a".repeat(17), 1, null]) expect(isEnvMark(bad)).toBe(false);
  });

  it("effectiveMode (A2.3): live only when Settings says live AND the flag is exactly true", () => {
    expect(effectiveMode("live", "true")).toBe("live");
    expect(effectiveMode("live", true)).toBe("live");
    expect(effectiveMode("live", "false")).toBe("test");
    expect(effectiveMode("live", undefined)).toBe("test");
    expect(effectiveMode("live", "TRUE")).toBe("test");
    expect(effectiveMode("test", "true")).toBe("test");
    expect(effectiveMode(undefined, "true")).toBe("test");
    expect(effectiveMode("other", "true")).toBe("test");
  });
});

// ---- Razorpay ---------------------------------------------------------------------------------------------------------------------------------------------

const linkEntity = (notes?: unknown) => ({
  id: "plink_ABC123",
  amount: 118_000,
  currency: "INR",
  status: "paid",
  amount_paid: 118_000,
  reference_id: CHECKOUT,
  ...(notes === undefined ? {} : { notes }),
});
const paidEvent = (linkNotes?: unknown, paymentNotes?: unknown) => ({
  event: "payment_link.paid",
  created_at: 1_790_000_000,
  account_id: "acc_TEST1",
  payload: {
    payment_link: { entity: linkEntity(linkNotes) },
    payment: {
      entity: {
        id: "pay_XYZ789",
        amount: 118_000,
        currency: "INR",
        method: "upi",
        ...(paymentNotes === undefined ? {} : { notes: paymentNotes }),
      },
    },
  },
});

describe("Razorpay: the link carries notes.techaust_env, and events and re-fetches read it", () => {
  const now = 1_790_000_000_000;
  const base = {
    checkoutId: CHECKOUT,
    documentType: "tax_invoice" as const,
    amountMinor: 118_000,
    documentNumber: "TH/INV/2627/0001",
    documentId: uuidv7(),
    expiresAt: now + 7 * 86_400_000,
    callbackUrl: "https://portal.example.test/pay/return",
    now,
    env: "production",
  };

  it("linkRequestOf puts the environment in the notes (at most 15 notes of 255 characters)", () => {
    const r = linkRequestOf(base);
    if (!r.ok) throw new Error(r.code);
    expect(r.body.notes).toEqual({
      document_id: base.documentId,
      checkout_id: CHECKOUT,
      techaust_env: "production",
    });
    expect(Object.keys(r.body.notes).length).toBeLessThanOrEqual(15);
  });

  it("linkRequestOf refuses a malformed environment (env_invalid), so no unmarked link is made by mistake", () => {
    for (const env of ["", "Production", "prod_1", "x".repeat(17)])
      expect(linkRequestOf({ ...base, env })).toEqual({ ok: false, code: "env_invalid" });
  });

  it("parseRazorpayEvent reads the link's mark; the stored facts are unchanged (the mark is not a fact)", () => {
    const marked = parseRazorpayEvent(paidEvent({ techaust_env: "staging", checkout_id: CHECKOUT }), "evt_1");
    if (!marked.ok) throw new Error("parse");
    expect(marked.value.envMark).toBe("staging");
    expect(eventFacts(marked.value)).not.toHaveProperty("env");
    const old = parseRazorpayEvent(paidEvent(), "evt_2");
    expect(old.ok && old.value.envMark).toBeNull();
    const expired = parseRazorpayEvent(
      {
        event: "payment_link.expired",
        created_at: 1,
        payload: { payment_link: { entity: linkEntity({ techaust_env: "local" }) } },
      },
      "evt_3",
    );
    expect(expired.ok && expired.value.envMark).toBe("local");
    const other = parseRazorpayEvent({ event: "order.paid", created_at: 1 }, "evt_4");
    expect(other.ok && other.value.envMark).toBeNull();
  });

  it("razorpayEnvMarkOf: the link's notes, else the payment's, else null; a malformed mark is no mark", () => {
    expect(razorpayEnvMarkOf(paidEvent({ techaust_env: "production" }))).toBe("production");
    expect(razorpayEnvMarkOf(paidEvent(undefined, { techaust_env: "staging" }))).toBe("staging");
    expect(razorpayEnvMarkOf(paidEvent({ techaust_env: "production" }, { techaust_env: "staging" }))).toBe(
      "production",
    );
    expect(razorpayEnvMarkOf(paidEvent())).toBeNull();
    expect(razorpayEnvMarkOf(paidEvent({ techaust_env: "Prod!" }))).toBeNull();
    expect(razorpayEnvMarkOf(paidEvent([1, 2]))).toBeNull();
    // a refund event carries the payment only
    expect(
      razorpayEnvMarkOf({
        event: "refund.processed",
        payload: { payment: { entity: { id: "pay_1", notes: { techaust_env: "staging" } } } },
      }),
    ).toBe("staging");
    expect(razorpayEnvMarkOf(null)).toBeNull();
    expect(razorpayEnvMarkOf({ payload: "x" })).toBeNull();
  });

  it("readRazorpayLink reads the mark of the re-fetched link (null for a link made before P7)", () => {
    expect(readRazorpayLink(linkEntity({ techaust_env: "staging" }))?.envMark).toBe("staging");
    expect(readRazorpayLink(linkEntity())?.envMark).toBeNull();
    expect(readRazorpayLink(linkEntity({ techaust_env: 7 }))?.envMark).toBeNull();
  });
});

// ---- PayPal ------------------------------------------------------------------------------------------------------------------------------------------------

describe("PayPal: custom_id is <checkout id>-<env>, read back as the bare checkout id and the mark", () => {
  const RETURN = `https://portal.example.test/invoices/doc1?pay=paypal&c=${CHECKOUT}`;
  const CANCEL = `https://portal.example.test/invoices/doc1?pay=paypal-cancel&c=${CHECKOUT}`;
  const input = {
    checkoutId: CHECKOUT,
    amountMinor: 50_000,
    documentNumber: "TH/EX/2627/7",
    documentType: "export_invoice" as const,
    returnUrl: RETURN,
    cancelUrl: CANCEL,
    brandName: PAYPAL_BRAND_NAME,
    env: "production",
  };

  it("orderRequestOf: reference_id stays the checkout id; custom_id carries the environment; a bad environment is refused", () => {
    const r = orderRequestOf(input);
    if (!r.ok) throw new Error(r.code);
    const unit = r.body.purchase_units[0];
    expect(unit.reference_id).toBe(CHECKOUT);
    expect(unit.custom_id).toBe(`${CHECKOUT}-production`);
    expect(unit.custom_id).toBe(payPalCustomIdOf(CHECKOUT, "production"));
    expect(unit.custom_id.length).toBeLessThanOrEqual(127);
    for (const env of ["", "PROD", "a-b"])
      expect(orderRequestOf({ ...input, env })).toEqual({ ok: false, code: "reference_invalid" });
  });

  it("readPayPalMark splits only <UUIDv7>-<env>; anything else is kept as it is with no mark", () => {
    expect(readPayPalMark(`${CHECKOUT}-staging`)).toEqual({ customId: CHECKOUT, envMark: "staging" });
    expect(readPayPalMark(CHECKOUT)).toEqual({ customId: CHECKOUT, envMark: null });
    expect(readPayPalMark(null)).toEqual({ customId: null, envMark: null });
    // not a UUIDv7 before the suffix: not ours, read as it is (the ownership rule then says not_ours)
    const v4 = "019a0000-0000-4000-8000-000000000001-staging";
    expect(readPayPalMark(v4)).toEqual({ customId: v4, envMark: null });
    expect(readPayPalMark(`${CHECKOUT}-Staging`)).toEqual({ customId: `${CHECKOUT}-Staging`, envMark: null });
    expect(readPayPalMark("CUST-HighFashions")).toEqual({ customId: "CUST-HighFashions", envMark: null });
  });

  const capture = (customId: string | undefined) => ({
    id: "CAPTURE1",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "500.00" },
    create_time: "2026-11-07T10:00:00Z",
    ...(customId === undefined ? {} : { custom_id: customId }),
    supplementary_data: { related_ids: { order_id: "ORDER1" } },
  });

  it("readPayPalCapture and readPayPalOrder give the bare checkout id and the mark", () => {
    expect(readPayPalCapture(capture(`${CHECKOUT}-staging`))).toMatchObject({
      customId: CHECKOUT,
      envMark: "staging",
    });
    expect(readPayPalCapture(capture(CHECKOUT))).toMatchObject({ customId: CHECKOUT, envMark: null });
    const order = readPayPalOrder({
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          reference_id: CHECKOUT,
          custom_id: `${CHECKOUT}-production`,
          payments: { captures: [capture(`${CHECKOUT}-production`)] },
        },
      ],
    });
    expect(order).toMatchObject({ customId: CHECKOUT, envMark: "production", referenceId: CHECKOUT });
    expect(order?.captures[0]).toMatchObject({ customId: CHECKOUT, envMark: "production" });
  });

  const captureEvent = (customId: string | undefined, type = "PAYMENT.CAPTURE.COMPLETED") => ({
    id: "WH-1AB",
    event_type: type,
    create_time: "2026-11-07T10:00:00Z",
    resource: capture(customId),
  });

  it("parsePayPalEvent: the mark is its own field; the facts keep the bare checkout id and the mark", () => {
    const e = parsePayPalEvent(captureEvent(`${CHECKOUT}-production`));
    if (!e.ok) throw new Error("parse");
    expect(e.value.customId).toBe(CHECKOUT);
    expect(e.value.envMark).toBe("production");
    expect(payPalEventFacts(e.value)).toMatchObject({ checkoutId: CHECKOUT, env: "production" });
    const old = parsePayPalEvent(captureEvent(CHECKOUT));
    if (!old.ok) throw new Error("parse");
    expect(old.value.envMark).toBeNull();
    expect(payPalEventFacts(old.value)).not.toHaveProperty("env");
  });

  it("payPalEventOwnership with env: another environment first, then the M6.4 rules unchanged", () => {
    const of = (customId: string | undefined, env?: string, type?: string) => {
      const e = parsePayPalEvent(captureEvent(customId, type));
      if (!e.ok) throw new Error("parse");
      return payPalEventOwnership(e.value, env);
    };
    expect(of(`${CHECKOUT}-production`, "staging")).toBe("other_env");
    expect(of(`${CHECKOUT}-staging`, "staging")).toBe("ours");
    expect(of(CHECKOUT, "staging")).toBe("ours");
    expect(of("CUST-1", "staging")).toBe("not_ours");
    expect(of(undefined, "staging")).toBe("not_ours");
    // without env (the M6.4 callers), a marked event is judged by its checkout id alone
    expect(of(`${CHECKOUT}-production`)).toBe("ours");
    // a refund's own custom_id is our refund id (no mark): by_capture or ours as before
    expect(of(undefined, "staging", "PAYMENT.CAPTURE.REVERSED")).toBe("by_capture");
  });
});

describe("A2.1: PayPal's hosts follow the mode", () => {
  const cert = (host: string) => `https://${host}/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d`;

  it("isPayPalCertUrl: sandbox host only in test, live host only in live; either with no mode (M6.4)", () => {
    expect(isPayPalCertUrl(cert("api.sandbox.paypal.com"), { mode: "test" })).toBe(true);
    expect(isPayPalCertUrl(cert("api.paypal.com"), { mode: "test" })).toBe(false);
    expect(isPayPalCertUrl(cert("api.paypal.com"), { mode: "live" })).toBe(true);
    expect(isPayPalCertUrl(cert("api.sandbox.paypal.com"), { mode: "live" })).toBe(false);
    expect(isPayPalCertUrl(cert("api.sandbox.paypal.com"))).toBe(true);
    expect(isPayPalCertUrl(cert("api.paypal.com"))).toBe(true);
    expect(isPayPalCertUrl(cert("api.paypal.com.evil.test"), { mode: "live" })).toBe(false);
  });

  it("isPayPalApproveUrl and readPayPalOrder: the approval page of the mode only", () => {
    const sandbox = "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1";
    const live = "https://www.paypal.com/checkoutnow?token=ORDER1";
    expect(isPayPalApproveUrl(sandbox, "ORDER1", "test")).toBe(true);
    expect(isPayPalApproveUrl(live, "ORDER1", "test")).toBe(false);
    expect(isPayPalApproveUrl(live, "ORDER1", "live")).toBe(true);
    expect(isPayPalApproveUrl(sandbox, "ORDER1", "live")).toBe(false);
    expect(isPayPalApproveUrl(sandbox, "ORDER1")).toBe(true);
    const order = (href: string) => ({
      id: "ORDER1",
      status: "PAYER_ACTION_REQUIRED",
      links: [{ rel: "payer-action", href }],
    });
    expect(readPayPalOrder(order(sandbox), "test")?.payerActionUrl).toBe(sandbox);
    expect(readPayPalOrder(order(live), "test")?.payerActionUrl).toBeNull();
    expect(readPayPalOrder(order(live), "live")?.payerActionUrl).toBe(live);
    expect(readPayPalOrder(order(live))?.payerActionUrl).toBe(live);
  });
});
