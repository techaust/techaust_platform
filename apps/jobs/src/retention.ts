// M7.4's jobs (run file docs/runs/m7.4-data-protection.md D, J; JOB-CRON-01, ADM-SET-09, NFR-9, FRM-05): the nightly clean-up, the R2 outbox drain and sweeps,
// the consent hash fill and the request clock's bells, on the leads queue (routed before the lead fall-through). The cron only enqueues; each message is ONE
// unit of work (one settings read at most, then one or two batches); a body that can't be read is logged and acknowledged; a dead letter is logged and
// acknowledged (the next night or hour repeats it).
//   retention.start  reads the figures and the real-deletion switch once, opens the run (`retention_runs`, id from the run's time, so a redelivery opens
//                    nothing new), queues one `retention.page` per family with the run's cut-offs (one snapshot), the drain and the consent hash page;
//   retention.page   a dry run: one batch of `retentionStatements` (counts only, nothing deleted anywhere); live: one page of at most 500 rows, queued again
//                    while the family isn't done. The same `dueWhere` predicate in both modes (L5). When the run's last family is done, the run is finished
//                    and one bell per active Owner (`retention.report_ready` after a dry run; `retention.done_with_holds` after a live run that skipped held
//                    rows), keyed by the run id;
//   r2.drain         the outbox: 100 objects, deleted from their bucket, then their rows; a failed delete counts an attempt, and a row at 5 attempts stays and
//                    rings `r2.stuck` once per IST day;
//   r2.sweep         one listed page (100 keys): vault objects with no `files` row and older than 24 hours, signature images no record names and older than 7
//                    days; queued for deletion ONLY in live mode (a dry run logs the count); no other DOCS prefix is ever listed (L7);
//   consent.hash     50 back-filled receipts take the keyed hash of their lead's or contact's address;
//   requests.clock   at most 50 open requests by reply date: `request.overdue`, `request.due_soon`, `request.ack_overdue` once each per member and request.
// Floors: Researched 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C RB-09); Settled by the lead on the safest reading, 2026-11-06 (08-C RB-48). The keyed hash:
// Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46). The clock: Researched 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice
// 07-A §§7–8 (08-C RB-47).
import { BELL_COPY, requestRef } from "@techaust/core/copy-zr";
import { istDate, toIsoDate } from "@techaust/core/dates";
import {
  type ConsentHashMessage,
  type DpMessage,
  dpMessageOf,
  type R2DrainMessage,
  type R2SweepMessage,
  type RequestsClockMessage,
  type RetentionPageMessage,
  type RetentionStartMessage,
} from "@techaust/core/dp-jobs";
import { daysLeft, requestState } from "@techaust/core/dsr";
import { staffMayClose } from "@techaust/core/portal";
import {
  cutoffsOf,
  RETENTION_FAMILIES,
  RETENTION_SWITCH_SQL,
  type RetentionFigures,
  SWITCH_LIVE_SQL,
} from "@techaust/core/retention";
import { UNHASHED_RECEIPTS_SQL } from "@techaust/db/consent";
import {
  DRAIN_MAX_ATTEMPTS,
  DRAIN_PAGE_ROWS,
  DRAIN_PAGE_SQL,
  ORPHAN_FILES_SQL,
  QUEUE_ORPHANS_SQL,
  SIGNATURE_PREFIX,
  SIGNATURES_IN_USE_SQL,
  SWEEP_PAGE_KEYS,
} from "@techaust/db/r2-sweep";
import { retentionStatements } from "@techaust/db/retention";
import { erasureHashOf } from "./erasure.ts";
import { logEvent } from "./log.ts";

const DAY_MS = 86_400_000;
/** A vault object younger than this is never an orphan (its row may be a moment behind it). */
export const FILES_ORPHAN_AGE_MS = DAY_MS;
/** A signature image younger than this is never unused (Settings may be saving it). */
export const SIGNATURE_ORPHAN_AGE_MS = 7 * DAY_MS;
const CONSENT_PAGE = 50;
const CLOCK_PAGE = 50;

