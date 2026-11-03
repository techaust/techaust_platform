// Capturing and settling a PayPal order (M6.4; ADM-PAY-01, -03, -04, -06, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file docs/runs/m6.4-paypal.md C, "Step 0 results",
// "Lead decisions at build start" L5, L19, L24, early check 1 "B2 must carry"). One function, `capturePayPalCheckout`, serves every caller: the client's return from
// PayPal's page (`PortalPayments.capturePayPalReturn`, and the signed-in page's refresh), `CHECKOUT.ORDER.APPROVED`, the hourly sweep (`gateway.refresh`) and the
// staff "Check now". Money moves ONLY on PayPal's own answer to our server's capture call, or on a verified event followed by a re-fetch of the capture and the
// order (ADR 0008, ADM-PAY-04; nothing is ever marked paid on a redirect). In order:
//   1. our checkout row: paid → paid; PayPal holds the capture → its capture re-fetched; ended with no claim → expired or not completed; ended WITH a claim (a
//      capture may have gone through before the row ended) → the order re-fetched first, and a completed capture is never dropped (step 9);
//   2. the CLAIM (L2, L5): one call takes the right to capture, only while the row is live or stale, within `expires_at` + 30 minutes, with no fresh claim held,
//      and while the document can still take exactly this amount (`paypalCaptureClaimStatement`, every rule in SQL). Refused: a fresh claim elsewhere is
//      `processing`; a document that changed ends the row `cancelled` with NO capture call (no money is taken that couldn't be applied: `changed`);
//   3. the capture (`cap-<checkout>-<claim>`: retries inside one claim are idempotent; a new claim after a decline gets a new id). Its answer: already captured →
//      the order read; declined → the claim released, `declined` with the stored approval link; not approved → released, `not_completed`; 404 → the order read,
//      and gone there too → released and expired in one batch; in progress, no answer or a 5xx → the claim KEPT (it goes stale; the sweep re-fetches: a claimed
//      row is never ended locally); refused → released, a `capture_refused` item;
//   4. the judge (core `judgePayPalCapture`) on PayPal's answer and the order, which also gives the payer's or card's country (08-C RA-38);
//   5. completed and exact: an export invoice or debit note confirmed and put on the document in ONE batch (the checkout paid with its capture id, the event
//      processed, the owners' bell, T11's deed after the recompute); a USD proforma pending with its request and the Owner's `fx_rate_needed` item (M6.3 Q1 A;
//      Researched 2026-10-28, Rule 34 CGST Rules (08-C RA-21));
//   6. held (`PENDING`): the row `capture_pending` with its capture id, a `capture_pending` item, no payment row until PayPal completes it (L6);
//   7. declined or failed: the row `failed`, a `capture_denied` item, no payment;
//   8. any other mismatch for a client we know: the money recorded pending (no ledger move) with a review item of its kind; an erased client: the item only;
//   9. never drop captured money: a confirmed or proforma batch that changed nothing (the row ended, the document changed, the balance moved) is followed by one
//      that records the capture pending with a `late_capture` item; the row keeps its status and takes the capture id once.
// The payer's data is never read or stored (core's readers are whitelists: L7, ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).
// The fee is absorbed (M6.1 L9: a commercial choice) in the column of its own currency; OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our GSTIN?
import type { CaptureReturnState, ProcessEventResult, RefreshResult } from "@techaust/core/gateway-rpc";
import { isUuidV7, uuidv7 } from "@techaust/core/ids";
import { payableOnline, type ReviewKind } from "@techaust/core/online-pay";
import {
  invoiceIdCheckoutTail,
  judgePayPalCapture,
  PAYPAL_CAPTURE_GRACE_MS,
  PAYPAL_CLAIM_STALE_MS,
  PAYPAL_EVENT_TYPES,
  type PayPalCapture,
  type PayPalOrder,
  payPalCaptureRequestId,
  payPalFeeFactsOf,
  payPalModeOf,
  payPalPaymentRowId,
  payPalReceivedOn,
  payPalReferenceNorm,
} from "@techaust/core/paypal";
import { deedDraftStatements } from "@techaust/db/deeds";
import {
  CHECKOUT_BY_CAPTURE_SQL,
  CHECKOUT_BY_ID_SQL,
  CHECKOUT_BY_LINK_SQL,
  checkoutCaptureIdStatement,
  checkoutCapturePendingStatement,
  checkoutEndStatement,
  checkoutFailStatement,
  checkoutRefreshClaimStatement,
  type GatewayFacts,
  type GatewayPaymentArgs,
  paypalAbandonStatements,
  paypalCaptureClaimStatement,
  paypalCaptureFitsStatement,
  paypalCaptureReleaseStatement,
  recordGatewayPaymentStatements,
  reviewBellStatement,
  reviewItemStatement,
  webhookEventMoveStatement,
} from "@techaust/db/gateway";
import { type GuardSql, guardSql } from "@techaust/db/log";
import { enqueueReceipt } from "../receipt-enqueue.ts";
import { type Actor, mutateSystem } from "../system.ts";
import { payPalModeOfSettings, payPalOf } from "./config.ts";
import {
  advanceBlockersText,
  bellNeedsReview,
  bellPaidByPayPal,
  type ReasonFacts,
  reviewReason,
} from "./messages.ts";
import { type PayPalApi, retryUrlOf } from "./paypal.ts";
import {
  type CheckoutRow,
  DOC_STATE_SQL,
  type GatewayEnv,
  REVIEW_LINK,
  reviewFactsOf,
  reviewOnly,
  type SettleCause,
} from "./settle.ts";

const PAYPAL = { provider: "paypal", currency: "USD" } as const;

/** Who brought us here (the audit actor and the event row follow from it). */
export type CaptureSource =
  | { kind: "return" }
  | { kind: "event"; eventId: string }
  | { kind: "sweep" }
  | { kind: "staff"; memberId: string; role: "owner" | "staff" };

/**
 * What a capture attempt came to: one of the return's states (07-ZN lines 4 to 11), `review` (money recorded pending, or an item only: the Owner decides) or
 * `retry` (nothing could be asked or read now: no transport or keys, or PayPal unreachable before any claim).
 */
