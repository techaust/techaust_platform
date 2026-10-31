// Commercial documents (docs/05 §5.2–5.4): one table for every type. Issued (frozen) documents are protected
// by triggers in the hand-written migration (see migrations/*_triggers.sql). Researched 2026-10-28, rule by rule in 08-C section 1 throughout.
import type { Series } from "@techaust/core";
import type { SealedUdyam } from "@techaust/core/invoices";
import type { ComputedDocument } from "@techaust/core/tax";
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
import { SCHEDULE_TRIGGERS } from "./catalogue.ts";
import { CURRENCY_CODES, createdAt, currency, flag, id, oneOf, updatedAt } from "./common.ts";
import { type Address, carePlans, clients, contacts, milestones, projects } from "./crm.ts";
import { staffUsers } from "./identity.ts";
import { termsBlocks, termsVersions } from "./settings.ts";

export const DOCUMENT_TYPES = [
  "proposal",
  "estimate",
  "proforma",
  "tax_invoice",
  "export_invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "receipt_voucher",
  "refund_voucher",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Which numbering series (core/numbering) each document type uses. */
export const SERIES_OF: Record<DocumentType, Series> = {
  proposal: "proposal",
  estimate: "estimate",
  proforma: "proforma",
  tax_invoice: "invoice",
  export_invoice: "export",
  credit_note: "creditNote",
  debit_note: "debitNote",
  receipt: "receipt",
  receipt_voucher: "receiptVoucher",
  refund_voucher: "refundVoucher",
};

// ADM-PROP-06 (proposals/estimates) and ADM-INV-02 (invoices; "overdue" is computed, not stored).
export const DOCUMENT_STATUSES = [
  "draft",
  "pending_approval",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "revised",
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
  "converted",
  "void",
] as const;

export const SUPPLY_TYPES = ["intra", "inter", "export_lut", "export_igst"] as const;
export const DISCOUNT_KINDS = ["fixed", "percent"] as const;

/** What the recipient looked like at issue (documents never change when the client record does). */
export type RecipientSnapshot = {
  legalName: string;
  displayName?: string;
  gstin?: string;
  stateCode?: string;
  address?: Address;
  email?: string;
  country: string;
  /** M4.3: who the document is addressed to (the contact it was sent to), the client's type and its GST status at send. */
  contactId?: string;
  contactName?: string;
  clientType?: "business" | "individual";
  gstStatus?: "registered" | "unregistered" | "overseas";
  /** M5.2 (LD36): the client's service address when it has one: Rule 46(o), the export invoice's "address of delivery" (Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)). */
  deliveryAddress?: Address;
};

/** The frozen supplier and sender block of a sent proposal or estimate (docs/06 §7: every value comes from the snapshot). */
export type IssuerSnapshot = {
  company: {
    tradeName: string;
    legalName: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string;
    /** The brand logo file the document is printed with (a `BRAND_LOGOS` name, the settings' `logoLight` at send); frozen with it so a later settings change never changes a sent offer (M4.4). */
    logo: string;
    /** Settings "Email on documents" at send, printed in the PDF footer (07-Q Q11); absent on versions sent before it was frozen. */
    email?: string;
  };
  sender: { staffId: string; name: string; email: string };
};

/** The bank details of the INR account as an issued invoice prints them (frozen with it; M5.2 adds the USD/SWIFT block). */
export type InvoiceBankBlock = {
  accountName: string;
  accountNo: string;
  ifsc: string | null;
  bankName: string;
  branch: string | null;
};

/** The USD account of a USD invoice's SWIFT block (M5.2, LD30), frozen with the invoice. `purposeCode` is the RBI purpose code (OPEN (08-C RB-06): which RBI purpose code fits our exports? the bank confirms it). */
export type InvoiceSwiftBlock = {
  accountName: string;
  accountNo: string;
  swift: string;
  bankName: string;
  branch: string | null;
  bankAddress: string | null;
  intermediary: string | null;
  purposeCode: string | null;
};

/**
 * The frozen supplier block of an issued invoice (M5.1, LD4, LD11): the proposal block plus the principal place of business and the phone, the
 * bank block, and the signature as a REFERENCE (key, SHA-256, mime of the content-addressed object in DOCS; the jobs Worker reads and verifies
 * the bytes). The sender is the Settings "billing" address and the staff member who issued it.
 */
export type InvoiceIssuerSnapshot = {
  /**
   * `udyam` (T10, rt2): the Udyam registration as saved in Settings › Company, present ONLY on a tax invoice issued while one was saved (owner, 2026-10-31; 07-ZC
   * line 6; Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a))). Absent on every other document and on every earlier snapshot, so earlier seals are unchanged (L6).
   * Typed as sealed (`SealedUdyam`): written from today's valid settings value, but read back as the value of its day of issue, which a later rule may refuse.
   */
  company: IssuerSnapshot["company"] & { phone?: string; principalPlace?: string; udyam?: SealedUdyam };
  /** `swift` (M5.2) exists only on a USD document that has one: an M5.1 snapshot has no such key and still parses. */
  bank: { inr: InvoiceBankBlock | null; swift?: InvoiceSwiftBlock | null };
  signature: { key: string; sha256: string; mime: string } | null;
  /** Present (false) only when the Owner had switched the checklist's "Authorised signatory" off at issue: the PDF leaves the whole signature block out (07-W 5.6; Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-06)). Absent on every earlier snapshot, so earlier seals are unchanged. Never on a credit or debit note or an invoice for a payment received (T4: those always carry the signature; the freeze WHERE and the trigger `documents_signature_required` refuse it). */
  signatory?: false;
  /** The Rule 46(p) statement printed on the invoice (Settings > Tax at issue), frozen and sealed so a later settings change never changes it (Researched 2026-10-28, Rules 46(p), 50 and 51 CGST Rules (08-C RA-26)). */
  reverseChargeText: string;
  sender: IssuerSnapshot["sender"];
};

export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("draft"),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    projectId: text("project_id").references(() => projects.id),
    carePlanId: text("care_plan_id").references(() => carePlans.id),
    /** Credit/debit note → invoice; tax invoice → proforma; receipt → its payment's document. */
    parentId: text("parent_id"),
    versionGroupId: text("version_group_id"),
    version: integer("version").notNull().default(1),
    series: text("series"),
    fy: text("fy"),
    number: integer("number"),
    numberDisplay: text("number_display"),
    currency: currency(),
    issueDate: text("issue_date"),
    dueDate: text("due_date"),
    validUntil: text("valid_until"),
    supplyType: text("supply_type", { enum: SUPPLY_TYPES }),
    placeOfSupplyCode: text("place_of_supply_code"),
    recipient: text("recipient", { mode: "json" }).$type<RecipientSnapshot>(),
    fxRateMicros: integer("fx_rate_micros"),
    fxDate: text("fx_date"),
    fxSource: text("fx_source"),
    /**
     * Q24 (owner 2026-10-28, 08-C RA-21): the DAY the Owner's statement "no reference rate was published that day" covers (an ISO date; null: not stated). It is the day of supply the statement
     * was made for (a draft: the IST day of the save; a payment received: the day it arrived) and counts only at an issue on that same day. Frozen with the rate.
     */
    fxNoRateDay: text("fx_no_rate_day"),
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    discountMinor: integer("discount_minor").notNull().default(0),
    taxableMinor: integer("taxable_minor").notNull().default(0),
    cgstMinor: integer("cgst_minor").notNull().default(0),
    sgstMinor: integer("sgst_minor").notNull().default(0),
    igstMinor: integer("igst_minor").notNull().default(0),
    roundOffMinor: integer("round_off_minor").notNull().default(0),
    totalMinor: integer("total_minor").notNull().default(0),
    totalInrMinor: integer("total_inr_minor"),
    // Ledger columns: maintained by the ledger (M6), allowed to change after issue.
    paidMinor: integer("paid_minor").notNull().default(0),
    creditedMinor: integer("credited_minor").notNull().default(0),
    balanceMinor: integer("balance_minor").notNull().default(0),
    /**
     * M6.1 (T8, L8, L19; ADM-INV-16): tax the client deducted at source and told us about, summed from its confirmed `tds` payments by the ledger recompute. It
     * reduces the balance (`balance = max(0, total - paid - credited - tds)`); the invoice and its GST stay at full value (Settled by the lead on the safest reading,
     * 2026-10-30 (08-C RA-30)). Only an INR tax invoice or debit note carries one (trigger `documents_tds_bounds`). Added with ALTER TABLE only, no CHECK
     * (`documents` is referenced); mutable after the freeze, like the other ledger columns.
     */
    tdsMinor: integer("tds_minor").notNull().default(0),
    termsVersionId: text("terms_version_id").references(() => termsVersions.id),
    snapshotR2Key: text("snapshot_r2_key"),
    snapshotSha256: text("snapshot_sha256"),
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    frozenAt: integer("frozen_at"),
    issuedBy: text("issued_by").references(() => staffUsers.id),
    // M4.3 (proposals and estimates). The columns M4.4/M4.5 need are reserved here too, so the freeze trigger is recreated once.
    title: text("title"),
    /** Who the document is addressed to (the contact belongs to the client: trigger). */
    contactId: text("contact_id").references(() => contacts.id),
    validityDays: integer("validity_days"),
    /** The document discount as typed: minor units for "fixed", basis points for "percent". */
    discountKind: text("discount_kind", { enum: DISCOUNT_KINDS }),
    discountValue: integer("discount_value"),
    /** LD11: this document's export mode; null = the settings'. */
    exportMode: text("export_mode"),
    /** SHA-256 of the canonical draft content (core `contentHashInput`); every save writes it; an approval is tied to it. */
    contentSha256: text("content_sha256"),
    /** The whole `ComputedDocument` (the lines' INR view included). */
    computed: text("computed", { mode: "json" }).$type<ComputedDocument>(),
    /** Server-only: the sum of the catalogue lines at the catalogue price, the discount guard's reference. */
    catalogueReferenceMinor: integer("catalogue_reference_minor"),
    /** An estimate → its invoice draft, or the first instalment (M4.5): step 1. */
    sourceDocumentId: text("source_document_id").references((): AnySQLiteColumn => documents.id),
    sourceStep: integer("source_step"),
    issuer: text("issuer", { mode: "json" }).$type<IssuerSnapshot>(),
    sentAt: integer("sent_at"),
    // M4.5: the portal's reads and the client's decision. Each can be set once after the freeze (trigger).
    viewedAt: integer("viewed_at"),
    decidedAt: integer("decided_at"),
    decisionReason: text("decision_reason"),
    decisionNote: text("decision_note"),
    decidedContactId: text("decided_contact_id").references(() => contacts.id),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
    realisationDueAt: integer("realisation_due_at"),
    /** M5.2 (LD29): the day the service was completed (ISO date; a tax or export invoice; set once after the freeze, not sealed, not printed). */
    serviceCompletedOn: text("service_completed_on"),
    /** M5.2 (LD23): the optional extra export note (an `export_declaration` block) pinned at issue; frozen. */
    exportDeclarationId: text("export_declaration_id").references(() => termsBlocks.id),
    /**
     * M5.2 (LD37): the JSON of exactly the sealed header keys the other columns cannot give (`{export?, proforma?, advance?}`: the endorsement, the LUT
     * letter, the country name, the notice, the advance reference), written by the freeze and frozen with it; NULL when the document has none (an M5.1
     * tax invoice). The frozen view, the PDF and the seal's verifier read it; nothing is rebuilt from live settings after issue.
     */
    headerExtras: text("header_extras"),
    /**
     * M5.3 (LD46, Q14; Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03)): the client's response to a credit note in the GST portal's Invoice Management System: NULL (not a credit note, or
     * not frozen yet), `pending`, `accepted`, `rejected` or `not_applicable`. NO schema CHECK (a table CHECK would make drizzle-kit rebuild `documents`, which
     * other tables reference): the values are enforced by the triggers of migration 0042. Mutable after the freeze, through `POST /invoices/:id/ims-status` only.
     */
    imsStatus: text("ims_status"),
    // IRP e-invoicing (ADM-INV-14): empty at launch.
    irn: text("irn"),
    ackNo: text("ack_no"),
    ackDate: text("ack_date"),
    signedQr: text("signed_qr"),
    einvStatus: text("einv_status"),
    createdBy: text("created_by").references(() => staffUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // M4.3: a later version of a proposal or estimate keeps its first version's number, so `version` is part of both keys
    // (the number-prefix search reads `documents_number_display` from its first column).
    uniqueIndex("documents_series_fy_number").on(t.series, t.fy, t.number, t.version),
    uniqueIndex("documents_number_display")
      .on(t.numberDisplay, t.series, t.version)
      .where(sql`${t.numberDisplay} is not null`),
    // FX-1 (A0 2; Researched 2026-10-28, Rules 46(b), 50(b), 51(b), 53(1A) CGST Rules (08-C RA-09): a number is unique for the FY, whichever series): no two
    // invoice-family documents print the same number, even from two series. The backstop of core `numberingClashes` (the Settings save). The type list is
    // core `INVOICE_FAMILY` written out (the schema imports types only); `test/number-display-index.test.ts` compares the two.
    uniqueIndex("documents_invoice_number_display")
      .on(t.numberDisplay)
      .where(
        sql`${t.numberDisplay} is not null and ${t.type} in ('proforma', 'tax_invoice', 'export_invoice', 'credit_note', 'debit_note', 'receipt', 'receipt_voucher', 'refund_voucher')`,
      ),
    uniqueIndex("documents_version")
      .on(t.versionGroupId, t.version)
      .where(sql`${t.versionGroupId} is not null`),
    index("documents_client_type_status").on(t.clientId, t.type, t.status),
    index("documents_status_due").on(t.status, t.dueDate),
    index("documents_parent").on(t.parentId),
    index("documents_project").on(t.projectId),
    index("documents_care_plan").on(t.carePlanId),
    index("documents_terms_version").on(t.termsVersionId),
    // M4.3: the lists (newest first; by type; by type and status), the expiry job, one open draft per version group, one document
    // per source step (a repeated conversion is refused), and the contact filter.
    index("documents_type_created").on(t.type, t.createdAt, t.id),
    index("documents_type_status_created").on(t.type, t.status, t.createdAt, t.id),
    index("documents_status_valid_until").on(t.status, t.validUntil),
    uniqueIndex("documents_open_draft")
      .on(t.versionGroupId)
      .where(sql`${t.frozenAt} is null and ${t.versionGroupId} is not null`),
    uniqueIndex("documents_source")
      .on(t.sourceDocumentId, t.sourceStep)
      .where(sql`${t.sourceDocumentId} is not null`),
    index("documents_contact").on(t.contactId),
    // M5.3 (LD38): one open (unfrozen) note draft per parent and type. A draft discarded, issued or deleted with its parent frees the slot.
    uniqueIndex("documents_open_note")
      .on(t.parentId, t.type)
      .where(sql`${t.frozenAt} is null and ${t.type} in ('credit_note', 'debit_note')`),
    // M5.3 (LD46): the IMS list ("credit notes whose client has not answered"), newest first.
    index("documents_note_ims")
      .on(t.type, t.imsStatus, t.createdAt, t.id)
      .where(sql`${t.type} = 'credit_note'`),
    // M5.5b (LD81): the reports read the issued documents of the four GST kinds by issue date (the register, GSTR-1, Table 13), the issued
    // exports (the EDF and the realisation list), and one client's issued documents by date (the statement). Partial, so a draft or a proposal never
    // enters them; each is proved by an EXPLAIN test (`packages/db/test/reports.test.ts`).
    index("documents_issued_on")
      .on(t.issueDate, t.id)
      .where(
        sql`${t.frozenAt} is not null and ${t.type} in ('tax_invoice', 'export_invoice', 'credit_note', 'debit_note')`,
      ),
    index("documents_export_issued")
      .on(t.issueDate, t.id)
      .where(sql`${t.frozenAt} is not null and ${t.type} = 'export_invoice'`),
    index("documents_client_issued")
      .on(t.clientId, t.issueDate, t.id)
      .where(
        sql`${t.frozenAt} is not null and ${t.type} in ('tax_invoice', 'export_invoice', 'credit_note', 'debit_note')`,
      ),
    // M4.4: the PDF sweep reads only frozen documents that have no PDF yet (a small set), oldest first. M5.1 (LD9) widens the predicate to
    // the invoice family (receipts and vouchers have no PDF of their own yet); the type stays in it so a frozen row of any other type
    // never keeps the sweep busy.
    index("documents_pdf_pending")
      .on(t.frozenAt)
      .where(
        sql`${t.frozenAt} is not null and ${t.pdfSha256} is null and ${t.type} in ('proposal', 'estimate', 'tax_invoice', 'export_invoice', 'proforma', 'credit_note', 'debit_note')`,
      ),
    check("documents_type", oneOf(t.type, DOCUMENT_TYPES)),
    check("documents_status", oneOf(t.status, DOCUMENT_STATUSES)),
    check("documents_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("documents_supply_type", sql`${t.supplyType} is null or ${oneOf(t.supplyType, SUPPLY_TYPES)}`),
    // A number exists exactly when the document has been issued/frozen.
    check(
      "documents_numbered_when_frozen",
      sql`(${t.frozenAt} is null and ${t.number} is null) or (${t.frozenAt} is not null and ${t.number} is not null and ${t.numberDisplay} is not null)`,
    ),
    check("documents_number_length", sql`${t.numberDisplay} is null or length(${t.numberDisplay}) <= 16`),
    check("documents_void_reason", sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    check("documents_version", sql`${t.version} >= 1`),
  ],
);

/**
 * Tax invoices made from a proforma for money received (M5.2, LD22, Q9, G-6; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)): one row per `advance-invoice` action,
 * append-only (trigger). `(proforma_id, reference_norm)` is the idempotency key: the same payment reference twice is refused; M6 takes these
 * rows into `payments`. The reference text itself is never stored, only its normal form.
 */
export const advanceReceipts = sqliteTable(
  "advance_receipts",
  {
    id: id(),
    proformaId: text("proforma_id")
      .notNull()
      .references(() => documents.id),
    invoiceId: text("invoice_id")
      .notNull()
      .unique()
      .references(() => documents.id),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    currency: currency(),
    amountMinor: integer("amount_minor").notNull(),
    /** ISO date the money arrived. */
    receivedOn: text("received_on").notNull(),
    /** `normaliseReference` of the bank or gateway reference (upper case, no spaces). */
    referenceNorm: text("reference_norm").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("advance_receipts_proforma_reference").on(t.proformaId, t.referenceNorm),
    index("advance_receipts_client").on(t.clientId, t.createdAt),
    // M5.5b (LD81): the statement reads a client's receipts by the day the money arrived.
    index("advance_receipts_client_received").on(t.clientId, t.receivedOn, t.id),
    check("advance_receipts_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("advance_receipts_amount", sql`${t.amountMinor} > 0`),
  ],
);

/** What a statement PDF prints about the supplier: the company block as it was when the PDF was requested (no bank, no sender). */
export type StatementIssuer = { company: IssuerSnapshot["company"] };

/**
 * The claim that keeps a request for a stored PDF from being queued twice in a short time (review 2026-10-28, finding 8): one row per `<kind>:<document id>` (today `supplier:`, the
 * DUPLICATE FOR SUPPLIER copy), whose `asked_at` is when it was last asked for. The admin API moves it forward only when the last ask is older than 5 minutes (one statement,
 * `changes` says who won), so repeated or parallel downloads of a copy that is not made yet put ONE message on the queue. A throttle, not a record: no triggers, no foreign key
 * (the id is a plain string), nothing personal in it.
 */
export const pdfAsks = sqliteTable("pdf_asks", {
  key: text("key").primaryKey(),
  askedAt: integer("asked_at").notNull(),
});

/**
 * FX-1 (full audit A6 2, JOB-PDF-01): the nightly PDF sweep's memory of each document it could not make. One row per document, written by the jobs Worker only:
 * `last_attempt_at` when the sweep last picked it (the sweep takes the least recently tried first, so a document that keeps failing never holds the front of
 * the 20 slots), `nights` the IST days on which its PDF message ran out of tries (`last_failed_day` keeps a second dead letter of the same day from counting
 * twice). After 3 nights the sweep leaves it alone and the owners get one `pdf.refused` bell; a person's own "try again" still goes straight to the queue.
 * A new table (`documents` is referenced, never rebuilt); no triggers: a work list, not a record, and nothing personal in it.
 */
export const pdfFailures = sqliteTable(
  "pdf_failures",
  {
    documentId: text("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    nights: integer("nights").notNull().default(0),
    lastFailedDay: text("last_failed_day"),
    lastAttemptAt: integer("last_attempt_at"),
  },
  (t) => [check("pdf_failures_nights", sql`${t.nights} >= 0`)],
);

/**
 * The PDF of one client's statement of account for one currency and range (M5.5b, LD79, JOB-PDF-01, Q19, Q57): a CACHE, not a record. A row is made by
 * the admin API (`POST /clients/:id/statement/pdf`), rendered by the jobs Worker (`pdf.statement`), and deleted with its R2 object after 30 days or when the
 * client is anonymised. No triggers on purpose: nothing here is a document or a ledger. The R2 key is `statements/<client id>/<view_sha256>.pdf`, so identical
 * data reuses one object. `issuer` is the company block at the time of the request; the statement's numbers are read when it is rendered.
 */
export const statementPdfs = sqliteTable(
  "statement_pdfs",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    currency: currency(),
    /** The range, ISO dates (IST), inclusive. */
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    issuer: text("issuer", { mode: "json" }).$type<StatementIssuer>().notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
    /** SHA-256 of the canonical statement view without its generation date; set by the consumer. */
    viewSha256: text("view_sha256"),
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    renderedAt: integer("rendered_at"),
    failedAt: integer("failed_at"),
    /** `queue`, `client_anonymised`, `statement_too_long`, `render` ...: a code, never text. */
    failCode: text("fail_code"),
  },
  (t) => [
    index("statement_pdfs_client").on(t.clientId, t.createdAt, t.id),
    index("statement_pdfs_created").on(t.createdAt),
    check("statement_pdfs_currency", oneOf(t.currency, CURRENCY_CODES)),
    check(
      "statement_pdfs_range",
      sql`date(${t.fromDate}) is ${t.fromDate} and date(${t.toDate}) is ${t.toDate} and ${t.fromDate} <= ${t.toDate}`,
    ),
  ],
);

export const documentLines = sqliteTable(
  "document_lines",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    catalogueItemId: text("catalogue_item_id"),
    description: text("description").notNull(),
    sac: text("sac"),
    qtyMilli: integer("qty_milli").notNull(),
    unit: text("unit").notNull(),
    rateMinor: integer("rate_minor").notNull(),
    discountKind: text("discount_kind", { enum: DISCOUNT_KINDS }),
    /** Minor units for "fixed", basis points for "percent". */
    discountValue: integer("discount_value"),
    taxableMinor: integer("taxable_minor").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    cgstMinor: integer("cgst_minor").notNull().default(0),
    sgstMinor: integer("sgst_minor").notNull().default(0),
    igstMinor: integer("igst_minor").notNull().default(0),
    lineTotalMinor: integer("line_total_minor").notNull(),
    /** M4.3, server-only: the catalogue rate when the line was added (the discount guard's reference); never read from a request. */
    catalogueRateMinor: integer("catalogue_rate_minor"),
    /**
     * M4.3, server-only: for a line made from one of a service's default lines, that default line's name in the catalogue (the key it
     * was found by, e.g. a care tier); null otherwise. Copied by the server when the line is added and kept across saves and
     * revisions; never read from a request. The description a person can edit is not a key (M4.3 early check M5).
     */
    catalogueLine: text("catalogue_line"),
    /** M4.3: the second line shown in the portal view (at most 300 characters; the API enforces it). */
    detail: text("detail"),
  },
  (t) => [
    uniqueIndex("document_lines_position").on(t.documentId, t.position),
    check("document_lines_qty", sql`${t.qtyMilli} > 0`),
    check("document_lines_discount", sql`(${t.discountKind} is null) = (${t.discountValue} is null)`),
  ],
);

export const documentSections = sqliteTable(
  "document_sections",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    hidden: flag("hidden"),
    title: text("title"),
    bodyMd: text("body_md"),
  },
  (t) => [uniqueIndex("document_sections_position").on(t.documentId, t.position)],
);

export const paymentSchedules = sqliteTable(
  "payment_schedules",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    trigger: text("trigger", { enum: SCHEDULE_TRIGGERS }).notNull(),
    pctBp: integer("pct_bp").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    milestoneId: text("milestone_id").references(() => milestones.id),
    /** M4.3: "what you get" (at most 300 characters; the API enforces it) and the target date of the timeline table (06 §7.4). */
    detail: text("detail"),
    targetDate: text("target_date"),
  },
  (t) => [
    uniqueIndex("payment_schedules_position").on(t.documentId, t.position),
    check("payment_schedules_trigger", oneOf(t.trigger, SCHEDULE_TRIGGERS)),
    check("payment_schedules_pct", sql`${t.pctBp} between 0 and 10000`),
  ],
);

