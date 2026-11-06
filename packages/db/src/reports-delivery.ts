// M7.3 (ADM-REP-03, -05; run file docs/runs/m7.3-reports.md C3, C4, L10, L13): the pipeline and care plan hours statements, read by the admin API Worker only. Kept
// apart from `reports.ts` (early check 7: a bundler keeps a top-level template that calls a function, so in `reports.ts` they rode into every Worker that reads
// a finance figure). Every top-level constant here is a pure expression too, so the invoices Worker's dashboard, which reads only `OPEN_TREND_SQL` (C5 (c)),
// carries only that. Plain SQL text, bound by the caller; EXPLAIN-tested in `packages/db/test/reports-v2.test.ts`.
// The pipeline answers counts and page paths only, never a lead's name, email or company (DPDP minimisation, RB-31 pattern); leads are deleted 12 months after
// their last activity (Researched 2026-10-28 (08-C RB-10)). USD offers stay in USD (Q1 A). Care hours give hours only, never an amount (L13).
import { keyRows, pickKey, REPORT_PAGE_SIZE } from "./reports.ts";
import { SQL_CURRENCIES } from "./sql-rules.ts";

/** The longest path shown (core `SOURCE_PATH_MAX`; a test compares the two). */
export const SQL_SOURCE_PATH_MAX = 120;
/**
 * The page a lead came from without its query string or fragment, at most `SQL_SOURCE_PATH_MAX` characters (`s` an SQL expression; early check 8): the twin of
 * core `sourcePath`. NULL stays NULL.
 */
export const sourcePathSql = (s: string): string =>
  `substr(${s}, 1, min(${SQL_SOURCE_PATH_MAX}, CASE WHEN instr(${s}, '?') > 0 THEN instr(${s}, '?') ELSE length(${s}) + 1 END - 1, CASE WHEN instr(${s}, '#') > 0 THEN instr(${s}, '#') ELSE length(${s}) + 1 END - 1))`;

/**
 * C4 (L13): the first day of the billing period that starts in month `month` (`YYYY-MM`, an SQL expression) on the plan row `p`'s billing day: that day of the
 * month, or the plan's start date when that is later (the last of core `carePeriodDays`, without the "after the month" test, which the caller writes against the
 * month's last day).
 */
export const carePeriodDaySql = (month: string, p: string): string =>
  `max(${month} || '-' || printf('%02d', ${p}.billing_day), ${p}.start_date)`;
/**
 * C4 (review 1 finding 2): the first day of the plan's short first period when the plan starts in `month` before its billing day (its start date), else NULL: the
 * first of core `carePeriodDays` when it gives two days.
 */
export const carePeriodFirstDaySql = (month: string, p: string): string =>
  `CASE WHEN ${p}.start_date >= ${month} || '-01' AND ${p}.start_date < ${month} || '-' || printf('%02d', ${p}.billing_day) THEN ${p}.start_date END`;

// ---- C3: the pipeline (the API Worker; L10) ---------------------------------------------------------------------------------------------------------------

/** The lead stages, lost reasons and sources (the schema's lists; a test pins them). */
export const SQL_LEAD_STAGES = ["new", "qualified", "proposal_sent", "won", "lost"] as const;
export const SQL_LOST_REASONS = [
  "price",
  "timing",
  "scope_fit",
  "no_response",
  "competitor",
  "other",
] as const;
export const SQL_LEAD_SOURCES = ["web", "manual"] as const;
/** The statuses a sent offer can be in (a frozen proposal or estimate); any other counts under `other`. */
export const SQL_OFFER_STATUSES = ["sent", "viewed", "accepted", "rejected", "expired", "revised"] as const;
const OFFER_TYPES = "('proposal', 'estimate')";

