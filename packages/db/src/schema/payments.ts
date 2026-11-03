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

/**
 * The values the triggers accept today (L3; M6.2 to M6.5 widen them in their own trigger migrations: M6.2's `gateway_triggers` adds Razorpay and its methods, M6.3's
 * `stripe_triggers` adds Stripe, whose modes are `card` and `other`).
 */
export const PAYMENT_KINDS = ["payment", "tds"] as const;
/** M6.4 adds PayPal (`paypal_triggers`, 0068); a PayPal payment's modes are `wallet`, `card` and `other`, already in the list (L22). */
export const PAYMENT_PROVIDERS = ["manual", "razorpay", "stripe", "paypal"] as const;
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
    /**
     * L15: a USD payment may store the bank advice's INR amount, for the register only; GST INR values stay the invoice's (Rule 34). M6.4 L29 (early check 1
     * finding 6): the column means "INR credited as advised": PayPal's `receivable_amount` is net of PayPal's fee; Stripe's (M6.3 `inrFactsOf`) is the gross, an
     * exception M6.5's realisation readers must allow for.
     */
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
    // M6.2 (ADD COLUMN only, 0063; their rules are triggers of `gateway_triggers`, never a CHECK here, which would make drizzle-kit rebuild a referenced table):
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
    // M6.3 (ADD COLUMN only, 0065; held by `stripe_triggers`, never a CHECK here). Stripe settles in INR while the payment is in USD, and `charges_minor` /
    // `fee_tax_minor` are in the payment's own currency (the payments register prints them so), so Stripe's fee never goes there (L10):
    /** Stripe's balance-transaction `fee`, INR paise, absorbed, never billed (Researched 2026-10-28, NPCI FAQ of 15 Sep 2026 (08-C RA-29)); NULL unless in INR. */
    gatewayFeeInrMinor: integer("gateway_fee_inr_minor"),
    /** The tax in that fee (Σ `fee_details` of type `tax`), INR paise; NULL unless in INR. OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our GSTIN? */
    gatewayFeeTaxInrMinor: integer("gateway_fee_tax_inr_minor"),
    /**
     * M6.5 (L4, L39; ADM-PAY-09; ADD COLUMN only, 0069, with NO CHECK: a table-level CHECK would make drizzle-kit rebuild `payments`, which other tables
     * reference): the payment receipt (`documents` row of type `receipt`, id `rct_` + this payment's id), set once by the receipt's issue batch (trigger
     * `payments_receipt_link`, 0070). Not a GST document (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-39)).
     */
    receiptDocumentId: text("receipt_document_id").references((): AnySQLiteColumn => documents.id),
  },
  (t) => [
    // M6.5 (L4): one receipt per payment (the receipt's own primary key `rct_` + payment id already makes it one per payment; this keeps the link unique too).
    uniqueIndex("payments_receipt").on(t.receiptDocumentId).where(sql`${t.receiptDocumentId} is not null`),
    // M6.5 (L3, L5): the hourly receipt sweep reads only the confirmed money-received rows still without a receipt, oldest confirmation first.
    index("payments_receipt_due")
      .on(t.verifiedAt, t.id)
      .where(sql`${t.status} = 'confirmed' and ${t.kind} = 'payment' and ${t.receiptDocumentId} is null`),
    // M6.2: one row per gateway payment, whichever event or refresh brings it (a replay with a new event id still finds this key).
    uniqueIndex("payments_provider_ref")
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    // M6.2: a document's online payments through its links (the Payments panel, the portal's Pay now block).
    index("payments_checkout").on(t.checkoutId).where(sql`${t.checkoutId} is not null`),
    // M6.3 (L11, ADM-INV-17): the "Proof awaited" filter: a card or PayPal receipt (M6.4) with no proof file yet, pending or confirmed, by the day the money arrived.
    // Proof of realisation: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05): keep the bank advice or e-FIRA; for a PA-CB, the settlement report.
    index("payments_proof_awaited")
      .on(t.receivedOn, t.id)
      .where(
        sql`${t.provider} in ('stripe', 'paypal') and ${t.proofR2Key} is null and ${t.status} in ('pending_verification', 'confirmed')`,
      ),
    // M6.4 (L12): a gateway's (or the bank's: `manual`) confirmed payments by the day the money arrived: the "Without advice" list and the monthly advice
    // reminder read one provider's range here, then seek `realisation_advice_payments_active` for each.
    index("payments_confirmed_provider")
      .on(t.provider, t.receivedOn, t.id)
      .where(sql`${t.status} = 'confirmed' and ${t.kind} = 'payment'`),
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
// CREATE TABLE only (0063). As in M6.1 (L3), the enumeration columns have no CHECK: the triggers of `gateway_triggers` (0064) hold them, so M6.3/M6.4 widen a list
// with a trigger swap, never a rebuild of a table other tables reference. Nothing here stores a raw webhook body, a payer's email, phone, UPI address or card
// detail (L8; ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40); Researched 2026-10-28, RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07)): `facts` is a whitelist the code builds.

/** M6.2 Razorpay; M6.3 Stripe (`stripe_triggers`, 0066); M6.4 PayPal (`paypal_triggers`, 0068). */
export const GATEWAY_PROVIDERS = ["razorpay", "stripe", "paypal"] as const;
export const WEBHOOK_EVENT_STATUSES = ["received", "processed", "ignored", "needs_review", "failed"] as const;
export const CHECKOUT_SOURCES = ["portal", "link", "staff"] as const;
/** M6.4: `capture_pending`, a PayPal capture PayPal holds (no payment row until it completes, L6). */
export const CHECKOUT_STATUSES = [
  "creating",
  "live",
  "paid",
  "expired",
  "cancelled",
  "stale",
  "failed",
  "capture_pending",
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
  "unreadable_event",
  // M6.3 (lead, 2026-11-02): a USD card payment with an India-issued card (or none stated) waits for the Owner (08-C RA-38).
  "not_export_receipt",
  // M6.4 PayPal (core `REVIEW_KINDS`; the 0068 triggers hold the list).
  "capture_pending",
  "capture_denied",
  "capture_refused",
  "reversed_after_confirm",
  "refunded_outside",
  "late_capture",
  // M6.4 review part 1, finding 1: a capture PayPal reports as not final (core `judgePayPalCapture` step 4).
  "not_final",
  // M6.5 (0070 `review_items_values_*`): a gateway refused our refund, a refund the sweep could not settle after its tries, a dispute opened or closed (L7: review
  // only, no ledger move; the Owner records the refund).
  "refund_failed",
  "refund_stuck",
  "dispute_opened",
  "dispute_closed",
] as const;
/**
 * Provider references are generic (lead, 2026-11-01, M6.3/M6.4 briefs session): up to 255 characters, so a Stripe Checkout Session id (66 in Stripe's fixture, 5000
 * in its OpenAPI, 255 as Stripe advises) or a PayPal id fits without a rebuild of a referenced table later. Razorpay's ids are short; its fallback event id is
 * `sha256:` and the body's SHA-256 in base64url (50 characters).
 */
export const WEBHOOK_EVENT_ID_MAX = 255;
/** A hosted checkout's URL (Stripe's can be long); `https://` only, and the portal keeps a host allow-list per provider. */
export const CHECKOUT_SHORT_URL_MAX = 5000;
export const PROVIDER_REF_MAX = 255;
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
    /** Whitelisted facts only, as JSON (link id, payment id, amount, currency, method, account id; L8; 08-C RB-40). */
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
    /** The contact who asked: signed in (`portal`) or the contact the emailed link is bound to (`link`); NULL for `staff`, and once the contact is erased or anonymised. */
    contactId: text("contact_id").references(() => contacts.id),
    /** The emailed document link's token hash the request came through (`link`), else NULL; cleared with the contact (the token row is deleted then). */
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
    // M6.4 PayPal (ADD COLUMN only, 0067; held by triggers of `paypal_triggers`, 0068, never a CHECK here: a table-level CHECK would make drizzle-kit rebuild
    // `checkout_sessions`, which `payments.checkout_id` references):
    /** PayPal's capture id, set once: with `capture_pending` or `paid`, or on an ended row by the never-drop batch (run file C step 9). ≤ 64. */
    providerCaptureId: text("provider_capture_id"),
    /** The capture claim (L2): the instant one call took the right to capture; moves forward, or back to NULL (a release), only while live or stale. */
    captureStartedAt: integer("capture_started_at"),
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
    // Early check 1, finding 1: the erase and anonymise of a contact unlink its checkouts (`deleteContactAccess`).
    index("checkout_sessions_contact").on(t.contactId),
    // ... and the token delete's trigger finds a link's checkouts by the token (0064 `checkout_sessions_unlink_token`).
    index("checkout_sessions_token").on(t.docTokenId).where(sql`${t.docTokenId} is not null`),
    // M6.4: one checkout per PayPal capture (a replayed capture can't land on a second row).
    uniqueIndex("checkout_sessions_capture")
      .on(t.provider, t.providerCaptureId)
      .where(sql`${t.providerCaptureId} is not null`),
    // M6.4 (Step 0.1, 0.2 item 10): the sweep's read of captures PayPal holds, oldest first (only those rows are in it).
    index("checkout_sessions_capture_pending")
      .on(t.updatedAt, t.id)
      .where(sql`${t.status} = 'capture_pending'`),
    // M6.4: the sweep's reads of open PayPal checkouts (a stale claim to refresh, an unclaimed one past its grace to expire); stale rows are not in
    // `checkout_sessions_open`, so they need their own.
    index("checkout_sessions_paypal_open")
      .on(t.expiresAt, t.id)
      .where(sql`${t.provider} = 'paypal' and ${t.status} in ('live', 'stale')`),
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
    /** Whitelisted facts only, as JSON (L8; 08-C RB-40). */
    facts: text("facts"),
    createdAt: createdAt(),
    resolvedBy: text("resolved_by").references(() => staffUsers.id),
    resolvedAt: integer("resolved_at"),
    resolution: text("resolution"),
    note: text("note"),
  },
  (t) => [
    // One item of a kind per event, whichever retry writes it (INSERT OR IGNORE).
    uniqueIndex("review_items_event_kind")
      .on(t.webhookEventId, t.kind)
      .where(sql`${t.webhookEventId} is not null`),
    index("review_items_payment").on(t.paymentId),
    // The erase (an anonymised client's review notes are cleared).
    index("review_items_client").on(t.clientId),
    // The "Needs review" list by status, oldest first (open by default, resolved on request; early check 1, "For B2" 11), and the open count.
    index("review_items_status").on(t.status, t.createdAt, t.id),
    // Early check 1, finding 10: a document's review items (its Payments panel; every foreign key indexed).
    index("review_items_document").on(t.documentId),
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

// ---- M6.4: remittance advices (L12; ADM-INV-17; run file A3) --------------------------------------------------------------------------------------------
// Proof of realisation: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05): keep the bank advice or e-FIRA; for a PA-CB, the settlement report
// mapped to the invoice. PayPal India's FIRA is weekly since February 2026, all withdrawals of a week in one FIRA, kept by PayPal for the last 12 months only
// (Settled by the lead on the safest reading, 2026-11-02 (08-C RA-38)), so ONE advice proves MANY payments: an advice table and a link table. Generic for PayPal,
// Stripe and the bank (a FIRC for a SWIFT receipt recorded by hand). CREATE TABLE only (0067). The enumerations (`provider`, `kind`, `file_mime`) have no CHECK:
// the triggers of `paypal_triggers` (0068) hold them, so a later list widens with a trigger swap, never a rebuild of `realisation_advices`, which the link table
// references. The file is write-once in the private R2 `DOCS` (never the file vault).

/** Whose advice it is: a gateway's (PayPal's e-FIRA, Stripe's settlement advice) or the bank's (a FIRC; its payments are `manual` ones). */
export const ADVICE_PROVIDERS = ["paypal", "stripe", "bank"] as const;
export const ADVICE_KINDS = ["efira", "fira", "firc", "brc", "settlement_report", "other"] as const;
export const ADVICE_REF_MAX = 64;
export const ADVICE_NOTE_MAX = 500;
export const ADVICE_REMOVE_REASON_MAX = 200;
/** At most this many payments are linked to an advice in one request (run file C). */
export const ADVICE_LINK_MAX = 50;

export const realisationAdvices = sqliteTable(
  "realisation_advices",
  {
    id: id(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    /** The advice's own reference as printed (the FIRA or FIRC number). */
    adviceRef: text("advice_ref").notNull(),
    /** ISO date the advice was issued. */
    issuedOn: text("issued_on").notNull(),
    /** The period it covers (a weekly FIRA), when printed. */
    periodFrom: text("period_from"),
    periodTo: text("period_to"),
    /** The INR total as printed, for the register only: never a GST value (Rule 34 values stay the invoice's). */
    inrTotalMinor: integer("inr_total_minor"),
    // The file, set once (write-once in `DOCS`: `advices/<id>/file-<sha256>`).
    fileR2Key: text("file_r2_key"),
    fileSha256: text("file_sha256"),
    fileMime: text("file_mime"),
    note: text("note"),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    // The list, newest first (keyset `(issued_on, id)`).
    index("realisation_advices_issued").on(t.issuedOn, t.id),
    // One advice per provider, kind and reference (409 `advice_ref_exists`).
    uniqueIndex("realisation_advices_ref").on(t.provider, t.kind, t.adviceRef),
    check(
      "realisation_advices_ref_length",
      sql`length(${t.adviceRef}) between 1 and ${sql.raw(String(ADVICE_REF_MAX))}`,
    ),
    check("realisation_advices_issued_on", sql`date(${t.issuedOn}) IS ${t.issuedOn}`),
    check(
      "realisation_advices_period",
      sql`(${t.periodFrom} is null or date(${t.periodFrom}) IS ${t.periodFrom}) and (${t.periodTo} is null or date(${t.periodTo}) IS ${t.periodTo}) and (${t.periodFrom} is null or ${t.periodTo} is null or ${t.periodFrom} <= ${t.periodTo})`,
    ),
    check("realisation_advices_inr_total", sql`${t.inrTotalMinor} is null or ${t.inrTotalMinor} > 0`),
    check(
      "realisation_advices_file",
      sql`(${t.fileR2Key} is null and ${t.fileSha256} is null and ${t.fileMime} is null) or (length(${t.fileR2Key}) between 1 and 200 and length(${t.fileSha256}) = 64 and ${t.fileMime} is not null)`,
    ),
    check(
      "realisation_advices_note_length",
      sql`${t.note} is null or length(${t.note}) <= ${sql.raw(String(ADVICE_NOTE_MAX))}`,
    ),
  ],
);

export const realisationAdvicePayments = sqliteTable(
  "realisation_advice_payments",
  {
    // Its own id (early check 1 finding 9): a payment taken off an advice by mistake can be linked to the same advice again (a new row).
    id: id(),
    adviceId: text("advice_id")
      .notNull()
      .references(() => realisationAdvices.id),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
    // A link taken off by the Owner, with a reason, set once (the row stays: the history of what proved what).
    removedBy: text("removed_by").references(() => staffUsers.id),
    removedAt: integer("removed_at"),
    removeReason: text("remove_reason"),
  },
  (t) => [
    // An advice's links (its payments list).
    index("realisation_advice_payments_advice").on(t.adviceId),
    // A payment's advice (its detail, the "Proof awaited" filter).
    index("realisation_advice_payments_payment").on(t.paymentId),
    // A payment is on at most one advice at a time (409 `already_linked`); the "Without advice" list seeks it.
    uniqueIndex("realisation_advice_payments_active").on(t.paymentId).where(sql`${t.removedAt} is null`),
    check(
      "realisation_advice_payments_removed",
      sql`(${t.removedBy} is null and ${t.removedAt} is null and ${t.removeReason} is null) or (${t.removedBy} is not null and ${t.removedAt} is not null and length(trim(${t.removeReason})) between 1 and ${sql.raw(String(ADVICE_REMOVE_REASON_MAX))})`,
    ),
  ],
);

// ---- M6.5: refunds, settlements, bank matches and FEMA reductions (ADM-PAY-08, -09, -10, ADM-INV-17; run file docs/runs/m6.5-receipts-refunds.md A, L33 to L39) -----
// CREATE TABLE only (0069; `payments` gains `receipt_document_id` by ADD COLUMN). As in M6.1 (L3), the enumeration columns have no CHECK: the triggers of
// `refund_triggers` (0070) hold them, so a later milestone widens a list with a trigger swap, never a rebuild of a table other tables reference. Nothing here stores a
// card or bank credential (ADM-PAY-12; Researched 2026-10-28, RBI PA Directions 2025, Annex 1 2.1 (08-C RB-07)).

/** Who returns the money: by hand (a bank transfer we make) or through the gateway the payment came by (0070 `payment_refunds_values_*`). */
export const REFUND_PROVIDERS = ["manual", "razorpay", "stripe", "paypal"] as const;
/** What started the refund: the Owner in the admin, a refund made in the gateway's dashboard and recorded afterwards (L7), or a lost dispute. */
export const REFUND_ORIGINS = ["owner", "outside", "chargeback"] as const;
export const REFUND_STATUSES = ["requested", "processing", "succeeded", "failed"] as const;
/** A manual refund's bank mode (0060's five bank modes). */
export const REFUND_MODES = ["neft", "rtgs", "imps", "upi", "swift"] as const;
/** Researched 2026-10-28, RBI PA Directions 2025 para 10(f) (08-C RB-24): to the original method, or to another account in the payer's own name at their request. */
export const REFUND_PAID_TO = ["original", "own_account"] as const;
export const REFUND_REASONS = [
  "credit_note",
  "overpayment",
  "duplicate",
  "tds_payback",
  "chargeback",
  "other",
] as const;
export const REFUND_NOTE_MAX = 500;
export const REFUND_FAILURE_CODE_MAX = 64;
export const REFUND_PROVIDER_STATUS_MAX = 32;

export const paymentRefunds = sqliteTable(
  "payment_refunds",
  {
    /** A UUIDv7 the SPA picks once per dialog: the idempotency key, also sent to the gateway (Razorpay `receipt`, Stripe `Idempotency-Key`, PayPal `PayPal-Request-Id`). */
    id: id(),
    /** The source payment: confirmed money, or (L33) a pending gateway payment refunded in full. */
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    /** The invoice whose excess is refunded (a `release` row of exactly this amount is written in the same batch, after this row); NULL: from credit or pending. */
    documentId: text("document_id").references(() => documents.id),
    /** The credit note that made that excess (Q1 A: the credit note comes first). */
    creditNoteId: text("credit_note_id").references(() => documents.id),
    /** The release row written in the same batch (set once, after it exists). */
    releaseAllocationId: text("release_allocation_id").references(() => paymentAllocations.id),
    provider: text("provider").notNull(),
    origin: text("origin").notNull(),
    status: text("status").notNull(),
    /** A manual refund's bank mode; NULL for a gateway refund. */
    mode: text("mode"),
    paidTo: text("paid_to"),
    reasonCode: text("reason_code").notNull(),
    currency: currency(),
    amountMinor: integer("amount_minor").notNull(),
    /** M6.1 L15: a USD refund's INR amount as the bank advised it, for the register only (never a GST value). */
    inrRefundedMinor: integer("inr_refunded_minor"),
    /** `normaliseReference` of the bank's reference (UTR) of a manual refund. */
    referenceNorm: text("reference_norm"),
    /** ISO date a manual refund was paid. */
    paidOn: text("paid_on"),
    /** The gateway's refund id (or, for a chargeback, the dispute id); set once. */
    providerRefundId: text("provider_refund_id"),
    providerStatus: text("provider_status"),
    failureCode: text("failure_code"),
    note: text("note"),
    requestedBy: text("requested_by").references(() => staffUsers.id),
    requestedAt: integer("requested_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at"),
    settledAt: integer("settled_at"),
    /** The IST day the refund succeeded (set with `succeeded`): "Collected" subtracts it by this day (L9). */
    settledOn: text("settled_on"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    // L8: one open refund per payment (two at once: the second INSERT fails, 409 `refund_in_progress`).
    uniqueIndex("payment_refunds_open")
      .on(t.paymentId)
      .where(sql`${t.status} in ('requested', 'processing')`),
    uniqueIndex("payment_refunds_provider_ref")
      .on(t.provider, t.providerRefundId)
      .where(sql`${t.providerRefundId} is not null`),
    // The free-money sum of a payment (`paymentRefundedSql`) and a payment's refunds.
    index("payment_refunds_payment").on(t.paymentId, t.status),
    index("payment_refunds_client").on(t.clientId, t.requestedAt, t.id),
    index("payment_refunds_document").on(t.documentId),
    index("payment_refunds_credit_note").on(t.creditNoteId),
    // Early check 1, finding 8: one release belongs to one refund.
    uniqueIndex("payment_refunds_release")
      .on(t.releaseAllocationId)
      .where(sql`${t.releaseAllocationId} is not null`),
    // The Refunds tab (finding 10): all statuses, and one status, newest first.
    index("payment_refunds_list").on(t.requestedAt, t.id),
    index("payment_refunds_status_list").on(t.status, t.requestedAt, t.id),
    index("payment_refunds_requested_by").on(t.requestedBy),
    // `refund.sweep`: the refunds still open, by their last attempt.
    index("payment_refunds_pending")
      .on(t.lastAttemptAt, t.id)
      .where(sql`${t.status} in ('requested', 'processing')`),
    // "Collected" net of refunds by the day they succeeded (L9), and the refunds register.
    index("payment_refunds_settled").on(t.settledOn, t.id).where(sql`${t.status} = 'succeeded'`),
    check("payment_refunds_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("payment_refunds_amount", sql`${t.amountMinor} > 0`),
    check(
      "payment_refunds_inr_refunded",
      sql`${t.inrRefundedMinor} is null or (${t.currency} = 'USD' and ${t.inrRefundedMinor} > 0)`,
    ),
    check(
      "payment_refunds_reference_length",
      sql`${t.referenceNorm} is null or length(${t.referenceNorm}) between 1 and ${sql.raw(String(PAYMENT_REFERENCE_MAX))}`,
    ),
    check("payment_refunds_paid_on", sql`${t.paidOn} is null or date(${t.paidOn}) IS ${t.paidOn}`),
    check(
      "payment_refunds_settled_on",
      sql`${t.settledOn} is null or date(${t.settledOn}) IS ${t.settledOn}`,
    ),
    check(
      "payment_refunds_provider_ref_length",
      sql`${t.providerRefundId} is null or length(${t.providerRefundId}) between 1 and ${sql.raw(String(PROVIDER_REF_MAX))}`,
    ),
    check(
      "payment_refunds_provider_status_length",
      sql`${t.providerStatus} is null or length(${t.providerStatus}) between 1 and ${sql.raw(String(REFUND_PROVIDER_STATUS_MAX))}`,
    ),
    check(
      "payment_refunds_failure_code_length",
      sql`${t.failureCode} is null or length(${t.failureCode}) between 1 and ${sql.raw(String(REFUND_FAILURE_CODE_MAX))}`,
    ),
    check(
      "payment_refunds_note_length",
      sql`${t.note} is null or length(${t.note}) <= ${sql.raw(String(REFUND_NOTE_MAX))}`,
    ),
    check("payment_refunds_attempts", sql`${t.attempts} >= 0`),
  ],
);

/** Razorpay's settlements (ADM-PAY-10, L11); the provider list is held by triggers (0070), so another gateway's payouts are added without a rebuild. */
export const SETTLEMENT_PROVIDERS = ["razorpay"] as const;
export const SETTLEMENT_ENTITY_TYPES = ["payment", "refund", "adjustment", "transfer", "other"] as const;
export const SETTLEMENT_DIRECTIONS = ["credit", "debit"] as const;
export const SETTLEMENT_MATCHES = ["matched", "unmatched", "ignored"] as const;
export const SETTLEMENT_REF_MAX = 64;
export const SETTLEMENT_STATUS_MAX = 32;

export const settlements = sqliteTable(
  "settlements",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** The gateway's settlement id (Razorpay `setl_…`). */
    settlementId: text("settlement_id").notNull(),
    /** The bank's UTR of the transfer to us. */
    utr: text("utr"),
    currency: currency(),
    /** Net credited to our bank account (minor units). */
    amountMinor: integer("amount_minor").notNull(),
    /** The gateway's fees and the GST on them, absorbed (OPEN (08-C RA-29): is GST charged on the MDR and invoiced to our GSTIN?). */
    feesMinor: integer("fees_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    settledAt: integer("settled_at"),
    /** The IST day of the settlement. */
    settledOn: text("settled_on").notNull(),
    status: text("status"),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [
    uniqueIndex("settlements_provider_ref").on(t.provider, t.settlementId),
    index("settlements_settled").on(t.settledOn, t.id),
    check("settlements_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("settlements_amounts", sql`${t.amountMinor} >= 0 and ${t.feesMinor} >= 0 and ${t.taxMinor} >= 0`),
    check(
      "settlements_ref_length",
      sql`length(${t.settlementId}) between 1 and ${sql.raw(String(SETTLEMENT_REF_MAX))} and (${t.utr} is null or length(${t.utr}) between 1 and ${sql.raw(String(SETTLEMENT_REF_MAX))})`,
    ),
    check("settlements_settled_on", sql`date(${t.settledOn}) IS ${t.settledOn}`),
    check(
      "settlements_status_length",
      sql`${t.status} is null or length(${t.status}) between 1 and ${sql.raw(String(SETTLEMENT_STATUS_MAX))}`,
    ),
  ],
);

export const settlementItems = sqliteTable(
  "settlement_items",
  {
    id: id(),
    /** NULL while the gateway lists the item as not yet settled. */
    settlementId: text("settlement_id").references(() => settlements.id),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    /** The gateway's id of the payment, refund or adjustment. */
    entityId: text("entity_id").notNull(),
    direction: text("direction").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    feeMinor: integer("fee_minor").notNull().default(0),
    taxMinor: integer("tax_minor").notNull().default(0),
    paymentId: text("payment_id").references(() => payments.id),
    refundId: text("refund_id").references(() => paymentRefunds.id),
    match: text("match").notNull(),
    /** 1 when the gateway's fee differs from what the payment row recorded (`charges_minor`, `fee_tax_minor`). */
    feeMismatch: integer("fee_mismatch").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("settlement_items_entity").on(t.provider, t.entityType, t.entityId),
    index("settlement_items_settlement").on(t.settlementId),
    // The "Unmatched" tab reads only these rows.
    index("settlement_items_unmatched").on(t.createdAt, t.id).where(sql`${t.match} = 'unmatched'`),
    index("settlement_items_payment").on(t.paymentId),
    index("settlement_items_refund").on(t.refundId),
    check(
      "settlement_items_amounts",
      sql`${t.amountMinor} >= 0 and ${t.feeMinor} >= 0 and ${t.taxMinor} >= 0`,
    ),
    check("settlement_items_fee_mismatch", sql`${t.feeMismatch} in (0, 1)`),
    check(
      "settlement_items_entity_length",
      sql`length(${t.entityId}) between 1 and ${sql.raw(String(PROVIDER_REF_MAX))}`,
    ),
  ],
);

/** "Seen in the bank statement" (ADM-PAY-10, L11): the Owner's tick that a payment, a settlement or a refund is on the bank statement. */
export const BANK_MATCH_TARGETS = ["payment", "settlement", "refund"] as const;
export const BANK_MATCH_REF_MAX = 64;
export const BANK_MATCH_REASON_MAX = 200;

export const bankMatches = sqliteTable(
  "bank_matches",
  {
    id: id(),
    targetKind: text("target_kind").notNull(),
    paymentId: text("payment_id").references(() => payments.id),
    settlementId: text("settlement_id").references(() => settlements.id),
    refundId: text("refund_id").references(() => paymentRefunds.id),
    /** ISO date of the bank statement line. */
    statementOn: text("statement_on").notNull(),
    statementRef: text("statement_ref"),
    matchedBy: text("matched_by")
      .notNull()
      .references(() => staffUsers.id),
    matchedAt: integer("matched_at").notNull(),
    // Undone once, by an active Owner, with a reason (the row stays).
    removedBy: text("removed_by").references(() => staffUsers.id),
    removedAt: integer("removed_at"),
    removeReason: text("remove_reason"),
  },
  (t) => [
    uniqueIndex("bank_matches_payment")
      .on(t.paymentId)
      .where(sql`${t.paymentId} is not null and ${t.removedAt} is null`),
    uniqueIndex("bank_matches_settlement")
      .on(t.settlementId)
      .where(sql`${t.settlementId} is not null and ${t.removedAt} is null`),
    uniqueIndex("bank_matches_refund")
      .on(t.refundId)
      .where(sql`${t.refundId} is not null and ${t.removedAt} is null`),
    index("bank_matches_matched_by").on(t.matchedBy),
    index("bank_matches_removed_by").on(t.removedBy),
    check("bank_matches_statement_on", sql`date(${t.statementOn}) IS ${t.statementOn}`),
    check(
      "bank_matches_statement_ref",
      sql`${t.statementRef} is null or length(${t.statementRef}) between 1 and ${sql.raw(String(BANK_MATCH_REF_MAX))}`,
    ),
    check(
      "bank_matches_removed",
      sql`(${t.removedBy} is null and ${t.removedAt} is null and ${t.removeReason} is null) or (${t.removedBy} is not null and ${t.removedAt} is not null and length(trim(${t.removeReason})) between 1 and ${sql.raw(String(BANK_MATCH_REASON_MAX))})`,
    ),
  ],
);

/**
 * RB-43 (Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43)): a reduction of an export invoice's value to be realised, allowed by the AD bank under
 * FEMA 23(R)/2026-RB Reg. 6 at our request, recorded by the Owner (step-up) with the bank's reference and its letter (write-once in `DOCS`). Append-only; the EDF
 * keeps the invoice's full value (Reg. 3(2)); the invoice is FEMA-realised only once what was paid plus these reductions covers its total (`stageSql`).
 */
export const REDUCTION_NOTE_MAX = 500;

export const realisationReductions = sqliteTable(
  "realisation_reductions",
  {
    id: id(),
    /** An issued export invoice (trigger). */
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    currency: currency(),
    amountMinor: integer("amount_minor").notNull(),
    /** ISO date of the bank's approval. */
    approvedOn: text("approved_on").notNull(),
    bankRef: text("bank_ref").notNull(),
    /** 1: allowed on our declaration (up to ₹10 lakh per services invoice, Reg. 6); 0: on the bank's approval of a request with reasons. */
    declaration: integer("declaration").notNull().default(0),
    letterR2Key: text("letter_r2_key"),
    letterSha256: text("letter_sha256"),
    letterMime: text("letter_mime"),
    note: text("note"),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("realisation_reductions_document").on(t.documentId, t.approvedOn),
    index("realisation_reductions_recorded_by").on(t.recordedBy),
    check("realisation_reductions_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("realisation_reductions_amount", sql`${t.amountMinor} > 0`),
    check("realisation_reductions_approved_on", sql`date(${t.approvedOn}) IS ${t.approvedOn}`),
    check(
      "realisation_reductions_bank_ref",
      sql`length(${t.bankRef}) between 1 and ${sql.raw(String(BANK_REF_MAX))}`,
    ),
    check("realisation_reductions_declaration", sql`${t.declaration} in (0, 1)`),
    check(
      "realisation_reductions_letter",
      sql`(${t.letterR2Key} is null and ${t.letterSha256} is null and ${t.letterMime} is null) or (length(${t.letterR2Key}) between 1 and 200 and length(${t.letterSha256}) = 64 and ${t.letterMime} is not null)`,
    ),
    check(
      "realisation_reductions_note_length",
      sql`${t.note} is null or length(${t.note}) <= ${sql.raw(String(REDUCTION_NOTE_MAX))}`,
    ),
  ],
);
