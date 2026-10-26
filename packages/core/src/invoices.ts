// Invoice rules, pure (M5.1; ADM-INV-01..04, -07, ADM-APR-01/02). No I/O, no zod, no floats. Error and blocker codes only: the words are the
// screens'. EVERY RULE HERE IS A RESEARCHED DEFAULT: VERIFY WITH CA/LEGAL (Rule 46, Rule 47, Rule 48, GSTR-1 Table 13, 08-A §3 and §4).
//
//   - which types can be issued now (only the domestic tax invoice; export and proforma wait for M5.2, credit and debit notes for M5.3),
//   - the status flow (the twin of the `documents_invoice_status_flow` trigger, which is GENERATED from this table, and a db test proves
//     both agree move by move),
//   - the blockers: what stops an issue (the minimal statutory list of LD20; M5.2 makes it the configurable checklist),
//   - the void rule of Q1, the due date, the IST day and FY of an issue, and the Table 13 summary of the documents issued.
import { addDays, fyOf, istDate, parseIsoDate, toIsoDate } from "./dates.ts";
import { canonicalJson, sha256Hex } from "./hash.ts";
import type { Series } from "./numbering.ts";

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

/** LD2: M5.1 issues the domestic tax invoice only. Export and proforma answer `type_not_issuable` until M5.2, credit and debit notes until M5.3. */
export const INVOICE_ISSUABLE_TYPES = ["tax_invoice"] as const;
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
  { from: "issued", to: "void", unsettled: true },
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

/** The invoice date: the IST day of the issue instant (Q3: never backdated, never in the future). VERIFY WITH CA/LEGAL (Rule 46(c), Rule 47). */
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
  "supplier_legal_name_missing",
  "supplier_trade_name_missing",
  "supplier_address_missing",
  "supplier_gstin_missing",
  "supplier_state_missing",
  "recipient_legal_name_missing",
  "recipient_address_missing",
  "recipient_gstin_missing",
  "recipient_state_missing",
  "no_lines",
  "sac_missing",
  "description_missing",
  "tax_errors",
  "total_zero",
  "reverse_charge_text_missing",
  "currency_mismatch",
  "type_not_for_client",
] as const;
export type IssueBlockerCode = (typeof ISSUE_BLOCKER_CODES)[number];
/** `line`: the 1-based position of the line the blocker is about (`sac_missing`, `description_missing`). */
export type IssueBlocker = { readonly code: IssueBlockerCode; readonly line?: number };

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
  };
  readonly lines: readonly { readonly sac: string | null; readonly description: string }[];
  /** How many errors the tax engine gave (0 = it computed). */
  readonly taxErrorCount: number;
  /** The computed total in minor units; null when the document does not compute. */
  readonly totalMinor: number | null;
  readonly reverseChargeText: string | null;
};

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";
const SAC = /^\d{6}$/;

/**
 * Everything that stops a draft from being issued, as codes (empty = it can be issued). The minimal statutory list of Rule 46 (VERIFY WITH
 * CA/LEGAL): the supplier's identity, the recipient's, a line with a description and a 6-digit SAC each, a computed total above zero (Q4),
 * the reverse-charge statement, the client's currency, and a type the client can have. Order is stable: supplier, recipient, lines, totals.
 */
export function issueBlockers(f: IssueFacts): IssueBlocker[] {
  const out: IssueBlocker[] = [];
  const add = (code: IssueBlockerCode, line?: number) =>
    out.push(line === undefined ? { code } : { code, line });
  if (blank(f.supplier.legalName)) add("supplier_legal_name_missing");
  if (blank(f.supplier.tradeName)) add("supplier_trade_name_missing");
  if (blank(f.supplier.address)) add("supplier_address_missing");
  if (blank(f.supplier.gstin)) add("supplier_gstin_missing");
  if (blank(f.supplier.stateCode)) add("supplier_state_missing");
  if (blank(f.recipient.legalName)) add("recipient_legal_name_missing");
  if (blank(f.recipient.addressLine1)) add("recipient_address_missing");
  if (f.recipient.gstStatus === "registered" && blank(f.recipient.gstin)) add("recipient_gstin_missing");
  if (f.recipient.gstStatus !== "overseas" && blank(f.recipient.stateCode)) add("recipient_state_missing");
  if (f.lines.length === 0) add("no_lines");
  f.lines.forEach((l, i) => {
    if (blank(l.description)) add("description_missing", i + 1);
    if (l.sac === null || !SAC.test(l.sac)) add("sac_missing", i + 1);
  });
  if (f.taxErrorCount > 0) add("tax_errors");
  else if (f.totalMinor === null || f.totalMinor <= 0) add("total_zero");
  if (blank(f.reverseChargeText)) add("reverse_charge_text_missing");
  if (f.currency !== f.clientCurrency) add("currency_mismatch");
  const overseas = f.recipient.gstStatus === "overseas";
  if ((f.type === "tax_invoice" && overseas) || (f.type === "export_invoice" && !overseas))
    add("type_not_for_client");
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
] as const;
export type VoidBlockerCode = (typeof VOID_BLOCKER_CODES)[number];

export type VoidFacts = {
  readonly status: string;
  readonly paidMinor: number;
  readonly creditedMinor: number;
  readonly hasIssuedChild: boolean;
  /** The invoice was emailed to the client (a `document_sends` row exists; M5.4 writes them). */
  readonly emailed: boolean;
};

/**
 * Q1 (VERIFY WITH CA/LEGAL, 08-A §4): an issued invoice can be voided only while it has not been emailed to the client and has no payment and no
 * credit or debit note; after that, a credit note is the correction. The number stays and the record stays (Rule 56(8)). Codes only.
 */
export function voidBlockers(f: VoidFacts): VoidBlockerCode[] {
  if (f.status === "void") return ["already_void"];
  const out: VoidBlockerCode[] = [];
  if (f.status !== "issued") out.push("not_issued");
  if (f.paidMinor > 0) out.push("has_payment");
  if (f.creditedMinor > 0) out.push("has_credit");
  if (f.hasIssuedChild) out.push("has_child_document");
  if (f.emailed) out.push("already_emailed");
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
 * Per series and FY: the first and last number issued, how many, how many were cancelled (voided) and the net (VERIFY WITH CA/LEGAL, 08-A §4:
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
    readonly dueDate: string;
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
