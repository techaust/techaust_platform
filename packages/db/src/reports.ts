// The report statements (M5.5b, LD71 to LD80; ADM-REP-04, ADM-REP-06, ADM-REP-07, ADM-CLI-04, ADM-DASH-01): the GST and CA register, the EDF month, the
// realisation list and scan, a client's statement of account and the dashboard's finance figures. Plain SQL text, bound by the caller; every statement
// is EXPLAIN-tested (`packages/db/test/reports.test.ts`) so a new filter never goes unindexed. Pages are keysets of at most 50 rows (LIMIT 51: the 51st
// says there is a next page), as the admin lists are. Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01) for every tax reading (docs/08-research-appendix/A-gst-invoicing.md).
// The Workers never parse `documents.computed` for a page: the rates of each document come from SQL over `json_each(computed, '$.lines')` (a twin of core
// `registerRatesOf`, proved by test), summed in INR (the line values on an INR document, the `inr` view of each line on a USD one).
import {
  ALERT_STAGE_LIST,
  EXPORT_STAGES,
  femaDueSql,
  gstDueSql,
  type RealisationSql,
  SCAN_BINDS,
  settingsBinds,
  stageSql,
} from "./realisation.ts";
import { paymentNetSql, SQL_CURRENCIES } from "./sql-rules.ts";

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
       ${RATES_SQL} AS rates,
       CASE d.type WHEN 'export_invoice' THEN (SELECT max(x.extended_to) FROM realisation_extensions x WHERE x.document_id = d.id) END AS extended_to`;

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
  /** M6.1 (Q60, L14): an export invoice's latest AD-bank extension of its FEMA period (one seek of `realisation_extensions_document`); NULL otherwise. */
  extended_to: string | null;
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
 * the client's, in the currency), and from M6.1 the CONFIRMED payments of the ledger (L4: the advance receipts of Q9 were back-filled as payments, 0060): a
 * `receipt` line for money received (its full amount, dated by the day it arrived; the number is the tax invoice an advance paid, else the bank reference, else '' (never NULL: the PDF escapes it)) and
 * a `tds` line for tax the client deducted (T8; dated by its advice; the number is the invoice it is on). A pending, rejected or withdrawn payment is never a line.
 * `ord` orders one day: 1 a debit document, 2 a credit note, 3 a receipt, 4 a TDS line; `sk` is `date|ord`, the keyset key with `id`. Proformas are not here
 * (LD78: not a tax document; their payment shows through the tax invoice). `cond` is a SQL fragment over a date expression, e.g. `x BETWEEN ?3 AND ?4`. With
 * `withParent`, a credit or debit note carries the number of the invoice it is against (`parent`; FX-4, full audit A5 7: debit notes too); every other line NULL.
 */
const statementSource = (cond: (dateExpr: string) => string, withParent = false): string =>
  `(SELECT d.id AS id, d.type AS kind, d.issue_date AS date, CASE d.type WHEN 'credit_note' THEN 2 ELSE 1 END AS ord, d.number_display AS number, d.total_minor AS amount,
           d.issue_date || '|' || CASE d.type WHEN 'credit_note' THEN 2 ELSE 1 END AS sk${withParent ? ", CASE WHEN d.type IN ('credit_note', 'debit_note') THEN (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id) END AS parent" : ""}
      FROM documents d INDEXED BY documents_client_issued
      WHERE d.frozen_at IS NOT NULL AND d.type IN ${GST_TYPES} AND d.client_id = ?1 AND d.currency = ?2 AND d.voided_at IS NULL AND d.status <> 'void' AND ${cond("d.issue_date")}
    UNION ALL
    SELECT r.id, CASE r.kind WHEN 'tds' THEN 'tds' ELSE 'receipt' END, r.received_on, CASE r.kind WHEN 'tds' THEN 4 ELSE 3 END,
           CASE r.kind WHEN 'tds' THEN coalesce((SELECT td.number_display FROM payment_allocations ta JOIN documents td ON td.id = ta.document_id WHERE ta.payment_id = r.id AND ta.kind = 'allocate' LIMIT 1), '')
             ELSE coalesce((SELECT inv.number_display FROM advance_receipts ar JOIN documents inv ON inv.id = ar.invoice_id WHERE ar.id = r.advance_receipt_id), r.reference_norm, '') END,
           r.amount_minor, r.received_on || '|' || CASE r.kind WHEN 'tds' THEN 4 ELSE 3 END${withParent ? ", NULL" : ""}
      FROM payments r INDEXED BY payments_client
      WHERE r.client_id = ?1 AND r.currency = ?2 AND r.status = 'confirmed' AND ${cond("r.received_on")}) u`;

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

/**
 * What a statement made today must close at (`?1` client, `?2` currency), from the ledger itself (M6.1, run file B): Σ (total − paid − credited − TDS) over the
 * client's issued, not voided debit documents, minus the client's credit (what its confirmed payments hold unallocated). Not Σ `balance_minor`: a document's
 * balance stops at zero, while an excess on it (paid, credited and TDS above its total) is money the client is owed, so it lowers the closing balance. Equal to
 * debits − credit notes − receipts − TDS lines (a test proves the two agree).
 */
export const STATEMENT_LEDGER_SQL = `SELECT (SELECT coalesce(sum(d.total_minor - d.paid_minor - d.credited_minor - d.tds_minor), 0) FROM documents d INDEXED BY documents_client_issued
       WHERE d.client_id = ?1 AND d.currency = ?2 AND ${ISSUED_GST} AND d.type IN ${DEBIT_KINDS} AND d.voided_at IS NULL AND d.status <> 'void')
     - (SELECT coalesce(sum(p.amount_minor - ${paymentNetSql("p.id")}), 0) FROM payments p INDEXED BY payments_client
       WHERE p.client_id = ?1 AND p.currency = ?2 AND p.status = 'confirmed' AND p.kind = 'payment') AS balance`;

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
 * The dashboard's one-pass figures (L33; early check 2, finding 6 of M6.1): D1 counts every row a temporary GROUP BY b-tree takes in and gives back, which
 * doubled what a grouped figure read (measured at 2,000 documents: 4,000 for the invoiced figure, 4,003 for the owed one). Each figure below is instead ONE
 * aggregate row with a column set per currency (`SQL_CURRENCIES`) or per stage (`EXPORT_STAGES`), turned into the grouped rows afterwards by a join with
 * the list's constant rows (alias `cur` or `st`), the zero rows dropped. Same rows, same columns, same order as the grouped statement each one replaces:
 * those are kept below as `*_GROUPED_SQL`, the reference twins the tests hold them equal to (never run by a Worker).
 */
const currencyRows = `SELECT column1 AS currency FROM (VALUES ${SQL_CURRENCIES.map((c) => `('${c}')`).join(", ")})`;
/** The column `<col>_<currency>` of the aggregate row `t` for the currency row `cur`. */
const pickCurrency = (col: string): string =>
  `CASE cur.currency ${SQL_CURRENCIES.map((c) => `WHEN '${c}' THEN t.${col}_${c}`).join(" ")} END`;
/** One aggregate row `t` (the `cols` of each currency, over `from`) turned into one row per currency whose `count` column is above zero, by currency. */
const byCurrency = (cols: (c: string) => string[], select: string, from: string, count: string): string =>
  `SELECT cur.currency, ${select}
   FROM (SELECT ${SQL_CURRENCIES.flatMap(cols).join(",\n       ")}
         ${from}) t
   JOIN (${currencyRows}) cur
   WHERE ${pickCurrency(count)} > 0 ORDER BY cur.currency`;

/** A credit note's amounts count negative. */
const signed = (col: string): string => `CASE d.type WHEN 'credit_note' THEN -d.${col} ELSE d.${col} END`;
/** The INR value of the taxable amount of a document in currency `c`: the amount itself in INR, a USD document's `computed.inr` (NULL when it lacks it). */
const inrTaxableOf = (c: string): string =>
  c === "INR" ? "d.taxable_minor" : "json_extract(d.computed, '$.inr.taxableMinor')";

/**
 * Invoiced in the financial year `?1` to `?2` and in the month from `?3` (to `?2`'s month: the caller passes the month's first day), by currency. Credit
 * notes count negative; voided documents and proformas never. `taxable` is before GST, `total` with it, `inr_taxable` the INR value of the taxable amount
 * (a USD document's `computed.inr`); NULL when a USD document lacks it, never zero. One pass over the FY's entries of `documents_issued_on`, no GROUP BY
 * (L33): one row read per document. The twin of `INVOICED_GROUPED_SQL`.
 */
export const INVOICED_SQL = /* @__PURE__ */ (() => {
  const sgn = "CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END";
  const cols = (c: string): string[] => {
    const is = `d.currency = '${c}'`;
    const month = `${is} AND d.issue_date >= ?3`;
    const inr = inrTaxableOf(c);
    return [
      `count(CASE WHEN ${is} THEN 1 END) AS fyd_${c}`,
      `sum(CASE WHEN ${is} THEN ${signed("taxable_minor")} END) AS fyt_${c}`,
      `sum(CASE WHEN ${is} THEN ${signed("total_minor")} END) AS fyg_${c}`,
      `count(CASE WHEN ${is} THEN ${inr} END) AS fyic_${c}`,
      `sum(CASE WHEN ${is} THEN ${sgn} * ${inr} END) AS fyi_${c}`,
      `count(CASE WHEN ${month} THEN 1 END) AS md_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${signed("taxable_minor")} END), 0) AS mt_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${signed("total_minor")} END), 0) AS mg_${c}`,
      `count(CASE WHEN ${month} THEN ${inr} END) AS mic_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${sgn} * ${inr} END), 0) AS mi_${c}`,
    ];
  };
  const select = `${pickCurrency("fyd")} AS fy_documents, ${pickCurrency("fyt")} AS fy_taxable, ${pickCurrency("fyg")} AS fy_total,
       CASE WHEN ${pickCurrency("fyic")} < ${pickCurrency("fyd")} THEN NULL ELSE ${pickCurrency("fyi")} END AS fy_inr_taxable,
       ${pickCurrency("md")} AS month_documents, ${pickCurrency("mt")} AS month_taxable, ${pickCurrency("mg")} AS month_total,
       CASE WHEN ${pickCurrency("mic")} < ${pickCurrency("md")} THEN NULL ELSE ${pickCurrency("mi")} END AS month_inr_taxable`;
  return byCurrency(
    cols,
    select,
    `FROM documents d INDEXED BY documents_issued_on
         WHERE ${ISSUED_GST} AND d.voided_at IS NULL AND d.issue_date >= ?1 AND d.issue_date <= ?2`,
    "fyd",
  );
})();

/**
 * What clients owe, and how much of it is overdue, by currency, in ONE read (`?1` today, IST): the open tax invoices, export invoices and debit notes with a balance
 * (count and amount, tax included), and of those the ones past their due date. The due date is the last day to pay, so overdue is strictly before today.
 * One pass over the open statuses of `documents_status_due`, no GROUP BY (L33). The twin of `OWED_GROUPED_SQL`.
 */
export const OWED_SQL = /* @__PURE__ */ (() =>
  byCurrency(
    (c) => {
      const is = `d.currency = '${c}'`;
      return [
        `count(CASE WHEN ${is} THEN 1 END) AS n_${c}`,
        `sum(CASE WHEN ${is} THEN d.balance_minor END) AS b_${c}`,
        `sum(CASE WHEN ${is} THEN CASE WHEN d.due_date < ?1 THEN 1 ELSE 0 END END) AS on_${c}`,
        `sum(CASE WHEN ${is} THEN CASE WHEN d.due_date < ?1 THEN d.balance_minor ELSE 0 END END) AS ob_${c}`,
      ];
    },
    `${pickCurrency("n")} AS n, ${pickCurrency("b")} AS balance, ${pickCurrency("on")} AS overdue_n, ${pickCurrency("ob")} AS overdue_balance`,
    `FROM documents d INDEXED BY documents_status_due
         WHERE d.status IN ${OPEN_STATUSES} AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL`,
    "n",
  ))();

/** The reference twin of `INVOICED_SQL` (tests only): the grouped statement of M5.5b. */
export const INVOICED_GROUPED_SQL = `SELECT d.currency,
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

