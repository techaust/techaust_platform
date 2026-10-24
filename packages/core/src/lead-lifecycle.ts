// Lead life cycle rules shared by the admin and jobs Workers (M3.2, ADM-LEAD-02, -04, -05, FRM-04). Pure: no I/O.
// Retention and DPDP items: VERIFY WITH CA/LEGAL.
import { SETTINGS_DEFAULTS } from "./schemas/settings.ts";

export type LeadStage = "new" | "qualified" | "proposal_sent" | "won" | "lost";

/** A later lead with the same email within this window is linked to the earlier one, never merged (FRM-04). */
export const LEAD_DUPLICATE_WINDOW_MS = 30 * 24 * 3_600_000;

/** The "scheduled for deletion" view lists leads due within this many days (ADM-LEAD-05). */
export const LEAD_PURGE_NOTICE_DAYS = 14;

/** Leads per clean-up page: one cron run enqueues at most this many, then one scan message carries the cursor on. */
export const LEAD_PURGE_PAGE = 50;

/** `delete_after` = last activity plus the leads retention (settings default, in calendar months). */
export function deleteAfter(
  lastActivityAt: number,
  months: number = SETTINGS_DEFAULTS.retention.leadsMonths,
): number {
  const d = new Date(lastActivityAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** The lower-cased, trimmed email the duplicate link and the unique contact index compare. */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** `C0001`: the client code from its sequence number (decision 1; the sample clients keep SAMPLE-A / SAMPLE-B). */
export const clientCode = (n: number): string => `C${String(n).padStart(4, "0")}`;

/**
 * What a proposal event does to a lead's stage (decision 3; M4.2 and M4.3 call this). Returns the new stage, or null for no
 * change. Automation only ever moves a lead forward: "sent" from new or qualified, "accepted" to won from new, qualified or
 * proposal sent. A lead a person has already marked won or lost is left alone (a later manual stage wins).
 */
export function stageAfterProposalEvent(
  current: LeadStage,
  event: "proposal_sent" | "proposal_accepted",
): LeadStage | null {
  if (event === "proposal_sent") return current === "new" || current === "qualified" ? "proposal_sent" : null;
  return current === "new" || current === "qualified" || current === "proposal_sent" ? "won" : null;
}

/** The clean-up queue messages on the existing leads queue (decision 4). Distinguished from a web lead by `kind`. */
export type LeadPurgeMessage = { kind: "lead.purge"; leadId: string };
export type LeadPurgeScanMessage = {
  kind: "lead.purge.scan";
  asOf: number;
  cursor?: { at: number; id: string };
};

export const isPurgeMessage = (body: unknown): body is LeadPurgeMessage =>
  typeof body === "object" &&
  body !== null &&
  (body as { kind?: unknown }).kind === "lead.purge" &&
  typeof (body as { leadId?: unknown }).leadId === "string";

export function isPurgeScanMessage(body: unknown): body is LeadPurgeScanMessage {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { kind?: unknown; asOf?: unknown; cursor?: unknown };
  if (b.kind !== "lead.purge.scan" || typeof b.asOf !== "number") return false;
  if (b.cursor === undefined) return true;
  const c = b.cursor as { at?: unknown; id?: unknown } | null;
  return typeof c === "object" && c !== null && typeof c.at === "number" && typeof c.id === "string";
}

// ---- retention in SQL ----------------------------------------------------------------------------------------------
// ONE expression for the leads retention, used by the jobs insert, every activity update (admin), the settings re-dating and
// the 0016 backfill, so the figure cannot drift (analyst early check, M3.2). Months come from the stored `retention` setting,
// floored at 12 (the settings schema's minimum, DPDP Rule 8(3)) and 12 when the setting was never saved. VERIFY WITH CA/LEGAL.

/** Months of lead retention, as a SQL expression over the `settings` table. */
export const LEAD_RETENTION_MONTHS_SQL =
  "max(12, coalesce((SELECT json_extract(value, '$.leadsMonths') FROM settings WHERE key = 'retention'), 12))";

/** `delete_after` for an activity at `activityMs` (a placeholder or expression, UTC ms): the calendar-month arithmetic of `deleteAfter`. */
export const deleteAfterSql = (activityMs: string): string =>
  `(cast(strftime('%s', datetime((${activityMs}) / 1000, 'unixepoch', '+' || ${LEAD_RETENTION_MONTHS_SQL} || ' months')) AS integer) * 1000 + ((${activityMs}) % 1000))`;

/** The two assignments every activity makes: `last_activity_at = t` and `delete_after` from it (`t` is a placeholder such as `?4`). */
export const touchLeadSql = (t: string): string =>
  `last_activity_at = ${t}, delete_after = ${deleteAfterSql(t)}`;

/** The leads the clean-up and the "scheduled for deletion" view consider (matches the partial index `leads_delete_due`). */
export const LEAD_DELETABLE_SQL = "client_id IS NULL AND legal_hold = 0";
