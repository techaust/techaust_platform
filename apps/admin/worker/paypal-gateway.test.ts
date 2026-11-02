// M6.4 PayPal in the admin finance Worker [ADM-PAY-01, -03, -04, -06, -07, -11, -12, ADM-INV-10, JOB-HOOK-02, POR-06; run file C and I, early check 1 "B2 must
// carry"]: the order (its body, request id, our return URL), reuse and the local end of an old one, the capture on the client's return (confirmed in one batch),
// a double return, the return racing CHECKOUT.ORDER.APPROVED, a decline (released, the approval link back), PayPal holding a capture and completing it later,
// a declined capture, an unreachable PayPal (the claim kept), a mismatch, the document changed (no capture call), past the grace (no capture call), the
// abandoned claim, the late capture on an ended row, a reversal after confirmation, a USD proforma waiting for the Owner, the provider switch both ways, the live
// guard with zero calls, the token cache, the provider contract and the 45-statement budget. PayPal is never called: the stub transport answers.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { checkProviderContract } from "@techaust/core/payments";
import { PAYPAL_CAPTURE_GRACE_MS, PAYPAL_CLAIM_STALE_MS } from "@techaust/core/paypal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { refreshCheckoutById, refreshForClient } from "./gateway/links.ts";
import { payPalProvider } from "./gateway/paypal.ts";
import { capturePayPalReturn } from "./gateway/paypal-capture.ts";
import { payPalTokensMinted } from "./gateway/paypal-token.ts";
import { countingEnv, owner, staffLink } from "./test-gateway.ts";
import { one, rows, withEnv } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { issueInvoice, json, putBank, putCompany } from "./test-invoices.ts";
import {
  apiCalls,
  capOf,
  liveOrder,
  orderAnswer,
  payPalEventRow,
  payPalLink,
  paypalCalls,
  paypalStub,
  ppCheckout,
  ppError,
  ppJson,
  ppPaymentOf,
} from "./test-paypal.ts";
import { liveSession, stripeCalls, stripeLink, stripeStub, usdClient, usdDoc } from "./test-stripe.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  paypalStub();
});
afterEach(() => setStubTransport(null));

const ledger = (id: string) =>
  one<{ status: string; paid_minor: number; balance_minor: number }>(
    "SELECT status, paid_minor, balance_minor FROM documents WHERE id = ?1",
    id,
  );
const reviewKinds = async (column: string, id: string) =>
  (
    await rows<{ kind: string }>(
      `SELECT kind FROM review_items WHERE ${column} = ?1 ORDER BY created_at, id`,
      id,
    )
  ).map((r) => r.kind);
const eventOf = (id: string) =>
  one<{ status: string; outcome: string | null }>(
    "SELECT status, outcome FROM webhook_events WHERE id = ?1",
    id,
  );
const captures = () => apiCalls().filter((c) => c.method === "POST" && c.path.endsWith("/capture"));
const ret = (o: { checkoutId: string; orderId: string }, now?: number) =>
  capturePayPalReturn(env, { checkoutId: o.checkoutId, token: o.orderId }, now);

