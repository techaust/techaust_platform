// M6.2 early check 2 [ADM-PAY-02, -06, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file "Early check 2" and section H]: one advance try per invocation (retry, then
// blocked on the last try; the admin route's 409), the advance never lost (a duplicate carries `next`; the refresh and "Try again" queue it), unreadable events
// reviewed, `not_captured` review only, Resolve a guarded record, the link fixes (the hourly limit before any cancel, 429 as transient, one item per link and kind
// on a refresh, the short URL's host), and the section-H paths early check 2 found missing; the worst-path D1 statement counts. Razorpay is never called.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { REMINDER_CLAIM_SQL } from "@techaust/db/billing";
import { STUCK_ADVANCES_SQL } from "@techaust/db/gateway";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport, stubFetch, stubIdsOf } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor, refreshForClient } from "./gateway/links.ts";
import { razorpayApi } from "./gateway/razorpay.ts";
import {
  calls,
  countingEnv,
  eventRow,
  issued,
  linkFor,
  owner,
  paymentOf,
  recordingQueue,
  reviewKindsOf,
  staffLink,
  stub,
} from "./test-gateway.ts";
import { call, one, rows, withEnv } from "./test-helpers.ts";
import { putSwiftBank, putTax } from "./test-invoice-types.ts";
import { issueInvoice, json, mkInvoice, putBank, putCompany } from "./test-invoices.ts";
import { recordBody, recorded, verify } from "./test-payments.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(() => setStubTransport(null));

const nowSec = () => Math.floor(Date.now() / 1000);
/** Razorpay's payment as the stub answers it, with fields replaced. */
const payment = (id: string, amount: number, over: Record<string, unknown> = {}) =>
  Response.json({
    id,
    amount,
    currency: "INR",
    status: "captured",
    method: "upi",
    fee: 0,
    tax: 0,
    created_at: nowSec(),
    ...over,
  });
/** Razorpay's link as the stub answers it, with fields replaced. */
const linkJson = (
  l: { linkId: string; paymentId: string; checkoutId: string },
  amount: number,
  over: Record<string, unknown> = {},
) =>
  Response.json({
    id: l.linkId,
    status: "paid",
    currency: "INR",
    amount,
    amount_paid: amount,
    reference_id: l.checkoutId,
    short_url: "https://rzp.io/i/abc",
    expire_by: nowSec() + 7 * 86_400,
    payments: [{ payment_id: l.paymentId, amount, status: "captured" }],
    ...over,
  });

const eventOf = (id: string) =>
  one<{ status: string; outcome: string | null }>(
    "SELECT status, outcome FROM webhook_events WHERE id = ?1",
    id,
  );
