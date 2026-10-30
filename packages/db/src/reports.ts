// The report statements (M5.5b, LD71 to LD80; ADM-REP-04, ADM-REP-06, ADM-REP-07, ADM-CLI-04, ADM-DASH-01): the GST and CA register, the EDF month, the
// realisation list and scan, a client's statement of account and the dashboard's finance figures. Plain SQL text, bound by the caller; every statement
// is EXPLAIN-tested (`packages/db/test/reports.test.ts`) so a new filter never goes unindexed. Pages are keysets of at most 50 rows (LIMIT 51: the 51st
// says there is a next page), as the admin lists are. Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01) for every tax reading (docs/08-research-appendix/A-gst-invoicing.md).
// The Workers never parse `documents.computed` for a page: the rates of each document come from SQL over `json_each(computed, '$.lines')` (a twin of core
// `registerRatesOf`, proved by test), summed in INR (the line values on an INR document, the `inr` view of each line on a USD one).
import {
  ALERT_STAGE_LIST,
  femaDueSql,
  gstDueSql,
  type RealisationSql,
  SCAN_BINDS,
  settingsBinds,
  stageSql,
} from "./realisation.ts";

/**
 * Rows in one report page (keyset, the admin lists' rule): every page statement reads one more (`LIMIT REPORT_PAGE_SIZE + 1`) to know whether another page exists. One
 * constant for the SQL and the routes, so the page can be lowered in one place (docs/05 §10: staging `cpuTimeMs` over 7 ms at the p99 means 25).
 */
export const REPORT_PAGE_SIZE = 50;

/** The four GST kinds the register reports (a proforma, proposal or estimate never is). */
const GST_TYPES = "('tax_invoice', 'export_invoice', 'credit_note', 'debit_note')";
/** The partial-index predicates, written exactly as the index definitions are (SQLite needs the query to imply them for `INDEXED BY`). */
const ISSUED_GST = `d.frozen_at IS NOT NULL AND d.type IN ${GST_TYPES}`;
const ISSUED_EXPORT = "d.frozen_at IS NOT NULL AND d.type = 'export_invoice'";

/** A sum of a line field in INR over `json_each` rows: NULL (never a silent zero) when any line of the group lacks its INR view. */
const inrSum = (field: string): string => {
  const x = `CASE d.currency WHEN 'INR' THEN json_extract(l.value, '$.${field}') ELSE json_extract(l.value, '$.inr.${field}') END`;
  return `CASE WHEN count(${x}) < count(*) THEN NULL ELSE sum(${x}) END`;
};

/**
 * The rates of document `d`, as a JSON array text (`rates`): per (SAC, effective rate) the INR taxable value and the three tax heads, SAC then rate. The
 * twin of `registerRatesOf(computed)` in content (its order is NOT relied on: the consumer sorts, L2). A USD line without an `inr` view gives NULL amounts in its group, which the row mapper hands to core as an invalid
 * amount (never a zero).
 */
export const RATES_SQL = `(SELECT json_group_array(json_object('sac', g.sac, 'rateBp', g.rate, 'taxableMinor', g.taxable, 'igstMinor', g.igst, 'cgstMinor', g.cgst, 'sgstMinor', g.sgst))
      FROM (SELECT json_extract(l.value, '$.sac') AS sac, json_extract(l.value, '$.effectiveRateBp') AS rate,
                   ${inrSum("taxableMinor")} AS taxable, ${inrSum("igstMinor")} AS igst, ${inrSum("cgstMinor")} AS cgst, ${inrSum("sgstMinor")} AS sgst
            FROM json_each(d.computed, '$.lines') l GROUP BY sac, rate ORDER BY sac, rate) g)`;

/**
 * The columns of one register row (what core's `RegisterApiRow` is made of), for a documents row `d` joined to its client `c`. INR amounts: an INR document's own
 * columns, a USD document's `total_inr_minor` and `computed.inr.roundOffMinor`. The note's parent block is `header_extras.noteOf.parent` (LD53) as JSON text; the
 * recipient fields come from the frozen snapshot, never the live client (an anonymised client's issued documents keep what they said at issue).
 */