/** Click-to-accept evidence (ADM-PROP-08). Append-only (trigger); one acceptance per document version. */
export const acceptances = sqliteTable(
  "acceptances",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    sessionId: text("session_id"),
    typedName: text("typed_name").notNull(),
    email: text("email").notNull(),
    acceptedAt: integer("accepted_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    country: text("country"),
    pdfSha256: text("pdf_sha256").notNull(),
    termsVersionId: text("terms_version_id").references(() => termsVersions.id),
    certificateR2Key: text("certificate_r2_key"),
    /** M4.5: how the contact accepted, `session` (signed in) or `link` (the emailed offer link). */
    via: text("via"),
    /** M4.5: SHA-256 of the offer link used (never the link itself); null for a session acceptance. */
    offerLinkHash: text("offer_link_hash"),
    /** M4.5: the document's snapshot hash at acceptance, copied by SQL. */
    snapshotSha256: text("snapshot_sha256"),
  },
  (t) => [
    uniqueIndex("acceptances_document").on(t.documentId),
    index("acceptances_contact").on(t.contactId),
    // M4.5: the sweep finds acceptances older than 10 minutes with no certificate row.
    index("acceptances_accepted_at").on(t.acceptedAt),
  ],
);

/** M5.4 (LD55): `auto` is the send the care-plan auto-issue makes (an invoice; `created_by` is the authorising owner). No CHECK on the column: it is a TS enum. */
export const DOCUMENT_SEND_KINDS = ["send", "resend", "auto"] as const;

