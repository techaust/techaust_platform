// Credit and debit notes: the model the routes share (M5.3; ADM-INV-11, ADM-INV-01; LD38..LD54; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22) for every rule): what is read about the invoice a
// note is against, how a request becomes takes and a computed document, the draft's state and hash, the deadline, and the error lines. No route is here
// (`invoice-notes.ts` makes the draft and answers the IMS route; `invoice-issue.ts` issues through `prepareNoteIssue`), and nothing here trusts a draft: every
// figure is worked out again from the frozen invoice, the credit notes issued so far (summed by SQL) and the stored takes.
import { type CalendarDate, fyOf, istDate } from "@techaust/core/dates";
import { contentHash } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import {
  CREDIT_REASONS,
  type CreditDeadline,
  creditAllowed,
  creditedSoFarOf,
  creditForGross,
  creditNoteDeadline,
  DEBIT_REASONS,
  debitNoteInput,
  isLiveParentStatus,
  isNoteType,
  lutForFy,
  NOTES_MAX,
  type NoteBlocker,
  type NoteKind,
  type NoteOf,
  type NoteParentFacts,
  type NoteRequest,
  type NoteTake,
  type NoteType,
  noteBlockers,
  noteKindOf,
} from "@techaust/core/invoices";
import { formatMoney, money } from "@techaust/core/money";
import {
  type ComputedDocument,
  type CreditedSoFar,
  computeDocument,
  creditNote,
  type TaxContext,
  type TaxIssue,
  taxOnlyDebitNote,
} from "@techaust/core/tax";
import {
  headerExtrasJson,
  headerExtrasOfRow,
  type InvoiceHeaderExtras,
  noteContentOf,
} from "@techaust/db/documents";
import type { RecipientSnapshot } from "@techaust/db/issue";
import { CREDITED_SO_FAR_SQL, CREDITED_TOTALS_SQL, NOTE_COUNTS_SQL } from "@techaust/db/issue";
import type { ApiError } from "./context.ts";
import {
  type BankRow,
  type FxState,
  type InvoiceComputation,
  type InvoiceSettings,
  type InvoiceState,
  invoiceDraftOf,
} from "./invoice-model.ts";
import type { ClientRow, LineState } from "./quote-model.ts";

// ---- errors (07-T §7, §8 and §9) ----------------------------------------------------------------------------------------------------------------------------

const e = (code: string, message: string): ApiError => ({ code, message });
export const PARENT_NOT_ISSUED = e(
  "parent_not_issued",
  "Notes can only be issued against an issued invoice.",
);
export const PARENT_VOID = e("parent_void", "This invoice is void, so no note can be issued against it.");
export const PARENT_FULLY_CREDITED = e(
  "parent_fully_credited",
  "This invoice has already been credited in full.",
);
/** A debit note on an invoice that is credited in full (07-T §9). */
export const DEBIT_PARENT_FULLY_CREDITED = e(
  "debit_parent_fully_credited",
  "This invoice has been credited in full, so a debit note can't be issued against it. Issue a new invoice instead.",
);
/** 07-T §9 (Q35, owner 2026-10-28): the taxable value of a "Tax charged too low" debit note is zero; only the tax to add is entered. */
export const DEBIT_TAX_ONLY_INVALID = e(
  "debit_tax_only_invalid",
  'Enter tax only: the taxable value of a "Tax charged too low" note is zero.',
);
/** The `details.reason` of `debit_tax_only_invalid` when the tax to add is odd on an intra-state invoice (CGST and SGST are equal halves); the screen shows 07-W 5.9's line. */
export const ODD_AMOUNT = "odd_amount";
/** 07-T §9 (Researched 2026-10-28, 08-C RA-02): a credit note for a discount after sale may be dated from 1 November 2026. */
export const DISCOUNT_REASON_NOT_IN_FORCE = e(
  "discount_reason_not_in_force",
  "A credit note for a discount after sale can be dated from 1 November 2026.",
);
export const CREDIT_DEADLINE_PASSED = e(
  "credit_deadline_passed",
  "The deadline for a credit note on this invoice has passed.",
);
/** 07-T §7: "That's more than can still be credited on this invoice ({remaining})." */
export const creditExceedsRemaining = (remainingMinor: number, currency: "INR" | "USD"): ApiError =>
  e(
    "credit_exceeds_remaining",
    `That's more than can still be credited on this invoice (${formatMoney(money(remainingMinor, currency))}).`,
  );
/** 07-T §7: "Line {n} can only be credited up to {remaining}." (`n` counts from 1, as the invoice prints it). */
export const lineCreditExceeds = (n: number, remainingMinor: number, currency: "INR" | "USD"): ApiError =>
  e(
    "line_credit_exceeds",
    `Line ${n} can only be credited up to ${formatMoney(money(remainingMinor, currency))}.`,
  );