/** The figures as stored (json_extract, no settings schema in this Worker); a missing one reads as the default, `cutoffOf` raises each to its floor. */
export const FIGURES_SQL = `SELECT json_extract(value, '$.emailLogMonths') AS emailLogMonths, json_extract(value, '$.securityLogMonths') AS securityLogMonths,
  json_extract(value, '$.requestsMonths') AS requestsMonths, json_extract(value, '$.consentProofMonths') AS consentProofMonths FROM settings WHERE key = 'retention'`;
const DEFAULT_FIGURES: RetentionFigures = {
  emailLogMonths: 13,
  securityLogMonths: 13,
  requestsMonths: 36,
  consentProofMonths: 36,
};
const figuresOf = (row: Record<string, unknown> | undefined): RetentionFigures => {
  const pick = (k: keyof RetentionFigures) => {
    const v = row?.[k];
    return typeof v === "number" && Number.isSafeInteger(v) ? v : DEFAULT_FIGURES[k];
  };
  return {
    emailLogMonths: pick("emailLogMonths"),
    securityLogMonths: pick("securityLogMonths"),
    requestsMonths: pick("requestsMonths"),
    consentProofMonths: pick("consentProofMonths"),
  };
};

/** The run's id from its time: a redelivered start finds its run already open and queues nothing new. */
export const runIdOf = (asOf: number): string => `rr_${asOf}`;

/**
 * The run as stored (`?1` run): its mode, and whether any family has a count row yet (`paged`: a page ran). A run with none was opened by a start whose queueing
 * failed, so a redelivered start sends its pages again (early check 2, low 5); the primary key and `retention_run_counts`'s (run_id, family) key keep it a read
 * of at most 12 rows.
 */
export const RUN_STATE_SQL =
  "SELECT mode, EXISTS (SELECT 1 FROM retention_run_counts WHERE run_id = ?1) AS paged FROM retention_runs WHERE id = ?1";

/** The finish of a run (`?1` run, `?2` now): once every family is done; idempotent. */
export const RUN_FINISH_SQL =
  "UPDATE retention_runs SET finished_at = ?2 WHERE id = ?1 AND finished_at IS NULL AND (SELECT count(*) FROM retention_run_counts WHERE run_id = ?1 AND done = 1) >= families";
/**
 * The run's bell (`?1` run, `?2` now, `?3` kind, `?4` title) for every active Owner, only by the batch that finished it, and after a live run only when held rows
 * were skipped. Unique per member, kind and run (`notifications_user_event`).
 */
