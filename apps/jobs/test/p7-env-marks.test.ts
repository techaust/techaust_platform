// P7 payments in the jobs Worker (docs/runs/p7-payments.md; JOB-HOOK-01..03, ADM-PAY-01, -02, -11): the environment marks (the analyst's Phase 7 finding 5:
// staging and production share one sandbox account per gateway, and both webhooks receive every event) and the hooks' mode (A2.1, A2.2).
//   - Razorpay and PayPal: an event marked for ANOTHER environment is stored `ignored` with outcome `other_env` and goes no further (no message, no review, no
//     bell); the same environment's is processed as before; an unmarked one (made before P7) keeps today's path;
//   - `hookModeOf`: test with no D1 read while `PAYMENTS_LIVE_ALLOWED` is not "true"; else Settings › Gateways' mode;
//   - PayPal's certificate host and Stripe's `livemode` follow that mode.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { payPalHook, resetPayPalCertCache } from "../src/hooks/paypal.ts";
import { razorpayHook } from "../src/hooks/razorpay.ts";
import { hookModeOf } from "../src/hooks/shared.ts";
import { stripeHook } from "../src/hooks/stripe.ts";
import { fakes, logs, makeEnv, useFakes } from "./billing-fixtures.ts";
import { type TestSigner, testSigner } from "./paypal-cert.ts";

useFakes();
afterEach(async () => {
  resetPayPalCertCache();
  await realEnv.DB.prepare("DELETE FROM settings WHERE key = 'gateways'").run();
});

const enc = new TextEncoder();
let seq = 0;

type Row = { id: string; status: string; outcome: string | null; facts: string; processed_at: number | null };
const rowsOf = async (provider: string, eventId: string) =>
  (
    await realEnv.DB.prepare(
      "SELECT id, status, outcome, facts, processed_at FROM webhook_events WHERE provider = ?1 AND event_id = ?2",
    )
      .bind(provider, eventId)
      .all<Row>()
  ).results;
const reviewCount = async () =>
  (await realEnv.DB.prepare("SELECT count(*) AS n FROM review_items").first<{ n: number }>())?.n ?? 0;
const bellCount = async () =>
  (await realEnv.DB.prepare("SELECT count(*) AS n FROM notifications").first<{ n: number }>())?.n ?? 0;
const setModes = (modes: { razorpay?: string; stripe?: string; paypal?: string }) =>
  realEnv.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('gateways', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(
      JSON.stringify({
        razorpay: { mode: modes.razorpay ?? "test" },
        stripe: { mode: modes.stripe ?? "test" },
        paypal: { mode: modes.paypal ?? "test" },
      }),
    )
    .run();

// ---- hookModeOf -------------------------------------------------------------------------------------------------------------------------------------------

describe("hookModeOf (A2.1, A2.2): the mode a webhook is judged in", () => {
  it("the flag off: test, with no D1 read at all (a DB that throws is never asked)", async () => {
    const DB = {
      prepare() {
        throw new Error("no read expected");
      },
    } as unknown as D1Database;
    for (const flag of ["false", undefined, "TRUE", ""])
      expect(
        await hookModeOf(
          { DB, ...(flag === undefined ? {} : { PAYMENTS_LIVE_ALLOWED: flag }) } as { DB: D1Database },
          "paypal",
        ),
      ).toBe("test");
  });

  it("the flag on: Settings › Gateways' mode per gateway; no row, or a failed read, is test", async () => {
    const e = { DB: realEnv.DB, PAYMENTS_LIVE_ALLOWED: "true" } as { DB: D1Database };
    expect(await hookModeOf(e, "stripe")).toBe("test");
    await setModes({ stripe: "live" });
    expect(await hookModeOf(e, "stripe")).toBe("live");
    expect(await hookModeOf(e, "paypal")).toBe("test");
    expect(await hookModeOf(e, "razorpay")).toBe("test");
    const broken = {
      DB: {
        prepare() {
          throw new Error("D1 down");
        },
      },
      PAYMENTS_LIVE_ALLOWED: "true",
    } as unknown as { DB: D1Database };
    expect(await hookModeOf(broken, "stripe")).toBe("test");
  });
});

// ---- Razorpay ---------------------------------------------------------------------------------------------------------------------------------------------

const SECRET = "test-razorpay-webhook-secret";
async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const rzpBody = (mark: string | null, event = "payment_link.paid") =>
  JSON.stringify({
    entity: "event",
    event,
    created_at: 1_790_000_000,
    payload: {
      payment_link: {
        entity: {
          id: `plink_P7${++seq}AAAA`,
          amount: 118000,
          currency: "INR",
          status: "paid",
          notes: { checkout_id: uuidv7(), ...(mark ? { techaust_env: mark } : {}) },
        },
      },
      payment: { entity: { id: `pay_P7${seq}AAAA`, amount: 118000, currency: "INR", method: "upi" } },
    },
  });
const rzpPost = async (body: string, eventId: string) =>
  razorpayHook(
    new Request("https://jobs.example.test/razorpay", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": await sign(body),
        "x-razorpay-event-id": eventId,
      },
      body,
    }),
    makeEnv({ RAZORPAY_WEBHOOK_SECRET: SECRET }) as unknown as { DB: D1Database; LEADS_QUEUE: Queue },
  );

