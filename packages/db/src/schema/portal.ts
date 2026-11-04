// The full client portal (M7.1; POR-09, POR-11, ADM-PAY-05; run file docs/runs/m7.1-portal.md A, L8, L10). Two new tables, CREATE TABLE only: nothing that exists
// is rebuilt (the shared-item indexes on `notes` and `files` are CREATE INDEX only, crm.ts).
//   - `client_requests`: what a contact asks of us from the Profile page (five kinds, L8), already in M7.4's shape: `client_id` is NULL-able and a request may
//     name a lead (`lead_id`, `lead_ref`) or only an address (`requester_email`), because rights requests also come from enquirers and people not in our records,
//     and SQLite can't make a column NULL-able later without a rebuild (forbidden for a table others reference). M7.4 adds its clock by ADD COLUMN;
//   - `payment_notices`: "I've paid" (L10): what a client says it paid, never a payment; Staff record the payment from it (M6.1's pending path).
// The enumeration columns (`kind`, `status`, `outcome`, `via`) have NO CHECK: triggers of the `client_portal_triggers` set (0072) hold them, so M7.4 widens the
// kinds with a trigger swap, never a rebuild. `lead_ref` and `contact_ref` are plain text with no foreign key and no personal data (the id of the lead or
// contact the request was made about): they stay when that row is deleted (`lead_id` and `contact_id` are unlinked by the triggers), so M7.4 can match a request
// to the erase of that exact lead or contact.
import {
  NOTICE_NOTE_MAX,
  NOTICE_REFERENCE_MAX,
  NOTICE_REFERENCE_NORM_MAX,
  REQUEST_CLOSE_NOTE_MAX,
  REQUEST_DETAILS_MAX,
  REQUEST_REF_MAX,
  REQUESTER_EMAIL_MAX,
} from "@techaust/core/portal";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CURRENCY_CODES, createdAt, currency, id, oneOf, updatedAt } from "./common.ts";
import { clients, contacts, leads } from "./crm.ts";
import { documents } from "./documents.ts";
import { staffUsers } from "./identity.ts";
import { payments } from "./payments.ts";

const n = (v: number) => sql.raw(String(v));

