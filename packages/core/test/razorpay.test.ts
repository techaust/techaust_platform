// Razorpay, pure [ADM-PAY-01, -02, -07, -11, -12, JOB-HOOK-01, -02; M6.2 run file B and H]: the webhook signature (constant-time verify over the raw body, the
// previous secret during a rotation, every malformed header refused), the event id, the event parser (the four link events, `other`, unsafe amounts), the
// link and payment readers (whitelisted fields only), the judge (ok and every verdict), the link request's bounds, the short-URL host check, the method map, the
// reference form, the key guard (a live key with the flag false makes no call) and the provider contract over these helpers. No test calls Razorpay.
import { describe, expect, it, vi } from "vitest";
import { normaliseReference } from "../src/export-invoice.ts";
import { GATEWAY_MIN_MINOR } from "../src/online-pay.ts";
import {
  type CheckoutStatusReport,
  checkProviderContract,
  manualProvider,
  type PaymentProvider,
  type PaymentStatusReport,
} from "../src/payments.ts";
import {
  eventFacts,
  fallbackEventId,
  isRazorpayShortUrl,
  JUDGE_VERDICTS,
  judgeRazorpayPayment,
  keyModeOf,
  LINK_LIFETIME_MS,
  linkRequestOf,
  methodToMode,
  parseRazorpayEvent,
  RAZORPAY_MIN_AMOUNT_MINOR,
  razorpayAllowed,
  razorpayEventIdOf,
  razorpayPaymentRowId,
  razorpayReferenceNorm,
  readRazorpayLink,
  readRazorpayPayment,
  verifyRazorpaySignature,
} from "../src/razorpay.ts";

const enc = new TextEncoder();
async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SECRET = "test-webhook-secret-not-real";
const PREVIOUS = "previous-webhook-secret-not-real";