const checkoutStatus = async (id: string) =>
  (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", id))?.status;
const reviewItemOf = (eventId: string) =>
  one<{ id: string; kind: string; status: string }>(
    "SELECT id, kind, status FROM review_items WHERE webhook_event_id = ?1",
    eventId,
  );
const freezeBatch = (sqls: string[]) => sqls.some((q) => q.includes("INSERT INTO advance_receipts"));
const confirmBatch = (sqls: string[]) => sqls.some((q) => q.includes("INSERT INTO payment_allocations"));
const bumpProforma = (id: string) => async () => {
  await env.DB.prepare("UPDATE documents SET updated_at = updated_at + 1 WHERE id = ?1").bind(id).run();
};

/** A proforma paid online through the webhook: its pending payment's row id, waiting for the automatic tax invoice. */
async function paidProforma() {
  const o = await owner();
  const pf = await issued(o, "proforma");
  const l = await linkFor(o, pf);
  const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
  expect(r.next?.kind).toBe("gateway.advance");
  return { o, pf, l, paymentId: r.next?.paymentId as string };
}

describe("finding 1: one advance try per invocation [ADM-INV-10, L6]", () => {
  it("a proforma changed between the read and the freeze: retry with nothing written; on the last try, blocked (freeze_refused) with the payment pending", async () => {
    const { pf, l, paymentId } = await paidProforma();
    const a = countingEnv({ race: { when: freezeBatch, act: bumpProforma(pf.id) } });
    expect(await issueGatewayAdvance(a.env, paymentId)).toEqual({ result: "retry" });
    expect(await rows("SELECT id FROM documents WHERE parent_id = ?1", pf.id)).toHaveLength(0);
    expect(await reviewKindsOf("payment_id", paymentId)).toEqual([]);
    const b = countingEnv({ race: { when: freezeBatch, act: bumpProforma(pf.id) } });
    expect(await issueGatewayAdvance(b.env, paymentId, { lastTry: true })).toEqual({
      result: "blocked",
      blockers: ["freeze_refused"],
    });
    console.log(
      `D1 statements, issueGatewayAdvance refused freeze then blocked (worst path): ${b.counter.n}`,
    );
    expect(b.counter.n).toBeLessThanOrEqual(45);
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    expect(await reviewKindsOf("payment_id", paymentId)).toEqual(["advance_blocked"]);
  });

  it('the admin "Try again" on an advance item makes one try: a proforma changed meanwhile is 409 advance_changed; then it issues, within 45 statements, without a second resolve', async () => {
    const { o, pf, paymentId } = await paidProforma();
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1").bind(o.id).run();
    expect((await issueGatewayAdvance(env, paymentId)).result).toBe("blocked");
    await env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1").bind(o.id).run();
    const item = await one<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'advance_blocked'",
      paymentId,
    );
    const raced = countingEnv({ race: { when: freezeBatch, act: bumpProforma(pf.id) } });
    const refused = await call(
      `/payments/review/${item?.id}/retry`,
      { cookie: o.cookie, body: {} },
      raced.env,
    );
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.code).toBe("advance_changed");
    console.log(
      `D1 statements, the admin retry route on an advance, refused freeze (worst path): ${raced.counter.n}`,
    );
    expect(raced.counter.n).toBeLessThanOrEqual(45);
    const counted = countingEnv();
    const ok = await call(`/payments/review/${item?.id}/retry`, { cookie: o.cookie, body: {} }, counted.env);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await json(ok)).result).toBe("issued");
    console.log(`D1 statements, the admin retry route on an advance, issued: ${counted.counter.n}`);
    expect(counted.counter.n).toBeLessThanOrEqual(45);
    // the advance batch resolved the item (as the Owner it acted for); the route wrote no second resolve or audit row of its own
    expect(
      await one("SELECT status, resolution, resolved_by FROM review_items WHERE id = ?1", item?.id),
    ).toEqual({ status: "resolved", resolution: "advance_issued", resolved_by: o.id });
    expect(
      await rows(
        "SELECT id FROM audit_log WHERE action = 'payment.review_retry' AND entity_id = ?1",
        item?.id,
      ),
    ).toHaveLength(0);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'invoice.advance_issue_auto' AND json_extract(summary, '$.paymentId') = ?1",
      paymentId,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      reviewItemsResolvedBy: "onBehalfOf",
      onBehalfOf: o.id,
    });
  });

  it("processEvent's race fallback (the link cancelled between the read and the confirm batch) records the money pending, within 45 statements", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    const ev = await eventRow(l.linkId, l.paymentId);
    const c = countingEnv({
      race: {
        when: confirmBatch,
        act: async () => {
          await env.DB.prepare(
            "UPDATE checkout_sessions SET status = 'cancelled', updated_at = updated_at + 1 WHERE id = ?1",
          )
            .bind(l.checkoutId)
            .run();
        },
      },
    });
    expect(await processEvent(c.env, ev)).toEqual({ result: "needs_review" });
    console.log(`D1 statements, processEvent race fallback (worst path): ${c.counter.n}`);
    expect(c.counter.n).toBeLessThanOrEqual(45);
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    expect((await reviewItemOf(ev))?.kind).toBe("document_not_payable");
  });
});

