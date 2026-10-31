// The ledger (M6.1; ADM-PAY-01, ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, Q60; run file docs/runs/m6.1-ledger-payments.md, L2 to L19). Three new tables,
// CREATE TABLE only: nothing that exists is rebuilt (`documents` gains `tds_minor` by ALTER TABLE ADD COLUMN).
//   - `payments`: money received (kind `payment`) and tax deducted at source by the client (kind `tds`), append-only apart from the status moves and the
//     set-once columns (triggers of the `payment_triggers` set);
//   - `payment_allocations`: append-only rows that put a confirmed payment on a document (`allocate`) or take an excess back off it (`release`);
//   - `realisation_extensions`: the AD bank's extensions of an export's FEMA realisation date (Q60), append-only.
// The enumeration columns (`kind`, `provider`, `status`, `mode`, the allocation `kind`, the proof MIME types) have NO CHECK (L3): triggers hold them, so a later
// milestone widens a list with a trigger swap, never a rebuild of a table other tables reference. The member columns are nullable for the same reason (a gateway
// payment of M6.2 has no member behind it); the triggers require them for a manual entry.
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { CURRENCY_CODES, createdAt, currency, id, oneOf } from "./common.ts";
import { clients, contacts } from "./crm.ts";
import { advanceReceipts, documents } from "./documents.ts";
import { docAccessTokens, staffUsers } from "./identity.ts";

/** The values the triggers accept today (L3; M6.2 to M6.5 widen them in their own trigger migrations: M6.2's `gateway_triggers` adds Razorpay and its methods). */
export const PAYMENT_KINDS = ["payment", "tds"] as const;
export const PAYMENT_PROVIDERS = ["manual", "razorpay"] as const;
export const PAYMENT_STATUSES = ["pending_verification", "confirmed", "rejected", "withdrawn"] as const;
export const PAYMENT_MODES = [
  "neft",
  "rtgs",
  "imps",
  "upi",
  "swift",
  "card",
  "netbanking",
  "wallet",
  "emi",
  "paylater",
  "other",
] as const;
export const ALLOCATION_KINDS = ["allocate", "release"] as const;
/** Proofs and bank letters (L10): PDF, JPEG or PNG, sniffed by signature as the file vault does, stored write-once in the private R2 `DOCS`. */
export const PROOF_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
/** At most this many invoices one payment asks for or is put on in one go. */
export const PAYMENT_ALLOCATIONS_MAX = 10;
/** M5.2's `normaliseReference` keeps up to 60 characters, and the back-fill carries M5.2's references, so the column holds 60. */
export const PAYMENT_REFERENCE_MAX = 60;
export const PAYMENT_NOTE_MAX = 500;
export const BANK_REF_MAX = 64;

