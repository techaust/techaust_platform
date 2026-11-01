// Stripe Checkout for the portal's "Pay by card" (M6.3; ADM-PAY-01, -07, -11, POR-06; run file C `PortalPayments.createLink`, L3, L4, L6, L7, L9). Called by
// `makeLink` once the shared rules have passed (`linkContext`: who may pay, the Stripe row of the rule table, the USD floor and maximum, no payment waiting). Then:
//   - the key guard, before any row or fetch: no transport or key, or an `sk_` key, is 503 `gateway_unavailable`; a key Settings or the go-live flag doesn't allow
//     is 503 `live_not_allowed` (CLAUDE.md rule 7; zero fetches);
//   - one open checkout per document (L4): the same amount with at least 20 minutes left is reused (its stored URL); any other is EXPIRED at Stripe first; Stripe
//     refusing because the session completed meanwhile settles it and answers 409 `payment_processing` ("no need to pay again", C4); already expired ends it;
//   - a `creating` row older than 60 seconds (its Worker died between the row and Stripe's answer) is ADOPTED by repeating the very same request with the same
//     `Idempotency-Key` (the row's id) and the same stored `expires_at`: Stripe answers with the same session (idempotency kept 24 hours); a younger one is 409
//     `link_in_progress`;
//   - ROW FIRST: the `creating` row (the unique index serialises two clicks), then `POST /v1/checkout/sessions` with `Idempotency-Key: <checkout id>`, then `live`
//     with the session id and its Checkout URL (on `checkout.stripe.com` only). A refusal fails the row (502 `gateway_error`); a session made but never stored
//     can't be paid (its URL never left this Worker), and its later events are ignored or reviewed (early check 1, "What B2 must not forget" 10).
// No `customer`, `customer_email` or Stripe invoice is ever asked for; the payer's card details are typed on Stripe's page only (ADM-PAY-12; Researched 2026-10-28,
// RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07); Settled by the lead on the safest reading, 2026-11-02 (08-C RB-41)).
import { uuidv7 } from "@techaust/core/ids";
import { SESSION_LIFETIME_MS, sessionRequestOf, stripeAllowed, stripeKeyModeOf } from "@techaust/core/stripe";
import {
  CLIENT_LINKS_SINCE_SQL,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutLiveStatement,
  LINKS_PER_CLIENT_HOUR,
} from "@techaust/db/gateway";
import { auditStmt } from "@techaust/db/log";
import { envText, portalUrlOf, stripeOf, transportOf } from "./config.ts";
import type { LinkContext, MakeLinkArgs, MakeLinkResult } from "./link-context.ts";
import type { CheckoutRow, GatewayEnv } from "./settle.ts";
import { isStripeCheckoutUrl, type StripeApi } from "./stripe.ts";
import { settleStripe } from "./stripe-settle.ts";

/** A `creating` row older than this is adopted (run file C.5). */
export const STRIPE_CREATING_ADOPT_MS = 60_000;
/** An open session is reused only while it has at least this long left (L4). */
export const STRIPE_REUSE_MIN_AHEAD_MS = 20 * 60_000;

/** C9 (07-ZM, owner-approved): the line item's name on Stripe's page, by document type. */
export function documentLabelOf(type: string, number: string): string {
  return type === "proforma"
    ? `Proforma invoice ${number}`
    : type === "debit_note"
      ? `Debit note ${number}`
      : `Invoice ${number}`;
}

/** C10 (07-ZM, owner-approved): the payment's description (Stripe's Dashboard; the export description, V15). */
export function descriptionOf(type: string, number: string): string {
  const kind = type === "proforma" ? "proforma invoice" : type === "debit_note" ? "debit note" : "invoice";
  return `TecHaust Technologies: software and IT services, ${kind} ${number}`;
}

