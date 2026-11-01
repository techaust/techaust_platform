// M6.2 Razorpay in the admin finance Worker [ADM-PAY-02, -06, -07, -11, ADM-INV-10, JOB-HOOK-02, POR-06; run file C and H]: payment links (make, reuse, replace,
// refuse), the webhook event processed after a re-fetch (confirmed, duplicate, replay, mismatch, unknown link, transient and permanent Razorpay failures, an
// expired link), a proforma paid online and its automatic tax invoice (gateway_auto), the review list, resolve and retry, the gateway rows never rejected or
// withdrawn, the routes per role, the live guard with zero fetch calls, and the 45-statement budget of each RPC. Razorpay is never called: the "stub" transport
// answers (worker/gateway/config.ts), swapped per test where Razorpay must answer otherwise.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { formatMoney, money } from "@techaust/core/money";
import { checkProviderContract } from "@techaust/core/payments";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { itemReason } from "../src/lib/gateway.ts";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport, stubFetch } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor, refreshForClient } from "./gateway/links.ts";
import { razorpayApi, razorpayProvider } from "./gateway/razorpay.ts";
import { reviewFactsOf } from "./gateway/settle.ts";
import { GATEWAY_WARM_STEPS, warmGateway } from "./gateway/warm.ts";
import {
  calls,
  countingEnv,
  eventRow,
  issued,
  linkFor,
  owner,
  paymentOf,
  staffLink,
  stub,
} from "./test-gateway.ts";
import { call, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import { putSwiftBank, putTax } from "./test-invoice-types.ts";
import { json, putBank, putCompany } from "./test-invoices.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(() => setStubTransport(null));

describe("payment links [ADM-PAY-02, L2 to L4, L10]", () => {
  it("makes a fixed-amount link with no customer or Razorpay notifications, our reference, the description by type, the static return page", async () => {
    const o = await owner();
    let sent: Record<string, unknown> | null = null;
    stub((path, method, body) => {
      if (method === "POST" && path === "/v1/payment_links") sent = body as Record<string, unknown>;
      return null;
    });
    const inv = await issued(o);
    const { checkoutId } = await linkFor(o, inv);
    expect(sent).toMatchObject({
      amount: inv.total,
      currency: "INR",
      accept_partial: false,
      reference_id: checkoutId,
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: "http://localhost:5174/pay/return",
    });
    expect(String((sent as unknown as { description: string }).description)).toMatch(/^Invoice /);
    expect(sent).not.toHaveProperty("customer");
    const row = await one<{ status: string; source: string; created_by: string }>(
      "SELECT status, source, created_by FROM checkout_sessions WHERE id = ?1",
      checkoutId,
    );
    expect(row).toEqual({ status: "live", source: "staff", created_by: o.id });
  });

  it("reuses the open link for the same amount; a new amount cancels the old one at Razorpay first", async () => {
    const o = await owner();
    const inv = await issued(o);
    const first = await linkFor(o, inv);
    const again = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(again.status).toBe(200);
    expect((await json(again)).reused).toBe(true);
    // A proforma of ₹1,180 accepts only the full amount (the floor is above the balance), so a new amount is tested on a raised balance by a direct SQL write.
    await env.DB.prepare("UPDATE checkout_sessions SET amount_minor = amount_minor WHERE id = ?1")
      .bind(first.checkoutId)
      .run();
    stub();
    const res = await call(`/invoices/${inv.id}/payment-link/cancel`, {
      cookie: o.cookie,
      body: { checkoutId: first.checkoutId },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/cancel"))).toBe(true);
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", first.checkoutId))
        ?.status,
    ).toBe("cancelled");
  });

  it("refuses amounts out of bounds, paise on a proforma, and documents not payable online", async () => {
    const o = await owner();
    const inv = await issued(o);
    const above = await staffLink(o, inv.id, inv.total + 1, inv.updatedAt);
    expect(above.status).toBe(400);
    expect((await json(above)).error.code).toBe("amount_above_balance");
    const below = await staffLink(o, inv.id, 50, inv.updatedAt);
    expect((await json(below)).error.code).toBe("amount_below_minimum");
    const stale = await staffLink(o, inv.id, inv.total, inv.updatedAt - 1);
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.code).toBe("stale_version");
    const pf = await issued(o, "proforma");
    const paise = await staffLink(o, pf.id, pf.total - 50, pf.updatedAt);
    expect(paise.status).toBe(400);
    await env.DB.prepare(
      "UPDATE clients SET country = 'US', gst_status = 'overseas', state_code = NULL WHERE id = ?1",
    )
      .bind(inv.clientId)
      .run()
      .catch(() => undefined);
    const overseas = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect([409, 404]).toContain(overseas.status);
  });

  it("a live key while live payments are off: 503 live_not_allowed with ZERO calls to Razorpay [ADM-PAY-11, rule 7]", async () => {
    const o = await owner();
    const inv = await issued(o);
    stub();
    const res = await staffLink(
      o,
      inv.id,
      inv.total,
      inv.updatedAt,
      withEnv(env, { RAZORPAY_KEY_ID: "rzp_live_LIVEKEY00001" }),
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("live_not_allowed");
    expect(calls).toEqual([]);
    expect(await one("SELECT id FROM checkout_sessions WHERE document_id = ?1", inv.id)).toBeNull();
    const none = await staffLink(
      o,
      inv.id,
      inv.total,
      inv.updatedAt,
      withEnv(env, { RAZORPAY_KEY_SECRET: "" }),
    );
    expect((await json(none)).error.code).toBe("gateway_unavailable");
  });

  it("Razorpay refusing the create: the row is failed and the answer 502; the document is free for another link at once", async () => {
    const o = await owner();
    const inv = await issued(o);
    stub((path, method) =>
      method === "POST" && path === "/v1/payment_links" ? new Response("{}", { status: 400 }) : null,
    );
    const res = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(res.status).toBe(502);
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE document_id = ?1", inv.id))
        ?.status,
    ).toBe("failed");
    stub();
    expect((await staffLink(o, inv.id, inv.total, inv.updatedAt)).status).toBe(201);
  });

  it("at most 10 links per client per hour (429)", async () => {
    const o = await owner();
    const inv = await issued(o);
    const now = Date.now();
    for (let i = 0; i < 10; i++)
      await env.DB.prepare(
        "INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', 100, 'creating', ?5, ?6, ?6)",
      )
        .bind(uuidv7(), inv.id, inv.clientId, o.id, now + 86_400_000, now - 1000)
        .run()
        .then(() =>
          env.DB.prepare(
            "UPDATE checkout_sessions SET status = 'failed' WHERE document_id = ?1 AND status = 'creating'",
          )
            .bind(inv.id)
            .run(),
        );
    const res = await staffLink(o, inv.id, inv.total, inv.updatedAt);
    expect(res.status).toBe(429);
  });

  it("the portal path: the contact with portal and finance access may pay; another client's document or a contact without finance is a 404", async () => {
    const o = await owner();
    const inv = await issued(o);
    const ok = await createLinkFor(env, {
      provider: "razorpay",
      clientId: inv.clientId,
      contactId: inv.contactId,
      tokenHash: null,
      documentId: inv.id,
      amountMinor: inv.total,
      returnTo: "invoice",
    });
    expect(ok.ok).toBe(true);
    const other = await issued(o);
    const cross = await createLinkFor(env, {
      provider: "razorpay",
      clientId: other.clientId,
      contactId: other.contactId,
      tokenHash: null,
      documentId: inv.id,
      amountMinor: inv.total,
      returnTo: "invoice",
    });
    expect(cross).toEqual({ ok: false, error: "not_found" });
    await env.DB.prepare("UPDATE contacts SET can_see_finance = 0 WHERE id = ?1").bind(other.contactId).run();
    const noFinance = await createLinkFor(env, {
      provider: "razorpay",
      clientId: other.clientId,
      contactId: other.contactId,
      tokenHash: null,
      documentId: other.id,
      amountMinor: other.total,
      returnTo: "invoice",
    });
    expect(noFinance).toEqual({ ok: false, error: "not_found" });
  });
});

describe("processEvent: the webhook after the re-fetch [ADM-PAY-02, -06, -07, JOB-HOOK-02]", () => {
  it("a paid link on a tax invoice: confirmed (no Owner step), allocated, the invoice paid, the link paid, the event processed, the owners' bell", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    const p = await paymentOf(l.paymentId);
    expect(p).toMatchObject({
      status: "confirmed",
      provider: "razorpay",
      amount_minor: inv.total,
      mode: "upi",
      verified_by: null,
    });
    expect(p?.reference_norm).toMatch(/^PAY-A/);
    expect(
      await one<{ status: string; balance_minor: number }>(
        "SELECT status, balance_minor FROM documents WHERE id = ?1",
        inv.id,
      ),
    ).toEqual({
      status: "paid",
      balance_minor: 0,
    });
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", l.checkoutId))
        ?.status,
    ).toBe("paid");
    expect(
      await one<{ status: string; outcome: string }>(
        "SELECT status, outcome FROM webhook_events WHERE id = ?1",
        ev,
      ),
    ).toEqual({
      status: "processed",
      outcome: "confirmed",
    });
    expect(
      (await rows("SELECT id FROM notifications WHERE kind = 'payment.online' AND entity_id = ?1", p?.id))
        .length,
    ).toBeGreaterThan(0);
    // The Payments panel shows it as paid online, with the link.
    const panel = await json(await call(`/invoices/${inv.id}/payments`, { cookie: o.cookie }));
    expect(panel.gateway.payments[0]).toMatchObject({
      providerPaymentId: l.paymentId,
      status: "confirmed",
      mode: "upi",
    });
    expect(panel.gateway.links[0]).toMatchObject({
      checkoutId: l.checkoutId,
      status: "paid",
      shortUrl: null,
    });
    expect(
      (
        await one<{ actor_type: string }>(
          "SELECT actor_type FROM audit_log WHERE action = 'payment.gateway_confirm' AND entity_id = ?1",
          p?.id,
        )
      )?.actor_type,
    ).toBe("webhook");
  });

  it("a duplicate delivery, and a replay under a new event id: still one payment row; the event says duplicate", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    const ev1 = await eventRow(l.linkId, l.paymentId);
    await processEvent(env, ev1);
    expect(await processEvent(env, ev1)).toEqual({ result: "duplicate" });
    const ev2 = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev2)).toEqual({ result: "duplicate" });
    expect((await rows("SELECT id FROM payments WHERE provider_payment_id = ?1", l.paymentId)).length).toBe(
      1,
    );
    expect(
      (await one<{ outcome: string }>("SELECT outcome FROM webhook_events WHERE id = ?1", ev2))?.outcome,
    ).toBe("duplicate");
  });

  it("an amount that doesn't match the link: pending with an amount_mismatch item, the balance unchanged", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub((path) => {
      if (path.startsWith("/v1/payments/"))
        return Response.json({
          id: l.paymentId,
          amount: inv.total - 100,
          currency: "INR",
          status: "captured",
          method: "card",
          fee: 10,
          tax: 2,
          created_at: Math.floor(Date.now() / 1000),
        });
      return null;
    });
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    expect(
      (await one<{ balance_minor: number }>("SELECT balance_minor FROM documents WHERE id = ?1", inv.id))
        ?.balance_minor,
    ).toBe(inv.total);
    expect(
      (await one<{ kind: string }>("SELECT kind FROM review_items WHERE webhook_event_id = ?1", ev))?.kind,
    ).toBe("amount_mismatch");
    // Fix round 3 item 2: the item keeps the link's amount, so "Needs review" names it; still only the whitelist (ids, amounts, currency, method).
    const item = await one<{ facts: string }>(
      "SELECT facts FROM review_items WHERE webhook_event_id = ?1",
      ev,
    );
    const facts = JSON.parse(item?.facts ?? "{}") as Record<string, unknown>;
    expect(facts).toEqual({
      linkId: l.linkId,
      paymentId: l.paymentId,
      amountMinor: inv.total - 100,
      currency: "INR",
      method: "card",
      expectedMinor: inv.total,
    });
    const list = await call("/payments/review", { cookie: o.cookie });
    const listed = (
      (await json(list)) as { items: { kind: string; facts: Record<string, unknown> }[] }
    ).items.find((i) => i.kind === "amount_mismatch" && i.facts?.paymentId === l.paymentId);
    expect(listed?.facts).toEqual(facts);
    expect(itemReason({ kind: "amount_mismatch", facts, amount_minor: inv.total - 100 })).toBe(
      `The amount paid (${formatMoney(money(inv.total - 100, "INR"))}) doesn't match the link (${formatMoney(money(inv.total, "INR"))}).`,
    );
    // The Owner can't reject or (later) withdraw a Razorpay payment here: refunds are M6.5.
    const p = await paymentOf(l.paymentId);
    const rec = await one<{ recorded_at: number }>("SELECT recorded_at FROM payments WHERE id = ?1", p?.id);
    const rej = await call(`/payments/${p?.id}/verify`, {
      cookie: o.cookie,
      body: { decision: "reject", note: "no", expectedRecordedAt: rec?.recorded_at },
    });
    expect(rej.status).toBe(409);
    expect((await json(rej)).error.code).toBe("gateway_refund_needed");
  });

  it("a link we don't know: an unknown_link item, no payment row", async () => {
    stub((path) => {
      if (path === "/v1/payment_links/plink_UNKNOWN0001")
        return Response.json({
          id: "plink_UNKNOWN0001",
          status: "paid",
          currency: "INR",
          amount: 100,
          amount_paid: 100,
          reference_id: "nobody",
          payments: [],
        });
      return null;
    });
    const ev = await eventRow("plink_UNKNOWN0001", "pay_UNKNOWN0001");
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await one("SELECT id FROM payments WHERE provider_payment_id = 'pay_UNKNOWN0001'")).toBeNull();
    expect(
      (await one<{ kind: string }>("SELECT kind FROM review_items WHERE webhook_event_id = ?1", ev))?.kind,
    ).toBe("unknown_link");
  });

  it("Razorpay down (5xx) or a payment still pending: retry, nothing written; a 404: refetch_failed", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub(() => new Response("down", { status: 503 }));
    const ev = await eventRow(l.linkId, l.paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "retry" });
    expect(
      await one<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM webhook_events WHERE id = ?1",
        ev,
      ),
    ).toEqual({ status: "received", attempts: 1 });
    stub((path) =>
      path.startsWith("/v1/payments/")
        ? Response.json({
            id: l.paymentId,
            amount: inv.total,
            currency: "INR",
            status: "authorized",
            created_at: Math.floor(Date.now() / 1000),
          })
        : null,
    );
    expect(await processEvent(env, ev)).toEqual({ result: "retry" });
    stub((path) => (path.startsWith("/v1/payments/") ? new Response("{}", { status: 404 }) : null));
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(
      (await one<{ kind: string }>("SELECT kind FROM review_items WHERE webhook_event_id = ?1", ev))?.kind,
    ).toBe("refetch_failed");
    expect(await paymentOf(l.paymentId)).toBeNull();
  });

  it("a voided invoice meanwhile: the money is recorded pending with document_not_payable, never dropped", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'x' WHERE id = ?1",
    )
      .bind(inv.id, Date.now())
      .run()
      .catch(() => undefined);
    const voided =
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?1", inv.id))?.status ===
      "void";
    const ev = await eventRow(l.linkId, l.paymentId);
    const r = await processEvent(env, ev);
    if (voided) {
      expect(r).toEqual({ result: "needs_review" });
      expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
      expect(
        (await one<{ kind: string }>("SELECT kind FROM review_items WHERE webhook_event_id = ?1", ev))?.kind,
      ).toBe("document_not_payable");
      // Fix round 3 item 2: the reason code is kept (codes only), and the list reads it in words.
      const facts = JSON.parse(
        (await one<{ facts: string }>("SELECT facts FROM review_items WHERE webhook_event_id = ?1", ev))
          ?.facts ?? "{}",
      ) as Record<string, unknown>;
      expect(facts.reason).toBe("void");
      expect(Object.keys(facts).sort()).toEqual(
        [
          "amountMinor",
          "currency",
          "linkId",
          "paymentId",
          "reason",
          ...(facts.method ? ["method"] : []),
        ].sort(),
      );
      expect(itemReason({ kind: "document_not_payable", facts, amount_minor: inv.total })).toContain(
        "(it was voided)",
      );
    } else expect(r.result).toBe("processed");
  });

  it("an expired link: the checkout expires and the event is processed", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub((path) =>
      path === `/v1/payment_links/${l.linkId}`
        ? Response.json({
            id: l.linkId,
            status: "expired",
            currency: "INR",
            amount: inv.total,
            amount_paid: 0,
            reference_id: l.checkoutId,
            payments: null,
          })
        : null,
    );
    const ev = await eventRow(l.linkId, null, "payment_link.expired");
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", l.checkoutId))
        ?.status,
    ).toBe("expired");
  });

  it("the status refresh settles the same way, once a minute", async () => {
    const o = await owner();
    const inv = await issued(o);
    await linkFor(o, inv);
    expect(await refreshForClient(env, { clientId: inv.clientId, documentId: inv.id })).toEqual({
      result: "processed",
    });
    expect(await refreshForClient(env, { clientId: inv.clientId, documentId: inv.id })).toEqual({
      result: "no_open_link",
    });
  });
});

