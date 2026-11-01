// Settling a Stripe Checkout payment (M6.3; ADM-PAY-01, -03, -06, -07, ADM-INV-10, -17, JOB-HOOK-02; run file docs/runs/m6.3-stripe.md C). One function serves the
// webhook (`GatewayEvents.processEvent` for a `stripe` row), the hourly sweep's `refreshCheckout`, the portal's status refresh and the Owner's "Try again":
// whatever brought the news, the session is RE-FETCHED from Stripe's API with its payment intent, latest charge and balance transaction expanded (ADR 0008: a
// webhook alone proves nothing; nothing is ever marked paid on a redirect), judged against our checkout row (core `judgeStripeSession`), then written in ONE batch:
//   - an export invoice or debit note, matching and still payable: the payment confirmed (no Owner step) and put on the document, any excess held as credit with an
//     `overpaid` item (Settled by the lead on the safest reading, 2026-10-31 (08-C RA-36)); the checkout paid, the document's other sessions stale and expired at
//     Stripe after the batch; T11's deed statements after the recompute; the owners' bell;
//   - a USD proforma within its balance: the payment PENDING with its requested allocation and an `advance_blocked` item `fx_rate_needed` (owner, 2026-11-01, Q1 A:
//     the Owner issues the tax invoice for the money received with the RBI or FBIL rate of the day it arrived; Researched 2026-10-28, Rule 34 CGST Rules (08-C
//     RA-21)); never `gateway.advance`, never the system's `gateway_auto` (Razorpay only, in SQL and in the 0066 trigger);
//   - a card issued in India (or of no stated country): pending with a `not_export_receipt` item, never confirmed by the system (Settled by the lead on the safest
//     reading, 2026-11-02 (08-C RA-38));
//   - any other mismatch for a client we know: pending (no ledger move) with a review item of its kind; an erased client: the item only; money refunded or disputed
//     after it succeeded, or never captured: the item only (early check 1, F1); a session not exactly ours: the item only (L5).
// Only Stripe's word ends a row (L6): an expired session is ended when Stripe says `expired`, never on our clock. `received_on` is the IST day of the charge (Settled
// by the lead on the safest reading, 2026-11-01 (08-C RA-37)). Nothing about the payer is stored: ids, amounts, states and the INR settlement facts only (Settled by
// the lead on the safest reading, 2026-11-02 (08-C RB-41)); the INR fee is absorbed, shown only (OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our
// GSTIN?).
import type { ProcessEventResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { payableOnline } from "@techaust/core/online-pay";
import {
  inrFactsOf,
  judgeStripeSession,
  receivedOnOf,
  STRIPE_EVENT_TYPES,
  type StripeSession,
  stripeModeOf,
  stripePaymentRowId,
  stripeReferenceNorm,
} from "@techaust/core/stripe";
import { deedDraftStatements } from "@techaust/db/deeds";
import {
  CHECKOUT_BY_ID_SQL,
  CHECKOUT_BY_LINK_SQL,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutRefreshClaimStatement,
  type GatewayFacts,
  type GatewayPaymentArgs,
  recordGatewayPaymentStatements,
  reviewBellStatement,
  reviewItemStatement,
  webhookEventMoveStatement,
} from "@techaust/db/gateway";
import { type GuardSql, guardSql } from "@techaust/db/log";
import { mutateSystem } from "../system.ts";
import { envText, stripeModeOfSettings, stripeOf } from "./config.ts";
import {
  advanceBlockersText,
  bellNeedsReview,
  bellPaidByCard,
  type ReasonFacts,
  reviewReason,
} from "./messages.ts";
import {
  type CheckoutRow,
  DOC_STATE_SQL,
  endCheckout,
  type GatewayEnv,
  REVIEW_LINK,
  reviewFactsOf,
  reviewOnly,
  type SettleCause,
  type SettleResult,
} from "./settle.ts";
import type { StripeApi, StripeFailure } from "./stripe.ts";

const STRIPE = { provider: "stripe", currency: "USD" } as const;
/** A session Stripe still holds `open` after a "paid" event is asked again at most this many times, then the Owner reviews it (run file C.9). */
export const OPEN_RETRIES = 3;

type DocState = {
  type: string;
  status: string;
  frozen_at: number | null;
  currency: string;
  balance_minor: number;
  number_display: string | null;
  withdrawn: number;
  display_name: string;
  anonymised_at: number | null;
  country: string;
  gst_status: string;
};

/** The payment row of a Stripe payment intent we already hold. */
const SEEN_SQL =
  "SELECT p.id FROM payments p INDEXED BY payments_provider_ref WHERE p.provider = 'stripe' AND p.provider_payment_id = ?1";
const OTHER_LIVE_SQL =
  "SELECT id, provider_link_id FROM checkout_sessions INDEXED BY checkout_sessions_document WHERE document_id = ?1 AND id <> ?2 AND status = 'live' LIMIT 5";

const eventIdOf = (cause: SettleCause) => (cause.kind === "event" ? cause.eventId : null);
const sourceOf = (cause: SettleCause): "webhook" | "refresh" =>
  cause.kind === "event" ? "webhook" : "refresh";
const actorOf = (cause: SettleCause): "webhook" | "system" => (cause.kind === "event" ? "webhook" : "system");

export type StripeSettleArgs = {
  api: StripeApi;
  checkout: CheckoutRow;
  cause: SettleCause;
  now: number;
  /** This Worker's `ENVIRONMENT` (the session's `techaust_env` must match: L5). */
  env: string;
  /** The mode Stripe's answer must be in: live only once Settings and the go-live flag both say so (CLAUDE.md rule 7). */
  expectedLivemode: boolean;
  /** How many times the event was tried (the webhook row's `attempts`); 0 for a refresh. */
  attempts?: number;
};

/** The whitelisted facts of a session (RB-40, RB-41): ids, the amount and currency, our checkout. Never a payer's detail. */
function factsOf(checkout: CheckoutRow, s: StripeSession | null): GatewayFacts {
  return {
    linkId: checkout.provider_link_id ?? "",
    checkoutId: checkout.id,
    ...(s?.pi ? { paymentId: s.pi.id, amountMinor: s.pi.amountReceived, currency: "USD" } : {}),
    ...(s?.charge?.methodType ? { method: s.charge.methodType } : {}),
  };
}

/** The event moves without a payment row, in its own statement. */
async function moveEvent(
  env: GatewayEnv,
  cause: SettleCause,
  now: number,
  status: "processed" | "ignored" | "needs_review",
  outcome: string,
): Promise<void> {
  const eventId = eventIdOf(cause);
  if (eventId) await webhookEventMoveStatement(env.DB, { id: eventId, status, outcome, now }).run();
}

/** The payment row's fields from the re-fetched session (its intent and charge exist: the judge passed `not_captured`). */
async function paymentFields(s: StripeSession) {
  const pi = s.pi as NonNullable<StripeSession["pi"]>;
  const charge = s.charge as NonNullable<StripeSession["charge"]>;
  const inr = inrFactsOf(s.bt);
  return {
    providerPaymentId: pi.id,
    paymentId: stripePaymentRowId(pi.id),
    amountMinor: pi.amountReceived,
    feeMinor: 0,
    feeTaxMinor: null,
    receivedOn: receivedOnOf(charge.created),
    mode: stripeModeOf(charge.methodType),
    referenceNorm: (await stripeReferenceNorm(pi.id)) ?? "",
    inrReceivedMinor: inr.inrReceivedMinor,
    gatewayFeeInrMinor: inr.gatewayFeeInrMinor,
    gatewayFeeTaxInrMinor: inr.gatewayFeeTaxInrMinor,
  };
}

type Fields = Awaited<ReturnType<typeof paymentFields>>;

/**
 * The money recorded PENDING (no ledger move) with a review item of `kind`, in one batch; the checkout moves to `paid` in the same batch while it is still live or
 * stale (the money was paid through this very session), and the payment row is written either way. A batch refused because a concurrent settle already holds this
 * payment answers `duplicate`; else `retry`.
 */
async function recordPending(
  env: GatewayEnv,
  a: StripeSettleArgs,
  f: Fields,
  kind: string,
  reasonFacts: ReasonFacts,
  facts: GatewayFacts,
  /** A proforma's payment (Q1 A): its requested allocation, the checkout paid, the event processed, and the owners' "paid by card" bell with this title. */
  extra?: { requested: true; bellTitle: string },
): Promise<SettleResult> {
  const auditId = uuidv7();
  const eventId = eventIdOf(a.cause);
  const c = a.checkout;
  const s = recordGatewayPaymentStatements(
    env.DB,
    {
      provider: "stripe",
      ...f,
      checkoutId: c.id,
      clientId: c.client_id,
      documentId: c.document_id,
      webhookEventId: eventId,
      source: sourceOf(a.cause),
      status: "pending_verification",
      refetchedAt: a.now,
      now: a.now,
      allocate: null,
      requestedAllocations: extra?.requested
        ? [{ documentId: c.document_id, amountMinor: f.amountMinor }]
        : null,
      checkoutPaid: extra?.requested ? true : "if_open",
      staleOthers: false,
      event: eventId
        ? {
            status: extra?.requested ? "processed" : "needs_review",
            outcome: extra?.requested ? "proforma_pending" : kind,
          }
        : null,
      bell: extra
        ? { kind: "payment.online", title: extra.bellTitle, link: `/invoices/${c.document_id}` }
        : null,
    } satisfies GatewayPaymentArgs,
    guardSql({ auditId }),
  );
  const reviewId = uuidv7();
  const words = { ...reasonFacts, provider: "stripe", currency: "USD" } as const;
  const done = await mutateSystem(env, {
    auditId,
    actorType: actorOf(a.cause),
    main: s.main,
    action: "payment.gateway_pending",
    entityType: "payment",
    entityId: f.paymentId,
    summary: {
      paymentId: f.paymentId,
      checkoutId: c.id,
      documentId: c.document_id,
      kind,
      amountMinor: f.amountMinor,
    },
    side: () => [
      ...s.side,
      reviewItemStatement(
        env.DB,
        {
          id: reviewId,
          source: sourceOf(a.cause),
          provider: "stripe",
          kind,
          webhookEventId: eventId,
          paymentId: f.paymentId,
          documentId: c.document_id,
          clientId: c.client_id,
          amountMinor: f.amountMinor,
          currency: "USD",
          // The proforma's item names its blocker code (`fx_rate_needed`, S16), as the screen and "Try again" read it.
          facts: reviewFactsOf(
            kind === "advance_blocked" ? { ...facts, blocker: "fx_rate_needed" } : facts,
            reasonFacts,
          ),
          now: a.now,
        },
        s.guard,
      ),
      reviewBellStatement(
        env.DB,
        { reviewId, title: bellNeedsReview(reviewReason(kind, words)), link: REVIEW_LINK },
        s.guard,
      ),
      ...s.last,
    ],
  });
  if (done) return extra?.requested ? { result: "processed" } : { result: "needs_review" };
  const seen = await env.DB.prepare(SEEN_SQL).bind(f.providerPaymentId).first<{ id: string }>();
  if (seen) {
    await moveEvent(env, a.cause, a.now, "processed", "duplicate");
    return { result: "duplicate" };
  }
  return { result: "retry" };
}

/** The outcome of a settle that the refresh maps to its own words: Stripe still holds the session open, or an asynchronous payment is still on its way. */
export type StripeSettleResult = SettleResult & { readonly stillOpen?: true };

/** Re-fetch, judge and record one Stripe Checkout session (run file C steps 6 to 9). */
export async function settleStripe(env: GatewayEnv, a: StripeSettleArgs): Promise<StripeSettleResult> {
  const db = env.DB;
  const c = a.checkout;
  const where = { documentId: c.document_id, clientId: c.client_id, amountMinor: null };
  const link = { cause: a.cause, now: a.now, linkId: c.provider_link_id };
  if (!c.provider_link_id) return reviewOnly(env, link, "refetch_failed", where, factsOf(c, null), STRIPE);
  // (6) the session from Stripe's API, never the webhook's copy; the key guard runs inside the client, before any fetch
  const r = await a.api.fetchSession(c.provider_link_id);
  if (!r.ok) return fetchFailed(env, a, r.code);
  const s = r.value;
  const facts = factsOf(c, s);
  // The same payment intent again (a duplicate delivery, a replay under a new event id, a refresh after the webhook): the event is processed, nothing else.
  if (s.pi) {
    const seen = await db.prepare(SEEN_SQL).bind(s.pi.id).first<{ id: string }>();
    if (seen) {
      await moveEvent(env, a.cause, a.now, "processed", "duplicate");
      return { result: "duplicate" };
    }
  }
  const verdict = judgeStripeSession(
    {
      id: c.id,
      documentId: c.document_id,
      providerLinkId: c.provider_link_id,
      currency: c.currency,
      amountMinor: c.amount_minor,
      env: a.env,
    },
    s,
    a.expectedLivemode,
  );
  if (!verdict.ok) {
    switch (verdict.verdict) {
      case "checkout_expired":
        return endCheckout(env, { cause: a.cause, checkout: c, status: "expired", now: a.now });
      case "checkout_open":
        if (a.cause.kind === "event" && (a.attempts ?? 0) >= OPEN_RETRIES)
          return reviewOnly(
            env,
            link,
            "refetch_failed",
            where,
            { ...facts, reason: "checkout_open" },
            STRIPE,
          );
        return { result: "retry", stillOpen: true };
      case "not_paid":
        // An asynchronous payment still on its way: nothing is recorded; its own event (succeeded or failed) follows.
        await moveEvent(env, a.cause, a.now, "processed", "awaiting_async");
        return { result: "processed", stillOpen: true };
      case "livemode_mismatch":
      case "reference_mismatch":
      case "currency_mismatch":
        // Not exactly our session, or not our currency: no payment row (L5); the Owner reviews it.
        return reviewOnly(env, link, verdict.verdict, where, facts, STRIPE);
      case "not_captured":
        // Never captured, or refunded or disputed after it succeeded (F1): no money for us to record.
        return reviewOnly(
          env,
          link,
          "not_captured",
          { ...where, amountMinor: s.pi && s.pi.amountReceived > 0 ? s.pi.amountReceived : null },
          facts,
          STRIPE,
        );
      default:
        break;
    }
  }
  const doc = await db.prepare(DOC_STATE_SQL).bind(c.document_id).first<DocState>();
  const f = await paymentFields(s);
  // (9) an erased client: the review item only, never a payment row
  if (!doc || doc.anonymised_at !== null)
    return reviewOnly(env, link, "client_gone", { ...where, amountMinor: f.amountMinor }, facts, STRIPE);
  // A payment intent with nothing received cannot be a row (the amount CHECK): the item only.
  if (f.amountMinor <= 0) return reviewOnly(env, link, "amount_mismatch", where, facts, STRIPE);
  const pending = (kind: string, rf: ReasonFacts) => recordPending(env, a, f, kind, rf, facts);
  if (!verdict.ok)
    return pending(verdict.verdict, { paidMinor: f.amountMinor, expectedMinor: c.amount_minor });
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
    "stripe",
  );
  if (!payable.ok) return pending("document_not_payable", { reason: payable.reason });
  // (8) a USD proforma: pending with its request and the Owner's `fx_rate_needed` item (Q1 A); above its balance the Owner issues by hand
  if (doc.type === "proforma") {
    if (f.amountMinor > doc.balance_minor) return pending("proforma_overpaid", {});
    const done = await recordPending(
      env,
      a,
      f,
      "advance_blocked",
      { blocker: advanceBlockersText(["fx_rate_needed"]) },
      facts,
      { requested: true, bellTitle: bellPaidByCard(doc.display_name, f.amountMinor, doc.number_display) },
    );
    // The session ended or the proforma changed between the read and the batch: the money is still recorded, for the Owner (M6.2 "For B2" 3).
    if (done.result === "retry") return pending("document_not_payable", { reason: "link_not_live" });
    return done;
  }
  // (7) an export invoice or debit note: confirmed and put on the document, in one batch
  const others = (
    await db
      .prepare(OTHER_LIVE_SQL)
      .bind(c.document_id, c.id)
      .all<{ id: string; provider_link_id: string | null }>()
  ).results;
  const auditId = uuidv7();
  const eventId = eventIdOf(a.cause);
  const st = recordGatewayPaymentStatements(
    db,
    {
      provider: "stripe",
      ...f,
      checkoutId: c.id,
      clientId: c.client_id,
      documentId: c.document_id,
      webhookEventId: eventId,
      source: sourceOf(a.cause),
      status: "confirmed",
      refetchedAt: a.now,
      now: a.now,
      allocate: { allocationId: uuidv7(), overpaidReviewId: uuidv7(), facts },
      requestedAllocations: null,
      checkoutPaid: true,
      staleOthers: true,
      event: eventId ? { status: "processed", outcome: "confirmed" } : null,
      bell: {
        kind: "payment.online",
        title: bellPaidByCard(doc.display_name, f.amountMinor, doc.number_display),
        link: `/invoices/${c.document_id}`,
      },
    } satisfies GatewayPaymentArgs,
    guardSql({ auditId }),
  );
  let done = false;
  try {
    done = await mutateSystem(env, {
      auditId,
      actorType: actorOf(a.cause),
      main: st.main,
      action: "payment.gateway_confirm",
      entityType: "payment",
      entityId: f.paymentId,
      summary: {
        paymentId: f.paymentId,
        checkoutId: c.id,
        documentId: c.document_id,
        amountMinor: f.amountMinor,
      },
      // T11 (L3; 08-C RB-38(a)): the deed's draft after the recompute, guarded on this batch's payment row, before `ledger_result`.
      side: () => [
        ...st.side,
        ...deedDraftStatements(db, { target: { documentIds: [c.document_id] }, now: a.now }, st.guard),
        ...st.last,
      ],
    });
  } catch (e) {
    // A ledger post-condition refused the batch (a credit note landed meanwhile): nothing was written; the money goes to the Owner below.
    if (
      !/ledger_result_check|payment_allocations_|payments_|documents_ledger/.test(
        String(e) + String((e as Error)?.cause ?? ""),
      )
    )
      throw e;
  }
  if (!done) {
    // The session ended, the invoice was voided or changed, or a concurrent settle won: never drop the money (M6.2 "For B2" 3).
    const seen = await db.prepare(SEEN_SQL).bind(f.providerPaymentId).first<{ id: string }>();
    if (seen) {
      await moveEvent(env, a.cause, a.now, "processed", "duplicate");
      return { result: "duplicate" };
    }
    return pending("document_not_payable", { reason: "changed" });
  }
  // After the batch, best effort: the document's other open sessions are expired at Stripe; a success moves each to `cancelled` (L4, L6).
  for (const o of others) {
    if (!o.provider_link_id) continue;
    const x = await a.api.expireSession(o.provider_link_id);
    if (x.ok) await checkoutEndStatement(db, { id: o.id, status: "cancelled", now: a.now }).run();
    else console.log(JSON.stringify({ ev: "gw", m: "stale_expire_failed", code: x.code }));
  }
  return { result: "processed" };
}

