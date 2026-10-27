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
import { type InvoiceSnapshotInput, invoiceSnapshotSha256, noteOfFromStored } from "@techaust/core/invoices";
import { SCHEDULE_TRIGGERS } from "@techaust/core/schedule-text";
import type { ComputedDocument } from "@techaust/core/tax";
import type { InvoiceIssuerSnapshot, IssuerSnapshot, RecipientSnapshot } from "./schema/documents.ts";

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
  /** M5.1: an invoice's due date, its ledger columns, its void and its parent are read with the row (null or 0 on a quote). */
  due_date: string | null;
  parent_id: string | null;
  paid_minor: number;
  credited_minor: number;
  balance_minor: number;
  voided_at: number | null;
  void_reason: string | null;
  /** M5.2: the exchange rate of a USD invoice (INR micros per USD), its date and its source as printed; the day the service was completed; the pinned export-declaration block. */
  fx_rate_micros: number | null;
  fx_date: string | null;
  fx_source: string | null;
  service_completed_on: string | null;
  export_declaration_id: string | null;
  /** M5.2 (LD37): the JSON text of the sealed header keys the other columns cannot give (`{export?, proforma?, advance?}`), frozen at issue; null when none (read it with `headerExtrasOfRow`). */
  header_extras: string | null;
  /** M5.3: a credit note's IMS status (`pending`, `accepted`, `rejected`, `not_applicable`); null on every other document and on a draft. */
  ims_status?: string | null;
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
  issuer: IssuerSnapshot | InvoiceIssuerSnapshot | null;
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
/** A terms version whose text may be absent: NULL for a draft's read, the frozen text for a sent version's (the staff read view). */
export type TermsView = TermsRef & { body_md?: string | null };
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
  /** The staff names behind the ids (the admin's "Approved by {person}"); null for a removed member. */
  requested_by_name?: string | null;
  decided_by_name?: string | null;
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
  "id, type, status, client_id, version_group_id, version, series, fy, number, number_display, currency, issue_date, due_date, parent_id, paid_minor, credited_minor, balance_minor, voided_at, void_reason, fx_rate_micros, fx_date, fx_source, service_completed_on, export_declaration_id, header_extras, ims_status, valid_until, supply_type, place_of_supply_code, subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor, terms_version_id, snapshot_r2_key, snapshot_sha256, pdf_r2_key, pdf_sha256, frozen_at, issued_by, title, contact_id, validity_days, discount_kind, discount_value, export_mode, content_sha256, catalogue_reference_minor, source_document_id, source_step, sent_at, viewed_at, decided_at, decision_reason, decision_note, decided_contact_id, created_by, created_at, updated_at, recipient, issuer, computed";

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
  /** The text only for a frozen (sent) version: a draft's read never carries the (up to 20 KB) text. */
  termsFrozen:
    "SELECT id, kind, version, CASE WHEN (SELECT frozen_at FROM documents WHERE id = ?1) IS NOT NULL THEN body_md END AS body_md, sha256 FROM terms_versions WHERE id = (SELECT terms_version_id FROM documents WHERE id = ?1)",
  approvals:
    "SELECT a.id, a.kind, a.status, a.content_sha256, a.requested_by, a.decided_by, a.decided_at, a.reason, a.note, a.created_at, (SELECT u.name FROM staff_users u WHERE u.id = a.requested_by) AS requested_by_name, (SELECT u.name FROM staff_users u WHERE u.id = a.decided_by) AS decided_by_name FROM approvals a WHERE a.document_id = ?1 AND a.kind = 'discount' ORDER BY a.created_at DESC, a.id DESC LIMIT 5",
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
 * `terms: "ref"` reads the terms row without its text (read the bundle with `bundleOf<TermsRef>`); `"frozen"` reads the text only when the
 * document is a frozen (sent) version, else `body_md` is NULL (read it with `bundleOf<TermsView>`).
 */
