// The gateway's statements (M6.2 Razorpay in test mode; ADM-PAY-02, -06, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file docs/runs/m6.2-razorpay.md B, C, D). Plain SQL
// text and statement builders for the caller's own `db.batch()` (the admin finance Worker's `GatewayEvents` and `PortalPayments` entrypoints and routes, the jobs
// Worker's dead-letter consumer; stage B2). Subpath export (`@techaust/db/gateway`): no Drizzle schema, no zod.
//
// Every write follows the ledger's shape (`ledger.ts`): ONE main statement whose WHERE holds every guard; the caller's audit row written only when it changed a
// row; side statements guarded on that audit row AND on the main row this very batch wrote; `ledger_result` last and never guarded. A main statement that matches
// nothing writes nothing at all, and the caller re-reads to explain why (a duplicate, a link no longer live, a document no longer payable: the review path).
//
// Nothing here stores a raw webhook body, a payer's email, phone, UPI address or card detail (L8; ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40); Researched 2026-10-28, RBI PA Directions 2025,
// Annex 1 2.1 (08-C RB-07)): `facts` are whitelists the caller builds (core `eventFacts`).
import { ledgerResultStatement, recomputeStatement } from "./ledger.ts";
import type { GuardSql } from "./log.ts";
import { livePaidSql, liveTdsSql, onlinePayableSql, paymentNetSql } from "./sql-rules.ts";

export type { GuardSql };

/** A guard's SQL at the first placeholder after `used` values, and its values. */
const guarded = (g: GuardSql | undefined, used: number): { sql: string; params: readonly unknown[] } =>
  g ? { sql: ` AND ${g.sql(used + 1)}`, params: g.params } : { sql: "", params: [] };

/** Two guards, both required (the second's placeholders follow the first's values). */
const both = (a: GuardSql | undefined, b: GuardSql): GuardSql =>
  a
    ? { sql: (at) => `${a.sql(at)} AND ${b.sql(at + a.params.length)}`, params: [...a.params, ...b.params] }
    : b;

/** Bell rows for every active Owner (`INSERT OR IGNORE`: one per owner, kind and entity), guarded. The words are the caller's (07-ZI line 22). */
function ownerBells(
  db: D1Database,
  b: { kind: string; entityType: string; entityId: string; title: string; link: string },
  g: GuardSql | undefined,
): D1PreparedStatement {
  const gs = guarded(g, 5);
  return db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
       SELECT 'n_' || lower(hex(randomblob(16))), o.id, ?1, ?2, ?3, ?4, ?5 FROM staff_users o WHERE o.role = 'owner' AND o.status = 'active'${gs.sql}`,
    )
    .bind(b.kind, b.entityType, b.entityId, b.title, b.link, ...gs.params);
}

// ---- what may be paid online, in SQL (the twin of core `payableOnline`) -------------------------------------------------------------------------------

// `onlinePayableSql` lives in `sql-rules.ts` (the portal's summary reads it without this module) and is re-exported here.
export { onlinePayableSql };

/** What document `d` still owes from the allocation rows themselves (the trigger `payment_allocations_bounds`' own figure, so the two can never disagree). */
const liveBalanceSql = (d: string) =>
  `(${d}.total_minor - ${d}.credited_minor - ${livePaidSql(`${d}.id`)} - ${liveTdsSql(`${d}.id`)})`;

// ---- checkouts (payment links) ------------------------------------------------------------------------------------------------------------------------

/** At most this many links per client per hour (run file C: 429 `too_many_links`). */
export const LINKS_PER_CLIENT_HOUR = 10;
/** A link's status is re-fetched at most once a minute (`refreshForClient`). */
export const REFRESH_SPACING_MS = 60_000;

export type CheckoutCreateArgs = {
  /** A UUIDv7: the row and Razorpay's `reference_id`. */
  id: string;
  provider: "razorpay";
  documentId: string;
  clientId: string;
  source: "portal" | "link" | "staff";
  /** `portal`: the signed-in contact; `link`: the contact the emailed link is bound to. */
  contactId: string | null;
  /** `link`: the emailed link's token hash. */
  docTokenId: string | null;
  /** `staff`: the member. */
  createdBy: string | null;
  amountMinor: number;
  /** The part-payment floor read from Settings › Payment terms (`razorpayMinPartialInrMinor`). */
  floorMinor: number;
  expiresAt: number;
  now: number;
};

/**
 * The `creating` row, written BEFORE Razorpay is called (run file C, "row first"): the unique index `checkout_sessions_open` serialises two clicks (the loser's
 * INSERT fails on it: 409 `link_in_progress`). Every check is in the WHERE (a refusal inserts nothing; the caller explains it from a read): the document is the
 * client's and payable online (`onlinePayableSql`); the amount is at most its balance, at least the floor (never under ₹1) or the balance if lower, and whole rupees on a proforma
 * (core `payAmountVerdict`); the client made fewer than `LINKS_PER_CLIENT_HOUR` links in the last hour; and the actor of the source may pay it: a signed-in contact
 * of the client with portal access who can see finance; an emailed link, live, unrevoked, for this document, bound to that contact whose address still matches; or
 * an active Owner or Staff member. `?1`..`?12`.
 */
export function checkoutCreateStatement(db: D1Database, a: CheckoutCreateArgs): D1PreparedStatement {
  const contactOk = (c: string) =>
    `${c}.client_id = d.client_id AND ${c}.portal_access = 1 AND ${c}.can_see_finance = 1 AND ${c}.anonymised_at IS NULL`;
  return db
    .prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, doc_token_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       SELECT ?1, ?2, d.id, d.client_id, ?4, ?5, ?6, ?7, d.currency, ?8, 'creating', ?9, ?10, ?10
       FROM documents d JOIN clients k ON k.id = d.client_id
       WHERE d.id = ?3 AND d.client_id = ?11 AND ${onlinePayableSql("d", "k")}
         AND ?8 <= d.balance_minor AND ?8 >= min(max(?12, 100), d.balance_minor) AND (d.type <> 'proforma' OR ?8 % 100 = 0)
         AND (SELECT count(*) FROM checkout_sessions r WHERE r.client_id = d.client_id AND r.created_at > ?10 - 3600000) < ${LINKS_PER_CLIENT_HOUR}
         AND CASE ?7
           WHEN 'portal' THEN ?5 IS NULL AND ?6 IS NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = ?4 AND ${contactOk("c")})
           WHEN 'link' THEN ?6 IS NULL AND EXISTS (SELECT 1 FROM doc_access_tokens t JOIN contacts c ON c.id = t.contact_id
             WHERE t.token_hash = ?5 AND t.document_id = d.id AND t.client_id = d.client_id AND t.purpose = 'view_pay' AND t.revoked_at IS NULL AND t.expires_at > ?10
               AND c.id = ?4 AND ${contactOk("c")} AND lower(c.email) = t.email)
           WHEN 'staff' THEN ?4 IS NULL AND ?5 IS NULL AND EXISTS (SELECT 1 FROM staff_users su WHERE su.id = ?6 AND su.status = 'active' AND su.role IN ('owner', 'staff'))
           ELSE 0 END`,
    )
    .bind(
      a.id,
      a.provider,
      a.documentId,
      a.contactId,
      a.docTokenId,
      a.createdBy,
      a.source,
      a.amountMinor,
      a.expiresAt,
      a.now,
      a.clientId,
      a.floorMinor,
    );
}