/** A failed re-fetch: retry while Stripe can't be reached or the key isn't set yet; a refused key (401/403) is the Owner's, with a bell; anything else is reviewed. */
function fetchFailed(
  env: GatewayEnv,
  a: StripeSettleArgs,
  code: StripeFailure,
): Promise<ProcessEventResult> | ProcessEventResult {
  const c = a.checkout;
  if (code === "network" || code === "unconfigured") return { result: "retry" };
  const where = { documentId: c.document_id, clientId: c.client_id, amountMinor: null };
  const link = { cause: a.cause, now: a.now, linkId: c.provider_link_id };
  if (code === "forbidden")
    return reviewOnly(
      env,
      link,
      "refetch_failed",
      where,
      { ...factsOf(c, null), reason: "stripe_permission" },
      {
        ...STRIPE,
        outcome: "stripe_permission",
      },
    );
  return reviewOnly(env, link, "refetch_failed", where, factsOf(c, null), STRIPE);
}

// ---- entry points --------------------------------------------------------------------------------------------------------------------------------------------

type EventRow = { id: string; provider: string; event_type: string; attempts: number; facts: string | null };

const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);

/** Whether Stripe's answers must be live: Settings says live AND the go-live flag is exactly true (else test). */
const expectedLivemodeOf = (env: object, mode: "test" | "live") =>
  mode === "live" && envText(env, "PAYMENTS_LIVE_ALLOWED") === "true";

