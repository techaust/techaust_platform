// Invoice rules, pure (M5.1; ADM-INV-01..04, -07, ADM-APR-01/02; M5.2: ADM-INV-06, -08, -10, -18). No I/O, no zod, no floats. Error and blocker codes
// only: the words are the screens'. EVERY RULE HERE IS A RESEARCHED DEFAULT: Researched 2026-10-28, Rule 48(2) CGST Rules (08-C RA-07) (Rule 46, Rule 47, Rule 48, GSTR-1 Table 13, 08-A §3 and §4).
//
//   - which types can be issued now (the tax invoice, the export invoice and the proforma; credit and debit notes wait for M5.3),
//   - the status flow (the twin of the `documents_invoice_status_flow` trigger, which is GENERATED from a pinned copy of this table, and a db
//     test proves both agree move by move),
//   - the blockers: what stops an issue (the statutory list of LD20, as the configurable checklist of ADM-INV-06: `INVOICE_CHECKLIST`),
//   - the void rule of Q1, the due date, the IST day and FY of an issue, and the Table 13 summary of the documents issued.
// The export endorsement, the LUT helpers, the proforma notice and the exchange-rate helpers (`export-invoice.ts`, `fx.ts`) are exported from here.
import { addDays, fyOf, istDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { type ExportRoute, type Lut, lutFor } from "./export-invoice.ts";
import { fxDateVerdict } from "./fx.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { NoteOf } from "./notes.ts";
import type { Series } from "./numbering.ts";

export * from "./export-invoice.ts";
export * from "./fx.ts";
export * from "./notes.ts";
export * from "./reminders.ts";

// ---- types -------------------------------------------------------------------------------------------------------------------------

/** The invoice-family types the status flow covers (receipts and vouchers have no status of their own here: M6). */
export const INVOICE_FLOW_TYPES = [
  "proforma",
  "tax_invoice",
  "export_invoice",
  "credit_note",
  "debit_note",
] as const;
export type InvoiceFlowType = (typeof INVOICE_FLOW_TYPES)[number];
export const isInvoiceFlowType = (v: unknown): v is InvoiceFlowType =>
  (INVOICE_FLOW_TYPES as readonly unknown[]).includes(v);

/** The types that issue (M5.3: the credit note and the debit note join the tax invoice, the export invoice and the proforma). */
export const INVOICE_ISSUABLE_TYPES = [
  "tax_invoice",
  "export_invoice",
  "proforma",
  "credit_note",
  "debit_note",
] as const;
export type InvoiceIssuableType = (typeof INVOICE_ISSUABLE_TYPES)[number];
export const isInvoiceIssuableType = (v: unknown): v is InvoiceIssuableType =>
  (INVOICE_ISSUABLE_TYPES as readonly unknown[]).includes(v);

/** The numbering series of each invoice-flow type (the twin of db `SERIES_OF`, which a db test compares). */
export const INVOICE_SERIES_OF: Readonly<Record<InvoiceFlowType, Series>> = {
  proforma: "proforma",
  tax_invoice: "invoice",
  export_invoice: "export",
  credit_note: "creditNote",
  debit_note: "debitNote",
};

/** The statuses of an issued document that the ledger (M5.3, M6) moves between. */
export const LEDGER_STATUSES = [
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
] as const;

// ---- the status flow ---------------------------------------------------------------------------------------------------------------

export type InvoiceMove = {
  readonly from: string;
  readonly to: string;
  /** Only these types may make the move (absent: every flow type). */
  readonly types?: readonly InvoiceFlowType[];
  /** Q1: the move needs nothing paid, nothing credited and no issued document that names this one as its parent. */
  readonly unsettled?: true;
};

/**
 * Every move an invoice-family document's status can make. `void` and `converted` are terminal; anything not listed is refused:
 *   draft -> issued; issued -> void (only while unsettled); one ledger status -> another (M5.3 and M6 move them);
 *   a proforma that was issued (or part or fully paid) -> converted (M5.2 uses it).
 * The SQL trigger is generated from this list (`packages/db/src/triggers.ts`).
 */
export const INVOICE_STATUS_FLOW: readonly InvoiceMove[] = [
  { from: "draft", to: "issued" },
  // M5.3 (Q31, LD47): a credit or debit note is never voided; a wrong one is corrected by another note. Trigger `documents_note_no_void` (0042) is its twin.
  { from: "issued", to: "void", unsettled: true, types: ["proforma", "tax_invoice", "export_invoice"] },
  ...LEDGER_STATUSES.flatMap((from) =>
    LEDGER_STATUSES.filter((to) => to !== from).map((to): InvoiceMove => ({ from, to })),
  ),
  ...(["issued", "partially_paid", "paid"] as const).map(
    (from): InvoiceMove => ({ from, to: "converted", types: ["proforma"] }),
  ),
];

export type MoveFacts = {
  readonly paidMinor: number;
  readonly creditedMinor: number;
  /** An issued (frozen) document names this one as its parent (a credit or debit note; a tax invoice of a proforma). */
  readonly hasIssuedChild: boolean;
};
const NO_FACTS: MoveFacts = { paidMinor: 0, creditedMinor: 0, hasIssuedChild: false };

/** Whether a document of `type` may go from status `from` to `to` (the twin of the trigger). A move to the same status is not a move. */
export function canMoveInvoiceStatus(
  type: string,
  from: string,
  to: string,
  facts: MoveFacts = NO_FACTS,
): boolean {
  if (!isInvoiceFlowType(type) || from === to) return false;
  return INVOICE_STATUS_FLOW.some(
    (m) =>
      m.from === from &&
      m.to === to &&
      (m.types === undefined || m.types.includes(type)) &&
      (m.unsettled !== true || (facts.paidMinor === 0 && facts.creditedMinor === 0 && !facts.hasIssuedChild)),
  );
}

// ---- the IST day, the FY and the due date of an issue (LD19, Q3) ------------------------------------------------------------------------

/** The invoice date: the IST day of the issue instant (Q3: never backdated, never in the future). Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05) (Rule 46(c), Rule 47). */
export const issueDateOf = (nowMs: number): string => toIsoDate(istDate(nowMs));

/** The FY token ("2627") the number is taken in: judged by the IST date, so 31 March 23:59 IST is still the old FY. */
export const issueFyOf = (nowMs: number): string => fyOf(nowMs).token;

/** The due date: the issue date plus the client's own terms in days, else the settings' (Net 7 by default). */
export function dueDateOf(issueDate: string, clientDays: number | null, settingsDays: number): string {
  const from = parseIsoDate(issueDate);
  const days = clientDays ?? settingsDays;
  if (!from || !Number.isSafeInteger(days) || days < 0)
    throw new RangeError("Invalid issue date or payment terms");
  return toIsoDate(addDays(from, days));
}

// ---- what stops an issue (LD20; M5.2 makes it the configurable checklist) ---------------------------------------------------------------

export const ISSUE_BLOCKER_CODES = [
  "supplier_legal_name",
  "supplier_trade_name",
  "supplier_address",
  "supplier_gstin",
  "supplier_state",
  "recipient_legal_name",
  "recipient_address",
  "recipient_gstin",
  "recipient_state",
  "no_lines",
  "line_sac_missing",
  "line_description_missing",
  // M5.4 (early check, finding 4): a line whose text still carries a marked `[Placeholder` (copy the owner has not approved) is never issued, by anyone
  "line_text_placeholder",
  "computed_errors",
  "zero_total",
  "reverse_charge_text",
  "currency_mismatch",
  "type_not_allowed",
  // M5.2
  "country_missing",
  "fx_missing",
  "fx_date_invalid",
  // Research round 2026-10-28 (08-C RA-21): a rate of an earlier day was typed without the statement that no rate was published on the day of supply
  "fx_same_day_exists",
  "lut_missing",
  "unregistered_high_value",
  "bank_missing",
  "swift_missing",
] as const;
export type IssueBlockerCode = (typeof ISSUE_BLOCKER_CODES)[number];
/**
 * `line`: the 1-based position of the line the blocker is about (`line_sac_missing`, `line_description_missing`, `line_text_placeholder`). `fy`: the FY token a missing LUT is
 * about (`lut_missing`). `date`: the ISO date the rate is for (`fx_missing`) or that it was judged against (`fx_date_invalid`).
 */
export type IssueBlocker = {
  readonly code: IssueBlockerCode;
  readonly line?: number;
  readonly fy?: string;
  readonly date?: string;
};

// ---- the mandatory-field checklist (ADM-INV-06, Q10; Rule 46; Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)) --------------------------------------------------------

/** The document types the checklist is about (the tax invoice, the export invoice and the proforma). */
export type ChecklistType = "tax_invoice" | "export_invoice" | "proforma";

/** What the Owner may switch (Settings > Tax, stored in the `tax` row, LD31): only these two keys; the locked items are never stored. */
export type ChecklistSettings = {
  readonly bankDetails: boolean;
  readonly paymentLink: false;
  /** A house rule too (07-S §3): absent is on. It owns no blocker (the signature is optional on an electronic invoice, Rule 46(q) proviso), so switching it off is the Owner's record of the choice. */
  readonly signatory?: boolean | undefined;
};
export const DEFAULT_CHECKLIST: ChecklistSettings = { bankDetails: true, paymentLink: false };

export type ChecklistItem = {
  readonly id: string;
  /** Required by law (or a layout fact): it cannot be switched off. */
  readonly locked: boolean;
  /** False while the thing it asks for does not exist (a payment link until online payment arrives, M6). */
  readonly available: boolean;
  readonly appliesTo: readonly ChecklistType[];
  /** The blockers this item owns: with the item off, they are not raised. A layout fact owns none. */
  readonly blockers: readonly IssueBlockerCode[];
};

const ALL_TYPES: readonly ChecklistType[] = ["tax_invoice", "export_invoice", "proforma"];

/**
 * The 18 lines of 07-S §3, in their order. Five are layout facts the PDF always prints (no data check); "ORIGINAL FOR RECIPIENT" does not apply to
 * a proforma; the export items apply to the export invoice; the bank item is the one switch, and the payment link is not available yet.
 */
export const INVOICE_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "companyNames",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["supplier_legal_name", "supplier_trade_name"],
  },
  {
    id: "companyAddressGstin",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["supplier_address", "supplier_gstin", "supplier_state"],
  },
  { id: "invoiceNumberDate", locked: true, available: true, appliesTo: ALL_TYPES, blockers: [] },
  {
    id: "clientNameAddress",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["recipient_legal_name", "recipient_address"],
  },
  { id: "clientGstin", locked: true, available: true, appliesTo: ALL_TYPES, blockers: ["recipient_gstin"] },
  { id: "placeOfSupply", locked: true, available: true, appliesTo: ALL_TYPES, blockers: ["recipient_state"] },
  {
    id: "lineDetails",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["no_lines", "line_description_missing", "line_text_placeholder", "line_sac_missing"],
  },
  { id: "discountTaxable", locked: true, available: true, appliesTo: ALL_TYPES, blockers: [] },
  {
    id: "taxPerType",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["computed_errors", "zero_total"],
  },
  { id: "totalsWords", locked: true, available: true, appliesTo: ALL_TYPES, blockers: [] },
  {
    id: "reverseCharge",
    locked: true,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["reverse_charge_text"],
  },
  { id: "signatory", locked: false, available: true, appliesTo: ALL_TYPES, blockers: [] },
  {
    id: "originalForRecipient",
    locked: true,
    available: true,
    appliesTo: ["tax_invoice", "export_invoice"],
    blockers: [],
  },
  {
    id: "exportDeclaration",
    locked: true,
    available: true,
    appliesTo: ["export_invoice"],
    blockers: ["lut_missing"],
  },
  {
    id: "countryOfDestination",
    locked: true,
    available: true,
    appliesTo: ["export_invoice"],
    blockers: ["country_missing"],
  },
  {
    id: "bankDetails",
    locked: false,
    available: true,
    appliesTo: ALL_TYPES,
    blockers: ["bank_missing", "swift_missing"],
  },
  { id: "paymentLink", locked: false, available: false, appliesTo: ALL_TYPES, blockers: [] },
  {
    id: "unregisteredHighValue",
    locked: true,
    available: true,
    appliesTo: ["tax_invoice"],
    blockers: ["unregistered_high_value"],
  },
];

