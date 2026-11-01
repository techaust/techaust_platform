// The admin routes of M6.2 (run file C, the routes table; finance Worker, `on: "finance"`): payment links on an invoice (make, cancel, refresh), the "Needs
// review" list with the Owner's resolve and "Try again", and the gateways' status as the finance Worker sees it (L15: the keys live here, so only this Worker
// can say whether they are set; the webhook secret is the jobs Worker's, so "Last verified webhook" stands for it). Every change is one batch through `mutate`.
import { REVIEW_RESOLUTIONS } from "@techaust/core/online-pay";
import { GATEWAYS } from "@techaust/core/settings";
import {
  CHECKOUT_BY_ID_SQL,
  checkoutEndStatement,
  LAST_VERIFIED_EVENT_SQL,
  OPEN_REVIEW_COUNT_SQL,
  REVIEW_ITEM_READ_SQL,
  REVIEW_ITEMS_SQL,
  reviewResolveStatement,
} from "@techaust/db/gateway";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, type Ctx, err, mutate, NOT_FOUND, requestInfo } from "../context.ts";
import { body, idParam, param, STALE_VERSION } from "../http.ts";
import { cachedSetting } from "../settings-cache.ts";
import { issueGatewayAdvance } from "./advance.ts";
import { envText, FINANCE_GATEWAY_SECRETS, gatewayModeOf, razorpayOf } from "./config.ts";
import { sendNext, staleCanceller } from "./events.ts";
import { closeByRealState, type MakeLinkResult, makeLink, refreshCheckout } from "./links.ts";
import {
  ADVANCE_CHANGED,
  AMOUNT_NOT_WHOLE_RUPEE,
  amountAboveBalance,
  amountBelowMinimum,
  GATEWAY_ERROR,
  GATEWAY_UNAVAILABLE,
  LINK_IN_PROGRESS,
  LINK_NOT_LIVE,
  LIVE_NOT_ALLOWED,
  NOT_PAYABLE_ONLINE,
  NOT_RETRYABLE,
  RESOLUTION_NOT_ALLOWED,
  REVIEW_RESOLVED,
  TOO_MANY_LINKS,
} from "./messages.ts";
import type { CheckoutRow } from "./settle.ts";
import { settlePayment } from "./settle.ts";

export const linkBody = z.strictObject({
  amountMinor: z.int().check(z.gte(1)),
  expectedUpdatedAt: z.int(),
});
export const cancelBody = z.strictObject({ checkoutId: z.string().check(z.minLength(1), z.maxLength(64)) });
export const resolveBody = z.strictObject({
  resolution: z.enum(REVIEW_RESOLUTIONS),
  note: z.nullable(z.string().check(z.trim(), z.maxLength(500))),
});
const LIST_QUERY_AFTER = /^\d{1,16}:[A-Za-z0-9-]{1,64}$/;

/** A refused link as the admin API answers it (run file C, Errors). */
export function linkRefusal(c: Ctx, r: Extract<MakeLinkResult, { ok: false }>): Response {
  switch (r.error) {
    case "not_found":
      return r.stale ? err(c, STALE_VERSION, 409) : err(c, NOT_FOUND, 404);
    case "amount_below_minimum":
      return err(c, amountBelowMinimum(r.minimumMinor ?? 0), 400, { minimumMinor: r.minimumMinor ?? 0 });
    case "amount_above_balance":
      return err(c, amountAboveBalance(r.balanceMinor ?? 0), 400, { balanceMinor: r.balanceMinor ?? 0 });
    case "amount_not_whole_rupee":
      return err(c, AMOUNT_NOT_WHOLE_RUPEE, 400);
    case "not_payable_online":
      return err(c, NOT_PAYABLE_ONLINE, 409, { reason: r.reason ?? "changed" });
    case "link_in_progress":
      return err(c, LINK_IN_PROGRESS, 409);
    case "too_many_links":
      return err(c, TOO_MANY_LINKS, 429);
    case "gateway_unavailable":
      return err(c, GATEWAY_UNAVAILABLE, 503);
    case "live_not_allowed":
      return err(c, LIVE_NOT_ALLOWED, 503);
    case "client_gone":
      return err(c, { code: "client_gone", message: "This client's details were erased." }, 409);
    default:
      return err(c, GATEWAY_ERROR, 502);
  }
}

// ---- under /v1/invoices ----------------------------------------------------------------------------------------------------------------------------------