/** `creating` → `live` once Razorpay made the link: its id, short URL and the expiry Razorpay holds (`?1` id, `?2` link id, `?3` URL, `?4` expiry, `?5` now). */
export function checkoutLiveStatement(
  db: D1Database,
  a: { id: string; providerLinkId: string; shortUrl: string; expiresAt: number; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3, expires_at = ?4, updated_at = max(?5, updated_at + 1)
       WHERE id = ?1 AND status = 'creating'`,
    )
    .bind(a.id, a.providerLinkId, a.shortUrl, a.expiresAt, a.now);
}

/** `creating` → `failed` when Razorpay refused or could not be reached (502 `gateway_error`): the document is free for another link at once. */
export function checkoutFailStatement(db: D1Database, a: { id: string; now: number }): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE checkout_sessions SET status = 'failed', updated_at = max(?2, updated_at + 1) WHERE id = ?1 AND status = 'creating'",
    )
    .bind(a.id, a.now);
}

/**
 * A live or stale link ends: `expired` (Razorpay's `payment_link.expired`, or found expired on a refresh) or `cancelled` (Razorpay's `payment_link.cancelled`, a
 * replaced link cancelled through the API, or the "Cancel link" action). `?1` id, `?2` the end, `?3` now, then the guard.
 */
export function checkoutEndStatement(
  db: D1Database,
  a: { id: string; status: "expired" | "cancelled"; now: number },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 3);
  return db
    .prepare(
      `UPDATE checkout_sessions SET status = ?2, updated_at = max(?3, updated_at + 1) WHERE id = ?1 AND status IN ('live', 'stale')${gs.sql}`,
    )
    .bind(a.id, a.status, a.now, ...gs.params);
}

/** The once-a-minute claim of a status re-fetch (`refreshForClient`): only a live or stale link whose last refresh is a minute old or more; zero rows: `too_soon`. */
export function checkoutRefreshClaimStatement(
  db: D1Database,
  a: { id: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE checkout_sessions SET last_refresh_at = ?2
       WHERE id = ?1 AND status IN ('live', 'stale') AND (last_refresh_at IS NULL OR last_refresh_at <= ?2 - ${REFRESH_SPACING_MS})`,
    )
    .bind(a.id, a.now);
}

/** The checkout builders together (run file B's `checkoutStatements`). */
export const checkoutStatements = {
  create: checkoutCreateStatement,
  live: checkoutLiveStatement,
  fail: checkoutFailStatement,
  end: checkoutEndStatement,
  refreshClaim: checkoutRefreshClaimStatement,
} as const;

const CHECKOUT_COLS =
  "c.id, c.provider, c.document_id, c.client_id, c.contact_id, c.source, c.currency, c.amount_minor, c.status, c.provider_link_id, c.short_url, c.expires_at, c.created_at, c.updated_at, c.last_refresh_at, c.paid_payment_id";

