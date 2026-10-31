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
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CURRENCY_CODES, createdAt, currency, id, oneOf } from "./common.ts";
import { clients } from "./crm.ts";
import { advanceReceipts, documents } from "./documents.ts";
import { staffUsers } from "./identity.ts";

/** The values the triggers accept today (L3; M6.2 to M6.5 widen them in their own trigger migrations). */
export const PAYMENT_KINDS = ["payment", "tds"] as const;
export const PAYMENT_PROVIDERS = ["manual"] as const;
export const PAYMENT_STATUSES = ["pending_verification", "confirmed", "rejected", "withdrawn"] as const;
export const PAYMENT_MODES = ["neft", "rtgs", "imps", "upi", "swift"] as const;
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
  },
  (t) => [
    // A client's payments in a currency by the day the money arrived (the statement, the credit balance, the client's figures).
    index("payments_client").on(t.clientId, t.currency, t.receivedOn, t.id),
    // The Owner's "Payments to check" list and the dashboard tile: only the pending rows are in it.
    index("payments_pending")
      .on(t.recordedAt, t.id)
      .where(sql`${t.status} = 'pending_verification'`),
    // The payments register and "collected": only the confirmed rows.
    index("payments_confirmed")
      .on(t.receivedOn, t.id)
      .where(sql`${t.status} = 'confirmed'`),
    // The duplicate-reference check (L12).
    index("payments_reference")
      .on(t.referenceNorm)
      .where(sql`${t.referenceNorm} is not null`),
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
