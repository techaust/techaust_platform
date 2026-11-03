// M6.5 early check 2, the fixes [ADM-PAY-08, -09, -10, -11; run file "Early check 2" findings 1 to 3, 6, 8, 9, 10; L33, L42, L43, L44]: money never goes out twice
// (a refused re-post is never a failure; re-post and cancel wait until the refund is idle; PayPal is posted again only within an hour; a refund we marked failed
// that the gateway made opens `refund_after_failed`), a refund still pending is acknowledged with one check counted and `refund_stuck` opens once, an open refund
// is adopted only by our own id, a refund recorded as made outside must be at the gateway, the receipt re-render is throttled, and the route-level paths the
// analyst listed (a pending source through the gateway, verify while refunding, the export tick, a chargeback, a dispute, PayPal's refund of ours, batch 2 lost).
// No test reaches a gateway: the stub transports answer, or a fake refund client. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import type { GatewayRefund } from "@techaust/core/refund-gateways";
import { refundRepostClaimStatement } from "@techaust/db/refunds";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import type { RefundGw } from "./gateway/refund-gw.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { fetchSettlements } from "./recon.ts";
import { applyGatewayRefund, checkRefund, readRefund, toCheckRefundResult } from "./refund-flow.ts";
import { calls, stub } from "./test-gateway.ts";
import { call, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { recordBody, recorded, verify } from "./test-payments.ts";
import { paidPayPal, payPalEventRow, paypalStub } from "./test-paypal.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";
import { liveSession, piOf, stripeEventRow, stripeStub } from "./test-stripe.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => {
  setStubTransport(null);
  vi.useRealTimers();
});

const MIN = 60_000;
const gateway = (amountMinor: number, o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  amountMinor,
  from: "credit",
  reasonCode: "overpayment",
  ...o,
});
const refundRow = (id: string) =>
  one<{
    status: string;
    failure_code: string | null;
    provider_refund_id: string | null;
    attempts: number;
    last_attempt_at: number | null;
    requested_at: number;
  }>(
    "SELECT status, failure_code, provider_refund_id, attempts, last_attempt_at, requested_at FROM payment_refunds WHERE id = ?",
    id,
  );
const itemsOf = (refundId: string, kind: string) =>
  rows<{ id: string; status: string }>(
    "SELECT id, status FROM review_items WHERE kind = ?1 AND json_extract(facts, '$.refundId') = ?2",
    kind,
    refundId,
  );
const bellsOf = async (reviewIds: string[]) =>
  (
    await rows<{ n: number }>(
      "SELECT count(*) AS n FROM notifications WHERE entity_type = 'review_item' AND entity_id IN (SELECT value FROM json_each(?1))",
      JSON.stringify(reviewIds),
    )
  )[0]?.n ?? 0;

let seq = 0;
/** A Razorpay payment of `amount` paise with nothing allocated (all credit), confirmed unless `pending`: the raw rows a settled online payment leaves. */
async function rzpPayment(
  clientId: string,
  ownerId: string,
  amount = 50_000,
  o: { pending?: boolean } = {},
): Promise<{ id: string; ref: string; checkoutId: string }> {
  const doc = await addDoc({ clientId, issueDate: "2026-10-05" });
  const staff = await sessionFor("staff");
  const T = Date.now() + ++seq;
  const ck = uuidv7();
  await env.DB.prepare(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', ?5, 'creating', ?6, ?7, ?7)`,
  )
    .bind(ck, doc.id, clientId, staff.id, amount, T + 86_400_000, T)
    .run();
  await env.DB.prepare(
    "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
  )
    .bind(ck, `plink_EC${T}`, T + 1)
    .run();
  const id = uuidv7();
  const ref = `pay_EC${T}`;
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', ?3, 0, 0, ?4, 'upi', ?5, ?6, ?5, ?7, ?6)`,
  )
    .bind(id, clientId, amount, todayIso(), ref, T, ck)
    .run();
  if (!o.pending)
    await env.DB.prepare(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
    )
      .bind(id, ownerId, T + 5)
      .run();
  return { id, ref, checkoutId: ck };
}
const rzpRefund = (
  id: string,
  amount: number,
  ours: string | null,
  paymentId: string,
  status = "processed",
) =>
  Response.json({
    id,
    entity: "refund",
    amount,
    currency: "INR",
    payment_id: paymentId,
    receipt: ours,
    status,
  });
const rzpList = (items: unknown[]) => Response.json({ entity: "collection", count: items.length, items });
const noAnswer = (path: string, method: string) =>
  method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null;

/** A refund through the gateway whose answer was lost (202, `requested`, no gateway id). */
async function lostRefund(amount = 10_000, paymentAmount = 50_000) {
  const o = await owner();
  const clientId = await mkReportClient("INR");
  const p = await rzpPayment(clientId, o.id, paymentAmount);
  stub(noAnswer);
  const body = gateway(amount);
  const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
  expect(res.status, await res.clone().text()).toBe(202);
  const row = await refundRow(body.id);
  return { o, clientId, p, id: body.id, requestedAt: row?.requested_at as number };
}