/** The checkout of a Razorpay link (`?1` provider, `?2` the link id): one seek of `checkout_sessions_provider_link`. */
export const CHECKOUT_BY_LINK_SQL = `SELECT ${CHECKOUT_COLS} FROM checkout_sessions c INDEXED BY checkout_sessions_provider_link WHERE c.provider = ?1 AND c.provider_link_id = ?2`;

/** A document's open link (`?1`), if any (at most one: `checkout_sessions_open`). */
export const OPEN_CHECKOUT_SQL = `SELECT ${CHECKOUT_COLS} FROM checkout_sessions c INDEXED BY checkout_sessions_open WHERE c.document_id = ?1 AND c.status IN ('creating', 'live')`;

/** A document's links, newest first, at most 20 (the admin Payments panel and the portal's online block). */
export const DOCUMENT_CHECKOUTS_SQL = `SELECT ${CHECKOUT_COLS} FROM checkout_sessions c INDEXED BY checkout_sessions_document WHERE c.document_id = ?1 ORDER BY c.created_at DESC, c.id DESC LIMIT 20`;

/** How many links a client made since `?2` (UTC ms; the 10-an-hour limit, read to explain a refused create). */
export const CLIENT_LINKS_SINCE_SQL =
  "SELECT count(*) AS n FROM checkout_sessions r INDEXED BY checkout_sessions_client WHERE r.client_id = ?1 AND r.created_at > ?2";

// ---- a gateway payment (the webhook or a status refresh, after the re-fetch) ---------------------------------------------------------------------------

export type GatewayFacts = Readonly<Record<string, string | number>>;

export type GatewayPaymentArgs = {
  provider: "razorpay";
  /** Razorpay's payment id (`pay_...`). */
  providerPaymentId: string;
  /** `payments.id`: `rzp_` and the payment id (core `razorpayPaymentRowId`). */
  paymentId: string;
  checkoutId: string;
  clientId: string;
  documentId: string;
  /** The verified event that led here, or null for a status refresh. */
  webhookEventId: string | null;
  source: "webhook" | "refresh";
  /**
   * `confirmed`: a verified, re-fetched payment that settles a tax invoice or debit note (L5: no Owner step). `pending_verification`: a proforma's payment waiting
   * for its tax invoice (L6), or money that did not match (L7: a mismatch, a document no longer payable), recorded with no ledger move.
   */
  status: "confirmed" | "pending_verification";
  amountMinor: number;
  /** Razorpay's `fee` and `tax` as reported (absorbed: Researched 2026-10-28, NPCI FAQ of 15 Sep 2026 (08-C RA-29)); a missing fee is stored as 0. */
  feeMinor: number;
  feeTaxMinor: number | null;
  /**
   * The IST day of the payment's `created_at` (L11): s.13(2) CGST Act, explanation (the earlier of the book entry and the bank credit), so the payment's own day,
   * never the later settlement day. Settled by the lead on the safest reading, 2026-11-01 (08-C RA-37).
   */
  receivedOn: string;
  /** Core `methodToMode` of Razorpay's method. */
  mode: string;
  /** Core `razorpayReferenceNorm` of the payment id. */
  referenceNorm: string;
  refetchedAt: number;
  now: number;
  /** A confirmed payment: put `min(amount, the document's live balance)` onto the document; any excess stays as credit with an `overpaid` review item (ADM-PAY-06). */
  allocate: { allocationId: string; overpaidReviewId: string; facts: GatewayFacts } | null;
  /** A proforma's pending payment: what the automatic advance (L6) will take, `[{documentId, amountMinor}]`. */
  requestedAllocations: readonly { documentId: string; amountMinor: number }[] | null;
  /** The checkout moves to `paid` with this payment (the two happy paths), and the document's other live links become `stale` (L4). */
  checkoutPaid: boolean;
  staleOthers: boolean;
  /** The event's own move, or null for a refresh. */
  event: { status: "processed" | "needs_review"; outcome: string } | null;
  /** The owners' bell (07-ZI line 22), or null. */
  bell: { kind: string; title: string; link: string } | null;
};

export type GatewayPaymentStatements = {
  /** The INSERT of the payment row, every guard in its WHERE. */
  main: D1PreparedStatement;
  /** After the caller's audit row: each guarded on it and on the row `main` wrote in this batch. */
  side: D1PreparedStatement[];
  /** `ledger_result`, last and unguarded, for a confirmed payment; empty for a pending one. */
  last: D1PreparedStatement[];
  /**
   * The side statements' own guard (the caller's audit row AND this batch's payment row; early check 1, finding 9): a caller appends its own statements after `side`
   * and before `last` with it (T11's `deedDraftStatements` after the recompute).
   */
  guard: GuardSql;
};

