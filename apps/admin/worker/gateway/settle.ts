// Settling a gateway payment (M6.2; ADM-PAY-02, -06, -07, ADM-INV-10, JOB-HOOK-02; run file C steps 2 to 8, early check 1 "For B2" 2 to 5). One function serves the
// webhook (`GatewayEvents.processEvent`), the portal's status refresh (`PortalPayments.refreshForClient`) and the Owner's "Try again" on a review item: whatever
// brought the news, the link and the payment are RE-FETCHED from Razorpay's API (ADR 0008: a webhook alone proves nothing) and judged against our checkout, then
// written in ONE batch:
//   - a tax invoice or debit note, matching and still payable: the payment confirmed (L5, no Owner step) and put on the document; any excess held as credit with
//     an `overpaid` item (ADM-PAY-06); the link paid, the document's other links stale; the event processed; the owners' bell;
//   - a proforma, matching, within its balance: the payment pending with its requested allocation, the link paid; `next` asks for the automatic tax invoice (L6);
//   - anything else, for a client we know: the payment pending (no ledger move) with a review item of its kind (L7); an erased client: the review item only.
// A confirmed batch refused by a race (the link cancelled or expired meanwhile, the invoice voided) never drops captured money: a second batch records it pending
// with a `document_not_payable` item ("For B2" 3). Retries happen only on a network error, a 5xx, missing keys or a payment Razorpay still holds as pending ("For B2" 5).
// Nothing stores a payer's email, phone, UPI address or card detail (L8; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).

