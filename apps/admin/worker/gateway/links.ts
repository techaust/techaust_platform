// Payment links (M6.2; ADM-PAY-02, POR-06; run file C `PortalPayments` and the staff routes, L2 to L4, L10, L12): make one, reuse one, cancel one, and refresh one's
// status. The portal calls `createLink` / `refreshForClient` over the `ADMIN_PAY` binding; the admin routes call the same functions with a member. Every rule is
// re-checked here in SQL from the ids alone (the caller is trusted for nothing but the ids): the contact or the emailed link may pay this document, the document is
// payable online, the amount is within the bounds (core `payAmountVerdict`, the floor from Settings › Payment terms). ROW FIRST: the `creating` checkout is written
// before Razorpay is called (two clicks serialise on `checkout_sessions_open`), then the link, then `live`. Razorpay is never asked for an SMS, an email, a
// reminder or a customer (L10). The live guard answers before any fetch.
import type { CreateLinkArgs, CreateLinkResult, RefreshResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { payAmountVerdict, payableOnline } from "@techaust/core/online-pay";
import {
  isRazorpayShortUrl,
  LINK_LIFETIME_MS,
  linkRequestOf,
  type RazorpayLink,
  razorpayAllowed,
} from "@techaust/core/razorpay";
import {
  CLIENT_LINKS_SINCE_SQL,
  checkoutCreateStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutLiveStatement,
  checkoutRefreshClaimStatement,
  LINKS_PER_CLIENT_HOUR,
  OPEN_CHECKOUT_SQL,
} from "@techaust/db/gateway";
import { auditStmt, type RequestInfo } from "@techaust/db/log";
import { cachedSetting } from "../settings-cache.ts";
import { envText, gatewayModeOf, portalUrlOf, razorpayOf, transportOf } from "./config.ts";
import { sendNext, staleCanceller } from "./events.ts";
import type { RazorpayApi } from "./razorpay.ts";
import { type CheckoutRow, DOC_STATE_SQL, endCheckout, type GatewayEnv, settlePayment } from "./settle.ts";

/** A `creating` row older than this is taken as abandoned (its Worker died between the row and Razorpay's answer; "For B2" 4). */
export const CREATING_ABANDONED_MS = 2 * 60_000;
/** An open link is reused only while it lives at least this much longer. */
export const REUSE_MIN_AHEAD_MS = 3_600_000;

type DocRow = {
  id: string;
  client_id: string;
  type: string;
  status: string;
  frozen_at: number | null;
  currency: string;
  balance_minor: number;
  number_display: string | null;
  updated_at: number;
  withdrawn: number;
  anonymised_at: number | null;
  country: string;
  gst_status: string;
};

const DOC_SQL = DOC_STATE_SQL.replace("SELECT d.type,", "SELECT d.id, d.client_id, d.updated_at, d.type,");
const CONTACT_OK_SQL =
  "SELECT id FROM contacts WHERE id = ?1 AND client_id = ?2 AND portal_access = 1 AND can_see_finance = 1 AND anonymised_at IS NULL";
/** The emailed link's live, unrevoked token for this document and client, bound to its live contact whose address still matches: the contact's id. */
const TOKEN_CONTACT_SQL = `SELECT c.id FROM doc_access_tokens t JOIN contacts c ON c.id = t.contact_id AND c.client_id = t.client_id
   WHERE t.token_hash = ?1 AND t.document_id = ?2 AND t.client_id = ?3 AND t.purpose = 'view_pay' AND t.revoked_at IS NULL AND t.expires_at > ?4
     AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND lower(c.email) = t.email`;
const TERMS_SQL = "SELECT value, version FROM settings WHERE key = 'payment_terms'";

export type LinkActor =
  | { kind: "contact"; contactId: string }
  | { kind: "token"; tokenHash: string }
  | { kind: "staff"; memberId: string; role: "owner" | "staff" };

export type MakeLinkArgs = {
  provider: "razorpay";
  clientId: string | null;
  documentId: string;
  amountMinor: number;
  actor: LinkActor;
  returnTo: "invoice" | "pay_return";
  /** The staff route's stale check (`expectedUpdatedAt` of the document as the member saw it). */
  expectedUpdatedAt?: number;
  request?: RequestInfo;
};

export type MakeLinkResult =
  | (CreateLinkResult & { ok: true; checkoutId: string })
  | (Extract<CreateLinkResult, { ok: false }> & { stale?: boolean });

const NO_REQUEST: RequestInfo = { requestId: null, ip: null, ua: null };

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

/** Make (or reuse) a payment link. Never throws for a refusal: the answer names it (the portal and the route map it to their status). */
export async function makeLink(env: GatewayEnv, a: MakeLinkArgs, now = Date.now()): Promise<MakeLinkResult> {
  const db = env.DB;
  const ofDoc = (r: D1Result | undefined) => r?.results[0] as DocRow | undefined;
  const actorRead =
    a.actor.kind === "contact"
      ? db.prepare(CONTACT_OK_SQL).bind(a.actor.contactId, a.clientId ?? "")
      : a.actor.kind === "token"
        ? db.prepare(TOKEN_CONTACT_SQL).bind(a.actor.tokenHash, a.documentId, a.clientId ?? "", now)
        : db
            .prepare(
              "SELECT id FROM staff_users WHERE id = ?1 AND status = 'active' AND role IN ('owner', 'staff')",
            )
            .bind(a.actor.memberId);
  const [docR, actorR, openR, termsR, linksR, modeR] = await db.batch([
    db.prepare(DOC_SQL).bind(a.documentId),
    actorRead,
    db.prepare(OPEN_CHECKOUT_SQL).bind(a.documentId),
    db.prepare(TERMS_SQL),
    db.prepare(CLIENT_LINKS_SINCE_SQL).bind(a.clientId ?? "", now - 3_600_000),
    db.prepare("SELECT value, version FROM settings WHERE key = 'gateways'"),
  ]);
  const doc = ofDoc(docR);
  // Another client's document, an unknown id, a contact or link that may not pay it: the same 404 as a thing that is not there.
  if (!doc || (a.clientId !== null && doc.client_id !== a.clientId)) return { ok: false, error: "not_found" };
  const clientId = doc.client_id;
  const actorRow = actorR?.results[0] as { id: string } | undefined;
  if (!actorRow) return { ok: false, error: "not_found" };
  if (doc.anonymised_at !== null) return { ok: false, error: "client_gone" };
  if (a.expectedUpdatedAt !== undefined && doc.updated_at !== a.expectedUpdatedAt)
    return { ok: false, error: "not_found", stale: true };
  const payable = payableOnline(
    {
      type: doc.type,
      currency: doc.currency,
      frozen: doc.frozen_at !== null,
      status: doc.status,
      withdrawn: doc.withdrawn === 1,
      balanceMinor: doc.balance_minor,
    },
    { country: doc.country, gstStatus: doc.gst_status, anonymised: false },
  );
  if (!payable.ok) return { ok: false, error: "not_payable_online", reason: payable.reason };
  const terms = termsR?.results[0] as { value: string; version: number } | undefined;
  const floorMinor = cachedSetting("payment_terms", terms).razorpayMinPartialInrMinor;
  const verdict = payAmountVerdict({
    amountMinor: a.amountMinor,
    balanceMinor: doc.balance_minor,
    floorMinor,
    wholeRupees: doc.type === "proforma",
  });
  if (!verdict.ok)
    return verdict.code === "amount_below_minimum"
      ? { ok: false, error: verdict.code, minimumMinor: verdict.minimumMinor }
      : verdict.code === "amount_above_balance"
        ? { ok: false, error: verdict.code, balanceMinor: verdict.balanceMinor }
        : { ok: false, error: verdict.code };
  // The gateway itself: a transport, keys, and the live guard, all before any row or fetch.
  const mode = cachedSetting(
    "gateways",
    (modeR?.results[0] as { value: string; version: number } | undefined) ?? undefined,
  ).razorpay.mode;
  if (
    transportOf(env) === "unset" ||
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
  const made = (linksR?.results[0] as { n: number } | undefined)?.n ?? 0;
  const limited = made >= LINKS_PER_CLIENT_HOUR;
  const open = openR?.results[0] as CheckoutRow | undefined;
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
            shortUrl: back.short_url,
            expiresAt: back.expires_at,
            reused: true,
            checkoutId: back.id,
          };
        if (limited) return { ok: false, error: "too_many_links" };
        if (back?.status === "live" && back.provider_link_id) {
          const c = await api.cancelLink(back.provider_link_id);
          if (!c.ok) return { ok: false, error: "gateway_error" };
          await checkoutEndStatement(db, { id: back.id, status: "cancelled", now }).run();
        }
      } else {
        await checkoutFailStatement(db, { id: open.id, now }).run();
      }
    } else if (open.status === "live") {
      if (open.amount_minor === a.amountMinor && open.short_url && open.expires_at > now + REUSE_MIN_AHEAD_MS)
        return {
          ok: true,
          shortUrl: open.short_url,
          expiresAt: open.expires_at,
          reused: true,
          checkoutId: open.id,
        };
      // A new amount (or a link about to expire): the old one is cancelled at Razorpay FIRST, so two links never take money for the same document.
      if (limited) return { ok: false, error: "too_many_links" };
      if (open.provider_link_id) {
        const c = await api.cancelLink(open.provider_link_id);
        if (!c.ok) return { ok: false, error: "gateway_error" };
      }
      await checkoutEndStatement(db, { id: open.id, status: "cancelled", now }).run();
    }
  }
  if (limited) return { ok: false, error: "too_many_links" };
  // ROW FIRST
  const checkoutId = uuidv7();
  const expiresAt = now + LINK_LIFETIME_MS;
  const linkContactId =
    a.actor.kind === "staff" ? null : a.actor.kind === "contact" ? a.actor.contactId : actorRow.id;
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
      ...(a.request ?? NO_REQUEST),
      actorType: a.actor.kind === "staff" ? "staff" : "contact",
      actorId: a.actor.kind === "staff" ? a.actor.memberId : linkContactId,
      role: a.actor.kind === "staff" ? a.actor.role : null,
      action: "payment.link_create",
      entityType: "checkout_session",
      entityId: checkoutId,
      summary: { checkoutId, documentId: a.documentId, amountMinor: a.amountMinor, source: a.actor.kind },
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
    shortUrl: link.shortUrl,
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

/** A checkout's status from Razorpay, at most once a minute (`last_refresh_at` in the claim's WHERE), processed as a webhook would be (source `refresh`; ADR 0008 allows a status fetch). */
export async function refreshCheckout(
  env: GatewayEnv,
  checkout: CheckoutRow,
  now = Date.now(),
): Promise<RefreshResult> {
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

/** The portal's `refreshForClient`: the document's newest open link, bound to the client of the session. */
export async function refreshForClient(
  env: GatewayEnv,
  a: { clientId: string; documentId: string },
  now = Date.now(),
): Promise<RefreshResult> {
  const c = await env.DB.prepare(
    `SELECT c.id, c.provider, c.document_id, c.client_id, c.contact_id, c.source, c.currency, c.amount_minor, c.status, c.provider_link_id, c.short_url, c.expires_at,
         c.created_at, c.updated_at, c.last_refresh_at, c.paid_payment_id
       FROM checkout_sessions c INDEXED BY checkout_sessions_document WHERE c.document_id = ?1 AND c.client_id = ?2 AND c.status IN ('live', 'stale')
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
  )
    .bind(a.documentId, a.clientId)
    .first<CheckoutRow>();
  if (!c) return { result: "no_open_link" };
  return refreshCheckout(env, c, now);
}