/** A refund client that answers what each test needs (the gateway's word), recording every create. */
function fakeGw(
  provider: RefundGw["provider"],
  o: {
    find: () => Awaited<ReturnType<RefundGw["find"]>>;
    create?: (a: { refundId: string; amountMinor: number }) => GatewayRefund;
  },
) {
  const creates: string[] = [];
  const gw: RefundGw = {
    provider,
    blocked: null,
    async find() {
      return o.find();
    },
    async create(a) {
      creates.push(a.refundId);
      return o.create ? { ok: true, value: o.create(a) } : { ok: false, code: "network" };
    },
  };
  return { gw, creates };
}
const gwRefund = (ourId: string, amountMinor: number, state: GatewayRefund["state"]): GatewayRefund => ({
  refundRef: `R${ourId.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
  paymentRef: null,
  amountMinor,
  currency: "INR",
  state,
  ourId,
  failureCode: null,
});

// ---- finding 1: money never out twice ----------------------------------------------------------------------------------------------------------------------

describe("finding 1a: a refused re-post is never a failure [L37]", () => {
  it("the gateway refuses the second post (its receipt is used): asked once more, ours is adopted; still none: one more check, the refund stays open", async () => {
    const a = await lostRefund(10_000);
    let posted = false;
    stub((path, method) => {
      if (method === "POST" && path.endsWith("/refund")) {
        posted = true;
        return Response.json(
          { error: { code: "BAD_REQUEST_ERROR", description: "receipt used" } },
          { status: 400 },
        );
      }
      if (path.endsWith("/refunds"))
        return rzpList(
          posted
            ? [
                JSON.parse(
                  JSON.stringify({
                    id: "rfnd_LATE00001",
                    entity: "refund",
                    amount: 10_000,
                    currency: "INR",
                    payment_id: a.p.ref,
                    receipt: a.id,
                    status: "processed",
                  }),
                ),
              ]
            : [],
        );
      return null;
    });
    expect(await checkRefund(env, a.id, a.requestedAt + 16 * MIN)).toEqual({
      result: "moved",
      status: "succeeded",
    });
    expect(await refundRow(a.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_LATE00001",
      failure_code: null,
    });
    // the second case: refused, and the gateway still lists none
    const b = await lostRefund(5_000);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund")
        ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
        : path.endsWith("/refunds")
          ? rzpList([])
          : null,
    );
    expect(await checkRefund(env, b.id, b.requestedAt + 16 * MIN)).toEqual({ result: "retry" });
    expect(await refundRow(b.id)).toMatchObject({ status: "requested", failure_code: null, attempts: 1 });
    expect(await itemsOf(b.id, "refund_failed")).toEqual([]);
  });
});

describe("finding 1b (L44): re-post and cancel wait until the refund is idle", () => {
  it("Try again and Cancel within 15 minutes of the request are 409 too_soon with retryAfterS and send nothing; after it, Cancel fails the refund once the gateway shows none", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: t0 });
    const a = await lostRefund(4_000);
    calls.length = 0;
    vi.setSystemTime(t0 + 5 * MIN);
    const o = await owner();
    for (const path of [`/refunds/${a.id}/retry`, `/refunds/${a.id}/cancel`]) {
      const res = await call(path, { cookie: o.cookie, body: {} });
      expect(res.status, path).toBe(409);
      const e = ((await json(res)) as J).error;
      expect(e.code).toBe("too_soon");
      expect(e.details.retryAfterS).toBeGreaterThan(590);
      expect(e.details.retryAfterS).toBeLessThanOrEqual(600);
    }
    expect(calls).toEqual([]);
    // the check itself never re-posts before the refund is idle either (the RPC answers unchanged)
    const early = await checkRefund(env, a.id, a.requestedAt + 5 * MIN);
    expect(early).toEqual({ result: "too_soon" });
    expect(toCheckRefundResult(early)).toEqual({ result: "unchanged" });
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    // 16 minutes after the request and the list's last look: the cancel asks the gateway, which lists none
    const row = await refundRow(a.id);
    vi.setSystemTime(Math.max(a.requestedAt, row?.last_attempt_at ?? 0) + 16 * MIN);
    stub((path) => (path.endsWith("/refunds") ? rzpList([]) : null));
    const later = await owner();
    const res = await call(`/refunds/${a.id}/cancel`, { cookie: later.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await refundRow(a.id)).toMatchObject({ status: "failed", failure_code: "cancelled" });
  });
});

describe("finding 1c (L43): a refund we marked failed that the gateway made", () => {
  it("an event showing it processed opens refund_after_failed with the owners' bell, once; the row stays failed and moves no money", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund")
        ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
        : null,
    );
    const body = gateway(7_000);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body })).status).toBe(502);
    expect((await refundRow(body.id))?.status).toBe("failed");
    stub((path) =>
      path === "/v1/refunds/rfnd_AFTER0001" ? rzpRefund("rfnd_AFTER0001", 7_000, body.id, p.ref) : null,
    );
    const ev = async () => {
      const id = uuidv7();
      await env.DB.prepare(
        "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, 'refund.processed', ?3, 'received', ?4)",
      )
        .bind(
          id,
          `evt_${id.slice(-12)}`,
          Date.now(),
          JSON.stringify({
            event: "refund.processed",
            object: "refund",
            refundId: "rfnd_AFTER0001",
            paymentId: p.ref,
            amountMinor: 7_000,
            currency: "INR",
            ourRefundId: body.id,
          }),
        )
        .run();
      return id;
    };
    const e1 = await ev();
    expect(await processEvent(env, e1)).toEqual({ result: "needs_review" });
    const items = await itemsOf(body.id, "refund_after_failed");
    expect(items).toHaveLength(1);
    expect(await bellsOf(items.map((i) => i.id))).toBeGreaterThan(0);
    expect(await one("SELECT status, outcome FROM webhook_events WHERE id = ?", e1)).toEqual({
      status: "needs_review",
      outcome: "refund_after_failed",
    });
    expect(await refundRow(body.id)).toMatchObject({ status: "failed", provider_refund_id: null });
    // the same news again: no second item, no second bell
    expect(await processEvent(env, await ev())).toEqual({ result: "processed" });
    expect(await itemsOf(body.id, "refund_after_failed")).toHaveLength(1);
    // the client's credit still holds the money (nothing moved): the Owner records it after checking the gateway
    const credit = ((await json(await call(`/clients/${clientId}/credit`, { cookie: o.cookie }))) as J)
      .credits as J[];
    expect(credit).toEqual(expect.arrayContaining([{ currency: "INR", creditMinor: 50_000 }]));
  });
});

describe("finding 1d (L42): PayPal is posted again only while its first request is under an hour old", () => {
  it("20 minutes: posted again with the same id; 61 minutes: refund_stuck once, nothing posted", async () => {
    const a = await lostRefund(3_000);
    const ok = fakeGw("paypal", {
      find: () => ({ ok: true, value: "unknown" }),
      create: (x) => gwRefund(x.refundId, x.amountMinor, "processed"),
    });
    expect(await checkRefund(env, a.id, a.requestedAt + 20 * MIN, { repost: true, gw: ok.gw })).toEqual({
      result: "moved",
      status: "succeeded",
    });
    expect(ok.creates).toEqual([a.id]);
    const b = await lostRefund(2_000);
    const late = fakeGw("paypal", {
      find: () => ({ ok: true, value: "unknown" }),
      create: (x) => gwRefund(x.refundId, x.amountMinor, "processed"),
    });
    for (const at of [61, 120])
      expect(await checkRefund(env, b.id, b.requestedAt + at * MIN, { repost: true, gw: late.gw })).toEqual({
        result: "stuck",
      });
    expect(late.creates).toEqual([]);
    expect(await refundRow(b.id)).toMatchObject({ status: "requested", attempts: 2 });
    const items = await itemsOf(b.id, "refund_stuck");
    expect(items).toHaveLength(1);
    expect(await bellsOf(items.map((i) => i.id))).toBeGreaterThan(0);
  });
});

// ---- review part 1, finding 1 (high): Cancel racing a re-post --------------------------------------------------------------------------------------------------

describe("review part 1, finding 1: Cancel and a re-post never both win (the refund is never paid out twice)", () => {
  /** A refund client whose `create` waits until the test lets it answer (the gateway's refund made), so a Cancel can run while the re-post is in flight. */
  function slowGw() {
    let entered!: () => void;
    let release!: (g: GatewayRefund) => void;
    const inFlight = new Promise<void>((r) => {
      entered = r;
    });
    const answer = new Promise<GatewayRefund>((r) => {
      release = r;
    });
    const creates: string[] = [];
    const gw: RefundGw = {
      provider: "razorpay",
      blocked: null,
      async find() {
        return { ok: true, value: null };
      },
      async create(a) {
        creates.push(a.refundId);
        entered();
        return { ok: true, value: await answer };
      },
    };
    return { gw, creates, inFlight, release };
  }

  it("(a)(d) the sweep's re-post claims the row before it posts: a Cancel while the gateway call is in flight is 409 too_soon, writes nothing, and the refund succeeds once", async () => {
    const a = await lostRefund(9_000);
    const at = a.requestedAt + 16 * MIN;
    vi.useFakeTimers({ toFake: ["Date"], now: at });
    const slow = slowGw();
    const sweep = checkRefund(env, a.id, at, { repost: true, gw: slow.gw });
    await slow.inFlight;
    // the claim is in the row before anything was sent
    expect(await refundRow(a.id)).toMatchObject({ status: "requested", attempts: 1, last_attempt_at: at });
    // Cancel now: the gateway lists none yet (the re-post is still on its way)
    stub((path) => (path.endsWith("/refunds") ? rzpList([]) : null));
    const o = await owner();
    const res = await call(`/refunds/${a.id}/cancel`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await json(res)) as J).error.code).toBe("too_soon");
    expect(await refundRow(a.id)).toMatchObject({ status: "requested", failure_code: null });
    // the gateway's refund lands: ours moves to succeeded; the client's credit is down by it exactly once
    slow.release(gwRefund(a.id, 9_000, "processed"));
    expect(await sweep).toEqual({ result: "moved", status: "succeeded" });
    expect(slow.creates).toEqual([a.id]);
    expect(await refundRow(a.id)).toMatchObject({ status: "succeeded", failure_code: null });
    const credit = ((await json(await call(`/clients/${a.clientId}/credit`, { cookie: o.cookie }))) as J)
      .credits as J[];
    expect(credit).toEqual(expect.arrayContaining([{ currency: "INR", creditMinor: 41_000 }]));
    expect(await itemsOf(a.id, "refund_after_failed")).toEqual([]);
  });

  it("(a) a second re-post that read the row before another claimed it posts nothing", async () => {
    const b = await lostRefund(2_500);
    const second = slowGw();
    const stale = await readRefund(env.DB, b.id);
    if (!stale) throw new Error("no refund");
    // the find of this check answers after another caller claimed the row
    const racing: RefundGw = {
      ...second.gw,
      async find() {
        await refundRepostClaimStatement(env.DB, {
          refundId: b.id,
          now: b.requestedAt + 17 * MIN,
          seen: stale.last_attempt_at,
        }).run();
        return { ok: true, value: null };
      },
    };
    expect(await checkRefund(env, b.id, b.requestedAt + 16 * MIN, { repost: true, gw: racing })).toEqual({
      result: "too_soon",
    });
    expect(second.creates).toEqual([]);
    expect(await refundRow(b.id)).toMatchObject({ status: "requested", attempts: 1 });
  });

  it("(b) a Cancel that read the row before a re-post claimed it writes nothing: 409 too_soon, and the re-post's refund is never undone", async () => {
    const a = await lostRefund(6_500);
    const at = a.requestedAt + 16 * MIN;
    vi.useFakeTimers({ toFake: ["Date"], now: at });
    // while the Cancel asks the gateway (it lists none), the sweep claims the row and posts
    setStubTransport(async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith("/refunds")) {
        await refundRepostClaimStatement(env.DB, { refundId: a.id, now: at + 1, seen: null }).run();
        return rzpList([]);
      }
      return new Response("", { status: 503 });
    });
    const o = await owner();
    const res = await call(`/refunds/${a.id}/cancel`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(409);
    const e = ((await json(res)) as J).error;
    expect(e.code).toBe("too_soon");
    expect(e.details.retryAfterS).toBeGreaterThan(890);
    expect(await refundRow(a.id)).toMatchObject({ status: "requested", failure_code: null, attempts: 1 });
    expect(
      await rows("SELECT id FROM audit_log WHERE action = 'refund.cancel' AND entity_id = ?1", a.id),
    ).toEqual([]);
  });

  it("(c) a gateway answer for a refund failed meanwhile (the move writes nothing) opens refund_after_failed with the owners' bell", async () => {
    const a = await lostRefund(4_200);
    const stale = await readRefund(env.DB, a.id);
    if (!stale) throw new Error("no refund");
    // a cancel landed after `stale` was read
    await env.DB.prepare(
      "UPDATE payment_refunds SET status = 'failed', failure_code = 'cancelled', updated_at = updated_at + 1 WHERE id = ?1",
    )
      .bind(a.id)
      .run();
    expect(await applyGatewayRefund(env, stale, gwRefund(a.id, 4_200, "processed"), Date.now())).toBe(
      "failed",
    );
    const items = await itemsOf(a.id, "refund_after_failed");
    expect(items).toHaveLength(1);
    expect(await bellsOf(items.map((i) => i.id))).toBeGreaterThan(0);
    expect(await refundRow(a.id)).toMatchObject({ status: "failed", provider_refund_id: null });
    // the gateway's failure of a refund already failed here opens nothing
    const b = await lostRefund(1_100);
    const staleB = await readRefund(env.DB, b.id);
    if (!staleB) throw new Error("no refund");
    await env.DB.prepare(
      "UPDATE payment_refunds SET status = 'failed', failure_code = 'cancelled', updated_at = updated_at + 1 WHERE id = ?1",
    )
      .bind(b.id)
      .run();
    expect(await applyGatewayRefund(env, staleB, gwRefund(b.id, 1_100, "failed"), Date.now())).toBe("failed");
    expect(await itemsOf(b.id, "refund_after_failed")).toEqual([]);
  });
});

// ---- finding 2: unchanged answers and stuck once -------------------------------------------------------------------------------------------------------------

describe("finding 2: a refund still pending, and a refund stuck", () => {
  it("a pending refund across three sweeps: unchanged (acknowledged), the idle clock restarts, no attempt counted (second review, M2), no item", async () => {
    const a = await lostRefund(6_000);
    const pending = fakeGw("stripe", { find: () => ({ ok: true, value: gwRefund(a.id, 6_000, "pending") }) });
    expect(await checkRefund(env, a.id, a.requestedAt + 16 * MIN, { repost: true, gw: pending.gw })).toEqual({
      result: "moved",
      status: "processing",
    });
    const before = (await refundRow(a.id))?.attempts as number;
    for (const h of [1, 2, 3]) {
      const now = a.requestedAt + h * 60 * MIN;
      const r = await checkRefund(env, a.id, now, { repost: true, gw: pending.gw });
      expect(r).toEqual({ result: "unchanged", status: "processing" });
      expect(toCheckRefundResult(r)).toEqual({ result: "unchanged" });
      expect(await refundRow(a.id)).toMatchObject({
        status: "processing",
        attempts: before,
        last_attempt_at: now,
      });
    }
    expect(pending.creates).toEqual([]);
    expect(await rows("SELECT id FROM review_items WHERE payment_id = ?1", a.p.id)).toEqual([]);
  });

  it("second review, M2: fifteen hourly answers that the refund is still on its way, then one network failure: retry, no refund_stuck", async () => {
    const a = await lostRefund(4_500);
    const pending = fakeGw("razorpay", {
      find: () => ({ ok: true, value: gwRefund(a.id, 4_500, "pending") }),
    });
    const down = fakeGw("razorpay", { find: () => ({ ok: false, code: "network" }) });
    expect(
      (await checkRefund(env, a.id, a.requestedAt + 16 * MIN, { repost: true, gw: pending.gw })).result,
    ).toBe("moved");
    for (let h = 1; h <= 15; h++)
      expect(
        (
          await checkRefund(env, a.id, a.requestedAt + h * 60 * MIN + 20 * MIN, {
            repost: true,
            gw: pending.gw,
          })
        ).result,
      ).toBe("unchanged");
    expect(
      await checkRefund(env, a.id, a.requestedAt + 17 * 60 * MIN, { repost: true, gw: down.gw }),
    ).toEqual({ result: "retry" });
    expect(await itemsOf(a.id, "refund_stuck")).toEqual([]);
    expect(await refundRow(a.id)).toMatchObject({ status: "processing" });
  });

  it("no answer twelve times: from the tenth, refund_stuck, ONE item and one bell per owner", async () => {
    const a = await lostRefund(1_500);
    const down = fakeGw("razorpay", { find: () => ({ ok: false, code: "network" }) });
    const results: string[] = [];
    for (let i = 1; i <= 12; i++)
      results.push(
        (await checkRefund(env, a.id, a.requestedAt + i * 60 * MIN, { repost: true, gw: down.gw })).result,
      );
    expect(results).toEqual([...Array(9).fill("retry"), "stuck", "stuck", "stuck"]);
    const items = await itemsOf(a.id, "refund_stuck");
    expect(items).toHaveLength(1);
    const owners = await rows<{ n: number }>(
      "SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'",
    );
    expect(await bellsOf(items.map((i) => i.id))).toBe(owners[0]?.n);
  });
});

// ---- finding 3: adopted only by our id ----------------------------------------------------------------------------------------------------------------------

describe("finding 3: the payment's one open refund of that amount is adopted only when the gateway's refund carries our id", () => {
  it("a dashboard refund of the same amount is refunded_outside, ours stays open; the same event carrying our receipt adopts it", async () => {
    const a = await lostRefund(8_000);
    stub((path) =>
      path === "/v1/refunds/rfnd_DASH00002"
        ? rzpRefund("rfnd_DASH00002", 8_000, null, a.p.ref)
        : path === "/v1/refunds/rfnd_OURS00002"
          ? rzpRefund("rfnd_OURS00002", 8_000, a.id, a.p.ref)
          : null,
    );
    const ev = async (refundId: string) => {
      const id = uuidv7();
      await env.DB.prepare(
        "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, 'refund.processed', ?3, 'received', ?4)",
      )
        .bind(
          id,
          `evt_${id.slice(-12)}`,
          Date.now(),
          JSON.stringify({
            event: "refund.processed",
            object: "refund",
            refundId,
            paymentId: a.p.ref,
            amountMinor: 8_000,
            currency: "INR",
          }),
        )
        .run();
      return id;
    };
    const dash = await ev("rfnd_DASH00002");
    expect(await processEvent(env, dash)).toEqual({ result: "needs_review" });
    expect(await one("SELECT kind FROM review_items WHERE webhook_event_id = ?", dash)).toEqual({
      kind: "refunded_outside",
    });
    expect(await refundRow(a.id)).toMatchObject({ status: "requested", provider_refund_id: null });
    expect(await processEvent(env, await ev("rfnd_OURS00002"))).toEqual({ result: "processed" });
    expect(await refundRow(a.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_OURS00002",
    });
  });
});

// ---- finding 6: an outside refund is checked at the gateway --------------------------------------------------------------------------------------------------

describe("finding 6: a refund recorded as made in the gateway must be there", () => {
  it("unknown id or another amount: 409 outside_not_at_gateway, nothing written; the gateway's own refund: recorded", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    const outside = (providerRefundId: string, amountMinor: number) =>
      gateway(amountMinor, { outside: { providerRefundId, origin: "outside", settledOn: todayIso() } });
    stub((path) =>
      path === "/v1/refunds/rfnd_OUT00001" ? rzpRefund("rfnd_OUT00001", 2_500, null, p.ref) : null,
    );
    for (const [ref, amount] of [
      ["rfnd_NONE0001", 2_500],
      ["rfnd_OUT00001", 2_400],
    ] as const) {
      const body = outside(ref, amount);
      const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
      expect(res.status, ref).toBe(409);
      expect(((await json(res)) as J).error.code).toBe("outside_not_at_gateway");
      expect(await refundRow(body.id)).toBeNull();
    }
    const good = outside("rfnd_OUT00001", 2_500);
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: good });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await refundRow(good.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_OUT00001",
    });
  });

  it("a lost dispute (chargeback) through the route is recorded as entered, from the invoice, with no gateway call; the invoice owes it again", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await rzpPayment(clientId, o.id, total);
    const doc = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", inv.id);
    const applied = await call(`/clients/${clientId}/credit/apply`, {
      cookie: o.cookie,
      body: { documentId: inv.id, amountMinor: total, expectedUpdatedAt: doc?.updated_at },
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    calls.length = 0;
    const body = {
      id: uuidv7(),
      amountMinor: 10_000,
      from: "document",
      documentId: inv.id,
      reasonCode: "chargeback",
      outside: { providerRefundId: "disp_TEST0001", origin: "chargeback", settledOn: todayIso() },
    };
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(calls).toEqual([]);
    expect(await refundRow(body.id)).toMatchObject({ status: "succeeded" });
    expect(await one("SELECT paid_minor, balance_minor FROM documents WHERE id = ?", inv.id)).toEqual({
      paid_minor: total - 10_000,
      balance_minor: 10_000,
    });
  });
});

// ---- finding 9: the route-level paths ----------------------------------------------------------------------------------------------------------------------

describe("finding 9: route-level paths", () => {
  it("L33: a pending gateway payment refunded in full through its gateway is rejected once the refund succeeds; while a refund of it is open, verify is 409 refund_in_progress", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id, 9_000, { pending: true });
    const body = gateway(9_000, { from: "pending", reasonCode: "duplicate" });
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await refundRow(body.id)).toMatchObject({ status: "succeeded" });
    expect(await one("SELECT status FROM payments WHERE id = ?", p.id)).toEqual({ status: "rejected" });
    // another pending payment whose refund is still open: the Owner's confirm is refused
    const q = await rzpPayment(clientId, o.id, 9_500, { pending: true });
    stub(noAnswer);
    expect(
      (
        await call(`/payments/${q.id}/refunds`, {
          cookie: o.cookie,
          body: gateway(9_500, { from: "pending", reasonCode: "duplicate" }),
        })
      ).status,
    ).toBe(202);
    const v = await verify(o, q.id, "confirm", { allocations: [] });
    expect(v.status).toBe(409);
    expect(((await json(v)) as J).error.code).toBe("refund_in_progress");
  });

  it("RB-43: credit of a client outside India goes back only once the Owner ticks that the bank was asked (409 export_refund_unconfirmed)", async () => {
    const o = await owner();
    const clientId = await mkReportClient("USD");
    const p = await recorded(o, recordBody(clientId, 20_000, [], { currency: "USD", mode: "swift" }));
    const manual = (confirmExport?: boolean) => ({
      id: uuidv7(),
      amountMinor: 5_000,
      from: "credit",
      reasonCode: "overpayment",
      manual: { mode: "swift", reference: `SWIFTEC${Date.now()}`, paidOn: todayIso(), paidTo: "original" },
      ...(confirmExport === undefined ? {} : { confirmExport }),
    });
    const refused = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: manual() });
    expect(refused.status).toBe(409);
    expect(((await json(refused)) as J).error.code).toBe("export_refund_unconfirmed");
    const ok = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: manual(true) });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it("L47: a refund made in the gateway or a lost dispute of a client outside India is recorded without the RB-43 tick; our own refund still needs it", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    await env.DB.prepare("UPDATE clients SET gst_status = 'overseas', state_code = NULL WHERE id = ?1")
      .bind(clientId)
      .run();
    stub((path) =>
      path === "/v1/refunds/rfnd_L47OUT001" ? rzpRefund("rfnd_L47OUT001", 2_500, null, p.ref) : null,
    );
    const ours = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: gateway(1_000) });
    expect(ours.status).toBe(409);
    expect(((await json(ours)) as J).error.code).toBe("export_refund_unconfirmed");
    const outside = gateway(2_500, {
      outside: { providerRefundId: "rfnd_L47OUT001", origin: "outside", settledOn: todayIso() },
    });
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: outside });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await refundRow(outside.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_L47OUT001",
    });
  });

  it("batch 2 lost after the gateway made the refund: the row stays requested, and the gateway's webhook moves it by our id", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    const body = gateway(3_300);
    // a D1 whose batch fails when it holds the refund's status move (batch 2, `refundMoveStatement`): the gateway already made the refund
    const sqlOf = new WeakMap<object, string>();
    const real = env.DB;
    const wrap = (st: D1PreparedStatement, sql: string): D1PreparedStatement => {
      const w = new Proxy(st, {
        get(ts, kk) {
          if (kk === "bind") return (...v: unknown[]) => wrap(ts.bind(...v), sql);
          const val = Reflect.get(ts, kk);
          return typeof val === "function" ? val.bind(ts) : val;
        },
      });
      sqlOf.set(w, sql);
      unwrap.set(w, st);
      return w;
    };
    const unwrap = new WeakMap<object, D1PreparedStatement>();
    const failing = new Proxy(real, {
      get(t, k) {
        if (k === "prepare") return (q: string) => wrap(t.prepare(q), q);
        if (k === "batch")
          return async (stmts: D1PreparedStatement[]) => {
            if (stmts.some((s) => (sqlOf.get(s) ?? "").includes("UPDATE payment_refunds SET status = ?2")))
              throw new Error("D1 unavailable");
            return t.batch(stmts.map((s) => unwrap.get(s) ?? s));
          };
        const val = Reflect.get(t, k);
        return typeof val === "function" ? val.bind(t) : val;
      },
    });
    const res = await call(
      `/payments/${p.id}/refunds`,
      { cookie: o.cookie, body },
      withEnv(env, { DB: failing }),
    );
    expect(res.status).toBe(500);
    expect(await refundRow(body.id)).toMatchObject({ status: "requested", provider_refund_id: null });
    const gwId = `rfnd_A3300R${body.id.replaceAll("-", "")}`;
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, 'refund.processed', ?3, 'received', ?4)",
    )
      .bind(
        id,
        `evt_${id.slice(-12)}`,
        Date.now(),
        JSON.stringify({
          event: "refund.processed",
          object: "refund",
          refundId: gwId,
          paymentId: p.ref,
          amountMinor: 3_300,
          currency: "INR",
          ourRefundId: body.id,
        }),
      )
      .run();
    stub();
    expect(await processEvent(env, id)).toEqual({ result: "processed" });
    expect(await refundRow(body.id)).toMatchObject({ status: "succeeded", provider_refund_id: gwId });
  });
});

describe("finding 9: Stripe disputes and PayPal's refund of ours", () => {
  it("a Stripe dispute on our payment is a dispute_opened item; one on a payment we never recorded is ignored", async () => {
    // a card payment recorded through M6.3's own path (the session completed, re-fetched from the stub)
    stripeStub();
    const s = await liveSession();
    expect(await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId))).toMatchObject({
      result: "processed",
    });
    const pi = piOf(s.sessionId);
    const T = Date.now();
    const dispute = async (paymentId: string) =>
      stripeEventRow("", "", "charge.dispute.created", {
        event: "charge.dispute.created",
        object: "dispute",
        paymentId,
        amountMinor: 5000,
        currency: "USD",
        status: "needs_response",
        livemode: 0,
      });
    const ours = await dispute(pi);
    expect(await processEvent(env, ours)).toEqual({ result: "needs_review" });
    expect(await one("SELECT kind FROM review_items WHERE webhook_event_id = ?", ours)).toEqual({
      kind: "dispute_opened",
    });
    const theirs = await dispute(`pi_NOTOURS${T}`);
    expect(await processEvent(env, theirs)).toEqual({ result: "ignored" });
  });

  it("PayPal's PAYMENT.CAPTURE.REFUNDED for one of OUR refunds moves it (by the custom id kept as checkoutId), never a refunded_outside item", async () => {
    const paymentId = await paidPayPal();
    const o = await owner();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null,
    );
    // the export invoice it paid gets an excess of USD 10 (as after its credit note), refunded through PayPal with the bank ticked (RB-43)
    const docId = (
      await one<{ document_id: string }>(
        "SELECT document_id FROM payment_allocations WHERE payment_id = ?1 AND kind = 'allocate'",
        paymentId,
      )
    )?.document_id as string;
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 1000, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(docId)
      .run();
    const body = gateway(1_000, { from: "document", documentId: docId, reasonCode: "credit_note" });
    const res = await call(`/payments/${paymentId}/refunds`, {
      cookie: o.cookie,
      body: { ...body, confirmExport: true },
    });
    expect(res.status, await res.clone().text()).toBe(202);
    const ppId = `R${body.id.replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    paypalStub((path) =>
      path === `/v2/payments/refunds/${ppId}`
        ? Response.json({
            id: ppId,
            status: "COMPLETED",
            amount: { value: "10.00", currency_code: "USD" },
            custom_id: body.id,
          })
        : null,
    );
    const capture = (
      await one<{ provider_payment_id: string }>(
        "SELECT provider_payment_id FROM payments WHERE id = ?",
        paymentId,
      )
    )?.provider_payment_id;
    const ev = await payPalEventRow("PAYMENT.CAPTURE.REFUNDED", {
      object: "refund",
      refundId: ppId,
      paymentId: capture,
      amountMinor: 1_000,
      currency: "USD",
      status: "COMPLETED",
      checkoutId: body.id,
    });
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect(await refundRow(body.id)).toMatchObject({ status: "succeeded", provider_refund_id: ppId });
    expect(await rows("SELECT kind FROM review_items WHERE webhook_event_id = ?1", ev)).toEqual([]);
  });
});

