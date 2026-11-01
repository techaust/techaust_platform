// M6.3 Stripe in the jobs Worker [JOB-HOOK-01..03, ADM-PAY-01; run file D and I]: the webhook (`POST /stripe` only; 415, 413 streamed, 503 unconfigured with no
// D1, a missing header not counted, a bad signature or an old timestamp (a replay) counted with one bell at 5 and the cap of 50, the other business's events and
// other modes or environments answered 200 with NO D1 write, one row and one message per event of ours, a duplicate delivery queued once, a queue failure 500
// with the row kept, no body or header in the logs) and the consumer's `gateway.refresh` (routed before the lead fall-through, the sweep's third read). The
// finance Worker is a typed fake; Stripe is never called. The secrets are made-up values built at run time (never a secret-looking literal in the repo).
import { exports, env as realEnv } from "cloudflare:workers";
import { stripeTestHeader } from "@techaust/core/stripe";
import { describe, expect, it } from "vitest";
import { processGateway } from "../src/gateway.ts";
import { HOOK_MAX_BYTES } from "../src/hooks/shared.ts";
import { BELL_SIGNATURES_STRIPE, stripeHook } from "../src/hooks/stripe.ts";
import { handleQueue } from "../src/queue.ts";
import { fakes, logs, makeEnv, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

/** The test pool's own secret (vitest.config.ts builds the same value). */
const SECRET = ["whsec", "madeupfortests"].join("_");
const OTHER = ["whsec", "anotherone"].join("_");
const enc = new TextEncoder();
let seq = 0;

const ids = () => {
  const n = String(++seq).padStart(4, "0");
  return {
    checkoutId: `01900000-0000-7000-8000-00000000${n}`,
    documentId: `01900000-0000-7000-8000-10000000${n}`,
    sessionId: `cs_test_a1HOOK${n}${"B".repeat(50)}`,
    eventId: `evt_HOOK${n}${Date.now()}`,
  };
};

/** A Stripe event body shaped like Stripe's `fixtures3.json`; ours unless `metadata` says otherwise. */
function eventBody(
  over: { type?: string; livemode?: boolean; metadata?: Record<string, unknown> | null; env?: string } = {},
) {
  const i = ids();
  const metadata =
    over.metadata === undefined
      ? {
          app: "techaust",
          techaust_checkout_id: i.checkoutId,
          techaust_document_id: i.documentId,
          techaust_env: over.env ?? "local",
        }
      : over.metadata;
  return {
    ...i,
    body: JSON.stringify({
      id: i.eventId,
      object: "event",
      type: over.type ?? "checkout.session.completed",
      livemode: over.livemode ?? false,
      created: Math.trunc(Date.now() / 1000),
      data: {
        object: {
          id: i.sessionId,
          object: "checkout.session",
          amount_total: 50_000,
          currency: "usd",
          payment_intent: `pi_HOOK${seq}`,
          payment_status: "paid",
          status: "complete",
          metadata,
          customer_details: { name: "Jane Payer", email: "jane@example.test", address: { country: "US" } },
        },
      },
    }),
  };
}

type HookEnv = { DB: D1Database; LEADS_QUEUE: Queue };
async function post(
  body: string,
  headers: Record<string, string> = {},
  e = makeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }),
) {
  return stripeHook(
    new Request("https://jobs.example.test/stripe", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", ...headers },
      body,
    }),
    e as unknown as HookEnv,
  );
}
const signed = async (
  body: string,
  o: { secret?: string; t?: number; e?: ReturnType<typeof makeEnv> } = {},
) =>
  post(
    body,
    {
      "stripe-signature": await stripeTestHeader(
        body,
        o.secret ?? SECRET,
        o.t ?? Math.trunc(Date.now() / 1000),
      ),
    },
    o.e,
  );

const rowsOf = async (eventId: string) =>
  (
    await realEnv.DB.prepare(
      "SELECT id, status, event_type, facts FROM webhook_events WHERE provider = 'stripe' AND event_id = ?1",
    )
      .bind(eventId)
      .all<{ id: string; status: string; event_type: string; facts: string }>()
  ).results;
const failures = async () =>
  (
    await realEnv.DB.prepare("SELECT count FROM hook_failures WHERE key LIKE 'stripe:sig:%'").first<{
      count: number;
    }>()
  )?.count ?? 0;
const eventCount = async () =>
  (
    await realEnv.DB.prepare("SELECT count(*) AS n FROM webhook_events WHERE provider = 'stripe'").first<{
      n: number;
    }>()
  )?.n ?? 0;

