// M6.3 Stripe in the admin finance Worker [ADM-PAY-01, -03, -06, -07, -11, ADM-INV-10, -17, JOB-HOOK-02, POR-06; run file C and I]: Checkout links (made with the
// pinned version and the checkout id as Idempotency-Key, reused, replaced by expiring first, adopted, refused), the webhook event processed after a re-fetch
// (confirmed with its INR facts, duplicate and replay, unknown session, mismatch, not captured, refunded or disputed (F1), asynchronous, expired only on Stripe's
// word, a refused key, an India-issued card), a USD proforma paid by card waiting for the Owner's tax invoice with the day's rate (Q1 A), the sweep's refresh,
// the live guard with zero fetch calls, the provider contract and the 45-statement budget of each RPC. Stripe is never called: the stub transport answers.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { checkProviderContract } from "@techaust/core/payments";
import { STRIPE_API_VERSION } from "@techaust/core/stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { refreshCheckoutById } from "./gateway/links.ts";
import { reviewReason } from "./gateway/reasons.ts";
import { stripeProvider } from "./gateway/stripe.ts";
import { countingEnv, owner, staffLink } from "./test-gateway.ts";
import { call, one, rows, withEnv } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { issueInvoice, type J, json, mkInvoiceClient, putBank, putCompany } from "./test-invoices.ts";
import {
  checkoutOf,
  jsonResponse,
  piOf,
  sessionAnswer,
  stripeCalls,
  stripeEventRow,
  stripeLink,
  stripePaymentOf,
  stripeStub,
  usdClient,
  usdDoc,
} from "./test-stripe.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  stripeStub();
});
afterEach(() => setStubTransport(null));

/** A live Stripe session of an issued USD export invoice of an overseas client (USD 500). */
async function liveSession(o: { type?: string; amount?: number } = {}) {
  const c = await usdClient();
  const documentId = await usdDoc(c.clientId, { type: o.type });
  const r = await stripeLink(c, documentId, o.amount ?? 50_000);
  if (!r.ok) throw new Error(`no link: ${JSON.stringify(r)}`);
  const sessionId = new URL(r.url).pathname.split("/").at(-1) as string;
  return { ...c, documentId, checkoutId: r.checkoutId, sessionId, url: r.url };
}

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

