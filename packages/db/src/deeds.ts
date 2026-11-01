// The deed of assignment's statements (T11; run file docs/runs/t11-deed.md, L2 to L8; 08-C RB-38(a), RB-21). Plain SQL text and statement builders for the
// caller's own `db.batch()` (the admin API's `mutate`, the finance Worker's ledger batches, the advance batch). Subpath export (`@techaust/db/deeds`): no Drizzle
// schema, no zod, so every Worker importing it stays small.
//
// L2, full payment (the twin of core `deedEligibility`, `packages/core/src/deeds.ts`; a db test compares the two over a table of cases). A project is eligible when:
//   - it is `completed`, with a source document that is an ACCEPTED proposal or estimate of the same client;
//   - its client is not anonymised; it is not a care-plan project (no care plan was made from its source document, and no invoice of it belongs to a care plan);
//   - it has at least one LIVE payable document (a frozen, not void tax invoice, export invoice or debit note: an invoice for a payment received is a tax or
//     export invoice; a proforma is never counted, a credit note is a reduction, never a payable), and every one of them has `balance_minor = 0`;
//   - the money that settles them reaches the accepted version's total LESS the credit notes on them, in its currency (owner, 2026-11-01: a credit note given
//     as a discount lowers what is owed): `Σ settled + Σ credited >= accepted total`, per document `settled = max(0, min(paid + tds, total - credited))`.
//     `paid` is what CONFIRMED payments hold on the document (the M6.1 recompute, net of every release) and `tds` the TDS by certificate (08-C RA-30);
//   - and some money was settled at all (`Σ settled > 0`): a project credited in full gets no deed (lead, 2026-11-01, decision (a)).
// Counting each rupee once (the early check): money is counted where it is ALLOCATED, never by a document's total. An advance's tax invoice (M5.2
// `advanceIssueStatements`) is a tax or export invoice whose parent is the proforma; its money is the one confirmed payment `pay_<receipt>` (or the pending entry
// it confirmed) allocated whole onto it (`pal_<receipt>`), and the proforma's own `paid_minor` (the advance batch's) is never read here (proformas are not
// payable). There is no "final invoice the advance is adjusted into" in M5/M6: the rest of the price is billed by further advance invoices or by ordinary
// invoices for the rest, each settled by its own allocations, and `payment_allocations_bounds` (0060) keeps a payment from being put on more than its amount.
import type { GuardSql } from "./log.ts";

/** The document types that are paid (`PAYABLE_TYPES_SQL` of `sql-rules.ts`, written out here so this module imports nothing at run time). */
const PAYABLE_SQL = "('tax_invoice', 'export_invoice', 'debit_note')";

/** A live payable document of project `p` (an SQL expression), as table alias `alias`. */
const livePayable = (alias: string, p: string) =>
  `${alias}.project_id = ${p} AND ${alias}.type IN ${PAYABLE_SQL} AND ${alias}.frozen_at IS NOT NULL AND ${alias}.status <> 'void'`;

/** What the money settles on document `d` (an alias): `max(0, min(paid + tds, total - credited))`. Core `settledOf` is the twin. */
export const settledSql = (d: string): string =>
  `max(0, min(${d}.paid_minor + ${d}.tds_minor, ${d}.total_minor - ${d}.credited_minor))`;

/** The live payables of project `p` in its accepted version's currency (the set `settled` and `credited` sum over). */
const livePayableInAccepted = (alias: string, p: string, currency: string) =>
  `${livePayable(alias, p)} AND ${alias}.currency = ${currency}`;

/**
 * The facts L2 decides on, for project `p` (an SQL expression for its id): one row the admin reads for the project page and the twin test compares with core.
 * Columns: `status`, `client_id`, `source_document_id`, `source_ok` (an accepted proposal or estimate of the client), `accepted_currency`, `accepted_total`,
 * `anonymised`, `care_plan`, `payables`, `unpaid` (payables with a balance), `settled` and `credited` (in the accepted currency), `has_deed` (any status),
 * `has_open_deed` (a draft, final or signed deed: a cancelled one is history).
 */
