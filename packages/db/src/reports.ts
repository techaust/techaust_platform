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
  notRealisedSql,
  proofMissingSql,
  type RealisationSql,
  reductionsSql,
  SCAN_BINDS,
  settingsBinds,
  stageOpenSql,
  stageSql,
} from "./realisation.ts";
import {
  istDayEndMsSql,
  paymentFreeSql,
  refundOutAtSql,
  refundsOutSql,
  SQL_CURRENCIES,
} from "./sql-rules.ts";

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
export const RATES_SQL = /* @__PURE__ */ (() =>
  `(SELECT json_group_array(json_object('sac', g.sac, 'rateBp', g.rate, 'taxableMinor', g.taxable, 'igstMinor', g.igst, 'cgstMinor', g.cgst, 'sgstMinor', g.sgst))
      FROM (SELECT json_extract(l.value, '$.sac') AS sac, json_extract(l.value, '$.effectiveRateBp') AS rate,
                   ${inrSum("taxableMinor")} AS taxable, ${inrSum("igstMinor")} AS igst, ${inrSum("cgstMinor")} AS cgst, ${inrSum("sgstMinor")} AS sgst
            FROM json_each(d.computed, '$.lines') l GROUP BY sac, rate ORDER BY sac, rate) g)`)();

/**
 * The columns of one register row (what core's `RegisterApiRow` is made of), for a documents row `d` joined to its client `c`. INR amounts: an INR document's own
 * columns, a USD document's `total_inr_minor` and `computed.inr.roundOffMinor`. The note's parent block is `header_extras.noteOf.parent` (LD53) as JSON text; the
 * recipient fields come from the frozen snapshot, never the live client (an anonymised client's issued documents keep what they said at issue).
 */
export const REGISTER_COLUMNS = /* @__PURE__ */ (() =>
  `d.id, d.type, d.series, d.fy, d.number AS seq, d.number_display, d.issue_date, d.currency, d.total_minor,
       coalesce(d.total_inr_minor, CASE d.currency WHEN 'INR' THEN d.total_minor END) AS total_inr_minor,
       CASE d.currency WHEN 'INR' THEN d.round_off_minor ELSE json_extract(d.computed, '$.inr.roundOffMinor') END AS round_off_inr_minor,
       d.fx_rate_micros, d.supply_type, d.place_of_supply_code, d.balance_minor, d.voided_at, d.client_id, c.code AS client_code,
       coalesce(json_extract(d.recipient, '$.legalName'), json_extract(d.recipient, '$.displayName')) AS r_name, json_extract(d.recipient, '$.gstStatus') AS r_status, json_extract(d.recipient, '$.gstin') AS r_gstin,
       json_extract(d.recipient, '$.stateCode') AS r_state, json_extract(d.recipient, '$.country') AS r_country, json_extract(d.recipient, '$.address') AS r_address,
       json_extract(d.header_extras, '$.noteOf') AS note_of, json_extract(d.issuer, '$.bank.swift.purposeCode') AS purpose_code, d.ims_status,
       ${RATES_SQL} AS rates,
       CASE d.type WHEN 'export_invoice' THEN (SELECT max(x.extended_to) FROM realisation_extensions x WHERE x.document_id = d.id) END AS extended_to`)();

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
  `SELECT ${REGISTER_COLUMNS}, ${REALISATION_FACT_COLUMNS}
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND d.issue_date >= ?1 AND d.issue_date <= ?2 ${after ? KEYSET : ""}
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/**
 * The realisation list: every non-voided export invoice (`open`: with an amount still outstanding), oldest first; the keyset is `?1` and `?2`. The first page
 * has no cursor, so `?1`/`?2` are only there for a next page.
 */
export const REALISATION_PAGE_SQL = (show: "open" | "all", after: boolean): string =>
  `SELECT ${REGISTER_COLUMNS}, ${REALISATION_FACT_COLUMNS}
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL ${show === "open" ? `AND ${notRealisedSql("d")}` : ""} ${after ? "AND (d.issue_date > ?1 OR (d.issue_date = ?1 AND d.id > ?2))" : ""}
   ORDER BY d.issue_date, d.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/**
 * M6.5 (RB-43, RA-38, L13): the facts beyond the balance that decide an export's stage and its EDF "Amount realised" (`edf-v2`), for the realisation list and the
 * EDF month: what was paid on it (net of a refund's release), Σ the AD bank's Reg. 6 reductions with the latest one's day and reference, and whether a card or
 * PayPal payment on it still lacks its proof (an LUT export is realised for GST only once each has one). The SPA passes them to core `realisationStatus`.
 * B4 (`edf-v2`): and what its credit notes took off it (`credited_minor`), shown beside "Amount realised".
 */
export const REALISATION_FACT_COLUMNS = /* @__PURE__ */ (() =>
  `d.paid_minor, d.total_minor AS doc_total_minor, d.credited_minor, ${reductionsSql("d")} AS reductions_minor,
       (SELECT rr.approved_on FROM realisation_reductions rr WHERE rr.document_id = d.id ORDER BY rr.approved_on DESC, rr.id DESC LIMIT 1) AS reduction_on,
       (SELECT rr.bank_ref FROM realisation_reductions rr WHERE rr.document_id = d.id ORDER BY rr.approved_on DESC, rr.id DESC LIMIT 1) AS reduction_ref,
       CASE WHEN d.supply_type = 'export_lut' THEN ${proofMissingSql("d")} ELSE 0 END AS proof_missing`)();
/** The M6.5 columns of `REALISATION_FACT_COLUMNS` as D1 returns them (alongside a `RegisterSqlRow`). */
export type RealisationFactRow = {
  paid_minor: number;
  doc_total_minor: number;
  /** B4 (`edf-v2`). */
  credited_minor: number;
  reductions_minor: number;
  reduction_on: string | null;
  reduction_ref: string | null;
  proof_missing: number;
};

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
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND ${stageOpenSql("d")}
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
/** M6.5: the statement LINE kinds that add to what the client owes: the debit documents and a `refund` (money we paid back lowers the client's credit). */
const LINE_DEBIT_KINDS = "('tax_invoice', 'export_invoice', 'debit_note', 'refund')";

/**
 * The lines of a client's statement as one source `u(id, kind, date, ord, number, amount, sk)`: the debit documents and credit notes (issued, not voided,
 * the client's, in the currency), and from M6.1 the CONFIRMED payments of the ledger (L4: the advance receipts of Q9 were back-filled as payments, 0060): a
 * `receipt` line for money received (its full amount, dated by the day it arrived; the number is the tax invoice an advance paid, else the bank reference, else '' (never NULL: the PDF escapes it)) and
 * a `tds` line for tax the client deducted (T8; dated by its advice; the number is the invoice it is on). A pending, rejected or withdrawn payment is never a line.
 * M6.5 (L9): a `refund` line (a debit, core `STATEMENT_DEBIT_TYPES`) for each SUCCEEDED refund of a confirmed payment, dated by the IST day it succeeded
 * (`settled_on`); its number is the bank reference of a manual refund, else the gateway's refund id, else ''. A refund still with the gateway is not a line.
 * M6–M7 audit AU37 (Settled by the lead on the safest reading, 2026-11-07 (08-C RA-41)): the whole statement is as at the end of its last day `?4` (bound by
 * every statement read, the balance before a page too): a refund that came back after that day is still a line, so a past statement never moves.
 * `ord` orders one day: 1 a debit document, 2 a credit note, 3 a receipt, 4 a TDS line, 5 a refund; `sk` is `date|ord`, the keyset key with `id`. Proformas are not here
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
      WHERE r.client_id = ?1 AND r.currency = ?2 AND r.status = 'confirmed' AND ${cond("r.received_on")}
    UNION ALL
    SELECT f.id, 'refund', f.settled_on, 5, coalesce(f.reference_norm, f.provider_refund_id, ''), f.amount_minor, f.settled_on || '|5'${withParent ? ", NULL" : ""}
      FROM payment_refunds f INDEXED BY payment_refunds_client JOIN payments fp ON fp.id = f.payment_id
      WHERE f.client_id = ?1 AND f.currency = ?2 AND ${refundOutAtSql("f", istDayEndMsSql("?4"))} AND fp.status = 'confirmed' AND ${cond("f.settled_on")}) u`;

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
    ? `SELECT coalesce(sum(CASE WHEN u.kind IN ${LINE_DEBIT_KINDS} THEN u.amount ELSE -u.amount END), 0) AS balance
       FROM ${statementSource(() => "1 = 1")} WHERE (u.sk < ?5 OR (u.sk = ?5 AND u.id <= ?6))`
    : `SELECT coalesce(sum(CASE WHEN u.kind IN ${LINE_DEBIT_KINDS} THEN u.amount ELSE -u.amount END), 0) AS balance
       FROM ${statementSource((x) => `${x} < ?3`)}`;

/**
 * Every line of a range for the statement PDF (`?1` client, `?2` currency, `?3` and `?4` the range), oldest first, at most `limit` rows (the caller passes the PDF's
 * maximum plus one, so a longer statement is told apart from one that exactly fits). The same lines, order and parent numbers as the pages.
 */