/** The reference twin of `OWED_SQL` (tests only): the grouped statement of M5.5b. */
export const OWED_GROUPED_SQL = `SELECT d.currency, count(*) AS n, sum(d.balance_minor) AS balance,
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
 * index, so a ledger of invoices is never scanned. One pass, no GROUP BY (L33). The twin of `PROFORMAS_AWAITING_GROUPED_SQL`.
 */
const PROFORMAS_AWAITING_FROM = `FROM documents d INDEXED BY documents_type_status_created
   WHERE d.type = 'proforma' AND d.status IN ('issued', 'converted') AND d.balance_minor > 0 AND (d.status = 'issued' OR d.paid_minor > 0)
     AND d.voided_at IS NULL AND d.frozen_at IS NOT NULL`;
export const PROFORMAS_AWAITING_SQL = /* @__PURE__ */ (() =>
  byCurrency(
    (c) => [
      `count(CASE WHEN d.currency = '${c}' THEN 1 END) AS n_${c}`,
      `sum(CASE WHEN d.currency = '${c}' THEN d.balance_minor END) AS b_${c}`,
    ],
    `${pickCurrency("n")} AS n, ${pickCurrency("b")} AS balance`,
    PROFORMAS_AWAITING_FROM,
    "n",
  ))();
/** The reference twin of `PROFORMAS_AWAITING_SQL` (tests only): the grouped statement of M5.5b. */
export const PROFORMAS_AWAITING_GROUPED_SQL = `SELECT d.currency, count(*) AS n, sum(d.balance_minor) AS balance ${PROFORMAS_AWAITING_FROM}
   GROUP BY d.currency ORDER BY d.currency`;

/** The `tax` settings row, read in the same batch so the export statements below can be checked against it (`realisationParamsFromStoredTax`). */
export const SETTINGS_TAX_SQL = "SELECT s.value FROM settings s WHERE s.key = 'tax'";

/**
 * How many open exports are in each stage today (`?1` today, IST), the rule values being the `tax` row's own: one row per stage that has any, by stage.
 * The stage of each export is worked out once, in a subquery (`sg`) that `LIMIT -1` keeps from being flattened into the aggregate (flattened, the stage expression,
 * with its correlated extension seeks, would be copied into every stage's column); the counts are one aggregate row with a column per stage
 * (`EXPORT_STAGES`), no GROUP BY (L33). The twin of `EXPORT_STAGE_COUNTS_GROUPED_SQL`.
 */
export const EXPORT_STAGE_COUNTS_SQL = /* @__PURE__ */ (() => {
  const stageRows = `SELECT column1 AS stage FROM (VALUES ${EXPORT_STAGES.map((s) => `('${s}')`).join(", ")})`;
  const pick = `CASE st.stage ${EXPORT_STAGES.map((s) => `WHEN '${s}' THEN t.n_${s}`).join(" ")} END`;
  return `SELECT st.stage, ${pick} AS n
   FROM (SELECT ${EXPORT_STAGES.map((s) => `count(CASE sg.stage WHEN '${s}' THEN 1 END) AS n_${s}`).join(", ")}
         FROM (SELECT ${stageSql("d", settingsBinds("?1"))} AS stage
               FROM documents d INDEXED BY documents_export_issued
               WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.balance_minor > 0 LIMIT -1) sg) t
   JOIN (${stageRows}) st
   WHERE ${pick} > 0 ORDER BY st.stage`;
})();
/** The reference twin of `EXPORT_STAGE_COUNTS_SQL` (tests only): the grouped statement of M5.5b. */
export const EXPORT_STAGE_COUNTS_GROUPED_SQL =
  /* @__PURE__ */ (() => `SELECT ${stageSql("d", settingsBinds("?1"))} AS stage, count(*) AS n
   FROM documents d INDEXED BY documents_export_issued
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.balance_minor > 0
   GROUP BY stage`)();

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
// statement's debit column over all time (invoices and debit notes, tax included); "credited" is its credit notes. M6.1 (the 13 row of 2026-10-29): "collected" is
// the client's confirmed payments (money received, not TDS) and "credit" what they hold unallocated (L2); a project's "paid" is what was paid on its documents.
// An anonymised client gets no figures (its Overview and its projects show none): the index seek's key is a one-off lookup of the client (or the
// project) that is NULL when the client is anonymised, so the seek is skipped and its documents are never read, not even their index entries (FX-3
// fix round, item 7; a plain NOT EXISTS guard is checked per index entry). The admin answers `available: false` from the client row read in the same batch.

/**
 * M6.1: the client's (`?1`) confirmed payments by currency, as one JSON object (`{"INR": n}`), a seek of `payments_client`; and what those payments hold net
 * on documents, the same way (the allocations read by payment). The client's credit is the first less the second (L2).
 */
const COLLECTED_BY_CURRENCY = `(SELECT json_group_object(x.cur, x.amount) FROM (SELECT cp.currency AS cur, sum(cp.amount_minor) AS amount FROM payments cp INDEXED BY payments_client
       WHERE cp.client_id = ?1 AND cp.status = 'confirmed' AND cp.kind = 'payment' GROUP BY cp.currency) x)`;
const ALLOCATED_BY_CURRENCY = `(SELECT json_group_object(y.cur, y.net) FROM (SELECT ap.currency AS cur, sum(CASE aa.kind WHEN 'allocate' THEN aa.amount_minor ELSE -aa.amount_minor END) AS net
       FROM payments ap INDEXED BY payments_client JOIN payment_allocations aa INDEXED BY payment_allocations_payment ON aa.payment_id = ap.id
       WHERE ap.client_id = ?1 AND ap.status = 'confirmed' AND ap.kind = 'payment' GROUP BY ap.currency) y)`;
/**
 * A client's figures by currency (`?1` the client, `?2` today, IST): billed, credited, the balance (Σ `balance_minor` of its open debit documents: what the
 * client owes, each document stopping at zero) and the part of it past its due date (strictly before today, as `OWED_SQL`). M6.1 (early check A4): `excess`
 * is Σ max(0, paid + credited + TDS − total) over the debit documents (what was settled above what they owe), so what a statement made today closes at is
 * `balance − excess − credit` (`STATEMENT_LEDGER_SQL`; a twin test proves it). One read of `documents_client_issued` by the client: the rows read are the
 * client's issued GST documents and nothing else. No rows for an anonymised client (its row only is read). M6.1: `tds` (TDS recorded on its debit documents),
 * `collected` (its confirmed payments in the currency) and `credit` (what they hold unallocated). A currency with payments and no issued document has no row
 * here: `CLIENT_PAYMENTS_ONLY_SQL` answers it, in the same batch (code review finding 7).
 *
 * Code review finding 8: each payment aggregate is evaluated once. The grouped documents are a derived table `f` whose `pay` column holds both amounts for the
 * currency (`[collected, allocated]`); the outer query reads it twice without evaluating `COLLECTED_BY_CURRENCY` again. The order is the inner `ORDER BY`
 * (an outer one would add a sorter that D1 counts as rows read; a client has one currency, M3.3).
 */
export const CLIENT_FIGURES_SQL = `SELECT f.currency, f.billed, f.credited, f.balance, f.overdue, f.overdue_n, f.tds, f.excess,
       coalesce(json_extract(f.pay, '$[0]'), 0) AS collected, coalesce(json_extract(f.pay, '$[0]'), 0) - coalesce(json_extract(f.pay, '$[1]'), 0) AS credit
   FROM (SELECT d.currency,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.total_minor END), 0) AS billed,
       coalesce(sum(CASE WHEN d.type = 'credit_note' THEN d.total_minor END), 0) AS credited,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 THEN d.balance_minor END), 0) AS balance,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN d.balance_minor END), 0) AS overdue,
       count(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN 1 END) AS overdue_n,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.tds_minor END), 0) AS tds,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN max(0, d.paid_minor + d.credited_minor + d.tds_minor - d.total_minor) END), 0) AS excess,
       json_array(json_extract(${COLLECTED_BY_CURRENCY}, '$.' || d.currency), json_extract(${ALLOCATED_BY_CURRENCY}, '$.' || d.currency)) AS pay
     FROM documents d INDEXED BY documents_client_issued
     WHERE d.client_id = (SELECT z.id FROM clients z WHERE z.id = ?1 AND z.anonymised_at IS NULL) AND ${ISSUED_GST} AND d.voided_at IS NULL AND d.status <> 'void'
     GROUP BY d.currency ORDER BY d.currency) f`;

/**
 * Code review finding 7: a client's collected money and credit in a currency that has payments and no issued GST document (`?1` the client), so the Overview
 * shows Collected and Credit held before the first invoice; `clientFinance` adds such a currency to the figures with its document figures at zero. Both
 * conditions are constant, so they are checked before any payment is read: a client with an issued document (which every client with invoices has) costs one
 * probe of `documents_client_issued`, and an anonymised client has no rows. A client has one currency (M3.3; it locks once an invoice or a payment exists).
 */
export const CLIENT_PAYMENTS_ONLY_SQL = `SELECT pc.cur AS currency, pc.amount AS collected, pc.amount - coalesce(json_extract(${ALLOCATED_BY_CURRENCY}, '$.' || pc.cur), 0) AS credit
   FROM (SELECT cp.currency AS cur, sum(cp.amount_minor) AS amount FROM payments cp INDEXED BY payments_client
         WHERE cp.client_id = ?1 AND cp.status = 'confirmed' AND cp.kind = 'payment' GROUP BY cp.currency ORDER BY cp.currency) pc
   WHERE NOT EXISTS (SELECT 1 FROM documents x INDEXED BY documents_client_issued
           WHERE x.client_id = ?1 AND x.frozen_at IS NOT NULL AND x.type IN ${GST_TYPES} AND x.voided_at IS NULL AND x.status <> 'void')
     AND EXISTS (SELECT 1 FROM clients y WHERE y.id = ?1 AND y.anonymised_at IS NULL)`;

/** One currency of `CLIENT_PAYMENTS_ONLY_SQL` as D1 returns it. */
export type ClientPaymentsOnlyRow = { currency: "INR" | "USD"; collected: number; credit: number };

/**
 * A project's billed and credited figures by currency (`?1` the project), from the same documents as the client's: the issued, not voided tax invoices,
 * export invoices, debit notes and credit notes made for the project (a milestone invoice or a Q9 advance carries the milestone's project; a note copies its
 * parent's). Read through `documents_project`: a project has a handful of documents. No rows when the project's client is anonymised (the project and
 * client rows only are read). M6.1: `paid` (money on its debit documents, from the ledger) and `tds`.
 */
export const PROJECT_BILLED_SQL = `SELECT d.currency,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.total_minor END), 0) AS billed,
       coalesce(sum(CASE WHEN d.type = 'credit_note' THEN d.total_minor END), 0) AS credited,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.paid_minor END), 0) AS paid,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.tds_minor END), 0) AS tds
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
  /** M6.1 */
  tds: number;
  /** M6.1 (early check A4): Σ max(0, paid + credited + TDS − total) over the debit documents. */
  excess: number;
  collected: number;
  credit: number;
};
/** One currency of `PROJECT_BILLED_SQL` as D1 returns it. */
export type ProjectBilledRow = {
  currency: "INR" | "USD";
  billed: number;
  credited: number;
  /** M6.1 */
  paid: number;
  tds: number;
};