/** The keys the Owner may store (an item that is neither locked nor unavailable). */
export const CHECKLIST_SWITCHABLE = ["bankDetails"] as const;

/**
 * The house rules of the checklist (owner 2026-10-28, 07-S §3; Researched 2026-10-28, Rule 46 CGST Rules, 08-C RA-05 and RA-06): items GST law does not require, which the Owner may switch off:
 * bank details, the payment link or QR, and the authorised signatory (an invoice issued electronically needs no signature). Every other item is statutory and locked; the Settings API
 * refuses to switch one off with `checklist_item_statutory`.
 */
export const HOUSE_RULE_ITEMS = ["bankDetails", "paymentLink", "signatory"] as const;
export const isHouseRuleItem = (id: string): boolean => (HOUSE_RULE_ITEMS as readonly string[]).includes(id);

/** Whether a checklist item is on for these settings: locked items always, `bankDetails` as stored, `paymentLink` never (not available). */
export function checklistItemOn(item: ChecklistItem, s: ChecklistSettings): boolean {
  if (item.id === "bankDetails") return s.bankDetails;
  if (item.id === "paymentLink") return false;
  if (item.id === "signatory") return s.signatory !== false;
  return true;
}

export type IssueFacts = {
  readonly type: string;
  readonly currency: string;
  readonly clientCurrency: string;
  readonly supplier: {
    readonly legalName: string | null;
    readonly tradeName: string | null;
    readonly address: string | null;
    readonly gstin: string | null;
    readonly stateCode: string | null;
  };
  readonly recipient: {
    readonly legalName: string | null;
    /** The billing address: its first line is what a document prints first. */
    readonly addressLine1: string | null;
    readonly gstStatus: "registered" | "unregistered" | "overseas";
    readonly gstin: string | null;
    readonly stateCode: string | null;
    /** M5.2: the country's English name (frozen from `Intl.DisplayNames` at issue, LD32); null when it cannot be named (an overseas client then has no country). */
    readonly countryName: string | null;
  };
  readonly lines: readonly { readonly sac: string | null; readonly description: string }[];
  /** How many errors the tax engine gave (0 = it computed). */
  readonly taxErrorCount: number;
  /** The computed total in minor units; null when the document does not compute. */
  readonly totalMinor: number | null;
  /** The computed total in INR minor units: the total itself for an INR document, the INR view of a USD one (null when there is none). */
  readonly totalInrMinor: number | null;
  readonly reverseChargeText: string | null;
  /** M5.2: the rate typed on the draft (null: none) and the day it is judged against (the issue day; for an advance invoice the day the money arrived). */
  readonly fx: {
    readonly value: {
      readonly rateMicros: number;
      readonly date: string;
      readonly source: string;
      /** The Owner stated that no rate was published on the day of supply (Q24). */
      readonly noRateThatDay?: boolean;
    } | null;
    readonly refDate: string;
    readonly maxAgeDays: number;
  };
  /** M5.2: for an export invoice, its route, the FY it is issued in (the IST issue day) and the saved letters; null for every other type. */
  readonly export: {
    readonly mode: ExportRoute;
    readonly issueFy: string;
    readonly luts: readonly Lut[];
  } | null;
  /** M5.2: an active INR bank account and an active USD (SWIFT) account exist. */
  readonly bank: { readonly inr: boolean; readonly swift: boolean };
  /** M5.2: this is the tax invoice made for money already received (Q9): it is paid, so it has no bank block to check. */
  readonly advance: boolean;
  /** `tax.b2cDetailsThresholdInrMinor` (Q25: compared with the total including GST). */
  readonly b2cThresholdInrMinor: number;
};

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";
const SAC = /^\d{6}$/;