// ---- findings 8 and 10 --------------------------------------------------------------------------------------------------------------------------------------

describe("finding 8: one receipt re-render ask per 5 minutes", () => {
  it("the first ask is queued and audited; a second within 5 minutes is 429 too_soon with no audit row", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 2_000));
    const r = await issueReceipt(env, p.id as string);
    expect(r.result).toBe("issued");
    const rid = `rct_${p.id}`;
    const first = await call(`/receipts/${rid}/pdf/retry`, { cookie: o.cookie, body: {} });
    expect(first.status, await first.clone().text()).toBe(200);
    const again = await call(`/receipts/${rid}/pdf/retry`, { cookie: o.cookie, body: {} });
    expect(again.status).toBe(429);
    expect(((await json(again)) as J).error.code).toBe("too_soon");
    expect(
      await rows("SELECT id FROM audit_log WHERE action = 'receipt.pdf_retry' AND entity_id = ?1", rid),
    ).toHaveLength(1);
  });
});

describe("finding 10: Razorpay unset is not a failure to retry", () => {
  it("fetchSettlements answers unconfigured with no key (the jobs Worker acknowledges it)", async () => {
    const noKey = withEnv(env, { GATEWAY_TRANSPORT: "none" });
    expect(await fetchSettlements(noKey, { provider: "razorpay", day: "2026-11-02", skip: 0 })).toEqual({
      result: "unconfigured",
    });
  });
});