export const STATEMENT_ENTRIES_SQL = (limit: number): string =>
  `SELECT u.id, u.kind, u.date, u.number, u.amount, u.sk, u.parent FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`, true)}
   ORDER BY u.sk, u.id LIMIT ${Math.trunc(limit)}`;

/** The range's debits, credits and number of lines (`?1` client, `?2` currency, `?3` and `?4` the range). */
export const STATEMENT_TOTALS_SQL = /* @__PURE__ */ (() =>
  `SELECT coalesce(sum(CASE WHEN u.kind IN ${LINE_DEBIT_KINDS} THEN u.amount END), 0) AS debit,
       coalesce(sum(CASE WHEN u.kind NOT IN ${LINE_DEBIT_KINDS} THEN u.amount END), 0) AS credit, count(*) AS n
   FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`)}`)();

/** The same count alone, for the PDF request's 200-line limit (it never reads more than needed to know). */
export const STATEMENT_COUNT_SQL = /* @__PURE__ */ (() =>
  `SELECT count(*) AS n FROM ${statementSource((x) => `${x} >= ?3 AND ${x} <= ?4`)}`)();

/**
 * What a statement made today must close at (`?1` client, `?2` currency), from the ledger itself (M6.1, run file B): Σ (total − paid − credited − TDS) over the
 * client's issued, not voided debit documents, minus the client's credit (what its confirmed payments hold unallocated). Not Σ `balance_minor`: a document's
 * balance stops at zero, while an excess on it (paid, credited and TDS above its total) is money the client is owed, so it lowers the closing balance. Equal to
 * debits − credit notes − receipts − TDS lines + refund lines (a test proves the two agree). M6.5 (L35): each payment's free money through `paymentFreeSql` with the
 * refunds that went out only (`succeeded`, the ones the statement lists): while a refund is still with the gateway its money is neither credit nor a line, so the
 * statement closes higher than `balance − excess − credit` of `CLIENT_FIGURES_SQL` by exactly the refunds in flight.
 */
export const STATEMENT_LEDGER_SQL = /* @__PURE__ */ (() =>
  `SELECT (SELECT coalesce(sum(d.total_minor - d.paid_minor - d.credited_minor - d.tds_minor), 0) FROM documents d INDEXED BY documents_client_issued
       WHERE d.client_id = ?1 AND d.currency = ?2 AND ${ISSUED_GST} AND d.type IN ${DEBIT_KINDS} AND d.voided_at IS NULL AND d.status <> 'void')
     - (SELECT coalesce(sum(${paymentFreeSql("p", "succeeded")}), 0) FROM payments p INDEXED BY payments_client
       WHERE p.client_id = ?1 AND p.currency = ?2 AND p.status = 'confirmed' AND p.kind = 'payment') AS balance`)();

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
/** M6–M7 audit AU37: `to` (the range's last day, `?4`) is bound too: the balance before a page is as at that day's end, as the page's own lines. */
export const statementBalanceBeforeBinds = (
  clientId: string,
  currency: string,
  from: string,
  to: string,
  cursor?: StatementCursor,
): (string | null)[] =>
  cursor ? [clientId, currency, null, to, cursor.sk, cursor.id] : [clientId, currency, from, to];
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

/** The ageing bucket of due date `due` as at `today` (SQL expressions; ISO dates): the twin of core `ageingBucket` (a db test compares them day by day). */
export const ageingBucketSql = (due: string, today: string): string =>
  `(CASE WHEN ${due} IS NULL OR ${due} >= ${today} THEN 'not_due' WHEN ${due} >= date(${today}, '-30 days') THEN 'd1_30' WHEN ${due} >= date(${today}, '-60 days') THEN 'd31_60' WHEN ${due} >= date(${today}, '-90 days') THEN 'd61_90' ELSE 'd90_plus' END)`;