/**
 * One gateway payment in ONE batch (run file C, steps 6 to 8). `main` inserts the payment only while: no row has this id or this gateway payment id (a replay with
 * a new event id inserts nothing: JOB-HOOK-02); the checkout is this client's and document's, through this provider, and still live or stale when the payment is
 * confirmed or the checkout is to be paid; the client is live and in the checkout's currency; and, when the payment is put on the document, the document is still a
 * frozen, not void INR tax invoice or debit note of a domestic client. The triggers hold the row's shape (`payments_insert_state`, `payments_gateway_shape`).
 * Then, guarded on the caller's audit row `g` and on this batch's row: the allocation (`INSERT ... SELECT min(amount, live balance)`, nothing when nothing is due),
 * the recompute, the `overpaid` review item when the payment holds an excess (as client credit, ADM-PAY-06; Settled by the lead on the safest reading, 2026-10-31
 * (08-C RA-36): credit held is an advance), the checkout to `paid`, the document's other live links to `stale`, the event's move, the owners' bells; and
 * `ledger_result` last, unguarded. `?` numbering is per statement.
 */
export function recordGatewayPaymentStatements(
  db: D1Database,
  a: GatewayPaymentArgs,
  g?: GuardSql,
): GatewayPaymentStatements {
  const confirmed = a.status === "confirmed";
  // Early check 1, finding 7: a confirmed payment is always put on its document (a confirmed row with no allocation would be credit written without a payable check).
  if (confirmed && !a.allocate)
    throw new TypeError("recordGatewayPaymentStatements: a confirmed payment needs `allocate`");
  const docPayable = `EXISTS (SELECT 1 FROM documents d WHERE d.id = c.document_id AND d.type IN ('tax_invoice', 'debit_note') AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.currency = 'INR')
         AND k.country = 'IN' AND k.gst_status <> 'overseas'`;
  const main = db
    .prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, received_on, mode, reference_norm, requested_allocations,
         recorded_by, recorded_at, verified_by, verified_at, provider_payment_id, checkout_id, fee_tax_minor, refetched_at, webhook_event_id)
       SELECT ?1, c.client_id, 'payment', ?2, ?3, c.currency, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, NULL, CASE ?3 WHEN 'confirmed' THEN ?10 END, ?11, c.id, ?12, ?13, ?14
       FROM checkout_sessions c JOIN clients k ON k.id = c.client_id
       WHERE c.id = ?15 AND c.provider = ?2 AND c.client_id = ?16 AND c.document_id = ?17
         AND (?18 = 0 OR c.status IN ('live', 'stale'))
         AND k.anonymised_at IS NULL AND k.currency = c.currency
         AND NOT EXISTS (SELECT 1 FROM payments x WHERE x.id = ?1)
         AND NOT EXISTS (SELECT 1 FROM payments y INDEXED BY payments_provider_ref WHERE y.provider = ?2 AND y.provider_payment_id = ?11)
         AND (?19 = 0 OR (${docPayable}))
         AND (?3 <> 'confirmed' OR ?19 = 1)`,
    )
    .bind(
      a.paymentId,
      a.provider,
      a.status,
      a.amountMinor,
      a.feeMinor,
      a.receivedOn,
      a.mode,
      a.referenceNorm,
      a.requestedAllocations ? JSON.stringify(a.requestedAllocations) : null,
      a.now,
      a.providerPaymentId,
      a.feeTaxMinor,
      a.refetchedAt,
      a.webhookEventId,
      a.checkoutId,
      a.clientId,
      a.documentId,
      confirmed || a.checkoutPaid ? 1 : 0,
      a.allocate ? 1 : 0,
    );
  // This batch wrote the payment: its id with this batch's instant.
  const made: GuardSql = {
    sql: (at) => `EXISTS (SELECT 1 FROM payments bp WHERE bp.id = ?${at} AND bp.recorded_at = ?${at + 1})`,
    params: [a.paymentId, a.now],
  };
  const gm = both(g, made);
  const side: D1PreparedStatement[] = [];
  if (a.allocate) {
    const g1 = guarded(gm, 4);
    side.push(
      db
        .prepare(
          `INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at)
           SELECT ?1, p.id, d.id, min(p.amount_minor, ${liveBalanceSql("d")}), 'allocate', NULL, ?4
           FROM payments p JOIN documents d ON d.id = ?3
           WHERE p.id = ?2 AND p.status = 'confirmed' AND ${liveBalanceSql("d")} > 0${g1.sql}`,
        )
        .bind(a.allocate.allocationId, a.paymentId, a.documentId, a.now, ...g1.params),
    );
  }
  if (confirmed)
    side.push(recomputeStatement(db, { paymentIds: [a.paymentId], documentIds: [a.documentId] }, a.now, gm));
  if (a.allocate) {
    const g2 = guarded(gm, 7);
    side.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO review_items (id, source, provider, kind, status, webhook_event_id, payment_id, document_id, client_id, amount_minor, currency, facts, created_at)
           SELECT ?1, ?2, p.provider, 'overpaid', 'open', ?3, p.id, ?4, p.client_id, p.amount_minor - ${paymentNetSql("p.id")}, p.currency, ?5, ?6
           FROM payments p WHERE p.id = ?7 AND p.status = 'confirmed' AND p.amount_minor > ${paymentNetSql("p.id")}${g2.sql}`,
        )
        .bind(
          a.allocate.overpaidReviewId,
          a.source,
          a.webhookEventId,
          a.documentId,
          JSON.stringify(a.allocate.facts),
          a.now,
          a.paymentId,
          ...g2.params,
        ),
    );
  }
  if (a.checkoutPaid) {
    const g3 = guarded(gm, 3);
    side.push(
      db
        .prepare(
          `UPDATE checkout_sessions SET status = 'paid', paid_payment_id = ?2, updated_at = max(?3, updated_at + 1)
           WHERE id = ?1 AND status IN ('live', 'stale') AND paid_payment_id IS NULL${g3.sql}`,
        )
        .bind(a.checkoutId, a.paymentId, a.now, ...g3.params),
    );
  }
  if (a.staleOthers) {
    const g4 = guarded(gm, 3);
    side.push(
      db
        .prepare(
          `UPDATE checkout_sessions SET status = 'stale', updated_at = max(?3, updated_at + 1)
           WHERE document_id = ?1 AND id <> ?2 AND status = 'live'${g4.sql}`,
        )
        .bind(a.documentId, a.checkoutId, a.now, ...g4.params),
    );
  }
  if (a.event && a.webhookEventId) {
    const g5 = guarded(gm, 4);
    side.push(
      db
        .prepare(
          `UPDATE webhook_events SET status = ?2, processed_at = ?3, outcome = ?4 WHERE id = ?1 AND status = 'received'${g5.sql}`,
        )
        .bind(a.webhookEventId, a.event.status, a.now, a.event.outcome, ...g5.params),
    );
  }
  if (a.bell)
    side.push(
      ownerBells(
        db,
        {
          kind: a.bell.kind,
          entityType: "payment",
          entityId: a.paymentId,
          title: a.bell.title,
          link: a.bell.link,
        },
        gm,
      ),
    );
  return {
    main,
    side,
    guard: gm,
    last: confirmed
      ? [ledgerResultStatement(db, { paymentIds: [a.paymentId], documentIds: [a.documentId] })]
      : [],
  };
}