const COHORT_COUNTS = /* @__PURE__ */ (() => [
  "count(*) AS created",
  ...SQL_LEAD_STAGES.map((s) => `count(CASE l.stage WHEN '${s}' THEN 1 END) AS st_${s}`),
  ...SQL_LOST_REASONS.map((r) => `count(CASE l.lost_reason WHEN '${r}' THEN 1 END) AS lr_${r}`),
  ...SQL_LEAD_SOURCES.map((s) => `count(CASE l.source WHEN '${s}' THEN 1 END) AS src_${s}`),
])();
/** The names of the cohort's counts (`created`, `st_<stage>`, `lr_<reason>`, `src_<source>`); each row of `LEAD_COHORT_SQL` has `all_<name>`. */
export const COHORT_COUNT_NAMES = /* @__PURE__ */ (() =>
  COHORT_COUNTS.map((x) => x.split(" AS ")[1] as string))();

/**
 * The lead cohort (`?1` the range's first instant, `?2` the first instant after it; UTC ms): the leads created in the range (`leads_created`) grouped by the page they
 * came from without its query string (`sourcePathSql`; DPDP minimisation: paths and counts only, never a name, email or company), the ten busiest paths (created,
 * then won, then path), each row also carrying the cohort's totals (window sums over every path, `all_*`). One read of the range and one GROUP BY of it; no row
 * when the range has no lead.
 */
export const LEAD_COHORT_SQL = /* @__PURE__ */ (() =>
  `SELECT g.path, g.created, g.st_won AS won, ${COHORT_COUNT_NAMES.map((n) => `sum(g.${n}) OVER () AS all_${n}`).join(", ")}
   FROM (SELECT ${sourcePathSql("l.source_page")} AS path, ${COHORT_COUNTS.join(", ")}
         FROM leads l INDEXED BY leads_created WHERE l.created_at >= ?1 AND l.created_at < ?2 GROUP BY path) g
   ORDER BY g.created DESC, g.st_won DESC, g.path LIMIT 10`)();

/** The open-leads trend (`?1` to `?2`, IST dates): the nightly `leads.open` counts (a row per open stage) summed per day, read in `stats_daily_metric` order. */
export const OPEN_TREND_SQL = `SELECT s.date, sum(s.value) AS open FROM stats_daily s INDEXED BY stats_daily_metric
   WHERE s.metric = 'leads.open' AND s.date >= ?1 AND s.date <= ?2 GROUP BY s.date ORDER BY s.date`;

const OFFER_STATUS_KEYS = /* @__PURE__ */ (() => [...SQL_OFFER_STATUSES, "other"] as const)();
/**
 * Offers sent in the range (`?1`, `?2` as the cohort): per version group, its newest version sent in the range (no later version of the group sent before the
 * range's end), counted with its taxable value by its status today and currency (Q1 A: USD in USD, never converted). One read of `documents_offer_sent`'s range
 * and a seek of `documents_version` per row, no GROUP BY.
 */
export const OFFERS_SENT_SQL = /* @__PURE__ */ (() => {
  const statusOf = `CASE WHEN d.status IN (${SQL_OFFER_STATUSES.map((s) => `'${s}'`).join(", ")}) THEN d.status ELSE 'other' END`;
  const cols = OFFER_STATUS_KEYS.flatMap((s) =>
    SQL_CURRENCIES.flatMap((c) => [
      `count(CASE WHEN z.st = '${s}' AND z.cu = '${c}' THEN 1 END) AS n_${s}_${c}`,
      `coalesce(sum(CASE WHEN z.st = '${s}' AND z.cu = '${c}' THEN z.taxable END), 0) AS tx_${s}_${c}`,
    ]),
  );
  const pick = (m: string) => pickKey(OFFER_STATUS_KEYS, m);
  return `SELECT kc.k AS status, kc.currency, ${pick("n")} AS n, ${pick("tx")} AS taxable
   FROM (SELECT ${cols.join(", ")}
         FROM (SELECT ${statusOf} AS st, d.currency AS cu, d.taxable_minor AS taxable FROM documents d INDEXED BY documents_offer_sent
               WHERE d.sent_at IS NOT NULL AND d.type IN ${OFFER_TYPES} AND d.sent_at >= ?1 AND d.sent_at < ?2
                 AND NOT EXISTS (SELECT 1 FROM documents n INDEXED BY documents_version WHERE n.version_group_id = d.version_group_id AND n.version > d.version
                                   AND n.sent_at IS NOT NULL AND n.sent_at < ?2) LIMIT -1) z) t
   JOIN (${keyRows(OFFER_STATUS_KEYS)}) kc
   WHERE ${pick("n")} > 0`;
})();
/** The reference twin of `OFFERS_SENT_SQL` (tests only). */
export const OFFERS_SENT_GROUPED_SQL = /* @__PURE__ */ (() =>
  `SELECT d.status, d.currency, count(*) AS n, sum(d.taxable_minor) AS taxable FROM documents d
   WHERE d.sent_at IS NOT NULL AND d.type IN ${OFFER_TYPES} AND d.sent_at >= ?1 AND d.sent_at < ?2
     AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.sent_at IS NOT NULL AND n.sent_at < ?2)
   GROUP BY d.status, d.currency ORDER BY d.status, d.currency`)();

