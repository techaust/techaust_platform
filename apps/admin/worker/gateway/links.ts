// Payment links (M6.2; ADM-PAY-02, POR-06; run file C `PortalPayments` and the staff routes, L2 to L4, L10, L12): make one, reuse one, cancel one, and refresh one's
// status. The portal calls `createLink` / `refreshForClient` over the `ADMIN_PAY` binding; the admin routes call the same functions with a member. Every rule is
// re-checked here in SQL from the ids alone (the caller is trusted for nothing but the ids): the contact or the emailed link may pay this document, the document is
// payable online, the amount is within the bounds (core `payAmountVerdict`, the floor from Settings › Payment terms). ROW FIRST: the `creating` checkout is written
// before Razorpay is called (two clicks serialise on `checkout_sessions_open`), then the link, then `live`. Razorpay is never asked for an SMS, an email, a
// reminder or a customer (L10). The live guard answers before any fetch. M6.3: the shared reads and rules are `linkContext` (link-context.ts); Stripe's flow is
// `stripe-links.ts`; the refreshes dispatch by the checkout's provider.
import type { CreateLinkArgs, RefreshResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import {
  isRazorpayShortUrl,
  LINK_LIFETIME_MS,
  linkRequestOf,
  type RazorpayLink,
  razorpayAllowed,
} from "@techaust/core/razorpay";
import {
  CHECKOUT_COLS,
  CLIENT_LINKS_SINCE_SQL,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutLiveStatement,
  checkoutRefreshClaimStatement,
  LINKS_PER_CLIENT_HOUR,
  OPEN_CHECKOUT_SQL,
} from "@techaust/db/gateway";
import { auditStmt } from "@techaust/db/log";
import { mutateSystem } from "../system.ts";
import { envText, gatewayModeOf, portalUrlOf, razorpayOf, transportOf } from "./config.ts";
import { sendNext, staleCanceller } from "./events.ts";
import { type LinkContext, linkContext, type MakeLinkArgs, type MakeLinkResult } from "./link-context.ts";
import type { RazorpayApi } from "./razorpay.ts";
import { type CheckoutRow, endCheckout, type GatewayEnv, settlePayment } from "./settle.ts";
import { makeStripeLink } from "./stripe-links.ts";
import { refreshStripeCheckout } from "./stripe-settle.ts";

/** A `creating` row older than this is taken as abandoned (its Worker died between the row and Razorpay's answer; "For B2" 4). */
export const CREATING_ABANDONED_MS = 2 * 60_000;
/** An open link is reused only while it lives at least this much longer. */
export const REUSE_MIN_AHEAD_MS = 3_600_000;

export type { LinkActor, MakeLinkArgs, MakeLinkResult } from "./link-context.ts";

/** Razorpay's `callback_url`: the signed-in invoice page, or the static return page (an emailed link or a staff link: no token in any URL). */
function callbackOf(env: object, returnTo: "invoice" | "pay_return", documentId: string): string | null {
  const base = portalUrlOf(env);
  if (!base) return null;
  return returnTo === "invoice" ? `${base}invoices/${documentId}?pay=return` : `${base}pay/return`;
}

/** Adopt a Razorpay link found by our reference: the row goes live with it (a `creating` row only). */
async function adopt(
  env: GatewayEnv,
  checkoutId: string,
  link: RazorpayLink,
  now: number,
  fallbackExpiry: number,
): Promise<boolean> {
  if (!link.shortUrl || !isRazorpayShortUrl(link.shortUrl)) return false;
  const r = await checkoutLiveStatement(env.DB, {
    id: checkoutId,
    providerLinkId: link.providerRef,
    shortUrl: link.shortUrl,
    expiresAt: link.expiresAt ?? fallbackExpiry,
    now,
  }).run();
  return r.meta.changes === 1;
}

/**
 * M6.2 review finding 2: Razorpay refused to cancel a link we still hold open (it was paid, or it expired or was cancelled there and the news was lost). The link is
 * re-fetched and our row ended by its real state: expired or cancelled closes it (`endCheckout`); paid or partly paid settles it as a refresh would
 * (`settlePayment`, the proforma's advance queued); anything else (still open there, or Razorpay not reached) leaves it. Never throws for Razorpay's answer.
 */
export async function closeByRealState(
  env: GatewayEnv,
  api: RazorpayApi,
  checkout: CheckoutRow,
  now: number,
): Promise<"ended" | "paid" | "open"> {
  if (!checkout.provider_link_id) return "open";
  const linkR = await api.fetchLink(checkout.provider_link_id);
  if (!linkR.ok) return "open";
  const state = linkR.value.state;
  const cause = { kind: "refresh" } as const;
  if (state === "expired" || state === "cancelled") {
    await endCheckout(env, { cause, checkout, status: state, now });
    return "ended";
  }
  if (state !== "paid" && state !== "partially_paid") return "open";
  const r = await settlePayment(
    env,
    { api, linkId: checkout.provider_link_id, paymentId: null, cause, now },
    staleCanceller(env, api, now),
  );
  await sendNext(env, r.next);
  // Answered by our row, not by what settle said: "paid" only once the row is no longer open here. A payment we already held through this link (recorded before
  // the pending batch marked links paid) closes it now; a link whose money went to review with no payment row (refunded, an erased client, a currency
  // mismatch) stays open for the Owner's decision ("open").
  const row = await env.DB.prepare(LINK_STATE_SQL)
    .bind(checkout.id)
    .first<{ status: string; held: string | null }>();
  if (row && row.status !== "live" && row.status !== "stale") return "paid";
  if (state !== "paid" || !row?.held) return "open";
  const healed = await mutateSystem(env, {
    main: env.DB.prepare(
      "UPDATE checkout_sessions SET status = 'paid', paid_payment_id = ?2, updated_at = max(?3, updated_at + 1) WHERE id = ?1 AND status IN ('live', 'stale') AND paid_payment_id IS NULL",
    ).bind(checkout.id, row.held, now),
    action: "payment.link_end",
    entityType: "checkout_session",
    entityId: checkout.id,
    summary: {
      checkoutId: checkout.id,
      documentId: checkout.document_id,
      status: "paid",
      paymentId: row.held,
    },
  });
  return healed ? "paid" : "open";
}

/**
 * A checkout's status and the newest live payment we hold through it (a primary-key seek, then `payments` by its checkout). Fix round 4, low 4: only a payment
 * that still stands (`confirmed` or `pending_verification`) can be the one that paid the link, so the heal never records a withdrawn or rejected row as
 * `paid_payment_id`; of those, the newest.
 */
export const LINK_STATE_SQL = `SELECT c.status, (SELECT p.id FROM payments p INDEXED BY payments_checkout WHERE p.checkout_id = c.id AND p.provider = c.provider
     AND p.status IN ('confirmed', 'pending_verification') ORDER BY p.recorded_at DESC, p.id DESC LIMIT 1) AS held
   FROM checkout_sessions c WHERE c.id = ?1`;

/**
 * Make (or reuse) a payment link. Never throws for a refusal: the answer names it (the portal and the route map it to their status). The shared reads and rules
 * (`linkContext`), then the gateway's own flow: Razorpay's below, Stripe's in `stripe-links.ts` (M6.3).
 */
export async function makeLink(env: GatewayEnv, a: MakeLinkArgs, now = Date.now()): Promise<MakeLinkResult> {
  const x = await linkContext(env, a, now);
  if (!x.ok) return x.refusal;
  return a.provider === "stripe" ? makeStripeLink(env, a, x.ctx, now) : makeRazorpayLink(env, a, x.ctx, now);
}

/** Razorpay's flow (M6.2), after the shared rules. */
async function makeRazorpayLink(
  env: GatewayEnv,
  a: MakeLinkArgs,
  ctx: LinkContext,
  now: number,
): Promise<MakeLinkResult> {
  const db = env.DB;
  const { doc, clientId, open, limited, linkContactId, actorOf, floorMinor, mode } = ctx;
  // The gateway itself: a transport, keys, and the live guard, all before any row or fetch.
  if (
    transportOf(env, "razorpay") === "unset" ||
    !envText(env, "RAZORPAY_KEY_ID") ||
    !envText(env, "RAZORPAY_KEY_SECRET")
  )
    return { ok: false, error: "gateway_unavailable" };
  if (!razorpayAllowed(envText(env, "RAZORPAY_KEY_ID"), mode, envText(env, "PAYMENTS_LIVE_ALLOWED")))
    return { ok: false, error: "live_not_allowed" };
  const api = razorpayOf(env, mode) as RazorpayApi;
  const callbackUrl = callbackOf(env, a.returnTo, a.documentId);
  if (!callbackUrl) return { ok: false, error: "gateway_unavailable" };
  // L4: one open link per document. The same amount, live for at least an hour more: reused. A stuck `creating` row is adopted or failed; a recent one waits.
  // The hourly limit is checked BEFORE any link is cancelled (early check 2, finding 10): a refused request never leaves the document without its open link.
  // Review finding 11: the replaced link's end is one batch with its own audit row (written only if the row moved), by the same actor as the new link.
  let replacedCheckoutId: string | null = null;
  const endReplaced = async (row: CheckoutRow) => {
    const [end] = await db.batch([
      checkoutEndStatement(db, { id: row.id, status: "cancelled", now }),
      auditStmt(
        db,
        {
          ...actorOf,
          action: "payment.link_cancel",
          entityType: "checkout_session",
          entityId: row.id,
          summary: { checkoutId: row.id, documentId: a.documentId, replaced: true },
        },
        "changes",
      ),
    ]);
    if (end?.meta.changes === 1) replacedCheckoutId = row.id;
  };
  /**
   * Review finding 2: Razorpay refused the cancel: our row is ended by the link's real state. Ended there: the new link goes ahead. Paid there: the money is
   * settled and the request is refused as changed (the screen reloads and shows it). Still open, or not reached: `gateway_error`, as before.
   */
  const afterRefusal = async (row: CheckoutRow, code: string): Promise<MakeLinkResult | null> => {
    if (code !== "refused")
      return { ok: false, error: code === "live_not_allowed" ? "live_not_allowed" : "gateway_error" };
    const real = await closeByRealState(env, api, row, now);
    if (real === "ended") {
      replacedCheckoutId = row.id;
      return null;
    }
    return real === "paid"
      ? { ok: false, error: "not_payable_online", reason: "changed" }
      : { ok: false, error: "gateway_error" };
  };
  if (open) {
    if (open.status === "creating") {
      if (now - open.created_at < CREATING_ABANDONED_MS) return { ok: false, error: "link_in_progress" };
      const found = await api.findLinkByReference(open.id);
      if (!found.ok) return { ok: false, error: "gateway_error" };
      if (found.value && (await adopt(env, open.id, found.value, now, open.expires_at))) {
        const back = await db.prepare(OPEN_CHECKOUT_SQL).bind(a.documentId).first<CheckoutRow>();
        if (
          back?.status === "live" &&
          back.amount_minor === a.amountMinor &&
          back.short_url &&
          back.expires_at > now + REUSE_MIN_AHEAD_MS
        )
          return {
            ok: true,
            url: back.short_url,
            expiresAt: back.expires_at,
            reused: true,
            checkoutId: back.id,
          };
        if (limited) return { ok: false, error: "too_many_links" };
        if (back?.status === "live" && back.provider_link_id) {
          const c = await api.cancelLink(back.provider_link_id);
          if (!c.ok) {
            const refused = await afterRefusal(back, c.code);
            if (refused) return refused;
          } else await endReplaced(back);
        }
      } else {
        await checkoutFailStatement(db, { id: open.id, now }).run();
      }
    } else if (open.status === "live") {
      if (open.amount_minor === a.amountMinor && open.short_url && open.expires_at > now + REUSE_MIN_AHEAD_MS)
        return {
          ok: true,
          url: open.short_url,
          expiresAt: open.expires_at,
          reused: true,
          checkoutId: open.id,
        };
      // A new amount (or a link about to expire): the old one is cancelled at Razorpay FIRST, so two links never take money for the same document.
      if (limited) return { ok: false, error: "too_many_links" };
      if (open.provider_link_id) {
        const c = await api.cancelLink(open.provider_link_id);
        if (!c.ok) {
          const refused = await afterRefusal(open, c.code);
          if (refused) return refused;
        } else await endReplaced(open);
      } else await endReplaced(open);
    }
  }
  if (limited) return { ok: false, error: "too_many_links" };
  // ROW FIRST
  const checkoutId = uuidv7();
  const expiresAt = now + LINK_LIFETIME_MS;
  let inserted = 0;
  try {
    inserted = (
      await checkoutCreateStatement(db, {
        id: checkoutId,
        provider: "razorpay",
        documentId: a.documentId,
        clientId,
        source: a.actor.kind === "contact" ? "portal" : a.actor.kind === "token" ? "link" : "staff",
        contactId: linkContactId,
        docTokenId: a.actor.kind === "token" ? a.actor.tokenHash : null,
        createdBy: a.actor.kind === "staff" ? a.actor.memberId : null,
        amountMinor: a.amountMinor,
        floorMinor,
        maxMinor: null,
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
    // Something changed since the read (a payment landed, ten links were made meanwhile): say which, from a fresh count.
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
  const body = linkRequestOf({
    checkoutId,
    documentType: doc.type as "tax_invoice" | "proforma" | "debit_note",
    amountMinor: a.amountMinor,
    documentNumber: doc.number_display ?? "",
    documentId: a.documentId,
    expiresAt,
    callbackUrl,
    now,
  });
  if (!body.ok) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return { ok: false, error: "gateway_error" };
  }
  let link: RazorpayLink | null = null;
  const created = await api.createLink(body.body);
  if (created.ok) link = created.value;
  else if (created.code === "refused" || created.code === "network" || created.code === "bad_answer") {
    // "Reference already attempted" (Razorpay keeps references unique) or a lost answer: the link may exist. Adopt it when it does.
    const found = await api.findLinkByReference(checkoutId);
    if (found.ok && found.value) link = found.value;
  }
  // Early check 2, finding 13: the short URL is on Razorpay's own hosts before the row goes live, so no answer can send staff or a client elsewhere.
  if (!link?.shortUrl || !isRazorpayShortUrl(link.shortUrl)) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return {
      ok: false,
      error: created.ok
        ? "gateway_error"
        : created.code === "live_not_allowed"
          ? "live_not_allowed"
          : "gateway_error",
    };
  }
  const audit = auditStmt(
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
        ...(replacedCheckoutId ? { replacedCheckoutId } : {}),
      },
    },
    "changes",
  );
  const [live] = await db.batch([
    checkoutLiveStatement(db, {
      id: checkoutId,
      providerLinkId: link.providerRef,
      shortUrl: link.shortUrl,
      expiresAt: link.expiresAt ?? expiresAt,
      now,
    }),
    audit,
  ]);
  if (live?.meta.changes !== 1) return { ok: false, error: "gateway_error" };
  return {
    ok: true,
    url: link.shortUrl,
    expiresAt: link.expiresAt ?? expiresAt,
    reused: false,
    checkoutId,
  };
}

/** The portal's `createLink`: the session's contact or the emailed link's token, never both (checked by `isCreateLinkArgs` at the entrypoint). */
export function createLinkFor(env: GatewayEnv, args: CreateLinkArgs): Promise<MakeLinkResult> {
  return makeLink(env, {
    provider: args.provider,
    clientId: args.clientId,
    documentId: args.documentId,
    amountMinor: args.amountMinor,
    actor:
      args.contactId !== null
        ? { kind: "contact", contactId: args.contactId }
        : { kind: "token", tokenHash: args.tokenHash as string },
    returnTo: args.returnTo,
  });
}

/**
 * A checkout's status from its gateway, at most once a minute (`last_refresh_at` in the claim's WHERE), processed as a webhook would be (source `refresh`; ADR 0008
 * allows a status fetch). M6.3: a Stripe checkout goes through `refreshStripeCheckout` (the sweep's `GatewayEvents.refreshCheckout`, the portal's poll, the admin
 * refresh); Razorpay's below.
 */
export async function refreshCheckout(
  env: GatewayEnv,
  checkout: CheckoutRow,
  now = Date.now(),
): Promise<RefreshResult> {
  if (checkout.provider === "stripe") return { result: await refreshStripeCheckout(env, checkout, now) };
  const db = env.DB;
  if (!checkout.provider_link_id || (checkout.status !== "live" && checkout.status !== "stale"))
    return { result: "no_open_link" };
  const claim = await checkoutRefreshClaimStatement(db, { id: checkout.id, now }).run();
  if (claim.meta.changes !== 1) return { result: "too_soon" };
  const api = razorpayOf(env, await gatewayModeOf(db));
  if (!api) return { result: "retry" };
  const linkR = await api.fetchLink(checkout.provider_link_id);
  if (!linkR.ok) return { result: "retry" };
  const state = linkR.value.state;
  const cause = { kind: "refresh" } as const;
  if (state === "expired" || state === "cancelled") {
    const r = await endCheckout(env, { cause, checkout, status: state, now });
    return { result: r.result === "processed" ? "processed" : "unchanged" };
  }
  if (state !== "paid" && state !== "partially_paid") return { result: "unchanged" };
  const r = await settlePayment(
    env,
    { api, linkId: checkout.provider_link_id, paymentId: null, cause, now },
    staleCanceller(env, api, now),
  );
  // A proforma's payment recorded (or found) here still needs its tax invoice: queued like the webhook's (early check 2, finding 2).
  await sendNext(env, r.next);
  return {
    result:
      r.result === "processed" || r.result === "duplicate"
        ? "processed"
        : r.result === "needs_review"
          ? "needs_review"
          : r.result === "retry"
            ? "retry"
            : "unchanged",
  };
}

/**
 * M6.3 (L13; `GatewayEvents.refreshCheckout`, the hourly sweep's `gateway.refresh {checkoutId}`): one checkout by its id. The sweep reads only Stripe's live rows
 * past their expiry (`STALE_LIVE_CHECKOUTS_SQL`); any other row answers by its own state.
 */
export async function refreshCheckoutById(
  env: GatewayEnv,
  checkoutId: string,
  now = Date.now(),
): Promise<RefreshResult> {
  const c = await env.DB.prepare(`SELECT ${CHECKOUT_COLS} FROM checkout_sessions c WHERE c.id = ?1`)
    .bind(checkoutId)
    .first<CheckoutRow>();
  if (!c) return { result: "no_open_link" };
  return refreshCheckout(env, c, now);
}

/** The portal's `refreshForClient`: the document's newest open link, bound to the client of the session. */
export async function refreshForClient(
  env: GatewayEnv,
  a: { clientId: string; documentId: string },
  now = Date.now(),
): Promise<RefreshResult> {
  const c = await env.DB.prepare(
    `SELECT ${CHECKOUT_COLS}
       FROM checkout_sessions c INDEXED BY checkout_sessions_document WHERE c.document_id = ?1 AND c.client_id = ?2 AND c.status IN ('live', 'stale')
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
  )
    .bind(a.documentId, a.clientId)
    .first<CheckoutRow>();
  if (!c) return { result: "no_open_link" };
  return refreshCheckout(env, c, now);
}
