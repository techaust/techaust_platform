// Email delivery log and suppression list (docs/05 §5.2, §11.1). Written by the email consumer in apps/jobs.
// M7.2 (ADM-MAIL-02, JOB-HOOK-01..03; run file docs/runs/m7.2-notifications.md A, L3, L4, L11): `email_log` gains two columns and a partial index by ADD
// COLUMN / CREATE INDEX only (nothing that exists is rebuilt, and no CHECK is added to `email_log`, which would rebuild it); two new tables, CREATE TABLE only:
//   - `email_events`: one row per SES event received on jobs `/ses` (the EventBridge event id is the key, so a redelivery writes nothing twice). No email address is
//     stored (Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40): no payload personal data), and deliberately no foreign key to `email_log`, which
//     stays unreferenced so M7.4 can delete its rows. Pruned no earlier than `emailLogMonths` (Researched 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C RB-09); M7.4);
//   - `staff_notification_prefs`: a member's email switches (Q1 A, Q2 A, owner 2026-11-01), in its own table because `staff_users` is referenced and can't be
//     rebuilt. A missing row reads as the defaults (core `prefsOf`).
// Their enumerations and lengths have NO CHECK: the `email_event_triggers` set holds them (the M6.4 and M7.1 pattern), so a later milestone widens them with a
// trigger swap, never a rebuild.
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id, oneOf, updatedAt } from "./common.ts";
import { staffUsers } from "./identity.ts";

/**
 * `skipped`: not sent on purpose (suppressed address, or a staging recipient outside the allow-list).
 * `sending`: claimed by one consumer invocation (a conditional update, so two deliveries cannot both send); a claim
 * older than 5 minutes counts as abandoned and can be taken again.
 */
export const EMAIL_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
] as const;

export const emailLog = sqliteTable(
  "email_log",
  {
    id: id(),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    sesMessageId: text("ses_message_id"),
    status: text("status", { enum: EMAIL_STATUSES }).notNull().default("queued"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** M7.2: when the last SES event (delivery, bounce, complaint) moved this row; NULL until one has. */
    lastEventAt: integer("last_event_at"),
    /** M7.2: the bounce type of a bounce event (`permanent`, `transient`, `undetermined`; the trigger set holds the values), else NULL. */
    bounceType: text("bounce_type"),
  },
  (t) => [
    index("email_log_entity").on(t.entityType, t.entityId),
    index("email_log_status").on(t.status),
    // M3.3: the data-subject export reads a person's emails by address.
    index("email_log_to").on(t.toEmail, t.createdAt, t.id),
    check("email_log_status", oneOf(t.status, EMAIL_STATUSES)),
    // M7.2: the SES hook finds the row of an event by SES's message id (else it scans the table); only sent rows carry one.
    index("email_log_ses_message").on(t.sesMessageId).where(sql`${t.sesMessageId} is not null`),
    // M7.2 (C.1, migration 0075): the email log's keyset pages, newest first, all rows or by status (`GET /emails`; the address filter uses `email_log_to`).
    // Indexes only: `email_log` is never rebuilt.
    index("email_log_created").on(t.createdAt, t.id),
    index("email_log_status_created").on(t.status, t.createdAt, t.id),
    // M7.2 review 1, finding 4 (migration 0076): the template filter's own index. M4.5's offer delivery panel reads the same table by entity AND template, and
    // the planner preferred this index for it (a scan of every row of the template), so that read writes `+e.template` and stays on `email_log_entity`
    // (`DELIVERY_SQL`; offers-send.test.ts EXPLAIN pins it).
    index("email_log_template_created").on(t.template, t.createdAt, t.id),
  ],
);

/** M7.2: the reasons an address is stopped (trigger `email_suppressions_reason`): a Permanent bounce, a complaint, or by hand. */
export const SUPPRESSION_REASONS = ["hard_bounce", "complaint", "manual"] as const;

export const emailSuppressions = sqliteTable("email_suppressions", {
  /** Lower-cased. */
  email: text("email").primaryKey(),
  /** One of `SUPPRESSION_REASONS` (M7.2; held by trigger, the shape is unchanged). */
  reason: text("reason").notNull(),
  at: integer("at").notNull(),
});

/** M7.2: the event types `email_events.type` takes (trigger `email_events_values_insert`). */
export const EMAIL_EVENT_TYPES = ["delivery", "bounce", "complaint", "other"] as const;
/** M7.2: the bounce types `email_events.bounce_type` and `email_log.bounce_type` take (SES's `Permanent`, `Transient`, `Undetermined`, lower-cased). */
export const BOUNCE_TYPES = ["permanent", "transient", "undetermined"] as const;
/** M7.2: what the hook did with an event (trigger `email_events_values_insert`). */
export const EMAIL_EVENT_OUTCOMES = [
  "applied",
  "stale",
  "unknown_message",
  "wrong_env",
  "ignored_type",
] as const;

/**
 * M7.2 (JOB-HOOK-02): one row per SES event, keyed by the EventBridge event id. `email_log_id` is a plain text id with NO foreign key (`email_log` stays
 * unreferenced, so M7.4 can delete its rows). No address. Never updated; deleted only by M7.4's pruning (`email_events_no_update`).
 */
export const emailEvents = sqliteTable(
  "email_events",
  {
    /** The EventBridge envelope `id` (1 to 128 characters). */
    id: text("id").primaryKey(),
    /** SES's message id (`detail.mail.messageId`, at most 128 characters). */
    sesMessageId: text("ses_message_id").notNull(),
    type: text("type").notNull(),
    bounceType: text("bounce_type"),
    /** SES's `bounceSubType` as received (at most 64 characters), e.g. `General`, `OnAccountSuppressionList`. */
    bounceSubType: text("bounce_sub_type"),
    emailLogId: text("email_log_id"),
    outcome: text("outcome").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    // M7.4's pruning by age.
    index("email_events_received").on(t.receivedAt, t.id),
    // The email log's detail panel reads a row's events by SES message id.
    index("email_events_message").on(t.sesMessageId),
  ],
);

/**
 * M7.2: how a member's weekly digest was switched off (trigger `staff_notification_prefs_values`). Full audit M6–M7 AU20: `complaint`, a spam report on the
 * digest itself (the SES hook switches the member's digest off instead of stopping every email to the address; triggers `audit_af2_triggers`, 0082).
 */
export const DIGEST_OFF_VIA = ["settings", "one_click", "complaint"] as const;

/**
 * M7.2 (ADM-G-09; Q1 A, Q2 A): a member's email switches, one row per member (a missing row reads as the defaults). The flags are 0/1 (trigger); the defaults
 * follow the owner's answers: the digest on (only owners receive it), "a client opened a proposal or estimate" off, payments received, approvals and connection
 * failures on.
 */
export const staffNotificationPrefs = sqliteTable("staff_notification_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => staffUsers.id),
  digestWeekly: integer("digest_weekly").notNull().default(1),
  emailOfferViewed: integer("email_offer_viewed").notNull().default(0),
  emailPaymentReceived: integer("email_payment_received").notNull().default(1),
  emailApprovals: integer("email_approvals").notNull().default(1),
  emailHookFailed: integer("email_hook_failed").notNull().default(1),
  digestOffVia: text("digest_off_via"),
  updatedAt: updatedAt(),
});
