// Types of the invoice envelope (the frozen copy an issued invoice's PDF is rendered from) and of its pre-formatted view (M5.1 stage B; LD4, LD10,
// LD11). Pure data; no I/O. The sealed header mirrors core's `InvoiceSnapshotInput` (`{v: 3, kind: "invoice", header}`); the envelope adds what the
// issue batch takes AFTER the hash (the number, series, FY and the instant of issue) and the content the PDF needs (the lines, the discount, the
// footer notes). A proposal's envelope is `types.ts`'s `Envelope` (format 1); this one is format 3 with `kind: "invoice"`.
import type { EnvLine, IssuerSnap, RecipientSnap } from "./types.ts";

/** The INR bank block frozen with the invoice (db `InvoiceBankBlock`). The SWIFT block of an export invoice arrives with M5.2. */
export type InvoiceBankSnap = {
  accountName: string;
  accountNo: string;
  ifsc: string | null;
  bankName: string;
  branch: string | null;
};

/** The signature as a REFERENCE (LD11): the content-addressed object in DOCS, never the bytes. */
export type InvoiceSignatureRef = { key: string; sha256: string; mime: string };

export type InvoiceIssuerSnap = {
  company: IssuerSnap["company"] & { phone?: string; principalPlace?: string };
  bank: { inr: InvoiceBankSnap | null };
  signature: InvoiceSignatureRef | null;
  /** The Rule 46(p) statement exactly as it was issued (frozen and sealed; VERIFY WITH CA/LEGAL). */
  reverseChargeText: string;
  sender: IssuerSnap["sender"];
};

export type InvoiceHeader = {
  document: {
    type: string;
    clientId: string;
    currency: string;
    issueDate: string;
    dueDate: string;
    contentSha256: string;
    termsRef: { id: string; version: number; sha256: string } | null;
    exportMode: string | null;
  };
  supply: { type: string; placeOfSupplyCode: string; supplierStateCode: string };
  recipient: RecipientSnap;
  issuer: InvoiceIssuerSnap;
  computedSha256: string;
};

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

export type InvoiceView = {
  kind: "invoice";
  /** The document type of the envelope (`tax_invoice` in M5.1). */
  type: string;
  docLabel: string;
  title: string;
  numberDisplay: string;
  issueDate: string;
  dueDate: string;
  /** "ORIGINAL FOR RECIPIENT" (Rule 48). */
  copyLabel: string;
  logo: string;
  supplier: { name: string; lines: string[] };
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
  /** The footer notes pinned at issue (Markdown), or null. */
  notes: { title: string; version: string; bodyMd: string } | null;
  /** The signature image as a data URI once its bytes were verified; null otherwise (the line "Authorised signatory" is printed either way). */
  signature: { dataUri: string } | null;
  integrity: string;
  footer: { sender: string; contact: string; brand: string };
};

/** The signature bytes the jobs Worker read from DOCS and verified against `issuer.signature.sha256`, as the view takes them. */
export type VerifiedSignature = { mime: string; base64: string };
