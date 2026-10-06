// Commercial documents (docs/05 §5.2–5.4): one table for every type. Issued (frozen) documents are protected
// by triggers in the hand-written migration (see migrations/*_triggers.sql). VERIFY WITH CA/LEGAL throughout.
import type { Series } from "@techaust/core";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { SCHEDULE_TRIGGERS } from "./catalogue.ts";
import { CURRENCY_CODES, createdAt, currency, flag, id, oneOf, updatedAt } from "./common.ts";
import { type Address, carePlans, clients, contacts, milestones, projects } from "./crm.ts";
import { staffUsers } from "./identity.ts";
import { termsVersions } from "./settings.ts";

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

/** What the recipient looked like at issue (documents never change when the client record does). */
export type RecipientSnapshot = {
  legalName: string;
  displayName?: string;
  gstin?: string;
  stateCode?: string;
  address?: Address;
  email?: string;
  country: string;
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
    termsVersionId: text("terms_version_id").references(() => termsVersions.id),
    snapshotR2Key: text("snapshot_r2_key"),
    snapshotSha256: text("snapshot_sha256"),
    pdfR2Key: text("pdf_r2_key"),
    pdfSha256: text("pdf_sha256"),
    frozenAt: integer("frozen_at"),
    issuedBy: text("issued_by").references(() => staffUsers.id),
    voidedAt: integer("voided_at"),
    voidReason: text("void_reason"),
    realisationDueAt: integer("realisation_due_at"),
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
    uniqueIndex("documents_series_fy_number").on(t.series, t.fy, t.number),
    uniqueIndex("documents_number_display")
      .on(t.series, t.numberDisplay)
      .where(sql`${t.numberDisplay} is not null`),
    uniqueIndex("documents_version")
      .on(t.versionGroupId, t.version)
      .where(sql`${t.versionGroupId} is not null`),
    index("documents_client_type_status").on(t.clientId, t.type, t.status),
    index("documents_status_due").on(t.status, t.dueDate),
    index("documents_parent").on(t.parentId),
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

export const DISCOUNT_KINDS = ["fixed", "percent"] as const;

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
  },
  (t) => [uniqueIndex("acceptances_document").on(t.documentId)],
);

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
    index("approvals_requested_by").on(t.requestedBy, t.status),
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
  ],
);
