// Reading one proposal or estimate with everything that belongs to it, in ONE D1 call (M4.3). The admin editor uses it, and M4.4 (PDF)
// and M4.5 (portal, accept) read through it. Subpath export (`@techaust/db/documents`) so a Worker importing it doesn't pull in the
// Drizzle schema. The JSON columns are parsed; everything else is the row as D1 returns it (snake_case).
import type { ComputedDocument } from "@techaust/core/tax";
import type { IssuerSnapshot, RecipientSnapshot } from "./schema/documents.ts";

export type DocumentRow = {
  id: string;
  type: string;
  status: string;
  client_id: string;
  version_group_id: string | null;
  version: number;
  series: string | null;
  fy: string | null;
  number: number | null;
  number_display: string | null;
  currency: string;
  issue_date: string | null;
  valid_until: string | null;
  supply_type: string | null;
  place_of_supply_code: string | null;
  subtotal_minor: number;
  discount_minor: number;
  taxable_minor: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  round_off_minor: number;
  total_minor: number;
  terms_version_id: string | null;
  snapshot_r2_key: string | null;
  snapshot_sha256: string | null;
  pdf_r2_key: string | null;
  pdf_sha256: string | null;
  frozen_at: number | null;
  issued_by: string | null;
  title: string | null;
  contact_id: string | null;
  validity_days: number | null;
  discount_kind: string | null;
  discount_value: number | null;
  export_mode: string | null;
  content_sha256: string | null;
  catalogue_reference_minor: number | null;
  source_document_id: string | null;
  source_step: number | null;
  sent_at: number | null;
  viewed_at: number | null;
  decided_at: number | null;
  decision_reason: string | null;
  decision_note: string | null;
  decided_contact_id: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  recipient: RecipientSnapshot | null;
  issuer: IssuerSnapshot | null;
  /** The sealed tax result of a SENT version. Always null for a draft (it is not parsed: a draft is worked out again from its parts). */
  computed: ComputedDocument | null;
};

export type LineRow = {
  id: string;
  position: number;
  catalogue_item_id: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qty_milli: number;
  unit: string;
  rate_minor: number;
  discount_kind: string | null;
  discount_value: number | null;
  taxable_minor: number;
  gst_rate_bp: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  line_total_minor: number;
  catalogue_rate_minor: number | null;
  /** The catalogue default line this line was made from (its name there), or null. Server-only. */
  catalogue_line: string | null;
};
export type SectionRow = {
  id: string;
  kind: string;
  position: number;
  hidden: number;
  title: string | null;
  body_md: string | null;
};
export type ScheduleRow = {
  id: string;
  position: number;
  label: string;
  trigger: string;
  pct_bp: number;
  amount_minor: number;
  detail: string | null;
  target_date: string | null;
};
export type VersionRow = {
  id: string;
  version: number;
  status: string;
  number_display: string | null;
  sent_at: number | null;
  frozen_at: number | null;
  valid_until: string | null;
  total_minor: number;
  updated_at: number;
};
/** A terms version without its text: what an admin route needs (the pin, shown as id, version and hash). */
export type TermsRef = { id: string; kind: string; version: number; sha256: string };
/** A terms version with its text (the PDF and the portal render it, M4.4 and M4.5). */
export type TermsRow = TermsRef & { body_md: string };
export type ApprovalRow = {
  id: string;
  kind: string;
  status: string;
  content_sha256: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: number | null;
  reason: string | null;
  note: string | null;
  created_at: number;
};

export type DocumentBundle<T extends TermsRef = TermsRow> = {
  document: DocumentRow;
  lines: LineRow[];
  sections: SectionRow[];
  schedule: ScheduleRow[];
  /** Every version of the document's group, oldest first. */
  versions: VersionRow[];
  /** The terms version the document is pinned to. */
  terms: T | null;
  /** The discount approvals of this version, newest first (at most 5). */
  approvals: ApprovalRow[];
};

const DOCUMENT_COLUMNS =
  "id, type, status, client_id, version_group_id, version, series, fy, number, number_display, currency, issue_date, valid_until, supply_type, place_of_supply_code, subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor, terms_version_id, snapshot_r2_key, snapshot_sha256, pdf_r2_key, pdf_sha256, frozen_at, issued_by, title, contact_id, validity_days, discount_kind, discount_value, export_mode, content_sha256, catalogue_reference_minor, source_document_id, source_step, sent_at, viewed_at, decided_at, decision_reason, decision_note, decided_contact_id, created_by, created_at, updated_at, recipient, issuer, computed";