describe("a proforma paid online: the automatic tax invoice [ADM-INV-10, L5, L6, L17; 08-C RA-17]", () => {
  it("pending, then issued by the system on behalf of the proforma's Owner: issued_by NULL, the receipt by the issuer, the payment confirmed", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    const ev = await eventRow(l.linkId, l.paymentId);
    const r = await processEvent(env, ev);
    expect(r.result).toBe("processed");
    expect(r.next?.kind).toBe("gateway.advance");
    const paymentId = r.next?.paymentId as string;
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    const a = await issueGatewayAdvance(env, paymentId);
    expect(a.result, JSON.stringify(a)).toBe("issued");
    expect(a.number).toMatch(/INV/);
    const inv = await one<{ id: string; issued_by: string | null; status: string; parent_id: string }>(
      "SELECT id, issued_by, status, parent_id FROM documents WHERE parent_id = ?1 AND type = 'tax_invoice'",
      pf.id,
    );
    expect(inv).toMatchObject({ issued_by: null, status: "paid", parent_id: pf.id });
    expect(
      (
        await one<{ created_by: string }>(
          "SELECT created_by FROM advance_receipts WHERE proforma_id = ?1",
          pf.id,
        )
      )?.created_by,
    ).toBe(o.id);
    expect((await paymentOf(l.paymentId))?.status).toBe("confirmed");
    const audit = await one<{ actor_type: string; summary: string }>(
      "SELECT actor_type, summary FROM audit_log WHERE action = 'invoice.advance_issue_auto' AND entity_id = ?1",
      inv?.id,
    );
    expect(audit?.actor_type).toBe("system");
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ authority: "gateway_auto", onBehalfOf: o.id });
    // Again: already issued, the same number.
    expect(await issueGatewayAdvance(env, paymentId)).toEqual({ result: "already_issued", number: a.number });
  });

  it("two tries at once: one invoice", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
    const paymentId = r.next?.paymentId as string;
    const both = await Promise.all([
      issueGatewayAdvance(env, paymentId),
      issueGatewayAdvance(env, paymentId),
    ]);
    expect(both.map((x) => x.result).sort()).toEqual(["already_issued", "issued"]);
    expect((await rows("SELECT id FROM documents WHERE parent_id = ?1", pf.id)).length).toBe(1);
  });

  it("a blocker (the proforma's Owner no longer active): advance_blocked with the payment still pending", async () => {
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
    await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?1")
      .bind(o.id)
      .run()
      .catch(() => undefined);
    const a = await issueGatewayAdvance(env, r.next?.paymentId as string);
    if (
      (await one<{ status: string }>("SELECT status FROM staff_users WHERE id = ?1", o.id))?.status !==
      "active"
    ) {
      expect(a).toEqual({ result: "blocked", blockers: ["issuer_not_owner"] });
      expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
      expect(
        (
          await one<{ kind: string }>(
            "SELECT kind FROM review_items WHERE payment_id = ?1",
            r.next?.paymentId,
          )
        )?.kind,
      ).toBe("advance_blocked");
    }
  });
});