/**
 * The accepted offers decided in the range (`?1`, `?2` UTC ms; `documents_offer_decided`), each with its time to win in whole days: from the lead converted into the
 * group's first version (`leads.proposal_id`), else from that first version's creation, to the acceptance.
 */
const ACCEPTED_DAYS = /* @__PURE__ */ (() =>
  `SELECT (a.accepted_at - coalesce((SELECT min(l.created_at) FROM leads l INDEXED BY leads_proposal WHERE l.proposal_id = d.version_group_id),
         (SELECT f.created_at FROM documents f WHERE f.id = d.version_group_id))) / 86400000 AS days
     FROM documents d INDEXED BY documents_offer_decided JOIN acceptances a INDEXED BY acceptances_document ON a.document_id = d.id
     WHERE d.decided_at IS NOT NULL AND d.type IN ${OFFER_TYPES} AND d.decided_at >= ?1 AND d.decided_at < ?2 AND d.status = 'accepted'`)();
/**
 * A rejected or expired version that a later version of its group was sent after is not the group's outcome (early check 1, lead's triage: a group counts once,
 * by its outcome): a rejected v1 followed by an accepted v2 is one win, not a win and a loss. Any later sent version counts, whenever it was sent, so a group
 * is never a loss in one range and a win in the next. One seek of `documents_version` per rejected or expired row.
 */
const SUPERSEDED = `EXISTS (SELECT 1 FROM documents n INDEXED BY documents_version WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.sent_at IS NOT NULL)`;
/**
 * The win-rate counts (C3): accepted and rejected by `decided_at` in the range (`?1`, `?2`), expired by `valid_until` (`?3` to `?4`, IST dates; an expired offer has
 * no `decided_at`, M4.5; `documents_status_valid_until`), a rejected or expired version counted only when no later version of its group was sent (`SUPERSEDED`),
 * and the accepted ones in the time-to-win bands of core `TIME_TO_WIN_BANDS`. One row.
 */
export const OFFERS_DECIDED_SQL = /* @__PURE__ */ (() =>
  `SELECT
     (SELECT count(*) FROM documents d INDEXED BY documents_offer_decided
       WHERE d.decided_at IS NOT NULL AND d.type IN ${OFFER_TYPES} AND d.decided_at >= ?1 AND d.decided_at < ?2 AND d.status = 'rejected' AND NOT ${SUPERSEDED}) AS rejected,
     (SELECT count(*) FROM documents d INDEXED BY documents_status_valid_until
       WHERE d.status = 'expired' AND d.valid_until >= ?3 AND d.valid_until <= ?4 AND +d.type IN ${OFFER_TYPES} AND NOT ${SUPERSEDED}) AS expired,
     w.accepted, w.d0_7, w.d8_30, w.d31_90, w.d90_plus
   FROM (SELECT count(*) AS accepted, count(CASE WHEN x.days <= 7 THEN 1 END) AS d0_7, count(CASE WHEN x.days BETWEEN 8 AND 30 THEN 1 END) AS d8_30,
                count(CASE WHEN x.days BETWEEN 31 AND 90 THEN 1 END) AS d31_90, count(CASE WHEN x.days > 90 THEN 1 END) AS d90_plus
         FROM (${ACCEPTED_DAYS} LIMIT -1) x) w`)();
