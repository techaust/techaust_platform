// M6.4 PayPal in the jobs Worker [JOB-HOOK-01..03, ADM-PAY-01; run file D and I, L1, L13, L15, L20; early check 1 "B2 must carry" 4, 5, 12]: the webhook
// (`POST /paypal` only; 415, 413 streamed, 503 unconfigured or the simulator's literal id with no D1, missing headers or a refused certificate URL not
// counted, a certificate that can't be had 503 with no D1, a bad signature counted with one bell at 5 and the cap of 50, an event not ours answered 200 with NO
// D1 write, one row and one message per event of ours, a duplicate delivery queued once, a queue failure 500 with the row kept, the certificate cached (no second
// fetch), expired at its notAfter, refused for 10 minutes after a failure and fetched at most twice a minute, no body, header or id in the logs), the sweep's
// PayPal parts, and the dead letter's bell. The finance Worker is a typed fake; PayPal is never called (the certificate "fetch" is a stub).
import { exports, env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { PAYMENTS_WITHOUT_ADVICE_COUNT_SQL } from "@techaust/db/advices";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEAD_LETTER_BELL_PAYPAL, processGateway, processGatewayDeadLetter } from "../src/gateway.ts";
import {
  BELL_SIGNATURES_PAYPAL,
  CERT_FAILED_MAX,
  CERT_FETCHES_PER_MINUTE,
  CERT_NEGATIVE_MS,
  certKeyFor,
  payPalHook,
  resetPayPalCertCache,
  trustPayPalCertUrl,
} from "../src/hooks/paypal.ts";
import { HOOK_MAX_BYTES } from "../src/hooks/shared.ts";
import { adviceBellTitle, processEdfReminder } from "../src/reports.ts";
import { fakes, logs, makeEnv, staff, useFakes } from "./billing-fixtures.ts";
import { type TestSigner, testSigner } from "./paypal-cert.ts";

useFakes();
afterEach(() => resetPayPalCertCache());

const WEBHOOK = "TESTPAYPALWEBHOOK01";
const CERT_URL = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-ab66f33d";
let signer: TestSigner;
beforeAll(async () => {
  signer = await testSigner(CERT_URL);
});
const enc = new TextEncoder();
let seq = 0;

/** The certificate "fetch": the test PEM for our URL, counting each call. */
const certFetch = (pem = () => signer.pem) => {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    seen.push(u);
    return u === CERT_URL ? new Response(pem(), { status: 200 }) : new Response("no", { status: 404 });
  }) as typeof fetch;
  return { f, seen };
};

/** A PayPal capture event shaped like PayPal's own (a payer's name and email included, never kept); ours unless `customId` says otherwise. */
function captureEvent(
  o: { name?: string; customId?: string | null; resource?: Record<string, unknown> } = {},
) {
  const n = String(++seq).padStart(4, "0");
  const checkoutId = `01900000-0000-7000-8000-00000000${n}`;
  const eventId = `WH-${n}HOOK${Date.now()}`;
  const order = `5O19${n}TN364715T`;
  const capture = `2GG2${n}U471931P`;
  return {
    checkoutId,
    eventId,
    order,
    capture,
    body: JSON.stringify({
      id: eventId,
      event_version: "1.0",
      create_time: "2026-11-02T18:45:04Z",
      resource_type: "capture",
      event_type: o.name ?? "PAYMENT.CAPTURE.COMPLETED",
      summary: "Payment completed for $ 500.0 USD",
      resource: o.resource ?? {
        id: capture,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "500.00" },
        final_capture: true,
        custom_id: o.customId === undefined ? checkoutId : o.customId,
        create_time: "2026-11-02T18:45:00Z",
        supplementary_data: { related_ids: { order_id: order } },
        payer: { name: { given_name: "Jane" }, email_address: "jane@example.test" },
      },
    }),
  };
}

type HookEnv = { DB: D1Database; LEADS_QUEUE: Queue };
const envOf = (over: Record<string, unknown> = {}) =>
  makeEnv({ PAYPAL_WEBHOOK_ID: WEBHOOK, ...over }) as unknown as HookEnv;