export const RUN_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?3, 'retention_run', ?1, ?4, '/settings/retention' FROM staff_users u
  WHERE u.role = 'owner' AND u.status = 'active' AND EXISTS (SELECT 1 FROM retention_runs r WHERE r.id = ?1 AND r.finished_at = ?2)
    AND (?3 = 'retention.report_ready' OR (SELECT coalesce(sum(held_skipped), 0) FROM retention_run_counts WHERE run_id = ?1) > 0)`;

/** The cron's messages for the night (no D1 read): the start, and on IST Sundays the vault sweep, on the IST 1st the signature sweep. */
export function nightlyDpMessages(scheduledTime: number): DpMessage[] {
  const today = istDate(scheduledTime);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  return [
    { v: 1, kind: "retention.start", asOf: scheduledTime },
    ...(weekday === 0 ? [{ v: 1, kind: "r2.sweep", bucket: "files", asOf: scheduledTime } as const] : []),
    ...(today.day === 1 ? [{ v: 1, kind: "r2.sweep", bucket: "docs", asOf: scheduledTime } as const] : []),
  ];
}

export type DpResult = "done" | "invalid" | "continued";

/** One message of the family (`isDpKind` already said so). Throws for anything a retry can fix (D1, R2, the queue). */
export async function processDp(env: Env, body: unknown, now = Date.now()): Promise<DpResult> {
  const m = dpMessageOf(body);
  if (!m) {
    logEvent("dp.invalid_message", { f: 1 });
    return "invalid";
  }
  switch (m.kind) {
    case "retention.start":
      return retentionStart(env, m);
    case "retention.page":
      return retentionPage(env, m, now);
    case "r2.drain":
      return r2Drain(env, m, now);
    case "r2.sweep":
      return r2Sweep(env, m);
    case "consent.hash":
      return consentHash(env, m);
    case "requests.clock":
      return requestsClock(env, m);
  }
}

async function retentionStart(env: Env, m: RetentionStartMessage): Promise<DpResult> {
  const db = env.DB;
  const [fig, sw] = await db.batch([db.prepare(FIGURES_SQL), db.prepare(RETENTION_SWITCH_SQL)]);
  const live = (sw?.results[0] as { live?: number } | undefined)?.live === 1;
  const mode = live ? "live" : "dry_run";
  let cutoffs: ReturnType<typeof cutoffsOf>;
  try {
    cutoffs = cutoffsOf(figuresOf(fig?.results[0] as Record<string, unknown> | undefined), m.asOf);
  } catch {
    logEvent("retention.bad_figures", { f: 1 });
    return "invalid";
  }
  const runId = runIdOf(m.asOf);
  const [opened, state] = await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO retention_runs (id, as_of, mode, started_at, families) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(runId, m.asOf, mode, Date.now(), RETENTION_FAMILIES.length),
    db.prepare(RUN_STATE_SQL).bind(runId),
  ]);
  const run = state?.results[0] as { mode?: string; paged?: number } | undefined;
  // The run's own mode (a redelivery keeps the mode it was opened in, whatever the switch says now).
  const runMode = run?.mode === "live" ? "live" : "dry_run";
  if ((opened?.meta.changes ?? 0) === 0) {
    // Early check 2, low 5: a redelivered start whose first try opened the run and then failed to queue the pages (no family has a count row yet) sends
    // them again; a run already paging queues nothing.
    if (run?.paged === 1) {
      logEvent("retention.start_repeat", { f: 1 });
      return "done";
    }
    logEvent("retention.start_resent", { mode: runMode, f: 1 });
  }
  const pages: RetentionPageMessage[] = RETENTION_FAMILIES.map((family) => ({
    v: 1,
    kind: "retention.page",
    runId,
    family,
    mode: runMode,
    asOf: m.asOf,
    before: cutoffs[family].before,
    ...(cutoffs[family].readBefore !== undefined ? { readBefore: cutoffs[family].readBefore } : {}),
  }));
  const extra: DpMessage[] = [
    { v: 1, kind: "r2.drain" },
    { v: 1, kind: "consent.hash" },
  ];
  await env.LEADS_QUEUE.sendBatch([...pages, ...extra].map((body) => ({ body })));
  logEvent("retention.started", { mode: runMode, families: pages.length, f: 1 });
  return "done";
}

async function retentionPage(env: Env, m: RetentionPageMessage, now: number): Promise<DpResult> {
  const db = env.DB;
  const cutoff = { before: m.before, ...(m.readBefore !== undefined ? { readBefore: m.readBefore } : {}) };
  const work = retentionStatements(db, m.family, m.mode, cutoff, m.asOf, m.runId);
  const kind = m.mode === "dry_run" ? "retention.report_ready" : "retention.done_with_holds";
  const title = m.mode === "dry_run" ? BELL_COPY.reportReady : BELL_COPY.doneWithHolds;
  const results = await db.batch([
    ...work,
    db
      .prepare(
        `SELECT done, ${SWITCH_LIVE_SQL} AS live FROM retention_run_counts WHERE run_id = ?1 AND family = ?2`,
      )
      .bind(m.runId, m.family),
    db.prepare(RUN_FINISH_SQL).bind(m.runId, now),
    db.prepare(RUN_BELL_SQL).bind(m.runId, now, kind, title),
  ]);
  const read = results[work.length]?.results[0] as { done?: number; live?: number } | undefined;
  const done = read?.done === 1;
  // Early check 2 M2: the Owner turned real deletion off after this run started. The page's statements read the same switch in the same batch: they deleted
  // nothing and marked the family done, so nothing is sent again.
  if (m.mode === "live" && read?.live !== 1) {
    logEvent("retention.stopped", { family: m.family, f: 1 });
    return "done";
  }
  if (m.mode === "live" && !done) {
    await env.LEADS_QUEUE.send(m);
    logEvent("retention.page", { family: m.family, mode: m.mode, more: true, f: 1 });
    return "continued";
  }
  logEvent("retention.page", { family: m.family, mode: m.mode, more: false, f: 1 });
  return "done";
}

/**
 * M7.2's `job.failed` bell for a live clean-up page that ran out of tries (`?1` `<run id>:<family>`, `?2` the title): one per active Owner, run and family (the
 * unique `(user_id, kind, entity_id)`), opening Settings › Data retention.
 */
export const PAGE_FAILED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'job.failed', 'retention_run', ?1, ?2, '/settings/retention' FROM staff_users u
  WHERE u.role = 'owner' AND u.status = 'active'`;

