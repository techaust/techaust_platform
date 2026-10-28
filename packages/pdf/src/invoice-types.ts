// Types of the invoice envelope (the frozen copy an issued invoice's PDF is rendered from) and of its pre-formatted view (M5.1 stage B; LD4, LD10,
// LD11). Pure data; no I/O. The sealed header mirrors core's `InvoiceSnapshotInput` (`{v: 3, kind: "invoice", header}`); the envelope adds what the
// issue batch takes AFTER the hash (the number, series, FY and the instant of issue) and the content the PDF needs (the lines, the discount, the
// footer notes). A proposal's envelope is `types.ts`'s `Envelope` (format 1); this one is format 3 with `kind: "invoice"`.
import type { InvoiceSnapshotInput } from "@techaust/core/invoices";
import type { EnvLine, IssuerSnap, RecipientSnap } from "./types.ts";

/** The INR bank block frozen with the invoice (db `InvoiceBankBlock`). */
export type InvoiceBankSnap = {
  accountName: string;
  accountNo: string;
  ifsc: string | null;
  bankName: string;
  branch: string | null;
};

/** The SWIFT block of a USD invoice (M5.2; db `InvoiceSwiftBlock`); an M5.1 snapshot has none. The purpose code is the owner's RBI code (OPEN (08-C RB-06): which RBI purpose code fits our exports? the bank confirms it). */
export type InvoiceSwiftSnap = {
  accountName: string;
  accountNo: string;
  swift: string;
  bankName: string;
  branch: string | null;
  bankAddress: string | null;
  intermediary: string | null;
  purposeCode: string | null;
};

/** The signature as a REFERENCE (LD11): the content-addressed object in DOCS, never the bytes. */
export type InvoiceSignatureRef = { key: string; sha256: string; mime: string };

export type InvoiceIssuerSnap = {
  company: IssuerSnap["company"] & { phone?: string; principalPlace?: string };
  bank: { inr: InvoiceBankSnap | null; swift?: InvoiceSwiftSnap | null };
  signature: InvoiceSignatureRef | null;
  /** The Rule 46(p) statement exactly as it was issued (frozen and sealed; Researched 2026-10-28, Rules 46(p), 50 and 51 CGST Rules (08-C RA-26)). */
  reverseChargeText: string;
  sender: IssuerSnap["sender"];
};

export type InvoiceHeader = {
  document: {
    type: string;
    clientId: string;
    currency: string;
    issueDate: string;
    /** Null on a credit note (nothing is owed on it, M5.3); a string on every other invoice-family document. */
    dueDate: string | null;
    contentSha256: string;
    termsRef: { id: string; version: number; sha256: string } | null;
    exportMode: string | null;
  };
  supply: { type: string; placeOfSupplyCode: string; supplierStateCode: string };
  recipient: RecipientSnap;
  issuer: InvoiceIssuerSnap;
  computedSha256: string;
  /**
   * M5.2 (LD25): the optional keys, each present ONLY on the types that need it (an M5.1 envelope has none and still parses and verifies):
   * `export` (an export invoice: the endorsement as frozen, the LUT, the country), `fx` (a USD tax or export invoice), `proforma` (the notice),
   * `advance` (the invoice made for money received), and (M5.3) `noteOf`: a credit or debit note's request, reason and the facts of its invoice (required on a note,
   * refused on any other type). They mirror core's `InvoiceSnapshotInput`; the issue batch froze them in `documents.header_extras`.
   */
  export?: InvoiceHeaderExport;
  fx?: InvoiceHeaderFx;
  proforma?: InvoiceHeaderProforma;
  advance?: InvoiceHeaderAdvance;
  noteOf?: InvoiceHeaderNoteOf;
};

export type InvoiceHeaderExport = NonNullable<InvoiceSnapshotInput["export"]>;
export type InvoiceHeaderFx = NonNullable<InvoiceSnapshotInput["fx"]>;
export type InvoiceHeaderProforma = NonNullable<InvoiceSnapshotInput["proforma"]>;
export type InvoiceHeaderAdvance = NonNullable<InvoiceSnapshotInput["advance"]>;
export type InvoiceHeaderNoteOf = NonNullable<InvoiceSnapshotInput["noteOf"]>;

