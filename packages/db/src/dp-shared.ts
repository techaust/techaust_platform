// The few values M7.4's trigger set shares with the runtime SQL (B2, run file J): kept here so the jobs and admin Workers that read them (the retention
// families, the consent statements, the backup scope) never bundle the trigger generator (`triggers-data-protection.ts`, which re-exports them; the
// generated migration 0079 is unchanged).

/** The audit actions whose `summary` keeps the browser and place of a sign-in (`apps/admin/worker/alerts.ts`); L33 scrubs `ua`, `city`, `country`. */
export const ALERT_ACTIONS_0079 = ["alert.new_device", "alert.2fa_change", "alert.lockout"] as const;
export const ALERT_SCRUB_KEYS_0079 = ["$.ua", "$.city", "$.country"] as const;

/**
 * An audit row that still holds something the `audit_ip` scrub removes (an IP, a browser, or an alert's `ua`/`city`/`country`). Early check 2, low 7: the
 * WHERE of the partial index `audit_log_ip_due` (0078) AND the condition of the retention family, the same text, so SQLite's planner sees the family's
 * term imply the index's WHERE and reads only rows not yet scrubbed (a scrubbed row leaves the index, so the nightly scan never re-reads it). `p` is the
 * column prefix: "" in the index, "audit_log." in the family.
 */
export const auditIpDueSql = (p: string): string =>
  `(${p}ip IS NOT NULL OR ${p}user_agent IS NOT NULL OR (${p}action IN (${ALERT_ACTIONS_0079.map((a) => `'${a}'`).join(", ")}) AND json_valid(${p}summary) AND (${ALERT_SCRUB_KEYS_0079.map((k) => `json_type(${p}summary, '${k}') IS NOT NULL`).join(" OR ")})))`;

/**
 * A lead whose consent the back-fill and the `consent.hash` page may read: a lead with its own address (early check 1 M4: never one an anonymise turned into
 * the placeholder `anonymised+<id>@invalid`, core `anonymisedEmail`, nor one already marked erased). `l` is the alias.
 */
export const LEAD_WITH_ADDRESS_SQL = (l: string) =>
  `(${l}.erased_hash IS NULL AND lower(${l}.contact_email) NOT GLOB 'anonymised+*@invalid')`;
