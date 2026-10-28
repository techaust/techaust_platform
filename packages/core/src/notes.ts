// Credit and debit notes, pure (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note", docs/04 §9, docs/08 G-11, 08-A §6). No I/O, no zod, no floats. Codes only: the words are the
// screens' (07-T). EVERY RULE HERE IS A RESEARCHED DEFAULT: VERIFY WITH CA/LEGAL (s.34 CGST Act, Rule 53(1A), the 30 November block, IMS).
//
//   - the reasons, the limits and the note blockers (own codes, LD50: `ISSUE_BLOCKER_CODES` is the invoice's and does not move),
//   - the deadline of a credit note (s.34(2): 30 November after the end of the FY of the supply, or earlier once the annual return is filed; Q32, Q33),
//   - the ledger of the parent (status, balance, refund due: derived, never stored beyond the columns the batch recomputes),
//   - `creditForGross`: the largest credit note that fits an amount typed GST included (LD44),
//   - the debit note's input for the shared engine (LD43), and the twin of the IMS triggers.
// Exported through `@techaust/core/invoices`.
import {
  addDays,
  type CalendarDate,
  daysBetween,
  financialYear,
  fyOfDate,
  parseIsoDate,
  toIsoDate,
} from "./dates.ts";
import type { ChecklistSettings } from "./invoices.ts";
import {
  type ComputedDocument,
  type CreditedLine,
  type CreditedSoFar,
  type CreditRequest,
  creditNote,
  type DocumentInput,
  type LineInput,
  type RecipientStatus,
  roundingUnit,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
} from "./tax/index.ts";

// ---- kinds, reasons, limits --------------------------------------------------------------------------------------------------------------------

