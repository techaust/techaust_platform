// The email log and the suppression list (M7.2; ADM-MAIL-01, ADM-MAIL-02; run file docs/runs/m7.2-notifications.md C.1, G2, G3; early check findings 1, 5, 7).
// Tier A ground: the suppression list. Every route is a ROUTES row (guard.ts); every change is one `mutate` batch with its guards in the WHERE.
//   GET  /emails              `emails.read` (Owner, Staff): keyset pages of <= 50, newest first; filters `status`, `template`, `since` (ms), `to` (an exact address,
//                             lower-cased). One filter picks its index: `to` → `email_log_to`; `template` → `email_log_template_created`; `status` →
//                             `email_log_status_created`; none → `email_log_created` (0075).
//   GET  /emails/:id          `emails.read`: the row, its SES events read by `ses_message_id` (index `email_events_message`; finding 5: an event stored before the
//                             row was linked still shows) and the address's suppression with a label (an older or unknown reason reads generically, finding 7).
//   POST /emails/:id/unsuppress      `emails.unsuppress` (Owner; finding 1: a staff or lead address can be cleared too): deletes the suppression of THAT row's
//                             address (no address in a path) and clears `bounced_at` on live contacts with it (`updated_at` untouched, L5); 409 `not_suppressed`.
//   POST /contacts/:id/unsuppress    `emails.unsuppress` {expectedUpdatedAt}: the contact's address; 409 `stale_version`, `not_suppressed`, `client_anonymised`; 404.
// SES's own account-level suppression list may still block an address cleared here (UNCONFIRMED; a `DeleteSuppressedDestination` route is a follow-up, an IAM change).
import { EMAIL_STATUS_LABELS } from "@techaust/core/copy-zq";
import { suppressionReasonLabel } from "@techaust/core/email-events";
import { EMAIL_TEMPLATES } from "@techaust/core/email-templates";
import type { GuardSql } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param, query, STALE_VERSION } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

export const EMAIL_PAGE = 50;

const NOT_SUPPRESSED: ApiError = {
  code: "not_suppressed",
  message: "Emails to this address aren't stopped",
};
const CLIENT_ANONYMISED: ApiError = {
  code: "client_anonymised",
  message: "This client has been anonymised, so nothing can be changed",
};

const STATUSES = Object.keys(EMAIL_STATUS_LABELS) as [keyof typeof EMAIL_STATUS_LABELS, ...string[]];

const listQuery = z.object({
  status: z.optional(z.enum(STATUSES)),
  template: z.optional(z.enum(EMAIL_TEMPLATES)),
  since: z.optional(z.string().check(z.regex(/^\d{1,16}$/))),
  to: z.optional(z.string().check(z.minLength(3), z.maxLength(254), z.regex(/^[^\s@]+@[^\s@]+$/))),
  after: z.optional(z.string().check(z.maxLength(400))),
});

type LogRow = {
  id: string;
  to_email: string;
  template: string;
  entity_type: string;
  entity_id: string;
  status: string;
  error: string | null;
  ses_message_id: string | null;
  bounce_type: string | null;
  last_event_at: number | null;
  created_at: number;
  updated_at: number;
};

const LOG_COLS =
  "id, to_email, template, entity_type, entity_id, status, error, ses_message_id, bounce_type, last_event_at, created_at, updated_at";