describe("POST /razorpay: the environment mark (finding 5)", () => {
  it("another environment's event: 200, kept `ignored` with outcome other_env and only the name and mark, no message, no review, no bell", async () => {
    const [reviews, bells] = [await reviewCount(), await bellCount()];
    const res = await rzpPost(rzpBody("production"), "evt_P7OTHER01");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await rowsOf("razorpay", "evt_P7OTHER01");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ignored", outcome: "other_env" });
    expect(rows[0]?.processed_at).not.toBeNull();
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toEqual({ event: "payment_link.paid", env: "production" });
    expect(fakes.leads).toHaveLength(0);
    expect(await reviewCount()).toBe(reviews);
    expect(await bellCount()).toBe(bells);
    expect(logs.join("\n")).toContain("hook.other_env");
    expect(logs.join("\n")).not.toContain("plink_");
    // a redelivery is a duplicate: still one row, still no message
    expect((await rzpPost(rzpBody("production"), "evt_P7OTHER01")).status).toBe(200);
    expect(await rowsOf("razorpay", "evt_P7OTHER01")).toHaveLength(1);
    expect(fakes.leads).toHaveLength(0);
  });

  it("an expired or cancelled link of another environment is ignored the same way", async () => {
    const res = await rzpPost(rzpBody("staging", "payment_link.expired"), "evt_P7OTHER02");
    expect(res.status).toBe(200);
    expect((await rowsOf("razorpay", "evt_P7OTHER02"))[0]).toMatchObject({
      status: "ignored",
      outcome: "other_env",
    });
    expect(fakes.leads).toHaveLength(0);
  });

  it("this environment's event (local here): received and queued, as before", async () => {
    const res = await rzpPost(rzpBody("local"), "evt_P7SAME01");
    expect(res.status).toBe(200);
    const rows = await rowsOf("razorpay", "evt_P7SAME01");
    expect(rows[0]).toMatchObject({ status: "received", outcome: null });
    expect(fakes.leads.map((m) => m.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
  });

  it("an unmarked event (a link made before P7): today's path, received and queued", async () => {
    const res = await rzpPost(rzpBody(null), "evt_P7NONE01");
    expect(res.status).toBe(200);
    const rows = await rowsOf("razorpay", "evt_P7NONE01");
    expect(rows[0]).toMatchObject({ status: "received", outcome: null });
    expect(fakes.leads).toHaveLength(1);
  });
});

// ---- PayPal -----------------------------------------------------------------------------------------------------------------------------------------------

const WEBHOOK = "TESTPAYPALWEBHOOK01";
const SANDBOX_CERT = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d";
const LIVE_CERT = "https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d";
let sandbox: TestSigner;
let live: TestSigner;
beforeAll(async () => {
  sandbox = await testSigner(SANDBOX_CERT);
  live = await testSigner(LIVE_CERT);
});
const certFetch = (async (input: RequestInfo | URL) => {
  const u = String(input instanceof Request ? input.url : input);
  return u === SANDBOX_CERT
    ? new Response(sandbox.pem, { status: 200 })
    : u === LIVE_CERT
      ? new Response(live.pem, { status: 200 })
      : new Response("no", { status: 404 });
}) as typeof fetch;

const ppEvent = (customId: string | null) => {
  const n = String(++seq).padStart(4, "0");
  const eventId = `WH-${n}P7ENV${Date.now()}`;
  return {
    eventId,
    body: JSON.stringify({
      id: eventId,
      create_time: "2026-11-07T10:00:00Z",
      resource_type: "capture",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: `2GG2${n}U471931P`,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "500.00" },
        final_capture: true,
        ...(customId === null ? {} : { custom_id: customId }),
        create_time: "2026-11-07T09:59:00Z",
        supplementary_data: { related_ids: { order_id: `5O19${n}TN364715T` } },
      },
    }),
  };
};
const ppPost = async (body: string, o: { signer?: TestSigner; over?: Record<string, unknown> } = {}) => {
  const s = o.signer ?? sandbox;
  const headers = await s.headers(body, WEBHOOK, s === live ? { certUrl: LIVE_CERT } : {});
  return payPalHook(
    new Request("https://jobs.example.test/paypal", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    makeEnv({ PAYPAL_WEBHOOK_ID: WEBHOOK, ...o.over }) as unknown as { DB: D1Database; LEADS_QUEUE: Queue },
    Date.now(),
    certFetch,
  );
};

describe("POST /paypal: the environment mark (finding 5) and the certificate host by mode (A2.1)", () => {
  it("another environment's capture: 200, kept `ignored` (other_env) with the name and mark only, no message, no review, no bell", async () => {
    const [reviews, bells] = [await reviewCount(), await bellCount()];
    const checkout = uuidv7();
    const e = ppEvent(`${checkout}-production`);
    const res = await ppPost(e.body);
    expect(res.status).toBe(200);
    const rows = await rowsOf("paypal", e.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ignored", outcome: "other_env" });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toEqual({
      event: "PAYMENT.CAPTURE.COMPLETED",
      env: "production",
    });
    expect(fakes.leads).toHaveLength(0);
    expect(await reviewCount()).toBe(reviews);
    expect(await bellCount()).toBe(bells);
    expect(logs.join("\n")).toContain('"o":"other_env"');
    expect(logs.join("\n")).not.toContain(checkout);
  });

  it("this environment's capture: received with the bare checkout id and the mark in the facts, and queued", async () => {
    const checkout = uuidv7();
    const e = ppEvent(`${checkout}-local`);
    expect((await ppPost(e.body)).status).toBe(200);
    const rows = await rowsOf("paypal", e.eventId);
    expect(rows[0]).toMatchObject({ status: "received", outcome: null });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toMatchObject({ checkoutId: checkout, env: "local" });
    expect(fakes.leads.map((m) => m.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
  });

  it("an unmarked capture (an order made before P7): today's path", async () => {
    const checkout = uuidv7();
    const e = ppEvent(checkout);
    expect((await ppPost(e.body)).status).toBe(200);
    const rows = await rowsOf("paypal", e.eventId);
    expect(rows[0]).toMatchObject({ status: "received" });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).not.toHaveProperty("env");
    expect(fakes.leads).toHaveLength(1);
  });

  it("A2.1: a live-host certificate is refused while the flag is off (test mode), and a sandbox one while PayPal runs live", async () => {
    const a = ppEvent(`${uuidv7()}-local`);
    const res = await ppPost(a.body, { signer: live });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "signature_missing" } });
    expect(await rowsOf("paypal", a.eventId)).toHaveLength(0);
    // the flag on and Settings › Gateways says live: the live host is accepted, the sandbox host refused
    await setModes({ paypal: "live" });
    const b = ppEvent(`${uuidv7()}-local`);
    expect((await ppPost(b.body, { signer: live, over: { PAYMENTS_LIVE_ALLOWED: "true" } })).status).toBe(
      200,
    );
    expect(await rowsOf("paypal", b.eventId)).toHaveLength(1);
    const c = ppEvent(`${uuidv7()}-local`);
    expect((await ppPost(c.body, { over: { PAYMENTS_LIVE_ALLOWED: "true" } })).status).toBe(400);
    expect(await rowsOf("paypal", c.eventId)).toHaveLength(0);
  });
});