export type InvoiceEnvelopeSnapshot = {
  /** The sealed header: `snapshotSha256` is the hash of `{v: 3, kind: "invoice", header}`. */
  header: InvoiceHeader;
  /** The exact text stored in `documents.computed` (its SHA-256 is `header.computedSha256`). */
  computedJson: string;
  /** What the content hash needs besides the lines (the document discount). */
  discountKind: string | null;
  discountValue: number | null;
  lines: EnvLine[];
  /** The footer notes pinned at issue, or null when there were none. */
  terms: { id: string; version: number; sha256: string; bodyMd: string } | null;
};

export type InvoiceEnvelope = {
  v: 3;
  kind: "invoice";
  documentId: string;
  type: string;
  /** The integer sequence of the number (the 12 of TH/INV/2627/0012). */
  number: number;
  numberDisplay: string;
  series: string;
  /** The FY label ("2026-27"). */
  fy: string;
  /** The instant of issue (UTC ms). */
  issuedAt: number;
  snapshotSha256: string;
  snapshot: InvoiceEnvelopeSnapshot;
};

// ---- the view -------------------------------------------------------------------------------------------------------------------------

export type InvoiceViewLine = {
  n: string;
  /** M5.3: on a note's line, the invoice line it is against, numbered as the invoice numbers it (1-based, 07-T §8 "Against line {n}"); absent on every other type. */
  againstLine?: number;
  description: string;
  detail: string | null;
  sac: string | null;
  qty: string;
  unit: string;
  rate: string;
  discount: string | null;
  /** The value before the line discount (Rule 46: total value of supply). */
  gross: string;
  taxable: string;
  /** The rate per head, as printed: intra-state "9 %" under CGST and SGST each, inter-state "18 %" under IGST. */
  headRates: { cgst: string | null; sgst: string | null; igst: string | null };
  /** The tax per head of this line. */
  headAmounts: { cgst: string | null; sgst: string | null; igst: string | null };
  total: string;
};

export type InvoiceViewSummaryRow = {
  sac: string | null;
  taxable: string;
  headRates: { cgst: string | null; sgst: string | null; igst: string | null };
  headAmounts: { cgst: string | null; sgst: string | null; igst: string | null };
};

export type InvoiceViewTotalRow = { key: string; label: string; value: string; strong?: boolean };

export type InvoiceViewBank = { label: string; value: string }[];

/**
 * M5.2: an export invoice's own facts, every value as frozen in the sealed header (the endorsement byte for byte, the LUT letter of the issue FY, the
 * country name). `placeOfSupply` is the 07-S line "Outside India (96)". `declaration` is the optional extra export note's reference (its text is not in
 * the envelope). The words around these values are the designer's (07-S §1).
 */
export type InvoiceViewExport = {
  mode: "lut" | "igst_paid";
  endorsement: string;
  lut: { fy: string; fyLabel: string; arn: string } | null;
  countryName: string;
  placeOfSupply: string;
  /** The client's service address when it had one (Rule 46(o)), as address lines; null otherwise. */
  deliveryAddress: string[] | null;
  /** The optional extra export note: its reference and its frozen text (printed after the endorsement). */
  declaration: { id: string; version: number; sha256: string; text: string } | null;
};

/** M5.2: the INR value block of a USD invoice (07-S §1): the rate as typed (four decimals), its source and date, the INR taxable value and, on the IGST route only, the IGST. */
export type InvoiceViewInr = {
  rate: string;
  source: string;
  date: string;
  taxable: string;
  igst: string | null;
  total: string;
};

/** M5.2: the SWIFT payment details of a USD invoice (07-S §1); each value as frozen, the labels are the designer's. */
export type InvoiceViewSwift = {
  beneficiary: string;
  accountNo: string;
  swift: string;
  /** The bank and its branch, joined. */
  bank: string;
  bankAddress: string | null;
  intermediary: string | null;
  purposeCode: string | null;
};

/**
 * M5.3: a credit or debit note's own facts, every value as frozen in the sealed `noteOf` (the words around them are the designer's, 07-T §1). `parent.number` is the
 * number of the invoice the note is against: the page must print it as ONE text node (LD54; `missingStatutoryLine` refuses a page that does not).
 */