describe("Stripe Checkout links [POR-06, L4, L7, L9; run file C PortalPayments]", () => {
  it("makes a session with the pinned version, our checkout id as Idempotency-Key and every field of sessionRequestOf; the row goes live", async () => {
    const s = await liveSession();
    const create = stripeCalls.find((x) => x.method === "POST" && x.path === "/v1/checkout/sessions");
    expect(create?.idempotencyKey).toBe(s.checkoutId);
    expect(create?.version).toBe(STRIPE_API_VERSION);
    expect(create?.auth).toMatch(/^Bearer rk_test_/);
    const b = create?.body as URLSearchParams;
    expect(b.get("mode")).toBe("payment");
    expect(b.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(b.get("line_items[0][price_data][unit_amount]")).toBe("50000");
    expect(b.get("line_items[0][price_data][product_data][name]")).toMatch(/^Invoice EXP\//);
    expect(b.get("client_reference_id")).toBe(s.checkoutId);
    expect(b.get("metadata[techaust_document_id]")).toBe(s.documentId);
    expect(b.get("payment_intent_data[description]")).toMatch(
      /^TecHaust Technologies: software and IT services, invoice EXP\//,
    );
    expect(b.get("payment_intent_data[statement_descriptor_suffix]")).toBe("TECHAUST");
    expect(b.get("success_url")).toBe(`http://localhost:5174/invoices/${s.documentId}?pay=return`);
    expect(b.get("cancel_url")).toBe(`http://localhost:5174/invoices/${s.documentId}?pay=cancel`);
    expect([...b.keys()].some((k) => k.startsWith("customer"))).toBe(false);
    expect(s.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(await checkoutOf(s.sessionId)).toMatchObject({ id: s.checkoutId, status: "live" });
  });

  it("reuses the open session for the same amount; a new amount expires the old one at Stripe first", async () => {
    const s = await liveSession();
    stripeStub();
    const again = await stripeLink(s, s.documentId, 50_000);
    expect(again).toMatchObject({ ok: true, reused: true, checkoutId: s.checkoutId });
    expect(stripeCalls).toEqual([]);
    const other = await stripeLink(s, s.documentId, 20_000);
    expect(other.ok).toBe(true);
    expect(stripeCalls.map((x) => `${x.method} ${x.path}`)).toEqual([
      `POST /v1/checkout/sessions/${s.sessionId}/expire`,
      "POST /v1/checkout/sessions",
    ]);
    expect((await checkoutOf(s.sessionId))?.status).toBe("cancelled");
  });

  it("an expire Stripe refuses because the session completed: the payment is settled and the answer is payment_processing", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "POST" && path.endsWith("/expire")
        ? jsonResponse(400, { error: { type: "invalid_request_error" } })
        : null,
    );
    const r = await stripeLink(s, s.documentId, 20_000);
    expect(r).toEqual({ ok: false, error: "payment_processing" });
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("confirmed");
    expect((await checkoutOf(s.sessionId))?.status).toBe("paid");
    // and the document, paid in full, takes no new session
    expect(await stripeLink(s, s.documentId, 20_000)).toMatchObject({ ok: false });
  });

  it("a creating row older than 60 s is adopted with the same Idempotency-Key and the identical body; a younger one is link_in_progress", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const id = uuidv7();
    const now = Date.now();
    const created = now - 2 * 60_000;
    await env.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'stripe', ?2, ?3, ?4, 'portal', 'USD', 50000, 'creating', ?5, ?6, ?6)`,
    )
      .bind(id, documentId, c.clientId, c.contactId, created + 3_600_000, created)
      .run();
    const r = await stripeLink(c, documentId, 50_000);
    expect(r).toMatchObject({ ok: true, reused: true, checkoutId: id });
    const create = stripeCalls.filter((x) => x.method === "POST" && x.path === "/v1/checkout/sessions");
    expect(create).toHaveLength(1);
    expect(create[0]?.idempotencyKey).toBe(id);
    expect(create[0]?.body?.get("expires_at")).toBe(String(Math.trunc((created + 3_600_000) / 1000)));
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", id))?.status,
    ).toBe("live");
    // a younger creating row waits
    const doc2 = await usdDoc(c.clientId);
    await env.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'stripe', ?2, ?3, ?4, 'portal', 'USD', 50000, 'creating', ?5, ?6, ?6)`,
    )
      .bind(uuidv7(), doc2, c.clientId, c.contactId, now + 3_600_000, now)
      .run();
    expect(await stripeLink(c, doc2, 50_000)).toEqual({ ok: false, error: "link_in_progress" });
  });

  it("two parallel clicks make one session", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const both = await Promise.all([stripeLink(c, documentId), stripeLink(c, documentId)]);
    expect(both.filter((r) => r.ok && !r.reused)).toHaveLength(1);
    expect(stripeCalls.filter((x) => x.method === "POST" && x.path === "/v1/checkout/sessions")).toHaveLength(
      1,
    );
  });

  it("refuses an INR document, an amount above the maximum or below the floor, and a document with a payment waiting", async () => {
    const c = await usdClient();
    const inr = await usdDoc(c.clientId, { currency: "INR", type: "export_invoice" }).catch(() => null);
    if (inr) expect(await stripeLink(c, inr)).toMatchObject({ ok: false, error: "not_payable_online" });
    const documentId = await usdDoc(c.clientId, { total: 5_000_000 });
    expect(await stripeLink(c, documentId, 3_000_000)).toEqual({
      ok: false,
      error: "amount_above_maximum",
      maximumMinor: 2_500_000,
    });
    expect(await stripeLink(c, documentId, 5_000)).toMatchObject({
      ok: false,
      error: "amount_below_minimum",
      minimumMinor: 10_000,
    });
    // a domestic client's document is not Stripe's
    const d = await mkInvoiceClient();
    const dom = await usdDoc(d.clientId, { currency: "INR", type: "tax_invoice" });
    expect(await stripeLink({ clientId: d.clientId, contactId: d.contactId }, dom)).toMatchObject({
      ok: false,
    });
    expect(stripeCalls.filter((x) => x.method === "POST")).toEqual([]);
  });

  it("a live key while live payments are off, or an sk_ key: 503 with ZERO calls to Stripe [ADM-PAY-11, L3, rule 7]", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    stripeStub();
    const live = withEnv(env, { STRIPE_SECRET_KEY: ["rk", "live", "madeup"].join("_") });
    expect(await stripeLink(c, documentId, 50_000, live)).toEqual({ ok: false, error: "live_not_allowed" });
    const secret = withEnv(env, { STRIPE_SECRET_KEY: ["sk", "test", "madeup"].join("_") });
    expect(await stripeLink(c, documentId, 50_000, secret)).toEqual({
      ok: false,
      error: "gateway_unavailable",
    });
    expect(stripeCalls).toEqual([]);
    expect(await one("SELECT id FROM checkout_sessions WHERE document_id = ?1", documentId)).toBeNull();
  });

  it("staff never make a card link: 409 not_payable_online with reason use_portal [L7]", async () => {
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
});

