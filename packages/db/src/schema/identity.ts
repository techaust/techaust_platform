// Identity and auth (docs/05 §5.2, §6). Secrets are stored only as hashes or encrypted values.
import { ROLES } from "@techaust/core";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, id, nowMs, oneOf, updatedAt } from "./common.ts";

export const STAFF_STATUSES = ["invited", "active", "deactivated"] as const;

export type PasswordParams = { v: number; m: number; t: number; p: number };

export const staffUsers = sqliteTable(
  "staff_users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    status: text("status", { enum: STAFF_STATUSES }).notNull().default("invited"),
    pwSalt: text("pw_salt"),
    pwHmac: text("pw_hmac"),
    pwParams: text("pw_params", { mode: "json" }).$type<PasswordParams>(),
    totpSecretEnc: text("totp_secret_enc"),
    totpLastStep: integer("totp_last_step"),
    totpEnabledAt: integer("totp_enabled_at"),
    lastLoginAt: integer("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_users_email").on(t.email),
    // Keyset sort and the role / status filters of GET /users (M3.1): indexes only, no column change.
    index("staff_users_created").on(t.createdAt, t.id),
    index("staff_users_name").on(t.name, t.id),
    index("staff_users_role").on(t.role),
    index("staff_users_status").on(t.status),
    check("staff_users_email_lower", sql`${t.email} = lower(${t.email})`),
    check("staff_users_role", oneOf(t.role, ROLES)),
    check("staff_users_status", oneOf(t.status, STAFF_STATUSES)),
  ],
);

export const staffRecoveryCodes = sqliteTable(
  "staff_recovery_codes",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("staff_recovery_codes_user").on(t.userId)],
);

/**
 * Browsers a staff member has signed in from (ADM-AUTH-09): the `__Host-ta_device` cookie holds a random token,
 * only its SHA-256 is stored here. A sign-in from an unknown device raises `alert.new_device`.
 */
export const staffKnownDevices = sqliteTable(
  "staff_known_devices",
  {
    userId: text("user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(),
    firstSeenAt: integer("first_seen_at").notNull().default(nowMs),
    userAgent: text("user_agent"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceHash] })],
);

export const staffSessions = sqliteTable(
  "staff_sessions",
  {
    /** SHA-256 of the session token; the token itself is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    absExpiresAt: integer("abs_expires_at").notNull(),
    stepUpUntil: integer("step_up_until"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [index("staff_sessions_user").on(t.userId)],
);

export const staffInvites = sqliteTable(
  "staff_invites",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    /** NULL only for bootstrap invites created from the command line (the first Owner, CPU benchmarks). */
    invitedBy: text("invited_by").references(() => staffUsers.id),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("staff_invites_email").on(t.email), check("staff_invites_role", oneOf(t.role, ROLES))],
);

/** Exact lockout counters (the Rate Limiting binding is approximate). Key: `acct:<id>` or `ip:<ip>`. */
export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until"),
});

// Portal (client) auth. contact_id/client_id reference CRM tables (crm.ts).
export const clientSessions = sqliteTable(
  "client_sessions",
  {
    id: text("id").primaryKey(),
    contactId: text("contact_id").notNull(),
    clientId: text("client_id").notNull(),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    absExpiresAt: integer("abs_expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [index("client_sessions_contact").on(t.contactId)],
);

export const magicLinkTokens = sqliteTable(
  "magic_link_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    contactId: text("contact_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    requestIp: text("request_ip"),
    createdAt: createdAt(),
  },
  (t) => [index("magic_link_tokens_contact").on(t.contactId)],
);

export const DOC_TOKEN_PURPOSES = ["view_pay"] as const;

/** Single-document access tokens (POR-06). */
export const docAccessTokens = sqliteTable(
  "doc_access_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    documentId: text("document_id").notNull(),
    purpose: text("purpose", { enum: DOC_TOKEN_PURPOSES }).notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("doc_access_tokens_document").on(t.documentId),
    check("doc_access_tokens_purpose", oneOf(t.purpose, DOC_TOKEN_PURPOSES)),
  ],
);

/**
 * The bell (ADM-G-09, M3.1): one row per member per event, own rows only. `(user_id, kind, entity_id)` is unique, so a
 * redelivered queue message adds nothing twice. `title` is the approved wording (07-H); `link` is the admin path of the record.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => staffUsers.id),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    link: text("link").notNull(),
    readAt: integer("read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_user_event").on(t.userId, t.kind, t.entityId),
    index("notifications_user_created").on(t.userId, t.createdAt, t.id),
  ],
);