/**
 * One stored, verified Stripe event (run file C steps 1 to 5; the caller already counted the try and found it `received`). The hook writes rows for TecHaust's
 * events only; a row with no `techaust_checkout_id` is ignored (`not_techaust`, defence in depth). Our checkout is found by the session id; with none, metadata
 * alone never moves money (L5): a paid orphan is an `unknown_link` item, an expired or failed one is ignored.
 */
export async function processStripeEvent(
  env: GatewayEnv,
  row: EventRow,
  now: number,
): Promise<ProcessEventResult> {
  const db = env.DB;
  let facts: Record<string, unknown> = {};
  try {
    const v = JSON.parse(row.facts ?? "{}") as unknown;
    if (typeof v === "object" && v !== null) facts = v as Record<string, unknown>;
  } catch {
    facts = {};
  }
  const cause = { kind: "event", eventId: row.id } as const;
  const checkoutId = text(facts.checkoutId);
  const sessionId = text(facts.linkId);
  const type = STRIPE_EVENT_TYPES[row.event_type] ?? "other";
  if (!checkoutId) {
    await moveEvent(env, cause, now, "ignored", "not_techaust");
    return { result: "ignored" };
  }
  if (!sessionId || type === "other") {
    if (type === "other") {
      await moveEvent(env, cause, now, "ignored", "other");
      return { result: "ignored" };
    }
    return reviewOnly(
      env,
      { cause, now, linkId: null },
      "unreadable_event",
      { documentId: null, clientId: null, amountMinor: null },
      { event: row.event_type },
      STRIPE,
    );
  }
  const checkout = await db.prepare(CHECKOUT_BY_LINK_SQL).bind("stripe", sessionId).first<CheckoutRow>();
  if (!checkout) {
    if (type !== "checkout.paid") {
      await moveEvent(env, cause, now, "ignored", "no_live_link");
      return { result: "ignored" };
    }
    const known = await db.prepare(CHECKOUT_BY_ID_SQL).bind(checkoutId).first<CheckoutRow>();
    const mine = known?.provider === "stripe" ? known : null;
    return reviewOnly(
      env,
      { cause, now, linkId: sessionId },
      "unknown_link",
      { documentId: mine?.document_id ?? null, clientId: mine?.client_id ?? null, amountMinor: null },
      {
        linkId: sessionId,
        checkoutId,
        ...(text(facts.paymentId) ? { paymentId: text(facts.paymentId) as string } : {}),
      },
      STRIPE,
    );
  }
  // (5) an asynchronous payment failed: the session goes `failed`; the client sees C5 and can try again (no review).
  if (type === "checkout.failed") {
    if (checkout.status !== "live" && checkout.status !== "stale") {
      await moveEvent(env, cause, now, "ignored", "no_live_link");
      return { result: "ignored" };
    }
    await mutateSystem(env, {
      actorType: "webhook",
      main: checkoutFailStatement(db, { id: checkout.id, now, from: "open" }),
      action: "payment.link_end",
      entityType: "checkout_session",
      entityId: checkout.id,
      summary: {
        checkoutId: checkout.id,
        documentId: checkout.document_id,
        status: "failed",
        eventId: row.id,
      },
      side: (g: GuardSql) => [
        webhookEventMoveStatement(db, { id: row.id, status: "processed", outcome: "failed", now }, g),
      ],
    });
    return { result: "processed" };
  }
  const mode = await stripeModeOfSettings(db);
  const api = stripeOf(env, mode);
  if (!api) return { result: "retry" };
  // (4) expired and (6) paid: both through the re-fetch; only Stripe's own answer ends a row or records money.
  const r = await settleStripe(env, {
    api,
    checkout,
    cause,
    now,
    env: envText(env, "ENVIRONMENT") ?? "",
    expectedLivemode: expectedLivemodeOf(env, mode),
    attempts: row.attempts,
  });
  return { result: r.result, ...(r.next ? { next: r.next } : {}) };
}