export const deedFactsSql = (p: string): string =>
  `SELECT pr.id AS project_id, pr.status, pr.client_id, pr.source_document_id,
     EXISTS (SELECT 1 FROM documents s WHERE s.id = pr.source_document_id AND s.client_id = pr.client_id AND s.type IN ('proposal', 'estimate') AND s.status = 'accepted' AND s.frozen_at IS NOT NULL) AS source_ok,
     (SELECT s.currency FROM documents s WHERE s.id = pr.source_document_id) AS accepted_currency,
     (SELECT s.total_minor FROM documents s WHERE s.id = pr.source_document_id) AS accepted_total,
     EXISTS (SELECT 1 FROM clients z WHERE z.id = pr.client_id AND z.anonymised_at IS NOT NULL) AS anonymised,
     (EXISTS (SELECT 1 FROM care_plans cp WHERE cp.source_document_id = pr.source_document_id) OR EXISTS (SELECT 1 FROM documents cd WHERE cd.project_id = pr.id AND cd.care_plan_id IS NOT NULL)) AS care_plan,
     (SELECT count(*) FROM documents d WHERE ${livePayable("d", "pr.id")}) AS payables,
     (SELECT count(*) FROM documents d WHERE ${livePayable("d", "pr.id")} AND d.balance_minor <> 0) AS unpaid,
     (SELECT coalesce(sum(${settledSql("d")}), 0) FROM documents d WHERE ${livePayableInAccepted("d", "pr.id", "(SELECT s.currency FROM documents s WHERE s.id = pr.source_document_id)")}) AS settled,
     (SELECT coalesce(sum(d.credited_minor), 0) FROM documents d WHERE ${livePayableInAccepted("d", "pr.id", "(SELECT s.currency FROM documents s WHERE s.id = pr.source_document_id)")}) AS credited,
     EXISTS (SELECT 1 FROM deeds dd WHERE dd.project_id = pr.id) AS has_deed,
     EXISTS (SELECT 1 FROM deeds dd WHERE dd.project_id = pr.id AND dd.status <> 'cancelled') AS has_open_deed
   FROM projects pr WHERE pr.id = ${p}`;

/**
 * Which deeds already there stop a new draft (L3; lead, 2026-11-01, decision (b)):
 *   - `"none"` (every automatic hook): a deed of ANY status, so a ledger event or a completed → active → completed flip never undoes the Owner's cancel;
 *   - `"open"` (the Owner's "Check again"): a draft, final or signed deed only, so after a cancel the Owner can have a fresh draft made (the cancelled one stays
 *     as history; `deeds_project_open` is unique over the open statuses only);
 *   - `false` (the finalise re-check): none: the deed being finalised exists.
 */
export type NoDeedYet = "none" | "open" | false;

/**
 * L2 as one SQL condition on the project row `p` (a table alias): the project is completed, fully paid and may have a deed (`noDeedYet`). The twin of core
 * `deedEligibility(...).eligible` together with the deed clause.
 */