import { istDate, toIsoDate } from "@techaust/core/dates";
import type { ProcessEventResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { payableOnline } from "@techaust/core/online-pay";
import type { PaymentStatusReport } from "@techaust/core/payments";
import {
  isRazorpayShortUrl,
  judgeRazorpayPayment,
  methodToMode,
  type RazorpayLink,
  razorpayPaymentRowId,
  razorpayReferenceNorm,
} from "@techaust/core/razorpay";
import { deedDraftStatements } from "@techaust/db/deeds";
import {
  advanceWaitingSql,
  CHECKOUT_BY_LINK_SQL,
  checkoutEndStatement,
  checkoutLiveStatement,
  type GatewayFacts,
  type GatewayPaymentArgs,
  recordGatewayPaymentStatements,
  reviewBellStatement,
  reviewItemStatement,
  webhookEventMoveStatement,
} from "@techaust/db/gateway";
import { type GuardSql, guardSql } from "@techaust/db/log";
import { withdrawnSql } from "@techaust/db/sql-rules";
import { mutateSystem } from "../system.ts";
import { bellNeedsReview, bellPaidOnline, type ReasonFacts, reviewReason } from "./messages.ts";
import type { RazorpayApi, RzpFailure } from "./razorpay.ts";

export type GatewayEnv = { DB: D1Database };

export type CheckoutRow = {
  id: string;
  provider: string;
  document_id: string;
  client_id: string;
  contact_id: string | null;
  source: string;
  currency: "INR" | "USD";
  amount_minor: number;
  status: string;
  provider_link_id: string | null;
  short_url: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
  last_refresh_at: number | null;
  paid_payment_id: string | null;
};

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

/** The document and its client as the settle step judges them (one read). */
export const DOC_STATE_SQL = `SELECT d.type, d.status, d.frozen_at, d.currency, d.balance_minor, d.number_display, ${withdrawnSql("d")} AS withdrawn,
     k.display_name, k.anonymised_at, k.country, k.gst_status
   FROM documents d JOIN clients k ON k.id = d.client_id WHERE d.id = ?1`;
const CHECKOUT_BY_ID_SQL =
  "SELECT c.id, c.provider, c.document_id, c.client_id, c.contact_id, c.source, c.currency, c.amount_minor, c.status, c.provider_link_id, c.short_url, c.expires_at, c.created_at, c.updated_at, c.last_refresh_at, c.paid_payment_id FROM checkout_sessions c WHERE c.id = ?1";
/** The payment row of a Razorpay payment we already hold, and whether it still waits for its automatic tax invoice (early check 2, finding 2). */
const PAYMENT_SEEN_SQL = `SELECT p.id, CASE WHEN ${advanceWaitingSql("p")} THEN 1 ELSE 0 END AS waiting
   FROM payments p INDEXED BY payments_provider_ref WHERE p.provider = ?1 AND p.provider_payment_id = ?2`;
type Seen = { id: string; waiting: number };

/**
 * A payment we already hold: `duplicate`, with `next` while it is a proforma's payment still waiting for its tax invoice (early check 2, finding 2: a refresh that
 * recorded it, a lost `next`, a failed send; every caller that gets `next` queues `gateway.advance`).
 */
export const duplicateOf = (seen: Seen): ProcessEventResult =>
  seen.waiting === 1
    ? { result: "duplicate", next: { kind: "gateway.advance", paymentId: seen.id } }
    : { result: "duplicate" };
const OTHER_LIVE_SQL =
  "SELECT id, provider_link_id FROM checkout_sessions INDEXED BY checkout_sessions_document WHERE document_id = ?1 AND id <> ?2 AND status = 'live' LIMIT 5";

export const REVIEW_LINK = "/payments?tab=review";

/** Where the news came from: a stored webhook event, or a status fetch (the portal's refresh, the Owner's "Try again"). */
export type SettleCause = { kind: "event"; eventId: string } | { kind: "refresh" };

export type SettleArgs = {
  api: RazorpayApi;
  linkId: string;
  /** The payment the webhook names; null for a refresh (the link's captured payment is taken). */
  paymentId: string | null;
  cause: SettleCause;
  now: number;
};

/** A failure of a Razorpay call: retry (network, 5xx, keys not set yet) or the Owner reviews it. */
const isTransient = (code: RzpFailure) => code === "network" || code === "unconfigured";

/** The whitelisted facts of a payment for the rows (L8; 08-C RB-40). */
const factsOf = (linkId: string, p: PaymentStatusReport | null, paymentRef: string | null): GatewayFacts => ({
  linkId,
  ...(paymentRef ? { paymentId: paymentRef } : {}),
  ...(p ? { amountMinor: p.amountMinor, currency: p.currency } : {}),
  ...(p?.method ? { method: p.method } : {}),
});

/**
 * Fix round 3 item 2: a review item also keeps the reason code (`document_not_payable`) and the link's amount (`amount_mismatch`) that S20 names, so "Needs
 * review" reads them as the bell does. Codes and amounts only, nothing about the payer (L8; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).
 */
export const reviewFactsOf = (facts: GatewayFacts, r: ReasonFacts): GatewayFacts => ({
  ...facts,
  ...(typeof r.reason === "string" && /^[a-z_]{1,40}$/.test(r.reason) ? { reason: r.reason } : {}),
  ...(Number.isSafeInteger(r.expectedMinor) ? { expectedMinor: r.expectedMinor as number } : {}),
});

/** The event's id when the news came from one. */
const eventIdOf = (cause: SettleCause) => (cause.kind === "event" ? cause.eventId : null);
const sourceOf = (cause: SettleCause): "webhook" | "refresh" =>
  cause.kind === "event" ? "webhook" : "refresh";

/**
 * A review item with no payment row (an unknown link, an erased client, a re-fetch that failed): the item, its bell and the event's move to `needs_review`, in one
 * batch audited as the webhook (or the system for a refresh).
 */
export async function reviewOnly(
  env: GatewayEnv,
  a: Pick<SettleArgs, "cause" | "now"> & { linkId: string | null },
  kind: string,
  where: { documentId: string | null; clientId: string | null; amountMinor: number | null },
  facts: GatewayFacts,
): Promise<ProcessEventResult> {
  const reviewId = uuidv7();
  const eventId = eventIdOf(a.cause);
  await mutateSystem(env, {
    actorType: a.cause.kind === "event" ? "webhook" : "system",
    action: "payment.gateway_review",
    entityType: eventId ? "webhook_event" : "review_item",
    entityId: eventId ?? reviewId,
    summary: {
      kind,
      reviewId,
      ...(eventId ? { eventId } : {}),
      ...(where.documentId ? { documentId: where.documentId } : {}),
    },
    side: (g) => [
      reviewItemStatement(
        env.DB,
        {
          id: reviewId,
          source: sourceOf(a.cause),
          provider: "razorpay",
          kind,
          webhookEventId: eventId,
          paymentId: null,
          documentId: where.documentId,
          clientId: where.clientId,
          amountMinor: where.amountMinor,
          currency: where.amountMinor ? "INR" : null,
          facts,
          now: a.now,
          // A refresh ("Try again", the portal's poll) adds no second item while one of this kind is open for the link (early check 2, finding 12).
          onceOpenForLink: a.cause.kind === "refresh" ? (a.linkId ?? null) : null,
        },
        g,
      ),
      reviewBellStatement(
        env.DB,
        { reviewId, title: bellNeedsReview(reviewReason(kind)), link: REVIEW_LINK },
        g,
      ),
      ...(eventId
        ? [
            webhookEventMoveStatement(
              env.DB,
              { id: eventId, status: "needs_review", outcome: kind, now: a.now },
              g,
            ),
          ]
        : []),
    ],
  });
  return { result: "needs_review" };
}

/** The payment row's fields from the re-fetched payment (L11: the IST day of its `created_at`; Settled by the lead on the safest reading, 2026-11-01 (08-C RA-37)). */
function paymentFields(p: PaymentStatusReport) {
  return {
    providerPaymentId: p.providerRef,
    paymentId: razorpayPaymentRowId(p.providerRef),
    amountMinor: p.amountMinor,
    feeMinor: p.feeMinor ?? 0,
    feeTaxMinor: p.feeTaxMinor,
    receivedOn: toIsoDate(istDate(p.createdAt)),
    mode: methodToMode(p.method),
    referenceNorm: razorpayReferenceNorm(p.providerRef) ?? "",
  };
}

/**
 * A pending payment (no ledger move) and a review item of `kind`, in one batch: a mismatch, a document no longer payable, a proforma overpaid, a race that refused
 * the confirmed batch. `checkoutPaid` marks the link paid when the money is the link's own (a proforma's pending payment).
 */
async function recordPendingWithReview(
  env: GatewayEnv,
  a: SettleArgs,
  checkout: CheckoutRow,
  p: PaymentStatusReport,
  kind: string,
  reasonFacts: ReasonFacts,
  facts: GatewayFacts,
): Promise<boolean> {
  const auditId = uuidv7();
  const g = guardSql({ auditId });
  const f = paymentFields(p);
  const eventId = eventIdOf(a.cause);
  const s = recordGatewayPaymentStatements(
    env.DB,
    {
      provider: "razorpay",
      ...f,
      checkoutId: checkout.id,
      clientId: checkout.client_id,
      documentId: checkout.document_id,
      webhookEventId: eventId,
      source: sourceOf(a.cause),
      status: "pending_verification",
      refetchedAt: a.now,
      now: a.now,
      allocate: null,
      requestedAllocations: null,
      checkoutPaid: false,
      staleOthers: false,
      event: eventId ? { status: "needs_review", outcome: kind } : null,
      bell: null,
    },
    g,
  );
  const reviewId = uuidv7();
  return mutateSystem(env, {
    auditId,
    actorType: a.cause.kind === "event" ? "webhook" : "system",
    main: s.main,
    action: "payment.gateway_pending",
    entityType: "payment",
    entityId: f.paymentId,
    summary: {
      paymentId: f.paymentId,
      checkoutId: checkout.id,
      documentId: checkout.document_id,
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
          provider: "razorpay",
          kind,
          webhookEventId: eventId,
          paymentId: f.paymentId,
          documentId: checkout.document_id,
          clientId: checkout.client_id,
          amountMinor: f.amountMinor,
          currency: "INR",
          facts: reviewFactsOf(facts, reasonFacts),
          now: a.now,
        },
        s.guard,
      ),
      reviewBellStatement(
        env.DB,
        { reviewId, title: bellNeedsReview(reviewReason(kind, reasonFacts)), link: REVIEW_LINK },
        s.guard,
      ),
      ...s.last,
    ],
  });
}