/** The ageing buckets in order (core `AGEING_BUCKETS`; a test compares the two). */
export const SQL_AGEING_BUCKETS = ["not_due", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type SqlAgeingBucket = (typeof SQL_AGEING_BUCKETS)[number];

/**
 * The first day of the IST month before the month that starts on `?3` (C5, previous-month deltas): in April it is in the previous FY, so the dashboard's passes
 * start there, one month earlier, in April only (`min(?1, …)`); every other month it is on or after the FY's first day and the range is the FY's.
 */
const PREVIOUS_MONTH = "date(?3, '-1 month')";

/**
 * Invoiced in the financial year `?1` to `?2`, in the month from `?3` (to `?2`'s month: the caller passes the month's first day) and (C5, M7.3) in the IST
 * month before it (`pm_*`, from `PREVIOUS_MONTH` to the day before `?3`), by currency, with this month less the previous one (`delta_*`). Credit notes count
 * negative; voided documents and proformas never. `taxable` is before GST, `total` with it, `inr_taxable` the INR value of the taxable amount (a USD
 * document's `computed.inr`); NULL when a USD document lacks it, never zero. One pass over the FY's entries of `documents_issued_on` (in April from the
 * previous month's first day: that month is in the previous FY), no GROUP BY (L33): one row read per document. A currency is a row when it has a document in
 * the FY or in the previous month (in April a row can have `fy_documents` 0). The twin of `INVOICED_GROUPED_SQL`.
 */
export const INVOICED_SQL = /* @__PURE__ */ (() => {
  const sgn = "CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END";
  const cols = (c: string): string[] => {
    const is = `d.currency = '${c}'`;
    const fy = `${is} AND d.issue_date >= ?1`;
    const month = `${is} AND d.issue_date >= ?3`;
    const prev = `${is} AND d.issue_date >= ${PREVIOUS_MONTH} AND d.issue_date < ?3`;
    const inr = inrTaxableOf(c);
    return [
      `count(CASE WHEN ${is} THEN 1 END) AS any_${c}`,
      `count(CASE WHEN ${fy} THEN 1 END) AS fyd_${c}`,
      `sum(CASE WHEN ${fy} THEN ${signed("taxable_minor")} END) AS fyt_${c}`,
      `sum(CASE WHEN ${fy} THEN ${signed("total_minor")} END) AS fyg_${c}`,
      `count(CASE WHEN ${fy} THEN ${inr} END) AS fyic_${c}`,
      `sum(CASE WHEN ${fy} THEN ${sgn} * ${inr} END) AS fyi_${c}`,
      `count(CASE WHEN ${month} THEN 1 END) AS md_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${signed("taxable_minor")} END), 0) AS mt_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${signed("total_minor")} END), 0) AS mg_${c}`,
      `count(CASE WHEN ${month} THEN ${inr} END) AS mic_${c}`,
      `coalesce(sum(CASE WHEN ${month} THEN ${sgn} * ${inr} END), 0) AS mi_${c}`,
      `count(CASE WHEN ${prev} THEN 1 END) AS pd_${c}`,
      `coalesce(sum(CASE WHEN ${prev} THEN ${signed("taxable_minor")} END), 0) AS pt_${c}`,
      `coalesce(sum(CASE WHEN ${prev} THEN ${signed("total_minor")} END), 0) AS pg_${c}`,
      `count(CASE WHEN ${prev} THEN ${inr} END) AS pic_${c}`,
      `coalesce(sum(CASE WHEN ${prev} THEN ${sgn} * ${inr} END), 0) AS pi_${c}`,
    ];
  };
  const select = `${pickCurrency("fyd")} AS fy_documents, ${pickCurrency("fyt")} AS fy_taxable, ${pickCurrency("fyg")} AS fy_total,
       CASE WHEN ${pickCurrency("fyic")} < ${pickCurrency("fyd")} THEN NULL ELSE ${pickCurrency("fyi")} END AS fy_inr_taxable,
       ${pickCurrency("md")} AS month_documents, ${pickCurrency("mt")} AS month_taxable, ${pickCurrency("mg")} AS month_total,
       CASE WHEN ${pickCurrency("mic")} < ${pickCurrency("md")} THEN NULL ELSE ${pickCurrency("mi")} END AS month_inr_taxable,
       ${pickCurrency("pd")} AS pm_documents, ${pickCurrency("pt")} AS pm_taxable, ${pickCurrency("pg")} AS pm_total,
       CASE WHEN ${pickCurrency("pic")} < ${pickCurrency("pd")} THEN NULL ELSE ${pickCurrency("pi")} END AS pm_inr_taxable,
       ${pickCurrency("mt")} - ${pickCurrency("pt")} AS delta_taxable, ${pickCurrency("mg")} - ${pickCurrency("pg")} AS delta_total`;
  return byCurrency(
    cols,
    select,
    `FROM documents d INDEXED BY documents_issued_on
         WHERE ${ISSUED_GST} AND d.voided_at IS NULL AND d.issue_date >= min(?1, ${PREVIOUS_MONTH}) AND d.issue_date <= ?2`,
    "any",
  );
})();

/** One row of `INVOICED_SQL` as D1 returns it. */
export type InvoicedSqlRow = {
  currency: "INR" | "USD";
  fy_documents: number;
  fy_taxable: number | null;
  fy_total: number | null;
  fy_inr_taxable: number | null;
  month_documents: number;
  month_taxable: number;
  month_total: number;
  month_inr_taxable: number | null;
  pm_documents: number;
  pm_taxable: number;
  pm_total: number;
  pm_inr_taxable: number | null;
  delta_taxable: number;
  delta_total: number;
};

/**
 * What clients owe, and how much of it is overdue, by currency, in ONE read (`?1` today, IST): the open tax invoices, export invoices and debit notes with a balance
 * (count and amount, tax included), and of those the ones past their due date. The due date is the last day to pay, so overdue is strictly before today.
 * C5 and C9 (M7.3): the same rows by ageing bucket (`ageingBucketSql`, as at `?1`; `n_<bucket>`, `b_<bucket>`), so the dashboard's Overdue tile and the ageing
 * report's totals are this one statement (`AGEING_TOTALS_SQL`); the four overdue buckets add up to `overdue_n` and `overdue_balance`. One pass over the open
 * statuses of `documents_status_due`, no GROUP BY (L33). The twin of `OWED_GROUPED_SQL`.
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
        ...SQL_AGEING_BUCKETS.flatMap((b) => {
          const at = `${is} AND ${ageingBucketSql("d.due_date", "?1")} = '${b}'`;
          return [
            `count(CASE WHEN ${at} THEN 1 END) AS n${b}_${c}`,
            `coalesce(sum(CASE WHEN ${at} THEN d.balance_minor END), 0) AS b${b}_${c}`,
          ];
        }),
      ];
    },
    [
      `${pickCurrency("n")} AS n, ${pickCurrency("b")} AS balance, ${pickCurrency("on")} AS overdue_n, ${pickCurrency("ob")} AS overdue_balance`,
      ...SQL_AGEING_BUCKETS.map(
        (b) => `${pickCurrency(`n${b}`)} AS n_${b}, ${pickCurrency(`b${b}`)} AS b_${b}`,
      ),
    ].join(", "),
    `FROM documents d INDEXED BY documents_status_due
         WHERE d.status IN ${OPEN_STATUSES} AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL`,
    "n",
  ))();

/** One row of `OWED_SQL` as D1 returns it. */
export type OwedSqlRow = {
  currency: "INR" | "USD";
  n: number;
  balance: number;
  overdue_n: number;
  overdue_balance: number;
} & Record<`n_${SqlAgeingBucket}` | `b_${SqlAgeingBucket}`, number>;

/** The reference twin of `INVOICED_SQL` (tests only): the grouped statement of M5.5b, with the previous month of C5. */
export const INVOICED_GROUPED_SQL = /* @__PURE__ */ (() => {
  const fy = "d.issue_date >= ?1";
  const month = "d.issue_date >= ?3";
  const prev = `d.issue_date >= ${PREVIOUS_MONTH} AND d.issue_date < ?3`;
  const inr =
    "CASE d.currency WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END";
  const sgn = "CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END";
  const taxable = "CASE d.type WHEN 'credit_note' THEN -d.taxable_minor ELSE d.taxable_minor END";
  const total = "CASE d.type WHEN 'credit_note' THEN -d.total_minor ELSE d.total_minor END";
  const part = (w: string, p: string, coalesced: boolean) => {
    const z = (x: string) => (coalesced ? `coalesce(${x}, 0)` : x);
    return `count(CASE WHEN ${w} THEN 1 END) AS ${p}_documents,
       ${z(`sum(CASE WHEN ${w} THEN ${taxable} END)`)} AS ${p}_taxable,
       ${z(`sum(CASE WHEN ${w} THEN ${total} END)`)} AS ${p}_total,
       CASE WHEN count(CASE WHEN ${w} THEN ${inr} END) < count(CASE WHEN ${w} THEN 1 END) THEN NULL
            ELSE ${z(`sum(CASE WHEN ${w} THEN ${sgn} * ${inr} END)`)} END AS ${p}_inr_taxable`;
  };
  return `SELECT d.currency, ${part(fy, "fy", false)}, ${part(month, "month", true)}, ${part(prev, "pm", true)},
       coalesce(sum(CASE WHEN ${month} THEN ${taxable} END), 0) - coalesce(sum(CASE WHEN ${prev} THEN ${taxable} END), 0) AS delta_taxable,
       coalesce(sum(CASE WHEN ${month} THEN ${total} END), 0) - coalesce(sum(CASE WHEN ${prev} THEN ${total} END), 0) AS delta_total
   FROM documents d INDEXED BY documents_issued_on
   WHERE ${ISSUED_GST} AND d.voided_at IS NULL AND d.issue_date >= min(?1, ${PREVIOUS_MONTH}) AND d.issue_date <= ?2
   GROUP BY d.currency ORDER BY d.currency`;
})();

/** The reference twin of `OWED_SQL` (tests only): the grouped statement of M5.5b, with C5's buckets. */
export const OWED_GROUPED_SQL = /* @__PURE__ */ (() => {
  const bucket = ageingBucketSql("d.due_date", "?1");
  return `SELECT d.currency, count(*) AS n, sum(d.balance_minor) AS balance,
       sum(CASE WHEN d.due_date < ?1 THEN 1 ELSE 0 END) AS overdue_n, sum(CASE WHEN d.due_date < ?1 THEN d.balance_minor ELSE 0 END) AS overdue_balance,
       ${SQL_AGEING_BUCKETS.map((b) => `sum(CASE WHEN ${bucket} = '${b}' THEN 1 ELSE 0 END) AS n_${b}, sum(CASE WHEN ${bucket} = '${b}' THEN d.balance_minor ELSE 0 END) AS b_${b}`).join(",\n       ")}
   FROM documents d INDEXED BY documents_status_due
   WHERE d.status IN ${OPEN_STATUSES} AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL
   GROUP BY d.currency ORDER BY d.currency`;
})();

/**
 * The five oldest overdue ones (`?1` today). One ordered read of five rows per open status (the index is `(status, due_date)`, so a single read with the three
 * statuses in a list would have to sort every overdue row), then the five oldest of those fifteen.
 */
const overdueOf = (status: string): string =>
  `SELECT * FROM (SELECT d.id, d.number_display, d.due_date, d.currency, d.balance_minor, d.client_id FROM documents d INDEXED BY documents_status_due
   WHERE d.status = '${status}' AND d.due_date < ?1 AND d.type IN ${DEBIT_DOCS} AND d.balance_minor > 0 AND d.voided_at IS NULL ORDER BY d.due_date, d.rowid LIMIT 5)`;
export const OVERDUE_OLDEST_SQL = /* @__PURE__ */ (() =>
  `SELECT o.id, o.number_display, o.due_date, o.currency, o.balance_minor, o.client_id, c.code AS client_code, c.display_name AS client_name
   FROM (${overdueOf("issued")} UNION ALL ${overdueOf("partially_paid")} UNION ALL ${overdueOf("partially_credited")}) o JOIN clients c ON c.id = o.client_id
   ORDER BY o.due_date, o.id LIMIT 5`)();

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
 * How many open exports are in each stage today (`?1` today, IST), the rule values being the `tax` row's own: one row per stage that has any, by stage. M6.5: the
 * exports read are those with a balance or still open for another reason (`stageOpenSql`: RA-38's proof, RB-43's reduction), and `realised` is never a row.
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
               WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND ${stageOpenSql("d")} LIMIT -1) sg) t
   JOIN (${stageRows}) st
   WHERE ${pick} > 0 AND st.stage <> 'realised' ORDER BY st.stage`;
})();
/** The reference twin of `EXPORT_STAGE_COUNTS_SQL` (tests only): the grouped statement of M5.5b. */
export const EXPORT_STAGE_COUNTS_GROUPED_SQL =
  /* @__PURE__ */ (() => `SELECT ${stageSql("d", settingsBinds("?1"))} AS stage, count(*) AS n
   FROM documents d INDEXED BY documents_export_issued
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND ${stageOpenSql("d")}
   GROUP BY stage HAVING stage <> 'realised'`)();

/** The five exports nearest a deadline: in one of the four alert stages, the earliest deadline of the stage first (an overdue one before one that is approaching). */
export const EXPORT_NEXT_SQL = /* @__PURE__ */ (() => {
  const p = settingsBinds("?1");
  return `SELECT d.id, d.number_display, d.issue_date, d.currency, d.balance_minor, d.client_id, c.code AS client_code, ${stageSql("d", p)} AS stage,
       CASE WHEN ${stageSql("d", p)} IN ('gst_approaching', 'gst_overdue') THEN ${gstDueSql("d", p)} ELSE ${femaDueSql("d", p)} END AS due
   FROM documents d INDEXED BY documents_export_issued JOIN clients c ON c.id = d.client_id
   WHERE ${ISSUED_EXPORT} AND d.voided_at IS NULL AND ${stageOpenSql("d")} AND ${stageSql("d", p)} IN (${ALERT_STAGE_LIST})
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
 * M6.5 (L9, L35): the refunds of those payments by currency, as `{"INR": [live, succeeded]}`: `live` (not failed: `paymentRefundedSql`) lowers the credit, `succeeded`
 * lowers "collected". A seek of `payment_refunds_payment` per payment.
 */