export const REGISTER_COLUMNS = `d.id, d.type, d.series, d.fy, d.number AS seq, d.number_display, d.issue_date, d.currency, d.total_minor,
       coalesce(d.total_inr_minor, CASE d.currency WHEN 'INR' THEN d.total_minor END) AS total_inr_minor,
       CASE d.currency WHEN 'INR' THEN d.round_off_minor ELSE json_extract(d.computed, '$.inr.roundOffMinor') END AS round_off_inr_minor,
       d.fx_rate_micros, d.supply_type, d.place_of_supply_code, d.balance_minor, d.voided_at, d.client_id, c.code AS client_code,
       coalesce(json_extract(d.recipient, '$.legalName'), json_extract(d.recipient, '$.displayName')) AS r_name, json_extract(d.recipient, '$.gstStatus') AS r_status, json_extract(d.recipient, '$.gstin') AS r_gstin,
       json_extract(d.recipient, '$.stateCode') AS r_state, json_extract(d.recipient, '$.country') AS r_country, json_extract(d.recipient, '$.address') AS r_address,
       json_extract(d.header_extras, '$.noteOf') AS note_of, json_extract(d.issuer, '$.bank.swift.purposeCode') AS purpose_code, d.ims_status,
       ${RATES_SQL} AS rates`;

/** One row of `REGISTER_COLUMNS` as D1 returns it. */
export type RegisterSqlRow = {
  id: string;
  type: string;
  series: string;
  fy: string;
  seq: number;
  number_display: string;
  issue_date: string;
  currency: string;
  total_minor: number;
  total_inr_minor: number | null;
  round_off_inr_minor: number | null;
  fx_rate_micros: number | null;
  supply_type: string;
  place_of_supply_code: string;
  balance_minor: number;
  voided_at: number | null;
  client_id: string;
  client_code: string;
  r_name: string | null;
  r_status: string | null;
  r_gstin: string | null;
  r_state: string | null;
  r_country: string | null;
  r_address: string | null;
  note_of: string | null;
  purpose_code: string | null;
  /** rt1 T3: a credit note's IMS answer (null for every other document); only the 3B helper reads it. */
  ims_status: string | null;
  rates: string | null;
};

const KEYSET = "AND (d.issue_date > ?3 OR (d.issue_date = ?3 AND d.id > ?4))";

/**
 * One page of the register (LD71): the issued documents of the four kinds from `?1` to `?2` (ISO, inclusive), voided ones included (Table 13 counts them as
 * cancelled), oldest first by `(issue_date, id)`; a next page adds the last row's `(issue_date, id)` as `?3` and `?4`. At most 51 rows.
 */
export const REGISTER_PAGE_SQL = (after: boolean): string =>
  `SELECT ${REGISTER_COLUMNS}
   FROM documents d INDEXED BY documents_issued_on JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_GST} AND d.issue_date >= ?1 AND d.issue_date <= ?2 ${after ? KEYSET : ""}
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/** The invoice month's non-voided export invoices (the EDF list): `?1` first day, `?2` last day, then the keyset as above. */
export const EDF_MONTH_SQL = (after: boolean): string =>
  `SELECT ${REGISTER_COLUMNS}
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.issue_date >= ?1 AND d.issue_date <= ?2 ${after ? KEYSET : ""}
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/**
 * The realisation list: every non-voided export invoice (`open`: with an amount still outstanding), oldest first; the keyset is `?1` and `?2`. The first page
 * has no cursor, so `?1`/`?2` are only there for a next page.
 */