/**
 * A data-protection message that ran out of tries (the leads dead-letter queue): logged and acknowledged (the next night or hour repeats it). Early check 2,
 * low 6: a LIVE clean-up page also rings the Owners (real deletion stopped part-way, and the run never finishes); a dry-run page, the drain, the sweeps, the
 * hash fill and the clock only log. Throws if the bell can't be written, so the dead-letter queue tries again.
 */
export async function processDpDeadLetter(env: Env, queue: string, body: unknown): Promise<void> {
  const m = dpMessageOf(body);
  logEvent("dp.dead_letter", { queue, kind: m?.kind ?? "invalid", f: 1 });
  if (m?.kind !== "retention.page" || m.mode !== "live") return;
  await env.DB.prepare(PAGE_FAILED_BELL_SQL)
    .bind(`${m.runId}:${m.family}`, BELL_COPY.retentionPageFailed)
    .run();
}

/** The IST day of `ms`, the key of a once-a-day bell. */
const istDayKey = (ms: number) => toIsoDate(istDate(ms));

/** `r2.stuck` (S7) once per IST day for every active Owner (`?1` the day), while a row has run out of attempts. */
export const R2_STUCK_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'r2.stuck', 'r2_deletion', ?1, ?2, '/settings/retention' FROM staff_users u
  WHERE u.role = 'owner' AND u.status = 'active' AND EXISTS (SELECT 1 FROM r2_deletions WHERE attempts >= ${DRAIN_MAX_ATTEMPTS})`;

async function r2Drain(env: Env, m: R2DrainMessage, now: number): Promise<DpResult> {
  const db = env.DB;
  const rows = (await db.prepare(DRAIN_PAGE_SQL).all<{ id: number; bucket: string; key: string }>()).results;
  const ok: number[] = [];
  const failed: number[] = [];
  for (const bucket of ["files", "docs"] as const) {
    const mine = rows.filter((r) => r.bucket === bucket);
    if (mine.length === 0) continue;
    const store = bucket === "files" ? (Reflect.get(env, "FILES") as R2Bucket | undefined) : env.DOCS;
    if (!store) {
      // No binding in this scope (production until Phase 7): the rows wait, no attempt is counted.
      logEvent("r2.drain_no_binding", { bucket, f: 1 });
      continue;
    }
    try {
      await store.delete(mine.map((r) => r.key));
      ok.push(...mine.map((r) => r.id));
    } catch {
      failed.push(...mine.map((r) => r.id));
    }
  }
  await db.batch([
    db
      .prepare("DELETE FROM r2_deletions WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(ok)),
    db
      .prepare(
        "UPDATE r2_deletions SET attempts = attempts + 1 WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .bind(JSON.stringify(failed)),
    db.prepare(R2_STUCK_BELL_SQL).bind(istDayKey(now), BELL_COPY.r2Stuck),
  ]);
  logEvent("r2.drained", { deleted: ok.length, failed: failed.length, f: 1 });
  if (rows.length >= DRAIN_PAGE_ROWS && ok.length > 0) {
    await env.LEADS_QUEUE.send(m);
    return "continued";
  }
  return "done";
}

async function r2Sweep(env: Env, m: R2SweepMessage): Promise<DpResult> {
  const db = env.DB;
  const store = m.bucket === "files" ? (Reflect.get(env, "FILES") as R2Bucket | undefined) : env.DOCS;
  if (!store) {
    logEvent("r2.sweep_no_binding", { bucket: m.bucket, f: 1 });
    return "done";
  }
  const sw = await db.prepare(RETENTION_SWITCH_SQL).first<{ live: number }>();
  const live = sw?.live === 1;
  const prefix = m.bucket === "docs" ? SIGNATURE_PREFIX : undefined;
  const listed = await store.list({
    limit: SWEEP_PAGE_KEYS,
    ...(prefix ? { prefix } : {}),
    ...(m.cursor ? { cursor: m.cursor } : {}),
  });
  let orphans: string[];
  if (m.bucket === "files") {
    const old = listed.objects
      .filter((o) => o.uploaded.getTime() < m.asOf - FILES_ORPHAN_AGE_MS)
      .map((o) => o.key);
    orphans =
      old.length === 0
        ? []
        : (await db.prepare(ORPHAN_FILES_SQL).bind(JSON.stringify(old)).all<{ key: string }>()).results.map(
            (r) => r.key,
          );
  } else {
    // L7: only the signature prefix is ever listed; a key outside it is never touched even if the store returned one.
    const old = listed.objects.filter(
      (o) => o.key.startsWith(SIGNATURE_PREFIX) && o.uploaded.getTime() < m.asOf - SIGNATURE_ORPHAN_AGE_MS,
    );
    if (old.length === 0) orphans = [];
    else {
      const inUse = new Set(
        (await db.prepare(SIGNATURES_IN_USE_SQL).all<{ key: string }>()).results.map((r) => r.key),
      );
      orphans = old.map((o) => o.key).filter((k) => !inUse.has(k));
    }
  }
  if (live && orphans.length > 0)
    await db
      .prepare(QUEUE_ORPHANS_SQL)
      .bind(m.bucket, m.bucket === "files" ? "orphan" : "signature_unused", JSON.stringify(orphans))
      .run();
  logEvent("r2.swept", {
    bucket: m.bucket,
    listed: listed.objects.length,
    orphans: orphans.length,
    live,
    f: 1,
  });
  if (listed.truncated) {
    await env.LEADS_QUEUE.send({ ...m, cursor: listed.cursor });
    return "continued";
  }
  return "done";
}

async function consentHash(env: Env, m: ConsentHashMessage): Promise<DpResult> {
  const db = env.DB;
  const rows = (await db.prepare(UNHASHED_RECEIPTS_SQL).all<{ id: string; email: string }>()).results;
  if (rows.length === 0) return "done";
  const byEmail = new Map<string, string>();
  const pairs: [string, string][] = [];
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    let hash = byEmail.get(email);
    if (hash === undefined) {
      hash = await erasureHashOf(env, email);
      byEmail.set(email, hash);
    }
    pairs.push([r.id, hash]);
  }
  await db
    .prepare(
      `UPDATE consent_receipts SET subject_hash = (SELECT json_extract(j.value, '$[1]') FROM json_each(?1) j WHERE json_extract(j.value, '$[0]') = consent_receipts.id)
       WHERE id IN (SELECT json_extract(value, '$[0]') FROM json_each(?1)) AND subject_hash IS NULL`,
    )
    .bind(JSON.stringify(pairs))
    .run();
  logEvent("consent.hashed", { rows: rows.length, f: 1 });
  if (rows.length >= CONSENT_PAGE) {
    await env.LEADS_QUEUE.send(m);
    return "continued";
  }
  return "done";
}

/** The open requests by reply date (`client_requests_due`), with the ref a bell names them by. ?1 the page size. */
export const CLOCK_SQL = `SELECT r.id, r.kind, r.status, r.due_at, r.ack_due_at, r.acknowledged_at, k.code AS client_code, (SELECT l.ref FROM leads l WHERE l.id = r.lead_id) AS lead_code
  FROM client_requests r INDEXED BY client_requests_due LEFT JOIN clients k ON k.id = r.client_id
  WHERE r.status = 'open' AND r.due_at IS NOT NULL ORDER BY r.due_at, r.id LIMIT ${CLOCK_PAGE}`;
/**
 * The bells of one tick (`?1` a JSON array of `{id, k, t, s}`: request, kind, title, Staff too): every active Owner, and the active Staff for a kind Staff
 * close; once per member, kind and request (`notifications_user_event`).
 */
export const CLOCK_BELLS_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, json_extract(j.value, '$.k'), 'client_request', json_extract(j.value, '$.id'), json_extract(j.value, '$.t'),
    '/requests?id=' || json_extract(j.value, '$.id')
  FROM json_each(?1) j JOIN staff_users u ON u.status = 'active' AND (u.role = 'owner' OR (json_extract(j.value, '$.s') = 1 AND u.role = 'staff'))`;

