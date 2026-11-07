// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L1 to L12): the SQL of the request, the result, the subjects and the readers' served-key lookup,
// shared by the admin routes (API and invoices Workers), the jobs consumer and the trigger set `pdf_repair_triggers` (`triggers-pdf-repairs.ts`), so the
// route's guard, the batch's WHERE and the trigger read one rule. Pure text; no I/O. Every subject is one of core `REPAIR_KINDS`.
//
// Owner decision Q1 = B (2026-11-07): the PDF of an offer the client can still accept is never rebuilt (409 `offer_open`; the Owner sends a new version). "Can
// still accept" is the portal's accept condition (`ACCEPT_INSERT_SQL`, apps/portal/worker/offer-sql.ts) on the document, held here as a twin
// (`OFFER_OPEN_PARTS`; apps/portal/worker/offer-open-twin.test.ts pins every part to the portal's text).
import { INVOICE_FLOW_TYPES } from "@techaust/core/invoices";
import { SUPPLIER_COPY_TYPES } from "@techaust/core/pdf-jobs";
import { REBUILD_OPEN_MS, REBUILD_WINDOW_MS, type RepairKind } from "@techaust/core/pdf-repair";

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** The SQL twin of core `repairKey`: `<original stem>-r<n>.pdf`. */
export const REPAIR_KEY_SQL = (originalKey: string, n: string) =>
  `substr(${originalKey}, 1, length(${originalKey}) - 4) || '-r' || CAST(${n} AS INTEGER) || '.pdf'`;

/** The SQL twin of core `supplierPdfKey` from the original's own key: `<stem>-supplier.pdf`. */
export const SUPPLIER_KEY_SQL = (pdfKey: string) =>
  `substr(${pdfKey}, 1, length(${pdfKey}) - 4) || '-supplier.pdf'`;

/** The IST calendar day ("2026-11-07") of a UTC instant in ms: the SQL twin of core `todayIst` (a db test compares them). */
export const IST_DAY_SQL = (ms: string) => `date((${ms}) / 1000, 'unixepoch', '+330 minutes')`;

const gone = (clientCol: string) =>
  `EXISTS (SELECT 1 FROM clients z WHERE z.id = ${clientCol} AND z.anonymised_at IS NOT NULL)`;

/**
 * The parts of the portal's accept condition that belong to the document `d` (`ACCEPT_INSERT_SQL`, word for word with `?5` = today in IST): sent or viewed,
 * valid on that day, the newest frozen version of its group, and no version of the group accepted or converted. The other parts of the accept (frozen, not
 * redacted, its PDF recorded, the contact and the link) are the subject's own checks or the person's, not the offer's.
 */
export const OFFER_OPEN_PARTS = [
  "d.status IN ('sent', 'viewed')",
  "d.valid_until >= ?5",
  "NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL)",
  "NOT EXISTS (SELECT 1 FROM documents g WHERE g.version_group_id = d.version_group_id AND g.status IN ('accepted', 'converted'))",
] as const;

/** 1 when the offer `alias` can still be accepted on the IST day `today`, else 0 (never null: a missing `valid_until` reads as not open, as the accept). */
export const offerOpenSql = (alias: string, today: string) =>
  `coalesce((${OFFER_OPEN_PARTS.map((p) => p.replaceAll("d.", `${alias}.`).replaceAll("?5", today)).join(" AND ")}), 0)`;

const OFFER_TYPES = "'proposal', 'estimate'";
const INVOICE_TYPES = list(INVOICE_FLOW_TYPES);
const SUPPLIER_TYPES = list(SUPPLIER_COPY_TYPES);

/**
 * The key a subject records, when it may be rebuilt now: a frozen subject of its kind's state with its PDF recorded, of a client that is not anonymised, an
 * offer not redacted (and, with `today`, not open: Q1 = B); NULL otherwise. `kind` and `id` are SQL expressions (a literal kind, `NEW.subject_kind`, ...).
 * The insert trigger, the request's guard and the result's guard all read it.
 */
