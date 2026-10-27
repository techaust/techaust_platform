// The daily LUT check (M5.2 B3, ADM-INV-18, Q22, LD27; VERIFY WITH CA/LEGAL: whether and when a letter of undertaking is needed is the CA's call).
//   cron (daily 22:00 UTC = 03:30 IST) -> `enqueueStats` adds ONE `lut.check` message (the IST date of the run) to its existing LEADS_QUEUE `sendBatch`
//     (no new cron, no new queue, no D1 read in the cron).
//   consumer -> `processLutCheck`: ONE read (the stored `tax` settings row; no bell on the IGST route), the letters read WITHOUT zod (`lutsFromStoredTax`; the jobs Worker must not
//     bring zod in), `lutBellFor` decides. When a bell is due: ONE `INSERT OR IGNORE ... SELECT` over the active owners, kind `lut.reminder`, entity
//     `lut:<FY>:<Monday of the IST week>`; the unique index (user, kind, entity) keeps it to one a week per owner, whatever the redelivery or rerun. It writes
//     nothing else, and the weekly EMAIL is M5.4's (LD27).
//   The title is 07-S §5's banner line; the line for "the running FY has no letter" is not drafted yet, so it is `[Placeholder]` (docs/07-S "Copy gaps").
import { type LutCheckMessage, lutBellFor, lutsFromStoredTax } from "@techaust/core/invoices";
import { logEvent } from "./log.ts";

/** The bell the owners see: 07-S §8 (pending the owner's word). */
export const LUT_BELL_COPY = {
  next_fy_due: (fyLabel: string) => `File the LUT for FY ${fyLabel} and save its ARN in Settings › Tax.`,
  current_missing: (fyLabel: string) =>
    `There's no LUT for FY ${fyLabel}. Export invoices without IGST are blocked until you save its ARN.`,
} as const;

/** ONE read: the stored `tax` row and whether an active (not anonymised) overseas client exists. No overseas client, no bell (lead, 2026-10-27). */
export const TAX_ROW_SQL = `SELECT (SELECT value FROM settings WHERE key = 'tax') AS value,
  EXISTS (SELECT 1 FROM clients WHERE gst_status = 'overseas' AND anonymised_at IS NULL) AS overseas`;

/** One bell per active owner; `?1` kind, `?2` entity, `?3` title, `?4` link. The unique index `(user_id, kind, entity_id)` makes a rerun a no-op. */
export const LUT_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, 'settings', ?2, ?3, ?4 FROM staff_users u WHERE u.role = 'owner' AND u.status = 'active'`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export type LutCheckResult = { bell: "none" | "next_fy_due" | "current_missing"; owners: number };

/** Handles one `lut.check` message (a valid one: the queue routes the rest to `skipLutCheck`). */
export async function processLutCheck(env: Env, msg: LutCheckMessage): Promise<LutCheckResult> {
  const row = await env.DB.prepare(TAX_ROW_SQL).first<{ value: string | null; overseas: number }>();
  if (!row?.overseas) {
    logEvent("lut.check", { asOf: msg.asOf, bell: "none", overseas: false });
    return { bell: "none", owners: 0 };
  }
  let stored: unknown = null;
  try {
    stored = row.value ? JSON.parse(row.value) : null;
  } catch {
    stored = null; // an unreadable row is "no letters": the owners are told, which is the safe side
  }
  // The IGST route needs no letter, so a bell all year would be noise (the Settings attention row fires on the LUT route only). Read without zod.
  if (isRecord(stored) && stored.exportMode === "igst_paid") {
    logEvent("lut.check", { asOf: msg.asOf, bell: "none", route: "igst_paid" });
    return { bell: "none", owners: 0 };
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