export const clientRequests = sqliteTable(
  "client_requests",
  {
    /** UUIDv7. */
    id: id(),
    /** The organisation; every portal insert sets it from the session (NULL only for M7.4's requests from an enquirer or someone not in our records). */
    clientId: text("client_id").references(() => clients.id),
    /** The contact who asked; unlinked (NULL) by `client_requests_unlink_contact` when the contact is erased, `contact_ref` stays. */
    contactId: text("contact_id").references(() => contacts.id),
    /** M7.4: the enquirer (lead) the request is about; unlinked by `client_requests_unlink_lead` when the lead is deleted, `lead_ref` stays. */
    leadId: text("lead_id").references(() => leads.id),
    /** The lead's id as plain text (no foreign key, no personal data), set with `lead_id` at insert and frozen. */
    leadRef: text("lead_ref"),
    /** The contact's id as plain text, set with `contact_id` at insert and frozen (round 4). */
    contactRef: text("contact_ref"),
    /** M7.4: the address of a requester not in our records. */
    requesterEmail: text("requester_email"),
    /** One of `REQUEST_KINDS` (trigger `client_requests_kind`; M7.4 re-creates it with `consent_withdrawal` and `nomination`). */
    kind: text("kind").notNull(),
    /** What the contact asked, as typed; cleared when the contact is erased or anonymised. */
    details: text("details"),
    /** `open` → `closed` once (trigger). */
    status: text("status").notNull().default("open"),
    /** `done` or `declined`, set with the close. */
    outcome: text("outcome"),
    closedBy: text("closed_by").references(() => staffUsers.id),
    closedAt: integer("closed_at"),
    closeNote: text("close_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A client's requests, newest first (the client page's Requests panel, the portal's own list through `client_id = ?1`).
    index("client_requests_client").on(t.clientId, t.createdAt, t.id),
    // The admin list by status, oldest first, and the open count.
    index("client_requests_status").on(t.status, t.createdAt, t.id),
    // One open request per kind per contact (409 `request_open`).
    uniqueIndex("client_requests_open_kind").on(t.contactId, t.kind).where(sql`${t.status} = 'open'`),
    // The daily cap (`REQUESTS_TODAY_SQL`), the contact's own list, and the unlink and erase triggers' `WHERE contact_id = …`.
    index("client_requests_contact").on(t.contactId, t.createdAt),
    // The unlink trigger on every lead delete (the nightly purge): only requests that name a lead are in it.
    index("client_requests_lead").on(t.leadId).where(sql`${t.leadId} is not null`),
    // At least one subject: the organisation, the lead (by its ref, so the unlink can't break this) or the requester's address.
    check(
      "client_requests_subject",
      sql`${t.clientId} is not null or ${t.leadRef} is not null or ${t.requesterEmail} is not null`,
    ),
    check(
      "client_requests_refs",
      sql`(${t.leadRef} is null or length(${t.leadRef}) between 1 and ${n(REQUEST_REF_MAX)}) and (${t.contactRef} is null or length(${t.contactRef}) between 1 and ${n(REQUEST_REF_MAX)})`,
    ),
    check(
      "client_requests_requester_email",
      sql`${t.requesterEmail} is null or (length(${t.requesterEmail}) between 3 and ${n(REQUESTER_EMAIL_MAX)} and ${t.requesterEmail} = lower(${t.requesterEmail}))`,
    ),
    check(
      "client_requests_details_length",
      sql`${t.details} is null or length(${t.details}) between 1 and ${n(REQUEST_DETAILS_MAX)}`,
    ),
    check(
      "client_requests_close_note_length",
      sql`${t.closeNote} is null or length(${t.closeNote}) between 1 and ${n(REQUEST_CLOSE_NOTE_MAX)}`,
    ),
  ],
);

export const paymentNotices = sqliteTable(
  "payment_notices",
  {
    /** UUIDv7. */
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    /** The invoice, debit note or proforma the client says it paid (the document's client and currency: trigger `payment_notices_document`). */
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    /** The contact who sent it (required at insert); unlinked when the contact is erased. */
    contactId: text("contact_id").references(() => contacts.id),
    /** `portal` (signed in) or `link` (the emailed "View & pay" page). */
    via: text("via").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: currency(),
    /** The day the client says it paid (ISO date). */
    paidOn: text("paid_on").notNull(),
    /** The transaction reference as typed (UTR or similar; a reference, never a credential: Researched 2026-10-28, RBI PA Directions 2025 (08-C RB-07)). */
    reference: text("reference").notNull(),
    /** `normaliseReference` of it (M5.2, used by M6.1's payments): the duplicate check's key. */
    referenceNorm: text("reference_norm").notNull(),
    /** The client's note, as typed; cleared when the contact is erased or anonymised. */
    note: text("note"),
    /** `open` → `recorded` (with the payment) or `dismissed`, once (trigger). */
    status: text("status").notNull().default("open"),
    /** The payment Staff recorded from this notice (same client and currency). */
    paymentId: text("payment_id").references(() => payments.id),
    closedBy: text("closed_by").references(() => staffUsers.id),
    closedAt: integer("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // A document's notices (the open count, its Payments panel).
    index("payment_notices_document").on(t.documentId, t.status),
    // The admin "Notices" tab by status, oldest first.
    index("payment_notices_status").on(t.status, t.createdAt, t.id),
    // One open notice per reference per document (409 `notice_duplicate`).
    uniqueIndex("payment_notices_open_reference")
      .on(t.documentId, t.referenceNorm)
      .where(sql`${t.status} = 'open'`),
    // A client's notices (the admin filter, the contact's export).
    index("payment_notices_client").on(t.clientId, t.createdAt),
    // The unlink and erase triggers' `WHERE contact_id = …`.
    index("payment_notices_contact").on(t.contactId).where(sql`${t.contactId} is not null`),
    // The notice a recorded payment came from.
    index("payment_notices_payment").on(t.paymentId).where(sql`${t.paymentId} is not null`),
    check("payment_notices_amount", sql`${t.amountMinor} > 0`),
    check("payment_notices_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("payment_notices_paid_on", sql`date(${t.paidOn}) IS ${t.paidOn}`),
    check(
      "payment_notices_reference_length",
      sql`length(${t.reference}) between 1 and ${n(NOTICE_REFERENCE_MAX)} and length(${t.referenceNorm}) between 1 and ${n(NOTICE_REFERENCE_NORM_MAX)}`,
    ),
    check(
      "payment_notices_note_length",
      sql`${t.note} is null or length(${t.note}) between 1 and ${n(NOTICE_NOTE_MAX)}`,
    ),
  ],
);