// ---- review items ("Needs review") -------------------------------------------------------------------------------------------------------------------

export type ReviewItemArgs = {
  id: string;
  source: "webhook" | "dlq" | "refresh";
  provider: "razorpay";
  /** One of core `REVIEW_KINDS` (the 0064 triggers hold the list). */
  kind: string;
  webhookEventId: string | null;
  paymentId: string | null;
  documentId: string | null;
  clientId: string | null;
  amountMinor: number | null;
  currency: "INR" | "USD" | null;
  /** Whitelisted facts only (L8; 08-C RB-40). */
  facts: GatewayFacts | null;
  now: number;
  /**
   * A status refresh (no event row, so the unique `(webhook_event_id, kind)` cannot dedupe): no second item while one of this kind is open for this link (early
   * check 2, finding 12: each "Try again" press would otherwise add an item and a bell).
   */
  onceOpenForLink?: string | null;
};

/**
 * One review item, `INSERT OR IGNORE` (the unique `(webhook_event_id, kind)` keeps a retried event from adding it twice; `onceOpenForLink` does the same for a
 * refresh through one range of `review_items_status`), guarded when `g` is given (normally on the audit row, and so on the payment row of the same batch). Binds
 * `?1`..`?13`, then the guard.
 */
export function reviewItemStatement(db: D1Database, r: ReviewItemArgs, g?: GuardSql): D1PreparedStatement {
  const gs = guarded(g, 13);
  return db
    .prepare(
      `INSERT OR IGNORE INTO review_items (id, source, provider, kind, status, webhook_event_id, payment_id, document_id, client_id, amount_minor, currency, facts, created_at)
       SELECT ?1, ?2, ?3, ?4, 'open', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
       WHERE (?13 IS NULL OR NOT EXISTS (SELECT 1 FROM review_items ox INDEXED BY review_items_status
         WHERE ox.status = 'open' AND ox.kind = ?4 AND ox.provider = ?3 AND json_extract(ox.facts, '$.linkId') = ?13))${gs.sql}`,
    )
    .bind(
      r.id,
      r.source,
      r.provider,
      r.kind,
      r.webhookEventId,
      r.paymentId,
      r.documentId,
      r.clientId,
      r.amountMinor,
      r.currency,
      r.facts ? JSON.stringify(r.facts) : null,
      r.now,
      r.onceOpenForLink ?? null,
      ...gs.params,
    );
}

/** The bell of a review item this batch wrote (07-ZI line 22, "A payment needs review: {reason}."), guarded on the item's row. Kind `payment.review`. */
export function reviewBellStatement(
  db: D1Database,
  a: { reviewId: string; title: string; link: string },
  g?: GuardSql,
): D1PreparedStatement {
  const made: GuardSql = {
    sql: (at) => `EXISTS (SELECT 1 FROM review_items ri WHERE ri.id = ?${at} AND ri.status = 'open')`,
    params: [a.reviewId],
  };
  return ownerBells(
    db,
    { kind: "payment.review", entityType: "review_item", entityId: a.reviewId, title: a.title, link: a.link },
    both(g, made),
  );
}

