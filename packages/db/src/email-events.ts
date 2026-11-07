// The SES hook's one batch (M7.2; ADM-MAIL-02, JOB-HOOK-01..03; run file docs/runs/m7.2-notifications.md B, C.3, L2, L4, L5, L15). Tier A ground: the suppression
// list and the contact flag. At most 6 statements, every one on an index (JOB-HOOK-03), run inline by the hook (L2: no queue message per event). Full audit AU20:
// a complaint about the weekly digest switches that member's digest off (statement 4 of a complaint) instead of stopping the address.
//
//   1. the event row, `ON CONFLICT (id) DO NOTHING` (JOB-HOOK-02: an EventBridge redelivery writes nothing twice), with its outcome computed in the same
//      statement from the `email_log` row the message id names, BEFORE any change (`unknown_message`, `applied` or `stale`; the twin of core `emailEventMove`);
//   2. the `email_log` row moved up (L15), only when THIS request's event row says `applied`;
//   3. for a Permanent bounce or a complaint only: the address stopped, `INSERT OR IGNORE` from the `email_log` row itself, so only the address WE sent this
//      message to is ever suppressed (a forged event for an address we never emailed suppresses nothing; L4);
//   4. for a Permanent bounce only: `bounced_at` set once on every live contact with that address (at any client), `updated_at` untouched so an open screen never
//      reads a false `stale_version` (L5);
//   5. the owners' bell (`email.bounced`, `email.complaint`), keyed by the `email_log` id, named by the client's code (never an address); for an address that
//      isn't a live contact (a lead's, a staff member's) the "isn't a client contact" line (early check answer 2, `SES_BELLS_NOT_CONTACT`);
//   6. the event's outcome read back (new or a duplicate), for the hook's log line.
// Statements 3 to 5 run when THIS request's event row exists with a known message (`applied` or `stale`): a bounce that no longer moves the row (after a
// complaint, say) still stops the address. "This request's" row: the id and the `received_at` the hook bound (`?6`); a duplicate keeps the first row's time.
// Every side statement is idempotent anyway (rank, `INSERT OR IGNORE`, `coalesce`, the bell's unique key).
import type { SesEvent } from "@techaust/core/email-events";
import { EVENT_STATUS, SES_BELLS, SES_BELLS_NOT_CONTACT, suppressionOf } from "@techaust/core/email-events";
import { NON_TRANSACTIONAL_TEMPLATES } from "@techaust/core/email-templates";
import { emailRankSql } from "./email-rank.ts";

type Db = Pick<D1Database, "prepare">;

/** The `email_log` row of the event's message (partial index `email_log_ses_message`). */
const LOG_ROW = "SELECT id FROM email_log WHERE ses_message_id = ?2 LIMIT 1";

/** This request's event row, with one of `outcomes`. */
const thisEvent = (outcomes: string) =>
  `EXISTS (SELECT 1 FROM email_events ev WHERE ev.id = ?1 AND ev.received_at = ?6 AND ev.outcome IN (${outcomes}))`;

/**
 * The outcome of an event against the row it names, in SQL (`?3` type, `?4` bounce type, `?7` the target status's rank): the twin of core `emailEventMove`
 * (db test `email-events.test.ts` runs both over every status, type and bounce type).
 */
const OUTCOME_SQL = `CASE
  WHEN NOT EXISTS (${LOG_ROW}) THEN 'unknown_message'
  WHEN EXISTS (SELECT 1 FROM email_log WHERE ses_message_id = ?2 AND (
      ${emailRankSql("status")} BETWEEN 1 AND ?7 - 1
      OR (?3 = 'bounce' AND ?4 = 'permanent' AND status = 'bounced' AND bounce_type IS NOT 'permanent'))) THEN 'applied'
  ELSE 'stale' END`;

/**
 * The upsert of the event row (`?1` event id, `?2` message id, `?3` type, `?4` bounce type, `?5` bounce sub-type, `?6` now, `?7` target rank, `?8` 1 to HOLD an
 * event whose message we can't match yet: then nothing is written, the read-back finds no row and the hook answers 409 for EventBridge to retry; early check
 * finding 3, core `holdsUnknown`).
 */
