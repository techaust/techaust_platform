// The daily LUT check (M5.2 B3, ADM-INV-18, Q22, LD27; VERIFY WITH CA/LEGAL: whether and when a letter of undertaking is needed is the CA's call).
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueStats` adds ONE `lut.check` message (the IST date of the run) to its existing LEADS_QUEUE `sendBatch`
//     (no new cron, no new queue, no D1 read in the cron).
//   consumer -> `processLutCheck`: ONE read (the stored `tax` settings row), the letters read WITHOUT zod (`lutsFromStoredTax`; the jobs Worker must not
//     bring zod in), `lutBellFor` decides. When a bell is due: ONE `INSERT OR IGNORE ... SELECT` over the active owners, kind `lut.reminder`, entity
//     `lut:<FY>:<Monday of the IST week>`; the unique index (user, kind, entity) keeps it to one a week per owner, whatever the redelivery or rerun. It writes
//     nothing else, and the weekly EMAIL is M5.4's (LD27).
//   The title is 07-S §5's banner line; the line for "the running FY has no letter" is not drafted yet, so it is `[Placeholder]` (docs/07-S "Copy gaps").
import { type LutCheckMessage, lutBellFor, lutsFromStoredTax } from "@techaust/core/invoices";
import { logEvent } from "./log.ts";

/** The bell the owners see. 07-S §5 (pending the owner's word): "File next year's LUT (FY {next fy}) before 1 April, then save its ARN here." */
export const LUT_BELL_COPY = {
  next_fy_due: (fyLabel: string) =>
    `File next year's LUT (FY ${fyLabel}) before 1 April, then save its ARN here.`,
  /** No line is drafted for "the FY that is running has no letter": a gap, never invented. */
  current_missing: (_fyLabel: string) => "[Placeholder]",
} as const;

export const TAX_ROW_SQL = "SELECT value FROM settings WHERE key = 'tax'";

/** One bell per active owner; `?1` kind, `?2` entity, `?3` title, `?4` link. The unique index `(user_id, kind, entity_id)` makes a rerun a no-op. */
export const LUT_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, 'settings', ?2, ?3, ?4 FROM staff_users u WHERE u.role = 'owner' AND u.status = 'active'`;

export type LutCheckResult = { bell: "none" | "next_fy_due" | "current_missing"; owners: number };

/** Handles one `lut.check` message (a valid one: the queue routes the rest to `skipLutCheck`). */
export async function processLutCheck(env: Env, msg: LutCheckMessage): Promise<LutCheckResult> {
  const row = await env.DB.prepare(TAX_ROW_SQL).first<{ value: string }>();
  let stored: unknown = null;
  try {
    stored = row ? JSON.parse(row.value) : null;
  } catch {
    stored = null; // an unreadable row is "no letters": the owners are told, which is the safe side
  }
  const bell = lutBellFor(msg.asOf, lutsFromStoredTax(stored));
  if (!bell) {
    logEvent("lut.check", { asOf: msg.asOf, bell: "none" });
    return { bell: "none", owners: 0 };
  }
  const res = await env.DB.prepare(LUT_BELL_SQL)
    .bind("lut.reminder", bell.entity, LUT_BELL_COPY[bell.kind](bell.fyLabel), "/settings/tax")
    .run();
  const owners = res.meta.changes;
  logEvent("lut.check", { asOf: msg.asOf, bell: bell.kind, owners });
  return { bell: bell.kind, owners };
}

/** A `lut.check` body this version cannot use (a bad date): acknowledged and logged, never a lead. */
export function skipLutCheck(): void {
  logEvent("lut.check_unknown");
}

/** A check that ran out of tries: tomorrow's run checks again; no alert and no retry. */
export function logLutCheckDeadLetter(queue: string): void {
  logEvent("lut.check_dead_letter", { queue });
}