// ---- Stripe (A2.2) ------------------------------------------------------------------------------------------------------------------------------------------

const STRIPE_SECRET = "whsec_test_p7_env_marks";
async function stripeHeader(body: string, t: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(STRIPE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${t},v1=${sig}`;
}
const stripeEvent = (livemode: boolean) => {
  const id = `evt_P7${++seq}${Date.now()}`;
  return {
    id,
    body: JSON.stringify({
      id,
      object: "event",
      type: "checkout.session.completed",
      livemode,
      created: 1_790_000_000,
      data: {
        object: {
          id: `cs_test_P7${seq}`,
          object: "checkout.session",
          livemode,
          amount_total: 50000,
          currency: "usd",
          payment_status: "paid",
          status: "complete",
          payment_intent: `pi_P7${seq}`,
          client_reference_id: null,
          metadata: {
            app: "techaust",
            techaust_checkout_id: uuidv7(),
            techaust_document_id: uuidv7(),
            techaust_env: "local",
          },
        },
      },
    }),
  };
};
const stripePost = async (body: string, over: Record<string, unknown> = {}) => {
  const now = Date.now();
  return stripeHook(
    new Request("https://jobs.example.test/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await stripeHeader(body, Math.floor(now / 1000)),
      },
      body,
    }),
    makeEnv({ STRIPE_WEBHOOK_SECRET: STRIPE_SECRET, ...over }) as unknown as {
      DB: D1Database;
      LEADS_QUEUE: Queue;
    },
    now,
  );
};

describe("POST /stripe (A2.2): livemode follows the mode Stripe runs in", () => {
  it("the flag off: a test event is kept, a live one answered 200 with nothing written (as before)", async () => {
    const t = stripeEvent(false);
    expect((await stripePost(t.body)).status).toBe(200);
    expect(await rowsOf("stripe", t.id)).toHaveLength(1);
    const l = stripeEvent(true);
    expect((await stripePost(l.body)).status).toBe(200);
    expect(await rowsOf("stripe", l.id)).toHaveLength(0);
    expect(logs.join("\n")).toContain('"o":"livemode_mismatch"');
  });

  it("the flag on but Settings › Gateways still test: a live event is no longer kept (it was, before P7)", async () => {
    const l = stripeEvent(true);
    expect((await stripePost(l.body, { PAYMENTS_LIVE_ALLOWED: "true" })).status).toBe(200);
    expect(await rowsOf("stripe", l.id)).toHaveLength(0);
    const t = stripeEvent(false);
    expect((await stripePost(t.body, { PAYMENTS_LIVE_ALLOWED: "true" })).status).toBe(200);
    expect(await rowsOf("stripe", t.id)).toHaveLength(1);
  });

  it("the flag on and Stripe set to live: only live events are kept; a test one is answered 200 with nothing written", async () => {
    await setModes({ stripe: "live" });
    const t = stripeEvent(false);
    expect((await stripePost(t.body, { PAYMENTS_LIVE_ALLOWED: "true" })).status).toBe(200);
    expect(await rowsOf("stripe", t.id)).toHaveLength(0);
    const l = stripeEvent(true);
    expect((await stripePost(l.body, { PAYMENTS_LIVE_ALLOWED: "true" })).status).toBe(200);
    expect(await rowsOf("stripe", l.id)).toHaveLength(1);
  });
});