/**
 * `refreshCheckout` for a Stripe checkout (L13; the hourly sweep, the portal's poll, the admin refresh): claimed first, so every outcome writes `last_refresh_at`
 * (early check 1, F4) and at most one re-fetch a minute runs; then the same settle as the webhook (source `refresh`). Never ends a row on our clock (L6).
 */
export async function refreshStripeCheckout(
  env: GatewayEnv,
  checkout: CheckoutRow,
  now = Date.now(),
): Promise<"processed" | "unchanged" | "too_soon" | "no_open_link" | "needs_review" | "retry"> {
  if (!checkout.provider_link_id || (checkout.status !== "live" && checkout.status !== "stale"))
    return "no_open_link";
  const claim = await checkoutRefreshClaimStatement(env.DB, { id: checkout.id, now }).run();
  if (claim.meta.changes !== 1) return "too_soon";
  const mode = await stripeModeOfSettings(env.DB);
  const api = stripeOf(env, mode);
  if (!api) return "retry";
  const r = await settleStripe(env, {
    api,
    checkout,
    cause: { kind: "refresh" },
    now,
    env: envText(env, "ENVIRONMENT") ?? "",
    expectedLivemode: expectedLivemodeOf(env, mode),
  });
  if (r.stillOpen) return "unchanged";
  return r.result === "processed" || r.result === "duplicate"
    ? "processed"
    : r.result === "needs_review"
      ? "needs_review"
      : r.result === "retry"
        ? "retry"
        : "unchanged";
}