const REFUNDED_BY_CURRENCY = `(SELECT json_group_object(rr.cur, json_array(rr.live, rr.done)) FROM (SELECT rp.currency AS cur,
         sum(CASE WHEN rf.status <> 'failed' THEN rf.amount_minor ELSE 0 END) AS live, sum(CASE WHEN rf.status = 'succeeded' THEN rf.amount_minor ELSE 0 END) AS done
       FROM payments rp INDEXED BY payments_client JOIN payment_refunds rf INDEXED BY payment_refunds_payment ON rf.payment_id = rp.id
       WHERE rp.client_id = ?1 AND rp.status = 'confirmed' AND rp.kind = 'payment' GROUP BY rp.currency) rr)`;
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
 *
 * M6.5 (L9, L35): `collected` is net of the refunds that went out, and `credit` is each payment's free money (`paymentFreeSql`: less every refund not failed), from
 * `REFUNDED_BY_CURRENCY` (`pay[2]`: `[live, succeeded]`, the aggregate evaluated once, as finding 8 asks).
 */
export const CLIENT_FIGURES_SQL = `SELECT f.currency, f.billed, f.credited, f.balance, f.overdue, f.overdue_n, f.tds, f.excess,
       coalesce(json_extract(f.pay, '$[0]'), 0) - coalesce(json_extract(f.pay, '$[2][1]'), 0) AS collected,
       coalesce(json_extract(f.pay, '$[0]'), 0) - coalesce(json_extract(f.pay, '$[1]'), 0) - coalesce(json_extract(f.pay, '$[2][0]'), 0) AS credit
   FROM (SELECT d.currency,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.total_minor END), 0) AS billed,
       coalesce(sum(CASE WHEN d.type = 'credit_note' THEN d.total_minor END), 0) AS credited,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 THEN d.balance_minor END), 0) AS balance,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN d.balance_minor END), 0) AS overdue,
       count(CASE WHEN d.type IN ${DEBIT_KINDS} AND d.balance_minor > 0 AND d.due_date < ?2 THEN 1 END) AS overdue_n,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN d.tds_minor END), 0) AS tds,
       coalesce(sum(CASE WHEN d.type IN ${DEBIT_KINDS} THEN max(0, d.paid_minor + d.credited_minor + d.tds_minor - d.total_minor) END), 0) AS excess,
       json_array(json_extract(${COLLECTED_BY_CURRENCY}, '$.' || d.currency), json_extract(${ALLOCATED_BY_CURRENCY}, '$.' || d.currency),
         json(json_extract(${REFUNDED_BY_CURRENCY}, '$.' || d.currency))) AS pay
     FROM documents d INDEXED BY documents_client_issued
     WHERE d.client_id = (SELECT z.id FROM clients z WHERE z.id = ?1 AND z.anonymised_at IS NULL) AND ${ISSUED_GST} AND d.voided_at IS NULL AND d.status <> 'void'
     GROUP BY d.currency ORDER BY d.currency) f`;

/**
 * Code review finding 7: a client's collected money and credit (M6.5: both net of refunds, as `CLIENT_FIGURES_SQL`) in a currency that has payments and no issued GST document (`?1` the client), so the Overview
 * shows Collected and Credit held before the first invoice; `clientFinance` adds such a currency to the figures with its document figures at zero. Both
 * conditions are constant, so they are checked before any payment is read: a client with an issued document (which every client with invoices has) costs one
 * probe of `documents_client_issued`, and an anonymised client has no rows. A client has one currency (M3.3; it locks once an invoice or a payment exists).
 */
export const CLIENT_PAYMENTS_ONLY_SQL = `SELECT pc.cur AS currency, pc.amount - coalesce(json_extract(pc.refunds, '$[1]'), 0) AS collected,
       pc.amount - coalesce(json_extract(${ALLOCATED_BY_CURRENCY}, '$.' || pc.cur), 0) - coalesce(json_extract(pc.refunds, '$[0]'), 0) AS credit
   FROM (SELECT cp.currency AS cur, sum(cp.amount_minor) AS amount, json_extract(${REFUNDED_BY_CURRENCY}, '$.' || cp.currency) AS refunds
         FROM payments cp INDEXED BY payments_client
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

/**
 * M6.5 (L9; ADM-PAY-08): one page of the refunds register, the companion of `PAYMENTS_REGISTER_SQL` (kept apart so the M6.1 register's rows and CSV layout stay
 * as they are until the SPA takes refunds in a new layout version): the SUCCEEDED refunds of confirmed payments with `settled_on` from `?1` to `?2` (ISO, inclusive),
 * oldest first by `(settled_on, id)`, with a next page from `?3`/`?4`; read through `payment_refunds_settled`. Each row carries the source payment, the client, the
 * invoice and the credit note it followed (numbers), the bank's INR amount of a USD refund (L15, never a GST figure). At most 51 rows.
 * B4 (`GET /reports/refunds`, the `refunds-v1` CSV): and the source payment's own reference (its gateway id and its bank reference).
 * M6–M7 audit AU37 (Settled by the lead on the safest reading, 2026-11-07 (08-C RA-41)): a refund that came back after `?2` is still in the register for that
 * range (`refundsOutSql`), so a filed period's register never moves.
 */
export const REFUNDS_REGISTER_SQL = (after: boolean): string =>
  `SELECT f.id, f.payment_id, f.provider, f.origin, f.mode, f.paid_to, f.reason_code, f.settled_on, f.currency, f.amount_minor, f.inr_refunded_minor, f.reference_norm,
       f.provider_refund_id, f.client_id, c.code AS client_code, c.display_name AS client_name, fd.number_display AS document_number, fc.number_display AS credit_note_number,
       fp.provider_payment_id AS payment_provider_ref, fp.reference_norm AS payment_reference
   FROM (${refundsOutSql("?1", "?2")}) f JOIN payments fp ON fp.id = f.payment_id JOIN clients c ON c.id = f.client_id
     LEFT JOIN documents fd ON fd.id = f.document_id LEFT JOIN documents fc ON fc.id = f.credit_note_id
   WHERE fp.status = 'confirmed' ${after ? "AND (f.settled_on > ?3 OR (f.settled_on = ?3 AND f.id > ?4))" : ""}
   ORDER BY f.settled_on, f.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/** One row of `REFUNDS_REGISTER_SQL` as D1 returns it. */
export type RefundsRegisterRow = {
  id: string;
  payment_id: string;
  provider: "manual" | "razorpay" | "stripe" | "paypal";
  origin: "owner" | "outside" | "chargeback";
  mode: string | null;
  paid_to: string | null;
  reason_code: string;
  settled_on: string;
  currency: "INR" | "USD";
  amount_minor: number;
  inr_refunded_minor: number | null;
  reference_norm: string | null;
  provider_refund_id: string | null;
  client_id: string;
  client_code: string;
  client_name: string;
  document_number: string | null;
  credit_note_number: string | null;
  /** B4: the source payment's gateway id and bank reference. */
  payment_provider_ref: string | null;
  payment_reference: string | null;
};