/** The event moves without a payment row (a duplicate, an ignored event), in its own statement ("For B2" 2). */
async function moveEvent(
  env: GatewayEnv,
  a: SettleArgs,
  status: "processed" | "ignored" | "needs_review",
  outcome: string,
): Promise<void> {
  const eventId = eventIdOf(a.cause);
  if (eventId) await webhookEventMoveStatement(env.DB, { id: eventId, status, outcome, now: a.now }).run();
}

/** Finds our checkout for a Razorpay link: by its id, else (a `creating` row whose create answer was lost) by our reference, adopted live ("For B2" 4). */
export async function checkoutForLink(
  env: GatewayEnv,
  link: RazorpayLink,
  now: number,
): Promise<CheckoutRow | null> {
  const db = env.DB;
  const byLink = await db
    .prepare(CHECKOUT_BY_LINK_SQL)
    .bind("razorpay", link.providerRef)
    .first<CheckoutRow>();
  if (byLink) return byLink;
  if (!link.referenceId) return null;
  const byRef = await db.prepare(CHECKOUT_BY_ID_SQL).bind(link.referenceId).first<CheckoutRow>();
  if (
    byRef?.provider !== "razorpay" ||
    byRef.status !== "creating" ||
    !link.shortUrl ||
    !isRazorpayShortUrl(link.shortUrl)
  )
    return null;
  await checkoutLiveStatement(db, {
    id: byRef.id,
    providerLinkId: link.providerRef,
    shortUrl: link.shortUrl,
    expiresAt: link.expiresAt ?? byRef.expires_at,
    now,
  }).run();
  return db.prepare(CHECKOUT_BY_ID_SQL).bind(byRef.id).first<CheckoutRow>();
}

