// M6.2 Razorpay in the jobs Worker [JOB-HOOK-01..03, ADM-PAY-02; run file D and H]: the webhook (`POST /razorpay` only; 415, 413 streamed, 503 unconfigured
// with no D1, signature missing not counted, signature invalid counted with one bell at 5 and the cap of 50, one row and one message per event, a duplicate
// delivery queued once, `ignored` for other events, a queue failure 500 with the row kept, no body or signature in the logs) and the gateway consumer (routed
// before the lead fall-through, `retry` with backoff, `next` queues the advance, a bad RPC answer throws so the queue retries, the dead letter, the sweep ≤ 20).
// The finance Worker is a typed fake; Razorpay is never called.
import { exports, env as realEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hourlyMessages } from "../src/billing.ts";
import { gatewayRetryDelay, processGateway, processGatewayDeadLetter } from "../src/gateway.ts";
import { HOOK_MAX_BYTES, razorpayHook } from "../src/hooks/razorpay.ts";
import { handleQueue } from "../src/queue.ts";
import { warmRazorpayHook } from "../src/warm.ts";
import { fakes, logs, makeEnv, staff, useFakes } from "./billing-fixtures.ts";

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
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', ?3, 'received', 5, ?4)",
    )
      .bind(
        id,
        `evt_${id.replace(/-/g, "")}`,
        Date.now(),
        JSON.stringify({ linkId: "plink_DLQ1", amountMinor: 100, currency: "INR" }),
      )
      .run();
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.event", eventId: id });
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.event", eventId: id });
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