const post = (
  body: string | ReadableStream,
  headers: Record<string, string>,
  o: { e?: HookEnv; f?: typeof fetch; now?: number } = {},
) =>
  payPalHook(
    new Request("https://jobs.example.test/paypal", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      ...(typeof body === "string" ? {} : { duplex: "half" }),
    } as RequestInit),
    o.e ?? envOf(),
    o.now ?? Date.now(),
    o.f ?? certFetch().f,
  );
const signed = async (
  body: string,
  o: { webhookId?: string; e?: HookEnv; f?: typeof fetch; now?: number; certUrl?: string } = {},
) =>
  post(body, await signer.headers(body, o.webhookId ?? WEBHOOK, o.certUrl ? { certUrl: o.certUrl } : {}), o);

const rowsOf = async (eventId: string) =>
  (
    await realEnv.DB.prepare(
      "SELECT id, status, event_type, facts FROM webhook_events WHERE provider = 'paypal' AND event_id = ?1",
    )
      .bind(eventId)
      .all<{ id: string; status: string; event_type: string; facts: string }>()
  ).results;
const failures = async () =>
  (
    await realEnv.DB.prepare("SELECT count FROM hook_failures WHERE key LIKE 'paypal:sig:%'").first<{
      count: number;
    }>()
  )?.count ?? 0;
const eventCount = async () =>
  (
    await realEnv.DB.prepare("SELECT count(*) AS n FROM webhook_events WHERE provider = 'paypal'").first<{
      n: number;
    }>()
  )?.n ?? 0;
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