const EVENT_INSERT_SQL = `INSERT INTO email_events (id, ses_message_id, type, bounce_type, bounce_sub_type, email_log_id, outcome, received_at)
  SELECT ?1, ?2, ?3, ?4, ?5, (${LOG_ROW}), ${OUTCOME_SQL}, ?6 WHERE ?8 = 0 OR EXISTS (${LOG_ROW})
  ON CONFLICT (id) DO NOTHING`;

/** The read-back: this request's row (`new`), or the earlier one of a duplicate. */
export const EMAIL_EVENT_READ_SQL =
  "SELECT outcome, received_at = ?2 AS fresh FROM email_events WHERE id = ?1";

const RANK = { delivered: 2, bounced: 3, complained: 4 } as const;

/**
 * The hook's batch for an event it applies (`sesEventDisposition` is `apply`). `now` is the receipt time (ms); it also marks this request's event row. The last
 * statement reads the row back: `{outcome, fresh}` (`fresh` 0 for a duplicate).
 */
export function sesEventStatements(
  db: Db,
  ev: SesEvent,
  now: number,
  opts: { holdUnknown?: boolean } = {},
): D1PreparedStatement[] {
  if (ev.type === "other")
    throw new Error(
      "sesEventStatements: an event of a type we don't handle is stored with sesEventRecordStatement",
    );
  const target = EVENT_STATUS[ev.type];
  const bounceType = ev.bounce?.kind ?? null;
  const bounceSubType = ev.bounce?.subType ?? null;
  const base = [ev.eventId, ev.messageId, ev.type, bounceType, bounceSubType, now, RANK[target]] as const;
  const out: D1PreparedStatement[] = [
    db.prepare(EVENT_INSERT_SQL).bind(...base, opts.holdUnknown === true ? 1 : 0),
    db
      .prepare(
        `UPDATE email_log SET status = ?8, last_event_at = ?6, bounce_type = CASE WHEN ?3 = 'bounce' THEN ?4 ELSE bounce_type END
         WHERE ses_message_id = ?2 AND ${thisEvent("'applied'")}
           AND (${emailRankSql("status")} BETWEEN 1 AND ?7 - 1
             OR (?3 = 'bounce' AND ?4 = 'permanent' AND status = 'bounced' AND bounce_type IS NOT 'permanent'))`,
      )
      .bind(...base, target),
  ];
  const reason = suppressionOf(ev);
  if (reason) {
    const recipients = JSON.stringify(ev.bounce?.recipients ?? ev.complaint?.recipients ?? []);
    // The address of OUR row for this message, and only if the event names it (`?8` the recipients as JSON, lower-cased by the parser).
    const ours = `SELECT e.id, e.to_email, e.template FROM email_log e WHERE e.ses_message_id = ?2
      AND e.to_email IN (SELECT lower(j.value) FROM json_each(?8) j WHERE j.type = 'text')`;
    const known = thisEvent("'applied', 'stale'");
    // Full audit M6–M7 AU20 (B4 L1): a spam report on a NON-transactional email (the weekly digest) never stops the address (security alerts and sign-in
    // links would stop with it): that member's digest is switched off instead (`digest_off_via = 'complaint'`), and no "emails stopped" bell rings.
    const marketing = `o.template IN (${NON_TRANSACTIONAL_TEMPLATES.map((t) => `'${t}'`).join(", ")})`;
    const stops = reason === "complaint" ? ` AND NOT ${marketing}` : "";
    out.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO email_suppressions (email, reason, at)
           SELECT o.to_email, ?9, ?6 FROM (${ours}) o WHERE ${known}${stops}`,
        )
        .bind(...base, recipients, reason),
    );
    if (reason === "complaint")
      out.push(
        db
          .prepare(
            `INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via, updated_at)
             SELECT u.id, 0, 'complaint', ?6 FROM (${ours}) o JOIN staff_users u ON lower(u.email) = o.to_email
             WHERE ${marketing} AND ${known}
             ON CONFLICT (user_id) DO UPDATE SET digest_weekly = 0, digest_off_via = 'complaint',
               updated_at = max(excluded.updated_at, staff_notification_prefs.updated_at + 1)
             WHERE staff_notification_prefs.digest_weekly = 1`,
          )
          .bind(...base, recipients),
      );
    if (reason === "hard_bounce")
      out.push(
        db
          .prepare(
            `UPDATE contacts SET bounced_at = ?6
             WHERE email IN (SELECT o.to_email FROM (${ours}) o) AND anonymised_at IS NULL AND bounced_at IS NULL AND ${known}`,
          )
          .bind(...base, recipients),
      );
    const kind = reason === "hard_bounce" ? "email.bounced" : "email.complaint";
    out.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
           SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?9, 'email_log', x.id,
             CASE WHEN x.code IS NULL THEN ?11 ELSE replace(?10, '{client_code}', x.code) END, '/emails/' || x.id
           FROM (SELECT o.id, (SELECT min(cl.code) FROM contacts ct JOIN clients cl ON cl.id = ct.client_id
                               WHERE ct.email = o.to_email AND ct.anonymised_at IS NULL) AS code
                 FROM (${ours}) o WHERE 1${stops}) x
           JOIN staff_users u ON u.role = 'owner' AND u.status = 'active'
           WHERE ${known}`,
        )
        .bind(...base, recipients, kind, SES_BELLS[kind], SES_BELLS_NOT_CONTACT[kind]),
    );
  }
  out.push(db.prepare(EMAIL_EVENT_READ_SQL).bind(ev.eventId, now));
  return out;
}