/** The checklist item that owns each blocker (a blocker no item owns is never switched off). */
const OWNER_OF: ReadonlyMap<IssueBlockerCode, ChecklistItem> = new Map(
  INVOICE_CHECKLIST.flatMap((item) => item.blockers.map((code) => [code, item] as const)),
);

/**
 * Everything that stops a draft from being issued, as codes (empty = it can be issued): the statutory list of Rule 46 (Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)) as the
 * checklist of ADM-INV-06. Order is stable: supplier, recipient, lines, totals, the type, then the M5.2 items (country, exchange rate, LUT, the
 * ₹50,000 rule, bank). A blocker whose checklist item does not apply to the type, or is switched off (`bankDetails` only), is not raised;
 * blockers no item owns (the exchange rate, the currency, the type) always apply to the types they are about. A proforma has no exchange rate, no
 * LUT and no `type_not_allowed`; the advance invoice skips the bank items.
 */
export function issueBlockers(
  f: IssueFacts,
  checklist: ChecklistSettings = DEFAULT_CHECKLIST,
): IssueBlocker[] {
  const out: IssueBlocker[] = [];
  const add = (code: IssueBlockerCode, extra: Partial<Omit<IssueBlocker, "code">> = {}) => {
    const item = OWNER_OF.get(code);
    if (item) {
      if (!(item.appliesTo as readonly string[]).includes(f.type)) return;
      if (!checklistItemOn(item, checklist)) return;
    }
    out.push({ code, ...extra });
  };
  if (blank(f.supplier.legalName)) add("supplier_legal_name");
  if (blank(f.supplier.tradeName)) add("supplier_trade_name");
  if (blank(f.supplier.address)) add("supplier_address");
  if (blank(f.supplier.gstin)) add("supplier_gstin");
  if (blank(f.supplier.stateCode)) add("supplier_state");
  if (blank(f.recipient.legalName)) add("recipient_legal_name");
  if (blank(f.recipient.addressLine1)) add("recipient_address");
  if (f.recipient.gstStatus === "registered" && blank(f.recipient.gstin)) add("recipient_gstin");
  if (f.recipient.gstStatus !== "overseas" && blank(f.recipient.stateCode)) add("recipient_state");
  if (f.lines.length === 0) add("no_lines");
  f.lines.forEach((l, i) => {
    if (blank(l.description)) add("line_description_missing", { line: i + 1 });
    else if (l.description.includes("[Placeholder")) add("line_text_placeholder", { line: i + 1 });
    if (l.sac === null || !SAC.test(l.sac)) add("line_sac_missing", { line: i + 1 });
  });
  if (f.taxErrorCount > 0) add("computed_errors");
  else if (f.totalMinor === null || f.totalMinor <= 0) add("zero_total");
  if (blank(f.reverseChargeText)) add("reverse_charge_text");
  if (f.currency !== f.clientCurrency) add("currency_mismatch");
  const overseas = f.recipient.gstStatus === "overseas";
  if ((f.type === "tax_invoice" && overseas) || (f.type === "export_invoice" && !overseas))
    add("type_not_allowed");

  // M5.2. The country of an export (Rule 46(o)), named once at issue.
  if (f.type === "export_invoice" && blank(f.recipient.countryName)) add("country_missing");
  // The exchange rate of a USD tax or export invoice (Rule 34(2); Q7, Q24; Researched 2026-10-28, 08-C RA-21): typed, and the rate of the day of supply, or the last one published before it
  // when the Owner states that none was published that day (`fxDateVerdict`).
  if (f.currency === "USD" && (f.type === "tax_invoice" || f.type === "export_invoice")) {
    if (f.fx.value === null) add("fx_missing", { date: f.fx.refDate });
    else {
      const verdict = fxDateVerdict(
        f.fx.value.date,
        f.fx.refDate,
        f.fx.maxAgeDays,
        f.fx.value.noRateThatDay === true,
      );
      if (verdict === "same_day_exists") add("fx_same_day_exists", { date: f.fx.refDate });
      else if (verdict === "invalid") add("fx_date_invalid", { date: f.fx.refDate });
    }
  }
  // The letter of undertaking of the FY of ISSUE (a draft saved on 31 March and issued on 1 April needs the new year's), on the LUT route only.
  if (f.type === "export_invoice" && f.export !== null && f.export.mode === "lut") {
    if (lutFor(f.export.issueFy, f.export.luts) === null) add("lut_missing", { fy: f.export.issueFy });
  }
  // Rule 46(e), Q25: an unregistered recipient at or above the threshold needs name, address and state (the total includes GST).
  if (
    f.recipient.gstStatus === "unregistered" &&
    f.totalInrMinor !== null &&
    f.totalInrMinor >= f.b2cThresholdInrMinor &&
    (blank(f.recipient.legalName) || blank(f.recipient.addressLine1) || blank(f.recipient.stateCode))
  )
    add("unregistered_high_value");
  // The bank block the invoice prints: an INR account for an INR document, a SWIFT account for a USD one (the advance invoice is paid: none).
  if (!f.advance) {
    if (f.currency === "INR" && !f.bank.inr) add("bank_missing");
    if (f.currency === "USD" && !f.bank.swift) add("swift_missing");
  }
  return out;
}