describe("a Stripe event [JOB-HOOK-02, ADR 0008, L5, L6]", () => {
  it("a paid export invoice: confirmed after the re-fetch, allocated, the invoice paid, the INR facts stored; a replay under a new event id adds nothing", async () => {
    const s = await liveSession();
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    const pi = piOf(s.sessionId);
    const p = await stripePaymentOf(pi);
    expect(p).toMatchObject({
      status: "confirmed",
      amount_minor: 50_000,
      currency: "USD",
      mode: "card",
      charges_minor: 0,
      fee_tax_minor: null,
      inr_received_minor: 50_000 * 84,
      requested_allocations: null,
      verified_by: null,
    });
    expect(p?.gateway_fee_inr_minor).toBeGreaterThan(0);
    expect(p?.gateway_fee_tax_inr_minor).toBeLessThanOrEqual(p?.gateway_fee_inr_minor as number);
    expect(p?.reference_norm).toBe(pi.replaceAll("_", "-").toUpperCase());
    expect(p?.received_on).toBe(todayIso());
    expect(await ledger(s.documentId)).toMatchObject({ status: "paid", balance_minor: 0 });
    expect((await checkoutOf(s.sessionId))?.status).toBe("paid");
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "confirmed" });
    // the session was re-fetched with its intent, charge and balance transaction expanded
    expect(
      stripeCalls.some(
        (x) =>
          x.method === "GET" &&
          decodeURIComponent(x.path).endsWith("expand[]=payment_intent.latest_charge.balance_transaction"),
      ),
    ).toBe(true);
    const replay = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, replay)).toEqual({ result: "duplicate" });
    expect((await rows("SELECT id FROM payments WHERE provider_payment_id = ?1", pi)).length).toBe(1);
    // the owners' bell names the client, the USD amount and the number
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ?1 AND kind = 'payment.online'",
      p?.id,
    );
    expect(bell?.title).toMatch(/ paid \$500\.00 by card for EXP\//);
  });

  it("a balance transaction in USD stores no INR facts", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, (x) => {
            x.payment_intent.latest_charge.balance_transaction.currency = "usd";
          })
        : null,
    );
    await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId));
    expect(await stripePaymentOf(piOf(s.sessionId))).toMatchObject({
      status: "confirmed",
      inr_received_minor: null,
      gateway_fee_inr_minor: null,
      gateway_fee_tax_inr_minor: null,
    });
  });

  it("metadata forged for a session we never stored: unknown_link, no payment row, no re-fetch [L5]", async () => {
    const forged = `cs_test_forged${"F".repeat(40)}`;
    const ev = await stripeEventRow(forged, uuidv7());
    stripeStub();
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["unknown_link"]);
    expect(stripeCalls).toEqual([]);
    expect(await one("SELECT id FROM payments WHERE checkout_id IS NULL AND provider = 'stripe'")).toBeNull();
    // an expired orphan is ignored; a row with no checkout id is not ours
    const exp = await stripeEventRow(forged, uuidv7(), "checkout.session.expired");
    expect(await processEvent(env, exp)).toEqual({ result: "ignored" });
    const foreign = await stripeEventRow(forged, "x", "checkout.session.completed", { linkId: forged });
    expect(await processEvent(env, foreign)).toEqual({ result: "ignored" });
    expect(await eventOf(foreign)).toEqual({ status: "ignored", outcome: "not_techaust" });
  });

  it("an amount that doesn't match: pending with a review item, the balance unchanged", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, (x) => {
            x.amount_total = 49_000;
            x.payment_intent.amount_received = 49_000;
          })
        : null,
    );
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await stripePaymentOf(piOf(s.sessionId))).toMatchObject({
      status: "pending_verification",
      amount_minor: 49_000,
    });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["amount_mismatch"]);
    expect(await ledger(s.documentId)).toMatchObject({ balance_minor: 50_000 });
  });

  it.each([
    [
      "not succeeded",
      (x: J) => {
        x.payment_intent.status = "requires_payment_method";
      },
    ],
    [
      "refunded in full (F1)",
      (x: J) => {
        x.payment_intent.latest_charge.refunded = true;
        x.payment_intent.latest_charge.amount_refunded = 50_000;
      },
    ],
    [
      "refunded in part (F1)",
      (x: J) => {
        x.payment_intent.latest_charge.amount_refunded = 100;
      },
    ],
    [
      "disputed (F1)",
      (x: J) => {
        x.payment_intent.latest_charge.disputed = true;
      },
    ],
  ])("a charge %s: the review item only, never a payment row", async (_name, edit) => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, edit)
        : null,
    );
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["not_captured"]);
    expect(await stripePaymentOf(piOf(s.sessionId))).toBeNull();
    expect(await ledger(s.documentId)).toMatchObject({ balance_minor: 50_000 });
  });

  it("a card issued in India, or of no stated country: pending with not_export_receipt, never confirmed [08-C RA-38]", async () => {
    for (const country of ["IN", null]) {
      const s = await liveSession();
      stripeStub((path, method) =>
        method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
          ? sessionAnswer(s.sessionId, (x) => {
              x.payment_intent.latest_charge.payment_method_details.card.country = country;
            })
          : null,
      );
      const ev = await stripeEventRow(s.sessionId, s.checkoutId);
      expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
      expect(await reviewKinds("webhook_event_id", ev)).toEqual(["not_export_receipt"]);
      expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("pending_verification");
      expect(await ledger(s.documentId)).toMatchObject({ balance_minor: 50_000 });
    }
    expect(reviewReason("not_export_receipt")).toMatch(/issued in India/);
  });

  it("early check 2, finding 4: an India-issued card is named before an amount or currency difference; money not in USD still gets no payment row", async () => {
    const india = (x: J) => {
      x.payment_intent.latest_charge.payment_method_details.card.country = "IN";
    };
    // an amount difference too: pending as not_export_receipt (the amount Stripe received)
    const a = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${a.sessionId}`
        ? sessionAnswer(a.sessionId, (x) => {
            india(x);
            x.amount_total = 49_000;
            x.payment_intent.amount_received = 49_000;
          })
        : null,
    );
    const evA = await stripeEventRow(a.sessionId, a.checkoutId);
    expect(await processEvent(env, evA)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", evA)).toEqual(["not_export_receipt"]);
    expect(await stripePaymentOf(piOf(a.sessionId))).toMatchObject({
      status: "pending_verification",
      amount_minor: 49_000,
    });
    expect(await ledger(a.documentId)).toMatchObject({ balance_minor: 50_000 });
    // a currency difference too: the item only (a payment row is only ever USD money), its facts naming the currency difference
    const b = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${b.sessionId}`
        ? sessionAnswer(b.sessionId, (x) => {
            india(x);
            x.currency = "eur";
            x.payment_intent.currency = "eur";
          })
        : null,
    );
    const evB = await stripeEventRow(b.sessionId, b.checkoutId);
    expect(await processEvent(env, evB)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", evB)).toEqual(["not_export_receipt"]);
    expect(await stripePaymentOf(piOf(b.sessionId))).toBeNull();
    const item = await one<{ facts: string; amount_minor: number | null }>(
      "SELECT facts, amount_minor FROM review_items WHERE webhook_event_id = ?1",
      evB,
    );
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ reason: "currency_mismatch" });
    expect(JSON.parse(item?.facts ?? "{}")).not.toHaveProperty("currency");
    expect(item?.amount_minor).toBeNull();
    expect(await ledger(b.documentId)).toMatchObject({ balance_minor: 50_000 });
  });

  it("an asynchronous payment: unpaid records nothing; succeeded later records it; failed ends the session", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, (x) => {
            x.payment_status = "unpaid";
            x.payment_intent.status = "processing";
          })
        : null,
    );
    const first = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, first)).toEqual({ result: "processed" });
    expect(await eventOf(first)).toEqual({ status: "processed", outcome: "awaiting_async" });
    expect(await stripePaymentOf(piOf(s.sessionId))).toBeNull();
    stripeStub();
    const later = await stripeEventRow(s.sessionId, s.checkoutId, "checkout.session.async_payment_succeeded");
    expect(await processEvent(env, later)).toEqual({ result: "processed" });
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("confirmed");
    const t = await liveSession();
    const failed = await stripeEventRow(t.sessionId, t.checkoutId, "checkout.session.async_payment_failed");
    expect(await processEvent(env, failed)).toEqual({ result: "processed" });
    expect((await checkoutOf(t.sessionId))?.status).toBe("failed");
    expect(await reviewKinds("webhook_event_id", failed)).toEqual([]);
  });

  it("expired only on Stripe's word: a session Stripe still holds open is retried, one it says expired ends [L6]", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, () => undefined, "open")
        : null,
    );
    const ev = await stripeEventRow(s.sessionId, s.checkoutId, "checkout.session.expired");
    expect(await processEvent(env, ev)).toEqual({ result: "retry" });
    expect((await checkoutOf(s.sessionId))?.status).toBe("live");
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, () => undefined, "expired")
        : null,
    );
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect((await checkoutOf(s.sessionId))?.status).toBe("expired");
  });

  it("a key Stripe refuses (403): refetch_failed with outcome stripe_permission and a bell; a 5xx is retried", async () => {
    const s = await liveSession();
    stripeStub((_p, method) => (method === "GET" ? jsonResponse(503, {}) : null));
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "retry" });
    stripeStub((_p, method) => (method === "GET" ? jsonResponse(403, { error: {} }) : null));
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await eventOf(ev)).toEqual({ status: "needs_review", outcome: "stripe_permission" });
    const item = await one<{ id: string; facts: string }>(
      "SELECT id, facts FROM review_items WHERE webhook_event_id = ?1",
      ev,
    );
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ reason: "stripe_permission" });
    expect(
      await one("SELECT id FROM notifications WHERE entity_id = ?1 AND kind = 'payment.review'", item?.id),
    ).not.toBeNull();
  });

  it("an erased client: client_gone, never a payment row", async () => {
    // Early check 2, finding 7: unconditional, as M6.2's (gateway-review.test.ts): the client is erased, and every check runs.
    const s = await liveSession();
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(s.clientId, Date.now())
      .run();
    expect(
      (await one<{ a: number | null }>("SELECT anonymised_at AS a FROM clients WHERE id = ?1", s.clientId))
        ?.a,
    ).not.toBeNull();
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["client_gone"]);
    expect(await stripePaymentOf(piOf(s.sessionId))).toBeNull();
    expect(await ledger(s.documentId)).toMatchObject({ balance_minor: 50_000 });
  });

  it("each RPC stays within 45 D1 statements", async () => {
    const c = await usdClient();
    const documentId = await usdDoc(c.clientId);
    const counted = countingEnv();
    const r = await stripeLink(c, documentId, 50_000, counted.env);
    expect(r.ok).toBe(true);
    expect(counted.counter.n).toBeLessThanOrEqual(45);
    const sessionId = new URL((r as { url: string }).url).pathname.split("/").at(-1) as string;
    const ev = await stripeEventRow(sessionId, (r as { checkoutId: string }).checkoutId);
    const second = countingEnv();
    expect(await processEvent(second.env, ev)).toEqual({ result: "processed" });
    expect(second.counter.n).toBeLessThanOrEqual(45);
  });
});