/**
 * The "Needs review" list: the items of status `?3` (`open` or `resolved`) oldest first, keyset `(created_at, id)` with `?1`/`?2` (the first page binds -1 and ''),
 * at most 51 (one more than a page), optionally of one kind (`?4`, null: every kind). One seek of `review_items_status`; the client's name (or null once
 * anonymised: the screen shows "Anonymised client") and the document's number and type by primary key, for the list's columns.
 */
export const REVIEW_ITEMS_SQL = `SELECT r.id, r.source, r.provider, r.kind, r.status, r.webhook_event_id, r.payment_id, r.document_id, r.client_id, r.amount_minor, r.currency, r.facts,
     r.created_at, r.resolved_by, r.resolved_at, r.resolution, r.note,
     CASE WHEN k.anonymised_at IS NULL THEN k.display_name END AS client_name, d.number_display AS document_number, d.type AS document_type
   FROM review_items r INDEXED BY review_items_status
   LEFT JOIN clients k ON k.id = r.client_id LEFT JOIN documents d ON d.id = r.document_id
   WHERE r.status = ?3 AND (r.created_at > ?1 OR (r.created_at = ?1 AND r.id > ?2)) AND (?4 IS NULL OR r.kind = ?4)
   ORDER BY r.created_at, r.id LIMIT 51`;

/** How many items wait (the nav count; one range of `review_items_status`). */
export const OPEN_REVIEW_COUNT_SQL =
  "SELECT count(*) AS n FROM review_items r INDEXED BY review_items_status WHERE r.status = 'open'";

// ---- dead letters ---------------------------------------------------------------------------------------------------------------------------------------

export type DeadLetterArgs =
  | { kind: "event"; eventId: string; reviewId: string; now: number; bell: { title: string; link: string } }
  | {
      kind: "payment";
      paymentId: string;
      reviewId: string;
      now: number;
      bell: { title: string; link: string };
    };

/**
 * A gateway message that exhausted its retries (run file D): for a `gateway.event`, the event goes `failed` (outcome `dead_letter`) and a `dead_letter` review item
 * names it, with its whitelisted facts and the checkout's document and client when its link is known; for a `gateway.advance`, a `dead_letter` review item names
 * the pending payment (once: not while one is open for it). Then the owners' bell for the new item. A redelivery adds nothing (the event is no longer `received`;
 * the item is unique per event and kind, or already open for the payment).
 */
export function gatewayDeadLetterStatements(db: D1Database, a: DeadLetterArgs): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  if (a.kind === "event") {
    out.push(
      db
        .prepare(
          "UPDATE webhook_events SET status = 'failed', processed_at = ?2, outcome = 'dead_letter' WHERE id = ?1 AND status = 'received'",
        )
        .bind(a.eventId, a.now),
      db
        .prepare(
          `INSERT OR IGNORE INTO review_items (id, source, provider, kind, status, webhook_event_id, document_id, client_id, amount_minor, currency, facts, created_at)
           SELECT ?1, 'dlq', e.provider, 'dead_letter', 'open', e.id, c.document_id, c.client_id,
             CASE WHEN json_type(e.facts, '$.amountMinor') = 'integer' AND json_extract(e.facts, '$.amountMinor') > 0 THEN json_extract(e.facts, '$.amountMinor') END,
             CASE WHEN json_extract(e.facts, '$.currency') IN ('INR', 'USD') THEN json_extract(e.facts, '$.currency') END,
             e.facts, ?3
           FROM webhook_events e LEFT JOIN checkout_sessions c ON c.provider = e.provider AND c.provider_link_id = json_extract(e.facts, '$.linkId')
           WHERE e.id = ?2 AND e.status = 'failed'`,
        )
        .bind(a.reviewId, a.eventId, a.now),
    );
  } else {
    out.push(
      db
        .prepare(
          `INSERT INTO review_items (id, source, provider, kind, status, payment_id, document_id, client_id, amount_minor, currency, created_at)
           SELECT ?1, 'dlq', p.provider, 'dead_letter', 'open', p.id, json_extract(p.requested_allocations, '$[0].documentId'), p.client_id, p.amount_minor, p.currency, ?3
           FROM payments p WHERE p.id = ?2 AND p.provider = 'razorpay' AND p.status = 'pending_verification'
             AND NOT EXISTS (SELECT 1 FROM review_items x INDEXED BY review_items_payment WHERE x.payment_id = p.id AND x.kind = 'dead_letter' AND x.status = 'open')`,
        )
        .bind(a.reviewId, a.paymentId, a.now),
    );
  }
  out.push(reviewBellStatement(db, { reviewId: a.reviewId, title: a.bell.title, link: a.bell.link }));
  return out;
}

// ---- webhook events (stage B2: the jobs hook writes them, the finance Worker processes them) --------------------------------------------------------------

/**
 * The hook's write (JOB-HOOK-02): one row per provider and event id, `ON CONFLICT DO NOTHING` (a redelivery writes nothing). `?1` row id, `?2` provider, `?3` the
 * event id, `?4` its type, `?5` now, `?6` `received` or `ignored` (a type we do not handle), `?7` the whitelisted facts (JSON, L8; 08-C RB-40).
 */