describe("POST /paypal [JOB-HOOK-01..03, L1, L13]", () => {
  it("our event: 200, one row with whitelisted facts only, one gateway.event message; the payer never kept or logged", async () => {
    const e = captureEvent();
    const res = await signed(e.body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await rowsOf(e.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "received", event_type: "PAYMENT.CAPTURE.COMPLETED" });
    expect(JSON.parse(rows[0]?.facts ?? "{}")).toEqual({
      event: "PAYMENT.CAPTURE.COMPLETED",
      linkId: e.order,
      paymentId: e.capture,
      amountMinor: 50_000,
      currency: "USD",
      status: "COMPLETED",
      checkoutId: e.checkoutId,
    });
    expect(rows[0]?.facts).not.toMatch(/Jane|jane@example/);
    expect(fakes.leads.map((s) => s.body)).toEqual([{ kind: "gateway.event", eventId: rows[0]?.id }]);
    const all = logs.join("\n");
    expect(all).not.toContain(WEBHOOK);
    expect(all).not.toContain("jane@example");
    expect(all).not.toContain(e.eventId);
  });

  it("a duplicate delivery: no second row; queued again only while still received; a replay under a new event id is a second row (the payment stays one: finance)", async () => {
    const e = captureEvent();
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

  it("an event not ours (no UUIDv7 mark): 200 with NO D1 write and no message; a refund naming its capture is kept (re-check N3)", async () => {
    const before = await eventCount();
    for (const customId of [null, "order-123", "01900000-0000-4000-8000-000000000001"]) {
      const e = captureEvent({ customId });
      const res = await signed(e.body);
      expect(res.status).toBe(200);
      expect(await rowsOf(e.eventId)).toHaveLength(0);
    }
    expect(logs.join("\n")).toContain('"o":"not_ours"');
    expect(await eventCount()).toBe(before);
    expect(fakes.leads).toHaveLength(0);
    const refund = captureEvent({
      name: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "1JU08902781691411",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "500.00" },
        links: [
          {
            rel: "up",
            href: "https://api.sandbox.paypal.com/v2/payments/captures/2GG279541U471931P",
            method: "GET",
          },
        ],
      },
    });
    expect((await signed(refund.body)).status).toBe(200);
    expect(await rowsOf(refund.eventId)).toHaveLength(1);
  });

  it("an event of ours we don't act on: stored ignored, no message, logged `other` the first time and `duplicate` after [review part 1 finding 11]", async () => {
    const e = captureEvent({ name: "CHECKOUT.ORDER.COMPLETED" });
    logs.length = 0;
    expect((await signed(e.body)).status).toBe(200);
    expect(await rowsOf(e.eventId)).toMatchObject([{ status: "ignored" }]);
    expect(fakes.leads).toHaveLength(0);
    expect(logs.join("\n")).toContain('"o":"other"');
    expect(logs.join("\n")).not.toContain('"o":"duplicate"');
    logs.length = 0;
    expect((await signed(e.body)).status).toBe(200);
    expect(logs.join("\n")).toContain('"o":"duplicate"');
    expect(await rowsOf(e.eventId)).toHaveLength(1);
  });

  it("415 without JSON, 413 over 64 KiB (streamed), and nothing written", async () => {
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(415);
    const big = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`{"a":"${"x".repeat(HOOK_MAX_BYTES)}"}`));
        c.close();
      },
    });
    expect((await post(big, {})).status).toBe(413);
  });

  it("the webhook id unset, or the simulator's literal WEBHOOK_ID: 503 hook_unconfigured, nothing written; no headers: 400 signature_missing, not counted", async () => {
    const e = captureEvent();
    const headers = await signer.headers(e.body, WEBHOOK);
    expect(await code(await post(e.body, headers, { e: envOf({ PAYPAL_WEBHOOK_ID: "" }) }))).toBe(
      "hook_unconfigured",
    );
    const sim = await post(e.body, await signer.headers(e.body, "WEBHOOK_ID"), {
      e: envOf({ PAYPAL_WEBHOOK_ID: "WEBHOOK_ID" }),
    });
    expect(sim.status).toBe(503);
    const missing = await post(e.body, {});
    expect(missing.status).toBe(400);
    expect(await code(missing)).toBe("signature_missing");
    expect(await failures()).toBe(0);
    expect(await rowsOf(e.eventId)).toHaveLength(0);
  });

  it("a certificate URL off PayPal's API host, or the local simulator's outside local: 400 signature_missing, nothing fetched; counted when the other headers are all there [review part 1 finding 12]", async () => {
    const e = captureEvent();
    const cf = certFetch();
    for (const certUrl of [
      "https://api.paypal.com.evil.test/v1/notifications/certs/CERT-1",
      "http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      `${CERT_URL}?x=1`,
      "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    ]) {
      const r = await signed(e.body, { certUrl, f: cf.f });
      expect(r.status, certUrl).toBe(400);
      expect(await code(r)).toBe("signature_missing");
    }
    const local = "http://localhost:8787/__paypal-test-cert";
    expect(
      (await signed(e.body, { certUrl: local, f: cf.f, e: envOf({ ENVIRONMENT: "staging" }) })).status,
    ).toBe(400);
    expect(cf.seen).toEqual([]);
    // All five headers sent and well formed, only the certificate URL refused: counted like a bad signature.
    expect(await failures()).toBe(5);
    expect(logs.join("\n")).toContain('"code":"cert_url_refused"');
    // Without PAYPAL-AUTH-ALGO (it is optional), the same post is not counted.
    const headers = await signer.headers(e.body, WEBHOOK, {
      certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    });
    const { "paypal-auth-algo": _algo, ...four } = headers as Record<string, string>;
    expect(await code(await post(e.body, four, { f: cf.f }))).toBe("signature_missing");
    expect(await failures()).toBe(5);
    expect(await rowsOf(e.eventId)).toHaveLength(0);
    // The tests of this file share one database and one clock hour: the count starts again for the next ones.
    await realEnv.DB.prepare("DELETE FROM hook_failures WHERE key LIKE 'paypal:sig:%'").run();
    await realEnv.DB.prepare("DELETE FROM notifications WHERE kind = 'payment.hook_signature'").run();
  });

  it("a certificate that can't be had (404, not a certificate, expired): 503 cert_unavailable with no D1; PayPal retries", async () => {
    const e = captureEvent();
    const notFound = certFetch(() => "not a certificate");
    const r = await signed(e.body, { f: notFound.f });
    expect(r.status).toBe(503);
    expect(await code(r)).toBe("cert_unavailable");
    expect(await rowsOf(e.eventId)).toHaveLength(0);
    expect(await failures()).toBe(0);
    resetPayPalCertCache();
    const expired = await testSigner(CERT_URL, {
      from: Date.now() - 10 * 86_400_000,
      to: Date.now() - 86_400_000,
    });
    const r2 = await post(e.body, await expired.headers(e.body, WEBHOOK), {
      f: certFetch(() => expired.pem).f,
    });
    expect(r2.status).toBe(503);
  });

  it("a bad signature (a changed byte, another webhook id): 400 counted; the 5th rings the owners once; the count stops at 50", async () => {
    await staff("owner");
    const e = captureEvent();
    const good = await signer.headers(e.body, WEBHOOK);
    const changed = `${e.body.slice(0, -2)} }`;
    for (let i = 0; i < 3; i++) expect((await post(changed, good)).status).toBe(400);
    for (let i = 0; i < 3; i++)
      expect((await signed(e.body, { webhookId: "ANOTHERWEBHOOK01" })).status).toBe(400);
    expect(await failures()).toBe(6);
    expect(
      await realEnv.DB.prepare(
        "SELECT count(*) AS n, max(title) AS t FROM notifications WHERE kind = 'payment.hook_signature' AND entity_id LIKE 'paypal:%'",
      ).first<{ n: number; t: string }>(),
    ).toEqual({ n: 1, t: BELL_SIGNATURES_PAYPAL });
    await realEnv.DB.prepare("UPDATE hook_failures SET count = 50 WHERE key LIKE 'paypal:sig:%'").run();
    await post(changed, good);
    expect(await failures()).toBe(50);
    expect(await rowsOf(e.eventId)).toHaveLength(0);
  });

  it("a signed body that isn't an event: 400 invalid_event, not counted", async () => {
    const before = await failures();
    const bad = await signed('{"id":"WH-1"}');
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("invalid_event");
    expect(await failures()).toBe(before);
  });

  it("a queue failure: 500 with the row kept", async () => {
    const e = captureEvent();
    const res = await signed(e.body, {
      e: envOf({
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

  it("through the Worker: only POST /paypal; GET and /paypal/x are 404; an unsigned JSON post is 400 signature_missing (the staging probe)", async () => {
    expect((await exports.default.fetch("https://jobs.example.test/paypal")).status).toBe(404);
    expect(
      (await exports.default.fetch("https://jobs.example.test/paypal/x", { method: "POST" })).status,
    ).toBe(404);
    const res = await exports.default.fetch("https://jobs.example.test/paypal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("signature_missing");
  });
});

describe("the certificate fetch in the Workers runtime (staging, 2026-11-03)", () => {
  it("asks with a redirect mode workerd accepts, and a redirect answer is refused, never followed", async () => {
    resetPayPalCertCache();
    const inits: RequestInit[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init ?? {});
      // workerd's own Request refuses a redirect mode it doesn't implement ("error"), as its fetch does
      new Request(String(input), init);
      return new Response(null, { status: 302, headers: { location: "https://example.test/elsewhere" } });
    }) as typeof fetch;
    expect(await certKeyFor(CERT_URL, Date.now(), f)).toBeNull();
    expect(inits).toHaveLength(1);
    expect(inits[0]?.redirect).toBe("manual");
  });

  it('no Worker source asks fetch for redirect "error"', async () => {
    const src = import.meta.glob("../src/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(src).length).toBeGreaterThan(10);
    for (const [file, text] of Object.entries(src))
      expect(/redirect:\s*"error"/.test(text), file).toBe(false);
  });
});

describe("the certificate cache [B2 must carry 4]", () => {
  it("a second request makes no fetch; the key is dropped at the certificate's notAfter; a failed URL waits 10 minutes; at most 2 fetches a minute", async () => {
    const cf = certFetch();
    const e1 = captureEvent();
    const e2 = captureEvent();
    expect((await signed(e1.body, { f: cf.f })).status).toBe(200);
    expect((await signed(e2.body, { f: cf.f })).status).toBe(200);
    expect(cf.seen).toEqual([CERT_URL]);
    // A certificate that ends soon: cached only until its notAfter, then fetched again.
    resetPayPalCertCache();
    const now = Date.now();
    const short = await testSigner(CERT_URL, { from: now - 60_000, to: now + 60_000 });
    const sf = certFetch(() => short.pem);
    expect(await certKeyFor(CERT_URL, now, sf.f)).not.toBeNull();
    expect(await certKeyFor(CERT_URL, now + 30_000, sf.f)).not.toBeNull();
    expect(sf.seen).toHaveLength(1);
    expect(await certKeyFor(CERT_URL, now + 120_000, sf.f)).toBeNull();
    expect(sf.seen).toHaveLength(2);
    // That failure is remembered: no fetch for 10 minutes.
    expect(await certKeyFor(CERT_URL, now + 180_000, sf.f)).toBeNull();
    expect(sf.seen).toHaveLength(2);
    // At most 2 fetches a minute per isolate.
    resetPayPalCertCache();
    const bad = certFetch(() => "x");
    const t = now + CERT_NEGATIVE_MS * 2;
    for (const n of [1, 2, 3, 4]) await certKeyFor(`${CERT_URL.slice(0, -1)}${n}`, t, bad.f);
    expect(bad.seen).toHaveLength(2);
  });

  it("unsigned posts naming other certificate paths can't starve PayPal's own URL, and can't wipe the failed list [review part 1 finding 3]", async () => {
    const now = Date.now();
    const short = await testSigner(CERT_URL, { from: now - 60_000, to: now + 60_000 });
    const good = certFetch(() => short.pem);
    // PayPal's URL verified a signature once (the hook calls `trustPayPalCertUrl` then): it is trusted from then on.
    expect(await certKeyFor(CERT_URL, now, good.f)).not.toBeNull();
    trustPayPalCertUrl(CERT_URL);
    // Its certificate ran out; in the next minute, other paths spend the shared fetches...
    const t = now + 120_000;
    const other = (n: number) => `${CERT_URL.slice(0, -1)}x${n}`;
    for (const n of [1, 2, 3]) expect(await certKeyFor(other(n), t, good.f)).toBeNull();
    expect(good.seen.filter((u) => u !== CERT_URL)).toHaveLength(CERT_FETCHES_PER_MINUTE);
    // ...yet PayPal's own URL still has its kept fetch (one a minute).
    const renewed = await testSigner(CERT_URL);
    const back = certFetch(() => renewed.pem);
    expect(await certKeyFor(CERT_URL, t + 1, back.f)).not.toBeNull();
    expect(back.seen).toEqual([CERT_URL]);
    // The failed list forgets its oldest entry, never all of them: after 17 failures (two a minute, inside the 10 minutes), the first is forgotten and the
    // second is still refused with no fetch.
    resetPayPalCertCache();
    const bad = certFetch(() => "x");
    const t2 = t + CERT_NEGATIVE_MS * 2;
    const at = (k: number) => t2 + Math.floor(k / 2) * 60_000 + (k % 2);
    for (let k = 0; k <= CERT_FAILED_MAX; k++)
      expect(await certKeyFor(other(100 + k), at(k), bad.f)).toBeNull();
    expect(bad.seen).toHaveLength(CERT_FAILED_MAX + 1);
    const later = at(CERT_FAILED_MAX) + 1;
    expect(await certKeyFor(other(101), later, bad.f)).toBeNull();
    expect(bad.seen).toHaveLength(CERT_FAILED_MAX + 1);
    expect(await certKeyFor(other(100), later, bad.f)).toBeNull();
    expect(bad.seen).toHaveLength(CERT_FAILED_MAX + 2);
  });
});

describe("a certificate URL is trusted only after a signature verified under it [review part 2, finding 6]", () => {
  /** After the URL's cached key ran out: other paths spend the minute's shared fetches, then: does `url` still get its kept fetch? */
  const keptFetch = async (url: string, t: number) => {
    const spend = certFetch(() => "x");
    for (const n of [1, 2]) await certKeyFor(`${CERT_URL.slice(0, -1)}y${n}`, t, spend.f);
    const renewed = await testSigner(url);
    const back = certFetch(() => renewed.pem);
    return { key: await certKeyFor(url, t + 1, back.f), seen: back.seen };
  };

  it("a valid certificate with a bad signature: 400, the URL NOT trusted; a good signature under it: trusted (its kept fetch a minute)", async () => {
    const now = Date.now();
    const short = await testSigner(CERT_URL, { from: now - 60_000, to: now + 60_000 });
    const good = certFetch(() => short.pem);
    // Signed for ANOTHER webhook id: PayPal's real certificate, fetched and valid, but the signature fails.
    const body1 = captureEvent().body;
    const bad = await post(body1, await short.headers(body1, "ANOTHERWEBHOOK01"), { f: good.f, now });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("signature_invalid");
    expect(good.seen).toEqual([CERT_URL]);
    const t = now + 120_000;
    const untrusted = await keptFetch(CERT_URL, t);
    expect(untrusted.key).toBeNull();
    expect(untrusted.seen).toEqual([]);
    // The same certificate verifying a real signature: trusted from then on.
    resetPayPalCertCache();
    const good2 = certFetch(() => short.pem);
    const body2 = captureEvent().body;
    const ok = await post(body2, await short.headers(body2, WEBHOOK), { f: good2.f, now });
    expect(ok.status).toBe(200);
    const kept = await keptFetch(CERT_URL, t);
    expect(kept.key).not.toBeNull();
    expect(kept.seen).toEqual([CERT_URL]);
  });
});

describe("the sweep's PayPal parts and the dead letter [run file D; B2 must carry 12]", () => {
  it("queues a refresh for a stale claim and for a capture PayPal has held 30 minutes; expires an unclaimed order past its grace", async () => {
    const now = Date.now() + 400 * 86_400_000;
    const owner = await staff("owner");
    const client = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency, updated_at)
       VALUES (?1, ?2, 'Legal', 'Display', 'business', 'US', 'overseas', 'USD', 5000)`,
    )
      .bind(client, `C-PP${String(++seq).padStart(4, "0")}`)
      .run();
    const doc = async () => {
      const id = uuidv7();
      const n = ++seq;
      await realEnv.DB.prepare(
        `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
         VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'pp-h', '9999', ?3, ?4, 1000, '2026-10-28', '2026-11-04', 50000, 50000, 50000, 50000, ?5, 7000)`,
      )
        .bind(id, client, n, `PH/${n}`, "h".repeat(64))
        .run();
      return id;
    };
    const checkout = async (o: { expiresAt: number; claim?: number; held?: boolean }) => {
      const id = uuidv7();
      const d = await doc();
      await realEnv.DB.prepare(
        `INSERT INTO checkout_sessions (id, provider, document_id, client_id, source, created_by, currency, amount_minor, status, expires_at, created_at, updated_at)
         VALUES (?1, 'paypal', ?2, ?3, 'staff', ?5, 'USD', 50000, 'creating', ?4, 1, 1)`,
      )
        .bind(id, d, client, o.expiresAt, owner.id)
        .run();
      await realEnv.DB.prepare(
        "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3, updated_at = 2 WHERE id = ?1",
      )
        .bind(
          id,
          `ORD${String(seq).padStart(6, "0")}`,
          `https://www.sandbox.paypal.com/checkoutnow?token=ORD${String(seq).padStart(6, "0")}`,
        )
        .run();
      if (o.claim)
        await realEnv.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
          .bind(id, o.claim)
          .run();
      if (o.held)
        await realEnv.DB.prepare(
          "UPDATE checkout_sessions SET status = 'capture_pending', provider_capture_id = ?2, updated_at = 3 WHERE id = ?1",
        )
          .bind(id, `CAP${seq}`)
          .run();
      return id;
    };
    const unclaimed = await checkout({ expiresAt: now - 31 * 60_000 });
    const claimed = await checkout({ expiresAt: now - 31 * 60_000, claim: now - 10 * 60_000 });
    const held = await checkout({ expiresAt: now + 60 * 60_000, held: true });
    // the sweep runs until nothing more expires (earlier tests may have left rows; 20 a run)
    for (let i = 0; i < 5; i++)
      await processGateway(makeEnv(), { kind: "gateway.sweep", asOf: now } as never, 1, now);
    const status = async (id: string) =>
      (
        await realEnv.DB.prepare("SELECT status FROM checkout_sessions WHERE id = ?1")
          .bind(id)
          .first<{ status: string }>()
      )?.status;
    expect(await status(unclaimed)).toBe("expired");
    expect(await status(claimed)).toBe("live");
    const refreshed = fakes.leads
      .map((s) => s.body as { kind: string; checkoutId?: string })
      .filter((b) => b.kind === "gateway.refresh");
    expect(refreshed.map((b) => b.checkoutId)).toEqual(expect.arrayContaining([claimed, held]));
    expect(refreshed.map((b) => b.checkoutId)).not.toContain(unclaimed);
  });

  it("a dead-lettered PayPal event: failed, a dead_letter item and PayPal's own bell; a dead-lettered refresh leaves a claimed row claimed", async () => {
    await staff("owner");
    const id = uuidv7();
    await realEnv.DB.prepare(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'paypal', ?2, 'CHECKOUT.ORDER.APPROVED', 1, 'received', 0, '{}')",
    )
      .bind(id, `WH-DLQ${Date.now()}`)
      .run();
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.event", eventId: id } as never);
    const ev = await realEnv.DB.prepare("SELECT status FROM webhook_events WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(ev?.status).toBe("failed");
    const bell = await realEnv.DB.prepare(
      "SELECT n.title FROM notifications n JOIN review_items r ON r.id = n.entity_id WHERE r.webhook_event_id = ?1",
    )
      .bind(id)
      .first<{ title: string }>();
    expect(bell?.title).toBe(DEAD_LETTER_BELL_PAYPAL);
    // A refresh message that ran out of tries only logs: the claimed row is untouched (the sweep lists it again).
    const before = await realEnv.DB.prepare(
      "SELECT count(*) AS n FROM checkout_sessions WHERE capture_started_at IS NOT NULL AND status = 'failed'",
    ).first<{ n: number }>();
    await processGatewayDeadLetter(makeEnv(), { kind: "gateway.refresh", checkoutId: uuidv7() } as never);
    const after = await realEnv.DB.prepare(
      "SELECT count(*) AS n FROM checkout_sessions WHERE capture_started_at IS NOT NULL AND status = 'failed'",
    ).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });
});

describe("the monthly advice reminder rides edf.reminder [L12, S9; ADM-INV-17]", () => {
  it("one owners' bell for a month with confirmed PayPal payments on no advice; a repeat adds none; no bell for a month with none", async () => {
    const owner = await staff("owner");
    const client = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency, updated_at)
       VALUES (?1, ?2, 'Legal', 'Display', 'business', 'US', 'overseas', 'USD', 5000)`,
    )
      .bind(client, `C-PA${String(++seq).padStart(4, "0")}`)
      .run();
    const doc = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
       VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'pp-a', '9999', ?3, ?4, 1000, '2031-05-01', '2031-05-08', 50000, 50000, 50000, 50000, ?5, 7000)`,
    )
      .bind(doc, client, ++seq, `PA/${seq}`, "h".repeat(64))
      .run();
    const checkout = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, source, created_by, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'paypal', ?2, ?3, 'staff', ?4, 'USD', 50000, 'creating', 9, 1, 1)`,
    )
      .bind(checkout, doc, client, owner.id)
      .run();
    const cap = `ADV${seq}CAPTURE`;
    await realEnv.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm,
         recorded_by, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
       VALUES (?1, ?2, 'payment', 'paypal', 'confirmed', 'USD', 50000, 1500, '2031-05-10', 'wallet', ?3, NULL, 5, NULL, 5, ?4, ?5, NULL, 5)`,
    )
      .bind(`ppl_${cap}`, client, `PPL-${cap}`, cap, checkout)
      .run();
    const bells = () =>
      realEnv.DB.prepare(
        "SELECT user_id, title, link FROM notifications WHERE kind = 'payment.advice_missing' AND entity_id = ?1",
      )
        .bind("advice:2031-05")
        .all<{ user_id: string; title: string; link: string }>();
    await processEdfReminder(makeEnv(), { v: 1, kind: "edf.reminder", year: 2031, month: 5 });
    const first = (await bells()).results.filter((b) => b.user_id === owner.id);
    expect(first).toHaveLength(1);
    expect(first[0]?.title).toMatch(
      /^(?:1 PayPal payment from May 2031 has|\d+ PayPal payments from May 2031 have) no remittance advice yet\.$/,
    );
    // Early check 2 finding 8: one payment in the singular, as approved.
    expect(adviceBellTitle(1, "May 2031")).toBe(
      "1 PayPal payment from May 2031 has no remittance advice yet.",
    );
    expect(adviceBellTitle(3, "May 2031")).toBe(
      "3 PayPal payments from May 2031 have no remittance advice yet.",
    );
    expect(first[0]?.title).not.toMatch(/monthly/i);
    await processEdfReminder(makeEnv(), { v: 1, kind: "edf.reminder", year: 2031, month: 5 });
    expect((await bells()).results.filter((b) => b.user_id === owner.id)).toHaveLength(1);
    await processEdfReminder(makeEnv(), { v: 1, kind: "edf.reminder", year: 2031, month: 7 });
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM notifications WHERE entity_id = 'advice:2031-07'",
        ).first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    // Review part 1, finding 8: the advice bell failing never stops the EDF reminder (the FEMA duty); the failure is logged. A new month with an export invoice
    // and a PayPal payment on no advice, its EDF bell not rung yet.
    const doc9 = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
       VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'pp-a', '9999', ?3, ?4, 1000, '2031-09-02', '2031-09-09', 50000, 50000, 50000, 50000, ?5, 7000)`,
    )
      .bind(doc9, client, ++seq, `PA/${seq}`, "h".repeat(64))
      .run();
    const checkout9 = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, source, created_by, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'paypal', ?2, ?3, 'staff', ?4, 'USD', 50000, 'creating', 9, 1, 1)`,
    )
      .bind(checkout9, doc9, client, owner.id)
      .run();
    const cap9 = `ADV${seq}CAPTURE`;
    await realEnv.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm,
         recorded_by, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at)
       VALUES (?1, ?2, 'payment', 'paypal', 'confirmed', 'USD', 50000, 1500, '2031-09-10', 'wallet', ?3, NULL, 5, NULL, 5, ?4, ?5, NULL, 5)`,
    )
      .bind(`ppl_${cap9}`, client, `PPL-${cap9}`, cap9, checkout9)
      .run();
    const failing = makeEnv();
    const db = realEnv.DB;
    failing.DB = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql.includes("'payment.advice_missing'")) throw new Error("D1 down for this one");
            return target.prepare(sql);
          };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    logs.length = 0;
    const r = await processEdfReminder(failing, { v: 1, kind: "edf.reminder", year: 2031, month: 9 });
    expect(r).toMatchObject({ kind: "done" });
    expect(logs.join("\n")).toContain('"ev":"advice.bell_failed"');
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM notifications WHERE kind = 'edf.due' AND entity_id = 'edf:2031-09' AND user_id = ?1",
        )
          .bind(owner.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    // Review part 2, finding 5: the advice COUNT failing (it no longer rides the EDF batch) never stops the EDF reminder either; logged the same way.
    const doc10 = uuidv7();
    await realEnv.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
       VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'pp-a', '9999', ?3, ?4, 1000, '2031-10-02', '2031-10-09', 50000, 50000, 50000, 50000, ?5, 7000)`,
    )
      .bind(doc10, client, ++seq, `PA/${seq}`, "h".repeat(64))
      .run();
    const countFails = makeEnv();
    countFails.DB = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            if (sql === PAYMENTS_WITHOUT_ADVICE_COUNT_SQL) throw new Error("D1 down for this one");
            return target.prepare(sql);
          };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    logs.length = 0;
    expect(
      await processEdfReminder(countFails, { v: 1, kind: "edf.reminder", year: 2031, month: 10 }),
    ).toMatchObject({
      kind: "done",
    });
    expect(logs.join("\n")).toContain('"ev":"advice.bell_failed"');
    expect(
      (
        await realEnv.DB.prepare(
          "SELECT count(*) AS n FROM notifications WHERE kind = 'edf.due' AND entity_id = 'edf:2031-10' AND user_id = ?1",
        )
          .bind(owner.id)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
});