/** The return pages (run file E): the signed-in invoice page, or the static page of an emailed link; never a token or a session id. */
export function returnUrlsOf(
  env: object,
  returnTo: "invoice" | "pay_return",
  documentId: string,
): { successUrl: string; cancelUrl: string } | null {
  const base = portalUrlOf(env);
  if (!base) return null;
  const page = returnTo === "invoice" ? `${base}invoices/${documentId}` : `${base}pay/return`;
  return { successUrl: `${page}?pay=return`, cancelUrl: `${page}?pay=cancel` };
}

/** The session request of a checkout row (the same body for a create and for its adoption: L4, Stripe refuses a key reused with other parameters). */
function requestOf(
  env: object,
  row: {
    id: string;
    documentId: string;
    amountMinor: number;
    expiresAt: number;
    returnTo: "invoice" | "pay_return";
  },
  doc: { type: string; number_display: string | null },
  now: number,
) {
  const urls = returnUrlsOf(env, row.returnTo, row.documentId);
  if (!urls) return null;
  const number = doc.number_display ?? "";
  return sessionRequestOf({
    checkoutId: row.id,
    documentId: row.documentId,
    env: envText(env, "ENVIRONMENT") ?? "",
    amountMinor: row.amountMinor,
    documentLabel: documentLabelOf(doc.type, number),
    description: descriptionOf(doc.type, number),
    expiresAt: row.expiresAt,
    ...urls,
    now,
  });
}