export const payments = sqliteTable(
  "payments",
  {
    /** A UUIDv7 the SPA picks once per dialog: the idempotency key (L12). A back-filled advance receipt's is `pay_` and the receipt's id. */
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    currency: currency(),
    /** What the client paid (L9): this is what settles invoices. Bank charges are absorbed and stored apart. */
    amountMinor: integer("amount_minor").notNull(),
    chargesMinor: integer("charges_minor").notNull().default(0),
    /** ISO date the money arrived (a TDS row: the day of the client's advice). */
    receivedOn: text("received_on").notNull(),
    /** NULL for a TDS row and for a back-filled advance receipt. */
    mode: text("mode"),
    /** `normaliseReference` of the bank or gateway reference (never the raw text). */
    referenceNorm: text("reference_norm"),
    /** L15: a USD payment may store the bank advice's INR amount, for the register only; GST INR values stay the invoice's (Rule 34). */
    inrReceivedMinor: integer("inr_received_minor"),
    /** L6: what Staff asked for, as JSON `[{documentId, amountMinor}]` (at most 10); the Owner may change it at the confirm. Frozen once written. */
    requestedAllocations: text("requested_allocations"),
    // TDS (T8, L8, L19): the client's section and rate as given, then the Form 16A certificate (set once).
    tdsSection: text("tds_section"),
    tdsRateBp: integer("tds_rate_bp"),
    tdsCertificateNo: text("tds_certificate_no"),
    tdsCertificateOn: text("tds_certificate_on"),
    // The proof of the receipt (L11, RB-05 OPEN): free-text type and reference, plus the file once.
    proofKind: text("proof_kind"),
    proofRef: text("proof_ref"),
    proofR2Key: text("proof_r2_key"),
    proofSha256: text("proof_sha256"),
    proofMime: text("proof_mime"),
    /** L4: the M5.2 advance receipt this payment stands for (back-filled, or written by the advance batch). */
    advanceReceiptId: text("advance_receipt_id").references(() => advanceReceipts.id),
    note: text("note"),
    recordedBy: text("recorded_by").references(() => staffUsers.id),
    recordedAt: integer("recorded_at").notNull(),
    verifiedBy: text("verified_by").references(() => staffUsers.id),
    verifiedAt: integer("verified_at"),
    decisionNote: text("decision_note"),
    withdrawnBy: text("withdrawn_by").references(() => staffUsers.id),
    withdrawnAt: integer("withdrawn_at"),
    withdrawReason: text("withdraw_reason"),
    // M6.2 (ADD COLUMN only, 0061; their rules are triggers of `gateway_triggers`, never a CHECK here, which would make drizzle-kit rebuild a referenced table):
    /** The gateway's own payment id (Razorpay's `pay_...`); with `provider`, unique: the real idempotency key of a gateway payment (JOB-HOOK-02). */
    providerPaymentId: text("provider_payment_id"),
    /** The checkout (payment link) the money came through. */
    checkoutId: text("checkout_id").references((): AnySQLiteColumn => checkoutSessions.id),
    /** Razorpay's `tax` on its fee, as Razorpay reports it (`charges_minor` holds its `fee`; both absorbed, never billed: Researched 2026-10-28, NPCI FAQ of 15 Sep 2026 (08-C RA-29)). */
    feeTaxMinor: integer("fee_tax_minor"),
    /** When the payment and its link were re-fetched from the gateway's API before the row was written (ADR 0008: the webhook alone proves nothing). */
    refetchedAt: integer("refetched_at"),
    /** The verified webhook event that led to the row (NULL when a status refresh found it). */
    webhookEventId: text("webhook_event_id").references((): AnySQLiteColumn => webhookEvents.id),
  },
  (t) => [
    // M6.2: one row per gateway payment, whichever event or refresh brings it (a replay with a new event id still finds this key).
    uniqueIndex("payments_provider_ref")
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    // A client's payments in a currency by the day the money arrived (the statement, the credit balance, the client's figures).
    index("payments_client").on(t.clientId, t.currency, t.receivedOn, t.id),
    // The Owner's "Payments to check" list and the dashboard tile: only the pending rows are in it.
    index("payments_pending").on(t.recordedAt, t.id).where(sql`${t.status} = 'pending_verification'`),
    // The payments register and "collected": only the confirmed rows.
    index("payments_confirmed").on(t.receivedOn, t.id).where(sql`${t.status} = 'confirmed'`),
    // The duplicate-reference check (L12).
    index("payments_reference").on(t.referenceNorm).where(sql`${t.referenceNorm} is not null`),
    uniqueIndex("payments_advance_receipt")
      .on(t.advanceReceiptId)
      .where(sql`${t.advanceReceiptId} is not null`),
    check("payments_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("payments_amount", sql`${t.amountMinor} > 0`),
    check("payments_charges", sql`${t.chargesMinor} >= 0`),
    check("payments_received_on", sql`date(${t.receivedOn}) IS ${t.receivedOn}`),
    check(
      "payments_reference_length",
      sql`${t.referenceNorm} is null or length(${t.referenceNorm}) between 1 and ${sql.raw(String(PAYMENT_REFERENCE_MAX))}`,
    ),
    check(
      "payments_inr_received",
      sql`${t.inrReceivedMinor} is null or (${t.currency} = 'USD' and ${t.inrReceivedMinor} > 0)`,
    ),
    check(
      "payments_requested_allocations",
      sql`${t.requestedAllocations} is null or (json_valid(${t.requestedAllocations}) and json_type(${t.requestedAllocations}) = 'array' and json_array_length(${t.requestedAllocations}) between 1 and ${sql.raw(String(PAYMENT_ALLOCATIONS_MAX))})`,
    ),
    check(
      "payments_tds_certificate_on",
      sql`${t.tdsCertificateOn} is null or date(${t.tdsCertificateOn}) IS ${t.tdsCertificateOn}`,
    ),
    check(
      "payments_note_length",
      sql`${t.note} is null or length(${t.note}) <= ${sql.raw(String(PAYMENT_NOTE_MAX))}`,
    ),
  ],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: id(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    amountMinor: integer("amount_minor").notNull(),
    /** `allocate` or `release` (trigger, L3). */
    kind: text("kind").notNull(),
    createdBy: text("created_by").references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("payment_allocations_payment").on(t.paymentId),
    index("payment_allocations_document").on(t.documentId, t.paymentId),
    check("payment_allocations_amount", sql`${t.amountMinor} > 0`),
  ],
);

export const realisationExtensions = sqliteTable(
  "realisation_extensions",
  {
    id: id(),
    /** An issued export invoice (trigger). */
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    /** ISO date: the new last day of the FEMA realisation period, as the AD bank extended it (Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04)). */
    extendedTo: text("extended_to").notNull(),
    /** The AD bank's reference for the extension. */
    bankRef: text("bank_ref").notNull(),
    // The bank's letter, set once (L10: write-once in DOCS).
    letterR2Key: text("letter_r2_key"),
    letterSha256: text("letter_sha256"),
    letterMime: text("letter_mime"),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("realisation_extensions_document").on(t.documentId, t.extendedTo),
    check("realisation_extensions_extended_to", sql`date(${t.extendedTo}) IS ${t.extendedTo}`),
    check(
      "realisation_extensions_bank_ref",
      sql`length(${t.bankRef}) between 1 and ${sql.raw(String(BANK_REF_MAX))}`,
    ),
  ],
);

// ---- M6.2: online payments through a gateway (Razorpay in test mode; ADM-PAY-01, -02, -07, JOB-HOOK-01..03; run file docs/runs/m6.2-razorpay.md A) -------------
// CREATE TABLE only (0061). As in M6.1 (L3), the enumeration columns have no CHECK: the triggers of `gateway_triggers` (0062) hold them, so M6.3/M6.4 widen a list
// with a trigger swap, never a rebuild of a table other tables reference. Nothing here stores a raw webhook body, a payer's email, phone, UPI address or card
// detail (L8; ADM-PAY-12; Researched 2026-10-28, RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07)): `facts` is a whitelist the code builds.

export const GATEWAY_PROVIDERS = ["razorpay"] as const;
export const WEBHOOK_EVENT_STATUSES = ["received", "processed", "ignored", "needs_review", "failed"] as const;
export const CHECKOUT_SOURCES = ["portal", "link", "staff"] as const;
export const CHECKOUT_STATUSES = [
  "creating",
  "live",
  "paid",
  "expired",
  "cancelled",
  "stale",
  "failed",
] as const;
export const REVIEW_SOURCES = ["webhook", "dlq", "refresh"] as const;
export const REVIEW_STATUSES = ["open", "resolved"] as const;
export const REVIEW_RESOLUTIONS = ["confirmed", "advance_issued", "left_as_credit", "dismissed"] as const;
/** The reasons a gateway payment waits for the Owner (07-ZI line 20; core `REVIEW_KINDS` in `@techaust/core/online-pay` is the twin, a db test compares them). */
export const REVIEW_KINDS = [
  "amount_mismatch",
  "currency_mismatch",
  "reference_mismatch",
  "order_mismatch",
  "payment_not_on_link",
  "not_captured",
  "partial_payment",
  "unknown_link",
  "document_not_payable",
  "advance_blocked",
  "refetch_failed",
  "dead_letter",
  "overpaid",
  "proforma_overpaid",
  "client_gone",
] as const;
/** Razorpay's event ids are short; the fallback is `sha256:` and the body's SHA-256 in base64url (50 characters). */
export const WEBHOOK_EVENT_ID_MAX = 64;
export const CHECKOUT_SHORT_URL_MAX = 200;
export const PROVIDER_REF_MAX = 64;
export const REVIEW_NOTE_MAX = 500;
/** The cap of the signature-failure counter per window (L14). */
export const HOOK_FAILURES_MAX = 50;

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** Razorpay's `x-razorpay-event-id` header, else `sha256:` of the body. Not signed, so not the real idempotency key (`payments_provider_ref` is). */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    receivedAt: integer("received_at").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    processedAt: integer("processed_at"),
    /** A short code of what processing did (`processed`, `unknown_link`, ...). */
    outcome: text("outcome"),
    /** Whitelisted facts only, as JSON (link id, payment id, amount, currency, method, account id; L8). */
    facts: text("facts"),
  },
  (t) => [
    uniqueIndex("webhook_events_provider_event").on(t.provider, t.eventId),
    // The sweep (15 minutes stuck in `received`) reads only these rows.
    index("webhook_events_received").on(t.receivedAt, t.id).where(sql`${t.status} = 'received'`),
    check(
      "webhook_events_event_id",
      sql`length(${t.eventId}) between 1 and ${sql.raw(String(WEBHOOK_EVENT_ID_MAX))}`,
    ),
    check("webhook_events_event_type", sql`length(${t.eventType}) between 1 and 64`),
    check("webhook_events_attempts", sql`${t.attempts} >= 0`),
    check("webhook_events_outcome", sql`${t.outcome} is null or length(${t.outcome}) between 1 and 64`),
    check(
      "webhook_events_facts",
      sql`${t.facts} is null or (json_valid(${t.facts}) and json_type(${t.facts}) = 'object' and length(${t.facts}) <= 2000)`,
    ),
  ],
);