// ---- M7.3: the management reports (ADM-REP-01, -02, -03, -05; run file docs/runs/m7.3-reports.md C, L1 to L13) ----------------------------------------
// Every report is an aggregate made here, in SQL, and the Worker only renames columns (L2): no money arithmetic beyond integer sums, no rate, no split of a
// payment, no balance at a past date (L1, Tier B). A grouping is never a GROUP BY b-tree over the ledger (L33 of M6.1: D1 counts every row such a tree takes
// in and gives back): per-month figures are one correlated aggregate per month, each reading only its month of the index; categories and kinds are one
// aggregate row with a column set per key and currency, turned into rows by a join with their constant rows. Each has a grouped twin that only tests run
// (`*_GROUPED_SQL`). INR equivalents come only from frozen values (L4): a document's `computed.inr` / `total_inr_minor` (Researched 2026-10-28, Rule 34 CGST
// Rules (08-C RA-21): the time-of-supply rate, never converted again), a payment's `inr_received_minor` and a refund's `inr_refunded_minor` (M6.1 L15:
// management only); a missing one makes the INR figure NULL with a count, never 0. TDS is apart from collected (Settled by the lead on the safest reading,
// 2026-10-30 (08-C RA-30)); money counts on the day it was received (Researched 2026-10-28 (08-C RA-17, RA-36)). Reports are not tax documents (08-C RA-28).
// D1 allows at most 100 result columns and 32 arguments per SQL function: every aggregate row below stays under both (a test runs each statement).

/**
 * A document's kind of revenue (L9; core `revenueKind`): its own care plan, or (a note, a tax invoice made from a proforma) its parent's, is recurring; else a
 * project's; else other. The parent is read only for a row with no care plan of its own and a parent (one seek of the primary key).
 */
export const revenueKindSql = (d: string): string =>
  `(CASE WHEN ${d}.care_plan_id IS NOT NULL THEN 'recurring' WHEN ${d}.parent_id IS NOT NULL AND (SELECT kp.care_plan_id FROM documents kp WHERE kp.id = ${d}.parent_id) IS NOT NULL THEN 'recurring' WHEN ${d}.project_id IS NOT NULL THEN 'project' ELSE 'other' END)`;
export const SQL_REVENUE_KINDS = ["recurring", "project", "other"] as const;

/** The catalogue's categories (the schema's `CATEGORIES`, a test pins them) and "Not from the catalogue" (core `NO_CATEGORY`), in report order. */
export const SQL_CATEGORY_KEYS = ["advise", "build", "automate", "connect", "run", "none"] as const;

const SIGN = "CASE d.type WHEN 'credit_note' THEN -1 ELSE 1 END";
/** The INR value of a document's taxable amount and of its total, for currency `c` (an SQL expression: a literal or a bound parameter). */
const inrDocTaxable = (c: string) =>
  `CASE ${c} WHEN 'INR' THEN d.taxable_minor ELSE json_extract(d.computed, '$.inr.taxableMinor') END`;
const inrDocTotal = (c: string) => `CASE ${c} WHEN 'INR' THEN d.total_minor ELSE d.total_inr_minor END`;
const inrPaid = (c: string) => `CASE ${c} WHEN 'INR' THEN p.amount_minor ELSE p.inr_received_minor END`;
const inrRefunded = (c: string) => `CASE ${c} WHEN 'INR' THEN f.amount_minor ELSE f.inr_refunded_minor END`;

/**
 * `[count, taxable, total, inr count, inr taxable, inr total]` of the documents `d` that match `is` (an SQL condition) in currency `c` (6 arguments, under D1's 32).
 * `inr count` counts the documents with both INR values.
 */
const invoicedJson = (is: string, c: string) =>
  `json_array(count(CASE WHEN ${is} THEN 1 END), coalesce(sum(CASE WHEN ${is} THEN ${SIGN} * d.taxable_minor END), 0), coalesce(sum(CASE WHEN ${is} THEN ${SIGN} * d.total_minor END), 0), count(CASE WHEN ${is} AND (${inrDocTaxable(c)}) IS NOT NULL AND (${inrDocTotal(c)}) IS NOT NULL THEN 1 END), coalesce(sum(CASE WHEN ${is} THEN ${SIGN} * (${inrDocTaxable(c)}) END), 0), coalesce(sum(CASE WHEN ${is} THEN ${SIGN} * (${inrDocTotal(c)}) END), 0))`;
/** `[payments, received, tds rows, tds, inr received, inr missing]` of the confirmed rows `p` that match `is` in currency `c` (TDS apart: RA-30). */
const collectedJson = (is: string, c: string) => {
  const pay = `${is} AND p.kind = 'payment'`;
  const tds = `${is} AND p.kind = 'tds'`;
  return `json_array(count(CASE WHEN ${pay} THEN 1 END), coalesce(sum(CASE WHEN ${pay} THEN p.amount_minor END), 0), count(CASE WHEN ${tds} THEN 1 END), coalesce(sum(CASE WHEN ${tds} THEN p.amount_minor END), 0), coalesce(sum(CASE WHEN ${pay} THEN ${inrPaid(c)} END), 0), count(CASE WHEN ${pay} AND (${inrPaid(c)}) IS NULL THEN 1 END))`;
};
/** `[refunds, refunded, inr refunded, inr missing]` of the succeeded refunds `f` that match `is` in currency `c`. */
const refundedJson = (is: string, c: string) =>
  `json_array(count(CASE WHEN ${is} THEN 1 END), coalesce(sum(CASE WHEN ${is} THEN f.amount_minor END), 0), coalesce(sum(CASE WHEN ${is} THEN ${inrRefunded(c)} END), 0), count(CASE WHEN ${is} AND (${inrRefunded(c)}) IS NULL THEN 1 END))`;
/** One JSON object with a value per currency (`{"INR": [...], "USD": [...]}`), each from `json(<currency test>, <currency literal>)`. */
const perCurrency = (json: (is: string, c: string) => string, col: string) =>
  `json_object(${SQL_CURRENCIES.map((c) => `'${c}', ${json(`${col} = '${c}'`, `'${c}'`)}`).join(", ")})`;
const REFUNDS_OF_COLLECTED = "fp.status = 'confirmed' AND fp.kind = 'payment'";
/**
 * The refunds of confirmed money received that had gone out by the end of IST day `to` (M6–M7 audit AU37, Settled by the lead on the safest reading, 2026-11-07
 * (08-C RA-41): one that came back after that day still counts, so a past period never moves); `f` a refund, `fp` its payment.
 */
const refundsOutBy = (to: string) => `${refundOutAtSql("f", istDayEndMsSql(to))} AND ${REFUNDS_OF_COLLECTED}`;

/**
 * The columns of one revenue row from three JSON values (`inv`, `pay`, `ref`: `invoicedJson`, `collectedJson`, `refundedJson`) at JSON path `at` (an SQL
 * expression: `'$'`, or `'$.' || cur.currency`), named as `RevenueSqlRow`; the INR figures are NULL when a value is missing (L4), and
 * `documents_inr_missing` says how many documents lack one (review 1 finding 4: the count the SPA's line names).
 */
const revenueColumns = (inv: string, pay: string, ref: string, at: string) => {
  const j = (v: string, i: number) => `coalesce(json_extract(${v}, ${at} || '[${i}]'), 0)`;
  return `${j(inv, 0)} AS documents, ${j(inv, 1)} AS taxable, ${j(inv, 2)} AS total,
       CASE WHEN ${j(inv, 3)} < ${j(inv, 0)} THEN NULL ELSE ${j(inv, 4)} END AS inr_taxable, CASE WHEN ${j(inv, 3)} < ${j(inv, 0)} THEN NULL ELSE ${j(inv, 5)} END AS inr_total,
       ${j(inv, 0)} - ${j(inv, 3)} AS documents_inr_missing,
       ${j(pay, 0)} AS payments, ${j(pay, 1)} AS received, ${j(ref, 0)} AS refunds, ${j(ref, 1)} AS refunded, ${j(pay, 1)} - ${j(ref, 1)} AS collected, ${j(pay, 2)} AS tds_n, ${j(pay, 3)} AS tds,
       ${j(pay, 5)} + ${j(ref, 3)} AS inr_missing, CASE WHEN ${j(pay, 5)} + ${j(ref, 3)} > 0 THEN NULL ELSE ${j(pay, 4)} - ${j(ref, 2)} END AS inr_collected`;
};