export type CaptureOutcome = {
  readonly state: CaptureReturnState | "review" | "retry";
  readonly retryUrl?: string;
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

/**
 * Where new ids come from (L31, early check 2 finding 4): `uuidv7` for every real call; the start-up dry run (`warm-rpc.ts`) passes a counter of made-up ids,
 * since global scope refuses random values and a dry run would otherwise stop at the first new id, before the judge and the batches it is there to compile.
 */
export type Ids = () => string;

type Ctx = { env: GatewayEnv; api: PayPalApi; src: CaptureSource; now: number; ids: Ids };

/** The payment row of a PayPal capture we already hold (one seek of `payments_provider_ref`), with what it is. */
const SEEN_SQL = `SELECT p.id, p.status, p.requested_allocations IS NOT NULL AS requested FROM payments p INDEXED BY payments_provider_ref
   WHERE p.provider = 'paypal' AND p.provider_payment_id = ?1`;
type Seen = { id: string; status: string; requested: number };

const eventIdOf = (src: CaptureSource) => (src.kind === "event" ? src.eventId : null);
const causeOf = (src: CaptureSource): SettleCause =>
  src.kind === "event" ? { kind: "event", eventId: src.eventId } : { kind: "refresh" };
const sourceOf = (src: CaptureSource): "webhook" | "refresh" =>
  src.kind === "event" ? "webhook" : "refresh";
/** The audit actor (run file C step 5): the contact on the return, the webhook for an event, the system for the sweep, the member for "Check now". */
function actorOf(src: CaptureSource, c: CheckoutRow): Actor {
  switch (src.kind) {
    case "return":
      return c.contact_id ? { actorType: "contact", actorId: c.contact_id } : { actorType: "system" };
    case "event":
      return { actorType: "webhook" };
    case "staff":
      return { actorType: "staff", actorId: src.memberId, role: src.role };
    default:
      return { actorType: "system" };
  }
}

/** The whitelisted facts of a capture (RB-40, L7): the order, the capture, our checkout, the amount (USD only), PayPal's reason code. Never a payer's detail. */
function factsOf(c: CheckoutRow, cap: PayPalCapture | null, extra: GatewayFacts = {}): GatewayFacts {
  return {
    linkId: c.provider_link_id ?? "",
    checkoutId: c.id,
    ...(cap ? { paymentId: cap.id } : {}),
    ...(cap && cap.currency === "USD" && cap.amountMinor !== null && cap.amountMinor > 0
      ? { amountMinor: cap.amountMinor, currency: "USD" }
      : {}),
    ...(cap?.reason ? { code: cap.reason } : {}),
    ...extra,
  };
}

/** The event moves without a payment row, in its own statement (a duplicate, a state with nothing to write: "B2 must carry" 3). */
async function moveEvent(
  ctx: Pick<Ctx, "env" | "src" | "now">,
  status: "processed" | "ignored" | "needs_review",
  outcome: string,
): Promise<void> {
  const eventId = eventIdOf(ctx.src);
  if (eventId)
    await webhookEventMoveStatement(ctx.env.DB, { id: eventId, status, outcome, now: ctx.now }).run();
}

/** A review item and its bell with no payment row (an erased client, a currency we can't hold, a refused capture, a reversal), as the M6.2 path writes it. */
const reviewOnlyOf = (
  ctx: Ctx,
  c: CheckoutRow,
  kind: ReviewKind,
  amountMinor: number | null,
  facts: GatewayFacts,
): Promise<ProcessEventResult> =>
  reviewOnly(
    ctx.env,
    { cause: causeOf(ctx.src), now: ctx.now, linkId: c.provider_link_id },
    kind,
    { documentId: c.document_id, clientId: c.client_id, amountMinor },
    facts,
    PAYPAL,
    actorOf(ctx.src, c),
    ctx.ids,
  );

/** The payment row's fields from PayPal's capture and its order (L8, L9, L22). */
async function paymentFields(cap: PayPalCapture, order: PayPalOrder | null) {
  const fee = payPalFeeFactsOf(cap);
  return {
    providerPaymentId: cap.id,
    paymentId: payPalPaymentRowId(cap.id),
    amountMinor: cap.amountMinor as number,
    feeMinor: fee.chargesMinor,
    feeTaxMinor: null,
    receivedOn: payPalReceivedOn(cap.createdAt),
    mode: payPalModeOf(order?.fundingSource ?? null),
    referenceNorm: (await payPalReferenceNorm(cap.id)) ?? "",
    inrReceivedMinor: fee.inrReceivedMinor,
    gatewayFeeInrMinor: fee.gatewayFeeInrMinor,
    gatewayFeeTaxInrMinor: null,
  };
}
type Fields = Awaited<ReturnType<typeof paymentFields>>;

/** What a capture we already hold means for the client (a duplicate return or event): confirmed or a proforma's money is paid; anything else is with the Owner. */
async function duplicateOf(ctx: Ctx, seen: Seen): Promise<CaptureOutcome> {
  await moveEvent(ctx, "processed", "duplicate");
  return { state: seen.status === "confirmed" || seen.requested === 1 ? "paid" : "processing" };
}

/**
 * The money recorded PENDING (no ledger move) with a review item of `kind`, in one batch (steps 8 and 9). The checkout moves to `paid` with the capture id while
 * it is still open (the money came through this very order), and an ENDED one takes the capture id once (`late`). A proforma's payment (`requested`) carries its
 * request, processes the event and rings the owners' "paid by PayPal" bell. True when written.
 */
async function recordPending(
  ctx: Ctx,
  c: CheckoutRow,
  f: Fields,
  kind: ReviewKind,
  rf: ReasonFacts,
  facts: GatewayFacts,
  extra?: { requested: true; bellTitle: string },
): Promise<boolean> {
  const auditId = ctx.ids();
  const eventId = eventIdOf(ctx.src);
  const s = recordGatewayPaymentStatements(
    ctx.env.DB,
    {
      provider: "paypal",
      ...f,
      checkoutId: c.id,
      clientId: c.client_id,
      documentId: c.document_id,
      webhookEventId: eventId,
      source: sourceOf(ctx.src),
      status: "pending_verification",
      refetchedAt: ctx.now,
      now: ctx.now,
      allocate: null,
      requestedAllocations: extra?.requested
        ? [{ documentId: c.document_id, amountMinor: f.amountMinor }]
        : null,
      checkoutPaid: extra?.requested ? true : "if_open",
      providerCaptureId: f.providerPaymentId,
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
  const reviewId = ctx.ids();
  const words: ReasonFacts = { ...rf, provider: "paypal", currency: "USD" };
  return mutateSystem(ctx.env, {
    ...actorOf(ctx.src, c),
    auditId,
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
      // Step 9: an ended row keeps its status and takes the capture id once (guarded on this batch's payment row).
      ...(kind === "late_capture"
        ? [
            checkoutCaptureIdStatement(
              ctx.env.DB,
              { id: c.id, captureId: f.providerPaymentId, now: ctx.now },
              s.guard,
            ),
          ]
        : []),
      reviewItemStatement(
        ctx.env.DB,
        {
          id: reviewId,
          source: sourceOf(ctx.src),
          provider: "paypal",
          kind,
          webhookEventId: eventId,
          paymentId: f.paymentId,
          documentId: c.document_id,
          clientId: c.client_id,
          amountMinor: f.amountMinor,
          currency: "USD",
          facts: reviewFactsOf(
            kind === "advance_blocked" ? { ...facts, blockers: ["fx_rate_needed"] } : facts,
            rf,
          ),
          now: ctx.now,
        },
        s.guard,
      ),
      reviewBellStatement(
        ctx.env.DB,
        { reviewId, title: bellNeedsReview(reviewReason(kind, words)), link: REVIEW_LINK },
        s.guard,
      ),
      ...s.last,
    ],
  });
}

/** Step 9: never drop captured money. The capture recorded pending with a `late_capture` item; a concurrent settle that already holds it answers as that one. */
async function lateCapture(
  ctx: Ctx,
  c: CheckoutRow,
  f: Fields,
  facts: GatewayFacts,
): Promise<CaptureOutcome> {
  if (await recordPending(ctx, c, f, "late_capture", { paidMinor: f.amountMinor }, facts))
    return { state: "review" };
  const seen = await ctx.env.DB.prepare(SEEN_SQL).bind(f.providerPaymentId).first<Seen>();
  return seen ? duplicateOf(ctx, seen) : { state: "retry" };
}

/** A recorded mismatch (step 8): written, or held by a concurrent settle already, or (neither) the late path. */
async function pendingOrLate(
  ctx: Ctx,
  c: CheckoutRow,
  f: Fields,
  kind: ReviewKind,
  rf: ReasonFacts,
  facts: GatewayFacts,
): Promise<CaptureOutcome> {
  if (await recordPending(ctx, c, f, kind, rf, facts)) return { state: "review" };
  const seen = await ctx.env.DB.prepare(SEEN_SQL).bind(f.providerPaymentId).first<Seen>();
  return seen ? duplicateOf(ctx, seen) : lateCapture(ctx, c, f, facts);
}

/** Steps 4 to 9: one capture PayPal answered (the capture call's answer, or a re-fetch), judged against our row and its order, then written. */
export async function settleCapture(
  ctx: Ctx,
  c: CheckoutRow,
  order: PayPalOrder | null,
  cap: PayPalCapture,
): Promise<CaptureOutcome> {
  const db = ctx.env.DB;
  const facts = factsOf(c, cap);
  // The same capture again (a double return, the event after the return, a replay under a new event id): nothing more is written ("B2 must carry" 3).
  const seen = await db.prepare(SEEN_SQL).bind(cap.id).first<Seen>();
  if (seen) return duplicateOf(ctx, seen);
  const verdict = judgePayPalCapture(
    { id: c.id, providerLinkId: c.provider_link_id, currency: c.currency, amountMinor: c.amount_minor },
    order,
    cap,
  );
  const actor = actorOf(ctx.src, c);
  if (!verdict.ok && verdict.verdict === "capture_pending") {
    // (6) PayPal holds it: the row `capture_pending` with its capture id, the item and its bell; no payment row (L6).
    const reviewId = ctx.ids();
    const done = await mutateSystem(ctx.env, {
      ...actor,
      auditId: ctx.ids(),
      main: checkoutCapturePendingStatement(db, { id: c.id, captureId: cap.id, now: ctx.now }),
      action: "payment.capture_pending",
      entityType: "checkout_session",
      entityId: c.id,
      summary: { checkoutId: c.id, documentId: c.document_id, captureId: cap.id, reason: cap.reason },
      side: (g: GuardSql) => [
        reviewItemStatement(
          db,
          {
            id: reviewId,
            source: sourceOf(ctx.src),
            provider: "paypal",
            kind: "capture_pending",
            webhookEventId: eventIdOf(ctx.src),
            paymentId: null,
            documentId: c.document_id,
            clientId: c.client_id,
            amountMinor: cap.currency === "USD" ? cap.amountMinor : null,
            currency: cap.currency === "USD" && cap.amountMinor ? "USD" : null,
            facts,
            now: ctx.now,
          },
          g,
        ),
        reviewBellStatement(
          db,
          {
            reviewId,
            title: bellNeedsReview(reviewReason("capture_pending", { code: cap.reason })),
            link: REVIEW_LINK,
          },
          g,
        ),
        ...(eventIdOf(ctx.src)
          ? [
              webhookEventMoveStatement(
                db,
                {
                  id: eventIdOf(ctx.src) as string,
                  status: "processed",
                  outcome: "capture_pending",
                  now: ctx.now,
                },
                g,
              ),
            ]
          : []),
      ],
    });
    if (!done) await moveEvent(ctx, "processed", "capture_pending");
    return { state: "pending" };
  }
  if (!verdict.ok && verdict.verdict === "capture_denied") {
    // (7) declined or failed after approval: the row failed, the item and its bell; nothing was received.
    const reviewId = ctx.ids();
    const done = await mutateSystem(ctx.env, {
      ...actor,
      auditId: ctx.ids(),
      main: checkoutFailStatement(db, { id: c.id, now: ctx.now, from: "open", claim: c.capture_started_at }),
      action: "payment.link_end",
      entityType: "checkout_session",
      entityId: c.id,
      summary: { checkoutId: c.id, documentId: c.document_id, status: "failed", captureId: cap.id },
      side: (g: GuardSql) => [
        reviewItemStatement(
          db,
          {
            id: reviewId,
            source: sourceOf(ctx.src),
            provider: "paypal",
            kind: "capture_denied",
            webhookEventId: eventIdOf(ctx.src),
            paymentId: null,
            documentId: c.document_id,
            clientId: c.client_id,
            amountMinor: null,
            currency: null,
            facts,
            now: ctx.now,
          },
          g,
        ),
        reviewBellStatement(
          db,
          { reviewId, title: bellNeedsReview(reviewReason("capture_denied")), link: REVIEW_LINK },
          g,
        ),
        ...(eventIdOf(ctx.src)
          ? [
              webhookEventMoveStatement(
                db,
                {
                  id: eventIdOf(ctx.src) as string,
                  status: "processed",
                  outcome: "capture_denied",
                  now: ctx.now,
                },
                g,
              ),
            ]
          : []),
      ],
    });
    if (!done) await moveEvent(ctx, "processed", "capture_denied");
    return { state: "declined" };
  }
  if (!verdict.ok && verdict.verdict === "capture_refunded") {
    // Returned to the payer already: no money for us to record (M6.5 handles refunds); the Owner is told.
    await reviewOnlyOf(ctx, c, "refunded_outside", null, facts);
    return { state: "review" };
  }
  // A capture that isn't USD (or has no amount we can read) can never be a payment row (the 0068 shape): the item only.
  if (cap.currency !== "USD" || cap.amountMinor === null || cap.amountMinor <= 0) {
    await reviewOnlyOf(ctx, c, "currency_mismatch", null, facts);
    return { state: "review" };
  }
  const doc = await db.prepare(DOC_STATE_SQL).bind(c.document_id).first<DocState>();
  const f = await paymentFields(cap, order);
  // (8) an erased client: the item only, never a payment row
  if (!doc || doc.anonymised_at !== null) {
    await reviewOnlyOf(ctx, c, "client_gone", f.amountMinor, facts);
    return { state: "review" };
  }
  if (!verdict.ok)
    return pendingOrLate(
      ctx,
      c,
      f,
      verdict.verdict,
      { paidMinor: f.amountMinor, expectedMinor: c.amount_minor },
      facts,
    );
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
    "paypal",
  );
  if (!payable.ok) return pendingOrLate(ctx, c, f, "document_not_payable", { reason: payable.reason }, facts);
  const title = bellPaidByPayPal(doc.display_name, f.amountMinor, doc.number_display);
  if (doc.type === "proforma") {
    // (5) a USD proforma: pending with its request and the Owner's `fx_rate_needed` item (M6.3 Q1 A); above its balance it waits for a refund (M6.3 staging fix).
    if (f.amountMinor > doc.balance_minor) return pendingOrLate(ctx, c, f, "proforma_overpaid", {}, facts);
    if (
      await recordPending(
        ctx,
        c,
        f,
        "advance_blocked",
        { blocker: advanceBlockersText(["fx_rate_needed"]) },
        facts,
        {
          requested: true,
          bellTitle: title,
        },
      )
    )
      return { state: "paid" };
    const again = await db.prepare(SEEN_SQL).bind(f.providerPaymentId).first<Seen>();
    return again ? duplicateOf(ctx, again) : lateCapture(ctx, c, f, facts);
  }
  // (5) an export invoice or debit note: confirmed and put on the document, in one batch.
  const auditId = ctx.ids();
  const eventId = eventIdOf(ctx.src);
  const st = recordGatewayPaymentStatements(
    db,
    {
      provider: "paypal",
      ...f,
      checkoutId: c.id,
      clientId: c.client_id,
      documentId: c.document_id,
      webhookEventId: eventId,
      source: sourceOf(ctx.src),
      status: "confirmed",
      refetchedAt: ctx.now,
      now: ctx.now,
      allocate: { allocationId: ctx.ids(), overpaidReviewId: ctx.ids(), facts },
      requestedAllocations: null,
      checkoutPaid: true,
      providerCaptureId: cap.id,
      staleOthers: true,
      event: eventId ? { status: "processed", outcome: "confirmed" } : null,
      bell: { kind: "payment.online", title, link: `/invoices/${c.document_id}` },
    } satisfies GatewayPaymentArgs,
    guardSql({ auditId }),
  );
  let done = false;
  try {
    done = await mutateSystem(ctx.env, {
      ...actor,
      auditId,
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
        ...deedDraftStatements(db, { target: { documentIds: [c.document_id] }, now: ctx.now }, st.guard),
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
  if (done) {
    // M6.5 (L3): the confirmed payment's receipt, in its own batch on the invoices Worker.
    await enqueueReceipt(ctx.env, f.paymentId);
    return { state: "paid" };
  }
  const again = await db.prepare(SEEN_SQL).bind(f.providerPaymentId).first<Seen>();
  return again ? duplicateOf(ctx, again) : lateCapture(ctx, c, f, facts);
}

/** The capture an order answer holds (our order has one purchase unit and, with intent CAPTURE, at most one capture), or null. */
const captureOf = (o: PayPalOrder): PayPalCapture | null => o.captures[0] ?? null;

/** The claim released (only the one this call holds or read) and the row expired, in ONE batch, once PayPal showed no capture (re-check N1). */
async function abandon(ctx: Ctx, c: CheckoutRow, claim: number): Promise<CaptureOutcome> {
  const done = await mutateSystem(ctx.env, {
    ...actorOf(ctx.src, c),
    auditId: ctx.ids(),
    main: paypalAbandonStatements(ctx.env.DB, { id: c.id, claim, now: ctx.now }),
    action: "payment.link_end",
    entityType: "checkout_session",
    entityId: c.id,
    summary: { checkoutId: c.id, documentId: c.document_id, status: "expired", released: true },
  });
  await moveEvent(ctx, done ? "processed" : "ignored", done ? "expired" : "no_live_link");
  return { state: "expired" };
}

/** A local end of an UNCLAIMED row (`expired` past its grace, `cancelled` when the document changed), audited; never a claimed one (the statement holds it). */
async function endLocally(
  ctx: Ctx,
  c: CheckoutRow,
  status: "expired" | "cancelled",
  reason: string,
): Promise<boolean> {
  const done = await mutateSystem(ctx.env, {
    ...actorOf(ctx.src, c),
    auditId: ctx.ids(),
    main: checkoutEndStatement(ctx.env.DB, { id: c.id, status, now: ctx.now }),
    action: "payment.link_end",
    entityType: "checkout_session",
    entityId: c.id,
    summary: { checkoutId: c.id, documentId: c.document_id, status, reason },
  });
  await moveEvent(ctx, done ? "processed" : "ignored", done ? reason : "no_live_link");
  return done;
}

/**
 * The order re-fetched for a row whose capture may have gone through without our hearing (a claim past its grace, an ended row with a claim, a stale claim on a
 * document that changed): a completed capture is settled (never dropped); none at all ends the row (`claim` released first) or answers by its state.
 */
async function byOrder(
  ctx: Ctx,
  c: CheckoutRow,
  claim: number | null,
  ifNone: "abandon" | "answer",
): Promise<CaptureOutcome> {
  const o = await ctx.api.getOrder(c.provider_link_id as string);
  if (!o.ok && o.code !== "not_found") return { state: "processing" };
  const cap = o.ok ? captureOf(o.value) : null;
  if (o.ok && cap) return settleCapture(ctx, c, o.value, cap);
  if (ifNone === "abandon" && claim !== null) return abandon(ctx, c, claim);
  await moveEvent(ctx, "ignored", "no_live_link");
  return { state: c.status === "expired" ? "expired" : "not_completed" };
}

/** A capture PayPal holds (`capture_pending`): the capture and its order re-fetched (the event path's proof), then judged again. */
async function refetchHeld(ctx: Ctx, c: CheckoutRow): Promise<CaptureOutcome> {
  if (!c.provider_capture_id) return { state: "pending" };
  const [capR, orderR] = await Promise.all([
    ctx.api.getCapture(c.provider_capture_id),
    ctx.api.getOrder(c.provider_link_id as string),
  ]);
  if (!capR.ok || !orderR.ok)
    return { state: capR.ok || capR.code !== "not_found" ? "processing" : "pending" };
  if (capR.value.status === "PENDING") {
    await moveEvent(ctx, "processed", "still_pending");
    return { state: "pending" };
  }
  return settleCapture(ctx, c, orderR.value, capR.value);
}

/** What a row that is no longer live answers (read again after a refused claim). */
const stateOfRow = (c: CheckoutRow): CaptureReturnState =>
  c.status === "paid"
    ? "paid"
    : c.status === "capture_pending"
      ? "pending"
      : c.status === "expired"
        ? "expired"
        : c.status === "creating"
          ? "not_found"
          : "not_completed";

/**
 * Capture (or settle) one PayPal checkout (run file C steps 1 to 9). Never throws for PayPal's answer. `approvedOnly` (review part 1, finding 2, the optional low):
 * a caller that is not the client's own return or PayPal's approval event (the sweep, the portal's poll, a member's "Check now" or retry) never POSTs a capture on
 * an UNCLAIMED order PayPal doesn't show approved: the order is read first (a read is not a payment attempt; a capture already in it is settled), so repeated
 * refreshes of an order the client left or PayPal declined don't count toward PayPal's attempt limit (`MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED`). Review part 2,
 * finding 11: `approvedOnly`, `now` and `ids` are required, so every caller says which it is (the return and the approval event `false`; the refresh, the sweep
 * and a member's retry `true`).
 */
export async function capturePayPalCheckout(
  env: GatewayEnv,
  checkout: CheckoutRow,
  src: CaptureSource,
  now: number,
  ids: Ids,
  approvedOnly: boolean,
): Promise<CaptureOutcome> {
  const db = env.DB;
  const c = checkout;
  if (c.provider !== "paypal" || !c.provider_link_id) return { state: "not_found" };
  if (c.status === "paid") {
    await moveEvent({ env, src, now }, "processed", "duplicate");
    return { state: "paid" };
  }
  if (c.status === "creating") return { state: "not_found" };
  // The gateway itself, before any claim: no transport or keys, or live while it isn't allowed (CLAUDE.md rule 7: zero calls). Nothing is claimed or ended.
  const api = payPalOf(env, await payPalModeOfSettings(db));
  if (!api || api.blocked) return { state: "retry" };
  const ctx: Ctx = { env, api, src, now, ids };
  if (c.status === "capture_pending") return refetchHeld(ctx, c);
  if (c.status !== "live" && c.status !== "stale") {
    // (1) ended: with no claim nothing was captured; with one, the order is asked first (step 9 for a capture that went through).
    if (c.capture_started_at === null) {
      await moveEvent(ctx, "ignored", "no_live_link");
      return { state: stateOfRow(c) };
    }
    return byOrder(ctx, c, null, "answer");
  }
  // Past `expires_at` + 30 minutes (L5): never captured now. Unclaimed: expired here; claimed: only after PayPal shows no capture.
  if (now > c.expires_at + PAYPAL_CAPTURE_GRACE_MS) {
    if (c.capture_started_at === null) {
      await endLocally(ctx, c, "expired", "expired");
      return { state: "expired" };
    }
    return byOrder(ctx, c, c.capture_started_at, "abandon");
  }
  if (approvedOnly && c.capture_started_at === null) {
    const o = await api.getOrder(c.provider_link_id);
    // No such order (the row expires at its grace): not completed. PayPal unreachable (review part 2, finding 3): `retry`, since nothing is claimed here, so no
    // capture is "in flight" (a member's "Check now" answers the gateway error, the sweep comes back later).
    if (!o.ok) return { state: o.code === "not_found" ? "not_completed" : "retry" };
    const cap = captureOf(o.value);
    if (cap) return settleCapture(ctx, c, o.value, cap);
    if (o.value.status !== "APPROVED") {
      // Review part 2, finding 4: the claim's document test still runs (a read, no claim): a document voided, withdrawn, paid or changed meanwhile ends this
      // unclaimed row `cancelled` ("changed"), as a refused claim would, instead of leaving it "Live" until it expires. Nothing was captured on it.
      const fits = await paypalCaptureFitsStatement(db, { id: c.id }).first<{ fits: number }>();
      if (!fits)
        return { state: (await endLocally(ctx, c, "cancelled", "changed")) ? "changed" : "processing" };
      return { state: "not_completed" };
    }
  }
  // (2) the claim
  const claimed = await paypalCaptureClaimStatement(db, { id: c.id, now }).run();
  if (claimed.meta.changes !== 1) {
    const back = await db.prepare(CHECKOUT_BY_ID_SQL).bind(c.id).first<CheckoutRow>();
    if (!back) return { state: "not_found" };
    if (back.status !== "live" && back.status !== "stale") {
      await moveEvent(ctx, "processed", "duplicate");
      return { state: stateOfRow(back) };
    }
    if (back.capture_started_at !== null && back.capture_started_at > now - PAYPAL_CLAIM_STALE_MS)
      return { state: "processing" };
    // The document can no longer take this amount (voided, withdrawn, paid, its balance moved, the client erased, other gateway money waiting): no capture call.
    // A stale claim on it may have captured before: the order is asked first, and released and ended only when PayPal shows none.
    if (back.capture_started_at !== null) return byOrder(ctx, back, back.capture_started_at, "abandon");
    return { state: (await endLocally(ctx, back, "cancelled", "changed")) ? "changed" : "processing" };
  }
  const held: CheckoutRow = { ...c, capture_started_at: now };
  const release = () => paypalCaptureReleaseStatement(db, { id: c.id, claim: now, now }).run();
  // (3) the capture
  const answer = await api.captureOrder(c.provider_link_id, payPalCaptureRequestId(c.id, now));
  if (answer.ok) {
    const cap = captureOf(answer.order);
    // An answer with no capture in it: the claim is kept, and the sweep re-fetches the order.
    return cap ? settleCapture(ctx, held, answer.order, cap) : { state: "processing" };
  }
  if (answer.error === null) {
    if (answer.code === "bad_answer") return { state: "processing" };
    await release();
    return { state: "retry" };
  }
  switch (answer.error.kind) {
    case "already_captured": {
      // A second call after a capture (a double click, the event racing the return): the order holds the one capture.
      const o = await api.getOrder(c.provider_link_id);
      const cap = o.ok ? captureOf(o.value) : null;
      return o.ok && cap ? settleCapture(ctx, held, o.value, cap) : { state: "processing" };
    }
    case "instrument_declined": {
      // PayPal's restart guidance (Step 0.4): the payer picks another way on PayPal's page; a new claim gets a new request id.
      await release();
      await moveEvent(ctx, "processed", "instrument_declined");
      const retryUrl = retryUrlOf(c.short_url, c.provider_link_id);
      return retryUrl ? { state: "declined", retryUrl } : { state: "declined" };
    }
    case "not_approved":
      await release();
      await moveEvent(ctx, "ignored", "not_approved");
      return { state: "not_completed" };
    case "not_found": {
      // "B2 must carry" 7: expired only when a GET of the order answers 404 too.
      const o = await api.getOrder(c.provider_link_id);
      if (!o.ok && o.code === "not_found") return abandon(ctx, held, now);
      const cap = o.ok ? captureOf(o.value) : null;
      if (o.ok && cap) return settleCapture(ctx, held, o.value, cap);
      return { state: "processing" };
    }
    case "in_progress":
    case "retry":
      // The claim is kept (a claimed row is never ended locally); it goes stale and the sweep re-fetches the order.
      return { state: "processing" };
    default: {
      // Refused (DUPLICATE_INVOICE_ID, TRANSACTION_REFUSED, PAYMENT_DENIED, MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED, an issue we don't know). Early check 2
      // finding 2: the order is asked first: a capture there is settled (never dropped). Else the claim is released and the row failed in ONE batch, so no poll,
      // event or sweep claims this order again and the next "Pay with PayPal" makes a new one; the Owner is told (`capture_refused`); the client reads Declined
      // with no way back to this order. The order unreadable now: the claim is KEPT (it goes stale, and the sweep asks the order again).
      const o = await api.getOrder(c.provider_link_id);
      const cap = o.ok ? captureOf(o.value) : null;
      if (o.ok && cap) return settleCapture(ctx, held, o.value, cap);
      if (!o.ok && o.code !== "not_found") return { state: "processing" };
      const code = answer.error.issue;
      await mutateSystem(env, {
        ...actorOf(src, c),
        auditId: ids(),
        main: [
          paypalCaptureReleaseStatement(db, { id: c.id, claim: now, now }),
          checkoutFailStatement(db, { id: c.id, now, from: "open", claim: now }),
        ],
        action: "payment.link_end",
        entityType: "checkout_session",
        entityId: c.id,
        summary: { checkoutId: c.id, documentId: c.document_id, status: "failed", refused: code ?? true },
      });
      await reviewOnlyOf(ctx, held, "capture_refused", null, factsOf(c, null, code ? { code } : {}));
      return { state: "declined" };
    }
  }
}

// ---- the callers ------------------------------------------------------------------------------------------------------------------------------------------------

/** `PortalPayments.capturePayPalReturn` (L19): our checkout by its id; PayPal's `token`, when present, must be its order. A state only crosses back. */
export async function capturePayPalReturn(
  env: GatewayEnv,
  a: { checkoutId: string; token: string | null },
  now = Date.now(),
  ids: Ids = uuidv7,
): Promise<{ state: CaptureReturnState; retryUrl?: string }> {
  const c = await env.DB.prepare(CHECKOUT_BY_ID_SQL).bind(a.checkoutId).first<CheckoutRow>();
  if (c?.provider !== "paypal" || !c.provider_link_id) return { state: "not_found" };
  // Early check 2 finding 6: this public route answers only for an EMAILED link's checkout (`source = 'link'`); a signed-in one returns through its own
  // invoice page (`refreshForClient` with its checkout id, bound to the session's client). OPEN (run file "Not verified"): `token` becomes required once the
  // owner's sandbox run shows PayPal always appends it to the return URL.
  if (c.source !== "link") return { state: "not_found" };
  if (a.token !== null && a.token !== c.provider_link_id) return { state: "not_found" };
  return payPalReturnOf(env, c, now, ids);
}

/**
 * The client's return from PayPal's page for checkout `c` (the emailed link's route, or the signed-in page's refresh naming it): the capture path (C steps 1 to
 * 9) as the contact, in the return's words. Money with the Owner, or nothing asked yet: "Checking your payment…" (07-ZN line 4), and the page polls.
 */
export async function payPalReturnOf(
  env: GatewayEnv,
  c: CheckoutRow,
  now = Date.now(),
  ids: Ids = uuidv7,
): Promise<{ state: CaptureReturnState; retryUrl?: string }> {
  const out = await capturePayPalCheckout(env, c, { kind: "return" }, now, ids, false);
  if (out.state === "review" || out.state === "retry") return { state: "processing" };
  return out.retryUrl ? { state: out.state, retryUrl: out.retryUrl } : { state: out.state };
}

/** A refresh's words for a capture outcome (the sweep, the portal's poll, "Check now"). */
const refreshResultOf = (o: CaptureOutcome): RefreshResult["result"] =>
  o.state === "paid" ||
  o.state === "pending" ||
  o.state === "expired" ||
  o.state === "changed" ||
  o.state === "declined"
    ? "processed"
    : o.state === "review"
      ? "needs_review"
      : o.state === "retry"
        ? "retry"
        : o.state === "not_found"
          ? "no_open_link"
          : "unchanged";

/**
 * `refreshCheckout` for a PayPal checkout (L14: no new queue kind; `gateway.refresh`, the portal's refresh and "Check now" reach the capture path): claimed for the
 * refresh first, so at most one runs a minute and every outcome writes `last_refresh_at` (the sweep's reads skip it for 15 minutes); then `capturePayPalCheckout`.
 */
export async function refreshPayPalCheckout(
  env: GatewayEnv,
  checkout: CheckoutRow,
  src: CaptureSource,
  now = Date.now(),
  ids: Ids = uuidv7,
): Promise<RefreshResult["result"]> {
  if (!checkout.provider_link_id || !["live", "stale", "capture_pending"].includes(checkout.status))
    return "no_open_link";
  const claim = await checkoutRefreshClaimStatement(env.DB, { id: checkout.id, now }).run();
  if (claim.meta.changes !== 1) return "too_soon";
  return refreshResultOf(await capturePayPalCheckout(env, checkout, src, now, ids, true));
}

/** The refresh's words for the return's state (the signed-in page's return through `refreshForClient`, early check 2 finding 3). */
export const refreshResultOfReturn = (state: CaptureReturnState): RefreshResult["result"] =>
  refreshResultOf({ state });

// ---- events (run file C `processPayPalEvent`) ----------------------------------------------------------------------------------------------------------------------

type EventRow = { id: string; provider: string; event_type: string; attempts: number; facts: string | null };
const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);

/** An event outcome in the RPC's words; `processing` (a capture in flight, PayPal not reached) comes back later. */
const eventResultOf = (o: CaptureOutcome): ProcessEventResult =>
  o.state === "processing" || o.state === "retry"
    ? { result: "retry" }
    : o.state === "review"
      ? { result: "needs_review" }
      : o.state === "not_found" || o.state === "not_completed"
        ? { result: "ignored" }
        : { result: "processed" };

/**
 * One stored, verified PayPal event (the caller counted the try and found it `received`). The row holds only whitelisted facts (core `payPalEventFacts`): the order
 * (`linkId`), the capture (`paymentId`), our checkout id. Everything else is re-fetched from PayPal before anything is written ("B2 must carry" 2: the order too,
 * for the payer's country). An order of ours with no row is an `unknown_link` item; one not ours is ignored (L13).
 */
export async function processPayPalEvent(
  env: GatewayEnv,
  row: EventRow,
  now = Date.now(),
  ids: Ids = uuidv7,
): Promise<ProcessEventResult> {
  const db = env.DB;
  let facts: Record<string, unknown> = {};
  try {
    const v = JSON.parse(row.facts ?? "{}") as unknown;
    if (typeof v === "object" && v !== null) facts = v as Record<string, unknown>;
  } catch {
    facts = {};
  }
  const src: CaptureSource = { kind: "event", eventId: row.id };
  const type = PAYPAL_EVENT_TYPES[row.event_type] ?? "other";
  const orderId = text(facts.linkId);
  const captureId = text(facts.paymentId);
  const checkoutId = text(facts.checkoutId);
  const quiet = async (status: "processed" | "ignored", outcome: string): Promise<ProcessEventResult> => {
    await webhookEventMoveStatement(db, { id: row.id, status, outcome, now }).run();
    return { result: status === "ignored" ? "ignored" : "processed" };
  };
  if (type === "other") return quiet("ignored", "other");
  // A reversal or refund: the payment by its capture (no ledger move until M6.5: a review item and a bell).
  if (type === "payment.reversed" || type === "refund.processed") {
    if (!captureId) return quiet("ignored", "no_capture");
    const p = await db
      .prepare("SELECT id, status, amount_minor, client_id, checkout_id FROM payments WHERE id = ?1")
      .bind(payPalPaymentRowId(captureId))
      .first<{
        id: string;
        status: string;
        amount_minor: number;
        client_id: string;
        checkout_id: string | null;
      }>();
    if (!p || (p.status !== "confirmed" && p.status !== "pending_verification"))
      return quiet("ignored", "no_payment");
    const co = p.checkout_id
      ? await db.prepare(CHECKOUT_BY_ID_SQL).bind(p.checkout_id).first<CheckoutRow>()
      : null;
    // A refund's `invoice_id` (when PayPal sends it) must end in the checkout's own tail (L3); a mismatch is still the payment's, by its capture.
    const tail = invoiceIdCheckoutTail(text(facts.invoiceId));
    const kind = type === "payment.reversed" ? "reversed_after_confirm" : "refunded_outside";
    const reviewId = ids();
    await mutateSystem(env, {
      actorType: "webhook",
      auditId: ids(),
      main: reviewItemStatement(db, {
        id: reviewId,
        source: "webhook",
        provider: "paypal",
        kind,
        webhookEventId: row.id,
        paymentId: p.id,
        documentId: co?.document_id ?? null,
        clientId: p.client_id,
        amountMinor: p.amount_minor,
        currency: "USD",
        facts: {
          linkId: co?.provider_link_id ?? orderId ?? "",
          paymentId: captureId,
          ...(text(facts.refundId) ? { refundId: text(facts.refundId) as string } : {}),
          ...(tail && co && !co.id.endsWith(tail) ? { reason: "invoice_mismatch" } : {}),
        },
        now,
      }),
      action: "payment.gateway_review",
      entityType: "webhook_event",
      entityId: row.id,
      summary: { kind, reviewId, eventId: row.id, paymentId: p.id },
      side: (g: GuardSql) => [
        reviewBellStatement(
          db,
          {
            reviewId,
            title: bellNeedsReview(
              reviewReason(kind, { paidMinor: p.amount_minor, provider: "paypal", currency: "USD" }),
            ),
            link: REVIEW_LINK,
          },
          g,
        ),
        webhookEventMoveStatement(db, { id: row.id, status: "needs_review", outcome: kind, now }, g),
      ],
    });
    // A redelivery whose item already exists (unique per event and kind) moves the event itself.
    await webhookEventMoveStatement(db, { id: row.id, status: "needs_review", outcome: kind, now }).run();
    return { result: "needs_review" };
  }
  // The checkout: by the order (every handled type names it), else (a capture event of an order whose row we lost) by the capture.
  let checkout = orderId
    ? await db.prepare(CHECKOUT_BY_LINK_SQL).bind("paypal", orderId).first<CheckoutRow>()
    : null;
  if (!checkout && captureId)
    checkout = await db.prepare(CHECKOUT_BY_CAPTURE_SQL).bind(captureId).first<CheckoutRow>();
  if (!checkout) {
    // L13: not ours (no UUIDv7 mark): ignored with no review; ours with no row: the Owner is told.
    if (!isUuidV7(checkoutId)) return quiet("ignored", "not_ours");
    const known = await db.prepare(CHECKOUT_BY_ID_SQL).bind(checkoutId).first<CheckoutRow>();
    const mine = known?.provider === "paypal" ? known : null;
    return reviewOnly(
      env,
      { cause: { kind: "event", eventId: row.id }, now, linkId: orderId },
      "unknown_link",
      { documentId: mine?.document_id ?? null, clientId: mine?.client_id ?? null, amountMinor: null },
      { linkId: orderId ?? "", checkoutId, ...(captureId ? { paymentId: captureId } : {}) },
      PAYPAL,
      undefined,
      ids,
    );
  }
  // The approval goes straight to the capture path (it reads the mode and makes its own client); every other type needs the client here.
  if (type === "checkout.approved")
    return eventResultOf(await capturePayPalCheckout(env, checkout, src, now, ids, false));
  const api = payPalOf(env, await payPalModeOfSettings(db));
  if (!api || api.blocked) return { result: "retry" };
  const ctx: Ctx = { env, api, src, now, ids };
  if (type === "checkout.approval_reversed") {
    // Step 0.4 row 19: the order re-fetched; captured after all → settled; else an unclaimed open row ends `failed` (the payer can start again).
    const o = await api.getOrder(checkout.provider_link_id as string);
    if (!o.ok && o.code !== "not_found") return { result: "retry" };
    const cap = o.ok ? captureOf(o.value) : null;
    if (o.ok && cap) return eventResultOf(await settleCapture(ctx, checkout, o.value, cap));
    if (checkout.status !== "live" && checkout.status !== "stale") return quiet("ignored", "no_live_link");
    if (checkout.capture_started_at !== null) return { result: "retry" };
    await mutateSystem(env, {
      actorType: "webhook",
      auditId: ids(),
      main: checkoutFailStatement(db, { id: checkout.id, now, from: "open", claim: null }),
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
        webhookEventMoveStatement(
          db,
          { id: row.id, status: "processed", outcome: "approval_reversed", now },
          g,
        ),
      ],
    });
    await webhookEventMoveStatement(db, {
      id: row.id,
      status: "ignored",
      outcome: "no_live_link",
      now,
    }).run();
    return { result: "processed" };
  }
  // A capture completed, held or declined: the capture and its order re-fetched (the event proves nothing by itself), then judged as the return would be.
  if (!captureId) return quiet("ignored", "no_capture");
  // The capture already recorded (the return captured it first): the event is processed, nothing else, and PayPal isn't asked again.
  const seen = await db.prepare(SEEN_SQL).bind(captureId).first<Seen>();
  if (seen) return eventResultOf(await duplicateOf(ctx, seen));
  // A capture in flight on this row (the return's): the event comes back once that call has answered or its claim went stale ("B2 must carry" 12).
  if (
    (checkout.status === "live" || checkout.status === "stale") &&
    checkout.capture_started_at !== null &&
    checkout.capture_started_at > now - PAYPAL_CLAIM_STALE_MS
  )
    return { result: "retry" };
  const [capR, orderR] = await Promise.all([
    api.getCapture(captureId),
    api.getOrder(checkout.provider_link_id as string),
  ]);
  if (!capR.ok || !orderR.ok) {
    const lost = (!capR.ok && capR.code !== "network") || (!orderR.ok && orderR.code !== "network");
    if (!lost) return { result: "retry" };
    return reviewOnly(
      env,
      { cause: { kind: "event", eventId: row.id }, now, linkId: checkout.provider_link_id },
      "refetch_failed",
      { documentId: checkout.document_id, clientId: checkout.client_id, amountMinor: null },
      factsOf(checkout, null, { paymentId: captureId }),
      PAYPAL,
      undefined,
      ids,
    );
  }
  return eventResultOf(await settleCapture(ctx, checkout, orderR.value, capR.value));
}
