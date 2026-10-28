// Audit and security logs (docs/05 §5.2, NFR-9). audit_log is append-only (trigger). No personal data beyond
// what the record needs: summaries mask sensitive fields, and IPs/user agents serve security only.

import { ROLES } from "@techaust/core";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { id, nowMs, oneOf } from "./common.ts";

export const ACTOR_TYPES = ["staff", "contact", "system", "webhook"] as const;

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    at: integer("at").notNull().default(nowMs),
    actorType: text("actor_type", { enum: ACTOR_TYPES }).notNull(),
    actorId: text("actor_id"),
    role: text("role", { enum: ROLES }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** A JSON diff with sensitive fields masked. */
    summary: text("summary", { mode: "json" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_log_entity").on(t.entityType, t.entityId, t.at),
    index("audit_log_at").on(t.at),
    index("audit_log_actor").on(t.actorId, t.at),
    // The audit viewer's action filter and the accountant's finance-only list (M3.1, ADM-AUD-02).
    index("audit_log_action").on(t.action, t.at),
    check("audit_log_actor_type", oneOf(t.actorType, ACTOR_TYPES)),
    check("audit_log_role", sql`${t.role} is null or ${oneOf(t.role, ROLES)}`),
  ],
);

export const REALMS = ["admin", "portal", "jobs"] as const;

/**
 * Security log for access events (13-month retention, docs/08 L-6). No index on `at` (M1.6, LD19): every index costs
 * one more row written per access row on the Free plan; rows are pruned by UUIDv7 `id` range (M7.4).
 */
export const accessLog = sqliteTable(
  "access_log",
  {
    id: id(),
    at: integer("at").notNull().default(nowMs),
    realm: text("realm", { enum: REALMS }).notNull(),
    actorId: text("actor_id"),
    method: text("method").notNull(),
    route: text("route").notNull(),
    status: integer("status").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
  },
  (t) => [index("access_log_actor").on(t.actorId, t.at), check("access_log_realm", oneOf(t.realm, REALMS))],
);

/**
 * The nightly history of a few dashboard figures (M3.5, docs/05 section 1.2 rule 7): one integer per date, metric and dimension
 * (a lead stage, a project status, a care plan id, or empty). The dashboard itself is live; this table is for trends and for the
 * burn per plan over time. Written by the jobs Worker's cron, one metric per queue message, and idempotent on its primary key.
 * Per-plan rows are business records about clients: their retention is Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11) (docs/08 L-6).
 */
export const statsDaily = sqliteTable(
  "stats_daily",
  {
    /** An IST calendar date. */
    date: text("date").notNull(),
    metric: text("metric").notNull(),
    dimension: text("dimension").notNull().default(""),
    value: integer("value").notNull(),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.metric, t.dimension] }),
    index("stats_daily_metric").on(t.metric, t.date),
    check("stats_daily_date", sql`date(${t.date}) is ${t.date}`),
    check("stats_daily_value", sql`typeof(${t.value}) = 'integer'`),
  ],
);
