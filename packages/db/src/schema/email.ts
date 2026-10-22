// Email delivery log and suppression list (docs/05 §5.2, §11.1). Written by the email consumer in apps/jobs.
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id, oneOf, updatedAt } from "./common.ts";

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
  },
  (t) => [
    index("email_log_entity").on(t.entityType, t.entityId),
    index("email_log_status").on(t.status),
    check("email_log_status", oneOf(t.status, EMAIL_STATUSES)),
  ],
);

export const emailSuppressions = sqliteTable("email_suppressions", {
  /** Lower-cased. */
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  at: integer("at").notNull(),
});