// ---- void (Q1; LD7) ------------------------------------------------------------------------------------------------------------------------

export const VOID_BLOCKER_CODES = [
  "not_issued",
  "already_void",
  "has_payment",
  "has_credit",
  "has_child_document",
  "already_emailed",
  "return_period_closed",
] as const;
export type VoidBlockerCode = (typeof VOID_BLOCKER_CODES)[number];

export type VoidFacts = {
  readonly status: string;
  readonly paidMinor: number;
  readonly creditedMinor: number;
  readonly hasIssuedChild: boolean;
  /** The invoice was emailed to the client (a `document_sends` row exists; M5.4 writes them). */
  readonly emailed: boolean;
  /** The invoice's issue date (IST day) and today's IST day: Q23 lets a void happen only inside the calendar month of issue. */
  readonly issueDate: string | null;
  readonly today: string;
  /** M5.2 (LD28): a proforma is not a tax document, so the month rule of Q23 does not apply to it (OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?). Absent: any other type. */
  readonly type?: string;
};

/**
 * Q1 (OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?, 08-A §4): an issued invoice can be voided only while it has not been emailed to the client and has no payment and no
 * credit or debit note; after that, a credit note is the correction. Q23: and only within the IST calendar month of issue (the GST return period of
 * an invoice is the month of its date), after which a credit note is the correction too; a proforma has no return period (LD28). The number stays and
 * the record stays (Rule 56(8)). Codes only. OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note? (the batch page offers both forms of the Q23 rule).
 */