export const deedEligibleSql = (p: string, noDeedYet: NoDeedYet = "none"): string =>
  `${p}.status = 'completed' AND ${p}.source_document_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM documents s WHERE s.id = ${p}.source_document_id AND s.client_id = ${p}.client_id AND s.type IN ('proposal', 'estimate') AND s.status = 'accepted' AND s.frozen_at IS NOT NULL
     AND (SELECT coalesce(sum(${settledSql("ed")} + ed.credited_minor), 0) FROM documents ed WHERE ${livePayableInAccepted("ed", `${p}.id`, "s.currency")}) >= s.total_minor
     AND (SELECT coalesce(sum(${settledSql("ed")}), 0) FROM documents ed WHERE ${livePayableInAccepted("ed", `${p}.id`, "s.currency")}) > 0)
   AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ${p}.client_id AND z.anonymised_at IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM care_plans cp WHERE cp.source_document_id = ${p}.source_document_id)
   AND NOT EXISTS (SELECT 1 FROM documents cd WHERE cd.project_id = ${p}.id AND cd.care_plan_id IS NOT NULL)
   AND EXISTS (SELECT 1 FROM documents d WHERE ${livePayable("d", `${p}.id`)})
   AND NOT EXISTS (SELECT 1 FROM documents d WHERE ${livePayable("d", `${p}.id`)} AND d.balance_minor <> 0)${
     noDeedYet === "none"
       ? `
   AND NOT EXISTS (SELECT 1 FROM deeds dd WHERE dd.project_id = ${p}.id)`
       : noDeedYet === "open"
         ? `
   AND NOT EXISTS (SELECT 1 FROM deeds dd WHERE dd.project_id = ${p}.id AND dd.status <> 'cancelled')`
         : ""
   }`;

/** The invoice-family document types whose frozen rows the finalise seals from (L6's `{invoice_numbers}` and `{amount_paid}`; early check 7). */
const INVOICE_FAMILY_SQL = "('tax_invoice', 'export_invoice', 'debit_note', 'credit_note', 'proforma')";

/**
 * Early check 7: the stamp of a project's frozen invoice-family documents, `n` (how many) and `at` (the latest `updated_at`; null when none). Every ledger
 * recompute, credit-note issue and void moves a document's `updated_at`, so the finalise binds the stamp it read into its WHERE: a payment, a credit note or a
 * void landing between the read and the batch refuses it (the route answers `stale_version`) instead of sealing figures that are no longer true. `?1` the project.
 */
export const DEED_DOCS_STAMP_SQL = `SELECT count(*) AS n, max(fd.updated_at) AS at FROM documents fd WHERE fd.project_id = ?1 AND fd.frozen_at IS NOT NULL AND fd.type IN ${INVOICE_FAMILY_SQL}`;
export type DeedDocsStamp = { n: number; at: number | null };

/**
 * Which projects a batch may have brought to "fully paid" (L3): the project named, and the projects of the documents named or of every document the payments
 * named have an allocation row on (the ledger's `LedgerTarget`).
 */
export type DeedTarget = {
  readonly projectId?: string | null;
  readonly documentIds?: readonly string[];
  readonly paymentIds?: readonly string[];
};

/** `?1` project, `?2` the JSON list of documents, `?3` of payments. */
const TARGET_PROJECTS = `SELECT ?1 AS id WHERE ?1 IS NOT NULL
   UNION SELECT td.project_id FROM documents td WHERE td.project_id IS NOT NULL AND td.id IN (
     SELECT value FROM json_each(?2) UNION SELECT document_id FROM payment_allocations WHERE payment_id IN (SELECT value FROM json_each(?3)))`;

/** The words of the Owner's bell around the project's code: `before` {code} `after`. */
export type DeedBell = { readonly before: string; readonly after: string };

/** 07-ZJ line 31 (approved by the lead under the owner's delegation, 2026-11-01): "Draft deed ready for {project code}: fill in the Schedules." */
export const DEED_BELL: DeedBell = { before: "Draft deed ready for ", after: ": fill in the Schedules." };

const guarded = (g: GuardSql | undefined, used: number): { sql: string; params: readonly unknown[] } =>
  g ? { sql: ` AND ${g.sql(used + 1)}`, params: g.params } : { sql: "", params: [] };