describe("finding 2: the automatic tax invoice is never lost [ADM-INV-10; 08-C RA-17]", () => {
  it("the portal's refresh records a proforma's payment and queues the advance; the later webhook is a duplicate that carries `next`; the invoice issues", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    const q = recordingQueue();
    const e = withEnv(env, { LEADS_QUEUE: q.queue });
    expect(await refreshForClient(e, { clientId: pf.clientId, documentId: pf.id })).toEqual({
      result: "processed",
    });
    const p = await paymentOf(l.paymentId);
    expect(p?.status).toBe("pending_verification");
    expect(q.sent).toEqual([{ kind: "gateway.advance", paymentId: p?.id }]);
    // the webhook arrives afterwards: a duplicate, still with `next` (the payment waits for its tax invoice)
    const ev = await eventRow(l.linkId, l.paymentId);
    const r = await processEvent(env, ev);
    expect(r).toEqual({ result: "duplicate", next: { kind: "gateway.advance", paymentId: p?.id } });
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "duplicate" });
    expect((await issueGatewayAdvance(env, p?.id as string)).result).toBe("issued");
    // issued: a further duplicate carries no `next`
    expect(await processEvent(env, await eventRow(l.linkId, l.paymentId))).toEqual({ result: "duplicate" });
  });

  it("a redelivered event whose first `next` was lost answers duplicate with `next`; once the Owner was told (advance_blocked open) it doesn't", async () => {
    const { o, paymentId, l } = await paidProforma();
    const ev = (
      await one<{ id: string }>(
        "SELECT id FROM webhook_events WHERE json_extract(facts, '$.paymentId') = ?1",
        l.paymentId,
      )
    )?.id as string;
    expect(await processEvent(env, ev)).toEqual({
      result: "duplicate",
      next: { kind: "gateway.advance", paymentId },
    });
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1").bind(o.id).run();
    expect((await issueGatewayAdvance(env, paymentId)).result).toBe("blocked");
    await env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1").bind(o.id).run();
    expect(await processEvent(env, ev)).toEqual({ result: "duplicate" });
    expect(await processEvent(env, await eventRow(l.linkId, l.paymentId))).toEqual({ result: "duplicate" });
  });

  it("review finding 3: once the Owner dismisses a blocked advance, the sweep, a duplicate event and a refresh never try it again (no new item, no new bell)", async () => {
    const { o, paymentId, l } = await paidProforma();
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1").bind(o.id).run();
    expect((await issueGatewayAdvance(env, paymentId)).result).toBe("blocked");
    await env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1").bind(o.id).run();
    const item = await one<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'advance_blocked'",
      paymentId,
    );
    // Review finding 4: the owners' bell says why in words, never the code.
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE kind = 'payment.review' AND entity_id = ?1 LIMIT 1",
      item?.id,
    );
    expect(bell?.title).toContain("the owner who issued the proforma is no longer an active owner");
    expect(bell?.title).not.toContain("issuer_not_owner");
    const dismissed = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "dismissed", note: "Will issue by hand" },
    });
    expect(dismissed.status, await dismissed.clone().text()).toBe(200);
    const bells = async () =>
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM notifications WHERE kind = 'payment.review' AND entity_type = 'review_item'",
        )
      )?.n;
    const before = await bells();
    // The hourly sweep's read, twice (an hour later, then two), finds nothing to queue.
    for (const later of [3_600_000, 7_200_000])
      expect(
        (
          await env.DB.prepare(STUCK_ADVANCES_SQL)
            .bind(Date.now() + later)
            .all<{ id: string }>()
        ).results.map((r) => r.id),
      ).not.toContain(paymentId);
    // A redelivered event answers duplicate with no `next`.
    expect(await processEvent(env, await eventRow(l.linkId, l.paymentId))).toEqual({ result: "duplicate" });
    expect(await reviewKindsOf("payment_id", paymentId)).toEqual(["advance_blocked"]);
    expect(await bells()).toBe(before);
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
  });

  it('"Try again" on a refetch_failed item of a proforma\'s link records the payment and queues the advance; the item stays open until the payment is confirmed', async () => {
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    stub((path) => (path.startsWith("/v1/payment_links/") ? new Response("{}", { status: 404 }) : null));
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    const item = await reviewItemOf(ev);
    expect(item?.kind).toBe("refetch_failed");
    stub();
    const q = recordingQueue();
    const res = await call(
      `/payments/review/${item?.id}/retry`,
      { cookie: o.cookie, body: {} },
      withEnv(env, { LEADS_QUEUE: q.queue }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const p = await paymentOf(l.paymentId);
    expect(q.sent).toEqual([{ kind: "gateway.advance", paymentId: p?.id }]);
    expect(
      (await one<{ status: string }>("SELECT status FROM review_items WHERE id = ?1", item?.id))?.status,
    ).toBe("open");
    // once the tax invoice is issued the payment is confirmed, and "Resolve: confirmed" is allowed for the item (by its link)
    expect((await issueGatewayAdvance(env, p?.id as string)).result).toBe("issued");
    const resolve = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "confirmed", note: null },
    });
    expect(resolve.status, await resolve.clone().text()).toBe(200);
  });
});

