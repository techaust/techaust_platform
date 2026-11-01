// M6.2 Razorpay in the jobs Worker [JOB-HOOK-01..03, ADM-PAY-02; run file D and H]: the webhook (`POST /razorpay` only; 415, 413 streamed, 503 unconfigured
// with no D1, signature missing not counted, signature invalid counted with one bell at 5 and the cap of 50, one row and one message per event, a duplicate
// delivery queued once, `ignored` for other events, a queue failure 500 with the row kept, no body or signature in the logs) and the gateway consumer (routed
// before the lead fall-through, `retry` with backoff, `next` queues the advance, a bad RPC answer throws so the queue retries, the dead letter, the sweep ≤ 20).
// The finance Worker is a typed fake; Razorpay is never called.
import { exports, env as realEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hourlyMessages } from "../src/billing.ts";
import {
  ADVANCE_TRIES,
  gatewayRetryDelay,
  processGateway,
  processGatewayDeadLetter,
} from "../src/gateway.ts";
import { HOOK_MAX_BYTES, razorpayHook } from "../src/hooks/razorpay.ts";
import { handleQueue } from "../src/queue.ts";
import { warmRazorpayHook } from "../src/warm.ts";
import { fakes, logs, makeEnv, mkClient, mkDoc, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

const SECRET = "test-razorpay-webhook-secret";
const enc = new TextEncoder();
async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
let seq = 0;
const paidBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    entity: "event",
    event: "payment_link.paid",
    created_at: 1_790_000_000,
    payload: {
      payment_link: {
        entity: {
          id: `plink_T${++seq}AAAA`,
          amount: 118000,
          currency: "INR",
          status: "paid",
          customer: { email: "payer@example.test" },
        },
      },
      payment: {
        entity: {
          id: `pay_T${seq}AAAA`,
          amount: 118000,
          currency: "INR",
          method: "upi",
          email: "payer@example.test",
          contact: "+919999999999",
          vpa: "x@upi",
        },
      },
    },
    ...over,
  });

