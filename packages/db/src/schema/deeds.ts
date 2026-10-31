// The deed of assignment of copyright (T11; 08-C RB-38(a), RB-21; ADM-PRJ-01, ADM-PRJ-04, POR-05; run file docs/runs/t11-deed.md, L1 to L8). One new table,
// CREATE TABLE only: nothing that exists is rebuilt. Nothing references `deeds` (notifications and the audit log name it by a plain id), so its CHECK constraints
// may be widened later by a rebuild of this table alone.
//
// One deed per project (`deeds_project`, unique): made as a `draft` by `deedDraftStatement` (`packages/db/src/deeds.ts`) when the accepted proposal or estimate
// behind a completed project is paid in full (L2, L3); `final` once the Owner finalises it (number, sealed snapshot, unsigned PDF); `signed` once the Owner uploads
// the copy signed with Aadhaar eSign (07-ZE Q4). A draft may be `cancelled` (reason required). The status flow, the freeze after `final`, the set-once columns and
// the delete rule are held by the triggers of the `deed_triggers` set (`src/triggers.ts`).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  type SQLiteColumn,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAt, id, oneOf, updatedAt } from "./common.ts";
import { clients, projects } from "./crm.ts";
import { documents } from "./documents.ts";
import { staffUsers } from "./identity.ts";

export const DEED_STATUSES = ["draft", "final", "signed", "cancelled"] as const;
export type DeedStatus = (typeof DEED_STATUSES)[number];

/** The longest text each Schedule field takes (characters). Core `DEED_SCHEDULE_LIMITS` is the twin (a test compares them). */
export const DEED_SCHEDULE_LIMITS = {
  deliverables: 4000,
  location: 500,
  deliveredDates: 500,
  tools: 2000,
  thirdParty: 4000,
} as const;
export const DEED_ESIGN_TXN_MAX = 100;
export const DEED_CANCEL_REASON_MAX = 500;
/** The largest signed PDF accepted (L4: 10 MB). */
export const DEED_SIGNED_MAX_BYTES = 10 * 1024 * 1024;

const within = (col: SQLiteColumn, max: number) =>
  sql`${col} is null or length(${col}) <= ${sql.raw(String(max))}`;