const currencyOf = (p: ParentCtx): "INR" | "USD" => (p.computed.currency === "USD" ? "USD" : "INR");
export const NOTHING_TO_CREDIT = e("nothing_to_credit", "Choose at least one line or an amount above zero.");
export const NOTE_REASON_REQUIRED = e("note_reason_required", "Enter a reason.");
/** 07-T §8: "There's already a draft {credit/debit} note for this invoice. Open it to continue." */
export const noteDraftExists = (kind: NoteKind): ApiError =>
  e("note_draft_exists", `There's already a draft ${kind} note for this invoice. Open it to continue.`);
/** 07-T §8: "This invoice already has 20 {credit/debit} notes, the most it can have." */
export const notesLimit = (kind: NoteKind): ApiError =>
  e("notes_limit", `This invoice already has ${NOTES_MAX} ${kind} notes, the most it can have.`);
export const PARENT_CHANGED = e(
  "parent_changed",
  "Another credit or debit note was issued on this invoice a moment ago. Open it again to see what's left.",
);
export const NOTE_LINES_DERIVED = e(
  "note_lines_derived",
  "A note's lines come from its invoice and can't be edited directly.",
);
export const NOTE_NOT_VOIDABLE = e(
  "note_not_voidable",
  "Credit and debit notes can't be voided. Correct a credit note with a debit note, or a debit note with a credit note.",
);
export const IMS_NOT_PENDING = e("ims_not_pending", "The client's IMS response is already recorded.");
export const IMS_NOT_APPLICABLE = e(
  "ims_not_applicable",
  "IMS status only applies to credit notes for GST-registered clients.",
);
/** 07-T §8: "Because of rounding, the nearest amount this credit note can be is {closest}. Use that amount instead?" (the button "Use {closest}" is the screen's).
 * With no closest amount (below one rounding unit): 07-T §9 (batch Q66). */
export const creditAmountUnfit = (closestMinor: number | null, currency: "INR" | "USD"): ApiError =>
  e(
    "credit_amount_unfit",
    closestMinor === null
      ? "This amount is too small to credit after rounding. Enter a larger amount."
      : `Because of rounding, the nearest amount this credit note can be is ${formatMoney(money(closestMinor, currency))}. Use that amount instead?`,
  );
export const CREDIT_DATA_DAMAGED = e(
  "credit_shape_mismatch",
  "This credit note doesn't match its invoice any more. Start again from the invoice.",
);
// In note-consts.ts (M6.1 stage A), so Settings in the admin API Worker can use it without this module.
export { ANNUAL_RETURN_FUTURE } from "./note-consts.ts";

// ---- what is read about the invoice a note is against -------------------------------------------------------------------------------------------

const NOTES_SQL = "'credit_note', 'debit_note'";
const PARENT_COLS =
  "id, type, status, client_id, project_id, currency, fy, number_display, issue_date, supply_type, place_of_supply_code, export_mode, fx_rate_micros, fx_date, fx_source, fx_no_rate_day, total_minor, total_inr_minor, paid_minor, credited_minor, balance_minor, updated_at, service_completed_on, header_extras, frozen_at, computed, recipient";
const PARENT_LINE_COLS = "position, description, detail, sac, unit, gst_rate_bp";

export type ParentRow = {
  id: string;
  type: string;
  status: string;
  client_id: string;
  project_id: string | null;
  currency: string;
  fy: string | null;
  number_display: string | null;
  issue_date: string | null;
  supply_type: string | null;
  place_of_supply_code: string | null;
  export_mode: string | null;
  fx_rate_micros: number | null;
  fx_date: string | null;
  fx_source: string | null;
  /** The day (ISO) the parent's no-rate statement covers (Q24); null when none. */
  fx_no_rate_day: string | null;
  total_minor: number;
  total_inr_minor: number | null;
  paid_minor: number;
  credited_minor: number;
  balance_minor: number;
  updated_at: number;
  service_completed_on: string | null;
  header_extras: string | null;
  frozen_at: number | null;
  computed: string | null;
  recipient: string | null;
};
export type ParentLine = {
  position: number;
  description: string;
  detail: string | null;
  sac: string | null;
  unit: string;
  gst_rate_bp: number;
};