async function post(
  body: string,
  headers: Record<string, string> = {},
  e = makeEnv({ RAZORPAY_WEBHOOK_SECRET: SECRET }),
) {
  return razorpayHook(
    new Request("https://jobs.example.test/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    e as unknown as { DB: D1Database; LEADS_QUEUE: Queue },
  );
}
const signedPost = async (body: string, eventId: string | null, e?: ReturnType<typeof makeEnv>) =>
  post(
    body,
    { "x-razorpay-signature": await sign(body), ...(eventId ? { "x-razorpay-event-id": eventId } : {}) },
    e,
  );

const rowsOf = async (eventId: string) =>
  (
    await realEnv.DB.prepare("SELECT id, status, event_type, facts FROM webhook_events WHERE event_id = ?1")
      .bind(eventId)
      .all<{
        id: string;
        status: string;
        event_type: string;
        facts: string;
      }>()
  ).results;

describe("POST /razorpay [JOB-HOOK-01..03]", () => {
  it("a valid event: 200, one row with whitelisted facts only, one gateway.event message", async () => {
    const body = paidBody();
    const res = await signedPost(body, "evt_VALID0001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await rowsOf("evt_VALID0001");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("received");
    expect(rows[0]?.facts).not.toMatch(/payer@example|\+91|x@upi/);
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toMatchObject({ event: "payment_link.paid", method: "upi" });
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
    // never the body, the signature or the secret in a log line
    const all = logs.join("\n");
    expect(all).not.toContain("payer@example");
    expect(all).not.toContain(SECRET);
  });

  it("a duplicate delivery: 200, no second row; queued again only while still received", async () => {
    const body = paidBody();
    await signedPost(body, "evt_DUP0001");
    await signedPost(body, "evt_DUP0001");
    expect(await rowsOf("evt_DUP0001")).toHaveLength(1);
    // still `received`: the redelivery is queued again (the consumer answers duplicate once it is handled)
    expect(fakes.leads).toHaveLength(2);
    await realEnv.DB.prepare(
      "UPDATE webhook_events SET status = 'processed' WHERE event_id = 'evt_DUP0001'",
    ).run();
    await signedPost(body, "evt_DUP0001");
    expect(fakes.leads).toHaveLength(2);
  });

  it("no event-id header: the body's hash is the id (and a log line says so)", async () => {
    const body = paidBody();
    expect((await signedPost(body, null)).status).toBe(200);
    expect(logs.join("\n")).toContain("hook.event_id_fallback");
    expect(fakes.leads).toHaveLength(1);
  });

  it("an event we don't handle is stored ignored and not queued", async () => {
    const body = paidBody({ event: "payment.captured" });
    expect((await signedPost(body, "evt_OTHER0001")).status).toBe(200);
    expect((await rowsOf("evt_OTHER0001"))[0]?.status).toBe("ignored");
    expect(fakes.leads).toHaveLength(0);
  });

  it("415 without JSON, 413 over 64 KiB (streamed, no length header), and no D1 write for either", async () => {
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    const big = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`{"a":"${"x".repeat(HOOK_MAX_BYTES)}"}`));
        c.close();
      },
    });
    const res = await razorpayHook(
      new Request("https://jobs.example.test/razorpay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
        duplex: "half",
      } as RequestInit),
      makeEnv({ RAZORPAY_WEBHOOK_SECRET: SECRET }) as unknown as { DB: D1Database; LEADS_QUEUE: Queue },
    );
    expect(res.status).toBe(413);
  });

  it("the secret unset: 503 hook_unconfigured and nothing written (not even a failure count)", async () => {
    const before = (
      await realEnv.DB.prepare("SELECT count(*) AS n FROM hook_failures").first<{ n: number }>()
    )?.n;
    const res = await post(
      paidBody(),
      { "x-razorpay-signature": "a".repeat(64) },
      makeEnv({ RAZORPAY_WEBHOOK_SECRET: "" }),
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("hook_unconfigured");
    expect(
      (await realEnv.DB.prepare("SELECT count(*) AS n FROM hook_failures").first<{ n: number }>())?.n,
    ).toBe(before);
  });

  it("a missing or malformed signature: 400 signature_missing, NOT counted", async () => {
    for (const h of [{}, { "x-razorpay-signature": "zz" }, { "x-razorpay-signature": "a".repeat(63) }]) {
      const res = await post(paidBody(), h);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("signature_missing");
    }
    expect(
      (await realEnv.DB.prepare("SELECT count(*) AS n FROM hook_failures").first<{ n: number }>())?.n ?? 0,
    ).toBe(0);
  });

  it("a wrong signature: 400 counted in the hour's window; the 5th rings the owners once; the count stops at 50", async () => {
    await staff("owner");
    const e = makeEnv({ RAZORPAY_WEBHOOK_SECRET: SECRET });
    const body = paidBody();
    const bad = await sign(body, "another-secret");
    for (let i = 0; i < 6; i++) {
      const res = await post(body, { "x-razorpay-signature": bad }, e);
      expect(res.status).toBe(400);
    }
    const row = await realEnv.DB.prepare("SELECT key, count FROM hook_failures").first<{
      key: string;
      count: number;
    }>();
    expect(row?.count).toBe(6);
    expect(row?.key).toMatch(/^razorpay:sig:\d+$/);
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM notifications WHERE kind = 'payment.hook_signature'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
    await realEnv.DB.prepare("UPDATE hook_failures SET count = 50").run();
    await post(body, { "x-razorpay-signature": bad }, e);
    expect(
      (await realEnv.DB.prepare("SELECT count FROM hook_failures").first<{ count: number }>())?.count,
    ).toBe(50);
    expect(await rowsOf("evt_never")).toHaveLength(0);
  });

  it("the previous secret is accepted during a rotation", async () => {
    const body = paidBody();
    const res = await post(
      body,
      { "x-razorpay-signature": await sign(body, "old-secret"), "x-razorpay-event-id": "evt_ROT0001" },
      makeEnv({ RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "old-secret" }),
    );
    expect(res.status).toBe(200);
  });

  it("a queue failure: 500 with the row kept (Razorpay retries; the sweep is the safety net)", async () => {
    const body = paidBody();
    const e = makeEnv({
      RAZORPAY_WEBHOOK_SECRET: SECRET,
      LEADS_QUEUE: {
        send: async () => {
          throw new Error("down");
        },
      },
    });
    const res = await signedPost(body, "evt_QFAIL0001", e);
    expect(res.status).toBe(500);
    expect(await rowsOf("evt_QFAIL0001")).toHaveLength(1);
  });

  it("through the Worker: only POST /razorpay; GET and /razorpay/x are 404 with no D1", async () => {
    expect((await exports.default.fetch("https://jobs.example.test/razorpay")).status).toBe(404);
    expect(
      (await exports.default.fetch("https://jobs.example.test/razorpay/x", { method: "POST" })).status,
    ).toBe(404);
    const res = await exports.default.fetch("https://jobs.example.test/razorpay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  it("a verified event of a handled type that fails the strict parse is KEPT (received, name and link id only) and queued [early check 2, finding 3]", async () => {
    const body = JSON.stringify({
      entity: "event",
      event: "payment_link.paid",
      created_at: 1_790_000_000,
      payload: {
        payment_link: {
          entity: { id: "plink_KEPT0001", amount: "oops", customer: { email: "payer@example.test" } },
        },
        payment: { entity: { email: "payer@example.test", contact: "+919999999999" } },
      },
    });
    const res = await signedPost(body, "evt_KEPT0001");
    expect(res.status).toBe(200);
    const rows = await rowsOf("evt_KEPT0001");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("received");
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toEqual({
      event: "payment_link.paid",
      linkId: "plink_KEPT0001",
    });
    expect(fakes.leads.map((x) => x.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
    // an unreadable body of an event we don't handle is still only logged
    const other = JSON.stringify({ event: "payment.captured", created_at: "x" });
    expect((await signedPost(other, "evt_KEPT0002")).status).toBe(200);
    expect(await rowsOf("evt_KEPT0002")).toHaveLength(0);
  });

  it("one log line per call with the status and the first-run marker, never an id, the body or the signature [early check 2, findings 15 and 6]", async () => {
    const body = paidBody();
    const sig = await sign(body);
    await post(body, { "x-razorpay-signature": sig, "x-razorpay-event-id": "evt_LOG0001" });
    await post("{}", { "content-type": "text/plain" });
    const lines = logs.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.ev === "hook");
    expect(lines.map((l) => l.s)).toEqual([200, 415]);
    expect(lines.every((l) => l.p === "razorpay")).toBe(true);
    for (const l of lines)
      expect(Object.keys(l).sort()).toEqual(l.f === 1 ? ["ev", "f", "p", "s"] : ["ev", "p", "s"]);
    const all = logs.join("\n");
    expect(all).not.toContain(sig);
    expect(all).not.toContain("evt_LOG0001");
    expect(all).not.toContain("plink_T");
    expect(all).not.toContain(body.slice(0, 40));
  });

  it("the start-up warm-up runs all five steps", async () => {
    expect(await warmRazorpayHook()).toBe(5);
  });
});

describe("the gateway consumer [run file D]", () => {
  const gateway = (answers: { process?: unknown; advance?: unknown }) => ({
    ADMIN_GATEWAY: {
      processEvent: async (arg: unknown) => {
        fakes.rpc.push({ method: "processEvent", arg });
        return answers.process;
      },
      issueGatewayAdvance: async (arg: unknown) => {
        fakes.rpc.push({ method: "issueGatewayAdvance", arg });
        return answers.advance;
      },
    },
  });

  it("gateway.event: processed is acked; retry comes back with a growing delay; next queues the advance", async () => {
    const id = "01900000-0000-7000-8000-000000000001";
    expect(
      await processGateway(
        makeEnv(gateway({ process: { result: "processed" } })),
        { kind: "gateway.event", eventId: id } as never,
        1,
      ),
    ).toBe("ack");
    expect(
      await processGateway(
        makeEnv(gateway({ process: { result: "retry" } })),
        { kind: "gateway.event", eventId: id } as never,
        3,
      ),
    ).toEqual({
      retry: gatewayRetryDelay(3),
    });
    expect(gatewayRetryDelay(1)).toBe(60);
    expect(gatewayRetryDelay(20)).toBe(3_600);
    await processGateway(
      makeEnv(
        gateway({
          process: { result: "processed", next: { kind: "gateway.advance", paymentId: "rzp_pay_X1" } },
        }),
      ),
      { kind: "gateway.event", eventId: id } as never,
      1,
    );
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "gateway.advance", paymentId: "rzp_pay_X1" }]);
  });

  it("gateway.advance: one try per delivery; `retry` comes back once, then the last try is asked with lastTry [early check 2, finding 1]", async () => {
    const env = makeEnv(gateway({ advance: { result: "retry" } }));
    const body = { kind: "gateway.advance", paymentId: "rzp_pay_ADV1" } as never;
    expect(await processGateway(env, body, 1)).toEqual({ retry: gatewayRetryDelay(1) });
    expect(await processGateway(env, body, 2)).toBe("ack");
    expect(fakes.rpc.map((r) => r.arg)).toEqual([
      { paymentId: "rzp_pay_ADV1", lastTry: false },
      { paymentId: "rzp_pay_ADV1", lastTry: true },
    ]);
    expect(ADVANCE_TRIES).toBe(2);
  });

  it("a duplicate that still waits for its tax invoice carries `next`: the advance is queued [early check 2, finding 2]", async () => {
    await processGateway(
      makeEnv(
        gateway({
          process: { result: "duplicate", next: { kind: "gateway.advance", paymentId: "rzp_pay_D1" } },
        }),
      ),
      { kind: "gateway.event", eventId: "01900000-0000-7000-8000-000000000002" } as never,
      2,
    );
    expect(fakes.leads.map((x) => x.body)).toEqual([{ kind: "gateway.advance", paymentId: "rzp_pay_D1" }]);
  });

  it("a failed send of `next` throws (the queue retries) and the hourly sweep finds the waiting payment anyway [early check 2, finding 2]", async () => {
    const now = Date.now();
    const failing = makeEnv({
      ...gateway({ process: { result: "processed", next: { kind: "gateway.advance", paymentId: "rzp_x" } } }),
      LEADS_QUEUE: {
        send: async () => {
          throw new Error("down");
        },
      },
    });
    await expect(
      processGateway(
        failing,
        { kind: "gateway.event", eventId: "01900000-0000-7000-8000-000000000003" } as never,
        1,
      ),
    ).rejects.toThrow(/down/);
    // The payment the lost `next` was for: a proforma's Razorpay payment, pending with its requested allocation, recorded 20 minutes ago.
    const owner = await staff("owner");
    const clientId = await mkClient();
    const pf = await mkDoc(clientId, null, { type: "proforma" });
    const checkoutId = `co-${now}`;
    await realEnv.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'razorpay', ?2, ?3, ?6, 'staff', 'INR', 118000, 'creating', ?4, ?5, ?5)`,
    )
      .bind(checkoutId, pf.id, clientId, now + 86_400_000, now - 30 * 60_000, owner.id)
      .run();
    await realEnv.DB.prepare(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
    )
      .bind(checkoutId, `plink_SW${now}`, now - 29 * 60_000)
      .run();
    const paymentId = `rzp_pay_SWEEP${now}`;
    await realEnv.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, requested_allocations,
         recorded_by, recorded_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
       VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 118000, 0, '2026-10-28', 'upi', ?3, ?4, NULL, ?5, ?6, ?7, 0, ?5)`,
    )
      .bind(
        paymentId,
        clientId,
        `PAY-SWEEP${now}`,
        JSON.stringify([{ documentId: pf.id, amountMinor: 118000 }]),
        now - 20 * 60_000,
        `pay_SWEEP${now}`,
        checkoutId,
      )
      .run();
    expect(await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now)).toBe(
      "ack",
    );
    expect(fakes.leads.map((x) => x.body)).toContainEqual({ kind: "gateway.advance", paymentId });
    // once the Owner was told (an open advance_blocked item), the sweep leaves it to them
    fakes.leads.length = 0;
    await realEnv.DB.prepare(
      "INSERT INTO review_items (id, source, provider, kind, status, payment_id, document_id, client_id, created_at) VALUES (?1, 'webhook', 'razorpay', 'advance_blocked', 'open', ?2, ?3, ?4, ?5)",
    )
      .bind(`ri-${now}`, paymentId, pf.id, clientId, now)
      .run();
    await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now);
    expect(fakes.leads.map((x) => x.body)).not.toContainEqual({ kind: "gateway.advance", paymentId });
  });

  it("a bad RPC answer throws (the queue retries); a missing binding too", async () => {
    await expect(
      processGateway(
        makeEnv(gateway({ process: { result: "maybe" } })),
        { kind: "gateway.event", eventId: "e1" } as never,
        1,
      ),
    ).rejects.toThrow(/rpc_bad_result/);
    await expect(
      processGateway(
        makeEnv({ ADMIN_GATEWAY: undefined }),
        { kind: "gateway.advance", paymentId: "p1" } as never,
        1,
      ),
    ).rejects.toThrow(/rpc_unavailable/);
  });

  it("is routed before the lead fall-through: a malformed gateway body never becomes a lead", async () => {
    const acked: string[] = [];
    const batch = {
      queue: "techaust-local-leads",
      messages: [
        {
          body: { kind: "gateway.event", eventId: "" },
          attempts: 1,
          ack: () => acked.push("ack"),
          retry: () => acked.push("retry"),
        },
      ],
    } as unknown as MessageBatch<unknown>;
    await handleQueue(batch, makeEnv());
    expect(acked).toEqual(["ack"]);
    expect((await realEnv.DB.prepare("SELECT count(*) AS n FROM leads").first<{ n: number }>())?.n ?? 0).toBe(
      0,
    );
    expect(logs.join("\n")).toContain("gateway.invalid_message");
  });

  it("the sweep re-queues at most 20 events stuck for 15 minutes with fewer than 10 tries", async () => {
    const now = Date.now();
    for (let i = 0; i < 23; i++)
      await realEnv.DB.prepare(
        "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', ?3, 'received', 0)",
      )
        .bind(`sweep-${i}-${now}`, `evt_SWEEP${i}${now}`, now - 20 * 60_000)
        .run();
    await realEnv.DB.prepare("UPDATE webhook_events SET attempts = 10 WHERE id = ?1")
      .bind(`sweep-0-${now}`)
      .run();
    expect(await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now)).toBe(
      "ack",
    );
    expect(fakes.leads).toHaveLength(20);
    expect(fakes.leads.every((s) => (s.body as { kind: string }).kind === "gateway.event")).toBe(true);
  });

  it("the dead letter: the event failed, one dead_letter item, the owners' bell; again adds nothing", async () => {
    await staff("owner");
    const id = `dlq-${Date.now()}`;
    await realEnv.DB.prepare(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', ?3, 'received', 0, ?4)",
    )
      .bind(
        id,
        `evt_${id.replace(/-/g, "")}`,
        Date.now(),
        JSON.stringify({ linkId: "plink_DLQ1", amountMinor: 100, currency: "INR" }),
      )
      .run();
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.event", eventId: id } as never);
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.event", eventId: id } as never);
    expect(
      await realEnv.DB.prepare("SELECT status, outcome FROM webhook_events WHERE id = ?1").bind(id).first(),
    ).toEqual({
      status: "failed",
      outcome: "dead_letter",
    });
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM review_items WHERE webhook_event_id = ?1 AND kind = 'dead_letter'",
        )
          .bind(id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });

  it("the hourly tick queues one gateway.sweep", async () => {
    const m = hourlyMessages(Date.parse("2026-10-15T07:30:00.000Z"));
    expect(m.filter((x) => x.kind === "gateway.sweep")).toHaveLength(1);
  });
});