/** One row of the revenue statements as D1 returns it (C1 by month, C2 per client; collected = `received − refunded`, made by the row mapper). */
export type RevenueSqlRow = {
  currency: "INR" | "USD";
  documents: number;
  taxable: number;
  total: number;
  inr_taxable: number | null;
  inr_total: number | null;
  /** the documents counted in `documents` without both INR values (0 for INR; `inr_taxable` and `inr_total` are NULL when it is above 0) */
  documents_inr_missing: number;
  payments: number;
  received: number;
  refunds: number;
  refunded: number;
  /** `received − refunded` (M6.5 L9: money received less the refunds that went out). */
  collected: number;
  tds_n: number;
  tds: number;
  inr_missing: number;
  inr_collected: number | null;
};

const ISSUED_IN = (from: string, to: string) =>
  `${ISSUED_GST} AND d.voided_at IS NULL AND d.issue_date >= ${from} AND d.issue_date <= ${to}`;

/**
 * C1 by month (`?1` the FY's first day, `2026-04-01`): per IST month and currency, invoiced (issued GST documents by `issue_date`, credit notes negative, voided
 * never; `documents_issued_on`), money received and TDS (confirmed rows by `received_on`; `payments_confirmed`) and the refunds that went out (succeeded refunds of
 * confirmed money by `settled_on`; `payment_refunds_settled`). One correlated aggregate per month and source, each reading only that month's range of its index:
 * the rows read are the FY's documents, payments and refunds, with no GROUP BY. A month and currency with nothing is not a row. `month` is `YYYY-MM`.
 */
export const REVENUE_MONTHS_SQL = /* @__PURE__ */ (() => {
  const months = `SELECT substr(date(?1, '+' || k.column1 || ' months'), 1, 7) AS month, date(?1, '+' || k.column1 || ' months') AS f, date(?1, '+' || (k.column1 + 1) || ' months', '-1 day') AS t
         FROM (VALUES ${Array.from({ length: 12 }, (_, i) => `(${i})`).join(", ")}) k`;
  const at = "'$.' || cur.currency";
  const has = (v: string, i: number) => `coalesce(json_extract(${v}, ${at} || '[${i}]'), 0)`;
  return `SELECT x.month, cur.currency, ${revenueColumns("x.inv", "x.pay", "x.ref", at)}
   FROM (SELECT m.month,
           (SELECT ${perCurrency(invoicedJson, "d.currency")} FROM documents d INDEXED BY documents_issued_on WHERE ${ISSUED_IN("m.f", "m.t")}) AS inv,
           (SELECT ${perCurrency(collectedJson, "p.currency")} FROM payments p INDEXED BY payments_confirmed
             WHERE p.status = 'confirmed' AND p.received_on >= m.f AND p.received_on <= m.t) AS pay,
           (SELECT ${perCurrency(refundedJson, "f.currency")} FROM (${refundsOutSql("m.f", "m.t")}) f JOIN payments fp ON fp.id = f.payment_id
             WHERE ${REFUNDS_OF_COLLECTED}) AS ref
         FROM (${months}) m LIMIT -1) x
   JOIN (${currencyRows}) cur
   WHERE ${has("x.inv", 0)} + ${has("x.pay", 0)} + ${has("x.pay", 2)} + ${has("x.ref", 0)} > 0
   ORDER BY x.month, cur.currency`;
})();

/** One row of `REVENUE_MONTHS_SQL`. */
export type RevenueMonthSqlRow = RevenueSqlRow & { month: string };

/** The reference twins of `REVENUE_MONTHS_SQL` (tests only): grouped statements over `?1` to `?2` (the FY), keyed by `month` and `currency`. */
export const REVENUE_MONTHS_GROUPED_SQL = /* @__PURE__ */ (() => ({
  invoiced: `SELECT substr(d.issue_date, 1, 7) AS month, d.currency, count(*) AS documents, sum(${SIGN} * d.taxable_minor) AS taxable, sum(${SIGN} * d.total_minor) AS total,
       CASE WHEN count(${inrDocTaxable("d.currency")}) < count(*) OR count(${inrDocTotal("d.currency")}) < count(*) THEN NULL ELSE sum(${SIGN} * (${inrDocTaxable("d.currency")})) END AS inr_taxable,
       CASE WHEN count(${inrDocTaxable("d.currency")}) < count(*) OR count(${inrDocTotal("d.currency")}) < count(*) THEN NULL ELSE sum(${SIGN} * (${inrDocTotal("d.currency")})) END AS inr_total,
       count(*) - count(CASE WHEN (${inrDocTaxable("d.currency")}) IS NOT NULL AND (${inrDocTotal("d.currency")}) IS NOT NULL THEN 1 END) AS documents_inr_missing
     FROM documents d WHERE ${ISSUED_IN("?1", "?2")} GROUP BY month, d.currency ORDER BY month, d.currency`,
  collected: `SELECT substr(p.received_on, 1, 7) AS month, p.currency, count(CASE p.kind WHEN 'payment' THEN 1 END) AS payments,
       coalesce(sum(CASE p.kind WHEN 'payment' THEN p.amount_minor END), 0) AS received, coalesce(sum(CASE p.kind WHEN 'tds' THEN p.amount_minor END), 0) AS tds
     FROM payments p WHERE p.status = 'confirmed' AND p.received_on >= ?1 AND p.received_on <= ?2 GROUP BY month, p.currency ORDER BY month, p.currency`,
  refunded: `SELECT substr(f.settled_on, 1, 7) AS month, f.currency, count(*) AS refunds, sum(f.amount_minor) AS refunded
     FROM payment_refunds f JOIN payments fp ON fp.id = f.payment_id WHERE ${refundsOutBy("date(f.settled_on, 'start of month', '+1 month', '-1 day')")} AND f.settled_on >= ?1 AND f.settled_on <= ?2
     GROUP BY month, f.currency ORDER BY month, f.currency`,
}))();

/** A pivot's constant rows `(k, currency)` for each key of `keys` and currency, in order. */
export const keyRows = (keys: readonly string[]) =>
  `SELECT column1 AS k, column2 AS currency FROM (VALUES ${keys.flatMap((k) => SQL_CURRENCIES.map((c) => `('${k}', '${c}')`)).join(", ")})`;
/** The column `<metric>_<key>_<currency>` of the aggregate row `t` for the constant row `kc`. */
export const pickKey = (keys: readonly string[], metric: string) =>
  `CASE ${keys.flatMap((k) => SQL_CURRENCIES.map((c) => `WHEN kc.k = '${k}' AND kc.currency = '${c}' THEN t.${metric}_${k}_${c}`)).join(" ")} END`;
/** The invoiced metrics of key `k` and currency `c` over rows `z` (`z.cu`, `z.k`, `z.sgn`, `z.taxable`, `z.total`, `z.inr_taxable`, `z.inr_total`). */
const keyedCols = (k: string, c: string) => {
  const is = `z.k = '${k}' AND z.cu = '${c}'`;
  return [
    `count(CASE WHEN ${is} THEN 1 END) AS n_${k}_${c}`,
    `coalesce(sum(CASE WHEN ${is} THEN z.sgn * z.taxable END), 0) AS tx_${k}_${c}`,
    `coalesce(sum(CASE WHEN ${is} THEN z.sgn * z.total END), 0) AS tt_${k}_${c}`,
    `count(CASE WHEN ${is} AND z.inr_taxable IS NOT NULL AND z.inr_total IS NOT NULL THEN 1 END) AS ic_${k}_${c}`,
    `coalesce(sum(CASE WHEN ${is} THEN z.sgn * z.inr_taxable END), 0) AS ix_${k}_${c}`,
    `coalesce(sum(CASE WHEN ${is} THEN z.sgn * z.inr_total END), 0) AS it_${k}_${c}`,
  ];
};
/**
 * One aggregate row over the source `rows` (worked out once: `LIMIT -1` keeps it from being flattened into every column) turned into `(key, currency)` rows with
 * the columns of `KeyedSqlRow`, the empty ones dropped, in key order.
 */