// ---- B2 Q3: the RA-40 and RA-41 facts in the refund API ------------------------------------------------------------------------------------------------------

describe("the refund API carries the tax facts the dialog shows (B2 Q3; RA-40, RA-41)", () => {
  it("RA-40: credit_note_needed names the credit note's last day; GET with ?documentId gives the same facts", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await recorded(o, recordBody(clientId, total, [{ documentId: inv.id, amountMinor: total }]));
    const res = await call(`/payments/${p.id}/refunds`, {
      cookie: o.cookie,
      body: {
        id: uuidv7(),
        amountMinor: 1_000,
        from: "document",
        documentId: inv.id,
        reasonCode: "credit_note",
        manual: { mode: "neft", reference: `UTRRA40${Date.now()}`, paidOn: todayIso(), paidTo: "original" },
      },
    });
    expect(res.status).toBe(409);
    const e = ((await json(res)) as J).error;
    expect(e.code).toBe("credit_note_needed");
    expect(e.details).toMatchObject({ creditNoteSupplyFy: "2627", creditNoteBasis: "cutoff" });
    expect(e.details.creditNoteLastDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.details.creditNoteOpen).toBe(todayIso() <= e.details.creditNoteLastDay);
    const got = (await json(
      await call(`/payments/${p.id}/refunds?documentId=${inv.id}`, { cookie: o.cookie }),
    )) as J;
    expect(got.facts.creditNote).toMatchObject({
      lastDay: e.details.creditNoteLastDay,
      open: e.details.creditNoteOpen,
      supplyFy: "2627",
      basis: e.details.creditNoteBasis,
      period: e.details.creditNotePeriod,
      returnBy: e.details.creditNoteReturnBy,
      deadlineWarnFrom: e.details.creditNoteWarnFrom,
    });
    // all of this payment is on the invoice: no credit, no RA-41 line
    expect(got.facts.ra41).toMatchObject({ advanceLine: null, showLine: false });
    // another client's invoice is no fact of this payment's
    const other = await addDoc({ clientId: await mkReportClient("INR"), issueDate: "2026-10-05" });
    const theirs = (await json(
      await call(`/payments/${p.id}/refunds?documentId=${other.id}`, { cookie: o.cookie }),
    )) as J;
    expect(theirs.facts.creditNote).toBeNull();
  });

  it("RA-41: credit from money received in an earlier GST period shows the line; the same period does not", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const early = await recorded(o, recordBody(clientId, 300_000, [], { receivedOn: "2026-04-10" }));
    const now = await recorded(o, recordBody(clientId, 300_000));
    const factsOf = async (id: string) =>
      ((await json(await call(`/payments/${id}/refunds`, { cookie: o.cookie }))) as J).facts.ra41 as J;
    expect(await factsOf(early.id as string)).toMatchObject({
      advanceLine: "credit_may_be_advance",
      creditCrossedPeriod: true,
      showLine: true,
      receivedOn: "2026-04-10",
    });
    expect(await factsOf(now.id as string)).toMatchObject({
      advanceLine: "credit_may_be_advance",
      creditCrossedPeriod: false,
      showLine: false,
    });
    // the refund's own answer carries them too
    const r = (await json(
      await call(`/payments/${early.id}/refunds`, {
        cookie: o.cookie,
        body: {
          id: uuidv7(),
          amountMinor: 1_000,
          from: "credit",
          reasonCode: "overpayment",
          manual: { mode: "neft", reference: `UTRRA41${Date.now()}`, paidOn: todayIso(), paidTo: "original" },
        },
      }),
    )) as J;
    expect(r.refund.status).toBe("succeeded");
    expect(r.facts.ra41).toMatchObject({ showLine: true, receivedPeriod: expect.any(String) });
  });
});