export const invoicePaymentLinks = new Hono<AppEnv>()
  .post("/:id/payment-link", param(idParam), body(linkBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const r = await makeLink(c.env, {
      provider: "razorpay",
      clientId: null,
      documentId: id,
      amountMinor: f.amountMinor,
      actor: { kind: "staff", memberId: u.id, role: u.role === "owner" ? "owner" : "staff" },
      returnTo: "pay_return",
      expectedUpdatedAt: f.expectedUpdatedAt,
      request: requestInfo(c),
    });
    if (!r.ok) return linkRefusal(c, r);
    return c.json(
      { ok: true, checkoutId: r.checkoutId, shortUrl: r.shortUrl, expiresAt: r.expiresAt, reused: r.reused },
      r.reused ? 200 : 201,
    );
  })
  .post("/:id/payment-link/cancel", param(idParam), body(cancelBody), async (c) => {
    const { id } = c.req.valid("param");
    const { checkoutId } = c.req.valid("json");
    const db = c.env.DB;
    const co = await db.prepare(CHECKOUT_BY_ID_SQL).bind(checkoutId).first<CheckoutRow>();
    if (!co || co.document_id !== id) return err(c, NOT_FOUND, 404);
    if ((co.status !== "live" && co.status !== "stale") || !co.provider_link_id)
      return err(c, LINK_NOT_LIVE, 409);
    const api = razorpayOf(c.env, await gatewayModeOf(db));
    if (!api) return err(c, GATEWAY_UNAVAILABLE, 503);
    // Razorpay first, so a link we call cancelled can never still take money.
    const cancelled = await api.cancelLink(co.provider_link_id);
    if (!cancelled.ok) {
      if (cancelled.code === "live_not_allowed") return err(c, LIVE_NOT_ALLOWED, 503);
      if (cancelled.code !== "refused") return err(c, GATEWAY_ERROR, 502);
      // Review finding 2: Razorpay refused (paid, expired or cancelled there): our row is ended by the link's real state, so it never stays open here. A link
      // that ended there answers as ended; a paid one is settled and answers 409 (the panel reloads and shows the payment).
      const real = await closeByRealState(c.env, api, co, Date.now());
      if (real === "open") return err(c, GATEWAY_ERROR, 502);
      if (real === "paid") return err(c, LINK_NOT_LIVE, 409);
      // Ended there: the system closed the row (`payment.link_end`); the member's own act is recorded too.
      await mutate(c, {
        action: "payment.link_cancel",
        entityType: "checkout_session",
        entityId: co.id,
        summary: { checkoutId: co.id, documentId: id, endedAtRazorpay: true },
      });
      return c.json({ ok: true, status: "ended" });
    }
    const now = Date.now();
    const done = await mutate(c, {
      main: checkoutEndStatement(db, { id: co.id, status: "cancelled", now }),
      action: "payment.link_cancel",
      entityType: "checkout_session",
      entityId: co.id,
      summary: { checkoutId: co.id, documentId: id },
    });
    if (!done) return err(c, LINK_NOT_LIVE, 409);
    return c.json({ ok: true, status: "cancelled" });
  });

// ---- under /v1/payments (registered BEFORE the M6.1 `/:id` routes, so these static paths answer first) ------------------------------------------------------