export function loadStatements(
  db: D1Database,
  id: string,
  opts: { terms?: "full" | "ref" | "frozen" } = {},
): D1PreparedStatement[] {
  const q = LOAD_DOCUMENT_SQL;
  return [
    db.prepare(q.document).bind(id),
    db.prepare(q.lines).bind(id),
    db.prepare(q.sections).bind(id),
    db.prepare(q.schedule).bind(id),
    db.prepare(q.versions).bind(id),
    db
      .prepare(opts.terms === "ref" ? q.termsRef : opts.terms === "frozen" ? q.termsFrozen : q.terms)
      .bind(id),
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

// ---- sealing and verifying an issued invoice (M5.1, LD4; the jobs Worker's envelope verifies with these, stage B) -------------------------------

/** Everything the seal of an issued invoice is made from. The issue route fills it from the draft it just worked out; a verifier fills it from the rows. */
export type InvoiceSealParts = {
  readonly document: InvoiceSnapshotInput["document"];
  readonly computed: ComputedDocument;
  readonly recipient: RecipientSnapshot;
  readonly issuer: InvoiceIssuerSnapshot;
} & InvoiceHeaderExtras;

/**
 * The header keys M5.2 added (LD25), each present ONLY on the types that need it: `export` (an export invoice), `fx` (every USD tax or export
 * invoice), `proforma` (a proforma), `advance` (the invoice made for money received). Absent is not null: an M5.1 seal has none and keeps its hash.
 */
export type InvoiceHeaderExtras = {
  readonly export?: InvoiceSnapshotInput["export"];
  readonly fx?: InvoiceSnapshotInput["fx"];
  readonly proforma?: InvoiceSnapshotInput["proforma"];
  readonly advance?: InvoiceSnapshotInput["advance"];
  /** M5.3 (LD39): a credit or debit note's request, reason and parent facts, only on a note. */
  readonly noteOf?: InvoiceSnapshotInput["noteOf"];
};

export type InvoiceSeal = {
  /** The exact text written to `documents.computed`. */
  computedJson: string;
  computedSha256: string;
  input: InvoiceSnapshotInput;
  /** `documents.snapshot_sha256`: the hash of the canonical `{v: 3, kind: "invoice", header}` (core `invoiceSnapshot`). */
  snapshotSha256: string;
};

/** The one place an invoice's snapshot input and its hash are made: the issue route calls it before the freeze, a verifier after. */
export async function invoiceSealOf(p: InvoiceSealParts): Promise<InvoiceSeal> {
  const computedJson = JSON.stringify(p.computed);
  const computedSha256 = await sha256Hex(computedJson);
  const input: InvoiceSnapshotInput = {
    document: p.document,
    supply: p.computed.supply,
    recipient: p.recipient,
    issuer: p.issuer,
    computedSha256,
    // Each extra only when given (a key with the value `undefined` must not reach the canonical text).
    ...(p.export ? { export: p.export } : {}),
    ...(p.fx ? { fx: p.fx } : {}),
    ...(p.proforma ? { proforma: p.proforma } : {}),
    ...(p.advance ? { advance: p.advance } : {}),
    // M5.3: only on a note (a key that is absent keeps every earlier seal byte for byte).
    ...(p.noteOf ? { noteOf: p.noteOf } : {}),
  };
  return { computedJson, computedSha256, input, snapshotSha256: await invoiceSnapshotSha256(input) };
}

/**
 * The editable content of a loaded invoice (any invoice-family type), as `contentHash` takes it: the rows of a draft or of an issued invoice
 * hash to the `content_sha256` the draft was saved with. An invoice has no title, validity, sections or schedule, and its terms are pinned at
 * issue (not part of the draft), so those parts are fixed here; the discount and the lines are the draft's.
 */
export function invoiceDraftOfBundle(b: DocumentBundle<TermsRef>): DraftContent {
  const d = b.document;
  return {
    type: d.type,
    clientId: d.client_id,
    contactId: d.contact_id,
    title: null,
    currency: d.currency === "USD" ? "USD" : "INR",
    validityDays: null,
    termsVersionId: null,
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
    sections: [],
    schedule: [],
    // M5.2: the rate typed on the draft, hashed with it (a document without one has no `fx` key in its hash).
    fx: fxOfRow(d),
    // M5.3: a note's request, read from its `header_extras` (a draft's draft form, an issued note's frozen one: the same object); none on any other type.
    note: noteContentOf(d),
  };
}

/** The part of a note's `noteOf` the content hash covers (null for any document that is not a note, or whose `noteOf` is unreadable). */
export function noteContentOf(d: Pick<DocumentRow, "type" | "header_extras">): DraftContent["note"] {
  if (d.type !== "credit_note" && d.type !== "debit_note") return null;
  const n = headerExtrasOfRow(d).noteOf;
  return n
    ? {
        parentId: n.parent.id,
        kind: n.kind,
        reasonCode: n.reason.code,
        reasonText: n.reason.text,
        mode: n.request.mode,
        takes: n.request.takes,
      }
    : null;
}

/**
 * The exchange rate stored on a row (`fx_*` columns), or null. A row read before M5.2, or built by a test without the columns, has none of them:
 * absent is the same as null (the hash then has no `fx` key and an M5.1 seal stays byte-identical).
 */
export function fxOfRow(
  d: Pick<DocumentRow, "fx_rate_micros" | "fx_date" | "fx_source">,
): { rateMicros: number; date: string; source: string } | null {
  return typeof d.fx_rate_micros === "number" &&
    typeof d.fx_date === "string" &&
    typeof d.fx_source === "string"
    ? { rateMicros: d.fx_rate_micros, date: d.fx_date, source: d.fx_source }
    : null;
}

/** The content hash of a loaded ISSUED invoice, worked out again from its rows and its stored `computed` (compare with `content_sha256`). */
export function invoiceContentHashOfBundle(b: DocumentBundle<TermsRef>): Promise<string> | null {
  return b.document.computed ? contentHash(invoiceDraftOfBundle(b), b.document.computed) : null;
}

/** What the freeze writes to `documents.header_extras`: the JSON of exactly the keys given, or null when there are none (an M5.1 tax invoice). */
export function headerExtrasJson(
  x: Pick<InvoiceHeaderExtras, "export" | "proforma" | "advance" | "noteOf">,
): string | null {
  const out: Pick<InvoiceHeaderExtras, "export" | "proforma" | "advance" | "noteOf"> = {
    ...(x.export ? { export: x.export } : {}),
    ...(x.proforma ? { proforma: x.proforma } : {}),
    ...(x.advance ? { advance: x.advance } : {}),
    ...(x.noteOf ? { noteOf: x.noteOf } : {}),
  };
  return Object.keys(out).length === 0 ? null : JSON.stringify(out);
}

/**
 * The frozen header extras of a row (LD37): the `{export?, proforma?, advance?}` the seal was made with, read back from `header_extras`. Null or an
 * unreadable text gives none (a seal check then fails, which is the right answer for damaged data). `fx` is never here: it comes from the `fx_*` columns.
 */
export function headerExtrasOfRow(d: Pick<DocumentRow, "header_extras">): InvoiceHeaderExtras {
  const text = d.header_extras;
  if (typeof text !== "string") return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  return {
    ...(o.export ? { export: o.export as NonNullable<InvoiceHeaderExtras["export"]> } : {}),
    ...(o.proforma ? { proforma: o.proforma as NonNullable<InvoiceHeaderExtras["proforma"]> } : {}),
    ...(o.advance ? { advance: o.advance as NonNullable<InvoiceHeaderExtras["advance"]> } : {}),
    // M5.3: read back through the zod-free reader (a malformed `noteOf` gives none, so a seal check fails: the right answer for damaged data).
    ...(o.noteOf ? noteOfPart(o.noteOf) : {}),
  };
}

function noteOfPart(v: unknown): Pick<InvoiceHeaderExtras, "noteOf"> {
  const n = noteOfFromStored(v);
  return n ? { noteOf: n } : {};
}

/**
 * The seal parts of a loaded ISSUED invoice, from its frozen columns; null when it is not frozen or lacks a frozen block. The M5.2 header keys that
 * the other columns cannot give (the endorsement, the LUT letter, the country name, the notice, the advance reference) are read from the frozen
 * `header_extras` (LD37: NULL gives none, so an M5.1 seal keeps its hash); the exchange rate is read from the row's own `fx_*` columns.
 */
export function invoiceSealPartsOfBundle(b: DocumentBundle<TermsRef>): InvoiceSealParts | null {
  const d = b.document;
  const extras = headerExtrasOfRow(d);
  if (d.frozen_at === null) return null;
  const { computed, recipient, issuer } = d;
  // A credit note has no due date (M5.3: nothing is owed on it); every other invoice-family document has one.
  if (!computed || !recipient || !issuer || !d.issue_date || !d.content_sha256) return null;
  if (!d.due_date && d.type !== "credit_note") return null;
  const t = b.terms;
  return {
    document: {
      type: d.type,
      clientId: d.client_id,
      currency: d.currency,
      issueDate: d.issue_date,
      dueDate: d.due_date ?? null,
      contentSha256: d.content_sha256,
      termsRef: t ? { id: t.id, version: t.version, sha256: t.sha256 } : null,
      exportMode: d.export_mode,
    },
    computed,
    recipient,
    issuer: issuer as InvoiceIssuerSnapshot,
    ...(extras.export ? { export: extras.export } : {}),
    ...(extras.proforma ? { proforma: extras.proforma } : {}),
    ...(extras.advance ? { advance: extras.advance } : {}),
    ...(extras.noteOf ? { noteOf: extras.noteOf } : {}),
    ...(fxOfRow(d) && d.type !== "proforma"
      ? { fx: fxOfRow(d) as NonNullable<ReturnType<typeof fxOfRow>> }
      : {}),
  };
}

/** Checks a loaded issued invoice against the hashes it was sealed with. Null when the bundle is not an issued invoice. */
export async function verifyInvoiceSealed(b: DocumentBundle<TermsRef>): Promise<SealCheck | null> {
  const parts = invoiceSealPartsOfBundle(b);
  const content = invoiceContentHashOfBundle(b);
  if (!parts || !content) return null;
  const seal = await invoiceSealOf(parts);
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