/**
 * L3: the draft deed of every eligible project of the target, then a system audit row (`deed.draft`) and a bell for every active Owner for each deed THIS
 * statement made (the deed's `created_at` is the batch's `now`, and the bell and the audit row are `INSERT OR IGNORE`/once per deed), each guarded on `g`
 * (normally the batch's audit row) so a refused change makes no deed. `ON CONFLICT DO NOTHING`: a project has at most one OPEN deed (`deeds_project_open`).
 * The automatic hooks need no deed of any status, so a cancelled one is never replaced by them; `redraft` (the Owner's "Check again" only) needs no open deed,
 * so a fresh draft follows a cancel (lead, 2026-11-01, decision (b)). Append these to any batch that can complete a project or bring its documents to zero,
 * AFTER the ledger recompute (it reads the recomputed balances); `test/deed-hooks.test.ts` in core lists every recompute and checks it.
 */
export function deedDraftStatements(
  db: D1Database,
  a: { target: DeedTarget; now: number; bell?: DeedBell; redraft?: boolean },
  g?: GuardSql,
): D1PreparedStatement[] {
  const target = [
    a.target.projectId ?? null,
    JSON.stringify(a.target.documentIds ?? []),
    JSON.stringify(a.target.paymentIds ?? []),
  ];
  const g1 = guarded(g, 4);
  const g2 = guarded(g, 4);
  const g3 = guarded(g, 6);
  const bell = a.bell ?? DEED_BELL;
  const made = `FROM deeds d JOIN projects p ON p.id = d.project_id WHERE d.project_id IN (${TARGET_PROJECTS}) AND d.created_at = ?4 AND d.status = 'draft'`;
  return [
    db
      .prepare(
        `INSERT INTO deeds (id, client_id, project_id, source_document_id, status, created_at, updated_at)
         SELECT 'deed_' || lower(hex(randomblob(16))), p.client_id, p.id, p.source_document_id, 'draft', ?4, ?4
         FROM projects p WHERE p.id IN (${TARGET_PROJECTS}) AND ${deedEligibleSql("p", a.redraft ? "open" : "none")}${g1.sql}
         ON CONFLICT DO NOTHING`,
      )
      .bind(...target, a.now, ...g1.params),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor_type, actor_id, role, action, entity_type, entity_id, summary)
         SELECT 'a_' || lower(hex(randomblob(16))), ?4, 'system', NULL, NULL, 'deed.draft', 'deed', d.id,
           json_object('deedId', d.id, 'projectId', d.project_id, 'sourceDocumentId', d.source_document_id)
         ${made} AND NOT EXISTS (SELECT 1 FROM audit_log x WHERE x.entity_type = 'deed' AND x.entity_id = d.id AND x.action = 'deed.draft')${g2.sql}`,
      )
      .bind(...target, a.now, ...g2.params),
    db
      .prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
         SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'deed.draft', 'deed', d.id, ?5 || p.code || ?6, '/projects/' || p.id || '?tab=deed'
         ${made.replace("FROM deeds d JOIN projects p ON p.id = d.project_id", "FROM deeds d JOIN projects p ON p.id = d.project_id JOIN staff_users o ON o.role = 'owner' AND o.status = 'active'")}${g3.sql}`,
      )
      .bind(...target, a.now, bell.before, bell.after, ...g3.params),
  ];
}

// ---- the Owner's and Staff's moves (L4) ---------------------------------------------------------------------------------------------------------------------

/** A live session of an active member (`s` the session placeholder, `now` the instant) of the roles listed; `stepUp` also needs a fresh step-up. */
const sessionSql = (s: string, now: string, roles: readonly string[], stepUp: boolean) =>
  `EXISTS (SELECT 1 FROM staff_sessions ss JOIN staff_users su ON su.id = ss.user_id WHERE ss.id = ${s} AND ss.revoked_at IS NULL AND ss.idle_expires_at > ${now} AND ss.abs_expires_at > ${now}${stepUp ? ` AND ss.step_up_until > ${now}` : ""} AND su.status = 'active' AND su.role IN (${roles.map((r) => `'${r}'`).join(", ")}))`;

const clientLive = (alias: string) =>
  `NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ${alias}.client_id AND z.anonymised_at IS NOT NULL)`;