/** A link Razorpay reports expired or cancelled: our checkout ends the same way (guarded: only a live or stale one). */
export async function endCheckout(
  env: GatewayEnv,
  a: { cause: SettleCause; checkout: CheckoutRow | null; status: "expired" | "cancelled"; now: number },
): Promise<ProcessEventResult> {
  const eventId = eventIdOf(a.cause);
  const c = a.checkout;
  if (!c || (c.status !== "live" && c.status !== "stale")) {
    if (eventId)
      await webhookEventMoveStatement(env.DB, {
        id: eventId,
        status: "ignored",
        outcome: "no_live_link",
        now: a.now,
      }).run();
    return { result: "ignored" };
  }
  await mutateSystem(env, {
    actorType: a.cause.kind === "event" ? "webhook" : "system",
    main: checkoutEndStatement(env.DB, { id: c.id, status: a.status, now: a.now }),
    action: "payment.link_end",
    entityType: "checkout_session",
    entityId: c.id,
    summary: {
      checkoutId: c.id,
      documentId: c.document_id,
      status: a.status,
      ...(eventId ? { eventId } : {}),
    },
    side: (g: GuardSql) =>
      eventId
        ? [
            webhookEventMoveStatement(
              env.DB,
              { id: eventId, status: "processed", outcome: a.status, now: a.now },
              g,
            ),
          ]
        : [],
  });
  return { result: "processed" };
}

/**
 * Re-fetch, judge and record one payment on a link (the run file's steps 3 to 8). `cancelStale` is called after a confirmed batch with the links that went stale, so
 * the caller cancels them at Razorpay (best effort).
 */