/** The statements of `loadDocument`, exported so a test can EXPLAIN each one. */
export const LOAD_DOCUMENT_SQL = {
  document: `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?1`,
  lines:
    "SELECT id, position, catalogue_item_id, description, detail, sac, qty_milli, unit, rate_minor, discount_kind, discount_value, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor, catalogue_rate_minor, catalogue_line FROM document_lines WHERE document_id = ?1 ORDER BY position",
  sections:
    "SELECT id, kind, position, hidden, title, body_md FROM document_sections WHERE document_id = ?1 ORDER BY position",
  schedule:
    "SELECT id, position, label, trigger, pct_bp, amount_minor, detail, target_date FROM payment_schedules WHERE document_id = ?1 ORDER BY position",
  versions:
    "SELECT id, version, status, number_display, sent_at, frozen_at, valid_until, total_minor, updated_at FROM documents WHERE version_group_id = (SELECT version_group_id FROM documents WHERE id = ?1) ORDER BY version",
  terms:
    "SELECT id, kind, version, body_md, sha256 FROM terms_versions WHERE id = (SELECT terms_version_id FROM documents WHERE id = ?1)",
  /** The same row without the (up to 20 KB) text: the admin routes never need it. */
  termsRef:
    "SELECT id, kind, version, sha256 FROM terms_versions WHERE id = (SELECT terms_version_id FROM documents WHERE id = ?1)",
  approvals:
    "SELECT id, kind, status, content_sha256, requested_by, decided_by, decided_at, reason, note, created_at FROM approvals WHERE document_id = ?1 AND kind = 'discount' ORDER BY created_at DESC, id DESC LIMIT 5",
} as const;

type RawDocument = Omit<DocumentRow, "recipient" | "issuer" | "computed"> & {
  recipient: string | null;
  issuer: string | null;
  computed: string | null;
};
const parse = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

/** How many statements `loadStatements` gives (a caller that adds its own to the same batch reads the rest after them). */
export const LOAD_STATEMENTS = 7;

/**
 * The statements of `loadDocument`, for a caller that wants them in a batch of its own (one D1 call costs CPU on the Free plan).
 * `terms: "ref"` reads the terms row without its text (read the bundle with `bundleOf<TermsRef>`).
 */
export function loadStatements(
  db: D1Database,
  id: string,
  opts: { terms?: "full" | "ref" } = {},
): D1PreparedStatement[] {
  const q = LOAD_DOCUMENT_SQL;
  return [
    db.prepare(q.document).bind(id),
    db.prepare(q.lines).bind(id),
    db.prepare(q.sections).bind(id),
    db.prepare(q.schedule).bind(id),
    db.prepare(q.versions).bind(id),
    db.prepare(opts.terms === "ref" ? q.termsRef : q.terms).bind(id),
    db.prepare(q.approvals).bind(id),
  ];
}

/** The document with its lines, sections, schedule, the group's versions, its terms row and its approvals; null when there is no such id. */
export async function loadDocument(db: D1Database, id: string): Promise<DocumentBundle | null> {
  return bundleOf(await db.batch(loadStatements(db, id)));
}

/** The bundle from the results of `loadStatements` (the first seven results of a batch); null when the document does not exist. */
export function bundleOf<T extends TermsRef = TermsRow>(
  results: readonly D1Result[],
): DocumentBundle<T> | null {
  const [doc, lines, sections, schedule, versions, terms, approvals] = results;
  const raw = (doc?.results as RawDocument[] | undefined)?.[0];
  if (!raw) return null;
  return {
    document: {
      ...raw,
      recipient: parse<RecipientSnapshot>(raw.recipient),
      issuer: parse<IssuerSnapshot>(raw.issuer),
      // A draft's stored result is never parsed (60 KB of JSON at the cap): the route works the draft out again anyway.
      computed: raw.frozen_at === null ? null : parse<ComputedDocument>(raw.computed),
    },
    lines: (lines?.results ?? []) as LineRow[],
    sections: (sections?.results ?? []) as SectionRow[],
    schedule: (schedule?.results ?? []) as ScheduleRow[],
    versions: (versions?.results ?? []) as VersionRow[],
    terms: ((terms?.results ?? [])[0] as T | undefined) ?? null,
    approvals: (approvals?.results ?? []) as ApprovalRow[],
  };
}