/** The Schedules as the form sends them (each the field's text; `null` clears it). */
export type DeedSchedules = {
  readonly deliverables: string | null;
  readonly location: string | null;
  readonly deliveredDates: string | null;
  readonly tools: string | null;
  readonly thirdParty: string | null;
};

/**
 * Save the Schedules of a DRAFT deed read at `expectedUpdatedAt` (stale: nothing written, the route's 409), by an Owner or Staff member, while the client is
 * live. `updated_at = max(now, old + 1)`. Binds `?1` deed, `?2` expected, `?3` now, `?4` session, `?5`..`?9` the five fields.
 */
export function deedSchedulesStatement(
  db: D1Database,
  a: { deedId: string; expectedUpdatedAt: number; now: number; sessionId: string; schedules: DeedSchedules },
): D1PreparedStatement {
  const s = a.schedules;
  return db
    .prepare(
      `UPDATE deeds SET sched_deliverables = ?5, sched_location = ?6, sched_delivered_dates = ?7, sched_tools = ?8, sched_third_party = ?9,
         updated_at = max(?3, updated_at + 1)
       WHERE id = ?1 AND status = 'draft' AND updated_at = ?2 AND ${clientLive("deeds")} AND ${sessionSql("?4", "?3", ["owner", "staff"], false)}`,
    )
    .bind(
      a.deedId,
      a.expectedUpdatedAt,
      a.now,
      a.sessionId,
      s.deliverables,
      s.location,
      s.deliveredDates,
      s.tools,
      s.thirdParty,
    );
}

/** The `deed` series' counter row for the FY (made if missing); the first of the finalise batch's statements. */
export const deedCounterRowStatement = (db: D1Database, fy: string): D1PreparedStatement =>
  db
    .prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES ('deed', ?1, 1) ON CONFLICT DO NOTHING")
    .bind(fy);

export type FinaliseDeedArgs = {
  deedId: string;
  expectedUpdatedAt: number;
  now: number;
  sessionId: string;
  memberId: string;
  /** The FY token ("2627") of `madeOn`, the SQL printf pattern of the `deed` format and which argument comes first, and the format's highest number. */
  fy: string;
  pattern: string;
  argOrder: readonly ["fy", "n"] | readonly ["n", "fy"];
  maxNumber: number;
  /** ISO date (IST) the deed is made on. */
  madeOn: string;
  /** The canonical JSON of the sealed values (core `deedSnapshotJson`) and its SHA-256. */
  snapshotJson: string;
  snapshotSha256: string;
  /** The `version` of the `numbering` and `company` settings rows read before the batch (null: no row): a change in between refuses the finalise. */
  numberingVersion: number | null;
  companyVersion: number | null;
  /** The client row's `updated_at` read with the facts: a change to the assignee's name, address or GSTIN in between refuses the finalise. */
  clientUpdatedAt: number;
  /** Early check 7: the stamp of the project's frozen invoice-family documents read with the facts (`DEED_DOCS_STAMP_SQL`). */
  docs: DeedDocsStamp;
};

/**
 * Finalise (L1, L4): the DRAFT deed read at `expectedUpdatedAt` takes the next number of (`deed`, FY), its date and the sealed snapshot, only while the project is
 * STILL eligible (L2 without the "no deed" clause), the settings and the client are as read, the series has room, the Schedules are filled in (also the trigger
 * `deeds_finalise_ready`) and the session is an Owner's with a fresh step-up. The number is the counter's `next_no`; `deedCounterTakeStatement` (guarded on
 * the audit row) then moves the counter, so a refused finalise takes no number and leaves no gap. The sealed `{invoice_numbers}` and `{amount_paid}` come
 * from the read before the batch, so the stamp of the project's invoice-family documents read then is bound here too (early check 7): any document moved in
 * between refuses it. Binds `?1`..`?16`.
 */