const keyedPivot = (keys: readonly string[], rows: string, roundOff = false) => {
  const p = (m: string) => pickKey(keys, m);
  const cur = (m: string) =>
    `CASE kc.currency ${SQL_CURRENCIES.map((c) => `WHEN '${c}' THEN t.${m}_${c}`).join(" ")} END`;
  // The documents' round-off per currency (`z.first`, `z.ro`, `z.iro`: read on each document's first line only), on every row of that currency.
  const roundCols = SQL_CURRENCIES.flatMap((c) => [
    `count(CASE WHEN z.cu = '${c}' AND z.first = 1 THEN 1 END) AS rn_${c}`,
    `coalesce(sum(CASE WHEN z.cu = '${c}' AND z.first = 1 THEN z.sgn * z.ro END), 0) AS ro_${c}`,
    `count(CASE WHEN z.cu = '${c}' AND z.first = 1 AND z.iro IS NOT NULL THEN 1 END) AS ric_${c}`,
    `coalesce(sum(CASE WHEN z.cu = '${c}' AND z.first = 1 THEN z.sgn * z.iro END), 0) AS iro_${c}`,
  ]);
  const roundSelect = roundOff
    ? `, ${cur("ro")} AS round_off, CASE WHEN ${cur("ric")} < ${cur("rn")} THEN NULL ELSE ${cur("iro")} END AS inr_round_off`
    : "";
  const cols = [
    ...keys.flatMap((k) => SQL_CURRENCIES.flatMap((c) => keyedCols(k, c))),
    ...(roundOff ? roundCols : []),
  ];
  return `SELECT kc.k AS key, kc.currency, ${p("n")} AS documents, ${p("tx")} AS taxable, ${p("tt")} AS total,
       CASE WHEN ${p("ic")} < ${p("n")} THEN NULL ELSE ${p("ix")} END AS inr_taxable, CASE WHEN ${p("ic")} < ${p("n")} THEN NULL ELSE ${p("it")} END AS inr_total,
       ${p("n")} - ${p("ic")} AS documents_inr_missing${roundSelect}
   FROM (SELECT ${cols.join(",\n         ")}
         FROM (${rows} LIMIT -1) z) t
   JOIN (${keyRows(keys)}) kc
   WHERE ${p("n")} > 0`;
};

/** One row of the category and kind statements as D1 returns it (`documents` counts lines for a category, and `documents_inr_missing` the lines without an INR view). */
export type KeyedSqlRow = {
  key: string;
  currency: "INR" | "USD";
  documents: number;
  taxable: number;
  total: number;
  inr_taxable: number | null;
  inr_total: number | null;
  documents_inr_missing: number;
};
/** A category row also carries its currency's round-off (the same on every row of the currency). */
export type CategorySqlRow = KeyedSqlRow & { round_off: number; inr_round_off: number | null };

const DOC_ROWS = /* @__PURE__ */ (() =>
  `SELECT d.currency AS cu, ${revenueKindSql("d")} AS k, ${SIGN} AS sgn, d.taxable_minor AS taxable, d.total_minor AS total,
       ${inrDocTaxable("d.currency")} AS inr_taxable, ${inrDocTotal("d.currency")} AS inr_total
     FROM documents d INDEXED BY documents_issued_on WHERE ${ISSUED_IN("?1", "?2")}`)();

/**
 * C1 by kind (`?1` to `?2`, one FY): invoiced per kind of revenue (L9, `revenueKindSql`) and currency, in ONE pass over the range of `documents_issued_on` (plus a
 * parent seek for a note or an advance invoice with no care plan of its own). The twin of `REVENUE_KIND_GROUPED_SQL`.
 */
export const REVENUE_KIND_SQL = /* @__PURE__ */ (() => keyedPivot(SQL_REVENUE_KINDS, DOC_ROWS))();

/**
 * A document line's category (L8: today's category of its catalogue item, `none` when it has none). A credit or debit note's lines carry no catalogue item (M5.3
 * `noteLines`; M7.3 Step 0 point 5), so a note's line takes its PARENT's line: the note's line at position `n` was made from take `n − 1` of the sealed request
 * (`header_extras.noteOf.request.takes`, in line order), whose `line` is the parent's computed line index, written at position `line + 1` (M4.3 `lineRows`).
 * The catalogue is read once (`cat.m`, a JSON object id → category).
 */
const LINE_CATEGORY = `coalesce(json_extract(cat.m, '$."' || coalesce(l.catalogue_item_id, pl.catalogue_item_id) || '"'), 'none')`;
/** A line's INR value of field `f`: an INR document's own column, a USD one's `computed.lines[position − 1].inr` (the line's array index, M4.3 `lineRows`). */
const lineInr = (f: string, col: string) =>
  `CASE d.currency WHEN 'INR' THEN l.${col} ELSE json_extract(d.computed, '$.lines[' || (l.position - 1) || '].inr.${f}') END`;
const LINE_ROWS = (
  indexed: boolean,
) => `SELECT d.currency AS cu, ${LINE_CATEGORY} AS k, ${SIGN} AS sgn, l.taxable_minor AS taxable, l.line_total_minor AS total,
       ${lineInr("taxableMinor", "taxable_minor")} AS inr_taxable, ${lineInr("lineTotalMinor", "line_total_minor")} AS inr_total,
       l.position = 1 AS first, d.round_off_minor AS ro, CASE d.currency WHEN 'INR' THEN d.round_off_minor ELSE json_extract(d.computed, '$.inr.roundOffMinor') END AS iro
     FROM (SELECT json_group_object(ci.id, ci.category) AS m FROM catalogue_items ci) cat
       CROSS JOIN documents d${indexed ? " INDEXED BY documents_issued_on" : ""}
       JOIN document_lines l INDEXED BY document_lines_position ON l.document_id = d.id
       LEFT JOIN document_lines pl INDEXED BY document_lines_position ON d.type IN ('credit_note', 'debit_note') AND pl.document_id = d.parent_id
         AND pl.position = json_extract(d.header_extras, '$.noteOf.request.takes[' || (l.position - 1) || '].line') + 1
     WHERE ${ISSUED_IN("?1", "?2")}`;

/**
 * C1 by category (`?1` to `?2`): invoiced per catalogue category and currency (Q2 A: invoiced only; L8), from the lines of the range's documents. A line's total is
 * before the document's round-off, which belongs to no line: each row also carries its currency's round-off (`round_off`, `inr_round_off`), summed on each
 * document's first line (position 1, M4.3 `lineRows`) in the same pass, so Σ categories + round-off = the invoiced total (a test holds it against `INVOICED_SQL`
 * and `REVENUE_ROUND_OFF_GROUPED_SQL`). Measured (run file J): a row per document and per line, plus one index probe per document (the end of its lines).
 */
export const REVENUE_CATEGORY_SQL = /* @__PURE__ */ (() =>
  keyedPivot(SQL_CATEGORY_KEYS, LINE_ROWS(true), true))();

/** The reference twin of the round-off columns (tests only): per currency, in its own currency and in INR (NULL when a USD document lacks its INR view). */
export const REVENUE_ROUND_OFF_GROUPED_SQL = /* @__PURE__ */ (() => {
  const inr =
    "CASE d.currency WHEN 'INR' THEN d.round_off_minor ELSE json_extract(d.computed, '$.inr.roundOffMinor') END";
  return byCurrency(
    (c) => [
      `count(CASE WHEN d.currency = '${c}' THEN 1 END) AS n_${c}`,
      `coalesce(sum(CASE WHEN d.currency = '${c}' THEN ${SIGN} * d.round_off_minor END), 0) AS r_${c}`,
      `count(CASE WHEN d.currency = '${c}' THEN ${inr} END) AS ic_${c}`,
      `coalesce(sum(CASE WHEN d.currency = '${c}' THEN ${SIGN} * ${inr} END), 0) AS ir_${c}`,
    ],
    `${pickCurrency("r")} AS round_off, CASE WHEN ${pickCurrency("ic")} < ${pickCurrency("n")} THEN NULL ELSE ${pickCurrency("ir")} END AS inr_round_off`,
    `FROM documents d INDEXED BY documents_issued_on WHERE ${ISSUED_IN("?1", "?2")}`,
    "n",
  );
})();
export type RoundOffSqlRow = { currency: "INR" | "USD"; round_off: number; inr_round_off: number | null };

/** The reference twins of the kind and category pivots (tests only). */
export const REVENUE_KIND_GROUPED_SQL = /* @__PURE__ */ (() =>
  `SELECT x.k AS key, x.cu AS currency, count(*) AS documents, sum(x.sgn * x.taxable) AS taxable, sum(x.sgn * x.total) AS total,
     count(*) - count(CASE WHEN x.inr_taxable IS NOT NULL AND x.inr_total IS NOT NULL THEN 1 END) AS documents_inr_missing
   FROM (${DOC_ROWS.replace(" INDEXED BY documents_issued_on", "")}) x GROUP BY x.k, x.cu ORDER BY x.k, x.cu`)();