describe("findings 3 and 4: nothing verified is dropped; a failed or refunded payment records nothing", () => {
  it("an event kept from a lenient read with no link id: an unreadable_event review item, the event needs_review", async () => {
    const ev = await eventRow("", null, "payment_link.paid", { event: "payment_link.paid" });
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await eventOf(ev)).toEqual({ status: "needs_review", outcome: "unreadable_event" });
    expect((await reviewItemOf(ev))?.kind).toBe("unreadable_event");
  });

  it("not_captured (failed or refunded): the review item only, no payment row the Owner could confirm", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    for (const status of ["failed", "refunded"]) {
      stub((path) => (path.startsWith("/v1/payments/") ? payment(l.paymentId, inv.total, { status }) : null));
      const ev = await eventRow(l.linkId, l.paymentId);
      expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
      expect((await reviewItemOf(ev))?.kind).toBe("not_captured");
      expect(await paymentOf(l.paymentId)).toBeNull();
    }
  });
});

describe("finding 5: Resolve is a record of the money, never a move of it", () => {
  it("an amount_mismatch item: confirmed and left_as_credit refused (409 resolution_not_allowed); dismissed allowed; confirmed allowed once the payment is", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub((path) => (path.startsWith("/v1/payments/") ? payment(l.paymentId, inv.total - 100) : null));
    const ev = await eventRow(l.linkId, l.paymentId);
    await processEvent(env, ev);
    const item = await reviewItemOf(ev);
    for (const resolution of ["confirmed", "left_as_credit", "advance_issued"]) {
      const res = await call(`/payments/review/${item?.id}/resolve`, {
        cookie: o.cookie,
        body: { resolution, note: null },
      });
      expect(res.status, resolution).toBe(409);
      expect((await json(res)).error.code).toBe("resolution_not_allowed");
    }
    // the Owner confirms the money through the payment itself (it resolves its own items), so the record follows the money
    const p = await paymentOf(l.paymentId);
    const v = await verify(o, p?.id as string, "confirm", {
      allocations: [{ documentId: inv.id, amountMinor: inv.total - 100 }],
    });
    expect([200, 409]).toContain(v.status);
    const second = await reviewItemOf(await eventRow(l.linkId, l.paymentId));
    expect(second).toBeNull();
    const other = await issued(o);
    const lo = await linkFor(o, other);
    stub((path) => (path.startsWith("/v1/payments/") ? payment(lo.paymentId, other.total - 100) : null));
    const ev2 = await eventRow(lo.linkId, lo.paymentId);
    await processEvent(env, ev2);
    const item2 = await reviewItemOf(ev2);
    const dismissed = await call(`/payments/review/${item2?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "dismissed", note: "Checked" },
    });
    expect(dismissed.status).toBe(200);
  });

  it("left_as_credit only on an overpaid item: an invoice overpaid online keeps the excess as credit with an overpaid item (ADM-PAY-06; 08-C RA-36)", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    // ₹500 arrives by bank and is confirmed meanwhile: the link's full ₹1,180 is now ₹500 more than is due
    const rec = await recorded(
      o,
      recordBody(inv.clientId, 50_000, [{ documentId: inv.id, amountMinor: 50_000 }]),
    );
    if (
      (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", rec.id))?.status !==
      "confirmed"
    )
      expect((await verify(o, rec.id, "confirm")).status).toBe(200);
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    const p = await paymentOf(l.paymentId);
    expect(p?.status).toBe("confirmed");
    expect(await one("SELECT status, balance_minor FROM documents WHERE id = ?1", inv.id)).toEqual({
      status: "paid",
      balance_minor: 0,
    });
    expect(
      await one<{ amount_minor: number }>(
        "SELECT sum(amount_minor) AS amount_minor FROM payment_allocations WHERE payment_id = ?1",
        p?.id,
      ),
    ).toEqual({ amount_minor: inv.total - 50_000 });
    const over = await one<{ id: string; amount_minor: number }>(
      "SELECT id, amount_minor FROM review_items WHERE payment_id = ?1 AND kind = 'overpaid'",
      p?.id,
    );
    expect(over?.amount_minor).toBe(50_000);
    const ok = await call(`/payments/review/${over?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "left_as_credit", note: null },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
  });
});