/** Keyed by the PARENT's id (`?1`): the invoice a draft is made for. */
export const PARENT_READS = {
  parent: `SELECT ${PARENT_COLS} FROM documents WHERE id = ?1`,
  lines: `SELECT ${PARENT_LINE_COLS} FROM document_lines WHERE document_id = ?1 ORDER BY position`,
  creditedLines: CREDITED_SO_FAR_SQL,
  creditedTotals: CREDITED_TOTALS_SQL,
  counts: NOTE_COUNTS_SQL,
  drafts: `SELECT id, type FROM documents WHERE parent_id = ?1 AND frozen_at IS NULL AND type IN (${NOTES_SQL})`,
  client: "SELECT id FROM clients WHERE id = (SELECT client_id FROM documents WHERE id = ?1)",
} as const;

const OF_NOTE = `(SELECT parent_id FROM documents WHERE id = ?1 AND type IN (${NOTES_SQL}))`;
/** The same reads, keyed by the NOTE's id (`?1`): the issue and a save read the parent of a draft they were handed. Nothing matches for any other type. */
export const NOTE_PARENT_READS = {
  parent: `SELECT ${PARENT_COLS} FROM documents WHERE id = ${OF_NOTE}`,
  lines: `SELECT ${PARENT_LINE_COLS} FROM document_lines WHERE document_id = ${OF_NOTE} ORDER BY position`,
  creditedLines: CREDITED_SO_FAR_SQL.replaceAll("c.parent_id = ?1", `c.parent_id = ${OF_NOTE}`),
  creditedTotals: CREDITED_TOTALS_SQL.replaceAll("c.parent_id = ?1", `c.parent_id = ${OF_NOTE}`),
  counts: NOTE_COUNTS_SQL.replaceAll("c.parent_id = ?1", `c.parent_id = ${OF_NOTE}`),
  drafts: `SELECT id, type FROM documents WHERE parent_id = ${OF_NOTE} AND frozen_at IS NULL AND type IN (${NOTES_SQL})`,
} as const;

/** The statements of `reads`, in the order `parentCtxOf` takes their results. `id` is bound once to each. */
export function parentStatements(
  db: D1Database,
  reads: typeof PARENT_READS | typeof NOTE_PARENT_READS,
  id: string,
): D1PreparedStatement[] {
  return [
    reads.parent,
    reads.lines,
    reads.creditedLines,
    reads.creditedTotals,
    reads.counts,
    reads.drafts,
  ].map((sql) => db.prepare(sql).bind(id));
}
export const PARENT_STATEMENTS = 6;

export type ParentCtx = {
  row: ParentRow;
  computed: ComputedDocument;
  recipient: RecipientSnapshot;
  /** The GST status frozen in the invoice's recipient (every invoice writes it; a snapshot without it is damaged and gives no context). */
  recipientStatus: "registered" | "unregistered" | "overseas";
  extras: InvoiceHeaderExtras;
  lines: ParentLine[];
  /** What the issued credit notes took (null: the stored figures are damaged). */
  credited: CreditedSoFar | null;
  issued: { credit: number; debit: number };
  drafts: { credit: string | null; debit: string | null };
};

const safeParse = <T>(text: string | null): T | null => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** The parent context from the results of `parentStatements` (null: there is no such invoice, or it is not a frozen document of the invoice family). */
export function parentCtxOf(results: readonly D1Result[]): ParentCtx | null {
  const [parentR, linesR, creditedR, totalsR, countsR, draftsR] = results;
  const row = parentR?.results[0] as ParentRow | undefined;
  if (!row) return null;
  const computed = safeParse<ComputedDocument>(row.computed);
  const recipient = safeParse<RecipientSnapshot>(row.recipient);
  if (!computed || !recipient?.gstStatus) return null;
  const totals = (totalsR?.results[0] ?? { total: 0, totalInr: 0, count: 0 }) as {
    total: number;
    totalInr: number;
    count: number;
  };
  const counts = (countsR?.results ?? []) as { type: string; count: number }[];
  const drafts = (draftsR?.results ?? []) as { id: string; type: string }[];
  return {
    row,
    computed,
    recipient,
    recipientStatus: recipient.gstStatus,
    extras: headerExtrasOfRow(row),
    lines: (linesR?.results ?? []) as ParentLine[],
    credited: creditedSoFarOf(computed, (creditedR?.results ?? []) as never, totals),
    issued: {
      credit: counts.find((c) => c.type === "credit_note")?.count ?? 0,
      debit: counts.find((c) => c.type === "debit_note")?.count ?? 0,
    },
    drafts: {
      credit: drafts.find((d) => d.type === "credit_note")?.id ?? null,
      debit: drafts.find((d) => d.type === "debit_note")?.id ?? null,
    },
  };
}