export function finaliseDeedStatement(db: D1Database, a: FinaliseDeedArgs): D1PreparedStatement {
  if (!Number.isSafeInteger(a.maxNumber) || a.maxNumber < 1)
    throw new RangeError(`maxNumber must be a whole number of at least 1, not ${a.maxNumber}`);
  const next = "(SELECT next_no FROM doc_counters WHERE series = 'deed' AND fy = ?5)";
  const printfArgs = a.argOrder[0] === "fy" ? `?5, ${next}` : `${next}, ?5`;
  const eligible = deedEligibleSql("pr", false);
  return db
    .prepare(
      `UPDATE deeds SET status = 'final', fy = ?5, number = ${next}, number_display = printf(?6, ${printfArgs}), made_on = ?7, snapshot = ?8, snapshot_sha256 = ?9,
         finalised_at = ?3, finalised_by = ?10, updated_at = max(?3, updated_at + 1)
       WHERE id = ?1 AND status = 'draft' AND updated_at = ?2
         AND ${next} <= ?11
         AND (SELECT version FROM settings WHERE key = 'numbering') IS ?12
         AND (SELECT version FROM settings WHERE key = 'company') IS ?13
         AND (SELECT updated_at FROM clients WHERE id = deeds.client_id) = ?14
         AND (SELECT count(*) FROM documents fd WHERE fd.project_id = deeds.project_id AND fd.frozen_at IS NOT NULL AND fd.type IN ${INVOICE_FAMILY_SQL}) = ?15
         AND (SELECT max(fd.updated_at) FROM documents fd WHERE fd.project_id = deeds.project_id AND fd.frozen_at IS NOT NULL AND fd.type IN ${INVOICE_FAMILY_SQL}) IS ?16
         AND ${clientLive("deeds")}
         AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = deeds.project_id AND pr.source_document_id = deeds.source_document_id AND ${eligible})
         AND ${sessionSql("?4", "?3", ["owner"], true)}
         AND EXISTS (SELECT 1 FROM staff_sessions fs WHERE fs.id = ?4 AND fs.user_id = ?10)
       RETURNING number_display, number`,
    )
    .bind(
      a.deedId,
      a.expectedUpdatedAt,
      a.now,
      a.sessionId,
      a.fy,
      a.pattern,
      a.madeOn,
      a.snapshotJson,
      a.snapshotSha256,
      a.memberId,
      a.maxNumber,
      a.numberingVersion,
      a.companyVersion,
      a.clientUpdatedAt,
      a.docs.n,
      a.docs.at,
    );
}

/** The counter take after a finalise, guarded on `g` (the audit row): the counter moves past the number the deed just took, and only then. */
export function deedCounterTakeStatement(
  db: D1Database,
  a: { deedId: string; fy: string },
  g: GuardSql,
): D1PreparedStatement {
  const gs = guarded(g, 2);
  return db
    .prepare(
      `UPDATE doc_counters SET next_no = next_no + 1 WHERE series = 'deed' AND fy = ?2
         AND EXISTS (SELECT 1 FROM deeds d WHERE d.id = ?1 AND d.status = 'final' AND d.fy = ?2 AND d.number = doc_counters.next_no)${gs.sql}`,
    )
    .bind(a.deedId, a.fy, ...gs.params);
}

/**
 * Upload the signed copy (L4, L5): the FINAL deed read at `expectedUpdatedAt` becomes `signed` with the DOCS key, SHA-256 and size of the PDF the route has
 * already written (write-once), the eSign timestamp and transaction ID the Owner typed, by an Owner with a fresh step-up, while the client is live. Binds `?1`..`?10`.
 */