export type InvoiceViewNote = {
  kind: "credit" | "debit";
  /** "Credit Note" or "Debit Note" (07-T §1; the same as `docLabel`). */
  title: string;
  parent: { number: string; date: string; type: string };
  /** The reason as typed by a person: `code`, the label of the code (07-T §3) and the text typed with it (empty when none; required for `other`). Rule 53(1A) wants the nature printed. */
  reason: { code: string; label: string; text: string };
  /** Which total label to print: "Total credited" or "Total added" (07-T §1). */
  totalLabel: "credited" | "added";
  /** The effect line's data: "This credit note reduces the amount due on invoice {parentNumber} by {total}." (a debit note: increases). */
  effect: { direction: "reduces" | "increases"; parentNumber: string; total: string };
  /** A USD note: the rate of its invoice and that invoice's number ("Exchange rate: 1 USD = ₹{rate} (the rate of invoice {parentNumber})"); null for INR. */
  fx: { rate: string; parentNumber: string } | null;
  /** The invoice's export route and its LUT letter (an export credit note prints them, Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03)); null for a domestic note. */
  route: { mode: "lut" | "igst_paid"; lut: { fy: string; fyLabel: string; arn: string } | null } | null;
};

export type InvoiceView = {
  kind: "invoice";
  /** The document type of the envelope (`tax_invoice` in M5.1). */
  type: string;
  docLabel: string;
  title: string;
  numberDisplay: string;
  issueDate: string;
  /** The due date as printed; EMPTY on a credit note (it has none: the layout leaves the row out). */
  dueDate: string;
  /** "ORIGINAL FOR RECIPIENT" (Rule 48). */
  /** "ORIGINAL FOR RECIPIENT" on a tax or export invoice; null on a proforma (it prints no copy mark). */
  copyLabel: string | null;
  logo: string;
  /** `legalName` is the frozen company legal name (Rule 46: "For {legal name}"). */
  supplier: { name: string; legalName: string | null; lines: string[] };
  /** The recipient block: name, address, GSTIN when registered, the State name and code. */
  recipient: {
    name: string;
    attention: string | null;
    lines: string[];
    state: string | null;
    gstin: string | null;
  };
  placeOfSupply: string;
  /** "intra" prints CGST and SGST, anything else IGST. */
  supplyType: string;
  currency: string;
  lines: InvoiceViewLine[];
  totals: InvoiceViewTotalRow[];
  summary: InvoiceViewSummaryRow[];
  words: string;
  /** 07-R: the Rule 46(p) statement, as frozen. */
  reverseCharge: string;
  /** The INR bank block, or null when the invoice was issued without one (nothing is invented). */
  bank: InvoiceViewBank | null;
  /** M5.2: an export invoice's endorsement, LUT, country and address of delivery; null on every other type. */
  export: InvoiceViewExport | null;
  /** M5.2: the INR value block of a USD invoice that carries a rate; null otherwise. */
  inr: InvoiceViewInr | null;
  /** M5.2: the SWIFT payment details of a USD invoice that has them; null otherwise. */
  swift: InvoiceViewSwift | null;
  /** M5.2: a proforma's notice (printed under the title) and its "Valid until" (its due date); null on every other type. */
  proforma: { notice: string; validUntil: string } | null;
  /** M5.2: the invoice made for money received against a proforma: the proforma's number and date, and the day the money arrived; null otherwise. */
  advance: {
    proformaNumber: string;
    proformaDate: string;
    receivedOn: string;
    igstNoLutFy: string | null;
  } | null;
  /** M5.3: a credit or debit note's facts; null on every other type. */
  note: InvoiceViewNote | null;
  /** The footer notes pinned at issue (Markdown), or null. */
  notes: { title: string; version: string; bodyMd: string } | null;
  /** The signature image as a data URI once its bytes were verified; null otherwise (the line "Authorised signatory" is printed either way). */
  signature: { dataUri: string } | null;
  /** The balance due, printed under the total; at issue it equals the total (LD17). */
  balanceDue: string;
  /** The generic client portal address ("Or pay in the client portal"), or null when none is configured (the line is left out). Never a personal link. */
  portalLink: string | null;
  integrity: string;
  footer: { sender: string; contact: string; brand: string };
};

/** The signature bytes the jobs Worker read from DOCS and verified against `issuer.signature.sha256`, as the view takes them. */
export type VerifiedSignature = { mime: string; base64: string };