/** The facts of the invoice a note freezes (LD53, M5.5's `NoteParent` plus id, type, fy and the total). */
export function parentFacts(p: ParentCtx): NoteParentFacts {
  const lut = p.extras.export?.lut;
  return {
    id: p.row.id,
    type: p.row.type === "export_invoice" ? "export_invoice" : "tax_invoice",
    fy: p.row.fy ?? "",
    number: p.row.number_display ?? "",
    issueDate: p.row.issue_date ?? "",
    supplyType: p.computed.supply.type,
    recipientStatus: p.recipientStatus,
    placeOfSupplyCode: p.computed.supply.placeOfSupplyCode,
    totalMinor: p.computed.totalMinor,
    totalInrMinor:
      p.computed.currency === "INR" ? p.computed.totalMinor : (p.computed.inr?.totalMinor ?? null),
    ...(lut ? { lut: { fy: lut.fy, arn: lut.arn } } : {}),
  };
}

/** The invoice types a note can be against, and the statuses they can be in. */
export const isNoteParentType = (t: string) => t === "tax_invoice" || t === "export_invoice";
export { isLiveParentStatus };

/** What is left of the invoice: the total, and the taxable value per computed line (by position in `computed.lines`). */
export function leftOf(p: ParentCtx): { totalLeft: number; taxableLeft: number[] } | null {
  if (!p.credited) return null;
  const credited = p.credited;
  return {
    totalLeft: p.computed.totalMinor - credited.creditedTotalMinor,
    taxableLeft: p.computed.lines.map((l, i) => l.taxableMinor - (credited.lines[i]?.taxableMinor ?? 0)),
  };
}

/**
 * The deadline of a credit note on this invoice (Q32, Q33; Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03)). rt1 T1: its last day is the end of the latest return
 * period before the return deadline, by the GSTR-1 frequency (`tax.gstr1Frequency`) and the invoice's FROZEN recipient status (Researched 2026-10-30, s.34(2) CGST Act;
 * Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)).
 */
export function deadlineOf(p: ParentCtx, settings: InvoiceSettings): CreditDeadline {
  return creditDeadlineOf({ row: p.row, extras: p.extras, recipient: p.recipient }, settings);
}

/** What `creditDeadlineOf` reads of an issued invoice: its frozen row's FY, issue day and service completion, its header extras and its frozen recipient. */
export type DeadlineSource = {
  row: { fy: string | null; issue_date: string | null; service_completed_on?: string | null | undefined };
  extras: InvoiceHeaderExtras;
  /** The invoice's FROZEN recipient (its `recipient` column as parsed); null or without a GST status when damaged. */
  recipient: { readonly gstStatus?: string | undefined } | null | undefined;
};

/** The GST statuses an invoice freezes in its recipient. */
const RECIPIENT_STATUSES = ["registered", "unregistered", "overseas"] as const;
type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/**
 * rt1 review 8: the ONE place the credit-note deadline's input is built, for the note routes (`deadlineOf`) and the invoice's notes view (`invoiceNotesView`), so the
 * banner and the refusal are never fed different facts. rt1 re-check 5: it also picks the recipient status itself, from the invoice's FROZEN recipient: every issued
 * invoice freezes its GST status; one without a known status (damaged) is judged as unregistered, the earlier and stricter last day (lead D2).
 */
export function creditDeadlineOf(src: DeadlineSource, settings: InvoiceSettings): CreditDeadline {
  const frozen = src.recipient?.gstStatus;
  const recipientStatus: RecipientStatus = RECIPIENT_STATUSES.find((s) => s === frozen) ?? "unregistered";
  return creditNoteDeadline(
    {
      parentFy: src.row.fy ?? "",
      parentIssueDate: src.row.issue_date ?? "",
      advanceReceivedOn: src.extras.advance?.receivedOn ?? null,
      serviceCompletedOn: src.row.service_completed_on ?? null,
    },
    settings.tax.creditNoteCutoff,
    settings.tax.annualReturnsFiled,
    { frequency: settings.tax.gstr1Frequency, recipientStatus },
  );
}

/** rt1 T2: what a debit note on an export under LUT needs at its issue: the FY token of the issue instant (IST) and the LUT with an ARN saved for it (null: none). */
export type NoteLut = { fy: string; lut: { fy: string; arn: string } | null };

/**
 * rt1 T2 (Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)): a debit note on an export invoice under LUT relies on the LUT of
 * the FY of its OWN issue day, not the invoice's. Null for a credit note and for a parent not under LUT (nothing to judge). The LUT route is `export_mode` 'lut' or
 * the parent's frozen `supply_type` column `export_lut` (an invoice issued on the settings' route leaves `export_mode` empty). `now` is the one instant of the issue.
 */
