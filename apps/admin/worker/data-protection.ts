// M7.4 data-protection routes of the admin API Worker (ADM-SET-09, ADM-CLI-05, NFR-9; run file docs/runs/m7.4-data-protection.md C.5–C.7):
//   GET  /legal-holds?entityType=&entityId=   a record's hold history, newest first (`clients.read`; a lead's also `leads.read`, review 1 low 4);
//   POST /legal-holds                         set or clear a hold (`legalHold.manage`: Owner, step-up; audit `legal_hold.set` / `legal_hold.clear`);
//   POST /suppressions/lift                   allow emails again to an erased address (`suppressions.lift`: Owner, step-up, L20; audit `suppression.lift`);
//   GET  /retention/report                    the last 5 clean-up runs with their counts, the switch, and the leads due within 14 days (`retention.read`);
//   POST /retention/live                      real deletion on or off (`retention.live`: Owner, step-up, Q1 A; audit `retention.live`).
// Every change is one batch through `mutate`, the audit row first where the summary needs the row as it was. L44: the hold INSERT fires the mirror trigger
// (`legal_holds_mirror`), so D1's `meta.changes` of that statement counts more than one row; nothing here reads it (the audit row decides, `changes()` in SQL
// counts only the statement's own rows). Legal hold: Researched 2026-10-28, s.36 CGST Act (08-C RA-25), built as its open point asks; the stop and its lift:
// Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46); real deletion and its trial: Researched 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C
// RB-09).
import { retentionLiveBody, suppressionLiftBody } from "@techaust/core/dp-schemas";
import { erasedStopKey } from "@techaust/core/hmac";
import { uuidv7 } from "@techaust/core/ids";
import {
  LEAD_NO_OPEN_REQUEST_SQL,
  LEAD_PURGE_NOTICE_DAYS,
  leadDeletableSql,
} from "@techaust/core/lead-lifecycle";
import { holdVerdict, legalHoldQuery, legalHoldRequest } from "@techaust/core/legal-hold";
import { decide } from "@techaust/core/permissions";
import {
  RETENTION_FAMILIES,
  RETENTION_SWITCH_SQL,
  retentionLiveVerdict,
  TRIAL_REPORT_FRESH_SQL,
} from "@techaust/core/retention";
import { Hono } from "hono/tiny";
import { auditFirstRow } from "./audit-row.ts";
import { type AppEnv, actor, BAD_REQUEST, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { erasureHash } from "./erasure-key.ts";
import { body } from "./http.ts";

const DAY_MS = 86_400_000;

/** The record a hold is on, as read: whether held, and (a contact) whether anonymised. `?1` the id. */
export const HOLD_TARGET_SQL = {
  client: "SELECT legal_hold AS held, 0 AS anonymised FROM clients WHERE id = ?1",
  contact: "SELECT legal_hold AS held, (anonymised_at IS NOT NULL) AS anonymised FROM contacts WHERE id = ?1",
  lead: "SELECT legal_hold AS held, 0 AS anonymised FROM leads WHERE id = ?1",
} as const;
/** The same condition in the audit row's WHERE (`?7` the id, `?8` the flag it must have now, 1 to clear and 0 to set). */
const HOLD_NOW_SQL = {
  client: "FROM clients e WHERE e.id = ?7 AND e.legal_hold = ?8",
  contact: "FROM contacts e WHERE e.id = ?7 AND e.legal_hold = ?8 AND e.anonymised_at IS NULL",
  lead: "FROM leads e WHERE e.id = ?7 AND e.legal_hold = ?8",
} as const;

/** `?1` id, `?2` type, `?3` entity, `?4` action, `?5` reason, `?6` who, `?7` now; guarded on the audit row (`g`). */
const HOLD_INSERT_SQL = (g: string) =>
  `INSERT INTO legal_holds (id, entity_type, entity_id, action, reason, by, at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${g}`;

export const HOLD_UNCHANGED = {
  code: "hold_unchanged",
  message: "The hold is already in that state",
} as const;
const HOLD_ANONYMISED = {
  code: "anonymised",
  message: "This contact was anonymised; hold its client instead",
} as const;
export const NOT_SUPPRESSED = {
  code: "not_suppressed",
  message: "This address isn't on the erased list",
} as const;

export const legalHolds = new Hono<AppEnv>()
  .get("/", async (c) => {
    const q = legalHoldQuery.safeParse(c.req.query());
    if (!q.success) return err(c, BAD_REQUEST, 400);
    const { entityType, entityId } = q.data;
    // Review 1 low 4: the route row asks `clients.read`; a lead's history also needs `leads.read` (the Accountant reads clients, never leads).
    if (entityType === "lead" && decide(actor(c).role, "leads.read") === "deny")
      return err(c, FORBIDDEN, 403);
    const db = c.env.DB;
    const [target, history] = await db.batch([
      db.prepare(HOLD_TARGET_SQL[entityType]).bind(entityId),
      // The history is short (a hold is set and cleared by hand); at most 50 rows, newest first, through `legal_holds_entity`.
      db
        .prepare(
          "SELECT h.id, h.action, h.reason, h.by, (SELECT name FROM staff_users WHERE id = h.by) AS by_name, h.at FROM legal_holds h WHERE h.entity_type = ?1 AND h.entity_id = ?2 ORDER BY h.at DESC, h.id DESC LIMIT 50",
        )
        .bind(entityType, entityId),
    ]);
    const row = target?.results[0] as { held: number } | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    return c.json({
      held: row.held === 1,
      history: ((history?.results ?? []) as Record<string, unknown>[]).map((h) => ({
        id: h.id,
        action: h.action,
        reason: h.reason,
        by: { id: h.by, name: h.by_name },
        at: h.at,
      })),
    });
  })
  .post("/", body(legalHoldRequest), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    const target = await db
      .prepare(HOLD_TARGET_SQL[f.entityType])
      .bind(f.entityId)
      .first<{ held: number; anonymised: number }>();
    const verdict = holdVerdict(
      target ? { held: target.held === 1, anonymised: target.anonymised === 1 } : null,
      f.entityType,
      f.on,
    );
    if (!verdict.ok) {
      if (verdict.code === "not_found") return err(c, NOT_FOUND, 404);
      return err(c, verdict.code === "anonymised" ? HOLD_ANONYMISED : HOLD_UNCHANGED, 409);
    }
    const u = actor(c);
    const id = uuidv7();
    const now = Date.now();
    const action = verdict.action === "set" ? "legal_hold.set" : "legal_hold.clear";
    const done = await mutate(c, {
      action,
      entityType: f.entityType,
      entityId: f.entityId,
      // The record as it is now (the hold still in its old state), else nothing is written. The reason's words stay in the history row, never the audit.
      auditFirst: (auditId, who) =>
        auditFirstRow(db, auditId, who, {
          action,
          entityType: f.entityType,
          entityExpr: "e.id",
          summaryExpr: "json_object('holdId', ?9, 'entityType', ?10, 'on', json(?11))",
          from: HOLD_NOW_SQL[f.entityType],
          params: [f.entityId, f.on ? 0 : 1, id, f.entityType, f.on ? "true" : "false"],
        }),
      after: (g) => [
        db
          .prepare(HOLD_INSERT_SQL(g.sql(8)))
          .bind(id, f.entityType, f.entityId, verdict.action, f.reason, u.id, now, ...g.params),
      ],
    });
    if (!done) {
      const again = await db
        .prepare(HOLD_TARGET_SQL[f.entityType])
        .bind(f.entityId)
        .first<{ anonymised: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      return err(c, again.anonymised === 1 ? HOLD_ANONYMISED : HOLD_UNCHANGED, 409);
    }
    return c.json({ ok: true, held: f.on, holdId: id });
  });

export const suppressions = new Hono<AppEnv>().post("/lift", body(suppressionLiftBody), async (c) => {
  const { email } = c.req.valid("json");
  const db = c.env.DB;
  const hash = await erasureHash(c.env, email);
  const done = await mutate(c, {
    main: db
      .prepare("DELETE FROM email_suppressions WHERE email = ?1 AND reason = 'erased'")
      .bind(erasedStopKey(hash)),
    action: "suppression.lift",
    entityType: "email_suppression",
    entityId: null,
    // The hash only, never the address (L20).
    summary: { hash },
  });
  if (!done) return err(c, NOT_SUPPRESSED, 409);
  return c.json({ ok: true });
});

/** The newest dry run that finished (`retentionLiveVerdict`). */
const LAST_DRY_RUN_SQL =
  "SELECT id, finished_at FROM retention_runs WHERE mode = 'dry_run' AND finished_at IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 1";
/**
 * C.7, on: `?1` id, `?2` who, `?3` now, the dry run read (`?4`); written only while that run is the newest finished dry run and finished within 7 days
 * (core `TRIAL_REPORT_FRESH_SQL`, the trigger `retention_switches_values` holds the same), and only when the switch is off now. Off: always, while on.
 */
const SWITCH_ON_SQL = `INSERT INTO retention_switches (id, live, by, run_id, at) SELECT ?1, 1, ?2, ?4, ?3
   WHERE ${TRIAL_REPORT_FRESH_SQL("?3")} AND ?4 = (${LAST_DRY_RUN_SQL.replace("SELECT id, finished_at", "SELECT id")})
     AND coalesce((SELECT live FROM retention_switches ORDER BY at DESC, id DESC LIMIT 1), 0) = 0`;
const SWITCH_OFF_SQL = `INSERT INTO retention_switches (id, live, by, run_id, at) SELECT ?1, 0, ?2, NULL, ?3
   WHERE coalesce((SELECT live FROM retention_switches ORDER BY at DESC, id DESC LIMIT 1), 0) = 1`;

export const retention = new Hono<AppEnv>()
  .get("/report", async (c) => {
    const db = c.env.DB;
    const now = Date.now();
    const deletable = leadDeletableSql("l");
    const [runs, counts, sw, leads, dry] = await db.batch([
      db.prepare(
        "SELECT id, as_of, mode, started_at, finished_at, families FROM retention_runs INDEXED BY retention_runs_started ORDER BY started_at DESC, id DESC LIMIT 5",
      ),
      db.prepare(
        "SELECT run_id, family, due, held_skipped, oldest_at, done, capped, more_tomorrow FROM retention_run_counts WHERE run_id IN (SELECT id FROM retention_runs INDEXED BY retention_runs_started ORDER BY started_at DESC, id DESC LIMIT 5)",
      ),
      db.prepare(RETENTION_SWITCH_SQL),
      // The leads' 14-day view (M3.2): refs and dates only, at most 50, soonest first, through `leads_delete_due`.
      db
        .prepare(
          `SELECT l.id, l.ref, l.delete_after FROM leads AS l INDEXED BY leads_delete_due WHERE l.delete_after <= ?1 AND ${deletable} AND ${LEAD_NO_OPEN_REQUEST_SQL("l.id")} ORDER BY l.delete_after, l.id LIMIT 50`,
        )
        .bind(now + LEAD_PURGE_NOTICE_DAYS * DAY_MS),
      // Review 1 low 1: the live verdict reads the newest finished dry run itself (the run list shows only the last 5, which live runs can fill).
      db.prepare(LAST_DRY_RUN_SQL),
    ]);
    const byRun = new Map<string, Record<string, unknown>[]>();
    for (const r of (counts?.results ?? []) as Record<string, unknown>[]) {
      const list = byRun.get(r.run_id as string) ?? [];
      list.push({
        family: r.family,
        due: r.due,
        heldSkipped: r.held_skipped,
        oldestAt: r.oldest_at,
        done: r.done === 1,
        // Full audit AU9: a dry-run count that reached its cap is a floor ("10,000 or more"); a live family that stopped at its nightly page budget
        // carries on tomorrow.
        capped: r.capped === 1,
        moreTomorrow: r.more_tomorrow === 1,
      });
      byRun.set(r.run_id as string, list);
    }
    const order = new Map(RETENTION_FAMILIES.map((f, i) => [f, i]));
    const s = sw?.results[0] as
      | { live: number; by: string; by_name: string | null; run_id: string | null; at: number }
      | undefined;
    const runRows = (runs?.results ?? []) as {
      id: string;
      as_of: number;
      mode: string;
      started_at: number;
      finished_at: number | null;
      families: number;
    }[];
    const lastDry = (dry?.results[0] as { id: string; finished_at: number } | undefined) ?? null;
    return c.json({
      live: s ? s.live === 1 : false,
      switchedAt: s?.at ?? null,
      switchedBy: s ? { id: s.by, name: s.by_name } : null,
      liveVerdict: retentionLiveVerdict({
        lastDryRun: lastDry ? { finishedAt: lastDry.finished_at } : null,
        now,
      }),
      runs: runRows.map((r) => ({
        id: r.id,
        asOf: r.as_of,
        mode: r.mode,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        families: r.families,
        counts: (byRun.get(r.id) ?? []).sort(
          (a, b) =>
            (order.get(a.family as (typeof RETENTION_FAMILIES)[number]) ?? 99) -
            (order.get(b.family as (typeof RETENTION_FAMILIES)[number]) ?? 99),
        ),
      })),
      leadsDue: ((leads?.results ?? []) as { id: string; ref: string; delete_after: number }[]).map((l) => ({
        id: l.id,
        ref: l.ref,
        deleteAfter: l.delete_after,
      })),
    });
  })
  .post("/live", body(retentionLiveBody), async (c) => {
    const { on } = c.req.valid("json");
    const db = c.env.DB;
    const u = actor(c);
    const now = Date.now();
    const id = uuidv7();
    let runId: string | null = null;
    if (on) {
      const last = await db.prepare(LAST_DRY_RUN_SQL).first<{ id: string; finished_at: number }>();
      const verdict = retentionLiveVerdict({
        lastDryRun: last ? { finishedAt: last.finished_at } : null,
        now,
      });
      if (verdict !== "ok")
        return err(
          c,
          {
            code: verdict,
            message:
              verdict === "no_trial_report"
                ? "Wait for the first trial report before turning on real deletion"
                : "The last trial report is more than 7 days old. Wait for tonight's",
          },
          409,
        );
      runId = last?.id ?? null;
    }
    const done = await mutate(c, {
      main: on
        ? db.prepare(SWITCH_ON_SQL).bind(id, u.id, now, runId)
        : db.prepare(SWITCH_OFF_SQL).bind(id, u.id, now),
      action: "retention.live",
      entityType: "retention",
      entityId: null,
      summary: { on, runId, switchId: id },
    });
    if (!done)
      return err(c, { code: "switch_unchanged", message: "Real deletion is already in that state" }, 409);
    return c.json({ ok: true, live: on, runId });
  });