export const REALISATION_PAGE_SQL = (show: "open" | "all", after: boolean): string =>
  `SELECT ${REGISTER_COLUMNS}
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL ${show === "open" ? "AND d.balance_minor > 0" : ""} ${after ? "AND (d.issue_date > ?1 OR (d.issue_date = ?1 AND d.id > ?2))" : ""}
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/**
 * The alert scan (jobs): open exports old enough to be near a deadline, with their stage not "ok" and not "realised". Parameters: `?1` today (IST ISO), `?2`
 * the foreign FEMA months, `?3` the INR months, `?4` the GST months, `?5` the GST extra days, `?6` the approaching days, `?7` the smaller of the two FEMA
 * months, and for a continuation `?8`/`?9` the last row's `(issue_date, id)`. The bound on `issue_date` keeps the read to the exports that can be in a stage
 * (a deadline more than `approaching + 31 days` away cannot be near); the stage test is the same SQL as the twin test proves. At most 51 rows.
 */
export const REALISATION_SCAN_SQL = (after: boolean): string => {
  const p: RealisationSql = SCAN_BINDS;
  return `SELECT d.id, d.number_display, d.issue_date, d.currency, d.supply_type, d.balance_minor, d.client_id, c.code AS client_code,
       json_extract(d.recipient, '$.legalName') AS client_name, c.anonymised_at AS client_anonymised,
       ${femaDueSql("d", p)} AS fema_due, ${gstDueSql("d", p)} AS gst_due, ${stageSql("d", p)} AS stage
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.balance_minor > 0
     AND d.issue_date < date(?1, '+' || (?6 + 31) || ' days', '-' || ?7 || ' months') ${after ? "AND (d.issue_date > ?8 OR (d.issue_date = ?8 AND d.id > ?9))" : ""}
     AND ${stageSql("d", p)} IN (${ALERT_STAGE_LIST})
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;
};

/** How many exports the invoice month has for the EDF reminder (`?1` first day, `?2` last day): not voided, the same rows as `EDF_MONTH_SQL`. */
export const EDF_COUNT_SQL = `SELECT count(*) AS n FROM documents d INDEXED BY documents_export_issued
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.issue_date >= ?1 AND d.issue_date <= ?2`;

/** The bells already rung for a set of export invoices (`?1` a JSON array of ids) for the four stage kinds, by owner: the scan rings only what is missing. The
 * entity type is in the filter so the lookup is a seek on `notifications_entity (entity_type, entity_id)`.
 */
export const REALISATION_BELLS_SQL = `SELECT n.user_id, n.kind, n.entity_id FROM notifications n
   WHERE n.entity_type = 'document' AND n.entity_id IN (SELECT value FROM json_each(?1)) AND n.kind IN ('export.fema_approaching', 'export.fema_overdue', 'export.gst_approaching', 'export.gst_overdue')`;

// ---- the statement of account (LD78) ----------------------------------------------------------------------------------------------------------------

const DEBIT_KINDS = "('tax_invoice', 'export_invoice', 'debit_note')";

/**
 * The lines of a client's statement as one source `u(id, kind, date, ord, number, amount, sk)`: the debit documents and credit notes (issued, not voided,
 * the client's, in the currency) and the advance receipts of Q9 (their amount, dated by the day the money arrived; the number is that of the tax invoice they
 * paid). `ord` orders one day: 1 a debit document, 2 a credit note, 3 a receipt; `sk` is `date|ord`, the keyset key with `id`. Proformas are not here
 * (LD78: not a tax document; their payment shows through the tax invoice). `cond` is a SQL fragment over a date expression, e.g. `x BETWEEN ?3 AND ?4`. With
 * `withParent`, a credit or debit note carries the number of the invoice it is against (`parent`; FX-4, full audit A5 7: debit notes too); every other line NULL.
 */
const statementSource = (cond: (dateExpr: string) => string, withParent = false): string =>
  `(SELECT d.id AS id, d.type AS kind, d.issue_date AS date, CASE d.type WHEN 'credit_note' THEN 2 ELSE 1 END AS ord, d.number_display AS number, d.total_minor AS amount,
           d.issue_date || '|' || CASE d.type WHEN 'credit_note' THEN 2 ELSE 1 END AS sk${withParent ? ", CASE WHEN d.type IN ('credit_note', 'debit_note') THEN (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id) END AS parent" : ""}
      FROM documents d INDEXED BY documents_client_issued
      WHERE d.frozen_at IS NOT NULL AND d.type IN ${GST_TYPES} AND d.client_id = ?1 AND d.currency = ?2 AND d.voided_at IS NULL AND d.status <> 'void' AND ${cond("d.issue_date")}
    UNION ALL
    SELECT r.id, 'receipt', r.received_on, 3, inv.number_display, r.amount_minor, r.received_on || '|3'${withParent ? ", NULL" : ""}
      FROM advance_receipts r INDEXED BY advance_receipts_client_received JOIN documents inv ON inv.id = r.invoice_id
      WHERE r.client_id = ?1 AND r.currency = ?2 AND ${cond("r.received_on")}) u`;

