// Rebuild PDF (JOB-PDF-02; run file docs/runs/rebuild-pdf.md, L1, L2, L7, L12): two new append-only tables, CREATE TABLE only (nothing that exists is rebuilt).
//   - `pdf_repairs`: the Owner's request to re-create one stored PDF (the subject's ORIGINAL key, the key served when asked, what was found, the new key);
//   - `pdf_repair_results`: how that request ended, at most one row per request (its primary key), written by the jobs Worker (or the admin route when the
//     queue send failed). "In progress" is a request without a result.
// Two tables (L1): an append-only request plus an append-only result needs no UPDATE carve-out; idempotency comes from the result's primary key. The subject
// is polymorphic (no foreign key): the insert trigger of the `pdf_repair_triggers` set checks it exists in its kind's state and that every key follows the rule.
// Readers resolve the served key by the original key (`SERVED_PDF_SQL` in `src/pdf-repairs.ts`, on the partial index `pdf_repair_results_served`).
import { REPAIR_FOUND, REPAIR_KINDS, REPAIR_MAX, REPAIR_OUTCOMES } from "@techaust/core/pdf-repair";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  type SQLiteColumn,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { id, oneOf } from "./common.ts";
import { R2_KEY_MAX } from "./data-protection.ts";
import { staffUsers } from "./identity.ts";

const n = (v: number) => sql.raw(String(v));
/** An R2 key of the DOCS bucket: at most `R2_KEY_MAX` characters, under `docs/` (documents, certificates, receipts) or `deeds/` (unsigned deeds). */
const docsKey = (col: SQLiteColumn) =>
  sql`length(${col}) between 6 and ${n(R2_KEY_MAX)} and (substr(${col}, 1, 5) = 'docs/' or substr(${col}, 1, 6) = 'deeds/')`;
/** 64 lower-case hex characters (a SHA-256). */
const hex64 = (col: SQLiteColumn) => sql`length(${col}) = 64 and not ${col} glob '*[^0-9a-f]*'`;

export const pdfRepairs = sqliteTable(
  "pdf_repairs",
  {
    /** UUIDv7. */
    id: id(),
    subjectKind: text("subject_kind", { enum: REPAIR_KINDS }).notNull(),
    /** documents.id (offer, invoice, supplier, receipt), acceptances.id (certificate) or deeds.id (deed). No foreign key: the insert trigger checks it. */
    subjectId: text("subject_id").notNull(),
    /** 1 + the subject's highest `n` (trigger). The key suffix `-r<n>.pdf`. */
    n: integer("n").notNull(),
    /** The key the subject records (the stem of every `-r<n>` key). */
    originalKey: text("original_key").notNull(),
    /** The key served when the request was made: the newest rebuilt key, else the original (trigger). */
    oldKey: text("old_key").notNull(),
    /** The hash the served object should have had; null only for a supplier copy with no stored checksum. */
    oldSha256: text("old_sha256"),
    /** `missing` or `damaged`: why the rebuild was asked for. */
    found: text("found", { enum: REPAIR_FOUND }).notNull(),
    /** `<original stem>-r<n>.pdf` (trigger), written once by the rebuild. */
    newKey: text("new_key").notNull().unique("pdf_repairs_new_key"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => staffUsers.id),
    requestedAt: integer("requested_at").notNull(),
  },
  (t) => [
    uniqueIndex("pdf_repairs_subject_n").on(t.subjectKind, t.subjectId, t.n),
    // The FK-child index rule (0080, M7.5 L38): a staff member's delete checks its children through an index.
    index("pdf_repairs_requested_by").on(t.requestedBy),
    check("pdf_repairs_kind", oneOf(t.subjectKind, REPAIR_KINDS)),
    check("pdf_repairs_found", oneOf(t.found, REPAIR_FOUND)),
    check("pdf_repairs_n", sql`${t.n} between 1 and ${n(REPAIR_MAX)}`),
    check("pdf_repairs_subject_id", sql`length(${t.subjectId}) between 1 and 64`),
    check("pdf_repairs_original_key", docsKey(t.originalKey)),
    check("pdf_repairs_old_key", docsKey(t.oldKey)),
    check("pdf_repairs_new_key_shape", docsKey(t.newKey)),
    check("pdf_repairs_old_sha256", sql`${t.oldSha256} is null or (${hex64(t.oldSha256)})`),
  ],
);

export const pdfRepairResults = sqliteTable(
  "pdf_repair_results",
  {
    repairId: text("repair_id")
      .primaryKey()
      .references(() => pdfRepairs.id),
    /** Copied from the request (trigger): the readers' lookup needs no join. */
    originalKey: text("original_key").notNull(),
    n: integer("n").notNull(),
    outcome: text("outcome", { enum: REPAIR_OUTCOMES }).notNull(),
    /** Why it was not rebuilt (a refusal or skip code), or null. */
    code: text("code"),
    /** The rebuilt object (exactly when `rebuilt`). */
    newKey: text("new_key"),
    newSha256: text("new_sha256"),
    bytes: integer("bytes"),
    completedAt: integer("completed_at").notNull(),
  },
  (t) => [
    // The readers' lookup (`SERVED_PDF_SQL`: `outcome = 'rebuilt'` literally, so the planner may use it).
    index("pdf_repair_results_served").on(t.originalKey, t.n).where(sql`${t.outcome} = 'rebuilt'`),
    check("pdf_repair_results_outcome", oneOf(t.outcome, REPAIR_OUTCOMES)),
    check(
      "pdf_repair_results_code",
      sql`${t.code} is null or (${t.code} glob '[a-z_]*' and length(${t.code}) between 1 and 40)`,
    ),
    check(
      "pdf_repair_results_rebuilt",
      sql`(${t.outcome} = 'rebuilt') = (${t.newKey} is not null and ${t.newSha256} is not null)`,
    ),
    check("pdf_repair_results_new_key", sql`${t.newKey} is null or (${docsKey(t.newKey)})`),
    check("pdf_repair_results_new_sha256", sql`${t.newSha256} is null or (${hex64(t.newSha256)})`),
    check("pdf_repair_results_bytes", sql`${t.bytes} is null or ${t.bytes} >= 1`),
  ],
);