export function rebuildableKeySql(kind: RepairKind, id: string, today: string | null): string {
  switch (kind) {
    case "offer":
      return `(SELECT d.pdf_r2_key FROM documents d WHERE d.id = ${id} AND d.type IN (${OFFER_TYPES}) AND d.frozen_at IS NOT NULL AND d.pdf_sha256 IS NOT NULL AND d.redacted_at IS NULL AND NOT ${gone("d.client_id")}${today === null ? "" : ` AND ${offerOpenSql("d", today)} = 0`})`;
    case "certificate":
      return `(SELECT ce.r2_key FROM acceptance_certificates ce JOIN acceptances a ON a.id = ce.acceptance_id JOIN documents d ON d.id = a.document_id WHERE ce.acceptance_id = ${id} AND d.redacted_at IS NULL AND NOT ${gone("d.client_id")})`;
    case "deed":
      return `(SELECT e.unsigned_r2_key FROM deeds e WHERE e.id = ${id} AND e.status IN ('final', 'signed') AND e.unsigned_sha256 IS NOT NULL AND NOT ${gone("e.client_id")})`;
    case "invoice":
      return `(SELECT d.pdf_r2_key FROM documents d WHERE d.id = ${id} AND d.type IN (${INVOICE_TYPES}) AND d.frozen_at IS NOT NULL AND d.pdf_sha256 IS NOT NULL AND NOT ${gone("d.client_id")})`;
    case "supplier":
      return `(SELECT ${SUPPLIER_KEY_SQL("d.pdf_r2_key")} FROM documents d WHERE d.id = ${id} AND d.type IN (${SUPPLIER_TYPES}) AND d.frozen_at IS NOT NULL AND d.pdf_sha256 IS NOT NULL AND NOT ${gone("d.client_id")})`;
    case "receipt":
      return `(SELECT d.pdf_r2_key FROM documents d WHERE d.id = ${id} AND d.type = 'receipt' AND d.frozen_at IS NOT NULL AND d.status IN ('issued', 'void') AND d.pdf_sha256 IS NOT NULL AND NOT ${gone("d.client_id")})`;
  }
}

/** The same key for a kind held in a column (`p.subject_kind`, `NEW.subject_kind`). */
export const rebuildableKeyByKindSql = (kindCol: string, id: string, today: string | null): string =>
  `CASE ${kindCol} ${(["offer", "certificate", "deed", "invoice", "supplier", "receipt"] as const)
    .map((k) => `WHEN '${k}' THEN ${rebuildableKeySql(k, id, today)}`)
    .join(" ")} END`;

/** The key served now for an original key: the newest rebuilt key, else the original. */
export const servedKeySql = (originalKey: string) =>
  `coalesce((SELECT r.new_key FROM pdf_repair_results r WHERE r.original_key = ${originalKey} AND r.outcome = 'rebuilt' ORDER BY r.n DESC LIMIT 1), ${originalKey})`;

/** The readers' lookup (`?1` the original key): the newest rebuilt object, by the partial index `pdf_repair_results_served`. No row: serve the original. */
export const SERVED_PDF_SQL =
  "SELECT new_key, new_sha256, completed_at FROM pdf_repair_results WHERE original_key = ?1 AND outcome = 'rebuilt' ORDER BY n DESC LIMIT 1";

export type ServedRow = { new_key: string; new_sha256: string; completed_at: number };

/**
 * The subject of a route, by the id the route takes (`?1`; the certificate's route takes the DOCUMENT id) and `?2` today (IST, offers only). No row: unknown,
 * a draft or another type (404). Columns: `subject_id` (the id `pdf_repairs` records), `original_key` and `recorded_sha` (null while no PDF is recorded; a
 * supplier copy has no hash column: null), `gone`, `redacted`, `open` (offers), `label` (the number, for the audit row and the bells).
 */