export function noteLutOf(
  kind: NoteKind,
  p: ParentCtx,
  settings: InvoiceSettings,
  now: number,
): NoteLut | null {
  // rt1 F5: the parent's frozen `supply_type` column, the one the freeze WHERE, the trigger and `explainNote` read (lead D7)
  if (kind !== "debit" || (p.row.export_mode !== "lut" && p.row.supply_type !== "export_lut")) return null;
  const fy = fyOf(now).token;
  // rt1 re-check 1: `lutFor(lutsOf)` (the legacy `tax.lut` only when it folds), so this blocker never allows what `LUT_FOR_FY_SQL` (the freeze WHERE, trigger 0054)
  // refuses; the one difference, a legacy ARN that would not fold, is refused here first (fail closed)
  return { fy, lut: lutForFy(fy, settings.tax) };
}

export { creditAllowed };

// ---- turning a request into takes and a computed document ------------------------------------------------------------------------------------

/** A failed request: the status, the body's error and the extra keys (`remaining`, `line`, `issues`, `closestMinor`). */
/** `details` is written inside `error` (`error.details`, like `err(..., details)`): `{ reason: "odd_amount" }` of a tax-only debit note whose tax is odd on an intra-state invoice. */
export type NoteRefusal = {
  status: 400 | 409;
  error: ApiError;
  extra?: Record<string, unknown>;
  details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type NoteAsk = {
  mode: "lines" | "amount" | "full";
  lines?: readonly NoteTake[] | undefined;
  grossMinor?: number | undefined;
};

const issuesOf = (errors: readonly TaxIssue[]): NoteRefusal => ({
  status: 409,
  error: { code: "tax_errors", message: "This note doesn't compute for this invoice" },
  extra: { issues: errors },
});

/**
 * The takes and the computed document of a credit note request (`full`: everything left; `amount`: the largest note whose total is at most the amount typed, GST
 * included, LD44; `lines`: as given, taxable values before GST). More than is left is `credit_exceeds_remaining` with what is left (the invoice's total, or a line's
 * taxable value: `line_credit_exceeds`), nothing chosen is `nothing_to_credit`.
 */
export function resolveCredit(
  p: ParentCtx,
  ask: NoteAsk,
  taxCtx: TaxContext,
): { ok: true; request: NoteRequest; computed: ComputedDocument } | { ok: false; refusal: NoteRefusal } {
  const left = leftOf(p);
  if (!left || !p.credited) return { ok: false, refusal: { status: 409, error: CREDIT_DATA_DAMAGED } };
  const refuse = (refusal: NoteRefusal) => ({ ok: false as const, refusal });
  const taxableOf = (doc: ComputedDocument): NoteTake[] =>
    doc.lines.map((l) => ({ line: l.index, taxableMinor: l.taxableMinor }));
  if (ask.mode === "full") {
    const r = creditNote(p.computed, p.credited, { kind: "full" }, taxCtx);
    if (!r.ok) return refuse(mapCreditErrors(r.errors, left, currencyOf(p)));
    return { ok: true, request: { mode: "full", takes: taxableOf(r.value) }, computed: r.value };
  }
  if (ask.mode === "amount") {
    const gross = ask.grossMinor ?? 0;
    if (gross > left.totalLeft)
      return refuse({
        status: 409,
        error: creditExceedsRemaining(left.totalLeft, currencyOf(p)),
        extra: { remaining: left.totalLeft },
      });
    const r = creditForGross(p.computed, p.credited, gross, taxCtx);
    if (r.ok)
      return {
        ok: true,
        request: { mode: "amount", grossMinor: gross, takes: [...r.takes] },
        computed: r.document,
      };
    if (r.reason === "bound")
      return refuse({
        status: 409,
        error: creditAmountUnfit(r.closest?.document.totalMinor ?? null, currencyOf(p)),
        extra: { closestMinor: r.closest?.document.totalMinor ?? null, remaining: left.totalLeft },
      });
    // An amount above zero that is below one rounding unit of any line cannot be turned into a note: it is unfit, with no closest figure.
    if (r.reason === "empty")
      return gross > 0
        ? refuse({
            status: 409,
            error: creditAmountUnfit(null, currencyOf(p)),
            extra: { closestMinor: null, remaining: left.totalLeft },
          })
        : refuse({ status: 400, error: NOTHING_TO_CREDIT });
    return refuse(mapCreditErrors(r.errors, left, currencyOf(p)));
  }
  const takes = [...(ask.lines ?? [])].sort((a, b) => a.line - b.line);
  if (takes.length === 0) return refuse({ status: 400, error: NOTHING_TO_CREDIT });
  const seen = new Set<number>();
  for (const t of takes) {
    const at = p.computed.lines.findIndex((l) => l.index === t.line);
    if (at < 0 || seen.has(t.line) || !Number.isSafeInteger(t.taxableMinor) || t.taxableMinor <= 0)
      return refuse({ status: 400, error: { code: "bad_request", message: "Check the form and try again" } });
    seen.add(t.line);
    const room = left.taxableLeft[at] ?? 0;
    if (t.taxableMinor > room)
      return refuse({
        status: 409,
        error: lineCreditExceeds(t.line + 1, room, currencyOf(p)),
        extra: { line: t.line, remaining: room },
      });
  }
  const r = creditNote(p.computed, p.credited, { kind: "lines", lines: takes }, taxCtx);
  if (!r.ok) return refuse(mapCreditErrors(r.errors, left, currencyOf(p)));
  return { ok: true, request: { mode: "lines", takes }, computed: r.value };
}

function mapCreditErrors(
  errors: readonly TaxIssue[],
  left: { totalLeft: number },
  currency: "INR" | "USD",
): NoteRefusal {
  if (errors.some((x) => x.code === "exceeds_creditable"))
    return {
      status: 409,
      error: creditExceedsRemaining(left.totalLeft, currency),
      extra: { remaining: left.totalLeft },
    };
  if (errors.some((x) => x.code === "credit_empty")) return { status: 400, error: NOTHING_TO_CREDIT };
  if (errors.some((x) => x.code === "credit_shape_mismatch"))
    return { status: 409, error: CREDIT_DATA_DAMAGED };
  return issuesOf(errors);
}

/** The computed document of a debit note: the shared engine at the parent's supply, route and rate, with `trustRates` set by `debitNoteInput` from the stored parent only. */
export function resolveDebit(
  p: ParentCtx,
  takes: readonly NoteTake[],
  taxCtx: TaxContext,
  today: CalendarDate,
): { ok: true; request: NoteRequest; computed: ComputedDocument } | { ok: false; refusal: NoteRefusal } {
  const sorted = [...takes].sort((a, b) => a.line - b.line);
  const input = debitNoteInput({ computed: p.computed, recipientStatus: p.recipientStatus }, sorted, today);
  if (!input.ok)
    return {
      ok: false,
      refusal: input.errors.some((x) => x.code === "credit_empty")
        ? { status: 400, error: NOTHING_TO_CREDIT }
        : { status: 400, error: { code: "bad_request", message: "Check the form and try again" } },
    };
  const r = computeDocument(input.input, taxCtx);
  if (!r.ok) return { ok: false, refusal: issuesOf(r.errors) };
  return { ok: true, request: { mode: "lines", takes: sorted }, computed: r.value };
}

/**
 * The computed document of a "Tax charged too low" debit note (Q35, 07-T §9): the tax to add (`taxMinor`, above zero) split over the invoice's lines that carry tax, with a taxable
 * value of zero, at the invoice's supply, heads and rates (core `taxOnlyDebitNote`). A bad amount or an invoice with no tax to correct is `debit_tax_only_invalid` (400).
 */
export function resolveDebitTaxOnly(
  p: ParentCtx,
  taxMinor: number,
  taxCtx: TaxContext,
): { ok: true; request: NoteRequest; computed: ComputedDocument } | { ok: false; refusal: NoteRefusal } {
  const r = taxOnlyDebitNote(p.computed, taxMinor, taxCtx);
  if (!r.ok) {
    // An odd amount on an intra-state invoice (CGST must equal SGST) says so (`details.reason`, 07-W 5.9); a parent with no tax on any line (an export under LUT) and every other bad
    // amount keep the plain line (07-W 5.11: no tax-only debit note on an LUT invoice, which the screen does not offer).
    if (
      p.computed.supply.type === "intra" &&
      Number.isInteger(taxMinor) &&
      taxMinor >= 1 &&
      taxMinor % 2 === 1 &&
      r.errors.some((x) => x.code === "credit_line_invalid")
    )
      return {
        ok: false,
        refusal: { status: 400, error: DEBIT_TAX_ONLY_INVALID, details: { reason: ODD_AMOUNT } },
      };
    if (r.errors.some((x) => x.code === "credit_line_invalid" || x.code === "credit_empty"))
      return { ok: false, refusal: { status: 400, error: DEBIT_TAX_ONLY_INVALID } };
    if (r.errors.some((x) => x.code === "credit_shape_mismatch"))
      return { ok: false, refusal: { status: 409, error: CREDIT_DATA_DAMAGED } };
    return { ok: false, refusal: issuesOf(r.errors) };
  }
  return {
    ok: true,
    request: {
      mode: "lines",
      taxMinor,
      takes: r.value.lines.map((l) => ({ line: l.index, taxableMinor: 0 })),
    },
    computed: r.value,
  };
}

/** The same computed document worked out again from the STORED request (the issue, a save): a credit note as a `lines` request over what was issued since, a debit note as a debit (or as tax only). */
export function recomputeNote(
  kind: NoteKind,
  p: ParentCtx,
  request: Pick<NoteRequest, "takes" | "taxMinor">,
  taxCtx: TaxContext,
  today: CalendarDate,
): { computed: ComputedDocument | null; errors: TaxIssue[]; refusal: NoteRefusal | null } {
  const takes = request.takes;
  if (kind === "debit") {
    const r =
      request.taxMinor !== undefined
        ? resolveDebitTaxOnly(p, request.taxMinor, taxCtx)
        : resolveDebit(p, takes, taxCtx, today);
    return r.ok
      ? { computed: r.computed, errors: [], refusal: null }
      : { computed: null, errors: [], refusal: r.refusal };
  }
  const left = leftOf(p);
  if (!left || !p.credited)
    return { computed: null, errors: [], refusal: { status: 409, error: CREDIT_DATA_DAMAGED } };
  const r = creditNote(p.computed, p.credited, { kind: "lines", lines: takes }, taxCtx);
  if (r.ok) return { computed: r.value, errors: [], refusal: null };
  return { computed: null, errors: [...r.errors], refusal: mapCreditErrors(r.errors, left, currencyOf(p)) };
}

/** What a refusal of the request says to the blockers: nothing chosen, or more than is left (on a line, or on the invoice). */
export function refusalFacts(r: NoteRefusal | null): {
  empty: boolean;
  exceeds: { line: number | null; remaining: number } | null;
} {
  if (!r) return { empty: false, exceeds: null };
  if (r.error.code === "nothing_to_credit") return { empty: true, exceeds: null };
  const remaining = typeof r.extra?.remaining === "number" ? r.extra.remaining : 0;
  if (r.error.code === "line_credit_exceeds")
    return {
      empty: false,
      exceeds: { line: typeof r.extra?.line === "number" ? r.extra.line : 0, remaining },
    };
  if (r.error.code === "credit_exceeds_remaining")
    return { empty: false, exceeds: { line: null, remaining } };
  return { empty: false, exceeds: null };
}

/**
 * Every blocker of a note draft under the Owner's checklist (the issue, the issue request and the view all ask this one question). `re` is what `recomputeNote` gave: a refusal
 * that is not an empty or too-big request (the engine's errors, damaged credit figures) is a `computed_errors`.
 */
export function blockersOfNote(a: {
  kind: NoteKind;
  currency: string;
  p: ParentCtx;
  stored: NoteOf;
  re: { computed: ComputedDocument | null; refusal: NoteRefusal | null };
  settings: InvoiceSettings;
  bank: readonly BankRow[];
  issueDate: string;
  /** The credit deadline when the caller has worked it out already (`null`: a debit note has none); left out, it is worked out here. */
  deadline?: CreditDeadline | null;
  /** rt1 T2: the LUT of a debit note's issue FY (`noteLutOf`); null or left out: not judged. */
  lut?: NoteLut | null;
}): NoteBlocker[] {
  const asked = refusalFacts(a.re.refusal);
  const known = asked.empty || asked.exceeds !== null;
  const dl = a.deadline !== undefined ? a.deadline : a.kind === "credit" ? deadlineOf(a.p, a.settings) : null;
  return noteBlockers(
    {
      kind: a.kind,
      currency: a.currency,
      supplier: {
        legalName: a.settings.company.legalName,
        address: a.settings.company.address,
        gstin: a.settings.company.gstin,
        stateCode: a.settings.company.stateCode,
      },
      parent: {
        status: a.p.row.status,
        totalMinor: a.p.row.total_minor,
        creditedMinor: a.p.row.credited_minor,
      },
      issuedOfKind: a.kind === "credit" ? a.p.issued.credit : a.p.issued.debit,
      reason: a.stored.reason,
      issueDate: a.issueDate,
      request: asked,
      taxErrorCount: a.re.computed || known ? 0 : 1,
      totalMinor: a.re.computed?.totalMinor ?? null,
      reverseChargeText: a.settings.tax.reverseChargeText,
      deadline: dl ? { lastDay: dl.lastDay, passed: !creditAllowed(a.issueDate, dl) } : null,
      bank: {
        inr: a.bank.some((r) => r.kind === "INR"),
        swift: a.bank.some((r) => r.kind === "USD_SWIFT" && !!r.swift),
      },
      // T4: a note always carries the signature (Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22))
      signatureSaved: a.settings.company.signature != null,
      ...(a.lut ? { lut: { needed: true, fy: a.lut.fy, saved: a.lut.lut !== null } } : {}),
    },
    a.settings.tax.invoiceChecklist,
  );
}

// ---- the draft's state and hash -----------------------------------------------------------------------------------------------------------------

export type NoteReasonIn = { code: string; text: string };

/** The reasons a kind accepts (the route's schema is built from the same lists). */
export const reasonsOf = (kind: NoteKind): readonly string[] =>
  kind === "credit" ? CREDIT_REASONS : DEBIT_REASONS;

/**
 * The `noteOf` a draft stores in `header_extras` and the freeze seals. `lut` (rt1 T2, at the issue only): the LUT a debit note on an export under LUT relies on, the
 * one of its own issue day's FY (`noteLutOf`), sealed last; a draft has none (its issue day is not known yet).
 */
export const noteOfOf = (
  kind: NoteKind,
  p: ParentCtx,
  reason: NoteReasonIn,
  request: NoteRequest,
  lut?: { fy: string; arn: string } | null,
): NoteOf => ({
  kind,
  parent: parentFacts(p),
  reason: { code: reason.code, text: reason.text },
  request,
  ...(lut ? { lut: { fy: lut.fy, arn: lut.arn } } : {}),
});

/** The lines of a note: one per take, with the invoice line's description, SAC, unit and rate, quantity one, the taxable value taken as the rate. */
export function noteLines(p: ParentCtx, takes: readonly NoteTake[]): LineState[] {
  return takes.map((t) => {
    const at = p.computed.lines.findIndex((l) => l.index === t.line);
    const own = p.lines[at];
    return {
      id: uuidv7(),
      catalogueItemId: null,
      catalogueRateMinor: null,
      catalogueLine: null,
      description: own?.description ?? "",
      detail: null,
      sac: own?.sac ?? p.computed.lines[at]?.sac ?? null,
      qtyMilli: 1000,
      unit: own?.unit ?? "fixed",
      rateMinor: t.taxableMinor,
      discountKind: null,
      discountValue: null,
      gstRateBp: p.computed.lines[at]?.gstRateBp ?? own?.gst_rate_bp ?? 0,
    };
  });
}

/**
 * The exchange rate of the invoice, as the note carries it (copied: a note never has a rate of its own), with the parent's "no rate was published that day" statement and the day it
 * covers when it has one (Q24, review 2026-10-28, finding 6): the note's sealed `fx` is then the parent's exactly, and a note is never judged against the day of supply (the engine's
 * rate rule is for tax and export invoices only).
 */
export const fxOfParent = (p: ParentCtx): FxState | null =>
  p.row.fx_rate_micros !== null && p.row.fx_date !== null && p.row.fx_source !== null
    ? {
        rateMicros: p.row.fx_rate_micros,
        date: p.row.fx_date,
        source: p.row.fx_source,
        ...(p.row.fx_no_rate_day ? { noRateDay: p.row.fx_no_rate_day } : {}),
      }
    : null;

/** The state of a note draft: the client, the contact, the parent's currency, route and rate, the lines and the request. */
export function noteState(a: {
  id: string;
  kind: NoteKind;
  p: ParentCtx;
  client: Pick<ClientRow, "id" | "currency">;
  contactId: string | null;
  note: NoteOf;
  lines: LineState[];
}): InvoiceState {
  return {
    id: a.id,
    type: a.kind === "credit" ? "credit_note" : "debit_note",
    clientId: a.client.id,
    contactId: a.contactId,
    currency: a.p.computed.currency === "USD" ? "USD" : "INR",
    discountKind: null,
    discountValue: null,
    exportMode: a.p.row.export_mode,
    fx: fxOfParent(a.p),
    serviceCompletedOn: null,
    exportDeclarationId: null,
    lines: a.lines,
    note: {
      parentId: a.p.row.id,
      kind: a.note.kind,
      reasonCode: a.note.reason.code,
      reasonText: a.note.reason.text,
      mode: a.note.request.mode,
      grossMinor: a.note.request.grossMinor ?? null,
      takes: a.note.request.takes,
    },
  };
}

/** The computation of a note draft in the shape every invoice route takes (`InvoiceComputation`): the draft, the document, the errors and the content hash. */
export async function noteComputation(
  state: InvoiceState,
  computed: ComputedDocument | null,
  errors: TaxIssue[] = [],
): Promise<InvoiceComputation> {
  const draft = invoiceDraftOf(state);
  return { draft, computed, errors, warnings: [], hash: await contentHash(draft, computed) };
}

/** `header_extras` of a draft: exactly `{noteOf}` (the same text the freeze writes). */
export const noteHeaderExtras = (n: NoteOf): string | null => headerExtrasJson({ noteOf: n });

/** The stored request of a note row, or null when its `header_extras` is not a readable `noteOf`. */
export const storedNoteOf = (d: { type: string; header_extras: string | null }): NoteOf | null =>
  isNoteType(d.type) ? (headerExtrasOfRow(d).noteOf ?? null) : null;

export type { NoteType };
export { isNoteType, istDate, noteContentOf, noteKindOf };