/**
 * One page of a statement: `?1` the client, `?2` the currency, `?3` and `?4` the range (inclusive), and for a next page `?5` and `?6` the last row's `(sk, id)`.
 * At most 51 rows, oldest first.
 */
export const STATEMENT_PAGE_SQL = (after: boolean): string =>
  `SELECT u.id, u.kind, u.date, u.number, u.amount, u.sk, u.parent FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`, true)}
   ${after ? "WHERE (u.sk > ?5 OR (u.sk = ?5 AND u.id > ?6))" : ""}
   ORDER BY u.sk, u.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/**
 * The balance before a page: everything dated before the range's first day (`?3`), or, for a next page, everything up to and including the cursor row (`?5`
 * and `?6` as above; pre-range lines are always before it). Debits add, credit notes and receipts subtract.
 */
export const STATEMENT_BALANCE_BEFORE_SQL = (after: boolean): string =>
  after
    ? `SELECT coalesce(sum(CASE WHEN u.kind IN ${DEBIT_KINDS} THEN u.amount ELSE -u.amount END), 0) AS balance
       FROM ${statementSource(() => "1 = 1")} WHERE (u.sk < ?5 OR (u.sk = ?5 AND u.id <= ?6))`
    : `SELECT coalesce(sum(CASE WHEN u.kind IN ${DEBIT_KINDS} THEN u.amount ELSE -u.amount END), 0) AS balance
       FROM ${statementSource((x) => `${x} < ?3`)}`;

/**
 * Every line of a range for the statement PDF (`?1` client, `?2` currency, `?3` and `?4` the range), oldest first, at most `limit` rows (the caller passes the PDF's
 * maximum plus one, so a longer statement is told apart from one that exactly fits). The same lines, order and parent numbers as the pages.
 */
export const STATEMENT_ENTRIES_SQL = (limit: number): string =>
  `SELECT u.id, u.kind, u.date, u.number, u.amount, u.sk, u.parent FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`, true)}
   ORDER BY u.sk, u.id LIMIT ${Math.trunc(limit)}`;

/** The range's debits, credits and number of lines (`?1` client, `?2` currency, `?3` and `?4` the range). */
export const STATEMENT_TOTALS_SQL = `SELECT coalesce(sum(CASE WHEN u.kind IN ${DEBIT_KINDS} THEN u.amount END), 0) AS debit,
       coalesce(sum(CASE WHEN u.kind NOT IN ${DEBIT_KINDS} THEN u.amount END), 0) AS credit, count(*) AS n
   FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`)}`;