/** Stripe's flow, after the shared rules. Never throws for a refusal. */
export async function makeStripeLink(
  env: GatewayEnv,
  a: MakeLinkArgs,
  ctx: LinkContext,
  now: number,
): Promise<MakeLinkResult> {
  const db = env.DB;
  const { doc, clientId, open, limited, linkContactId, actorOf, floorMinor, maxMinor, mode } = ctx;
  // The key guard, before any row or fetch (L3, rule 7).
  const key = envText(env, "STRIPE_SECRET_KEY");
  if (transportOf(env, "stripe") === "unset" || !key || stripeKeyModeOf(key) === null)
    return { ok: false, error: "gateway_unavailable" };
  if (!stripeAllowed(key, mode, envText(env, "PAYMENTS_LIVE_ALLOWED")))
    return { ok: false, error: "live_not_allowed" };
  const api = stripeOf(env, mode) as StripeApi;
  if (!returnUrlsOf(env, a.returnTo, a.documentId)) return { ok: false, error: "gateway_unavailable" };
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
  /** Expire a live session at Stripe FIRST, so two sessions never take money for one document; a refusal is judged by the session's real state. */
  const expireOld = async (row: CheckoutRow): Promise<MakeLinkResult | null> => {
    if (!row.provider_link_id) {
      await endReplaced(row);
      return null;
    }
    const x = await api.expireSession(row.provider_link_id);
    if (x.ok) {
      await endReplaced(row);
      return null;
    }
    if (x.code === "live_not_allowed") return { ok: false, error: "live_not_allowed" };
    if (x.code !== "refused") return { ok: false, error: "gateway_error" };
    // Stripe refused: the session is complete or already expired. Its real state decides, through the same settle as the webhook (source `refresh`).
    const r = await settleStripe(env, {
      api,
      checkout: row,
      cause: { kind: "refresh" },
      now,
      env: envText(env, "ENVIRONMENT") ?? "",
      expectedLivemode: mode === "live" && envText(env, "PAYMENTS_LIVE_ALLOWED") === "true",
    });
    const back = await db
      .prepare("SELECT status FROM checkout_sessions WHERE id = ?1")
      .bind(row.id)
      .first<{ status: string }>();
    if (back?.status === "expired" || back?.status === "cancelled" || back?.status === "failed") {
      replacedCheckoutId = row.id;
      return null;
    }
    // Paid (recorded now or before), or still being settled: the client must not pay again.
    if (
      back?.status === "paid" ||
      r.result === "processed" ||
      r.result === "duplicate" ||
      r.result === "needs_review"
    )
      return { ok: false, error: "payment_processing" };
    return { ok: false, error: "gateway_error" };
  };
  if (open) {
    if (open.provider !== "stripe") return { ok: false, error: "link_in_progress" };
    if (open.status === "creating") {
      if (now - open.created_at < STRIPE_CREATING_ADOPT_MS) return { ok: false, error: "link_in_progress" };
      // C.5: adopt by repeating the very same request (same key, same stored expiry, the row's own amount and return page).
      const body = requestOf(
        env,
        {
          id: open.id,
          documentId: open.document_id,
          amountMinor: open.amount_minor,
          expiresAt: open.expires_at,
          returnTo: open.source === "portal" ? "invoice" : "pay_return",
        },
        doc,
        now,
      );
      const made = body?.ok ? await api.createSession(body.pairs, open.id) : null;
      const adopted =
        made?.ok &&
        (
          await checkoutLiveStatement(db, {
            id: open.id,
            providerLinkId: made.value.id,
            shortUrl: made.value.url,
            expiresAt: made.value.expiresAt,
            now,
          }).run()
        ).meta.changes === 1;
      if (!adopted || !made?.ok) await checkoutFailStatement(db, { id: open.id, now }).run();
      else if (open.amount_minor === a.amountMinor && made.value.expiresAt > now + STRIPE_REUSE_MIN_AHEAD_MS)
        return {
          ok: true,
          url: made.value.url,
          expiresAt: made.value.expiresAt,
          reused: true,
          checkoutId: open.id,
        };
      else {
        if (limited) return { ok: false, error: "too_many_links" };
        const refused = await expireOld({ ...open, status: "live", provider_link_id: made.value.id });
        if (refused) return refused;
      }
    } else if (open.status === "live") {
      if (
        open.amount_minor === a.amountMinor &&
        open.short_url &&
        open.expires_at > now + STRIPE_REUSE_MIN_AHEAD_MS
      )
        return {
          ok: true,
          url: open.short_url,
          expiresAt: open.expires_at,
          reused: true,
          checkoutId: open.id,
        };
      if (limited) return { ok: false, error: "too_many_links" };
      const refused = await expireOld(open);
      if (refused) return refused;
    }
  }
  if (limited) return { ok: false, error: "too_many_links" };
  // ROW FIRST
  const checkoutId = uuidv7();
  const expiresAt = now + SESSION_LIFETIME_MS;
  let inserted = 0;
  try {
    inserted = (
      await checkoutCreateStatement(db, {
        id: checkoutId,
        provider: "stripe",
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
  const body = requestOf(
    env,
    { id: checkoutId, documentId: a.documentId, amountMinor: a.amountMinor, expiresAt, returnTo: a.returnTo },
    doc,
    now,
  );
  if (!body?.ok) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return { ok: false, error: "gateway_error" };
  }
  const created = await api.createSession(body.pairs, checkoutId);
  // The Checkout URL is on Stripe's own host before the row goes live, so no answer can send a client elsewhere.
  if (!created.ok || !isStripeCheckoutUrl(created.value.url)) {
    await checkoutFailStatement(db, { id: checkoutId, now }).run();
    return {
      ok: false,
      error: !created.ok && created.code === "live_not_allowed" ? "live_not_allowed" : "gateway_error",
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
        provider: "stripe",
        ...(replacedCheckoutId ? { replacedCheckoutId } : {}),
      },
    },
    "changes",
  );
  const [live] = await db.batch([
    checkoutLiveStatement(db, {
      id: checkoutId,
      providerLinkId: created.value.id,
      shortUrl: created.value.url,
      expiresAt: created.value.expiresAt,
      now,
    }),
    audit,
  ]);
  if (live?.meta.changes !== 1) return { ok: false, error: "gateway_error" };
  return { ok: true, url: created.value.url, expiresAt: created.value.expiresAt, reused: false, checkoutId };
}