export const SUBJECT_SQL: Record<RepairKind, string> = {
  offer: `SELECT d.id AS subject_id, d.pdf_r2_key AS original_key, d.pdf_sha256 AS recorded_sha, ${gone("d.client_id")} AS gone, d.redacted_at IS NOT NULL AS redacted, ${offerOpenSql("d", "?2")} AS open, d.number_display AS label FROM documents d WHERE d.id = ?1 AND d.type IN (${OFFER_TYPES}) AND d.frozen_at IS NOT NULL AND d.number_display IS NOT NULL`,
  certificate: `SELECT a.id AS subject_id, ce.r2_key AS original_key, ce.sha256 AS recorded_sha, ${gone("d.client_id")} AS gone, d.redacted_at IS NOT NULL AS redacted, 0 AS open, d.number_display AS label FROM acceptances a JOIN documents d ON d.id = a.document_id LEFT JOIN acceptance_certificates ce ON ce.acceptance_id = a.id WHERE a.document_id = ?1 AND d.type IN (${OFFER_TYPES})`,
  deed: `SELECT e.id AS subject_id, e.unsigned_r2_key AS original_key, e.unsigned_sha256 AS recorded_sha, ${gone("e.client_id")} AS gone, 0 AS redacted, 0 AS open, e.number_display AS label FROM deeds e WHERE e.id = ?1 AND e.status IN ('final', 'signed')`,
  invoice: `SELECT d.id AS subject_id, CASE WHEN d.pdf_sha256 IS NOT NULL THEN d.pdf_r2_key END AS original_key, d.pdf_sha256 AS recorded_sha, ${gone("d.client_id")} AS gone, 0 AS redacted, 0 AS open, d.number_display AS label FROM documents d WHERE d.id = ?1 AND d.type IN (${INVOICE_TYPES}) AND d.frozen_at IS NOT NULL AND d.number_display IS NOT NULL`,
  supplier: `SELECT d.id AS subject_id, CASE WHEN d.pdf_sha256 IS NOT NULL AND d.pdf_r2_key IS NOT NULL THEN ${SUPPLIER_KEY_SQL("d.pdf_r2_key")} END AS original_key, NULL AS recorded_sha, ${gone("d.client_id")} AS gone, 0 AS redacted, 0 AS open, d.number_display AS label FROM documents d WHERE d.id = ?1 AND d.type IN (${SUPPLIER_TYPES}) AND d.frozen_at IS NOT NULL AND d.number_display IS NOT NULL`,
  receipt: `SELECT d.id AS subject_id, CASE WHEN d.pdf_sha256 IS NOT NULL THEN d.pdf_r2_key END AS original_key, d.pdf_sha256 AS recorded_sha, ${gone("d.client_id")} AS gone, 0 AS redacted, 0 AS open, d.number_display AS label FROM documents d WHERE d.id = ?1 AND d.type = 'receipt' AND d.frozen_at IS NOT NULL AND d.status IN ('issued', 'void') AND d.number_display IS NOT NULL`,
};

/** The binds of `SUBJECT_SQL[kind]`: the id, and for an offer today's IST day. */
export const subjectBinds = (kind: RepairKind, id: string, today: string): unknown[] =>
  kind === "offer" ? [id, today] : [id];

export type SubjectRow = {
  subject_id: string;
  original_key: string | null;
  recorded_sha: string | null;
  gone: number;
  redacted: number;
  open: number;
  label: string | null;
};

/** The newest 10 requests of a subject with their results (`?1` kind, `?2` subject id), newest first. */
export const REPAIRS_OF_SQL = `SELECT p.id, p.n, p.found, p.old_key, p.new_key, p.requested_at, r.outcome, r.code, r.new_sha256, r.completed_at
  FROM pdf_repairs p LEFT JOIN pdf_repair_results r ON r.repair_id = p.id
  WHERE p.subject_kind = ?1 AND p.subject_id = ?2 ORDER BY p.n DESC LIMIT 10`;

export type RepairOfRow = {
  id: string;
  n: number;
  found: "missing" | "damaged";
  old_key: string;
  new_key: string;
  requested_at: number;
  outcome: string | null;
  code: string | null;
  new_sha256: string | null;
  completed_at: number | null;
};

/** A subject's last request blocks another: under 5 minutes old, or under 26 hours old without a result (`?2` kind, `?3` subject, `?9` now). */
const BLOCKED = `EXISTS (SELECT 1 FROM pdf_repairs p WHERE p.subject_kind = ?2 AND p.subject_id = ?3 AND (p.requested_at > ?9 - ${REBUILD_WINDOW_MS}
    OR (p.requested_at > ?9 - ${REBUILD_OPEN_MS} AND NOT EXISTS (SELECT 1 FROM pdf_repair_results r WHERE r.repair_id = p.id))))`;