describe("verifyRazorpaySignature [JOB-HOOK-01]", () => {
  const body = '{"entity":"event","event":"payment_link.paid","created_at":1}';

  it("accepts Razorpay's own published example (razorpay-node validateWebhookSignature)", async () => {
    // Body, secret and signature exactly as in razorpay-node's wiki (Razorpay.validateWebhookSignature): public example data, not a secret.
    expect(
      await verifyRazorpaySignature(
        '{"a":1,"b":2,"c":{"d":3}}',
        "2fe04e22977002e6c7cb553adab8b460cb9e2a4970d5953cb27a8472752e3bbc",
        ["123456"],
      ),
    ).toBe(true);
  });

  it("accepts the right signature, refuses a wrong secret and a body changed by one byte", async () => {
    const sig = await sign(body, SECRET);
    expect(await verifyRazorpaySignature(body, sig, [SECRET])).toBe(true);
    expect(await verifyRazorpaySignature(body, sig, ["another-secret"])).toBe(false);
    expect(await verifyRazorpaySignature(body.replace("paid", "pai d"), sig, [SECRET])).toBe(false);
    expect(await verifyRazorpaySignature(`${body} `, sig, [SECRET])).toBe(false);
  });

  it("is checked on the raw text: the same JSON re-serialised does not verify", async () => {
    const raw = '{ "event": "payment_link.paid",  "created_at": 1 }';
    const sig = await sign(raw, SECRET);
    expect(await verifyRazorpaySignature(raw, sig, [SECRET])).toBe(true);
    expect(await verifyRazorpaySignature(JSON.stringify(JSON.parse(raw)), sig, [SECRET])).toBe(false);
  });

  it("accepts upper-case hex (the same bytes) and the previous secret during a rotation", async () => {
    const sig = await sign(body, PREVIOUS);
    expect(await verifyRazorpaySignature(body, sig.toUpperCase(), [SECRET, PREVIOUS])).toBe(true);
    expect(await verifyRazorpaySignature(body, sig, [SECRET, null, PREVIOUS])).toBe(true);
    expect(await verifyRazorpaySignature(body, sig, [SECRET])).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["not hex", "z".repeat(64)],
    ["63 characters", "a".repeat(63)],
    ["65 characters", "a".repeat(65)],
    ["base64", "Kf4CnRp6Vu9v3V7Vd0fXcnrVmxPpm8Dj5GmTU2rO8pk="],
    ["hex with a space", `${"a".repeat(32)} ${"a".repeat(31)}`],
  ])("refuses a malformed signature (%s) before any key is made", async (_name, sig) => {
    const spy = vi.spyOn(crypto.subtle, "importKey");
    try {
      expect(await verifyRazorpaySignature(body, sig, [SECRET])).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("never verifies with no secret or empty secrets, and never with a non-string input", async () => {
    const sig = await sign(body, SECRET);
    expect(await verifyRazorpaySignature(body, sig, [])).toBe(false);
    expect(await verifyRazorpaySignature(body, sig, ["", undefined])).toBe(false);
    expect(await verifyRazorpaySignature(body, 42 as never, [SECRET])).toBe(false);
    expect(await verifyRazorpaySignature(null as never, sig, [SECRET])).toBe(false);
  });

  it("compares through crypto.subtle.verify (constant time), never as text", async () => {
    const sig = await sign(body, SECRET);
    const spy = vi.spyOn(crypto.subtle, "verify");
    try {
      expect(await verifyRazorpaySignature(body, sig, [SECRET])).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe("HMAC");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the event id [JOB-HOOK-02]", () => {
  it("takes a well-formed header, else the body's SHA-256 (base64url, within 64 characters)", async () => {
    expect(razorpayEventIdOf("Kq2Uq1rTvMxAbc_9")).toBe("Kq2Uq1rTvMxAbc_9");
    for (const bad of [null, undefined, "", "a".repeat(65), "evt id", "evt-1", "évt"])
      expect(razorpayEventIdOf(bad)).toBeNull();
    const a = await fallbackEventId("{}");
    expect(a).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(await fallbackEventId("{}")).toBe(a);
    expect(await fallbackEventId("{ }")).not.toBe(a);
  });
});

const linkEntity = (o: Record<string, unknown> = {}) => ({
  id: "plink_Test0001",
  amount: 118_000,
  currency: "INR",
  status: "paid",
  reference_id: "01900000-0000-7000-8000-000000000001",
  ...o,
});
const paymentEntity = (o: Record<string, unknown> = {}) => ({
  id: "pay_Test0001",
  amount: 118_000,
  currency: "INR",
  status: "captured",
  method: "upi",
  email: "payer@example.test",
  contact: "+910000000000",
  vpa: "payer@upi",
  ...o,
});
const event = (name: string, o: Record<string, unknown> = {}) => ({
  entity: "event",
  account_id: "acc_Test01",
  event: name,
  contains: ["payment_link", "payment"],
  payload: { payment_link: { entity: linkEntity() }, payment: { entity: paymentEntity() } },
  created_at: 1_793_000_000,
  ...o,
});

describe("parseRazorpayEvent [JOB-HOOK-01, L8]", () => {
  it.each([
    ["payment_link.paid", "checkout.paid", "pay_Test0001"],
    ["payment_link.partially_paid", "checkout.partially_paid", "pay_Test0001"],
    ["payment_link.expired", "checkout.expired", null],
    ["payment_link.cancelled", "checkout.cancelled", null],
  ])("reads %s as %s", (name, type, paymentRef) => {
    const r = parseRazorpayEvent(event(name), "evt_1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      id: "evt_1",
      type,
      name,
      checkoutRef: "plink_Test0001",
      paymentRef,
      providerRef: paymentRef ?? "plink_Test0001",
      currency: "INR",
      amountMinor: 118_000,
      occurredAt: 1_793_000_000_000,
      accountId: "acc_Test01",
    });
  });

  it("an event name we do not handle is `other`, with nothing read from its payload", () => {
    const r = parseRazorpayEvent({ event: "refund.created", created_at: 1, payload: { x: 1 } }, "evt_2");
    expect(r).toMatchObject({
      ok: true,
      value: { type: "other", amountMinor: 0, checkoutRef: null, paymentRef: null },
    });
  });

  it.each([
    [
      "an unsafe amount",
      {
        payload: {
          payment_link: { entity: linkEntity() },
          payment: { entity: paymentEntity({ amount: 2 ** 53 }) },
        },
      },
    ],
    [
      "a fractional amount",
      {
        payload: {
          payment_link: { entity: linkEntity() },
          payment: { entity: paymentEntity({ amount: 1.5 }) },
        },
      },
    ],
    [
      "a zero amount",
      {
        payload: {
          payment_link: { entity: linkEntity({ amount: 0 }) },
          payment: { entity: paymentEntity() },
        },
      },
    ],
    [
      "a string amount",
      {
        payload: {
          payment_link: { entity: linkEntity() },
          payment: { entity: paymentEntity({ amount: "118000" }) },
        },
      },
    ],
    [
      "another currency",
      {
        payload: {
          payment_link: { entity: linkEntity() },
          payment: { entity: paymentEntity({ currency: "EUR" }) },
        },
      },
    ],
    [
      "a malformed link id",
      {
        payload: {
          payment_link: { entity: linkEntity({ id: "link 1" }) },
          payment: { entity: paymentEntity() },
        },
      },
    ],
    ["no payment on a paid event", { payload: { payment_link: { entity: linkEntity() } } }],
    ["no payload", { payload: null }],
    ["no time", { created_at: "yesterday" }],
  ])("refuses %s as invalid_event", (_name, over) => {
    expect(parseRazorpayEvent(event("payment_link.paid", over), "evt_3")).toEqual({
      ok: false,
      code: "invalid_event",
    });
  });

  it("refuses a body that is not an object, has no event name, or comes with no event id", () => {
    for (const body of [null, [], "x", 1, { created_at: 1 }])
      expect(parseRazorpayEvent(body, "e").ok).toBe(false);
    expect(parseRazorpayEvent(event("payment_link.paid"), "").ok).toBe(false);
    expect(parseRazorpayEvent(event("payment_link.paid"), "e".repeat(65)).ok).toBe(false);
  });

  it("the facts are a whitelist: ids, amount, currency, method, account; never the payer's email, phone or UPI address", () => {
    const r = parseRazorpayEvent(event("payment_link.paid"), "evt_4");
    if (!r.ok) throw new Error("parse");
    const facts = eventFacts(r.value);
    expect(facts).toEqual({
      event: "payment_link.paid",
      linkId: "plink_Test0001",
      paymentId: "pay_Test0001",
      amountMinor: 118_000,
      currency: "INR",
      method: "upi",
      accountId: "acc_Test01",
    });
    expect(JSON.stringify(facts)).not.toMatch(/example\.test|\+91|@upi/);
  });
});

describe("readRazorpayLink and readRazorpayPayment (whitelisted fields)", () => {
  it("reads a link with its payments, and refuses a malformed one", () => {
    const link = readRazorpayLink({
      ...linkEntity(),
      amount_paid: 118_000,
      order_id: "order_T1",
      short_url: "https://rzp.io/i/abc",
      expire_by: 1_793_604_800,
      payments: [{ payment_id: "pay_Test0001", amount: 118_000, status: "captured", method: "upi" }],
      customer: { email: "payer@example.test" },
    });
    expect(link).toEqual({
      providerRef: "plink_Test0001",
      referenceId: "01900000-0000-7000-8000-000000000001",
      state: "paid",
      currency: "INR",
      amountMinor: 118_000,
      amountPaidMinor: 118_000,
      orderRef: "order_T1",
      payments: [{ paymentRef: "pay_Test0001", amountMinor: 118_000, status: "captured" }],
      shortUrl: "https://rzp.io/i/abc",
      expiresAt: 1_793_604_800_000,
    });
    expect(readRazorpayLink({ ...linkEntity(), payments: null, expire_by: 0 })).toMatchObject({
      payments: [],
      expiresAt: null,
    });
    expect(readRazorpayLink({ ...linkEntity(), status: "unknown" })).toBeNull();
    expect(readRazorpayLink({ ...linkEntity(), payments: [{ payment_id: "x", amount: 1 }] })).toBeNull();
    expect(readRazorpayLink({ ...linkEntity(), payments: "none" })).toBeNull();
    expect(readRazorpayLink(null)).toBeNull();
  });

  it("reads a payment's state, method, fee and tax as Razorpay reports them, never the payer's details", () => {
    const p = readRazorpayPayment({
      ...paymentEntity(),
      fee: 2360,
      tax: 360,
      order_id: "order_T1",
      created_at: 1_793_000_000,
      captured: true,
    });
    expect(p).toEqual({
      providerRef: "pay_Test0001",
      state: "captured",
      currency: "INR",
      amountMinor: 118_000,
      method: "upi",
      feeMinor: 2360,
      feeTaxMinor: 360,
      createdAt: 1_793_000_000_000,
      orderRef: "order_T1",
    });
    expect(JSON.stringify(p)).not.toMatch(/example\.test|\+91|@upi/);
    const base = { ...paymentEntity(), created_at: 1 };
    expect(readRazorpayPayment({ ...base, status: "authorized" })?.state).toBe("pending");
    expect(readRazorpayPayment({ ...base, status: "captured", captured: false })?.state).toBe("pending");
    expect(readRazorpayPayment({ ...base, status: "failed" })?.state).toBe("failed");
    expect(readRazorpayPayment({ ...base, status: "refunded" })?.state).toBe("refunded");
    expect(readRazorpayPayment({ ...base, fee: -1 })?.feeMinor).toBeNull();
    expect(readRazorpayPayment({ ...base, created_at: undefined })).toBeNull();
    expect(readRazorpayPayment({ ...base, id: "pay bad" })).toBeNull();
  });
});

describe("judgeRazorpayPayment [ADM-PAY-02, ADR 0008]", () => {
  const checkout = {
    id: "01900000-0000-7000-8000-000000000001",
    providerLinkId: "plink_Test0001",
    currency: "INR" as const,
    amountMinor: 118_000,
  };
  const link: CheckoutStatusReport = {
    providerRef: "plink_Test0001",
    referenceId: checkout.id,
    state: "paid",
    currency: "INR",
    amountMinor: 118_000,
    amountPaidMinor: 118_000,
    orderRef: "order_T1",
    payments: [{ paymentRef: "pay_Test0001", amountMinor: 118_000, status: "captured" }],
  };
  const payment: PaymentStatusReport = {
    providerRef: "pay_Test0001",
    state: "captured",
    currency: "INR",
    amountMinor: 118_000,
    method: "upi",
    feeMinor: 2360,
    feeTaxMinor: 360,
    createdAt: 1,
    orderRef: "order_T1",
  };

  it("ok when the link is ours, the payment captured, on the link, in its order, with the currency and amount", () => {
    expect(judgeRazorpayPayment(checkout, link, payment)).toEqual({ ok: true });
    expect(
      judgeRazorpayPayment(checkout, { ...link, orderRef: null }, { ...payment, orderRef: null }),
    ).toEqual({ ok: true });
  });

  it.each([
    ["reference_mismatch", { link: { providerRef: "plink_Other" } }],
    ["reference_mismatch", { link: { referenceId: "someone-else" } }],
    ["not_captured", { payment: { state: "pending" } }],
    ["payment_not_on_link", { link: { payments: [] } }],
    ["order_mismatch", { payment: { orderRef: "order_T2" } }],
    ["currency_mismatch", { payment: { currency: "USD" } }],
    ["currency_mismatch", { link: { currency: "USD" } }],
    ["partial_payment", { link: { state: "partially_paid" } }],
    ["amount_mismatch", { payment: { amountMinor: 117_999 } }],
    ["amount_mismatch", { link: { amountMinor: 200_000 } }],
  ] as const)("%s", (verdict, o) => {
    const l = { ...link, ...("link" in o ? o.link : {}) } as CheckoutStatusReport;
    const p = { ...payment, ...("payment" in o ? o.payment : {}) } as PaymentStatusReport;
    expect(judgeRazorpayPayment(checkout, l, p)).toEqual({ ok: false, verdict });
  });

  it("every verdict is reachable and listed", () => {
    expect([...JUDGE_VERDICTS].sort()).toEqual(
      [
        "amount_mismatch",
        "currency_mismatch",
        "not_captured",
        "order_mismatch",
        "partial_payment",
        "payment_not_on_link",
        "reference_mismatch",
      ].sort(),
    );
  });
});

describe("linkRequestOf [ADM-PAY-02, L2, L3, L10]", () => {
  const now = 1_793_000_000_000;
  const base = {
    checkoutId: "01900000-0000-7000-8000-000000000001",
    amountMinor: 118_000,
    documentNumber: "TH/INV/2627/0001",
    documentId: "01900000-0000-7000-8000-0000000000aa",
    expiresAt: now + LINK_LIFETIME_MS,
    callbackUrl: "https://portal.example.test/invoices/abc?pay=return",
    now,
  };

  it("asks for a fixed-amount INR link with no customer, no Razorpay notifications or reminders, our reference and notes", () => {
    const r = linkRequestOf(base);
    expect(r).toEqual({
      ok: true,
      body: {
        amount: 118_000,
        currency: "INR",
        accept_partial: false,
        description: "Invoice TH/INV/2627/0001",
        reference_id: base.checkoutId,
        expire_by: (now + LINK_LIFETIME_MS) / 1000,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { document_id: base.documentId, checkout_id: base.checkoutId },
        callback_url: base.callbackUrl,
        callback_method: "get",
      },
    });
    if (r.ok) {
      expect(r.body).not.toHaveProperty("customer");
      expect(Object.keys(r.body.notes).length).toBeLessThanOrEqual(15);
      for (const v of Object.values(r.body.notes)) expect(v.length).toBeLessThanOrEqual(255);
      expect(r.body.reference_id.length).toBeLessThanOrEqual(40);
    }
  });

  it("rounds the expiry down to whole seconds", () => {
    const r = linkRequestOf({ ...base, expiresAt: now + LINK_LIFETIME_MS + 999 });
    expect(r.ok && r.body.expire_by).toBe((now + LINK_LIFETIME_MS) / 1000);
  });

  it.each([
    ["amount_too_small", { amountMinor: 99 }],
    ["amount_invalid", { amountMinor: 100.5 }],
    ["expiry_out_of_bounds", { expiresAt: now + 15 * 60_000 - 1 }],
    ["expiry_out_of_bounds", { expiresAt: now + 181 * 86_400_000 }],
    ["reference_invalid", { checkoutId: "x".repeat(41) }],
    ["reference_invalid", { checkoutId: "has space" }],
    ["note_too_long", { documentId: "d".repeat(256) }],
    ["callback_invalid", { callbackUrl: "javascript:alert(1)" }],
    ["callback_invalid", { callbackUrl: "http://portal.example.test/pay/return" }],
    ["callback_invalid", { callbackUrl: "https://portal.example.test/pay/return?t=secret-token" }],
    ["callback_invalid", { callbackUrl: "https://portal.example.test/pay/return#t=secret-token" }],
    ["callback_invalid", { callbackUrl: "not a url" }],
  ] as const)("refuses %s", (code, over) => {
    expect(linkRequestOf({ ...base, ...over })).toEqual({ ok: false, code });
  });

  it("allows exactly 100 paise, 15 minutes and 180 days, and a localhost callback for local development", () => {
    expect(linkRequestOf({ ...base, amountMinor: 100 }).ok).toBe(true);
    expect(linkRequestOf({ ...base, expiresAt: now + 15 * 60_000 }).ok).toBe(true);
    expect(linkRequestOf({ ...base, expiresAt: now + 180 * 86_400_000 }).ok).toBe(true);
    expect(linkRequestOf({ ...base, callbackUrl: "http://localhost:5174/pay/return" }).ok).toBe(true);
    expect(RAZORPAY_MIN_AMOUNT_MINOR).toBe(GATEWAY_MIN_MINOR);
  });
});

describe("short URL hosts, methods, references", () => {
  it("allows only https links on rzp.io or razorpay.com", () => {
    for (const ok of [
      "https://rzp.io/i/abc",
      "https://razorpay.com/payment-link/x",
      "https://pages.razorpay.com/x",
    ])
      expect(isRazorpayShortUrl(ok), ok).toBe(true);
    for (const bad of [
      "http://rzp.io/i/abc",
      "https://rzp.io.evil.test/i/abc",
      "https://evilrazorpay.com/x",
      "https://user:pass@rzp.io/i/abc",
      "javascript:alert(1)",
      42,
      `https://rzp.io/${"a".repeat(200)}`,
    ])
      expect(isRazorpayShortUrl(bad), String(bad)).toBe(false);
  });

  it("maps Razorpay's methods to the 0062 modes, anything else to other", () => {
    for (const m of ["upi", "card", "netbanking", "wallet", "emi", "paylater"])
      expect(methodToMode(m)).toBe(m);
    expect(methodToMode("cardless_emi")).toBe("emi");
    for (const m of ["bank_transfer", "", null, undefined, "UPI"]) expect(methodToMode(m)).toBe("other");
  });

  it("the payment row id and the reference form (normaliseReference's rule, the underscore as a hyphen)", () => {
    expect(razorpayPaymentRowId("pay_Test0001")).toBe("rzp_pay_Test0001");
    expect(razorpayReferenceNorm("pay_Test0001")).toBe("PAY-TEST0001");
    expect(normaliseReference(razorpayReferenceNorm("pay_Test0001") ?? "")).toBe("PAY-TEST0001");
    expect(razorpayReferenceNorm("plink_x")).toBeNull();
    expect(razorpayReferenceNorm(`pay_${"a".repeat(57)}`)).toBeNull();
  });
});

describe("the key guard [ADM-PAY-11 for Razorpay, CLAUDE.md rule 7]", () => {
  it("reads a key's mode from its prefix", () => {
    expect(keyModeOf("rzp_test_AbC123")).toBe("test");
    expect(keyModeOf("rzp_live_AbC123")).toBe("live");
    for (const bad of ["", "rzp_test_", "rzp_prod_x", "pk_test_x", null, 1])
      expect(keyModeOf(bad)).toBeNull();
  });

  it("a test key only with Settings on test; a live key only with Settings on live AND the flag exactly true", () => {
    expect(razorpayAllowed("rzp_test_AbC", "test", "false")).toBe(true);
    expect(razorpayAllowed("rzp_test_AbC", "live", "true")).toBe(false);
    expect(razorpayAllowed("rzp_live_AbC", "live", "false")).toBe(false);
    expect(razorpayAllowed("rzp_live_AbC", "live", undefined)).toBe(false);
    expect(razorpayAllowed("rzp_live_AbC", "test", "true")).toBe(false);
    expect(razorpayAllowed("rzp_live_AbC", "live", "true")).toBe(true);
    expect(razorpayAllowed("nonsense", "test", "true")).toBe(false);
    expect(razorpayAllowed(undefined, "test", "true")).toBe(false);
  });
});

describe("a Razorpay provider over these helpers passes the provider contract [ADM-PAY-01]", () => {
  /** A stand-in for stage B2's client: no network (every API call answers `provider_error` unless the key guard refuses it first, with zero fetch calls). */
  const provider = (
    keyId: string,
    settingsMode: string,
    liveFlag: unknown,
    fetchSpy: () => void,
  ): PaymentProvider => {
    const guard = async () => {
      if (!razorpayAllowed(keyId, settingsMode, liveFlag))
        return { ok: false, code: "live_not_allowed" } as const;
      fetchSpy();
      return { ok: false, code: "provider_error" } as const;
    };
    return {
      name: "razorpay",
      mode: keyModeOf(keyId),
      createCheckout: guard,
      verifyWebhook: async (i) =>
        (await verifyRazorpaySignature(i.rawBody, i.headers["x-razorpay-signature"] ?? "", [SECRET]))
          ? { ok: true, value: true }
          : { ok: false, code: "invalid_signature" },
      parseEvent: (i) => {
        try {
          const r = parseRazorpayEvent(JSON.parse(i.rawBody), i.headers["x-razorpay-event-id"] ?? "evt_x");
          return r.ok ? { ok: true, value: r.value } : r;
        } catch {
          return { ok: false, code: "invalid_event" };
        }
      },
      fetchStatus: guard,
      fetchCheckout: guard,
      cancelCheckout: guard,
      refund: async () => ({ ok: false, code: "unsupported" }),
    };
  };

  it("test key: passes with a valid signed webhook", async () => {
    const rawBody = JSON.stringify(event("payment_link.paid"));
    const hook = {
      rawBody,
      headers: { "x-razorpay-signature": await sign(rawBody, SECRET), "x-razorpay-event-id": "evt_ok" },
    };
    expect(
      await checkProviderContract(
        provider("rzp_test_AbC", "test", "false", () => {}),
        { liveAllowed: "false", validWebhook: hook },
      ),
    ).toEqual([]);
  });

  it("live key with the flag false: refused before any fetch", async () => {
    const fetchSpy = vi.fn();
    expect(
      await checkProviderContract(provider("rzp_live_AbC", "live", "false", fetchSpy), {
        liveAllowed: "false",
      }),
    ).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the contract catches a live provider that would call the API while live is not allowed", async () => {
    const leaky: PaymentProvider = {
      ...manualProvider,
      name: "leaky",
      mode: "live",
      fetchCheckout: async () => ({
        ok: true,
        value: {
          providerRef: "p",
          referenceId: null,
          state: "created",
          currency: "INR",
          amountMinor: 1,
          amountPaidMinor: 0,
          orderRef: null,
          payments: [],
        },
      }),
      cancelCheckout: async () => ({ ok: true, value: true }),
    };
    expect(await checkProviderContract(leaky, { liveAllowed: false })).toEqual([
      "fetchCheckout: live mode ran while it is not allowed",
      "cancelCheckout: live mode ran while it is not allowed",
    ]);
  });
});