const view = (r: LogRow) => ({
  id: r.id,
  to: r.to_email,
  template: r.template,
  entity: { type: r.entity_type, id: r.entity_id },
  status: r.status,
  statusLabel: (EMAIL_STATUS_LABELS as Record<string, string>)[r.status] ?? r.status,
  bounceType: r.bounce_type,
  lastEventAt: r.last_event_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** The suppression of an address with its label, or null. */
const suppressionOfRow = (s: { reason: string; at: number } | undefined) =>
  s ? { reason: s.reason, label: suppressionReasonLabel(s.reason), at: s.at } : null;

export const emails = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const q = c.req.valid("query");
    const db = c.env.DB;
    const binds: unknown[] = [];
    const where: string[] = [];
    let index = "email_log_created";
    if (q.to !== undefined) {
      index = "email_log_to";
      binds.push(q.to.toLowerCase());
      where.push(`to_email = ?${binds.length}`);
    } else if (q.template !== undefined) {
      index = "email_log_template_created";
      binds.push(q.template);
      where.push(`template = ?${binds.length}`);
    } else if (q.status !== undefined) {
      index = "email_log_status_created";
      binds.push(q.status);
      where.push(`status = ?${binds.length}`);
    }
    // The other filters narrow the same index range (never a second index).
    if (q.template !== undefined && index !== "email_log_template_created") {
      binds.push(q.template);
      where.push(`+template = ?${binds.length}`);
    }
    if (q.status !== undefined && index !== "email_log_status_created") {
      binds.push(q.status);
      where.push(`+status = ?${binds.length}`);
    }
    if (q.since !== undefined) {
      binds.push(Number(q.since));
      where.push(`created_at >= ?${binds.length}`);
    }
    if (q.after !== undefined) {
      const cur = decodeCursor(q.after);
      if (!cur || typeof cur.k !== "number") return err(c, BAD_REQUEST, 400);
      binds.push(cur.k, cur.id);
      where.push(`(created_at, id) < (?${binds.length - 1}, ?${binds.length})`);
    }
    const rows = (
      await db
        .prepare(
          `SELECT ${LOG_COLS} FROM email_log INDEXED BY ${index}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ${EMAIL_PAGE + 1}`,
        )
        .bind(...binds)
        .all<LogRow>()
    ).results;
    const page = rows.slice(0, EMAIL_PAGE);
    const last = page.at(-1);
    return c.json({
      emails: page.map(view),
      next: rows.length > EMAIL_PAGE && last ? encodeCursor({ k: last.created_at, id: last.id }) : null,
    });
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const [rowR, eventsR, supR] = await db.batch([
      db.prepare(`SELECT ${LOG_COLS} FROM email_log WHERE id = ?1`).bind(id),
      db
        .prepare(
          `SELECT ev.id, ev.type, ev.bounce_type, ev.bounce_sub_type, ev.outcome, ev.received_at FROM email_events ev INDEXED BY email_events_message
           WHERE ev.ses_message_id = (SELECT ses_message_id FROM email_log WHERE id = ?1) ORDER BY ev.received_at, ev.id LIMIT 50`,
        )
        .bind(id),
      db
        .prepare(
          "SELECT reason, at FROM email_suppressions WHERE email = (SELECT to_email FROM email_log WHERE id = ?1)",
        )
        .bind(id),
    ]);
    const row = rowR?.results[0] as LogRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    type Ev = {
      id: string;
      type: string;
      bounce_type: string | null;
      bounce_sub_type: string | null;
      outcome: string;
      received_at: number;
    };
    return c.json({
      email: { ...view(row), error: row.error },
      events: ((eventsR?.results ?? []) as Ev[]).map((e) => ({
        id: e.id,
        type: e.type,
        bounceType: e.bounce_type,
        bounceSubType: e.bounce_sub_type,
        outcome: e.outcome,
        receivedAt: e.received_at,
      })),
      suppression: suppressionOfRow(supR?.results[0] as { reason: string; at: number } | undefined),
    });
  })

  .post(
    "/:id/unsuppress",
    param(idParam),
    body(z.object({ expectedUpdatedAt: z.optional(z.number()) })),
    async (c) => {
      const { id } = c.req.valid("param");
      const db = c.env.DB;
      const row = await db
        .prepare(
          "SELECT e.id, s.email FROM email_log e LEFT JOIN email_suppressions s ON s.email = e.to_email WHERE e.id = ?1",
        )
        .bind(id)
        .first<{ id: string; email: string | null }>();
      if (!row) return err(c, NOT_FOUND, 404);
      if (row.email === null) return err(c, NOT_SUPPRESSED, 409);
      const done = await mutate(c, {
        main: db
          .prepare(
            "DELETE FROM email_suppressions WHERE email = (SELECT to_email FROM email_log WHERE id = ?1)",
          )
          .bind(id),
        action: "email.unsuppress",
        entityType: "email_log",
        entityId: id,
        summary: { emailLogId: id },
        side: (g) => [clearBouncedStatement(db, "(SELECT to_email FROM email_log WHERE id = ?1)", [id], g)],
      });
      if (!done) return err(c, NOT_SUPPRESSED, 409);
      return c.json({ ok: true });
    },
  );

/**
 * `bounced_at` cleared on every live contact with the address (`addressSql`, bound by `binds`), `updated_at` untouched (L5: an open screen never reads a false
 * `stale_version`), guarded on the audit row.
 */
function clearBouncedStatement(
  db: D1Database,
  addressSql: string,
  binds: unknown[],
  g: GuardSql,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE contacts SET bounced_at = NULL WHERE lower(email) = ${addressSql} AND anonymised_at IS NULL AND bounced_at IS NOT NULL
         AND ${g.sql(binds.length + 1)}`,
    )
    .bind(...binds, ...g.params);
}

/** `POST /contacts/:id/unsuppress` (C.1). */
export const contactUnsuppress = new Hono<AppEnv>().post(
  "/:id/unsuppress",
  param(idParam),
  body(z.object({ expectedUpdatedAt: z.number() })),
  async (c) => {
    const { id } = c.req.valid("param");
    const { expectedUpdatedAt } = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT ct.updated_at, ct.anonymised_at, k.anonymised_at AS client_anonymised_at,
           (SELECT 1 FROM email_suppressions s WHERE s.email = lower(ct.email)) AS suppressed
         FROM contacts ct JOIN clients k ON k.id = ct.client_id WHERE ct.id = ?1`,
      )
      .bind(id)
      .first<{
        updated_at: number;
        anonymised_at: number | null;
        client_anonymised_at: number | null;
        suppressed: number | null;
      }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.client_anonymised_at !== null || row.anonymised_at !== null)
      return err(c, CLIENT_ANONYMISED, 409);
    if (row.updated_at !== expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (row.suppressed === null) return err(c, NOT_SUPPRESSED, 409);
    // Every condition again in the WHERE: the version, the live contact and client.
    const address = `(SELECT lower(ct.email) FROM contacts ct JOIN clients k ON k.id = ct.client_id
      WHERE ct.id = ?1 AND ct.updated_at = ?2 AND ct.anonymised_at IS NULL AND k.anonymised_at IS NULL)`;
    const done = await mutate(c, {
      main: db.prepare(`DELETE FROM email_suppressions WHERE email = ${address}`).bind(id, expectedUpdatedAt),
      action: "contact.unsuppress",
      entityType: "contact",
      entityId: id,
      summary: { contactId: id },
      side: (g) => [clearBouncedStatement(db, `(SELECT lower(email) FROM contacts WHERE id = ?1)`, [id], g)],
    });
    if (!done) {
      const now = await db
        .prepare("SELECT updated_at FROM contacts WHERE id = ?1")
        .bind(id)
        .first<{ updated_at: number }>();
      return err(c, now && now.updated_at !== expectedUpdatedAt ? STALE_VERSION : NOT_SUPPRESSED, 409);
    }
    return c.json({ ok: true });
  },
);