/**
 * One row per recipient of a proposal or estimate send (M4.5, ADM-PROP-07). `queued_at` NULL means the email waits for
 * the PDF. `contact_id` and `email` are cleared when the contact is erased or anonymised (a trigger allows only that).
 */
export const documentSends = sqliteTable(
  "document_sends",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    versionGroupId: text("version_group_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    contactId: text("contact_id").references(() => contacts.id),
    email: text("email"),
    attachPdf: integer("attach_pdf").notNull(),
    kind: text("kind", { enum: DOCUMENT_SEND_KINDS }).notNull(),
    queuedAt: integer("queued_at"),
    /** Set once when staff revoke the links: a waiting or queued send is then never emailed (M4.5 fix M1). */
    cancelledAt: integer("cancelled_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("document_sends_document").on(t.documentId),
    index("document_sends_contact").on(t.contactId),
    index("document_sends_waiting").on(t.documentId).where(sql`${t.queuedAt} IS NULL`),
  ],
);

/** The purposes of an offer link. Enforced by the `offer_links_purpose` trigger, not a CHECK (a new one is a trigger swap). */
export const OFFER_LINK_PURPOSES = ["offer", "confirmation"] as const;

/**
 * Emailed links to one offer (all its versions), each bound to one contact (M4.5, POR-06, owner decision 2026-10-25).
 * Only the SHA-256 of the token is stored. Only `revoked_at` may change, once (trigger).
 */
export const offerLinks = sqliteTable(
  "offer_links",
  {
    tokenHash: text("token_hash").primaryKey(),
    sendId: text("send_id").references(() => documentSends.id),
    acceptanceId: text("acceptance_id").references(() => acceptances.id),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    versionGroupId: text("version_group_id").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    /** Lower-cased snapshot of the contact's address; a changed address kills the link. */
    email: text("email").notNull(),
    purpose: text("purpose").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("offer_links_document").on(t.documentId),
    index("offer_links_group").on(t.versionGroupId),
    index("offer_links_contact").on(t.contactId),
    index("offer_links_send").on(t.sendId),
  ],
);

/** The rendered acceptance certificate (M4.5, ADM-PROP-08). Append-only; one per acceptance. */
export const acceptanceCertificates = sqliteTable("acceptance_certificates", {
  acceptanceId: text("acceptance_id")
    .primaryKey()
    .references(() => acceptances.id),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  renderedAt: integer("rendered_at").notNull(),
});

export const APPROVAL_KINDS = ["discount", "issue", "payment_verify", "refund"] as const;
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

export const approvals = sqliteTable(
  "approvals",
  {
    id: id(),
    kind: text("kind", { enum: APPROVAL_KINDS }).notNull(),
    documentId: text("document_id").references(() => documents.id),
    /** References payments (added with the ledger in M6). */
    paymentId: text("payment_id"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => staffUsers.id),
    reason: text("reason"),
    /** SHA-256 of what was approved; a changed document invalidates the approval (ADM-APR-02). */
    contentSha256: text("content_sha256").notNull(),
    status: text("status", { enum: APPROVAL_STATUSES }).notNull().default("pending"),
    decidedBy: text("decided_by").references(() => staffUsers.id),
    decidedAt: integer("decided_at"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("approvals_status").on(t.status, t.createdAt),
    index("approvals_document").on(t.documentId),
    index("approvals_requested_by").on(t.requestedBy, t.status),
    // M4.3: the owner's queue, newest first, with no status filter (`approvals_status` serves a filter by status).
    index("approvals_created").on(t.createdAt, t.id),
    // M5.1: the queue filtered by kind (the discount requests and the issue requests are two lists), newest first.
    index("approvals_kind_created").on(t.kind, t.createdAt, t.id),
    // M4.3: one pending request per document and kind (a second request for the same version is a 409).
    uniqueIndex("approvals_document_pending").on(t.documentId, t.kind).where(sql`${t.status} = 'pending'`),
    // M6.1 (ADM-APR-01, ADM-PAY-05): one pending verification per payment (a Staff entry waits for the Owner once).
    uniqueIndex("approvals_payment_pending")
      .on(t.paymentId)
      .where(sql`${t.status} = 'pending' and ${t.kind} = 'payment_verify'`),
    check("approvals_kind", oneOf(t.kind, APPROVAL_KINDS)),
    check("approvals_status", oneOf(t.status, APPROVAL_STATUSES)),
  ],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    offsetDays: integer("offset_days").notNull(),
    dueAt: integer("due_at").notNull(),
    sentAt: integer("sent_at"),
    emailLogId: text("email_log_id"),
    skippedReason: text("skipped_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reminders_document_offset").on(t.documentId, t.offsetDays),
    index("reminders_due").on(t.sentAt, t.dueAt),
    // M5.4 (ADM-INV-13, LD60): the scan reads only the rows still waiting (`reminders_due` would rescan skipped rows for ever).
    index("reminders_pending")
      .on(t.dueAt, t.id)
      .where(sql`${t.sentAt} is null and ${t.skippedReason} is null`),
  ],
);