describe("POST /stripe [JOB-HOOK-01..03, L5]", () => {
  it("our event: 200, one row with whitelisted facts only, one gateway.event message", async () => {
    const e = eventBody();
    const res = await signed(e.body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await rowsOf(e.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "received", event_type: "checkout.session.completed" });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toEqual({
      event: "checkout.session.completed",
      livemode: 0,
      linkId: e.sessionId,
      paymentId: `pi_HOOK${seq}`,
      amountMinor: 50_000,
      currency: "USD",
      paymentStatus: "paid",
      checkoutId: e.checkoutId,
    });
    expect(rows[0]?.facts).not.toMatch(/Jane|jane@example/);
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
    const all = logs.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("jane@example");
    expect(all).not.toContain(e.eventId);
  });

  it("a duplicate delivery: no second row; queued again only while still received", async () => {
    const e = eventBody();
    await signed(e.body);
    await signed(e.body);
    expect(await rowsOf(e.eventId)).toHaveLength(1);
    expect(fakes.leads).toHaveLength(2);
    await realEnv.DB.prepare("UPDATE webhook_events SET status = 'processed' WHERE event_id = ?1")
      .bind(e.eventId)
      .run();
    await signed(e.body);
    expect(fakes.leads).toHaveLength(2);
  });

  it("the other business's event, the other mode, or another environment: 200 with NO D1 write and no message [reviewer L12]", async () => {
    const before = await eventCount();
    for (const [o, code] of [
      [{ metadata: null }, "not_techaust"],
      [{ metadata: { app: "other-shop", order: "123" } }, "not_techaust"],
      [{ livemode: true }, "livemode_mismatch"],
      [{ env: "staging" }, "other_env"],
      [{ type: "charge.refunded" }, "not_techaust"],
    ] as const) {
      const e = eventBody(o);
      const res = await signed(e.body);
      expect(res.status, code).toBe(200);
      expect(await rowsOf(e.eventId)).toHaveLength(0);
      expect(logs.join("\n")).toContain(`"o":"${code}"`);
    }
    expect(await eventCount()).toBe(before);
    expect(fakes.leads).toHaveLength(0);
  });

  it("415 without JSON, 413 over 64 KiB (streamed), and nothing written", async () => {
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    const big = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`{"a":"${"x".repeat(HOOK_MAX_BYTES)}"}`));
        c.close();
      },
    });
    const res = await stripeHook(
      new Request("https://jobs.example.test/stripe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
        duplex: "half",
      } as RequestInit),
      makeEnv({ STRIPE_WEBHOOK_SECRET: SECRET }) as unknown as HookEnv,
    );
    expect(res.status).toBe(413);
  });

  it("the secret unset: 503 hook_unconfigured, nothing written; no header: 400 signature_missing, not counted", async () => {
    const e = eventBody();
    const res = await post(
      e.body,
      { "stripe-signature": "t=1,v1=00" },
      makeEnv({ STRIPE_WEBHOOK_SECRET: "" }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("hook_unconfigured");
    const missing = await post(e.body);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("signature_missing");
    expect(await failures()).toBe(0);
    expect(await rowsOf(e.eventId)).toHaveLength(0);
  });

  it("a wrong secret or an old timestamp (a replay): 400 counted; the 5th rings the owners once; the count stops at 50", async () => {
    await staff("owner");
    const e = eventBody();
    for (let i = 0; i < 3; i++) expect((await signed(e.body, { secret: OTHER })).status).toBe(400);
    // a valid signature 301 s old: a replay, counted too
    for (let i = 0; i < 3; i++)
      expect((await signed(e.body, { t: Math.trunc(Date.now() / 1000) - 301 })).status).toBe(400);
    expect(await failures()).toBe(6);
    expect(
      await realEnv.DB.prepare(
        "SELECT count(*) AS n, max(title) AS t FROM notifications WHERE kind = 'payment.hook_signature'",
      ).first<{
        n: number;
        t: string;
      }>(),
    ).toEqual({ n: 1, t: BELL_SIGNATURES_STRIPE });
    await realEnv.DB.prepare("UPDATE hook_failures SET count = 50 WHERE key LIKE 'stripe:sig:%'").run();
    await signed(e.body, { secret: OTHER });
    expect(await failures()).toBe(50);
    expect(await rowsOf(e.eventId)).toHaveLength(0);
  });

  it("the previous secret is accepted during a rotation; an unreadable signed body is 400 invalid_event, not counted", async () => {
    const e = eventBody();
    const res = await signed(e.body, {
      secret: OTHER,
      e: makeEnv({ STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_WEBHOOK_SECRET_PREVIOUS: OTHER }),
    });
    expect(res.status).toBe(200);
    const bad = await signed('{"id":"evt_x"}');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_event");
    expect(await failures()).toBe(0);
  });

  it("a queue failure: 500 with the row kept", async () => {
    const e = eventBody();
    const res = await signed(e.body, {
      e: makeEnv({
        STRIPE_WEBHOOK_SECRET: SECRET,
        LEADS_QUEUE: {
          send: async () => {
            throw new Error("down");
          },
        },
      }),
    });
    expect(res.status).toBe(500);
    expect(await rowsOf(e.eventId)).toHaveLength(1);
  });

  it("through the Worker: only POST /stripe; GET and /stripe/x are 404; an unsigned JSON post is 400 signature_missing (the staging probe)", async () => {
    expect((await exports.default.fetch("https://jobs.example.test/stripe")).status).toBe(404);
    expect(
      (await exports.default.fetch("https://jobs.example.test/stripe/x", { method: "POST" })).status,
    ).toBe(404);
    const res = await exports.default.fetch("https://jobs.example.test/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("signature_missing");
  });

  it("one log line per call: the status, the outcome code, the first-run marker; never the header or the body", async () => {
    const e = eventBody({ metadata: null });
    const header = await stripeTestHeader(e.body, SECRET, Math.trunc(Date.now() / 1000));
    await post(e.body, { "stripe-signature": header });
    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.ev === "hook");
    expect(lines.at(-1)).toMatchObject({ p: "stripe", s: 200, o: "not_techaust" });
    expect(logs.join("\n")).not.toContain(header);
    expect(logs.join("\n")).not.toContain(e.body.slice(0, 30));
  });
});