describe("the PayPal order [POR-06, L3, L4, L10, L19; run file C PortalPayments]", () => {
  it("makes an order with our request id, our marks and return URL, no payer field; the row goes live with PayPal's approval page", async () => {
    const o = await liveOrder();
    const create = apiCalls().find((x) => x.method === "POST" && x.path === "/v2/checkout/orders");
    expect(create?.requestId).toBe(`ord-${o.checkoutId}`);
    expect(create?.prefer).toBe("return=minimal");
    expect(create?.auth).toMatch(/^Bearer /);
    const body = (create?.body ?? {}) as Record<string, unknown>;
    const unit = (body.purchase_units as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(unit).toMatchObject({
      reference_id: o.checkoutId,
      custom_id: o.checkoutId,
      amount: { currency_code: "USD", value: "500.00" },
    });
    expect(String(unit.invoice_id)).toMatch(new RegExp(`-${o.checkoutId.slice(-12)}$`));
    expect(String(unit.description)).toMatch(/^Invoice EXP\//);
    const ctx = (body.payment_source as { paypal: { experience_context: Record<string, string> } }).paypal
      .experience_context;
    expect(ctx).toMatchObject({
      brand_name: "TecHaust Technologies",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
      return_url: `http://localhost:5174/invoices/${o.documentId}?pay=paypal&c=${o.checkoutId}`,
      cancel_url: `http://localhost:5174/invoices/${o.documentId}?pay=paypal-cancel&c=${o.checkoutId}`,
    });
    expect(Object.keys(create?.body ?? {}).sort()).toEqual(["intent", "payment_source", "purchase_units"]);
    expect(o.url).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${o.orderId}`);
    expect(await ppCheckout(o.checkoutId)).toMatchObject({ status: "live", provider_link_id: o.orderId });
  });

  it("reuses the open order for the same amount (no call); a new amount ends the old one HERE (no PayPal call) and makes a new one", async () => {
    const o = await liveOrder();
    paypalStub();
    expect(await payPalLink(o, o.documentId, 50_000)).toMatchObject({
      ok: true,
      reused: true,
      checkoutId: o.checkoutId,
    });
    expect(paypalCalls).toEqual([]);
    const other = await payPalLink(o, o.documentId, 20_000);
    expect(other.ok).toBe(true);
    expect(apiCalls().map((x) => `${x.method} ${x.path}`)).toEqual(["POST /v2/checkout/orders"]);
    expect((await ppCheckout(o.checkoutId))?.status).toBe("cancelled");
  });

  it("an approval URL off PayPal's own www hosts, or a create error: the row fails, 502; an emailed link returns to pay/return", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    paypalStub((path, method) =>
      method === "POST" && path === "/v2/checkout/orders"
        ? ppJson(200, {
            id: "5O190127TN364715T",
            status: "PAYER_ACTION_REQUIRED",
            links: [
              {
                rel: "payer-action",
                href: "https://www.paypal.com.evil.test/checkoutnow?token=5O190127TN364715T",
              },
            ],
          })
        : null,
    );
    expect(await payPalLink(c, documentId)).toEqual({ ok: false, error: "gateway_error" });
    paypalStub((path, method) =>
      method === "POST" && path === "/v2/checkout/orders" ? ppError(500, "INTERNAL_SERVER_ERROR") : null,
    );
    expect(await payPalLink(c, documentId)).toEqual({ ok: false, error: "gateway_error" });
    expect(
      (
        await rows<{ status: string }>(
          "SELECT status FROM checkout_sessions WHERE document_id = ?1",
          documentId,
        )
      ).map((r) => r.status),
    ).toEqual(["failed", "failed"]);
  });

  it("live while it isn't allowed: 503 live_not_allowed with ZERO calls, the token's included; no keys: gateway_unavailable [ADM-PAY-11, rule 7]", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const before = await one<{ value: string; version: number }>(
      "SELECT value, version FROM settings WHERE key = 'gateways'",
    );
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, version) VALUES ('gateways', ?1, ?2)")
      .bind(
        JSON.stringify({ razorpay: { mode: "test" }, stripe: { mode: "test" }, paypal: { mode: "live" } }),
        (before?.version ?? 0) + 1,
      )
      .run();
    try {
      paypalStub();
      expect(await payPalLink(c, documentId)).toEqual({ ok: false, error: "live_not_allowed" });
      expect(paypalCalls).toEqual([]);
    } finally {
      if (before)
        await env.DB.prepare("UPDATE settings SET value = ?1, version = ?2 WHERE key = 'gateways'")
          .bind(before.value, before.version)
          .run();
      else await env.DB.prepare("DELETE FROM settings WHERE key = 'gateways'").run();
    }
    const noKeys = withEnv(env, { PAYPAL_CLIENT_SECRET: "" });
    expect(await payPalLink(c, documentId, 50_000, noKeys)).toEqual({
      ok: false,
      error: "gateway_unavailable",
    });
    expect(paypalCalls).toEqual([]);
    expect(await one("SELECT id FROM checkout_sessions WHERE document_id = ?1", documentId)).toBeNull();
  });

  it("staff never make a PayPal order (L4: the staff link is the portal page)", async () => {
    const o = await owner();
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const res = await staffLink(o, documentId, 50_000, 7000);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: "not_payable_online",
      details: { reason: "use_portal" },
    });
  });

  it("two parallel clicks make one order; the token is minted once and reused", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const minted = payPalTokensMinted();
    const both = await Promise.all([payPalLink(c, documentId), payPalLink(c, documentId)]);
    expect(both.filter((r) => r.ok && !r.reused)).toHaveLength(1);
    expect(apiCalls().filter((x) => x.method === "POST" && x.path === "/v2/checkout/orders")).toHaveLength(1);
    const d2 = await usdDoc(c.clientId);
    expect((await payPalLink(c, d2)).ok).toBe(true);
    expect(payPalTokensMinted() - minted).toBe(1);
  });

  it("a 401 drops the cached token and the call is tried once more with a new one", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    let first = true;
    paypalStub((path, method) => {
      if (method === "POST" && path === "/v2/checkout/orders" && first) {
        first = false;
        return ppJson(401, { error: "invalid_token" });
      }
      return null;
    });
    expect((await payPalLink(c, documentId)).ok).toBe(true);
    expect(paypalCalls.filter((x) => x.path === "/v1/oauth2/token")).toHaveLength(2);
    // The secret travels only in the token call's Basic header, never elsewhere.
    expect(paypalCalls.filter((x) => x.auth?.startsWith("Basic "))).toHaveLength(2);
  });
});

describe("the capture on the client's return [L2, L19, ADR 0008; C steps 2 to 5]", () => {
  it("captures once, confirms in one batch: the payment, the allocation, the invoice paid, the checkout paid with its capture id", async () => {
    const o = await liveOrder();
    paypalStub();
    expect(await ret(o)).toEqual({ state: "paid" });
    const cap = captures();
    expect(cap).toHaveLength(1);
    expect(cap[0]?.requestId).toMatch(new RegExp(`^cap-${o.checkoutId}-\\d+$`));
    expect(cap[0]?.prefer).toBe("return=representation");
    const p = await ppPaymentOf(capOf(o.orderId));
    expect(p).toMatchObject({
      id: `ppl_${capOf(o.orderId)}`,
      status: "confirmed",
      amount_minor: 50_000,
      currency: "USD",
      mode: "wallet",
      charges_minor: 1_500,
      fee_tax_minor: null,
      inr_received_minor: null,
      gateway_fee_inr_minor: null,
      reference_norm: `PPL-${capOf(o.orderId)}`,
      checkout_id: o.checkoutId,
    });
    expect(await ledger(o.documentId)).toMatchObject({ status: "paid", balance_minor: 0 });
    expect(await ppCheckout(o.checkoutId)).toMatchObject({
      status: "paid",
      provider_capture_id: capOf(o.orderId),
      paid_payment_id: p?.id,
    });
    // The owners' bell names the client, the amount and the number (no payer detail).
    expect(
      await one<{ title: string }>(
        "SELECT title FROM notifications WHERE entity_id = ?1 AND kind = 'payment.online'",
        p?.id,
      ),
    ).toMatchObject({ title: expect.stringMatching(/ paid \S*500\.00 by PayPal for EXP\//) });
    // A second return (a reload): paid, no second capture.
    paypalStub();
    expect(await ret(o)).toEqual({ state: "paid" });
    expect(captures()).toEqual([]);
  });

  it("a token that isn't the stored order, or an unknown checkout: not_found, nothing captured", async () => {
    const o = await liveOrder();
    paypalStub();
    expect(await capturePayPalReturn(env, { checkoutId: o.checkoutId, token: "OTHERORDER1" })).toEqual({
      state: "not_found",
    });
    expect(await capturePayPalReturn(env, { checkoutId: uuidv7(), token: null })).toEqual({
      state: "not_found",
    });
    expect(paypalCalls).toEqual([]);
  });

  it("a double return: one capture in flight, the other answers processing; a second capture is ORDER_ALREADY_CAPTURED and finds the same payment", async () => {
    const o = await liveOrder();
    const now = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, now - 1_000)
      .run();
    paypalStub();
    expect(await ret(o, now)).toEqual({ state: "processing" });
    expect(captures()).toEqual([]);
    // The first claim goes stale (its answer never came back): the next return takes it again and PayPal answers already captured.
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED")
        : null,
    );
    expect(await ret(o, now + PAYPAL_CLAIM_STALE_MS + 1)).toEqual({ state: "paid" });
    expect(apiCalls().map((x) => `${x.method} ${x.path}`)).toEqual([
      `POST /v2/checkout/orders/${o.orderId}/capture`,
      `GET /v2/checkout/orders/${o.orderId}`,
    ]);
    expect(await rows("SELECT id FROM payments WHERE checkout_id = ?1", o.checkoutId)).toHaveLength(1);
  });

  it("the return and CHECKOUT.ORDER.APPROVED racing: one payment; the event is processed as a duplicate", async () => {
    const o = await liveOrder();
    const ev = await payPalEventRow("CHECKOUT.ORDER.APPROVED", {
      linkId: o.orderId,
      checkoutId: o.checkoutId,
    });
    paypalStub();
    const [a, b] = await Promise.all([ret(o), processEvent(env, ev)]);
    expect(a.state === "paid" || a.state === "processing").toBe(true);
    expect(["processed", "retry"]).toContain(b.result);
    // whichever lost comes back once the first answered
    if (b.result === "retry") expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    if (a.state === "processing")
      expect(await ret(o, Date.now() + PAYPAL_CLAIM_STALE_MS + 1)).toEqual({ state: "paid" });
    expect(await rows("SELECT id FROM payments WHERE checkout_id = ?1", o.checkoutId)).toHaveLength(1);
    expect((await eventOf(ev))?.status).toBe("processed");
  });

  it("INSTRUMENT_DECLINED: declined with PayPal's own page for the same order; the claim released, no payment; a new claim gets a new request id", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED")
        : null,
    );
    const now = Date.now();
    expect(await ret(o, now)).toEqual({ state: "declined", retryUrl: o.url });
    expect(await ppCheckout(o.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
    expect(await rows("SELECT id FROM payments WHERE checkout_id = ?1", o.checkoutId)).toEqual([]);
    const firstId = captures()[0]?.requestId;
    paypalStub();
    expect(await ret(o, now + 5_000)).toEqual({ state: "paid" });
    expect(captures()[0]?.requestId).not.toBe(firstId);
  });

  it("ORDER_NOT_APPROVED: not_completed and released; 5xx or a timeout: processing with the claim KEPT (never ended locally)", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED")
        : null,
    );
    expect(await ret(o)).toEqual({ state: "not_completed" });
    expect((await ppCheckout(o.checkoutId))?.capture_started_at).toBeNull();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture") ? ppError(503, "SERVICE_UNAVAILABLE") : null,
    );
    expect(await ret(o)).toEqual({ state: "processing" });
    const held = await ppCheckout(o.checkoutId);
    expect(held?.status).toBe("live");
    expect(held?.capture_started_at).not.toBeNull();
    // A new amount from the portal while the capture may be in flight: 409 payment_processing (L24).
    expect(await payPalLink(o, o.documentId, 20_000)).toEqual({ ok: false, error: "payment_processing" });
    // and Stripe can't end it either ("B2 must carry" 9)
    stripeStub();
    expect(await stripeLink(o, o.documentId, 50_000)).toEqual({ ok: false, error: "payment_processing" });
    expect(stripeCalls).toEqual([]);
  });

  it("a refused capture (an issue we don't know): released, a capture_refused item with PayPal's code, no payment", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "TRANSACTION_REFUSED")
        : null,
    );
    expect(await ret(o)).toEqual({ state: "processing" });
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["capture_refused"]);
    const item = await one<{ facts: string }>(
      "SELECT facts FROM review_items WHERE document_id = ?1",
      o.documentId,
    );
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ code: "TRANSACTION_REFUSED", linkId: o.orderId });
    expect((await ppCheckout(o.checkoutId))?.capture_started_at).toBeNull();
  });

  it("PayPal holds the capture: capture_pending with its id and an item, no payment; PAYMENT.CAPTURE.COMPLETED later is re-fetched and confirmed", async () => {
    const o = await liveOrder();
    const pending = (c: Record<string, unknown>) => {
      c.status = "PENDING";
      c.status_details = { reason: "PENDING_REVIEW" };
      c.seller_receivable_breakdown = undefined;
    };
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: Record<string, unknown>[] } }[])[0];
              pending(u?.payments.captures[0] as Record<string, unknown>);
            },
            true,
            201,
          )
        : null,
    );
    expect(await ret(o)).toEqual({ state: "pending" });
    expect(await ppCheckout(o.checkoutId)).toMatchObject({
      status: "capture_pending",
      provider_capture_id: capOf(o.orderId),
    });
    expect(await rows("SELECT id FROM payments WHERE checkout_id = ?1", o.checkoutId)).toEqual([]);
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["capture_pending"]);
    // Pay again while PayPal holds it: refused, whichever gateway (reviewer M2).
    expect(await payPalLink(o, o.documentId, 50_000)).toEqual({ ok: false, error: "payment_processing" });
    paypalStub();
    const ev = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
      checkoutId: o.checkoutId,
    });
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect(
      apiCalls()
        .map((x) => `${x.method} ${x.path}`)
        .sort(),
    ).toEqual(
      [`GET /v2/checkout/orders/${o.orderId}`, `GET /v2/payments/captures/${capOf(o.orderId)}`].sort(),
    );
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("confirmed");
    expect(await ppCheckout(o.checkoutId)).toMatchObject({
      status: "paid",
      provider_capture_id: capOf(o.orderId),
    });
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "confirmed" });
  });

  it("a DECLINED capture: the checkout failed, a capture_denied item, nothing received", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: Record<string, unknown>[] } }[])[0];
              (u?.payments.captures[0] as Record<string, unknown>).status = "DECLINED";
            },
            true,
            201,
          )
        : null,
    );
    expect(await ret(o)).toEqual({ state: "declined" });
    expect((await ppCheckout(o.checkoutId))?.status).toBe("failed");
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["capture_denied"]);
    expect(await ledger(o.documentId)).toMatchObject({ balance_minor: 50_000 });
  });

  it("an amount that doesn't match, or a payer in India (RA-38): recorded pending with an item, the balance unchanged", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: Record<string, unknown>[] } }[])[0];
              (u?.payments.captures[0] as Record<string, unknown>).amount = {
                currency_code: "USD",
                value: "499.00",
              };
            },
            true,
            201,
          )
        : null,
    );
    expect(await ret(o)).toEqual({ state: "processing" });
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("pending_verification");
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["amount_mismatch"]);
    expect(await ledger(o.documentId)).toMatchObject({ balance_minor: 50_000 });
    const i = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            i.orderId,
            (x) => {
              x.payer = { address: { country_code: "IN" } };
            },
            true,
            201,
          )
        : null,
    );
    expect(await ret(i)).toEqual({ state: "processing" });
    expect(await reviewKinds("document_id", i.documentId)).toEqual(["not_export_receipt"]);
    expect((await ppPaymentOf(capOf(i.orderId)))?.status).toBe("pending_verification");
  });

  it("the document voided meanwhile: changed, the checkout cancelled, NO capture call; past expires_at + 30 min: expired, no call", async () => {
    const o = await liveOrder();
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?1",
    )
      .bind(o.documentId)
      .run();
    paypalStub();
    expect(await ret(o)).toEqual({ state: "changed" });
    expect(captures()).toEqual([]);
    expect((await ppCheckout(o.checkoutId))?.status).toBe("cancelled");
    const late = await liveOrder();
    const row = await ppCheckout(late.checkoutId);
    paypalStub();
    expect(await ret(late, (row?.expires_at ?? 0) + PAYPAL_CAPTURE_GRACE_MS + 1)).toEqual({
      state: "expired",
    });
    expect(paypalCalls).toEqual([]);
    expect((await ppCheckout(late.checkoutId))?.status).toBe("expired");
  });

  it("an abandoned claim past the grace: released and expired only after GET order shows no capture; with a capture it is settled", async () => {
    const o = await liveOrder();
    const row = await ppCheckout(o.checkoutId);
    const exp = row?.expires_at ?? 0;
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, exp)
      .run();
    // A single statement can't end a claimed row (the trigger).
    await expect(
      env.DB.prepare("UPDATE checkout_sessions SET status = 'expired' WHERE id = ?1")
        .bind(o.checkoutId)
        .run(),
    ).rejects.toThrow(/checkout_sessions_claimed_no_end/);
    paypalStub((path, method) =>
      method === "GET" && path.startsWith("/v2/checkout/orders/")
        ? orderAnswer(o.orderId, () => undefined, false)
        : null,
    );
    expect(await ret(o, exp + PAYPAL_CAPTURE_GRACE_MS + 1)).toEqual({ state: "expired" });
    expect(captures()).toEqual([]);
    expect(await ppCheckout(o.checkoutId)).toMatchObject({ status: "expired", capture_started_at: null });
    // The same with a capture that went through: never dropped.
    const p = await liveOrder();
    const prow = await ppCheckout(p.checkoutId);
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(p.checkoutId, prow?.expires_at ?? 0)
      .run();
    paypalStub();
    expect(await ret(p, (prow?.expires_at ?? 0) + PAYPAL_CAPTURE_GRACE_MS + 1)).toEqual({ state: "paid" });
    expect((await ppPaymentOf(capOf(p.orderId)))?.status).toBe("confirmed");
  });

  it("a capture that went through on an ENDED row: recorded pending with a late_capture item, the ledger unchanged, the capture id set once", async () => {
    const o = await liveOrder();
    const at = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, at)
      .run();
    // Forced: the row ended with its claim (as a test only; no path does this).
    await env.DB.prepare("DROP TRIGGER checkout_sessions_claimed_no_end")
      .run()
      .catch(() => undefined);
    try {
      await env.DB.prepare("UPDATE checkout_sessions SET status = 'cancelled' WHERE id = ?1")
        .bind(o.checkoutId)
        .run();
    } finally {
      // Put the trigger back exactly as 0068 made it.
      const sql = (env.TEST_MIGRATIONS as { name: string; queries: string[] }[])
        .find((m) => m.name === "0068_paypal_triggers.sql")
        ?.queries.find((q) => q.includes("CREATE TRIGGER `checkout_sessions_claimed_no_end`"));
      if (sql) await env.DB.prepare(sql.replace(/^(\s|--> statement-breakpoint)+/, "")).run();
    }
    paypalStub();
    expect(await ret(o)).toEqual({ state: "processing" });
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("pending_verification");
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["late_capture"]);
    expect(await ppCheckout(o.checkoutId)).toMatchObject({
      status: "cancelled",
      provider_capture_id: capOf(o.orderId),
    });
    expect(await ledger(o.documentId)).toMatchObject({ balance_minor: 50_000 });
  });
});

describe("PayPal events [JOB-HOOK-02, L13, ADR 0008]", () => {
  it("CHECKOUT.ORDER.APPROVED captures on the server (the browser closed after approval)", async () => {
    const o = await liveOrder();
    const ev = await payPalEventRow("CHECKOUT.ORDER.APPROVED", {
      linkId: o.orderId,
      checkoutId: o.checkoutId,
    });
    paypalStub();
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("confirmed");
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "confirmed" });
    // a redelivery: duplicate
    expect(await processEvent(env, ev)).toEqual({ result: "duplicate" });
  });

  it("an order of another site (no row, a foreign mark): ignored, no review; ours with no row: unknown_link", async () => {
    const foreign = await payPalEventRow("CHECKOUT.ORDER.APPROVED", { linkId: "9ZZ00000000000000" });
    expect(await processEvent(env, foreign)).toEqual({ result: "ignored" });
    expect(await reviewKinds("webhook_event_id", foreign)).toEqual([]);
    const ours = await payPalEventRow("CHECKOUT.ORDER.APPROVED", {
      linkId: "9ZZ00000000000001",
      checkoutId: uuidv7(),
    });
    expect(await processEvent(env, ours)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ours)).toEqual(["unknown_link"]);
    expect(paypalCalls).toEqual([]);
  });

  it("PAYMENT.CAPTURE.REVERSED after confirmation: a review item and a bell, the ledger unchanged (M6.5)", async () => {
    const o = await liveOrder();
    await ret(o);
    const before = await ledger(o.documentId);
    const ev = await payPalEventRow("PAYMENT.CAPTURE.REVERSED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
    });
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["reversed_after_confirm"]);
    expect(await ledger(o.documentId)).toEqual(before);
    const refund = await payPalEventRow("PAYMENT.CAPTURE.REFUNDED", { paymentId: "NOSUCHCAPTURE1" });
    expect(await processEvent(env, refund)).toEqual({ result: "ignored" });
  });

  it("an event arriving while the return's capture is in flight comes back (retry); the row stays claimed", async () => {
    const o = await liveOrder();
    const now = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, now)
      .run();
    const ev = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
      checkoutId: o.checkoutId,
    });
    paypalStub();
    expect(await processEvent(env, ev, now)).toEqual({ result: "retry" });
    expect(paypalCalls).toEqual([]);
    expect(await ppCheckout(o.checkoutId)).toMatchObject({ status: "live", capture_started_at: now });
    expect((await eventOf(ev))?.status).toBe("received");
  });
});

describe("a USD proforma paid by PayPal waits for the Owner [M6.3 Q1 A, L18; 08-C RA-21]", () => {
  it("pending with its request and an advance_blocked fx_rate_needed item; no automatic invoice; no second payment meanwhile", async () => {
    const o = await owner();
    const made = await mkProforma(o, { client: usdClient, price: 1_000_000 });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const pf = await one<{ total_minor: number }>("SELECT total_minor FROM documents WHERE id = ?1", made.id);
    const r = await payPalLink(
      { clientId: made.clientId, contactId: made.contactId },
      made.id,
      pf?.total_minor,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const orderId = new URL((r as { url: string }).url).searchParams.get("token") as string;
    expect(await ret({ checkoutId: (r as { checkoutId: string }).checkoutId, orderId })).toEqual({
      state: "paid",
    });
    const p = await ppPaymentOf(capOf(orderId));
    expect(p?.status).toBe("pending_verification");
    expect(JSON.parse(p?.requested_allocations ?? "null")).toEqual([
      { documentId: made.id, amountMinor: pf?.total_minor },
    ]);
    const item = await one<{ kind: string; facts: string }>(
      "SELECT kind, facts FROM review_items WHERE payment_id = ?1",
      p?.id,
    );
    expect(item?.kind).toBe("advance_blocked");
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ blockers: ["fx_rate_needed"] });
    expect(await rows("SELECT id FROM documents WHERE parent_id = ?1", made.id)).toEqual([]);
    expect(await payPalLink({ clientId: made.clientId, contactId: made.contactId }, made.id, 10_000)).toEqual(
      {
        ok: false,
        error: "payment_processing",
      },
    );
  });
});

describe("the provider switch both ways [L25; B2 must carry 8, 9]", () => {
  it("PayPal after Stripe: the Stripe session expired at Stripe first, then the order made", async () => {
    const s = await liveSession();
    stripeStub();
    paypalCalls.length = 0;
    const r = await payPalLink(s, s.documentId, 50_000);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(
      stripeCalls.filter((x) => x.path.startsWith("/v1/checkout")).map((x) => `${x.method} ${x.path}`),
    ).toEqual([`POST /v1/checkout/sessions/${s.sessionId}/expire`]);
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", s.checkoutId))
        ?.status,
    ).toBe("cancelled");
  });

  it("Stripe after PayPal: an unclaimed PayPal order ended here (no PayPal call), then the session made", async () => {
    const o = await liveOrder();
    stripeStub();
    const r = await stripeLink(o, o.documentId, 50_000);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await ppCheckout(o.checkoutId))?.status).toBe("cancelled");
  });
});

describe("refreshes, the sweep and Check now [L14]", () => {
  it("the signed-in return (refreshForClient) captures once a minute; the sweep's refresh of a stale claim re-fetches the order", async () => {
    const o = await liveOrder();
    paypalStub();
    expect(await refreshForClient(env, { clientId: o.clientId, documentId: o.documentId })).toEqual({
      result: "processed",
    });
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("confirmed");
    const s = await liveOrder();
    const now = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(s.checkoutId, now - PAYPAL_CLAIM_STALE_MS - 5)
      .run();
    // The stale claim is taken again; PayPal says not approved: released, the row stays live, and the refresh is claimed for a minute.
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED")
        : null,
    );
    expect(await refreshCheckoutById(env, s.checkoutId, now)).toEqual({ result: "unchanged" });
    expect(await ppCheckout(s.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
    expect((await ppCheckout(s.checkoutId))?.last_refresh_at).toBe(now);
    expect(await refreshCheckoutById(env, s.checkoutId, now + 1)).toEqual({ result: "too_soon" });
    // A paid row: nothing open to refresh.
    expect(await refreshCheckoutById(env, o.checkoutId, now + 120_000)).toEqual({ result: "no_open_link" });
  });
});

describe("the provider contract and the statement budget [ADM-PAY-01, run file C limits]", () => {
  it("the PayPal provider passes checkProviderContract; a live mode with the flag off makes no call", async () => {
    const test = payPalProvider({
      clientId: "id",
      clientSecret: "secret",
      settingsMode: "test",
      liveFlag: "false",
      fetch: async () => {
        throw new Error("no network in tests");
      },
    });
    expect(await checkProviderContract(test, { liveAllowed: "false" })).toEqual([]);
    const calls: string[] = [];
    const live = payPalProvider({
      clientId: "id",
      clientSecret: "secret",
      settingsMode: "live",
      liveFlag: "false",
      fetch: async (i) => {
        calls.push(String(i));
        return new Response("{}", { status: 200 });
      },
    });
    expect(await checkProviderContract(live, { liveAllowed: "false" })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("each RPC stays within 45 D1 statements (create, the return's capture, an event)", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const counted = countingEnv();
    const r = await payPalLink(c, documentId, 50_000, counted.env);
    expect(r.ok).toBe(true);
    expect(counted.counter.n).toBeLessThanOrEqual(45);
    const orderId = new URL((r as { url: string }).url).searchParams.get("token") as string;
    const second = countingEnv();
    expect(
      await capturePayPalReturn(second.env, {
        checkoutId: (r as { checkoutId: string }).checkoutId,
        token: orderId,
      }),
    ).toEqual({
      state: "paid",
    });
    expect(second.counter.n).toBeLessThanOrEqual(45);
    const o = await liveOrder();
    const ev = await payPalEventRow("CHECKOUT.ORDER.APPROVED", {
      linkId: o.orderId,
      checkoutId: o.checkoutId,
    });
    const third = countingEnv();
    expect(await processEvent(third.env, ev)).toEqual({ result: "processed" });
    expect(third.counter.n).toBeLessThanOrEqual(45);
  });
});