// ---- the payments and TDS register (M6.1; run file C, `GET /reports/payments`) -----------------------------------------------------------------------

/**
 * One page of the payments and TDS register: the CONFIRMED payments received from `?1` to `?2` (ISO, inclusive; the route passes one FY), money received and TDS
 * alike (the SPA puts the TDS rows apart for matching with Form 26AS and the AIS), oldest first by `(received_on, id)`, with a next page from `?3`/`?4`. Each row
 * carries its client (code and name), the bank's INR amount of a USD payment (L15, never a GST figure), the TDS section, rate and certificate, and its
 * allocations as JSON (`documentId`, `number`, `kind`, `amountMinor`). A pending, rejected or withdrawn payment is not in it. At most 51 rows, read through
 * `payments_confirmed`.
 */
export const PAYMENTS_REGISTER_SQL = (after: boolean): string =>
  `SELECT p.id, p.kind, p.received_on, p.currency, p.amount_minor, p.charges_minor, p.mode, p.reference_norm, p.inr_received_minor, p.tds_section, p.tds_rate_bp,
       p.tds_certificate_no, p.tds_certificate_on, p.proof_kind, p.proof_ref, p.client_id, c.code AS client_code, c.display_name AS client_name,
       (SELECT json_group_array(json_object('documentId', a.document_id, 'number', ad.number_display, 'kind', a.kind, 'amountMinor', a.amount_minor))
          FROM payment_allocations a INDEXED BY payment_allocations_payment JOIN documents ad ON ad.id = a.document_id WHERE a.payment_id = p.id) AS allocations
   FROM payments p INDEXED BY payments_confirmed JOIN clients c ON c.id = p.client_id
   WHERE p.status = 'confirmed' AND p.received_on >= ?1 AND p.received_on <= ?2 ${after ? "AND (p.received_on > ?3 OR (p.received_on = ?3 AND p.id > ?4))" : ""}
   ORDER BY p.received_on, p.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/** One row of `PAYMENTS_REGISTER_SQL` as D1 returns it. */
export type PaymentsRegisterRow = {
  id: string;
  kind: "payment" | "tds";
  received_on: string;
  currency: "INR" | "USD";
  amount_minor: number;
  charges_minor: number;
  mode: string | null;
  reference_norm: string | null;
  inr_received_minor: number | null;
  tds_section: string | null;
  tds_rate_bp: number | null;
  tds_certificate_no: string | null;
  tds_certificate_on: string | null;
  proof_kind: string | null;
  proof_ref: string | null;
  client_id: string;
  client_code: string;
  client_name: string;
  allocations: string;
};