export const checkoutSessions = sqliteTable(
  "checkout_sessions",
  {
    /** A UUIDv7: Razorpay's `reference_id` (unique per link, L3) and `notes.checkout_id`. */
    id: id(),
    provider: text("provider").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    /** The signed-in contact who asked (portal), else NULL. */
    contactId: text("contact_id").references(() => contacts.id),
    /** The emailed document link's token hash the request came through (`link`), else NULL. */
    docTokenId: text("doc_token_id").references(() => docAccessTokens.tokenHash),
    /** The member who made it from admin (`staff`), else NULL. */
    createdBy: text("created_by").references(() => staffUsers.id),
    source: text("source").notNull(),
    currency: currency(),
    amountMinor: integer("amount_minor").notNull(),
    status: text("status").notNull(),
    providerLinkId: text("provider_link_id"),
    shortUrl: text("short_url"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at").notNull(),
    /** The last status re-fetch (at most one a minute, in the statement's WHERE). */
    lastRefreshAt: integer("last_refresh_at"),
    paidPaymentId: text("paid_payment_id").references((): AnySQLiteColumn => payments.id),
  },
  (t) => [
    // L4: one open link per document; two clicks at once serialise here (the loser's INSERT fails: 409 `link_in_progress`).
    uniqueIndex("checkout_sessions_open").on(t.documentId).where(sql`${t.status} in ('creating', 'live')`),
    uniqueIndex("checkout_sessions_provider_link")
      .on(t.provider, t.providerLinkId)
      .where(sql`${t.providerLinkId} is not null`),
    // A client's links by time (the 10-an-hour limit) and a document's links (its panel, the stale move).
    index("checkout_sessions_client").on(t.clientId, t.createdAt),
    index("checkout_sessions_document").on(t.documentId, t.createdAt),
    check("checkout_sessions_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("checkout_sessions_amount", sql`${t.amountMinor} > 0`),
    check(
      "checkout_sessions_provider_link_length",
      sql`${t.providerLinkId} is null or length(${t.providerLinkId}) between 1 and ${sql.raw(String(PROVIDER_REF_MAX))}`,
    ),
    check(
      "checkout_sessions_short_url",
      sql`${t.shortUrl} is null or (length(${t.shortUrl}) between 1 and ${sql.raw(String(CHECKOUT_SHORT_URL_MAX))} and ${t.shortUrl} like 'https://%')`,
    ),
  ],
);

export const reviewItems = sqliteTable(
  "review_items",
  {
    id: id(),
    source: text("source").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    webhookEventId: text("webhook_event_id").references(() => webhookEvents.id),
    paymentId: text("payment_id").references(() => payments.id),
    documentId: text("document_id").references(() => documents.id),
    clientId: text("client_id").references(() => clients.id),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    /** Whitelisted facts only, as JSON (L8). */
    facts: text("facts"),
    createdAt: createdAt(),
    resolvedBy: text("resolved_by").references(() => staffUsers.id),
    resolvedAt: integer("resolved_at"),
    resolution: text("resolution"),
    note: text("note"),
  },
  (t) => [
    // The "Needs review" list: only the open items.
    index("review_items_open").on(t.createdAt, t.id).where(sql`${t.status} = 'open'`),
    // One item of a kind per event, whichever retry writes it (INSERT OR IGNORE).
    uniqueIndex("review_items_event_kind")
      .on(t.webhookEventId, t.kind)
      .where(sql`${t.webhookEventId} is not null`),
    index("review_items_payment").on(t.paymentId),
    // The erase (an anonymised client's review notes are cleared).
    index("review_items_client").on(t.clientId),
    check("review_items_amount", sql`${t.amountMinor} is null or ${t.amountMinor} > 0`),
    check("review_items_currency", sql`${t.currency} is null or ${oneOf(t.currency, CURRENCY_CODES)}`),
    check(
      "review_items_facts",
      sql`${t.facts} is null or (json_valid(${t.facts}) and json_type(${t.facts}) = 'object' and length(${t.facts}) <= 2000)`,
    ),
    check(
      "review_items_note_length",
      sql`${t.note} is null or length(${t.note}) <= ${sql.raw(String(REVIEW_NOTE_MAX))}`,
    ),
  ],
);

/** The webhook signature-failure counter (L14): one row per window key, capped at `HOOK_FAILURES_MAX` by the statement's WHERE. */
export const hookFailures = sqliteTable(
  "hook_failures",
  {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [check("hook_failures_count", sql`${t.count} between 0 and ${sql.raw(String(HOOK_FAILURES_MAX))}`)],
);