describe("findings 10 to 13: links", () => {
  it("the hourly limit is checked before the open link is cancelled (10)", async () => {
    const o = await owner();
    const inv = await issued(o);
    // Razorpay holds this link only 20 minutes more, so the same amount would replace it (cancel first, then a new link)
    stub((path, method, body) =>
      method === "POST" && path === "/v1/payment_links"
        ? Response.json({
            id: stubIdsOf((body as { reference_id: string }).reference_id, inv.total).linkId,
            status: "created",
            currency: "INR",
            amount: inv.total,
            amount_paid: 0,
            reference_id: (body as { reference_id: string }).reference_id,
            short_url: "https://rzp.io/i/soon",
            expire_by: nowSec() + 20 * 60,
            payments: null,
          })
        : null,
    );
    const first = await linkFor(o, inv);
    // nine more links for this client in the last hour (on another of its invoices, each failed before the next), so ten in all
    const other = await mkInvoice(o, { clientId: inv.clientId, contactId: inv.contactId });
    expect((await issueInvoice(o, other.id)).status).toBe(200);
    const now = Date.now();
    for (let i = 0; i < 9; i++) {
      const id = uuidv7();
      await env.DB.prepare(
        "INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', 100, 'creating', ?5, ?6, ?6)",
      )
        .bind(id, other.id, inv.clientId, o.id, now + 86_400_000, now - 1000)
        .run();
      await env.DB.prepare("UPDATE checkout_sessions SET status = 'failed' WHERE id = ?1").bind(id).run();
    }
    // the limit answers before anything is cancelled
    stub();
    const res = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(res.status, await res.clone().text()).toBe(429);
    expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(false);
    expect(await checkoutStatus(first.checkoutId)).toBe("live");
  });

  it("a 429 from Razorpay is transient (retry), never a review item (11)", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub(() => new Response("{}", { status: 429 }));
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "retry" });
    expect(await reviewItemOf(ev)).toBeNull();
    const api = razorpayApi({
      keyId: "rzp_test_K1",
      keySecret: "s",
      settingsMode: "test",
      liveFlag: "false",
      fetch: async () => new Response("{}", { status: 429 }),
    });
    expect(await api.fetchLink("plink_A1R0")).toEqual({ ok: false, code: "network", status: 429 });
  });

  it('"Try again" on an unknown link adds no second item or bell while one is open for that link and kind (12)', async () => {
    const o = await owner();
    const unknown = { linkId: "plink_TRYAGAIN0001", paymentId: "pay_TRYAGAIN0001", checkoutId: "nobody" };
    stub((path) => (path === `/v1/payment_links/${unknown.linkId}` ? linkJson(unknown, 100) : null));
    const ev = await eventRow(unknown.linkId, unknown.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    const item = await reviewItemOf(ev);
    const count = async () =>
      (
        await rows(
          "SELECT id FROM review_items WHERE kind = 'unknown_link' AND status = 'open' AND json_extract(facts, '$.linkId') = ?1",
          unknown.linkId,
        )
      ).length;
    expect(await count()).toBe(1);
    for (let i = 0; i < 2; i++) {
      const res = await call(`/payments/review/${item?.id}/retry`, { cookie: o.cookie, body: {} });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(await count()).toBe(1);
  });

  it("a short URL off Razorpay's hosts is never made live (13)", async () => {
    const o = await owner();
    const inv = await issued(o);
    stub((path, method, body) =>
      method === "POST" && path === "/v1/payment_links"
        ? Response.json({
            id: "plink_EVILHOST0001",
            status: "created",
            currency: "INR",
            amount: (body as { amount: number }).amount,
            amount_paid: 0,
            reference_id: (body as { reference_id: string }).reference_id,
            short_url: "https://rzp.io.example.test/i/x",
            expire_by: nowSec() + 7 * 86_400,
            payments: null,
          })
        : null,
    );
    const res = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(res.status).toBe(502);
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE document_id = ?1", inv.id))
        ?.status,
    ).toBe("failed");
  });
});