export const deeds = sqliteTable(
  "deeds",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    /** The accepted proposal or estimate VERSION behind the project (`projects.source_document_id` when the draft was made; trigger). */
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => documents.id),
    status: text("status", { enum: DEED_STATUSES }).notNull().default("draft"),
    // The number (L1): series `deed`, gap-free per FY, assigned in the finalise batch only.
    fy: text("fy"),
    number: integer("number"),
    numberDisplay: text("number_display"),
    /** ISO date (IST) the deed was finalised: "This deed is made on {date_ist}". */
    madeOn: text("made_on"),
    // Schedule 1, the work (L6): the deliverables, the repository or delivery location, the delivered dates. Free text typed by Owner or Staff while a draft.
    schedDeliverables: text("sched_deliverables"),
    schedLocation: text("sched_location"),
    schedDeliveredDates: text("sched_delivered_dates"),
    // Schedule 2, not assigned (L6): the pre-existing tools, the third-party and open-source parts with their licence names ("None" typed explicitly is allowed).
    schedTools: text("sched_tools"),
    schedThirdParty: text("sched_third_party"),
    /** L4: the JSON of every `{…}` value of 07-ZE's text as frozen at finalising (core `DeedSnapshot`), and its SHA-256. The number sits outside it (as an invoice's). */
    snapshot: text("snapshot"),
    snapshotSha256: text("snapshot_sha256"),
    /** The unsigned PDF rendered by the jobs Worker (`pdf.deed`), write-once in the private R2 `DOCS`; set once. */
    unsignedR2Key: text("unsigned_r2_key"),
    unsignedSha256: text("unsigned_sha256"),
    /** The signed copy the Owner uploads (L4): a PDF (signature sniffed), at most 10 MB, write-once in `DOCS` (never the file vault). */
    signedR2Key: text("signed_r2_key"),
    signedSha256: text("signed_sha256"),
    signedSize: integer("signed_size"),
    /** L5: the eSign timestamp (UTC ms; typed by the Owner in IST as the provider shows it) and the provider's transaction ID. */
    esignAt: integer("esign_at"),
    esignTxn: text("esign_txn"),
    finalisedAt: integer("finalised_at"),
    finalisedBy: text("finalised_by").references(() => staffUsers.id),
    signedAt: integer("signed_at"),
    signedBy: text("signed_by").references(() => staffUsers.id),
    cancelledAt: integer("cancelled_at"),
    cancelledBy: text("cancelled_by").references(() => staffUsers.id),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deeds_project").on(t.projectId),
    uniqueIndex("deeds_fy_number").on(t.fy, t.number).where(sql`${t.number} is not null`),
    uniqueIndex("deeds_number_display").on(t.numberDisplay).where(sql`${t.numberDisplay} is not null`),
    // The portal's read: a client's deeds by the accepted version they belong to; the erase batch's delete by client.
    index("deeds_client_source").on(t.clientId, t.sourceDocumentId),
    index("deeds_source").on(t.sourceDocumentId),
    check("deeds_status", oneOf(t.status, DEED_STATUSES)),
    check("deeds_number_length", sql`${t.numberDisplay} is null or length(${t.numberDisplay}) <= 16`),
    check("deeds_fy", sql`${t.fy} is null or ${t.fy} glob '[0-9][0-9][0-9][0-9]'`),
    check("deeds_made_on", sql`${t.madeOn} is null or date(${t.madeOn}) IS ${t.madeOn}`),
    // A number, a date, a snapshot and who finalised exist exactly when the deed is final or signed.
    check(
      "deeds_finalised",
      sql`(${t.status} in ('final', 'signed')) = (${t.number} is not null and ${t.numberDisplay} is not null and ${t.fy} is not null and ${t.madeOn} is not null and ${t.snapshot} is not null and ${t.snapshotSha256} is not null and ${t.finalisedAt} is not null and ${t.finalisedBy} is not null)`,
    ),
    // The signed copy and its eSign details exist exactly when the deed is signed.
    check(
      "deeds_signed",
      sql`(${t.status} = 'signed') = (${t.signedR2Key} is not null and ${t.signedSha256} is not null and ${t.signedSize} is not null and ${t.esignAt} is not null and ${t.esignTxn} is not null and ${t.signedAt} is not null and ${t.signedBy} is not null)`,
    ),
    check(
      "deeds_cancelled",
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancelReason} is not null)`,
    ),
    check("deeds_unsigned_pair", sql`(${t.unsignedR2Key} is null) = (${t.unsignedSha256} is null)`),
    check(
      "deeds_signed_size",
      sql`${t.signedSize} is null or ${t.signedSize} between 1 and ${sql.raw(String(DEED_SIGNED_MAX_BYTES))}`,
    ),
    check(
      "deeds_esign_txn",
      sql`${t.esignTxn} is null or length(trim(${t.esignTxn})) between 1 and ${sql.raw(String(DEED_ESIGN_TXN_MAX))}`,
    ),
    check(
      "deeds_cancel_reason",
      sql`${t.cancelReason} is null or length(trim(${t.cancelReason})) between 1 and ${sql.raw(String(DEED_CANCEL_REASON_MAX))}`,
    ),
    check("deeds_sched_deliverables", within(t.schedDeliverables, DEED_SCHEDULE_LIMITS.deliverables)),
    check("deeds_sched_location", within(t.schedLocation, DEED_SCHEDULE_LIMITS.location)),
    check("deeds_sched_delivered_dates", within(t.schedDeliveredDates, DEED_SCHEDULE_LIMITS.deliveredDates)),
    check("deeds_sched_tools", within(t.schedTools, DEED_SCHEDULE_LIMITS.tools)),
    check("deeds_sched_third_party", within(t.schedThirdParty, DEED_SCHEDULE_LIMITS.thirdParty)),
    check("deeds_snapshot_json", sql`${t.snapshot} is null or json_valid(${t.snapshot})`),
  ],
);