describe("a USD proforma paid by card waits for the Owner [Q1 A, ADM-INV-10; 08-C RA-21]", () => {
  it("pending with its request and an advance_blocked fx_rate_needed item, no automatic invoice; the Owner then issues the export invoice with the day's rate", async () => {
    const o = await owner();
    const made = await mkProforma(o, { client: usdClient, price: 1_000_000 });
    const issued = await issueInvoice(o, made.id);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const pf = await one<{ total_minor: number; currency: string; updated_at: number }>(
      "SELECT total_minor, currency, updated_at FROM documents WHERE id = ?1",
      made.id,
    );
    expect(pf?.currency).toBe("USD");
    const r = await stripeLink(
      { clientId: made.clientId, contactId: made.contactId },
      made.id,
      pf?.total_minor,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const sessionId = new URL((r as { url: string }).url).pathname.split("/").at(-1) as string;
    const ev = await stripeEventRow(sessionId, (r as { checkoutId: string }).checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    const p = await stripePaymentOf(piOf(sessionId));
    expect(p?.status).toBe("pending_verification");
    expect(JSON.parse(p?.requested_allocations ?? "null")).toEqual([
      { documentId: made.id, amountMinor: pf?.total_minor },
    ]);
    const item = await one<{ kind: string; provider: string; currency: string; facts: string }>(
      "SELECT kind, provider, currency, facts FROM review_items WHERE payment_id = ?1",
      p?.id,
    );
    expect(item).toMatchObject({ kind: "advance_blocked", provider: "stripe", currency: "USD" });
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ blockers: ["fx_rate_needed"] });
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "proforma_pending" });
    // no automatic tax invoice: never the system's gateway_auto, and never a second card payment meanwhile
    expect(await rows("SELECT id FROM documents WHERE parent_id = ?1", made.id)).toEqual([]);
    expect(await stripeLink({ clientId: made.clientId, contactId: made.contactId }, made.id, 10_000)).toEqual(
      {
        ok: false,
        error: "payment_processing",
      },
    );
    // "Confirm by issuing the tax invoice": prefilled amount, day and reference, the rate typed by the Owner
    const res = await call(`/invoices/${made.id}/advance-invoice`, {
      cookie: o.cookie,
      body: {
        expectedProformaUpdatedAt: (
          await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?1", made.id)
        )?.updated_at,
        amountMinor: p?.amount_minor,
        receivedOn: p?.received_on,
        reference: p?.reference_norm,
        paymentId: p?.id,
        fx: { rate: "84.1234", date: p?.received_on, source: "FBIL" },
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await json(res)).type).toBe("export_invoice");
    expect((await stripePaymentOf(piOf(sessionId)))?.status).toBe("confirmed");
    // the same batch resolves its fx_rate_needed item
    expect(
      await one<{ status: string; resolution: string }>(
        "SELECT status, resolution FROM review_items WHERE payment_id = ?1",
        p?.id,
      ),
    ).toEqual({ status: "resolved", resolution: "advance_issued" });
  });
});