/**
 * An event stored and nothing else (`wrong_env`, `ignored_type`): the row keeps the event id (so a redelivery is still a duplicate) and the message id; no
 * `email_log` link for another environment's message.
 */
export function sesEventRecordStatement(
  db: Db,
  ev: SesEvent,
  outcome: "wrong_env" | "ignored_type",
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO email_events (id, ses_message_id, type, bounce_type, bounce_sub_type, email_log_id, outcome, received_at)
       SELECT ?1, ?2, ?3, ?4, ?5, CASE WHEN ?7 = 'ignored_type' THEN (${LOG_ROW}) END, ?7, ?6 WHERE true
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      ev.eventId,
      ev.messageId,
      ev.type,
      ev.bounce?.kind ?? null,
      ev.bounce?.subType ?? null,
      now,
      outcome,
    );
}

// ---- the token-failure counter (C.3 step 4; the M6.2 L14 pattern, own kind) ---------------------------------------------------------------------------------

/** One counter row per clock-hour window, never per address (OPEN (08-C RB-12): failure counters keyed by time window, never by IP). */
export const SES_TOKEN_WINDOW_MS = 3_600_000;
/** The owners are told once a window reaches this many refused tokens. */
export const SES_TOKEN_ALERT_AT = 5;

/** The window key of `now`: `ses:<window start>` (run file C.3). */
export const sesTokenFailureKey = (now: number): string => `ses:${now - (now % SES_TOKEN_WINDOW_MS)}`;

/**
 * One refused token counted: the upsert never goes past 50 (`hook_failures_count`; at the cap nothing is written), the owners' bell `email.hook_token` once the
 * window reaches 5 (`INSERT OR IGNORE`: one per owner and window), then the count read back (the hook queues one `staff.notify` when it reads exactly 5).
 */
export function sesTokenFailureStatements(db: Db, now: number): D1PreparedStatement[] {
  const key = sesTokenFailureKey(now);
  const windowStart = now - (now % SES_TOKEN_WINDOW_MS);
  return [
    db
      .prepare(
        `INSERT INTO hook_failures (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < 50`,
      )
      .bind(key, windowStart),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'email.hook_token', 'hook_window', ?1, ?2, '/settings/email' FROM staff_users o
         WHERE o.role = 'owner' AND o.status = 'active' AND (SELECT count FROM hook_failures WHERE key = ?1) >= ${SES_TOKEN_ALERT_AT}`,
      )
      .bind(key, SES_BELLS["email.hook_token"]),
    db.prepare("SELECT count FROM hook_failures WHERE key = ?1").bind(key),
  ];
}