export const gatewayPayments = new Hono<AppEnv>()
  .post("/links/:id/refresh", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const co = await c.env.DB.prepare(CHECKOUT_BY_ID_SQL).bind(id).first<CheckoutRow>();
    if (!co) return err(c, NOT_FOUND, 404);
    const r = await refreshCheckout(c.env, co);
    return c.json({ ok: true, result: r.result });
  })
  .get("/review", async (c) => {
    const status = c.req.query("status") ?? "open";
    const kind = c.req.query("kind") ?? null;
    const after = c.req.query("after") ?? null;
    if (
      (status !== "open" && status !== "resolved") ||
      (kind !== null && !/^[a-z_]{1,32}$/.test(kind)) ||
      (after !== null && !LIST_QUERY_AFTER.test(after))
    )
      return err(c, { code: "bad_request", message: "Something in the request isn't right" }, 400);
    const [at, lastId] = after ? (after.split(":") as [string, string]) : ["-1", ""];
    const [list, count] = await c.env.DB.batch([
      c.env.DB.prepare(REVIEW_ITEMS_SQL).bind(Number(at), lastId, status, kind),
      c.env.DB.prepare(OPEN_REVIEW_COUNT_SQL),
    ]);
    const rows = (list?.results ?? []) as (Record<string, unknown> & {
      created_at: number;
      id: string;
      facts: string | null;
    })[];
    const page = rows.slice(0, 50);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => ({ ...r, facts: r.facts ? JSON.parse(r.facts) : null })),
      next: rows.length > 50 && last ? `${last.created_at}:${last.id}` : null,
      openCount: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  })
  .post("/review/:id/resolve", param(idParam), body(resolveBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const item = await c.env.DB.prepare(REVIEW_ITEM_READ_SQL).bind(id).first<{ status: string }>();
    if (!item) return err(c, NOT_FOUND, 404);
    if (item.status !== "open") return err(c, REVIEW_RESOLVED, 409);
    // A record only (lead decision on early check 2, finding 5): the statement refuses a resolution the money isn't in.
    const done = await mutate(c, {
      main: reviewResolveStatement(c.env.DB, {
        id,
        by: u.id,
        now: Date.now(),
        resolution: f.resolution,
        note: f.note || null,
      }),
      action: "payment.review_resolve",
      entityType: "review_item",
      entityId: id,
      // The note's text is never in the audit log (it may name a person).
      summary: { reviewId: id, resolution: f.resolution, note: f.note ? "set" : null },
    });
    if (!done) {
      const again = await c.env.DB.prepare(REVIEW_ITEM_READ_SQL).bind(id).first<{ status: string }>();
      return again?.status === "open" ? err(c, RESOLUTION_NOT_ALLOWED, 409) : err(c, REVIEW_RESOLVED, 409);
    }
    return c.json({ ok: true, status: "resolved" });
  })
  .post("/review/:id/retry", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const u = actor(c);
    const item = await db.prepare(REVIEW_ITEM_READ_SQL).bind(id).first<{
      status: string;
      kind: string;
      payment_id: string | null;
      facts: string | null;
    }>();
    if (!item) return err(c, NOT_FOUND, 404);
    if (item.status !== "open") return err(c, REVIEW_RESOLVED, 409);
    // A pending payment waiting for its tax invoice: the automatic issue again, one try (early check 2, finding 1). Its own batch resolves the payment's open
    // items and audits the act (finding 12: no second resolve here). A proforma changed meanwhile: 409, the Owner presses again.
    if (item.payment_id && (item.kind === "advance_blocked" || item.kind === "dead_letter")) {
      const r = await issueGatewayAdvance(c.env, item.payment_id);
      if (r.result === "retry") return err(c, ADVANCE_CHANGED, 409);
      // Issued earlier (by hand, or by an earlier try) while this item stayed open: the record follows the money (guarded: the payment has its receipt).
      if (r.result === "already_issued")
        await mutate(c, {
          main: reviewResolveStatement(db, {
            id,
            by: u.id,
            now: Date.now(),
            resolution: "advance_issued",
            note: null,
          }),
          action: "payment.review_retry",
          entityType: "review_item",
          entityId: id,
          summary: { reviewId: id, result: r.result },
        });
      return c.json({ ok: true, result: r.result, ...(r.blockers ? { blockers: r.blockers } : {}) });
    }
    if (!["refetch_failed", "dead_letter", "unknown_link"].includes(item.kind))
      return err(c, NOT_RETRYABLE, 409);
    let linkId: string | null = null;
    try {
      const facts = JSON.parse(item.facts ?? "{}") as { linkId?: unknown };
      linkId = typeof facts.linkId === "string" ? facts.linkId : null;
    } catch {
      linkId = null;
    }
    if (!linkId) return err(c, NOT_RETRYABLE, 409);
    const api = razorpayOf(c.env, await gatewayModeOf(db));
    if (!api) return err(c, GATEWAY_UNAVAILABLE, 503);
    const now = Date.now();
    const r = await settlePayment(
      c.env,
      { api, linkId, paymentId: null, cause: { kind: "refresh" }, now },
      staleCanceller(c.env, api, now),
    );
    // A proforma's payment recorded (or found) here still needs its tax invoice (early check 2, finding 2).
    await sendNext(c.env, r.next);
    if (r.result === "processed" || r.result === "duplicate") {
      // Resolved as `confirmed` only when the payment is (RESOLUTION_ALLOWED_SQL); a proforma's payment still pending leaves the item open until its tax invoice.
      await mutate(c, {
        main: reviewResolveStatement(db, { id, by: u.id, now, resolution: "confirmed", note: null }),
        action: "payment.review_retry",
        entityType: "review_item",
        entityId: id,
        summary: { reviewId: id, result: r.result },
      });
    }
    if (r.result === "retry") return err(c, GATEWAY_ERROR, 502);
    return c.json({ ok: true, result: r.result });
  })
  .get("/gateways", async (c) => {
    const db = c.env.DB;
    const [modeRow, last] = await db.batch([
      db.prepare("SELECT value, version FROM settings WHERE key = 'gateways'"),
      db.prepare(LAST_VERIFIED_EVENT_SQL).bind("razorpay"),
    ]);
    const modes = cachedSetting(
      "gateways",
      (modeRow?.results[0] as { value: string; version: number } | undefined) ?? undefined,
    );
    const keys = (g: (typeof GATEWAYS)[number]) => {
      const missing = FINANCE_GATEWAY_SECRETS[g].filter((n) => !envText(c.env, n));
      return { configured: missing.length === 0, missing };
    };
    const lastAt = (last?.results[0] as { at: number | null } | undefined)?.at ?? null;
    return c.json({
      gateways: Object.fromEntries(
        GATEWAYS.map((g) => [
          g,
          { mode: modes[g].mode, keys: keys(g), lastVerifiedWebhookAt: g === "razorpay" ? lastAt : null },
        ]),
      ),
      liveAllowed: envText(c.env, "PAYMENTS_LIVE_ALLOWED") === "true",
    });
  });