describe("the sweep's refresh [L6, L13; F4]", () => {
  it("a live session past its expiry is ended only when Stripe says expired; every outcome writes last_refresh_at", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, () => undefined, "open")
        : null,
    );
    expect(await refreshCheckoutById(env, s.checkoutId)).toEqual({ result: "unchanged" });
    const after = await checkoutOf(s.sessionId);
    expect(after?.status).toBe("live");
    expect(after?.last_refresh_at).not.toBeNull();
    // claimed once a minute
    expect(await refreshCheckoutById(env, s.checkoutId)).toEqual({ result: "too_soon" });
    await env.DB.prepare("UPDATE checkout_sessions SET last_refresh_at = 1 WHERE id = ?1")
      .bind(s.checkoutId)
      .run();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, () => undefined, "expired")
        : null,
    );
    expect(await refreshCheckoutById(env, s.checkoutId)).toEqual({ result: "processed" });
    expect((await checkoutOf(s.sessionId))?.status).toBe("expired");
    expect(await refreshCheckoutById(env, uuidv7())).toEqual({ result: "no_open_link" });
  });
});

describe("the provider contract [ADM-PAY-01]", () => {
  it("the Stripe provider passes checkProviderContract, and a live key with the flag off makes no call", async () => {
    stripeStub();
    const test = stripeProvider({
      key: ["rk", "test", "madeup"].join("_"),
      settingsMode: "test",
      liveFlag: "false",
      fetch: async () => {
        throw new Error("no network in tests");
      },
    });
    expect(await checkProviderContract(test, { liveAllowed: "false" })).toEqual([]);
    stripeStub();
    const calls: string[] = [];
    const live = stripeProvider({
      key: ["rk", "live", "madeup"].join("_"),
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
});
