// "Pay with PayPal" (M6.4; ADM-PAY-01, -07, -11, POR-06; run file C `PortalPayments.createLink`'s PayPal branch, L3, L4, L5, L10, L19, L25). Called by `makeLink`
// once the shared rules have passed (`linkContext`: who may pay, the PayPal row of the rule table, the USD floor and maximum, no payment waiting; staff never make
// one, L4: the staff link is the portal page). Then:
//   - the gateway guard, before any row or fetch: no transport or keys is 503 `gateway_unavailable`; a live mode while it isn't allowed is 503 `live_not_allowed`
//     (CLAUDE.md rule 7; zero fetches);
//   - one open checkout per document across gateways (L4, L25): an open PayPal order of the same amount, unclaimed, with at least 30 minutes left is reused (its
//     stored approval URL); any other open PayPal order is ended HERE (no PayPal call: an order is ended by never capturing it), but never one whose capture is
//     claimed (409 `payment_processing`, "B2 must carry" 8); an open Stripe session is ended through Stripe's own expire-then-settle path (`endStripeSession`);
//   - ROW FIRST: the `creating` row (the unique index serialises two clicks), then `POST /v2/checkout/orders` with `PayPal-Request-Id: ord-<checkout id>`, then
//     `live` with the order id, its `payer-action` URL (on PayPal's own `www` hosts, for this order only, else the row fails: 502) and our 2 h 30 min lifetime.
// The order carries no payer, shipping, customer or vault field (core `orderRequestOf`; ADM-PAY-12, L7); the client types nothing of theirs here.
import { uuidv7 } from "@techaust/core/ids";
import {
  isPayPalApproveUrl,
  orderRequestOf,
  PAYPAL_BRAND_NAME,
  PAYPAL_ORDER_LIFETIME_MS,
  PAYPAL_REUSE_MIN_LEFT_MS,
  type PayPalDocumentType,
} from "@techaust/core/paypal";
import {
  CLIENT_LINKS_SINCE_SQL,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutLiveStatement,
  LINKS_PER_CLIENT_HOUR,
} from "@techaust/db/gateway";
import { auditStmt } from "@techaust/db/log";
import { cachedSetting } from "../settings-cache.ts";
import { envText, payPalOf, portalUrlOf, stripeModeOfSettings, stripeOf, transportOf } from "./config.ts";
import type { LinkContext, MakeLinkArgs, MakeLinkResult } from "./link-context.ts";
import type { PayPalApi } from "./paypal.ts";
import type { CheckoutRow, GatewayEnv } from "./settle.ts";
import { endStripeSession } from "./stripe-links.ts";

/** A `creating` row older than this is taken as abandoned (its Worker died between the row and PayPal's answer; its URL never left this Worker). */
export const PAYPAL_CREATING_STALE_MS = 60_000;

/**
 * The open checkout ended here because a new one replaces it (`cancelled`), with its own audit row written only if the row moved, by the actor of the new one.
 * Never ends a claimed PayPal row (`checkoutEndStatement` holds `capture_started_at IS NULL`). True when it ended.
 */
export async function endReplacedLocally(
  env: GatewayEnv,
  row: CheckoutRow,
  actorOf: LinkContext["actorOf"],
  documentId: string,
  now: number,
): Promise<boolean> {
  const db = env.DB;
  const [end] = await db.batch([
    checkoutEndStatement(db, { id: row.id, status: "cancelled", now }),
    auditStmt(
      db,
      {
        ...actorOf,
        action: "payment.link_cancel",
        entityType: "checkout_session",
        entityId: row.id,
        summary: { checkoutId: row.id, documentId, replaced: true },
      },
      "changes",
    ),
  ]);
  return end?.meta.changes === 1;
}

/** The return and cancel pages (L19): the signed-in invoice page, or the emailed link's return page; both carry OUR checkout id, never a token. */
export function payPalReturnUrlsOf(
  env: object,
  returnTo: "invoice" | "pay_return",
  documentId: string,
  checkoutId: string,
): { returnUrl: string; cancelUrl: string } | null {
  const base = portalUrlOf(env);
  if (!base) return null;
  return returnTo === "invoice"
    ? {
        returnUrl: `${base}invoices/${documentId}?pay=paypal&c=${checkoutId}`,
        cancelUrl: `${base}invoices/${documentId}?pay=paypal-cancel&c=${checkoutId}`,
      }
    : {
        returnUrl: `${base}pay/return?via=paypal&c=${checkoutId}`,
        cancelUrl: `${base}pay/return?via=paypal&c=${checkoutId}&cancelled=1`,
      };
}