/**
 * The request (the main statement of the route's `mutate`): `?1` id, `?2` kind, `?3` subject id, `?4` the original key read, `?5` the key that was checked
 * (the served key), `?6` its recorded hash (null: a supplier copy without a checksum), `?7` found, `?8` who, `?9` now. `n`,
 * `new_key` and `old_key` are computed here; nothing is written when the subject's last request blocks it (L2, L12), when the subject is no longer
 * rebuildable (gone, redacted, open: Q1 = B) or when the served key moved since it was checked. Per kind, because the subject rule is.
 */
export const requestInsertSql = (kind: RepairKind) =>
  `INSERT INTO pdf_repairs (id, subject_kind, subject_id, n, original_key, old_key, old_sha256, found, new_key, requested_by, requested_at)
  SELECT ?1, ?2, ?3, x.n, ?4, ?5, ?6, ?7, ${REPAIR_KEY_SQL("?4", "x.n")}, ?8, ?9
  FROM (SELECT 1 + coalesce((SELECT max(q.n) FROM pdf_repairs q WHERE q.subject_kind = ?2 AND q.subject_id = ?3), 0) AS n) x
  WHERE ?2 = '${kind}' AND NOT ${BLOCKED}
    AND ?4 IS ${rebuildableKeySql(kind, "?3", IST_DAY_SQL("?9"))}
    AND ?5 IS ${servedKeySql("?4")}`;

export const REQUEST_INSERT_SQL: Record<RepairKind, string> = {
  offer: requestInsertSql("offer"),
  certificate: requestInsertSql("certificate"),
  deed: requestInsertSql("deed"),
  invoice: requestInsertSql("invoice"),
  supplier: requestInsertSql("supplier"),
  receipt: requestInsertSql("receipt"),
};

/** Binds the request in `REQUEST_INSERT_SQL`'s order. */
export const requestBinds = (r: {
  id: string;
  kind: RepairKind;
  subjectId: string;
  originalKey: string;
  checkedKey: string;
  checkedSha: string | null;
  found: "missing" | "damaged";
  by: string;
  now: number;
}): unknown[] => [r.id, r.kind, r.subjectId, r.originalKey, r.checkedKey, r.checkedSha, r.found, r.by, r.now];

/**
 * The result (`?1` repair id, `?2` outcome, `?3` code, `?4` new SHA-256, `?5` bytes, `?6` now): once per request (its primary key and the guard), the
 * original key, `n` and the new key copied from the request; a `rebuilt` result only while its subject may still be rebuilt (not redacted, the client not
 * anonymised: the T7 pattern; the jobs Worker deletes the object it stored when this writes nothing). `completed_at` never before `requested_at`.
 */
export const RESULT_INSERT_SQL = `INSERT INTO pdf_repair_results (repair_id, original_key, n, outcome, code, new_key, new_sha256, bytes, completed_at)
  SELECT p.id, p.original_key, p.n, ?2, ?3, CASE WHEN ?2 = 'rebuilt' THEN p.new_key END, ?4, ?5, max(?6, p.requested_at)
  FROM pdf_repairs p WHERE p.id = ?1 AND NOT EXISTS (SELECT 1 FROM pdf_repair_results r WHERE r.repair_id = ?1)
    AND (?2 <> 'rebuilt' OR p.original_key IS ${rebuildableKeyByKindSql("p.subject_kind", "p.subject_id", null)})`;

/**
 * The jobs consumer's read (`?1` repair id): the request, its result (if any) and whether its subject may still be rebuilt (`live`: the same rule as the
 * result's guard), with what each kind's plan needs to find its sealed record.
 */
export const REPAIR_READ_SQL = `SELECT p.id, p.subject_kind, p.subject_id, p.n, p.original_key, p.old_key, p.old_sha256, p.found, p.new_key, p.requested_at,
    r.outcome AS done_outcome,
    p.original_key IS ${rebuildableKeyByKindSql("p.subject_kind", "p.subject_id", null)} AS live
  FROM pdf_repairs p LEFT JOIN pdf_repair_results r ON r.repair_id = p.id WHERE p.id = ?1`;

export type RepairReadRow = {
  id: string;
  subject_kind: RepairKind;
  subject_id: string;
  n: number;
  original_key: string;
  old_key: string;
  old_sha256: string | null;
  found: "missing" | "damaged";
  new_key: string;
  requested_at: number;
  done_outcome: string | null;
  live: number;
};