export async function settlePayment(
  env: GatewayEnv,
  a: SettleArgs,
  cancelStale?: (links: readonly { id: string; linkId: string }[]) => Promise<void>,
): Promise<ProcessEventResult> {
  const db = env.DB;
  // (4) the link from Razorpay's API, never the webhook's copy (the live guard runs inside the client, before any fetch)
  const linkR = await a.api.fetchLink(a.linkId);
  if (!linkR.ok) {
    if (isTransient(linkR.code)) return { result: "retry" };
    return reviewOnly(
      env,
      a,
      "refetch_failed",
      { documentId: null, clientId: null, amountMinor: null },
      factsOf(a.linkId, null, a.paymentId),
    );
  }
  const link = linkR.value;
  // (3) our checkout: by the link id, else a stuck `creating` row by our reference ("For B2" 4); none: a link we don't know
  const checkout = await checkoutForLink(env, link, a.now);
  if (!checkout)
    return reviewOnly(
      env,
      a,
      "unknown_link",
      { documentId: null, clientId: null, amountMinor: null },
      factsOf(a.linkId, null, a.paymentId),
    );
  const paymentRef =
    a.paymentId ??
    link.payments.find((p) => p.status === "captured")?.paymentRef ??
    link.payments[0]?.paymentRef ??
    null;
  if (!paymentRef) return { result: "ignored" };
  // "For B2" 2: the same Razorpay payment again (a duplicate delivery, a replay under a new event id, a refresh after the webhook): the event is processed, nothing else.
  const seen = await db.prepare(PAYMENT_SEEN_SQL).bind("razorpay", paymentRef).first<Seen>();
  if (seen) {
    await moveEvent(env, a, "processed", "duplicate");
    return duplicateOf(seen);
  }
  const payR = await a.api.fetchPayment(paymentRef);
  if (!payR.ok) {
    if (isTransient(payR.code)) return { result: "retry" };
    return reviewOnly(
      env,
      a,
      "refetch_failed",
      { documentId: checkout.document_id, clientId: checkout.client_id, amountMinor: null },
      factsOf(a.linkId, null, paymentRef),
    );
  }
  const p = payR.value;
  const facts = factsOf(a.linkId, p, paymentRef);
  // (5) the judge; a payment Razorpay has not settled yet is tried again later ("For B2" 5)
  const verdict = judgeRazorpayPayment(
    {
      id: checkout.id,
      providerLinkId: checkout.provider_link_id ?? "",
      currency: checkout.currency,
      amountMinor: checkout.amount_minor,
    },
    link,
    p,
  );
  if (!verdict.ok && verdict.verdict === "payment_pending") return { result: "retry" };
  const doc = await db.prepare(DOC_STATE_SQL).bind(checkout.document_id).first<DocState>();
  // (8) an erased client: the review item only, never a payment row
  if (!doc || doc.anonymised_at !== null)
    return reviewOnly(
      env,
      a,
      "client_gone",
      { documentId: checkout.document_id, clientId: checkout.client_id, amountMinor: p.amountMinor },
      facts,
    );
  // A payment in a currency other than INR can never be a row (Q3 A, trigger `payments_gateway_shape`): the review item only.
  if (p.currency !== "INR")
    return reviewOnly(
      env,
      a,
      "currency_mismatch",
      { documentId: checkout.document_id, clientId: checkout.client_id, amountMinor: null },
      facts,
    );
  // Early check 2, finding 4: a payment Razorpay reports failed or refunded holds no money for us: the review item only, never a pending row the Owner could confirm.
  if (!verdict.ok && verdict.verdict === "not_captured")
    return reviewOnly(
      env,
      a,
      "not_captured",
      { documentId: checkout.document_id, clientId: checkout.client_id, amountMinor: p.amountMinor },
      facts,
    );
  if (!verdict.ok) {
    await recordPendingWithReview(
      env,
      a,
      checkout,
      p,
      verdict.verdict,
      { paidMinor: p.amountMinor, expectedMinor: checkout.amount_minor },
      facts,
    );
    return { result: "needs_review" };
  }
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
  if (!payable.ok) {
    await recordPendingWithReview(
      env,
      a,
      checkout,
      p,
      "document_not_payable",
      { reason: payable.reason },
      facts,
    );
    return { result: "needs_review" };
  }
  const f = paymentFields(p);
  const eventId = eventIdOf(a.cause);
  const source = sourceOf(a.cause);
  // (7) a proforma: pending until its tax invoice is issued (L6), within its balance; above it the Owner issues by hand
  if (doc.type === "proforma") {
    if (p.amountMinor > doc.balance_minor) {
      await recordPendingWithReview(env, a, checkout, p, "proforma_overpaid", {}, facts);
      return { result: "needs_review" };
    }
    const auditId = uuidv7();
    const s = recordGatewayPaymentStatements(
      db,
      {
        provider: "razorpay",
        ...f,
        checkoutId: checkout.id,
        clientId: checkout.client_id,
        documentId: checkout.document_id,
        webhookEventId: eventId,
        source,
        status: "pending_verification",
        refetchedAt: a.now,
        now: a.now,
        allocate: null,
        requestedAllocations: [{ documentId: checkout.document_id, amountMinor: p.amountMinor }],
        checkoutPaid: true,
        staleOthers: false,
        event: eventId ? { status: "processed", outcome: "proforma_pending" } : null,
        bell: {
          kind: "payment.online",
          title: bellPaidOnline(doc.display_name, p.amountMinor, doc.number_display),
          link: `/invoices/${checkout.document_id}`,
        },
      },
      guardSql({ auditId }),
    );
    const done = await mutateSystem(env, {
      auditId,
      actorType: a.cause.kind === "event" ? "webhook" : "system",
      main: s.main,
      action: "payment.gateway_pending",
      entityType: "payment",
      entityId: f.paymentId,
      summary: {
        paymentId: f.paymentId,
        checkoutId: checkout.id,
        documentId: checkout.document_id,
        kind: "proforma",
        amountMinor: f.amountMinor,
      },
      side: () => [...s.side, ...s.last],
    });
    if (!done) {
      // The link ended meanwhile: the money is still recorded, for the Owner ("For B2" 3).
      await recordPendingWithReview(
        env,
        a,
        checkout,
        p,
        "document_not_payable",
        { reason: "link_not_live" },
        facts,
      );
      return { result: "needs_review" };
    }
    return { result: "processed", next: { kind: "gateway.advance", paymentId: f.paymentId } };
  }
  // (6) a tax invoice or debit note: confirmed and put on the document, in one batch
  const others = (
    await db
      .prepare(OTHER_LIVE_SQL)
      .bind(checkout.document_id, checkout.id)
      .all<{ id: string; provider_link_id: string | null }>()
  ).results;
  const auditId = uuidv7();
  const s = recordGatewayPaymentStatements(
    db,
    {
      provider: "razorpay",
      ...f,
      checkoutId: checkout.id,
      clientId: checkout.client_id,
      documentId: checkout.document_id,
      webhookEventId: eventId,
      source,
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
        title: bellPaidOnline(doc.display_name, p.amountMinor, doc.number_display),
        link: `/invoices/${checkout.document_id}`,
      },
    } satisfies GatewayPaymentArgs,
    guardSql({ auditId }),
  );
  let done = false;
  try {
    done = await mutateSystem(env, {
      auditId,
      actorType: a.cause.kind === "event" ? "webhook" : "system",
      main: s.main,
      action: "payment.gateway_confirm",
      entityType: "payment",
      entityId: f.paymentId,
      summary: {
        paymentId: f.paymentId,
        checkoutId: checkout.id,
        documentId: checkout.document_id,
        amountMinor: f.amountMinor,
      },
      // T11 (L3; 08-C RB-38(a)): the confirmed payment can complete a project's full payment: its draft deed is made after `s.side` (the recompute), guarded
      // on the audit row and this batch's payment row (`s.guard`), and before `s.last` (`ledger_result`, unguarded). None in the pending batches (no money moved).
      side: () => [
        ...s.side,
        ...deedDraftStatements(db, { target: { documentIds: [checkout.document_id] }, now: a.now }, s.guard),
        ...s.last,
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
    // "For B2" 3: the link was cancelled or expired, or the invoice voided, between the read and the batch: record the money pending with a review item.
    const again = await db.prepare(PAYMENT_SEEN_SQL).bind("razorpay", paymentRef).first<Seen>();
    if (again) {
      await moveEvent(env, a, "processed", "duplicate");
      return duplicateOf(again);
    }
    await recordPendingWithReview(env, a, checkout, p, "document_not_payable", { reason: "changed" }, facts);
    return { result: "needs_review" };
  }
  const stale = others
    .filter((o) => o.provider_link_id)
    .map((o) => ({ id: o.id, linkId: o.provider_link_id as string }));
  if (stale.length > 0 && cancelStale) await cancelStale(stale);
  return { result: "processed" };
}