type ClockRow = {
  id: string;
  kind: string;
  status: string;
  due_at: number;
  ack_due_at: number | null;
  acknowledged_at: number | null;
  client_code: string | null;
  lead_code: string | null;
};

async function requestsClock(env: Env, m: RequestsClockMessage): Promise<DpResult> {
  const db = env.DB;
  const rows = (await db.prepare(CLOCK_SQL).all<ClockRow>()).results;
  const bells: { id: string; k: string; t: string; s: number }[] = [];
  for (const r of rows) {
    const state = requestState(
      { status: r.status, dueAt: r.due_at, ackDueAt: r.ack_due_at, acknowledgedAt: r.acknowledged_at },
      m.asOf,
    );
    const ref = requestRef(r.client_code, r.lead_code);
    const s = staffMayClose(r.kind) ? 1 : 0;
    if (state === "overdue") bells.push({ id: r.id, k: "request.overdue", t: BELL_COPY.overdue(ref), s });
    else if (state === "due_soon")
      bells.push({
        id: r.id,
        k: "request.due_soon",
        t: BELL_COPY.dueSoon(ref, Math.max(0, daysLeft(r.due_at, m.asOf))),
        s,
      });
    // An acknowledgement more than 48 hours late rings too while the reply date is not close (`requestState` gives the reply date the priority).
    if (r.acknowledged_at === null && r.ack_due_at !== null && m.asOf > r.ack_due_at)
      bells.push({ id: r.id, k: "request.ack_overdue", t: BELL_COPY.ackOverdue(ref), s });
  }
  if (bells.length > 0) await db.prepare(CLOCK_BELLS_SQL).bind(JSON.stringify(bells)).run();
  logEvent("requests.clock", { open: rows.length, bells: bells.length, f: 1 });
  return "done";
}

/** Start-up warm-up: the message checks and the cut-offs of one made-up run (no D1, no queue). Returns how many ran. Never throws. */
export function warmDp(): number {
  try {
    let n = 0;
    for (const body of nightlyDpMessages(Date.UTC(2026, 10, 1, 22))) if (dpMessageOf(body)) n++;
    const c = cutoffsOf(DEFAULT_FIGURES, Date.UTC(2026, 10, 1, 22));
    if (c.consent.before > 0) n++;
    if (BELL_COPY.overdue(requestRef("C0001", null)).length > 0) n++;
    return n;
  } catch {
    return 0;
  }
}