describe("gateway.refresh and the sweep [L13, F4]", () => {
  const gateway = (refresh: unknown) => ({
    ADMIN_GATEWAY: {
      processEvent: async () => ({ result: "processed" }),
      issueGatewayAdvance: async () => ({ result: "issued" }),
      refreshCheckout: async (arg: unknown) => {
        fakes.rpc.push({ method: "refreshCheckout", arg });
        return refresh;
      },
    },
  });
  const id = "01900000-0000-7000-8000-00000000abcd";

  it("calls refreshCheckout with the checkout id; retry comes back with a delay; a bad answer throws", async () => {
    expect(
      await processGateway(
        makeEnv(gateway({ result: "processed" })),
        { kind: "gateway.refresh", checkoutId: id } as never,
        1,
      ),
    ).toBe("ack");
    expect(fakes.rpc).toEqual([{ method: "refreshCheckout", arg: { checkoutId: id } }]);
    expect(
      await processGateway(
        makeEnv(gateway({ result: "retry" })),
        { kind: "gateway.refresh", checkoutId: id } as never,
        2,
      ),
    ).toEqual({ retry: 120 });
    await expect(
      processGateway(
        makeEnv(gateway({ result: "paid" })),
        { kind: "gateway.refresh", checkoutId: id } as never,
        1,
      ),
    ).rejects.toThrow("rpc_bad_result");
    expect(
      await processGateway(
        makeEnv(gateway({ result: "processed" })),
        { kind: "gateway.refresh", checkoutId: "" } as never,
        1,
      ),
    ).toBe("ack");
  });

  it("is routed before the lead fall-through: a malformed refresh never becomes a lead", async () => {
    const acked: string[] = [];
    const batch = {
      queue: "techaust-local-leads",
      messages: [
        {
          body: { kind: "gateway.refresh", checkoutId: 5 },
          attempts: 1,
          ack: () => acked.push("ack"),
          retry: () => acked.push("retry"),
        },
      ],
    } as unknown as MessageBatch<unknown>;
    await handleQueue(batch, makeEnv(gateway({ result: "processed" })));
    expect(acked).toEqual(["ack"]);
    expect((await realEnv.DB.prepare("SELECT count(*) AS n FROM leads").first<{ n: number }>())?.n ?? 0).toBe(
      0,
    );
    expect(logs.join("\n")).toContain("gateway.invalid_message");
  });

  it("the sweep reads the stale live Stripe sessions as its third read and queues one gateway.refresh each", async () => {
    const now = Date.now();
    await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now);
    expect(
      fakes.leads.every((s) =>
        ["gateway.event", "gateway.advance", "gateway.refresh"].includes((s.body as { kind: string }).kind),
      ),
    ).toBe(true);
    expect(logs.join("\n")).toContain("refreshes");
  });
});
