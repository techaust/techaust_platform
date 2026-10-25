// Reading one proposal or estimate with everything that belongs to it, in ONE D1 call (M4.3). The admin editor uses it, and M4.4 (PDF)
// and M4.5 (portal, accept) read through it. Subpath export (`@techaust/db/documents`) so a Worker importing it doesn't pull in the
// Drizzle schema. The JSON columns are parsed; everything else is the row as D1 returns it (snake_case).
import { daysBetween, parseIsoDate } from "@techaust/core/dates";
import {
  contentHash,
  type DraftContent,
  isQuoteType,
  type SnapshotInput,
  snapshotSha256,
} from "@techaust/core/documents";
import { sha256Hex } from "@techaust/core/hash";
import { SCHEDULE_TRIGGERS } from "@techaust/core/schedule-text";
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

// ---- sealing and verifying a sent version (M4.3; the formats are stored contracts: M4.4's jobs consumer and M4.5 verify with these) ----------

/** Everything the seal of a sent version is made from. The send route fills it from the draft it just worked out; a verifier fills it from the rows. */
export type SealParts = {
  readonly document: SnapshotInput["document"];
  /** The tax result that is stored (as the exact text `computedJson`) in `documents.computed`. */
  readonly computed: ComputedDocument;
  readonly recipient: RecipientSnapshot;
  readonly issuer: IssuerSnapshot;
  readonly terms: { readonly id: string; readonly version: number; readonly sha256: string };
  /** The amount of each payment step, in order. */
  readonly instalmentAmounts: readonly number[];
};

export type Seal = {
  /** The exact text written to `documents.computed`. */
  computedJson: string;
  computedSha256: string;
  input: SnapshotInput;
  /** `documents.snapshot_sha256`: the hash of the canonical `{v: 2, header}` (core `documentSnapshot`). */
  snapshotSha256: string;
};

/** The one place the snapshot input and its hash are made: the send route calls it before the freeze, a verifier after. */
export async function sealOf(p: SealParts): Promise<Seal> {
  const computedJson = JSON.stringify(p.computed);
  const computedSha256 = await sha256Hex(computedJson);
  const input: SnapshotInput = {
    document: p.document,
    supply: p.computed.supply,
    recipient: p.recipient,
    issuer: p.issuer,
    terms: p.terms,
    instalmentAmounts: p.instalmentAmounts,
    computedSha256,
  };
  return { computedJson, computedSha256, input, snapshotSha256: await snapshotSha256(input) };
}

const kindOf = (v: string | null): "fixed" | "percent" | null =>
  v === "fixed" || v === "percent" ? v : null;

/**
 * The editable content of a loaded document, as `contentHash` takes it: the same mapping the admin's editor state makes
 * (`stateOfBundle` then `draftContentOf`), so a frozen row hashes to the `content_sha256` it was sent with. Null for any type but
 * a proposal or an estimate.
 */
export function draftContentOfBundle(b: DocumentBundle<TermsRef>): DraftContent | null {
  const d = b.document;
  if (!isQuoteType(d.type)) return null;
  return {
    type: d.type,
    clientId: d.client_id,
    contactId: d.contact_id,
    title: d.title,
    currency: d.currency === "USD" ? "USD" : "INR",
    validityDays: d.validity_days,
    termsVersionId: d.terms_version_id,
    discountKind: kindOf(d.discount_kind),
    discountValue: d.discount_value,
    exportMode: d.export_mode,
    lines: b.lines.map((r) => ({
      catalogueItemId: r.catalogue_item_id,
      description: r.description,
      detail: r.detail,
      sac: r.sac,
      qtyMilli: r.qty_milli,
      unit: r.unit,
      rateMinor: r.rate_minor,
      discountKind: kindOf(r.discount_kind),
      discountValue: r.discount_value,
      gstRateBp: r.gst_rate_bp,
      catalogueRateMinor: r.catalogue_rate_minor,
      catalogueLine: r.catalogue_line,
    })),
    sections: b.sections.map((r) => ({
      kind: r.kind,
      title: r.title,
      bodyMd: r.body_md,
      hidden: r.hidden === 1,
    })),
    schedule: b.schedule.map((r) => ({
      label: r.label,
      trigger: SCHEDULE_TRIGGERS.find((t) => t === r.trigger) ?? "on_accept",
      pctBp: r.pct_bp,
      detail: r.detail,
      targetDate: r.target_date,
    })),
  };
}

/** The content hash of a loaded SENT version, worked out again from its rows and its stored `computed` (compare with `content_sha256`). */
export function contentHashOfBundle(b: DocumentBundle<TermsRef>): Promise<string> | null {
  const draft = draftContentOfBundle(b);
  return draft && b.document.computed ? contentHash(draft, b.document.computed) : null;
}

/**
 * The seal parts of a loaded SENT proposal or estimate, from its frozen columns: null when it is not one, not sent, or lacks a frozen
 * block. The validity in days is the distance from the issue date to the last valid day (the send wrote `valid_until` as the issue
 * date plus the effective validity), so it holds even where the document's own `validity_days` was left empty.
 */
export function sealPartsOfBundle(b: DocumentBundle<TermsRef>): SealParts | null {
  const d = b.document;
  if (!isQuoteType(d.type) || d.frozen_at === null) return null;
  const { computed, recipient, issuer } = d;
  const terms = b.terms;
  if (!computed || !recipient || !issuer || !terms) return null;
  if (!d.issue_date || !d.valid_until || !d.content_sha256 || !d.version_group_id) return null;
  const from = parseIsoDate(d.issue_date);
  const to = parseIsoDate(d.valid_until);
  if (!from || !to) return null;
  return {
    document: {
      type: d.type,
      clientId: d.client_id,
      versionGroupId: d.version_group_id,
      version: d.version,
      currency: d.currency,
      title: d.title,
      issueDate: d.issue_date,
      validUntil: d.valid_until,
      validityDays: daysBetween(from, to),
      contentSha256: d.content_sha256,
      discountKind: kindOf(d.discount_kind),
      discountValue: d.discount_value,
      exportMode: d.export_mode,
    },
    computed,
    recipient,
    issuer,
    terms: { id: terms.id, version: terms.version, sha256: terms.sha256 },
    instalmentAmounts: b.schedule.map((r) => r.amount_minor),
  };
}

export type SealCheck = {
  /** The content hash worked out from the rows equals `content_sha256`. */
  content: boolean;
  /**
   * The snapshot hash worked out from the rows equals `snapshot_sha256`. The header holds the hash of the stored `computed` text, and the
   * parsed result is written out again (`JSON.stringify` of what `JSON.stringify` wrote is the same text), so this also proves `computed`.
   */
  snapshot: boolean;
};

/**
 * Checks a loaded sent version against the hashes it was sealed with, using the send route's own functions. Null when the bundle is
 * not a sent proposal or estimate. A caller that needs more (the PDF's SHA-256 of the snapshot copy) compares `snapshotSha256` itself.
 */
export async function verifySealed(b: DocumentBundle<TermsRef>): Promise<SealCheck | null> {
  const parts = sealPartsOfBundle(b);
  const content = contentHashOfBundle(b);
  if (!parts || !content) return null;
  const seal = await sealOf(parts);
  return {
    content: (await content) === b.document.content_sha256,
    snapshot: seal.snapshotSha256 === b.document.snapshot_sha256,
  };
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