export const NOTE_TYPES = ["credit_note", "debit_note"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export const isNoteType = (v: unknown): v is NoteType => (NOTE_TYPES as readonly unknown[]).includes(v);

export type NoteKind = "credit" | "debit";
export const noteKindOf = (type: NoteType): NoteKind => (type === "credit_note" ? "credit" : "debit");
export const noteTypeOf = (kind: NoteKind): NoteType => (kind === "credit" ? "credit_note" : "debit_note");

/**
 * The reasons a person can pick (07-T §3 and §9). "Discount after sale" is a valid credit-note reason for notes DATED from 1 November 2026 (IST): s.15(3)(b) was
 * substituted and s.34(1) extended by ss.153 to 154 of the Finance Act 2026, in force from that day by Notification 03/2026-CT (Researched 2026-10-28, 08-C RA-02; the
 * CBIC repository still shows "yet to be notified": re-read it after 1 November). A debit note has three (Q35, owner 2026-10-28): "Tax charged too low" adds tax only
 * (s.34(3); Researched 2026-10-28, 08-C RA-22).
 */
export const CREDIT_REASONS = [
  "price_correction",
  "service_not_delivered",
  "service_deficient",
  "discount_after_sale",
  "other",
] as const;
export const DEBIT_REASONS = ["price_correction", "tax_charged_too_low", "other"] as const;
/** The first IST day a credit note for "Discount after sale" may be dated (RA-02). The SQL twin is `DISCOUNT_AFTER_SALE_FROM_SQL` in `@techaust/db/issue` (a test compares them). */
export const DISCOUNT_AFTER_SALE_FROM = "2026-11-01";
/** Whether a note of this reason may carry this date (ISO, the IST issue day): only "Discount after sale" is dated-limited. */
export const reasonInForce = (reasonCode: string, noteDate: string): boolean =>
  reasonCode !== "discount_after_sale" || noteDate >= DISCOUNT_AFTER_SALE_FROM;
export const NOTE_REASONS: Readonly<Record<NoteKind, readonly string[]>> = {
  credit: CREDIT_REASONS,
  debit: DEBIT_REASONS,
};
export const NOTE_REASON_TEXT_MAX = 300;
/** LD51: at most this many ISSUED notes of each kind per invoice (`notes_limit`). The SQL freeze and the create guard count the same. */
export const NOTES_MAX = 20;
/** The most lines a note can name (the engine's own cap on a document's lines is the real limit; this keeps the stored request small). */
export const NOTE_LINES_MAX = 100;

export const isNoteReason = (kind: NoteKind, code: string): boolean => NOTE_REASONS[kind].includes(code);

// ---- the frozen request (`header_extras.noteOf`, LD39) ------------------------------------------------------------------------------------------

/** One take: the parent's line (its `computed.lines[].index`, 0-based) and the taxable value credited or added on it, in minor units. */
export type NoteTake = { readonly line: number; readonly taxableMinor: number };

export type NoteRequest = {
  readonly mode: "lines" | "amount" | "full";
  /** The amount typed (GST included) when the mode is `amount`. */
  readonly grossMinor?: number;
  /**
   * A debit note for "Tax charged too low" (Q35): the total tax to add (above zero, in the invoice's currency). The takes then name the lines the tax is split over, each
   * with a taxable value of zero; the split is worked out again from this amount at the issue (core `taxOnlyDebitNote`).
   */
  readonly taxMinor?: number;
  readonly takes: readonly NoteTake[];
};

/** The parent's facts a note freezes (M5.5's `NoteParent` plus id, type, fy and the total: LD53). `lut` is copied from the parent's export block. */
export type NoteParentFacts = {
  readonly id: string;
  readonly type: "tax_invoice" | "export_invoice";
  readonly fy: string;
  readonly number: string;
  readonly issueDate: string;
  readonly supplyType: string;
  readonly recipientStatus: "registered" | "unregistered" | "overseas";
  readonly placeOfSupplyCode: string;
  readonly totalMinor: number;
  readonly totalInrMinor: number | null;
  readonly lut?: { readonly fy: string; readonly arn: string };
};

export type NoteOf = {
  readonly kind: NoteKind;
  readonly parent: NoteParentFacts;
  readonly reason: { readonly code: string; readonly text: string };
  readonly request: NoteRequest;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/**
 * `header_extras.noteOf` read back WITHOUT zod (the jobs Worker must not bring it in): the same object the freeze wrote, or null when it is malformed
 * (a seal check then fails, which is the right answer for damaged data). Key order of the result is the writer's (`noteOfJson` keeps it).
 */
export function noteOfFromStored(v: unknown): NoteOf | null {
  if (!isRecord(v)) return null;
  const { kind, parent, reason, request } = v;
  if (kind !== "credit" && kind !== "debit") return null;
  if (!isRecord(parent) || !isRecord(reason) || !isRecord(request)) return null;
  const takes = request.takes;
  if (!Array.isArray(takes)) return null;
  if (
    !takes.every(
      (t) => isRecord(t) && isNum(t.line) && isNum(t.taxableMinor) && t.line >= 0 && t.taxableMinor >= 0,
    )
  )
    return null;
  if (request.mode !== "lines" && request.mode !== "amount" && request.mode !== "full") return null;
  if (request.grossMinor !== undefined && !isNum(request.grossMinor)) return null;
  if (request.taxMinor !== undefined && !(isNum(request.taxMinor) && request.taxMinor > 0)) return null;
  if (!isStr(reason.code) || !isStr(reason.text)) return null;
  const p = parent;
  if (
    !isStr(p.id) ||
    !(p.type === "tax_invoice" || p.type === "export_invoice") ||
    !isStr(p.fy) ||
    !isStr(p.number) ||
    !isStr(p.issueDate) ||
    !isStr(p.supplyType) ||
    !(
      p.recipientStatus === "registered" ||
      p.recipientStatus === "unregistered" ||
      p.recipientStatus === "overseas"
    ) ||
    !isStr(p.placeOfSupplyCode) ||
    !isNum(p.totalMinor) ||
    !(p.totalInrMinor === null || isNum(p.totalInrMinor))
  )
    return null;
  let lut: { fy: string; arn: string } | undefined;
  if (p.lut !== undefined) {
    if (!isRecord(p.lut) || !isStr(p.lut.fy) || !isStr(p.lut.arn)) return null;
    lut = { fy: p.lut.fy, arn: p.lut.arn };
  }
  return {
    kind,
    parent: {
      id: p.id,
      type: p.type,
      fy: p.fy,
      number: p.number,
      issueDate: p.issueDate,
      supplyType: p.supplyType,
      recipientStatus: p.recipientStatus,
      placeOfSupplyCode: p.placeOfSupplyCode,
      totalMinor: p.totalMinor,
      totalInrMinor: p.totalInrMinor as number | null,
      ...(lut ? { lut } : {}),
    },
    reason: { code: reason.code, text: reason.text },
    request: {
      mode: request.mode,
      ...(request.grossMinor !== undefined ? { grossMinor: request.grossMinor } : {}),
      ...(request.taxMinor !== undefined ? { taxMinor: request.taxMinor } : {}),
      takes: takes.map((t) => ({ line: t.line as number, taxableMinor: t.taxableMinor as number })),
    },
  };
}

/** The request as the content hash takes it: one tuple per take. */
export const takesTuples = (takes: readonly NoteTake[]): [number, number][] =>
  takes.map((t) => [t.line, t.taxableMinor]);

// ---- the note blockers (LD50; Rule 53(1A); VERIFY WITH CA/LEGAL) -----------------------------------------------------------------------------

/**
 * The statuses of an invoice a note can be issued against (not a draft, not void, not credited in full). The one list: the note blockers, the admin's refusals, the issue guard's SQL
 * (`@techaust/db/issue`) and, pinned by a db test, the text of the 0042 trigger `documents_note_issue_check`.
 */
export const NOTE_PARENT_LIVE_STATUSES = ["issued", "partially_paid", "paid", "partially_credited"] as const;
export const isLiveParentStatus = (status: string): boolean =>
  (NOTE_PARENT_LIVE_STATUSES as readonly string[]).includes(status);

export const NOTE_BLOCKER_CODES = [
  "supplier_legal_name",
  "supplier_address",
  "supplier_gstin",
  "supplier_state",
  "parent_not_issued",
  "parent_void",
  "parent_fully_credited",
  "debit_parent_fully_credited",
  "nothing_to_credit",
  "credit_exceeds_remaining",
  "line_credit_exceeds",
  "credit_deadline_passed",
  "note_reason_required",
  "discount_reason_not_in_force",
  "computed_errors",
  "zero_total",
  "reverse_charge_text",
  "bank_missing",
  "swift_missing",
  "notes_limit",
] as const;
export type NoteBlockerCode = (typeof NOTE_BLOCKER_CODES)[number];

/** `line`: the parent's line index (`line_credit_exceeds`). `remaining`: what can still be credited (minor units: on the line, or on the invoice). `date`: the last day (`credit_deadline_passed`). */
export type NoteBlocker = {
  readonly code: NoteBlockerCode;
  readonly line?: number;
  readonly remaining?: number;
  readonly date?: string;
};

export type NoteFacts = {
  readonly kind: NoteKind;
  readonly currency: string;
  readonly supplier: {
    readonly legalName: string | null;
    readonly address: string | null;
    readonly gstin: string | null;
    readonly stateCode: string | null;
  };
  /** The parent's status and ledger as read now. */
  readonly parent: { readonly status: string; readonly totalMinor: number; readonly creditedMinor: number };
  /** How many notes of this kind are already issued on the parent. */
  readonly issuedOfKind: number;
  readonly reason: { readonly code: string; readonly text: string };
  /** The IST day the note would be dated (the issue day): "Discount after sale" before 1 November 2026 is blocked. Left out: the date is not judged. */
  readonly issueDate?: string;
  /** What the amounts check found: nothing chosen, or more than is left (on a line, or on the invoice as a whole). */
  readonly request: {
    readonly empty: boolean;
    readonly exceeds: { readonly line: number | null; readonly remaining: number } | null;
  };
  readonly taxErrorCount: number;
  readonly totalMinor: number | null;
  readonly reverseChargeText: string | null;
  /** A credit note only: the last day it may be issued, and whether the issue day is past it (`creditNoteDeadline`, `creditAllowed`). */
  readonly deadline: { readonly lastDay: string; readonly passed: boolean } | null;
  /** The active bank accounts (a debit note prints the bank block, like an invoice). */
  readonly bank: { readonly inr: boolean; readonly swift: boolean };
};

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";

/**
 * Everything that stops a note from being issued, as codes (empty = it can be issued). Order is stable: the supplier, the parent, the request, the
 * deadline, the reason, the totals, the reverse charge, the bank (a debit note, when the Owner's checklist asks for it), the limit. The parent's
 * recipient and place of supply come from its frozen snapshot, so no recipient, LUT or B2C code is raised here (LD49).
 */
export function noteBlockers(f: NoteFacts, checklist: Pick<ChecklistSettings, "bankDetails">): NoteBlocker[] {
  const out: NoteBlocker[] = [];
  if (blank(f.supplier.legalName)) out.push({ code: "supplier_legal_name" });
  if (blank(f.supplier.address)) out.push({ code: "supplier_address" });
  if (blank(f.supplier.gstin)) out.push({ code: "supplier_gstin" });
  if (blank(f.supplier.stateCode)) out.push({ code: "supplier_state" });
  const live = isLiveParentStatus(f.parent.status);
  if (f.parent.status === "void") out.push({ code: "parent_void" });
  else if (f.parent.status === "credited") {
    if (f.kind === "credit") out.push({ code: "parent_fully_credited" });
    else out.push({ code: "debit_parent_fully_credited" });
  } else if (!live) out.push({ code: "parent_not_issued" });
  if (live && f.parent.creditedMinor >= f.parent.totalMinor)
    out.push({ code: f.kind === "credit" ? "parent_fully_credited" : "debit_parent_fully_credited" });
  if (f.request.empty) out.push({ code: "nothing_to_credit" });
  if (f.request.exceeds) {
    const e = f.request.exceeds;
    out.push(
      e.line === null
        ? { code: "credit_exceeds_remaining", remaining: e.remaining }
        : { code: "line_credit_exceeds", line: e.line, remaining: e.remaining },
    );
  }
  if (f.deadline?.passed) out.push({ code: "credit_deadline_passed", date: f.deadline.lastDay });
  if (blank(f.reason.code) || (f.reason.code === "other" && blank(f.reason.text)))
    out.push({ code: "note_reason_required" });
  if (f.issueDate !== undefined && !reasonInForce(f.reason.code, f.issueDate))
    out.push({ code: "discount_reason_not_in_force" });
  if (f.taxErrorCount > 0) out.push({ code: "computed_errors" });
  // (An empty or too-big request has its own code above; a zero total then adds nothing.)
  else if ((f.totalMinor === null || f.totalMinor <= 0) && !f.request.empty && f.request.exceeds === null)
    out.push({ code: "zero_total" });
  if (blank(f.reverseChargeText)) out.push({ code: "reverse_charge_text" });
  if (f.kind === "debit" && checklist.bankDetails) {
    if (f.currency === "INR" && !f.bank.inr) out.push({ code: "bank_missing" });
    if (f.currency === "USD" && !f.bank.swift) out.push({ code: "swift_missing" });
  }
  if (f.issuedOfKind >= NOTES_MAX) out.push({ code: "notes_limit" });
  return out;
}

// ---- the deadline of a credit note (s.34(2); G-11; Q32, Q33; VERIFY WITH CA/LEGAL) ---------------------------------------------------------------

export type AnnualReturnFiled = { readonly fy: string; readonly filedOn: string };

export type CreditDeadline = {
  /** The cutoff day of the year the supply FY ends (`tax.creditNoteCutoff`: 30 November), clamped to the month's last day. */
  readonly date: string;
  /** What binds: the cutoff, or the annual return when it was filed before the cutoff. */
  readonly basis: "cutoff" | "annual_return";
  /** The FY token the supply belongs to (Q32): the earliest of the invoice's, the advance's and the service's. */
  readonly supplyFy: string;
  /** The day the annual return of that FY was filed (null: not filed). A note dated on this day or after it is refused (Q33). */
  readonly filedOn: string | null;
  /** The last day a note may be dated: the cutoff, or the day before the return was filed. */
  readonly lastDay: string;
};

const fyOfToken = (token: string) => financialYear(2000 + Number(token.slice(0, 2)));

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthEnd = (year: number, month: number): number =>
  month === 2 ? (isLeap(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/**
 * Q32 (VERIFY WITH CA/LEGAL): the credit note is judged against the FY the SUPPLY belongs to. That is the earliest of three: the FY of the invoice; the FY of the day
 * an advance was received (the tax invoice made for money already received, Q9: the supply's time of supply is the receipt); and the FY of the day the service was
 * completed, when the invoice came more than 30 days after it (Rule 47: the invoice is due within 30 days of the supply). `cutoff` is `tax.creditNoteCutoff`.
 * `annualReturnsFiled` (Q33): the return of that FY, once filed, closes credit notes from the day it was filed. An unreadable date is ignored.
 */
export function creditNoteDeadline(
  input: {
    readonly parentFy: string;
    readonly parentIssueDate: string;
    readonly advanceReceivedOn?: string | null;
    readonly serviceCompletedOn?: string | null;
  },
  cutoff: { readonly month: number; readonly day: number },
  annualReturnsFiled: readonly AnnualReturnFiled[],
): CreditDeadline {
  let start = fyOfToken(input.parentFy).startYear;
  const consider = (d: CalendarDate | null) => {
    if (d) start = Math.min(start, fyOfDate(d).startYear);
  };
  if (input.advanceReceivedOn) consider(parseIsoDate(input.advanceReceivedOn));
  const done = input.serviceCompletedOn ? parseIsoDate(input.serviceCompletedOn) : null;
  const issued = parseIsoDate(input.parentIssueDate);
  if (done && issued && daysBetween(done, issued) > 30) consider(done);
  const fy = financialYear(start);
  const year = start + 1;
  const date = toIsoDate({
    year,
    month: cutoff.month,
    day: Math.min(cutoff.day, monthEnd(year, cutoff.month)),
  });
  const filedOn = annualReturnsFiled.find((r) => r.fy === fy.token)?.filedOn ?? null;
  const filed = filedOn !== null ? parseIsoDate(filedOn) : null;
  if (filedOn !== null && filed && filedOn <= date) {
    const lastDay = toIsoDate(addDays(filed, -1));
    return { date, basis: "annual_return", supplyFy: fy.token, filedOn, lastDay };
  }
  return {
    date,
    basis: "cutoff",
    supplyFy: fy.token,
    filedOn: filedOn !== null && filed ? filedOn : null,
    lastDay: date,
  };
}

/** Q33: a credit note dated `issueDate` (ISO) is allowed on or before the cutoff, and strictly before the day the annual return was filed. */
export const creditAllowed = (issueDate: string, d: CreditDeadline): boolean =>
  issueDate <= d.date && (d.filedOn === null || issueDate < d.filedOn);

// ---- the ledger of the parent (LD41) ---------------------------------------------------------------------------------------------------------------

/** The status an issued invoice has for these figures: the twin of the CASE the issue batch writes (a test compares them). */
export function ledgerStatusOf(
  totalMinor: number,
  paidMinor: number,
  creditedMinor: number,
): "issued" | "partially_paid" | "paid" | "partially_credited" | "credited" {
  if (creditedMinor >= totalMinor) return "credited";
  if (paidMinor > 0 && totalMinor - paidMinor - creditedMinor <= 0) return "paid";
  if (paidMinor > 0) return "partially_paid";
  if (creditedMinor > 0) return "partially_credited";
  return "issued";
}

/** What is still to pay: never below zero (a credit above what was owed is a refund, not a negative balance). */
export const balanceOf = (totalMinor: number, paidMinor: number, creditedMinor: number): number =>
  Math.max(0, totalMinor - paidMinor - creditedMinor);

/** What the client is owed back: paid and credited together above the total. Derived, display only (M6 records the refund). */
export const refundDueOf = (totalMinor: number, paidMinor: number, creditedMinor: number): number =>
  Math.max(0, paidMinor + creditedMinor - totalMinor);

// ---- the credit that fits an amount typed GST included (LD44) --------------------------------------------------------------------------------

export type GrossCredit =
  | {
      readonly ok: true;
      readonly document: ComputedDocument;
      /** The takes of the document, as a `lines` request would give them (what the draft stores). */
      readonly takes: readonly NoteTake[];
      readonly full: boolean;
      /** The amount typed minus the note's total (never negative), and the number of engine runs it took. */
      readonly gapMinor: number;
      readonly evaluations: number;
    }
  | {
      readonly ok: false;
      readonly errors: readonly TaxIssue[];
      readonly reason: "engine" | "empty" | "bound";
      /**
       * `bound` only: the biggest note found whose total is not above the amount, and MORE than one rounding unit below it. Measured: with several lines at different
       * rates the totals of neighbouring requests can skip the amount and the amount minus one unit (USD: by two or three cents), so no request lands within one unit;
       * the nearest is this one. The caller shows its total; typing that amount works (it is a total the engine reaches).
       */
      readonly closest?: {
        readonly document: ComputedDocument;
        readonly takes: readonly NoteTake[];
        readonly gapMinor: number;
      };
    };

/** How many `creditNote` runs `creditForGross` may use. */
export const GROSS_EVALUATIONS_MAX = 4;

/** Integer quotient of two bigints (truncated toward zero). */
const quotient = (a: bigint, b: bigint): bigint => BigInt(a) / BigInt(b);

const takesOf = (doc: ComputedDocument): NoteTake[] =>
  doc.lines.map((l) => ({ line: l.index, taxableMinor: l.taxableMinor }));

/**
 * The largest credit note whose total is at most `grossMinor` (the amount typed, GST included; VERIFY WITH CA/LEGAL: a credit note states the tax it reverses,
 * so the person types what the client sees and the engine finds the taxable value). An amount that covers everything that is left gives the full note. Otherwise
 * it starts from `grossMinor × taxable left / total left` (bigint) and corrects with the engine's own result, at most `GROSS_EVALUATIONS_MAX` runs; the best
 * result is the one with the biggest total that is not above the amount. `gapMinor` says how far below it is. No result within one rounding unit (a whole
 * rupee for INR, a cent for USD) in that many runs is `bound` (with the `closest` note found): the caller refuses and says so, it never guesses.
 */
export function creditForGross(
  original: ComputedDocument,
  credited: CreditedSoFar,
  grossMinor: number,
  ctx: TaxContext,
  evaluationsMax: number = GROSS_EVALUATIONS_MAX,
): GrossCredit {
  if (!Number.isSafeInteger(grossMinor) || grossMinor <= 0)
    return { ok: false, errors: [{ code: "credit_empty", path: ["request"] }], reason: "empty" };
  const left = (o: CreditedLine, c: CreditedLine) => o.taxableMinor - c.taxableMinor;
  let taxableLeft = 0n;
  original.lines.forEach((l, i) => {
    const c = credited.lines[i];
    if (c) taxableLeft += BigInt(left(l, c));
  });
  const totalLeft = BigInt(original.totalMinor) - BigInt(credited.creditedTotalMinor);
  const gross = BigInt(grossMinor);
  if (totalLeft <= 0n || taxableLeft <= 0n || gross >= totalLeft) {
    const r = creditNote(original, credited, { kind: "full" }, ctx);
    return r.ok
      ? { ok: true, document: r.value, takes: takesOf(r.value), full: true, gapMinor: 0, evaluations: 1 }
      : { ok: false, errors: r.errors, reason: "engine" };
  }
  const unit = roundingUnit(original.currency, ctx);
  const run = (t: bigint): TaxResult<ComputedDocument> =>
    creditNote(original, credited, { kind: "amount", taxableMinor: Number(t) }, ctx);
  const clampT = (t: bigint) => (t < 1n ? 1n : t > taxableLeft ? taxableLeft : t);
  const tried = new Set<bigint>();
  let best: { total: bigint; doc: ComputedDocument } | null = null;
  let t = clampT(quotient(gross * taxableLeft, totalLeft));
  let evaluations = 0;
  for (let i = 0; i < evaluationsMax; i++) {
    tried.add(t);
    const r = run(t);
    evaluations++;
    if (!r.ok) return { ok: false, errors: r.errors, reason: "engine" };
    const total = BigInt(r.value.totalMinor);
    // A note with nothing to pay (a whole-rupee rounding of a few paise) is no note.
    if (total > 0n && total <= gross && (best === null || total > best.total)) best = { total, doc: r.value };
    if (best !== null && gross - best.total < unit) break;
    if (total === 0n && gross < unit) break;
    // Move by what the total is off, scaled to the taxable value. Above the amount: by whole units (the total only moves in steps of one unit, so a smaller
    // difference would land on the same total again); below it: by the gap. Always at least one minor unit, and never to a value already run.
    const need = total > gross ? quotient(total - gross + unit - 1n, unit) * unit : gross - total;
    const move = quotient(need * taxableLeft, totalLeft);
    const step = move < 1n ? 1n : move;
    const dir = total > gross ? -1n : 1n;
    let next = clampT(t + dir * step);
    while (tried.has(next) && clampT(next + dir) !== next) next = clampT(next + dir);
    if (tried.has(next)) break;
    t = next;
  }
  if (best === null) return { ok: false, errors: [], reason: "empty" };
  if (gross - best.total > unit)
    return {
      ok: false,
      errors: [],
      reason: "bound",
      closest: { document: best.doc, takes: takesOf(best.doc), gapMinor: Number(gross - best.total) },
    };
  return {
    ok: true,
    document: best.doc,
    takes: takesOf(best.doc),
    full: false,
    gapMinor: Number(gross - best.total),
    evaluations,
  };
}

// ---- the debit note (s.34(3); LD43; VERIFY WITH CA/LEGAL) -----------------------------------------------------------------------------------

export type DebitInput =
  | { readonly ok: true; readonly input: DocumentInput }
  | { readonly ok: false; readonly errors: readonly TaxIssue[] };

/**
 * The shared engine's input for a debit note on `parent` (its frozen computed document): the parent's supply (the export route included) and exchange rate,
 * a line per take with the parent line's SAC and rate and a quantity of one, the rate being the taxable value added. `trustRates: true` is set here and by
 * the SERVER from the stored parent only; a request can never carry it (the route's body is a strict object). A take on a line the parent does not have,
 * twice on one line, or not above zero is `credit_line_invalid` (the engine's own code: `src/tax` is held to 100 % and gains no new code here). There is no cap: a debit note adds.
 */
export function debitNoteInput(
  parent: { readonly computed: ComputedDocument; readonly recipientStatus: RecipientStatus },
  takes: readonly NoteTake[],
  documentDate: CalendarDate,
): DebitInput {
  const errors: TaxIssue[] = [];
  const seen = new Set<number>();
  const lines: LineInput[] = [];
  takes.forEach((t, i) => {
    const line = Number.isSafeInteger(t.line)
      ? parent.computed.lines.find((l) => l.index === t.line)
      : undefined;
    if (!line || seen.has(t.line) || !Number.isSafeInteger(t.taxableMinor) || t.taxableMinor <= 0) {
      errors.push({ code: "credit_line_invalid", path: ["request", "lines", i] });
      return;
    }
    seen.add(t.line);
    lines.push({ sac: line.sac, qtyMilli: 1000, rateMinor: t.taxableMinor, gstRateBp: line.gstRateBp });
  });
  if (takes.length === 0) errors.push({ code: "credit_empty", path: ["request"] });
  if (errors.length > 0) return { ok: false, errors };
  const rate = parent.computed.fxRateMicros;
  return {
    ok: true,
    input: {
      currency: parent.computed.currency,
      documentDate,
      supply: parent.computed.supply,
      recipientStatus: parent.recipientStatus,
      trustRates: true,
      lines,
      fx: rate === null ? null : { rateMicros: rate },
    },
  };
}

// ---- IMS status (Q14, LD46; VERIFY WITH CA/LEGAL) ---------------------------------------------------------------------------------------------

export const IMS_STATUSES = ["pending", "accepted", "rejected", "not_applicable"] as const;
export type ImsStatus = (typeof IMS_STATUSES)[number];

/**
 * The twin of the `documents_ims_status_update` trigger (a db test compares them move by move): a credit note gets `pending` (the parent's client is GST registered)
 * or `not_applicable` once, at its issue (`atIssue`); after that only `pending` moves, once, to `accepted` or `rejected`. Nothing else changes it.
 */
export function canSetImsStatus(from: string | null, to: string, atIssue: boolean): boolean {
  if (from === to) return false;
  if (atIssue) return from === null && (to === "pending" || to === "not_applicable");
  return from === "pending" && (to === "accepted" || to === "rejected");
}

/** The status a credit note is issued with: `pending` when its parent's client is GST registered (it answers in the GST portal), else `not_applicable`. */
export const imsStatusAtIssue = (recipientStatus: string): "pending" | "not_applicable" =>
  recipientStatus === "registered" ? "pending" : "not_applicable";

// ---- what the stored credits add up to (LD40) -------------------------------------------------------------------------------------------------------

export type CreditedRow = {
  readonly idx: number;
  readonly taxable: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly inrTaxable: number;
  readonly inrCgst: number;
  readonly inrSgst: number;
  readonly inrIgst: number;
};
export type CreditedTotals = { readonly total: number; readonly totalInr: number; readonly count: number };

/**
 * `CreditedSoFar` from what the `CREDITED_SO_FAR_SQL` statements returned (per original line, and the totals). A row for a line the original does not have, or a
 * number that is not a whole number, is `null`: the stored figures are damaged and the caller refuses (`credit_shape_mismatch`), never guesses. `usesInr`: the
 * original is a USD invoice with an INR view.
 */
export function creditedSoFarOf(
  original: Pick<ComputedDocument, "lines" | "fxRateMicros">,
  rows: readonly CreditedRow[],
  totals: CreditedTotals,
): CreditedSoFar | null {
  const n = original.lines.length;
  const lines: CreditedLine[] = Array.from({ length: n }, () => ({
    taxableMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
  }));
  const inrLines: CreditedLine[] = Array.from({ length: n }, () => ({
    taxableMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
  }));
  const posOf = new Map(original.lines.map((l, i) => [l.index, i] as const));
  for (const r of rows) {
    const i = posOf.get(r.idx);
    const all = [r.taxable, r.cgst, r.sgst, r.igst, r.inrTaxable, r.inrCgst, r.inrSgst, r.inrIgst];
    if (i === undefined || !all.every(Number.isSafeInteger)) return null;
    lines[i] = { taxableMinor: r.taxable, cgstMinor: r.cgst, sgstMinor: r.sgst, igstMinor: r.igst };
    inrLines[i] = {
      taxableMinor: r.inrTaxable,
      cgstMinor: r.inrCgst,
      sgstMinor: r.inrSgst,
      igstMinor: r.inrIgst,
    };
  }
  if (!Number.isSafeInteger(totals.total) || !Number.isSafeInteger(totals.totalInr)) return null;
  return {
    lines,
    creditedTotalMinor: totals.total,
    ...(original.fxRateMicros !== null ? { inr: { lines: inrLines, totalMinor: totals.totalInr } } : {}),
  };
}

/** The same sums worked out in JS from the stored notes' computed documents (what the SQL `json_each` sum must equal: a test compares them; M6 may reuse it). */
export function creditedSumOf(notes: readonly ComputedDocument[]): {
  rows: CreditedRow[];
  totals: CreditedTotals;
} {
  const by = new Map<number, { -readonly [K in keyof CreditedRow]: CreditedRow[K] }>();
  let total = 0;
  let totalInr = 0;
  for (const c of notes) {
    total += c.totalMinor;
    totalInr += c.inr?.totalMinor ?? 0;
    for (const l of c.lines) {
      const r = by.get(l.index) ?? {
        idx: l.index,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        inrTaxable: 0,
        inrCgst: 0,
        inrSgst: 0,
        inrIgst: 0,
      };
      r.taxable += l.taxableMinor;
      r.cgst += l.cgstMinor;
      r.sgst += l.sgstMinor;
      r.igst += l.igstMinor;
      r.inrTaxable += l.inr?.taxableMinor ?? 0;
      r.inrCgst += l.inr?.cgstMinor ?? 0;
      r.inrSgst += l.inr?.sgstMinor ?? 0;
      r.inrIgst += l.inr?.igstMinor ?? 0;
      by.set(l.index, r);
    }
  }
  return {
    rows: [...by.values()].sort((a, b) => a.idx - b.idx),
    totals: { total, totalInr, count: notes.length },
  };
}

export type { CreditRequest };
