// Audit and security logs (docs/05 §5.2, NFR-9). audit_log is append-only (trigger). No personal data beyond
// what the record needs: summaries mask sensitive fields, and IPs/user agents serve security only.

import { ROLES } from "@techaust/core";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    check("audit_log_actor_type", oneOf(t.actorType, ACTOR_TYPES)),
    check("audit_log_role", sql`${t.role} is null or ${oneOf(t.role, ROLES)}`),
  ],
);

export const REALMS = ["admin", "portal", "jobs"] as const;

/** Security log for access events (13-month retention, docs/08 L-6). */
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
  (t) => [
    index("access_log_at").on(t.at),
    index("access_log_actor").on(t.actorId, t.at),
    check("access_log_realm", oneOf(t.realm, REALMS)),
  ],
);