export function voidBlockers(f: VoidFacts): VoidBlockerCode[] {
  if (f.status === "void") return ["already_void"];
  const out: VoidBlockerCode[] = [];
  if (f.status !== "issued") out.push("not_issued");
  if (f.paidMinor > 0) out.push("has_payment");
  if (f.creditedMinor > 0) out.push("has_credit");
  if (f.hasIssuedChild) out.push("has_child_document");
  if (f.emailed) out.push("already_emailed");
  if (f.type !== "proforma" && f.issueDate !== null && f.issueDate.slice(0, 7) !== f.today.slice(0, 7))
    out.push("return_period_closed");
  return out;
}

// ---- GSTR-1 Table 13: documents issued (M5.1; M5.5 reuses it) -------------------------------------------------------------------------------

export type IssuedRow = {
  readonly series: string;
  readonly fy: string;
  readonly number: number;
  readonly numberDisplay: string;
  /** A voided document keeps its number and counts as cancelled. */
  readonly void: boolean;
};

export type IssuedSummary = {
  readonly series: string;
  readonly fy: string;
  /** The first and the last number of the range, as printed. */
  readonly from: string;
  readonly to: string;
  readonly total: number;
  readonly cancelled: number;
  readonly net: number;
};

/**
 * Per series and FY: the first and last number issued, how many, how many were cancelled (voided) and the net (OPEN (08-C RA-10): may a tax invoice issued in error and never delivered be shown as cancelled in GSTR-1 Table 13 with no credit note?, 08-A §4:
 * Table 13 lists each document nature with from and to, total, cancelled and net issued). Input order does not matter; the result is sorted
 * by series, then FY.
 */