/** PayPal's flow, after the shared rules. Never throws for a refusal. */
export async function makePayPalLink(
  env: GatewayEnv,
  a: MakeLinkArgs,
  ctx: LinkContext,
  now: number,
): Promise<MakeLinkResult> {
  const db = env.DB;
  const { doc, clientId, open, limited, linkContactId, actorOf, floorMinor, maxMinor, mode } = ctx;
  // The gateway guard, before any row or fetch.
  if (
    transportOf(env, "paypal") === "unset" ||
    !envText(env, "PAYPAL_CLIENT_ID") ||
    !envText(env, "PAYPAL_CLIENT_SECRET")
  )
    return { ok: false, error: "gateway_unavailable" };
  const api = payPalOf(env, mode) as PayPalApi;
  if (api.blocked === "live_not_allowed") return { ok: false, error: "live_not_allowed" };
  if (api.blocked) return { ok: false, error: "gateway_unavailable" };
  if (!portalUrlOf(env)) return { ok: false, error: "gateway_unavailable" };
  if (!["export_invoice", "proforma", "debit_note"].includes(doc.type))
    return { ok: false, error: "not_payable_online" };
  let replacedCheckoutId: string | null = null;
  if (open) {
    if (open.status === "creating") {
      if (now - open.created_at < PAYPAL_CREATING_STALE_MS) return { ok: false, error: "link_in_progress" };
      // Abandoned (its Worker died before the gateway's answer): its URL never left this Worker, so it can't be paid; fail it and go on.
      await checkoutFailStatement(db, { id: open.id, now }).run();
    } else if (open.provider === "paypal") {
      if (
        open.amount_minor === a.amountMinor &&
        open.capture_started_at === null &&
        open.short_url &&
        isPayPalApproveUrl(open.short_url, open.provider_link_id ?? undefined) &&
        open.expires_at - now >= PAYPAL_REUSE_MIN_LEFT_MS
      )
        return {
          ok: true,
          url: open.short_url,
          expiresAt: open.expires_at,
          reused: true,
          checkoutId: open.id,
        };
      if (limited) return { ok: false, error: "too_many_links" };
      // A new amount, or an order about to expire: ended here with no PayPal call; a claimed one may be capturing right now.
      if (!(await endReplacedLocally(env, open, actorOf, a.documentId, now)))
        return { ok: false, error: "payment_processing" };
      replacedCheckoutId = open.id;
    } else if (open.provider === "stripe") {
      if (limited) return { ok: false, error: "too_many_links" };
      const stripeMode = await stripeModeOfSettings(db);
      const stripe = stripeOf(env, stripeMode);
      if (!stripe) return { ok: false, error: "gateway_error" };
      const r = await endStripeSession(env, stripe, open, stripeMode, now, (row) =>
        endReplacedLocally(env, row, actorOf, a.documentId, now),
      );
      if (!r.ok) return r.refusal;
      replacedCheckoutId = open.id;
    } else return { ok: false, error: "link_in_progress" };
  }
  if (limited) return { ok: false, error: "too_many_links" };
  // ROW FIRST
  const checkoutId = uuidv7();
  const expiresAt = now + PAYPAL_ORDER_LIFETIME_MS;
  let inserted = 0;
  try {
    inserted = (
      await checkoutCreateStatement(db, {
        id: checkoutId,
        provider: "paypal",
        documentId: a.documentId,
        clientId,
        source: a.actor.kind === "contact" ? "portal" : "link",
        contactId: linkContactId,
        docTokenId: a.actor.kind === "token" ? a.actor.tokenHash : null,
        createdBy: null,
        amountMinor: a.amountMinor,
        floorMinor,
        maxMinor,
        expiresAt,
        now,
      }).run()
    ).meta.changes;
  } catch (e) {
    if (/UNIQUE constraint failed: checkout_sessions/.test(String(e) + String((e as Error)?.cause ?? "")))
      return { ok: false, error: "link_in_progress" };
    throw e;
  }
  if (inserted !== 1) {
    const n =
      (
        await db
          .prepare(CLIENT_LINKS_SINCE_SQL)
          .bind(clientId, now - 3_600_000)
          .first<{ n: number }>()
      )?.n ?? 0;
    return n >= LINKS_PER_CLIENT_HOUR
      ? { ok: false, error: "too_many_links" }
      : { ok: false, error: "not_payable_online", reason: "changed" };
  }
  // 07-ZN line 15: the brand name is Settings › Company's trade name ("TecHaust Technologies").
  const company = await db
    .prepare("SELECT value, version FROM settings WHERE key = 'company'")
    .first<{ value: string; version: number }>();
  let brandName = PAYPAL_BRAND_NAME;
  try {
    brandName = cachedSetting("company", company ?? undefined).tradeName;
  } catch {
    brandName = PAYPAL_BRAND_NAME;
  }
  const urls = payPalReturnUrlsOf(env, a.returnTo, a.documentId, checkoutId) as {
    returnUrl: string;
    cancelUrl: string;
  };
  const body = orderRequestOf({
    checkoutId,
    amountMinor: a.amountMinor,
    documentNumber: doc.number_display ?? "",
    documentType: doc.type as PayPalDocumentType,
    returnUrl: urls.returnUrl,
    cancelUrl: urls.cancelUrl,
    brandName,
  });
  if (!body.ok) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return { ok: false, error: "gateway_error" };
  }
  const created = await api.createOrder(body.body, body.requestId);
  // The approval URL is PayPal's own page for this very order before the row goes live, so no answer can send a client elsewhere.
  if (
    !created.ok ||
    !created.value.payerActionUrl ||
    !isPayPalApproveUrl(created.value.payerActionUrl, created.value.id)
  ) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return {
      ok: false,
      error: !created.ok && created.code === "live_not_allowed" ? "live_not_allowed" : "gateway_error",
    };
  }
  const [live] = await db.batch([
    checkoutLiveStatement(db, {
      id: checkoutId,
      providerLinkId: created.value.id,
      shortUrl: created.value.payerActionUrl,
      expiresAt,
      now,
    }),
    auditStmt(
      db,
      {
        ...actorOf,
        action: "payment.link_create",
        entityType: "checkout_session",
        entityId: checkoutId,
        summary: {
          checkoutId,
          documentId: a.documentId,
          amountMinor: a.amountMinor,
          source: a.actor.kind,
          provider: "paypal",
          ...(replacedCheckoutId ? { replacedCheckoutId } : {}),
        },
      },
      "changes",
    ),
  ]);
  if (live?.meta.changes !== 1) return { ok: false, error: "gateway_error" };
  return { ok: true, url: created.value.payerActionUrl, expiresAt, reused: false, checkoutId };
}