export const WEBHOOK_EVENT_INSERT_SQL = `INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7) ON CONFLICT (provider, event_id) DO NOTHING`;

/** The row of a provider's event id, after the insert (in the same batch): new, or the earlier one with its status. */
export const WEBHOOK_EVENT_STATE_SQL =
  "SELECT id, status FROM webhook_events INDEXED BY webhook_events_provider_event WHERE provider = ?1 AND event_id = ?2";

/** One stored event (`?1` row id), as `processEvent` reads it. */
export const WEBHOOK_EVENT_READ_SQL =
  "SELECT id, provider, event_id, event_type, status, attempts, facts, received_at FROM webhook_events WHERE id = ?1";

/** A processing try is counted (`attempts` never goes down; trigger `webhook_events_status_flow`), only while the event still waits. */
export function webhookEventAttemptStatement(db: D1Database, id: string): D1PreparedStatement {
  return db
    .prepare("UPDATE webhook_events SET attempts = attempts + 1 WHERE id = ?1 AND status = 'received'")
    .bind(id);
}

/** A waiting event ends: `processed`, `ignored` or `needs_review`, with its outcome code (`?1` id, `?2` status, `?3` now, `?4` outcome), guarded when `g` is given. */
export function webhookEventMoveStatement(
  db: D1Database,
  a: { id: string; status: "processed" | "ignored" | "needs_review"; outcome: string; now: number },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 4);
  return db
    .prepare(
      `UPDATE webhook_events SET status = ?2, processed_at = ?3, outcome = ?4 WHERE id = ?1 AND status = 'received'${gs.sql}`,
    )
    .bind(a.id, a.status, a.now, a.outcome, ...gs.params);
}

/** At most this many stuck events are queued again by one sweep, each at most this many tries (run file D). */
export const SWEEP_LIMIT = 20;
export const SWEEP_MAX_ATTEMPTS = 10;
export const SWEEP_AFTER_MS = 15 * 60_000;

/** The sweep's read: events still `received` 15 minutes after they arrived (`?1` = now − 15 minutes), fewer than 10 tries, oldest first, at most 20 (the partial index only). */
export const STUCK_EVENTS_SQL = `SELECT e.id FROM webhook_events e INDEXED BY webhook_events_received
   WHERE e.status = 'received' AND e.received_at < ?1 AND e.attempts < ${SWEEP_MAX_ATTEMPTS}
   ORDER BY e.received_at, e.id LIMIT ${SWEEP_LIMIT}`;

// ---- a proforma's payment still waiting for its automatic tax invoice (early check 2, finding 2) ----------------------------------------------------------

/**
 * Payment `p` is a proforma's Razorpay payment still waiting for its automatic tax invoice (L6): pending with its requested allocation, no advance receipt yet, its
 * checkout known, and no open `advance_blocked` or `dead_letter` item (the Owner was told and decides; "Try again" or "Confirm by issuing"). Whoever meets such a
 * payment (a duplicate event, the portal's refresh, the hourly sweep) asks for `gateway.advance` again, so the tax invoice is never lost when one `next` was not sent
 * (RA-17: GST on an advance is due on receipt). The open-item check is one seek of `review_items_payment`.
 */
export const advanceWaitingSql = (p: string): string =>
  `(${p}.provider = 'razorpay' AND ${p}.kind = 'payment' AND ${p}.status = 'pending_verification' AND ${p}.requested_allocations IS NOT NULL
     AND ${p}.advance_receipt_id IS NULL AND ${p}.checkout_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM review_items wx INDEXED BY review_items_payment WHERE wx.payment_id = ${p}.id AND wx.status = 'open' AND wx.kind IN ('advance_blocked', 'dead_letter')))`;

/**
 * The payment of an event that is no longer `received` (`?1` the event row) when it still waits for its tax invoice: a redelivered `gateway.event` whose first
 * `next` was lost answers `duplicate` with `next` again. The payment row's id is `rzp_` and Razorpay's payment id (core `razorpayPaymentRowId`): one primary-key seek.
 */
export const EVENT_ADVANCE_WAITING_SQL = `SELECT p.id FROM webhook_events e JOIN payments p ON p.id = 'rzp_' || json_extract(e.facts, '$.paymentId')
   WHERE e.id = ?1 AND e.status <> 'received' AND ${advanceWaitingSql("p")}`;

/**
 * The sweep's second read: up to 20 payments still waiting for their tax invoice 15 minutes after they were recorded (`?1` = now − 15 minutes), oldest first,
 * through the partial index `payments_pending` (only pending rows: Staff-recorded entries and gateway money waiting for a decision).
 */
export const STUCK_ADVANCES_SQL = `SELECT p.id FROM payments p INDEXED BY payments_pending
   WHERE p.status = 'pending_verification' AND p.recorded_at < ?1 AND ${advanceWaitingSql("p")}
   ORDER BY p.recorded_at, p.id LIMIT ${SWEEP_LIMIT}`;

/** The newest event a gateway processed (Settings › Gateways, "Last verified webhook"): one seek of the unique index's provider prefix. */
export const LAST_VERIFIED_EVENT_SQL =
  "SELECT max(received_at) AS at FROM webhook_events INDEXED BY webhook_events_provider_event WHERE provider = ?1";