export function documentsIssuedSummary(rows: readonly IssuedRow[]): IssuedSummary[] {
  const groups = new Map<string, IssuedRow[]>();
  for (const r of rows) {
    const key = `${r.series}\u0000${r.fy}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: IssuedSummary[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.number - b.number);
    const first = sorted[0];
    const last = sorted.at(-1);
    if (!first || !last) continue;
    const cancelled = sorted.filter((r) => r.void).length;
    out.push({
      series: first.series,
      fy: first.fy,
      from: first.numberDisplay,
      to: last.numberDisplay,
      total: sorted.length,
      cancelled,
      net: sorted.length - cancelled,
    });
  }
  return out.sort((a, b) =>
    a.series < b.series ? -1 : a.series > b.series ? 1 : a.fy < b.fy ? -1 : a.fy > b.fy ? 1 : 0,
  );
}

// ---- the frozen snapshot of an issued invoice (LD4; M5.1) -------------------------------------------------------------------------------------

export type InvoiceSnapshotInput = {
  readonly document: {
    readonly type: string;
    readonly clientId: string;
    readonly currency: string;
    readonly issueDate: string;
    /** M5.3: a credit note has no due date (nothing is owed on it): null. */
    readonly dueDate: string | null;
    /** The content hash of the draft: it covers the lines, the totals and the supply. */
    readonly contentSha256: string;
    /** The invoice footer notes the document was pinned to (the newest `invoice` terms at issue), or null when there were none. */
    readonly termsRef: { readonly id: string; readonly version: number; readonly sha256: string } | null;
    readonly exportMode: string | null;
  };
  readonly supply: {
    readonly type: string;
    readonly placeOfSupplyCode: string;
    readonly supplierStateCode: string;
  };
  readonly recipient: unknown;
  /** The supplier block: the company, the bank block, the signature REFERENCE and the sender (db `InvoiceIssuerSnapshot`). */
  readonly issuer: unknown;
  /** The SHA-256 of the exact `computed` JSON text stored in `documents.computed`. */
  readonly computedSha256: string;
  /**
   * M5.2 (LD25): the new header keys. Each appears ONLY on the types that need it, so a tax invoice sealed by M5.1 hashes to the same value as before
   * (the key is absent, not null) and a parser accepts their absence.
   *   export:   an export invoice: the route, the endorsement as frozen, the LUT (LUT route), the country, and the optional declaration block pinned;
   *   fx:       every USD tax or export invoice (not a proforma): the rate the INR values were worked out at;
   *   proforma: a proforma: the notice it carries;
   *   advance:  the tax invoice made for money received (Q9): the proforma it settles and the receipt row.
   */
  readonly export?: {
    readonly mode: ExportRoute;
    readonly endorsement: string;
    readonly lut: { readonly fy: string; readonly arn: string } | null;
    readonly countryCode: string;
    readonly countryName: string;
    readonly declarationRef: {
      readonly id: string;
      readonly version: number;
      readonly sha256: string;
    } | null;
    /** The pinned note's text, frozen at issue (absent when no note is pinned); its SHA-256 is `declarationRef.sha256`. */
    readonly declarationText?: string;
  };
  readonly fx?: {
    readonly rateMicros: number;
    readonly date: string;
    readonly source: string;
    /** Q24 (08-C RA-21): present (true) only when the Owner stated that no rate was published on the day of supply; frozen with the rate, so an older seal keeps its hash. */
    readonly noRateThatDay?: true;
  };
  readonly proforma?: { readonly notice: string };
  readonly advance?: {
    readonly proformaId: string;
    readonly proformaNumber: string;
    readonly proformaIssueDate: string;
    readonly receivedOn: string;
    readonly receiptId: string;
    /**
     * Q37 (07-S section 9): present only when the proforma was under LUT, this invoice was issued with IGST and no LUT was in place for the FY of the receipt day;
     * the FY as people read it ("2027-28"). Absent on every other advance invoice, so older seals keep their hash.
     */
    readonly igstNoLutFy?: string;
  };
  /**
   * M5.3 (LD39): a credit or debit note's request, its reason and the facts of the invoice it is against, as frozen with it (`header_extras.noteOf`). Present
   * ONLY on a note, so every invoice sealed before M5.3 keeps its hash.
   */
  readonly noteOf?: NoteOf;
};

/**
 * The sealed form of an issued invoice: `{v: 3, kind: "invoice", header}`. The NUMBER, series, FY and the instant of issue are not in it: they
 * are taken inside the issue batch, after this is hashed; the write-once envelope in R2 pairs them with it (as M4.4's does for a proposal, LD4).
 * `snapshot_sha256 = sha256Hex(canonicalJson(invoiceSnapshot(i)))`.
 */
export const invoiceSnapshot = (i: InvoiceSnapshotInput) => ({ v: 3, kind: "invoice", header: i });

/** The hex SHA-256 stored as `documents.snapshot_sha256` of an issued invoice. */
export const invoiceSnapshotSha256 = (i: InvoiceSnapshotInput): Promise<string> =>
  sha256Hex(canonicalJson(invoiceSnapshot(i)));

// ---- which milestone an invoice may be drafted from (M5.1 re-check A) -------------------------------------------------------------------------

/**
 * A milestone a draft invoice may be made from: one that is Ready to bill, or the ADVANCE (the first instalment Start project marked with
 * `is_advance`) while it is still pending: voiding the advance's invoice sends it back to `pending`, and it must be billable again. The mark
 * is stored, so reordering or deleting milestones never moves it. The worker, its SQL twin and the SPA all use this one rule.
 */
export const milestoneBillableRule = (m: { status: string; isAdvance: boolean }): boolean =>
  m.status === "ready_to_bill" || (m.status === "pending" && m.isAdvance);

/** The SQL twin of `milestoneBillableRule`, for a statement on `milestones` alone. */
export const MILESTONE_BILLABLE_SQL = "(status = 'ready_to_bill' OR (status = 'pending' AND is_advance = 1))";
