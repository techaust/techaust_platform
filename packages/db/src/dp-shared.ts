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

/**
 * An address held by a contact (itself or its client) or a lead under a legal hold (`email` any expression; compared lower-cased). The clean-up's email
 * family reads it (`retention.ts`), and since the full audit (AU25 L1) the lead erase's first row, the lead purge's due rule and the leads-due list too; the
 * triggers `leads_held_no_delete` / `leads_held_no_erase` (0082) hold its frozen twin (`HELD_EMAIL_AF2`, a db test holds them equal).
 */
export const HELD_EMAIL_SQL = (email: string) =>
  `(EXISTS (SELECT 1 FROM contacts hc JOIN clients hk ON hk.id = hc.client_id WHERE hc.email = lower(${email}) AND (hc.legal_hold = 1 OR hk.legal_hold = 1))
    OR EXISTS (SELECT 1 FROM leads hl WHERE lower(hl.contact_email) = lower(${email}) AND hl.legal_hold = 1))`;

/**
 * Full audit M6–M7 AU26: the audit row (`auditId`, a placeholder or expression) a done consent withdrawal names, on request `r` (a column prefix: `NEW.` in the
 * trigger, `client_requests.` in the route's WHERE): the `lead.consent_withdraw` of its lead, or the `contact.update` of its contact whose `changed` list holds
 * `marketingConsent`, backed by a `withdraw` receipt of that contact; both at or after the request arrived. The trigger set `audit_af2_triggers` (0082) holds
 * its frozen twin (`CONSENT_ACTION_AF2`, a db test holds them equal).
 */
export const CONSENT_WITHDRAW_ACTION_SQL = (r: string, auditId: string) =>
  `EXISTS (SELECT 1 FROM audit_log a WHERE a.id = ${auditId} AND a.at >= ${r}received_at
      AND ((${r}lead_ref IS NOT NULL AND a.action = 'lead.consent_withdraw' AND a.entity_type = 'lead' AND a.entity_id = ${r}lead_ref)
        OR (${r}contact_ref IS NOT NULL AND a.action = 'contact.update' AND json_valid(a.summary) AND json_extract(a.summary, '$.contactId') = ${r}contact_ref
          AND EXISTS (SELECT 1 FROM json_each(a.summary, '$.changed') ch WHERE ch.value = 'marketingConsent')
          AND EXISTS (SELECT 1 FROM consent_receipts cr WHERE cr.contact_id = ${r}contact_ref AND cr.event = 'withdraw' AND cr.at >= ${r}received_at))))`;

/** Full audit AU25 L3: the start of the IST day of `ms` (UTC ms; any expression), in whole milliseconds. */
export const IST_DAY_START_SQL = (ms: string) => `(((${ms}) + 19800000) / 86400000) * 86400000 - 19800000`;