export const REVENUE_CATEGORY_GROUPED_SQL = /* @__PURE__ */ (() =>
  `SELECT x.k AS key, x.cu AS currency, count(*) AS documents, sum(x.sgn * x.taxable) AS taxable, sum(x.sgn * x.total) AS total,
     count(*) - count(CASE WHEN x.inr_taxable IS NOT NULL AND x.inr_total IS NOT NULL THEN 1 END) AS documents_inr_missing
   FROM (${LINE_ROWS(false)}) x GROUP BY x.k, x.cu ORDER BY x.k, x.cu`)();

/**
 * C2, the revenue of each client in one currency (`?1` to `?2` one FY, `?3` the currency; a next page `?4`/`?5` the last row's invoiced total and client id):
 * invoiced (as C1), collected (money received less the refunds that went out) and TDS, for every client with any of them in the range, by invoiced total (tax
 * included) high to low, then client id; at most 51 rows. Each client costs a seek of `documents_client_issued`, `payments_client` and `payment_refunds_client`:
 * the rows read are the clients, the range's documents and payments, the clients' refunds and the sorter's rows (no GROUP BY). The Worker names an anonymised client.
 */
export const REVENUE_CLIENTS_SQL = (after: boolean): string =>
  `SELECT y.id AS client_id, y.code AS client_code, y.display_name AS client_name, y.anonymised_at, ?3 AS currency, ${revenueColumns("y.inv", "y.pay", "y.ref", "'$'")}, y.k
   FROM (SELECT z.id, z.code, z.display_name, z.anonymised_at, z.inv, z.pay, z.ref, coalesce(json_extract(z.inv, '$[2]'), 0) AS k
         FROM (SELECT c.id, c.code, c.display_name, c.anonymised_at,
                 (SELECT ${invoicedJson("1 = 1", "?3")} FROM documents d INDEXED BY documents_client_issued
                   WHERE d.client_id = c.id AND d.currency = ?3 AND ${ISSUED_IN("?1", "?2")}) AS inv,
                 (SELECT ${collectedJson("1 = 1", "?3")} FROM payments p INDEXED BY payments_client
                   WHERE p.client_id = c.id AND p.currency = ?3 AND p.status = 'confirmed' AND p.received_on >= ?1 AND p.received_on <= ?2) AS pay,
                 (SELECT ${refundedJson("1 = 1", "?3")} FROM payment_refunds f INDEXED BY payment_refunds_client JOIN payments fp ON fp.id = f.payment_id
                   WHERE f.client_id = c.id AND f.currency = ?3 AND ${refundsOutBy("?2")} AND f.settled_on >= ?1 AND f.settled_on <= ?2) AS ref
               FROM clients c LIMIT -1) z
         WHERE json_extract(z.inv, '$[0]') > 0 OR json_extract(z.pay, '$[0]') > 0 OR json_extract(z.pay, '$[2]') > 0 OR json_extract(z.ref, '$[0]') > 0
         LIMIT -1) y
   ${after ? "WHERE (y.k < ?4 OR (y.k = ?4 AND y.id > ?5))" : ""}
   ORDER BY y.k DESC, y.id LIMIT ${REPORT_PAGE_SIZE + 1}`;

/** One row of `REVENUE_CLIENTS_SQL`: the client, the `RevenueSqlRow` columns, and `k` (the keyset's invoiced total). */
export type RevenueClientSqlRow = RevenueSqlRow & {
  client_id: string;
  client_code: string;
  client_name: string;
  anonymised_at: number | null;
  k: number;
};

/** The binds of `REVENUE_CLIENTS_SQL` (a numbered parameter not written still counts toward D1's arity, so a first page binds three). */
export const revenueClientsBinds = (
  from: string,
  to: string,
  currency: string,
  cursor?: { readonly k: number; readonly id: string },
): (string | number)[] => (cursor ? [from, to, currency, cursor.k, cursor.id] : [from, to, currency]);

// ---- C9: outstanding and ageing as at today (L7) ----------------------------------------------------------------------------------------------------------

const OWED_ROW = `d.type IN ${DEBIT_DOCS} AND d.status IN ${OPEN_STATUSES} AND d.balance_minor > 0 AND d.voided_at IS NULL`;
/** `[count, balance]` per bucket of the open documents `d` that match `is`, as at `?1` (10 arguments, under D1's 32). */
const ageingJson = (is: string) =>
  `json_array(${SQL_AGEING_BUCKETS.flatMap((b) => {
    const at = `${is} AND ${ageingBucketSql("d.due_date", "?1")} = '${b}'`;
    return [
      `count(CASE WHEN ${at} THEN 1 END)`,
      `coalesce(sum(CASE WHEN ${at} THEN d.balance_minor END), 0)`,
    ];
  }).join(", ")})`;

/**
 * C9, one page of the ageing (`?1` today, IST; a next page `?2` the last client id): per client with an open balance, by client id, the open tax invoices, export
 * invoices and debit notes (the `OWED_SQL` set; proformas and receipts never, LD78) in each bucket per currency, and the client's credit held in that currency
 * (`paymentFreeSql`, M6.5's free money), shown apart and never netted (RA-36, C13). At most 51 clients, a row per client and currency. Each client costs a probe
 * and a read of its open documents through `documents_client_type_status`; credit is read for the page's clients only.
 */
export const AGEING_PAGE_SQL = (after: boolean): string => {
  const at = (i: number) => `coalesce(json_extract(y.a, '$.' || cur.currency || '[${i}]'), 0)`;
  return `SELECT y.id AS client_id, y.code AS client_code, y.display_name AS client_name, y.anonymised_at, cur.currency,
       ${SQL_AGEING_BUCKETS.flatMap((b, i) => [`${at(2 * i)} AS n_${b}`, `${at(2 * i + 1)} AS b_${b}`]).join(", ")},
       ${SQL_AGEING_BUCKETS.map((_, i) => at(2 * i + 1)).join(" + ")} AS total,
       (SELECT coalesce(sum(${paymentFreeSql("p")}), 0) FROM payments p INDEXED BY payments_client
         WHERE p.client_id = y.id AND p.currency = cur.currency AND p.status = 'confirmed' AND p.kind = 'payment') AS credit
   FROM (SELECT c.id, c.code, c.display_name, c.anonymised_at,
           (SELECT ${perCurrency((is) => ageingJson(is), "d.currency")} FROM documents d INDEXED BY documents_client_type_status WHERE d.client_id = c.id AND ${OWED_ROW}) AS a
         FROM clients c
         WHERE ${after ? "c.id > ?2 AND " : ""}EXISTS (SELECT 1 FROM documents d INDEXED BY documents_client_type_status WHERE d.client_id = c.id AND ${OWED_ROW})
         ORDER BY c.id LIMIT ${REPORT_PAGE_SIZE + 1}) y
   JOIN (${currencyRows}) cur
   WHERE ${SQL_AGEING_BUCKETS.map((_, i) => at(2 * i)).join(" + ")} > 0
   ORDER BY y.id, cur.currency`;
};

/** One row of `AGEING_PAGE_SQL` as D1 returns it. */
export type AgeingSqlRow = {
  client_id: string;
  client_code: string;
  client_name: string;
  anonymised_at: number | null;
  currency: "INR" | "USD";
  credit: number;
  total: number;
} & Record<`n_${SqlAgeingBucket}` | `b_${SqlAgeingBucket}`, number>;

/**
 * C9's first page totals (`?1` today): per currency and bucket over every open document. They are `OWED_SQL` itself (C5, L11: the dashboard's Overdue tile and
 * the ageing report read one statement), so Σ buckets = its balance and Σ of the four overdue buckets = its overdue figure by construction (a test holds both).
 */
export const AGEING_TOTALS_SQL = OWED_SQL;
export type AgeingTotalsSqlRow = OwedSqlRow;
/** The reference twin of the ageing figures (tests only): grouped by currency and bucket. */
export const AGEING_GROUPED_SQL = /* @__PURE__ */ (() =>
  `SELECT d.currency, ${ageingBucketSql("d.due_date", "?1")} AS bucket, count(*) AS n, sum(d.balance_minor) AS balance
   FROM documents d WHERE ${OWED_ROW} GROUP BY d.currency, bucket ORDER BY d.currency, bucket`)();