/** The same count alone, for the PDF request's 200-line limit (it never reads more than needed to know). */
export const STATEMENT_COUNT_SQL = `SELECT count(*) AS n FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`)}`;

/** Σ `balance_minor` of the client's open debit documents in a currency: what a statement made today must close at (`?1` client, `?2` currency). */
export const STATEMENT_LEDGER_SQL = `SELECT coalesce(sum(d.balance_minor), 0) AS balance FROM documents d INDEXED BY documents_client_issued
   WHERE d.client_id = ?1 AND d.currency = ?2 AND ${ISSUED_GST} AND d.type IN ${DEBIT_KINDS} AND d.voided_at IS NULL AND d.status <> 'void' AND d.balance_minor > 0`;

/**
 * The values to bind for each statement above, in the order of its `?n`. A numbered parameter that is not written in the SQL still counts toward the
 * arity (D1 refuses a different number of values), so the unused ones are `null`.
 */
export type StatementCursor = { readonly sk: string; readonly id: string };
export const statementPageBinds = (
  clientId: string,
  currency: string,
  from: string,
  to: string,
  cursor?: StatementCursor,
): (string | null)[] =>
  cursor ? [clientId, currency, from, to, cursor.sk, cursor.id] : [clientId, currency, from, to];
export const statementBalanceBeforeBinds = (
  clientId: string,
  currency: string,
  from: string,
  cursor?: StatementCursor,
): (string | null)[] =>
  cursor ? [clientId, currency, null, null, cursor.sk, cursor.id] : [clientId, currency, from];
export const statementTotalsBinds = (
  clientId: string,
  currency: string,
  from: string,
  to: string,
): string[] => [clientId, currency, from, to];
/** Register, EDF and realisation pages: the range, and the last row's `(issue_date, id)` for a next page. */
export const registerPageBinds = (
  from: string,
  to: string,
  cursor?: { readonly d: string; readonly id: string },
): string[] => (cursor ? [from, to, cursor.d, cursor.id] : [from, to]);
export const realisationPageBinds = (cursor?: { readonly d: string; readonly id: string }): string[] =>
  cursor ? [cursor.d, cursor.id] : [];
/** The scan: today, the rule values, the smaller FEMA period, and the cursor. */
export const realisationScanBinds = (
  today: string,
  rules: {
    readonly femaMonthsForeign: number;
    readonly femaMonthsInr: number;
    readonly gstMonths: number;
    readonly gstExtraDays: number;
    readonly approachingDays: number;
  },
  cursor?: { readonly d: string; readonly id: string },
): (string | number)[] => [
  today,
  rules.femaMonthsForeign,
  rules.femaMonthsInr,
  rules.gstMonths,
  rules.gstExtraDays,
  rules.approachingDays,
  Math.min(rules.femaMonthsForeign, rules.femaMonthsInr),
  ...(cursor ? [cursor.d, cursor.id] : []),
];

// ---- the dashboard's finance figures (LD80) -----------------------------------------------------------------------------------------------------------

const OPEN_STATUSES = "('issued', 'partially_paid', 'partially_credited')";
const DEBIT_DOCS = "('tax_invoice', 'export_invoice', 'debit_note')";

/**
 * Invoiced in the financial year `?1` to `?2` and in the month from `?3` (to `?2`'s month: the caller passes the month's first day), by currency. Credit
 * notes count negative; voided documents and proformas never. `taxable` is before GST, `total` with it, `inr_taxable` the INR value of the taxable amount
 * (a USD document's `computed.inr`); NULL when a USD document lacks it, never zero.
 */
export const INVOICED_SQL = `SELECT d.currency,
       count(*) AS fy_documents,
       sum(CASE d.type WHEN 'credit_note' THEN -d.taxable_minor ELSE d.taxable_minor END) AS fy_taxable,
       sum(CASE d.type WHEN 'credit_note' THEN -d.total_minor ELSE d.total_minor END) AS fy_total,
       CASE WHEN count(CASE d.currency WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END) < count(*) THEN NULL
            ELSE sum(CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END * CASE d.currency WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END) END AS fy_inr_taxable,
       coalesce(sum(CASE WHEN d.issue_date >= ?3 THEN 1 END), 0) AS month_documents,
       coalesce(sum(CASE WHEN d.issue_date >= ?3 THEN CASE d.type WHEN 'credit_note' THEN -d.taxable_minor ELSE d.taxable_minor END END), 0) AS month_taxable,
       coalesce(sum(CASE WHEN d.issue_date >= ?3 THEN CASE d.type WHEN 'credit_note' THEN -d.total_minor ELSE d.total_minor END END), 0) AS month_total,
       CASE WHEN count(CASE WHEN d.issue_date >= ?3 THEN CASE d.currency WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END END) < coalesce(sum(CASE WHEN d.issue_date >= ?3 THEN 1 END), 0) THEN NULL
            ELSE coalesce(sum(CASE WHEN d.issue_date >= ?3 THEN CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END * CASE d.currency WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END END), 0) END AS month_inr_taxable
   FROM documents d INDEXED BY documents_issued_on
   WHERE ${ISSUED_GST} AND d.voided_at IS NULL AND d.issue_date >= ?1 AND d.issue_date <= ?2
   GROUP BY d.currency ORDER BY d.currency`;

/**
 * What clients owe, and how much of it is overdue, by currency, in ONE read (`?1` today, IST): the open tax invoices, export invoices and debit notes with a balance
 * (count and amount, tax included), and of those the ones past their due date. The due date is the last day to pay, so overdue is strictly before today.
 */
export const OWED_SQL = `SELECT d.currency, count(*) AS n, sum(d.balance_minor) AS balance,
       sum(CASE WHEN d.due_date < ?1 THEN 1 ELSE 0 END) AS overdue_n, sum(CASE WHEN d.due_date < ?1 THEN d.balance_minor ELSE 0 END) AS overdue_balance
   FROM documents d INDEXED BY documents_status_due
   WHERE d.status IN ${OPEN_STATUSES} AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL
   GROUP BY d.currency ORDER BY d.currency`;

/**
 * The five oldest overdue ones (`?1` today). One ordered read of five rows per open status (the index is `(status, due_date)`, so a single read with the three
 * statuses in a list would have to sort every overdue row), then the five oldest of those fifteen.
 */
const overdueOf = (status: string): string =>
  `SELECT * FROM (SELECT d.id, d.number_display, d.due_date, d.currency, d.balance_minor, d.client_id FROM documents d INDEXED BY documents_status_due
   WHERE d.status = '${status}' AND d.due_date < ?1 AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL ORDER BY d.due_date, d.rowid LIMIT 5)`;
export const OVERDUE_OLDEST_SQL = `SELECT o.id, o.number_display, o.due_date, o.currency, o.balance_minor, o.client_id, c.code AS client_code, c.display_name AS client_name
   FROM (${overdueOf("issued")} UNION ALL ${overdueOf("partially_paid")} UNION ALL ${overdueOf("partially_credited")}) o JOIN clients c ON c.id = o.client_id
   ORDER BY o.due_date, o.id LIMIT 5`;

/**
 * Proformas that still wait for payment, by currency (M6 of the early check, lead decision 2026-10-28): an `issued` proforma with a balance, and a part-paid
 * one. The only way a proforma becomes `converted` is a Q9 advance (`advanceIssueStatements`): it adds the amount to `paid_minor` and takes it off
 * `balance_minor`, so `converted` with `paid_minor > 0 AND balance_minor > 0` is a proforma paid in part whose remainder is still owed, and a fully
 * advanced one has `balance_minor = 0` and counts nowhere (its money is on the Q9 tax invoices: no double count, LD22). Read through the type and status
 * index, so a ledger of invoices is never scanned.
 */
export const PROFORMAS_AWAITING_SQL = `SELECT d.currency, count(*) AS n, sum(d.balance_minor) AS balance FROM documents d INDEXED BY documents_type_status_created
   WHERE d.type = 'proforma' AND d.status IN ('issued', 'converted') AND d.balance_minor > 0 AND (d.status = 'issued' OR d.paid_minor > 0)
     AND d.voided_at IS NULL AND d.frozen_at IS NOT NULL
   GROUP BY d.currency ORDER BY d.currency`;

/** The `tax` settings row, read in the same batch so the export statements below can be checked against it (`realisationParamsFromStoredTax`). */
export const SETTINGS_TAX_SQL = "SELECT s.value FROM settings s WHERE s.key = 'tax'";

/** How many open exports are in each stage today (`?1` today, IST), the rule values being the `tax` row's own. */
export const EXPORT_STAGE_COUNTS_SQL = `SELECT ${stageSql("d", settingsBinds("?1"))} AS stage, count(*) AS n
   FROM documents d INDEXED BY documents_export_issued
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.balance_minor > 0
   GROUP BY stage`;

/** The five exports nearest a deadline: in one of the four alert stages, the earliest deadline of the stage first (an overdue one before one that is approaching). */
export const EXPORT_NEXT_SQL = (() => {
  const p = settingsBinds("?1");
  return `SELECT d.id, d.number_display, d.issue_date, d.currency, d.balance_minor, d.client_id, c.code AS client_code, ${stageSql("d", p)} AS stage,
       CASE WHEN ${stageSql("d", p)} IN ('gst_approaching', 'gst_overdue') THEN ${gstDueSql("d", p)} ELSE ${femaDueSql("d", p)} END AS due
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.balance_minor > 0 AND ${stageSql("d", p)} IN (${ALERT_STAGE_LIST})
   ORDER BY due, d.id LIMIT 5`;
})();

// ---- a client's Overview figures and a project's billed figure (FX-3, A3 4 and A3 5; ADM-CLI-03, ADM-PRJ-05) ---------------------------------------
// The statement's rules (LD78; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)): the documents counted are the issued tax invoices, export invoices,
// debit notes and credit notes that are not voided; proformas never (LD22: not a tax document, their payment shows through the tax invoice). "Billed" is the
// statement's debit column over all time (invoices and debit notes, tax included); "credited" is its credit notes. "Collected" and "paid" wait for payments
// (M6), so nothing here reads a payment; a Q9 advance receipt already shows as a zero balance on the advance tax invoice it paid.
// An anonymised client gets no figures (its Overview and its projects show none): the index seek's key is a one-off lookup of the client (or the
// project) that is NULL when the client is anonymised, so the seek is skipped and its documents are never read, not even their index entries (FX-3
// fix round, item 7; a plain NOT EXISTS guard is checked per index entry). The admin answers `available: false` from the client row read in the same batch.

/**
 * A client's figures by currency (`?1` the client, `?2` today, IST): billed, credited, the balance (Σ `balance_minor` of its open debit documents: what a
 * statement made today closes at, `STATEMENT_LEDGER_SQL` for every currency at once) and the part of it past its due date (strictly before today, as
 * `OWED_SQL`). One read of `documents_client_issued` by the client: the rows read are the client's issued GST documents and nothing else. No rows for
 * an anonymised client (its row only is read).
 */
export const CLIENT_FIGURES_SQL = `SELECT d.currency,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.total_minor END), 0) AS billed,
       coalesce(sum(CASE WHEN d.type = 'credit_note' THEN d.total_minor END), 0) AS credited,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 THEN d.balance_minor END), 0) AS balance,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN d.balance_minor END), 0) AS overdue,
       count(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN 1 END) AS overdue_n
   FROM documents d INDEXED BY documents_client_issued
   WHERE d.client_id = (SELECT z.id FROM clients z WHERE z.id = ?1 AND z.anonymised_at IS NULL) AND ${ISSUED_GST} AND d.voided_at IS NULL AND d.status <> 'void'
   GROUP BY d.currency ORDER BY d.currency`;

/**
 * A project's billed and credited figures by currency (`?1` the project), from the same documents as the client's: the issued, not voided tax invoices,
 * export invoices, debit notes and credit notes made for the project (a milestone invoice or a Q9 advance carries the milestone's project; a note copies its
 * parent's). Read through `documents_project`: a project has a handful of documents. No rows when the project's client is anonymised (the project and
 * client rows only are read).
 */
export const PROJECT_BILLED_SQL = `SELECT d.currency,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.total_minor END), 0) AS billed,
       coalesce(sum(CASE WHEN d.type = 'credit_note' THEN d.total_minor END), 0) AS credited
   FROM documents d INDEXED BY documents_project
   WHERE d.project_id = (SELECT zp.id FROM projects zp JOIN clients z ON z.id = zp.client_id WHERE zp.id = ?1 AND z.anonymised_at IS NULL)
     AND ${ISSUED_GST} AND d.voided_at IS NULL AND d.status <> 'void'
   GROUP BY d.currency ORDER BY d.currency`;

/** One currency of `CLIENT_FIGURES_SQL` as D1 returns it. */
export type ClientFiguresRow = {
  currency: "INR" | "USD";
  billed: number;
  credited: number;
  balance: number;
  overdue: number;
  overdue_n: number;
};
/** One currency of `PROJECT_BILLED_SQL` as D1 returns it. */
export type ProjectBilledRow = { currency: "INR" | "USD"; billed: number; credited: number };