describe("finding 6: the section-H paths early check 2 found missing", () => {
  it("currency, reference and order mismatches: currency is the review item only; reference and order are pending with their item, the balance unchanged", async () => {
    const o = await owner();
    // currency
    const a = await issued(o);
    const la = await linkFor(o, a);
    stub((path) =>
      path.startsWith("/v1/payments/") ? payment(la.paymentId, a.total, { currency: "USD" }) : null,
    );
    const evA = await eventRow(la.linkId, la.paymentId);
    expect(await processEvent(env, evA)).toEqual({ result: "needs_review" });
    expect((await reviewItemOf(evA))?.kind).toBe("currency_mismatch");
    expect(await paymentOf(la.paymentId)).toBeNull();
    // reference: the link Razorpay holds names another reference
    const b = await issued(o);
    const lb = await linkFor(o, b);
    stub((path) =>
      path === `/v1/payment_links/${lb.linkId}`
        ? linkJson(lb, b.total, { reference_id: "someone-else" })
        : null,
    );
    const evB = await eventRow(lb.linkId, lb.paymentId);
    expect(await processEvent(env, evB)).toEqual({ result: "needs_review" });
    expect((await reviewItemOf(evB))?.kind).toBe("reference_mismatch");
    expect((await paymentOf(lb.paymentId))?.status).toBe("pending_verification");
    // order: the payment belongs to another order than the link's
    const c = await issued(o);
    const lc = await linkFor(o, c);
    stub((path) =>
      path === `/v1/payment_links/${lc.linkId}`
        ? linkJson(lc, c.total, { order_id: "order_LINK0001" })
        : path.startsWith("/v1/payments/")
          ? payment(lc.paymentId, c.total, { order_id: "order_OTHER0001" })
          : null,
    );
    const evC = await eventRow(lc.linkId, lc.paymentId);
    expect(await processEvent(env, evC)).toEqual({ result: "needs_review" });
    expect((await reviewItemOf(evC))?.kind).toBe("order_mismatch");
    for (const d of [b, c])
      expect(
        (await one<{ balance_minor: number }>("SELECT balance_minor FROM documents WHERE id = ?1", d.id))
          ?.balance_minor,
      ).toBe(d.total);
  });

  it("an erased client: client_gone only, no payment row", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1")
      .bind(inv.clientId, Date.now())
      .run();
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect((await reviewItemOf(ev))?.kind).toBe("client_gone");
    expect(await paymentOf(l.paymentId)).toBeNull();
  });

  it("a partially paid link: pending with a partial_payment item", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    const half = inv.total / 2;
    stub((path) =>
      path === `/v1/payment_links/${l.linkId}`
        ? linkJson(l, inv.total, {
            status: "partially_paid",
            amount_paid: half,
            payments: [{ payment_id: l.paymentId, amount: half, status: "captured" }],
          })
        : path.startsWith("/v1/payments/")
          ? payment(l.paymentId, half)
          : null,
    );
    const ev = await eventRow(l.linkId, l.paymentId, "payment_link.partially_paid");
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect((await reviewItemOf(ev))?.kind).toBe("partial_payment");
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
  });

  it("payment_link.cancelled: the checkout is cancelled and the event processed", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub((path) =>
      path === `/v1/payment_links/${l.linkId}`
        ? linkJson(l, inv.total, { status: "cancelled", amount_paid: 0, payments: null })
        : null,
    );
    const ev = await eventRow(l.linkId, null, "payment_link.cancelled");
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect(await checkoutStatus(l.checkoutId)).toBe("cancelled");
    expect(await eventOf(ev)).toEqual({ status: "processed", outcome: "cancelled" });
  });

  it("the invoice's reminders stop once it is paid online", async () => {
    const o = await owner();
    const inv = await issued(o);
    const sent = await call(`/invoices/${inv.id}/send`, {
      cookie: o.cookie,
      body: { contactIds: [inv.contactId] },
    });
    expect(sent.status, await sent.clone().text()).toBe(200);
    const reminders = await rows<{ id: string; due_at: number }>(
      "SELECT id, due_at FROM reminders WHERE document_id = ?1",
      inv.id,
    );
    const l = await linkFor(o, {
      ...inv,
      updatedAt:
        (await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?1", inv.id))
          ?.updated_at ?? 0,
    });
    expect(await processEvent(env, await eventRow(l.linkId, l.paymentId))).toEqual({ result: "processed" });
    for (const r of reminders) {
      const claimed = await env.DB.prepare(REMINDER_CLAIM_SQL)
        .bind(r.id, r.due_at + 1)
        .all();
      expect(claimed.results).toEqual([]);
    }
  });

  it('a stuck `creating` row is adopted by our reference; "reference already attempted" adopts the link Razorpay made', async () => {
    const o = await owner();
    const inv = await issued(o);
    const stuckId = uuidv7();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', ?5, 'creating', ?6, ?7, ?7)",
    )
      .bind(stuckId, inv.id, inv.clientId, o.id, inv.total, now + 7 * 86_400_000, now - 3 * 60_000)
      .run();
    const ids = stubIdsOf(stuckId, inv.total);
    stub((path, method) =>
      method === "GET" && path === "/v1/payment_links"
        ? Response.json({
            payment_links: [
              {
                id: ids.linkId,
                status: "created",
                currency: "INR",
                amount: inv.total,
                amount_paid: 0,
                reference_id: stuckId,
                short_url: "https://rzp.io/i/stuck",
                expire_by: nowSec() + 7 * 86_400,
                payments: null,
              },
            ],
          })
        : null,
    );
    const res = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({
      checkoutId: stuckId,
      reused: true,
      shortUrl: "https://rzp.io/i/stuck",
    });
    expect(await checkoutStatus(stuckId)).toBe("live");
    // "reference already attempted": Razorpay refuses the create, the link it made is found by our reference and adopted
    const other = await issued(o);
    let reference = "";
    stub((path, method, body) => {
      if (method === "POST" && path === "/v1/payment_links") {
        reference = (body as { reference_id: string }).reference_id;
        return Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 });
      }
      if (method === "GET" && path === "/v1/payment_links") {
        const made = stubIdsOf(reference, other.total);
        return Response.json({
          payment_links: [
            {
              id: made.linkId,
              status: "created",
              currency: "INR",
              amount: other.total,
              amount_paid: 0,
              reference_id: reference,
              short_url: "https://rzp.io/i/adopted",
              expire_by: nowSec() + 7 * 86_400,
              payments: null,
            },
          ],
        });
      }
      return null;
    });
    const adopted = await staffLink(o, other.id, other.total, other.updatedAt);
    expect(adopted.status, await adopted.clone().text()).toBe(201);
    expect((await json(adopted)).shortUrl).toBe("https://rzp.io/i/adopted");
  });

  it("two createLink calls at once: Razorpay makes one link", async () => {
    const o = await owner();
    const inv = await issued(o);
    stub();
    const args = {
      provider: "razorpay" as const,
      clientId: inv.clientId,
      contactId: inv.contactId,
      tokenHash: null,
      documentId: inv.id,
      amountMinor: inv.total,
      returnTo: "invoice" as const,
    };
    const both = await Promise.all([createLinkFor(env, args), createLinkFor(env, args)]);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/payment_links")).toHaveLength(1);
    expect(both.some((r) => r.ok && !r.reused)).toBe(true);
    for (const r of both) expect(r.ok || (!r.ok && r.error === "link_in_progress")).toBe(true);
    expect(
      await rows(
        "SELECT id FROM checkout_sessions WHERE document_id = ?1 AND status IN ('creating', 'live')",
        inv.id,
      ),
    ).toHaveLength(1);
  });

  it("the emailed link's token at the finance Worker: valid makes a link; revoked or expired is a 404", async () => {
    const o = await owner();
    const contactEmail = async (id: string) =>
      (await one<{ email: string }>("SELECT lower(email) AS email FROM contacts WHERE id = ?1", id))?.email;
    const tokenFor = async (
      doc: { id: string; clientId: string; contactId: string },
      over: { revoked?: boolean; expired?: boolean } = {},
    ) => {
      const token = `tok_${uuidv7().replaceAll("-", "")}`;
      await env.DB.prepare(
        "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, revoked_at) VALUES (?1, ?2, 'view_pay', ?3, ?4, ?5, ?6, ?7)",
      )
        .bind(
          token,
          doc.id,
          over.expired ? Date.now() - 1000 : Date.now() + 86_400_000,
          doc.contactId,
          doc.clientId,
          await contactEmail(doc.contactId),
          over.revoked ? Date.now() - 500 : null,
        )
        .run();
      return token;
    };
    const args = (doc: { id: string; clientId: string; total: number }, tokenHash: string) => ({
      provider: "razorpay" as const,
      clientId: doc.clientId,
      contactId: null,
      tokenHash,
      documentId: doc.id,
      amountMinor: doc.total,
      returnTo: "pay_return" as const,
    });
    const valid = await issued(o);
    const ok = await createLinkFor(env, args(valid, await tokenFor(valid)));
    expect(ok.ok).toBe(true);
    const row = await one<{ source: string; contact_id: string }>(
      "SELECT source, contact_id FROM checkout_sessions WHERE document_id = ?1 AND status = 'live'",
      valid.id,
    );
    expect(row).toEqual({ source: "link", contact_id: valid.contactId });
    for (const over of [{ revoked: true }, { expired: true }]) {
      const doc = await issued(o);
      expect(await createLinkFor(env, args(doc, await tokenFor(doc, over))), JSON.stringify(over)).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  it('"Confirm by issuing the tax invoice" with paymentId on a Razorpay payment the system couldn\'t issue for', async () => {
    const { o, pf, paymentId } = await paidProforma();
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1").bind(o.id).run();
    expect((await issueGatewayAdvance(env, paymentId)).result).toBe("blocked");
    await env.DB.prepare("UPDATE staff_users SET status = 'active' WHERE id = ?1").bind(o.id).run();
    const p = await one<{ received_on: string; amount_minor: number; reference_norm: string }>(
      "SELECT received_on, amount_minor, reference_norm FROM payments WHERE id = ?1",
      paymentId,
    );
    const doc = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?1", pf.id);
    const counted = countingEnv();
    const res = await call(
      `/invoices/${pf.id}/advance-invoice`,
      {
        cookie: o.cookie,
        body: {
          expectedProformaUpdatedAt: doc?.updated_at,
          amountMinor: p?.amount_minor,
          receivedOn: p?.received_on,
          // the screen prefills the stored form of Razorpay's payment id (early check 2, "For the designer")
          reference: p?.reference_norm,
          paymentId,
        },
      },
      counted.env,
    );
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    // T11 merge: the deed hook (+3) and the review resolve (+1) ride this batch; the whole request stays within 45.
    console.log(`D1 statements, "Confirm by issuing" with paymentId (Razorpay row): ${counted.counter.n}`);
    expect(counted.counter.n).toBeLessThanOrEqual(45);
    const after = await one<{ status: string; verified_by: string; advance_receipt_id: string | null }>(
      "SELECT status, verified_by, advance_receipt_id FROM payments WHERE id = ?1",
      paymentId,
    );
    expect(after?.status).toBe("confirmed");
    expect(after?.verified_by).toBe(o.id);
    expect(after?.advance_receipt_id).not.toBeNull();
    // the blocked item is settled in the same batch, by the Owner who issued
    expect(
      await one(
        "SELECT status, resolution, resolved_by FROM review_items WHERE payment_id = ?1 AND kind = 'advance_blocked'",
        paymentId,
      ),
    ).toEqual({ status: "resolved", resolution: "advance_issued", resolved_by: o.id });
    expect(
      await rows("SELECT id FROM documents WHERE parent_id = ?1 AND type = 'tax_invoice'", pf.id),
    ).toHaveLength(1);
  });

  it("GET /payments/gateways: the finance Worker's own key status, the last verified webhook, live never allowed", async () => {
    const o = await owner();
    await eventRow("plink_GATEWAYS0001", null, "payment_link.expired");
    const res = await call("/payments/gateways", { cookie: o.cookie });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.gateways.razorpay).toMatchObject({ mode: "test", keys: { configured: true, missing: [] } });
    expect(typeof b.gateways.razorpay.lastVerifiedWebhookAt).toBe("number");
    expect(b.liveAllowed).toBe(false);
    expect(b.gateways.stripe.lastVerifiedWebhookAt).toBeNull();
    const missing = await json(
      await call("/payments/gateways", { cookie: o.cookie }, withEnv(env, { RAZORPAY_KEY_SECRET: "" })),
    );
    expect(missing.gateways.razorpay.keys).toEqual({ configured: false, missing: ["RAZORPAY_KEY_SECRET"] });
    // no secret's value is ever in the answer
    expect(JSON.stringify(missing)).not.toContain("test-razorpay-key-secret");
  });
});

describe("the stub stays the simulator", () => {
  it("answers as Razorpay's documentation shows (a sanity check for the swapped stubs above)", async () => {
    const r = await stubFetch(
      "https://api.razorpay.com/v1/payments/pay_A100R0123456789abcdef0123456789abcdef",
    );
    expect(r.status).toBe(200);
  });
});