export type OffersDecidedSqlRow = {
  rejected: number;
  expired: number;
  accepted: number;
  d0_7: number;
  d8_30: number;
  d31_90: number;
  d90_plus: number;
};
/** The median time to win in days (`?1`, `?2`): the middle one by ORDER BY (the lower of the two middle ones for an even count); no row when none was accepted. */
export const TIME_TO_WIN_MEDIAN_SQL = /* @__PURE__ */ (() =>
  `SELECT x.days FROM (${ACCEPTED_DAYS}) x ORDER BY x.days
   LIMIT 1 OFFSET (SELECT (count(*) - 1) / 2 FROM (${ACCEPTED_DAYS}) y)`)();

// ---- C4: care plan hours (L13; the API Worker) ------------------------------------------------------------------------------------------------------------

/**
 * One page of the billing periods that start in month `?1` (`YYYY-MM`; `?2` its last day; a next page `?3`/`?4` the last row's plan id and period day): a row
 * `(id, day)` per period, `day` its first day: the period on the billing day (`carePeriodDaySql`) and, in the plan's start month when it began before its billing
 * day, the short first period from its start date (`carePeriodFirstDaySql`; review 1 finding 2), so a plan has one or two rows. Only the periods whose plan was
 * `active` on that day (a plan gives hours in a period only then, M3.5 Q5). By plan id, then day; at most 51 rows. Each plan is read once, in primary-key
 * order, its one or two days spread by `json_each` (sorted within the plan only: 1,565 → 1,681 rows read for the brief's 100 plans, `reports-stress.test.ts`).
 * The hours come from the shared care loader (`careStatements`), as the care list's.
 */
export const CARE_HOURS_PAGE_SQL = (after: boolean): string => {
  const first = carePeriodFirstDaySql("?1", "p");
  const days = `CASE WHEN ${first} IS NULL THEN json_array(${carePeriodDaySql("?1", "p")}) ELSE json_array(${first}, ${carePeriodDaySql("?1", "p")}) END`;
  return `SELECT x.id, x.day FROM (SELECT p.id AS id, k.value AS day FROM care_plans p CROSS JOIN json_each(${days}) k${after ? " WHERE p.id >= ?3" : ""}) x
   WHERE x.day <= ?2${after ? " AND (x.id > ?3 OR x.day > ?4)" : ""}
     AND (SELECT s.status FROM care_plan_status_log s INDEXED BY care_plan_status_log_plan WHERE s.care_plan_id = x.id AND s.effective_on <= x.day
          ORDER BY s.effective_on DESC, s.created_at DESC, s.id DESC LIMIT 1) = 'active'
   ORDER BY x.id, x.day LIMIT ${REPORT_PAGE_SIZE + 1}`;
};

/**
 * The care invoices of the page's plans (`?1` a JSON array of plan ids) with a period start from `?2` to `?3`: each with its document's number, issue day, status
 * and void mark (a draft has no number). The Worker matches the period's own invoice (`period_start`) and the one that bills its overage (`overage_period_start`).
 */
export const CARE_HOURS_BILLED_SQL = `SELECT ci.care_plan_id, ci.period_start, ci.overage_period_start, ci.document_id, d.number_display, d.issue_date, d.status, d.voided_at
   FROM care_invoices ci LEFT JOIN documents d ON d.id = ci.document_id
   WHERE ci.care_plan_id IN (SELECT value FROM json_each(?1)) AND ci.period_start >= ?2 AND ci.period_start <= ?3`;
export type CareBilledSqlRow = {
  care_plan_id: string;
  period_start: string;
  overage_period_start: string | null;
  document_id: string | null;
  number_display: string | null;
  issue_date: string | null;
  status: string | null;
  voided_at: number | null;
};