// ---- the signature-failure counter (L14) -------------------------------------------------------------------------------------------------------------------

/** One counter row per clock-hour window, never per address (RB-12 OPEN: no address is kept). */
export const HOOK_FAILURE_WINDOW_MS = 3_600_000;
/** The owners are told once a window reaches this many failures. */
export const HOOK_FAILURE_ALERT_AT = 5;

/** The window key of `now` for a provider: `<provider>:sig:<window start>`. */
export const hookFailureKey = (provider: string, now: number): string =>
  `${provider}:sig:${now - (now % HOOK_FAILURE_WINDOW_MS)}`;

/**
 * One failure counted (L14): an upsert that never goes past `HOOK_FAILURES_MAX` (the `WHERE count < 50` of the upsert; at the cap nothing is written), then the
 * owners' bell once the window reaches 5 (`INSERT OR IGNORE`: one per owner and window; the words are the caller's, 07-ZI line 22). `?1` key, `?2` window start.
 */
export function hookFailureStatements(
  db: D1Database,
  a: { key: string; windowStart: number; bellTitle: string; bellLink: string },
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO hook_failures (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < 50`,
      )
      .bind(a.key, a.windowStart),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'payment.hook_signature', 'hook_window', ?1, ?2, ?3 FROM staff_users o
         WHERE o.role = 'owner' AND o.status = 'active' AND (SELECT count FROM hook_failures WHERE key = ?1) >= ${HOOK_FAILURE_ALERT_AT}`,
      )
      .bind(a.key, a.bellTitle, a.bellLink),
  ];
}

// ---- review items: resolve, and the erase ------------------------------------------------------------------------------------------------------------------

/**
 * The item's payment meets `cond` (on alias `ip`): the item's own payment, or, for an item written before any payment row (a re-fetch that failed, an unknown link,
 * a dead letter), the payment its facts name or the one that paid its link. Primary key, `payments_provider_ref` and `checkout_sessions_provider_link` seeks.
 */
const itemPaymentSql = (cond: string) =>
  `(EXISTS (SELECT 1 FROM payments ip WHERE ip.id = review_items.payment_id AND ${cond})
     OR (review_items.payment_id IS NULL AND (
       EXISTS (SELECT 1 FROM payments ip INDEXED BY payments_provider_ref
         WHERE ip.provider = review_items.provider AND ip.provider_payment_id = json_extract(review_items.facts, '$.paymentId') AND ${cond})
       OR EXISTS (SELECT 1 FROM checkout_sessions ic INDEXED BY checkout_sessions_provider_link JOIN payments ip ON ip.id = ic.paid_payment_id
         WHERE ic.provider = review_items.provider AND ic.provider_link_id = json_extract(review_items.facts, '$.linkId') AND ${cond}))))`;

/**
 * Resolve is a RECORD of what the money already is, never a move of it (lead decision on early check 2, finding 5): money moves only through `POST
 * /payments/:id/verify` or "Confirm by issuing the tax invoice". So each resolution is refused unless the state says so: `confirmed` only once the item's payment is
 * confirmed; `advance_issued` only once it has its advance receipt (its tax invoice); `left_as_credit` only on an `overpaid` item; `dismissed` always.
 */
export const RESOLUTION_ALLOWED_SQL = `CASE ?4
     WHEN 'dismissed' THEN 1
     WHEN 'left_as_credit' THEN review_items.kind = 'overpaid'
     WHEN 'confirmed' THEN ${itemPaymentSql("ip.status = 'confirmed'")}
     WHEN 'advance_issued' THEN ${itemPaymentSql("ip.advance_receipt_id IS NOT NULL")}
     ELSE 0 END`;

/**
 * The Owner resolves an open item (`?1` id, `?2` member, `?3` now, `?4` resolution, `?5` note or null): only while open (trigger `review_items_status_flow`
 * holds the Owner and the once) and only when the resolution matches the money (`RESOLUTION_ALLOWED_SQL`). Guarded when `g` is given.
 */
export function reviewResolveStatement(
  db: D1Database,
  a: { id: string; by: string; now: number; resolution: string; note: string | null },
  g?: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 5);
  return db
    .prepare(
      `UPDATE review_items SET status = 'resolved', resolved_by = ?2, resolved_at = ?3, resolution = ?4, note = ?5
       WHERE id = ?1 AND status = 'open' AND (${RESOLUTION_ALLOWED_SQL})${gs.sql}`,
    )
    .bind(a.id, a.by, a.now, a.resolution, a.note, ...gs.params);
}

/** One review item (`?1`). */
export const REVIEW_ITEM_READ_SQL = `SELECT r.id, r.source, r.provider, r.kind, r.status, r.webhook_event_id, r.payment_id, r.document_id, r.client_id, r.amount_minor,
     r.currency, r.facts, r.created_at, r.resolved_by, r.resolved_at, r.resolution, r.note
   FROM review_items r WHERE r.id = ?1`;

// The erase of a client clears its review items' notes by the 0064 trigger `review_items_erase_notes` (early check 1, "For B2" 9): no statement here.