export function signDeedStatement(
  db: D1Database,
  a: {
    deedId: string;
    expectedUpdatedAt: number;
    now: number;
    sessionId: string;
    memberId: string;
    r2Key: string;
    sha256: string;
    size: number;
    esignAt: number;
    esignTxn: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE deeds SET status = 'signed', signed_r2_key = ?6, signed_sha256 = ?7, signed_size = ?8, esign_at = ?9, esign_txn = ?10, signed_at = ?3, signed_by = ?5,
         updated_at = max(?3, updated_at + 1)
       WHERE id = ?1 AND status = 'final' AND updated_at = ?2 AND ${clientLive("deeds")} AND ${sessionSql("?4", "?3", ["owner"], true)}
         AND EXISTS (SELECT 1 FROM staff_sessions fs WHERE fs.id = ?4 AND fs.user_id = ?5)`,
    )
    .bind(
      a.deedId,
      a.expectedUpdatedAt,
      a.now,
      a.sessionId,
      a.memberId,
      a.r2Key,
      a.sha256,
      a.size,
      a.esignAt,
      a.esignTxn,
    );
}

/** Cancel a DRAFT deed read at `expectedUpdatedAt` (L4), by an Owner, with a reason. Binds `?1`..`?6`. */
export function cancelDeedStatement(
  db: D1Database,
  a: {
    deedId: string;
    expectedUpdatedAt: number;
    now: number;
    sessionId: string;
    memberId: string;
    reason: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE deeds SET status = 'cancelled', cancelled_at = ?3, cancelled_by = ?5, cancel_reason = ?6, updated_at = max(?3, updated_at + 1)
       WHERE id = ?1 AND status = 'draft' AND updated_at = ?2 AND ${sessionSql("?4", "?3", ["owner"], false)}
         AND EXISTS (SELECT 1 FROM staff_sessions fs WHERE fs.id = ?4 AND fs.user_id = ?5)`,
    )
    .bind(a.deedId, a.expectedUpdatedAt, a.now, a.sessionId, a.memberId, a.reason);
}

/**
 * L7: anonymising a client deletes its DRAFT and CANCELLED deeds (a cancelled one holds the Owner's typed reason; early check 5) through the trigger
 * `clients_anonymised_draft_deeds` (0062): no statement here. Final and signed stay.
 */

/** The columns every deed read takes. */
export const DEED_COLS =
  "d.id, d.client_id, d.project_id, d.source_document_id, d.status, d.fy, d.number, d.number_display, d.made_on, d.sched_deliverables, d.sched_location, d.sched_delivered_dates, d.sched_tools, d.sched_third_party, d.snapshot, d.snapshot_sha256, d.unsigned_r2_key, d.unsigned_sha256, d.signed_r2_key, d.signed_sha256, d.signed_size, d.esign_at, d.esign_txn, d.finalised_at, d.finalised_by, d.signed_at, d.signed_by, d.cancelled_at, d.cancelled_by, d.cancel_reason, d.created_at, d.updated_at";

export type DeedRow = {
  id: string;
  client_id: string;
  project_id: string;
  source_document_id: string;
  status: "draft" | "final" | "signed" | "cancelled";
  fy: string | null;
  number: number | null;
  number_display: string | null;
  made_on: string | null;
  sched_deliverables: string | null;
  sched_location: string | null;
  sched_delivered_dates: string | null;
  sched_tools: string | null;
  sched_third_party: string | null;
  snapshot: string | null;
  snapshot_sha256: string | null;
  unsigned_r2_key: string | null;
  unsigned_sha256: string | null;
  signed_r2_key: string | null;
  signed_sha256: string | null;
  signed_size: number | null;
  esign_at: number | null;
  esign_txn: string | null;
  finalised_at: number | null;
  finalised_by: string | null;
  signed_at: number | null;
  signed_by: string | null;
  cancelled_at: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: number;
  updated_at: number;
};

/** The row `deedFactsSql` returns. */
export type DeedFactsRow = {
  project_id: string;
  status: string;
  client_id: string;
  source_document_id: string | null;
  source_ok: number;
  accepted_currency: string | null;
  accepted_total: number | null;
  anonymised: number;
  care_plan: number;
  payables: number;
  unpaid: number;
  settled: number;
  credited: number;
  has_deed: number;
  has_open_deed: number;
};
