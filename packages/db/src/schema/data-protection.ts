// Data-protection tooling (M7.4; ADM-SET-09, ADM-CLI-05, FRM-05, NFR-9, JOB-CRON-01; run file docs/runs/m7.4-data-protection.md A). New tables only,
// CREATE TABLE: nothing that exists is rebuilt (the columns M7.4 adds to `client_requests`, `contacts` and `leads` are ADD COLUMN, in their own files).
//   - `legal_holds`: the append-only history of legal holds; its trigger mirrors the flag on the client, contact or lead (L3);
//   - `consent_receipts`: the append-only proof of consent (FRM-05, s.6(10)) that outlives the lead purge and an erasure, linked after an erasure only by the
//     keyed hash of the address (Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46));
//   - `r2_deletions`: the durable outbox of stored objects to delete (T7 F2), filled by triggers, drained by jobs;
//   - `retention_runs` and `retention_run_counts`: what each nightly clean-up found and did, counts only (no personal data).
// The enumeration columns have no CHECK: the `data_protection_triggers` set holds them, so a later value is a trigger swap, never a rebuild.
import { LEGAL_HOLD_REASON_MAX } from "@techaust/core/legal-hold";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { flag, id, nowMs } from "./common.ts";
import { contacts, leads } from "./crm.ts";
import { staffUsers } from "./identity.ts";

const n = (v: number) => sql.raw(String(v));

/** The longest R2 key the outbox holds (R2 allows 1,024 bytes; every key we write is far shorter). */
export const R2_KEY_MAX = 512;

export const legalHolds = sqliteTable(
  "legal_holds",
  {
    /** UUIDv7. */
    id: id(),
    /** `client`, `contact` or `lead` (trigger `legal_holds_values`). */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** `set` or `clear`; the trigger `legal_holds_mirror` sets the entity's flag from it. */
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    by: text("by")
      .notNull()
      .references(() => staffUsers.id),
    at: integer("at").notNull().default(nowMs),
  },
  (t) => [
    index("legal_holds_entity").on(t.entityType, t.entityId, t.at),
    check("legal_holds_reason_length", sql`length(${t.reason}) between 1 and ${n(LEGAL_HOLD_REASON_MAX)}`),
  ],
);

export const consentReceipts = sqliteTable(
  "consent_receipts",
  {
    /** UUIDv7 (a trigger-written `ended` row: 32 random hex characters). */
    id: id(),
    /** HMAC-SHA256(`ERASURE_HASH_KEY`, lower(email)), 64 lower-case hex; NULL until computed (insert, the `consent.hash` back-fill, an erasure or the purge). */
    subjectHash: text("subject_hash"),
    /** The lead it belongs to; unlinked (NULL) when the lead is deleted. */
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** The contact it belongs to; unlinked (NULL) when the contact is deleted. */
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** `grant`, `withdraw` or `ended` (L30; core `CONSENT_EVENTS`, trigger `consent_receipts_values`). */
    event: text("event").notNull(),
    /** Core `CONSENT_SOURCES`. */
    source: text("source").notNull(),
    noticeVersion: text("notice_version"),
    /** A JSON array of core `PURPOSES` (empty on an `ended` row). */
    purposes: text("purposes").notNull(),
    marketing: flag("marketing"),
    /** The form's HMAC of the sender's network (never an address). */
    ipHash: text("ip_hash"),
    at: integer("at").notNull(),
  },
  (t) => [
    index("consent_receipts_subject").on(t.subjectHash, t.at),
    index("consent_receipts_at").on(t.at, t.id),
    // The ON DELETE SET NULL unlinks, the erasure triggers' `WHERE lead_id = …` / `contact_id = …`, and the newest receipt per lead or contact.
    index("consent_receipts_lead").on(t.leadId, t.at),
    index("consent_receipts_contact").on(t.contactId, t.at),
  ],
);

export const r2Deletions = sqliteTable(
  "r2_deletions",
  {
    id: integer("id").primaryKey(),
    /** `files` or `docs`. */
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    /** `row_deleted`, `redacted`, `orphan` or `signature_unused`. */
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [
    uniqueIndex("r2_deletions_key").on(t.bucket, t.key),
    index("r2_deletions_created").on(t.createdAt, t.id),
    check("r2_deletions_key_length", sql`length(${t.key}) between 1 and ${n(R2_KEY_MAX)}`),
    check("r2_deletions_attempts", sql`${t.attempts} >= 0`),
  ],
);

export const retentionRuns = sqliteTable(
  "retention_runs",
  {
    /** UUIDv7. */
    id: id(),
    /** The run's snapshot time: every family's cut-off is computed from it once. */
    asOf: integer("as_of").notNull(),
    /** `dry_run` or `live`. */
    mode: text("mode").notNull(),
    startedAt: integer("started_at").notNull().default(nowMs),
    /** Set when the last family is done. */
    finishedAt: integer("finished_at"),
    /** How many families the run has. */
    families: integer("families").notNull(),
  },
  (t) => [
    index("retention_runs_started").on(t.startedAt, t.id),
    check("retention_runs_families", sql`${t.families} > 0`),
  ],
);

/**
 * The real-deletion switch (C.7, Q1 A, L4): one row per turn on or off, append-only (triggers in `data_protection_triggers`); the newest row is the state, no
 * row is "off". B2 (2026-11-06): the brief's `retention_live` settings row can't exist, because `settings.key` is held by the CHECK `settings_key` (0000) and
 * a CHECK changes only by a rebuild; this table replaces it. `run_id` names the dry run the Owner read before turning it on (plain text: runs are deleted
 * after 13 months, the decision stays).
 */
export const retentionSwitches = sqliteTable(
  "retention_switches",
  {
    /** UUIDv7. */
    id: id(),
    live: flag("live"),
    by: text("by")
      .notNull()
      .references(() => staffUsers.id),
    runId: text("run_id"),
    at: integer("at").notNull().default(nowMs),
  },
  (t) => [
    index("retention_switches_at").on(t.at, t.id),
    check("retention_switches_run", sql`${t.live} = 0 or ${t.runId} is not null`),
  ],
);

export const retentionRunCounts = sqliteTable(
  "retention_run_counts",
  {
    runId: text("run_id")
      .notNull()
      .references(() => retentionRuns.id, { onDelete: "cascade" }),
    family: text("family").notNull(),
    /** Rows due (a dry run: counted up to 10,000; live: deleted or scrubbed so far). */
    due: integer("due").notNull().default(0),
    /** Rows that matched the age rule but were skipped for a legal hold. */
    heldSkipped: integer("held_skipped").notNull().default(0),
    oldestAt: integer("oldest_at"),
    done: flag("done"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.family] }),
    check("retention_run_counts_values", sql`${t.due} >= 0 and ${t.heldSkipped} >= 0`),
  ],
);