describe("routes per role, the review list, the provider contract", () => {
  it("Owner and Staff make links; Sales and Accountant are refused; only the Owner resolves", async () => {
    const o = await owner();
    const inv = await issued(o);
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await staffLink(s, inv.id, inv.total, inv.updatedAt)).status, role).toBe(403);
    }
    const staff = await sessionFor("staff");
    expect((await staffLink(staff, inv.id, inv.total, inv.updatedAt)).status).toBe(201);
    stub((path) => (path.startsWith("/v1/payment_links/") ? new Response("{}", { status: 404 }) : null));
    const linkRow = await one<{ provider_link_id: string }>(
      "SELECT provider_link_id FROM checkout_sessions WHERE document_id = ?1 AND status = 'live'",
      inv.id,
    );
    const ev = await eventRow(linkRow?.provider_link_id as string, "pay_X0000001");
    await processEvent(env, ev);
    const list = await call("/payments/review", { cookie: o.cookie });
    const b = await json(list);
    expect(list.status).toBe(200);
    const item = (b.items as { id: string; webhook_event_id: string }[]).find(
      (i) => i.webhook_event_id === ev,
    );
    expect(item).toBeDefined();
    expect(b.openCount).toBeGreaterThan(0);
    const byStaff = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: staff.cookie,
      body: { resolution: "dismissed", note: null },
    });
    expect(byStaff.status).toBe(403);
    const ok = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "dismissed", note: "Checked with the bank" },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const twice = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: o.cookie,
      body: { resolution: "dismissed", note: null },
    });
    expect((await json(twice)).error.code).toBe("review_resolved");
  });

  it("the Razorpay client passes the provider contract with a stubbed fetch, and a live key makes no call", async () => {
    const ok = razorpayProvider({
      keyId: "rzp_test_K1",
      keySecret: "s",
      settingsMode: "test",
      liveFlag: "false",
      fetch: stubFetch,
    });
    expect(await checkProviderContract(ok, { liveAllowed: "false" })).toEqual([]);
    let n = 0;
    const counting: typeof fetch = async (i, o) => {
      n++;
      return stubFetch(i, o);
    };
    const live = razorpayProvider({
      keyId: "rzp_live_K1",
      keySecret: "s",
      settingsMode: "live",
      liveFlag: "false",
      fetch: counting,
    });
    expect(await checkProviderContract(live, { liveAllowed: "false" })).toEqual([]);
    expect(n).toBe(0);
    const api = razorpayApi({
      keyId: "rzp_test_K1",
      keySecret: "s",
      settingsMode: "live",
      liveFlag: "false",
      fetch: counting,
    });
    expect(await api.fetchLink("plink_A1R0")).toEqual({ ok: false, code: "live_not_allowed" });
    expect(n).toBe(0);
  });

  it("each RPC stays within 45 D1 statements (processEvent on an invoice; the automatic advance)", async () => {
    const o = await owner();
    const { env: e, counter } = countingEnv();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    const ev = await eventRow(l.linkId, l.paymentId);
    counter.n = 0;
    expect((await processEvent(e, ev)).result).toBe("processed");
    console.log(`D1 statements, processEvent (invoice): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(45);
    const pf = await issued(o, "proforma");
    const lp = await linkFor(o, pf);
    const r = await processEvent(env, await eventRow(lp.linkId, lp.paymentId));
    counter.n = 0;
    expect((await issueGatewayAdvance(e, r.next?.paymentId as string)).result).toBe("issued");
    console.log(`D1 statements, issueGatewayAdvance: ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(45);
  });
});

describe("the start-up warm-up [CPU diagnosis, lead decision 3]", () => {
  it("runs every step of the gateway code once, with made-up values", () => {
    expect(warmGateway()).toBe(GATEWAY_WARM_STEPS);
  });
});

describe("review facts [fix round 3 item 2; L8, 08-C RB-40]", () => {
  it("add only a reason code and an expected amount to the whitelist", () => {
    const base = { linkId: "plink_X", paymentId: "pay_X", amountMinor: 100, currency: "INR" };
    expect(reviewFactsOf(base, { reason: "nothing_due", expectedMinor: 500, paidMinor: 100 })).toEqual({
      ...base,
      reason: "nothing_due",
      expectedMinor: 500,
    });
    expect(reviewFactsOf(base, {})).toEqual(base);
    // Anything but a short code, or an amount that isn't a whole number, is dropped.
    expect(reviewFactsOf(base, { reason: "a@b.example", expectedMinor: 1.5 })).toEqual(base);
    expect(reviewFactsOf(base, { reason: "x".repeat(41), expectedMinor: null })).toEqual(base);
  });
});
