// Types of the R2 envelope (the frozen copy a PDF is rendered from) and of the pre-formatted view. Pure data; no I/O.
// The header mirrors core's `documentSnapshot` (M4.3, snapshot format v2); the envelope adds what the send batch takes after the
// hash (number, series, FY, instant of the send) and the full content, which the PDF needs.

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country: string;
};

export type RecipientSnap = {
  legalName: string;
  displayName?: string;
  gstin?: string;
  stateCode?: string;
  address?: Address;
  email?: string;
  country: string;
  contactId?: string;
  contactName?: string;
  clientType?: "business" | "individual";
  gstStatus?: "registered" | "unregistered" | "overseas";
  /** M5.2 (LD36): the client's service address when it has one (an invoice's "address of delivery", Rule 46(o); VERIFY WITH CA/LEGAL). */
  deliveryAddress?: Address;
};

export type IssuerSnap = {
  company: {
    tradeName: string;
    legalName: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string;
    /** The BRAND_LOGOS file name used at send (M4.3 fix, frozen with the issuer). */
    logo: string;
    /** Settings "Email on documents" at send; absent on versions sent before the batch fixes (the footer then prints the default). */
    email?: string;
  };
  sender: { staffId: string; name: string; email: string };
};

export type SnapshotHeader = {
  document: {
    type: "proposal" | "estimate";
    clientId: string;
    versionGroupId: string;
    version: number;
    currency: string;
    title: string | null;
    issueDate: string;
    validUntil: string;
    validityDays: number;
    contentSha256: string;
    discountKind: string | null;
    discountValue: number | null;
    exportMode: string | null;
  };
  supply: { type: string; placeOfSupplyCode: string; supplierStateCode: string };
  recipient: RecipientSnap;
  issuer: IssuerSnap;
  terms: { id: string; version: number; sha256: string };
  instalmentAmounts: number[];
  computedSha256: string;
};

export type EnvLine = {
  catalogueItemId: string | null;
  description: string;
  detail: string | null;
  sac: string | null;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discountKind: string | null;
  discountValue: number | null;
  gstRateBp: number;
  catalogueRateMinor: number | null;
  catalogueLine: string | null;
};

/** `bodyMd` can be null (an empty section): it is hashed as stored. */
export type EnvSection = { kind: string; title: string | null; bodyMd: string | null; hidden: boolean };

export type EnvStep = {
  label: string;
  trigger: string;
  pctBp: number;
  detail: string | null;
  targetDate: string | null;
};

export type EnvelopeSnapshot = {
  v: 2;
  header: SnapshotHeader;
  /** The exact text stored in `documents.computed` (its SHA-256 is `header.computedSha256`). */
  computedJson: string;
  lines: EnvLine[];
  sections: EnvSection[];
  schedule: EnvStep[];
  terms: { id: string; version: number; sha256: string; bodyMd: string };
};

export type Envelope = {
  v: 1;
  documentId: string;
  type: "proposal" | "estimate";
  version: number;
  /** The integer sequence of the number (the 3 of TH/PRP/2627/0003). */
  number: number;
  numberDisplay: string;
  series: string;
  fy: string;
  sentAt: number;
  snapshotSha256: string;
  snapshot: EnvelopeSnapshot;
};

/** One row of the pre-formatted view: every value is already a string. */
export type ViewLine = {
  n: string;
  description: string;
  detail: string | null;
  sac: string | null;
  qty: string;
  unit: string;
  rate: string;
  discount: string | null;
  gstRate: string;
  taxable: string;
  total: string;
};

export type ViewTotalRow = { key: string; label: string; value: string; strong?: boolean };
export type ViewSummaryRow = {
  rate: string;
  sac: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
};
export type ViewStep = {
  label: string;
  when: string;
  share: string;
  amount: string;
  detail: string | null;
  date: string | null;
};
export type ViewSection = { kind: string; title: string; bodyMd: string };

export type PdfView = {
  type: "proposal" | "estimate";
  docLabel: string;
  title: string;
  numberDisplay: string;
  versionLabel: string;
  /** The bare version number ("2"), for "No. {number} v{version}" and the footer. */
  version: string;
  statusText: string;
  notice: string | null;
  issueDate: string;
  validUntil: string;
  validityNote: string;
  logo: string;
  supplier: { name: string; lines: string[] };
  recipient: { name: string; attention: string | null; lines: string[] };
  placeOfSupply: string;
  currency: string;
  documentTitle: string | null;
  lines: ViewLine[];
  totals: ViewTotalRow[];
  summary: ViewSummaryRow[];
  words: string;
  inrNote: string | null;
  schedule: ViewStep[];
  sections: ViewSection[];
  /** `version` is the bare number ("3"), for 07-O's "The terms below are version {n} of our terms." */
  terms: { title: string; version: string; bodyMd: string };
  integrity: string;
  /** Where the client accepts (07-P acceptance box), printed as text. */
  portalLink: string;
  /** `brand` is the printed footer line, with the address of Settings "Email on documents". */
  footer: { sender: string; contact: string; brand: string };
};

export type ViewConfig = {
  /** The address shown in the footer as the sender (decision: hello@). */
  contactEmail: string;
  /** The client portal's address as printed in the acceptance box (default "portal.techaust.com", docs/06 §7.4). */
  portalLink?: string;
};

// ---- the statement of account (M5.5b, LD79; ADM-CLI-04, JOB-PDF-01) --------------------------------------------------------------------------------------

/** One line of a statement as the jobs Worker reads it: the amount is positive and the kind says which side it is on (`@techaust/core/statement`). */
export type StatementInputEntry = {
  kind: "tax_invoice" | "export_invoice" | "debit_note" | "credit_note" | "receipt";
  /** ISO date (IST): the issue date, or the day the money arrived. */
  date: string;
  /** The document's printed number (a receipt shows the number of the invoice it paid). */
  number: string;
  amountMinor: number;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
  /** A credit note: the invoice it is against. */
  againstNumber?: string | null;
};

/** Everything `statementView` needs: the company block frozen at the request, the client as it is now, the range and the lines. */
export type StatementViewInput = {
  company: {
    tradeName: string;
    legalName: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string;
    logo: string;
    email?: string;
  };
  client: {
    legalName: string;
    address?: Partial<Address> | null;
    gstin?: string | null;
  };
  currency: "INR" | "USD";
  from: string;
  to: string;
  openingMinor: number;
  entries: readonly StatementInputEntry[];
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
  /** The address the footer sends questions to (Settings "Email" senders, billing). */
  billingEmail: string;
  /** The IST date the PDF was made, ISO. NOT part of the content hash (identical data reuses the stored PDF). */
  generatedOn: string;
};

export type StatementViewEntry = {
  kind: StatementInputEntry["kind"];
  /** "06 Oct 26" */
  date: string;
  document: string;
  againstNumber: string | null;
  /** Formatted amounts; "" where the line has none on that side. */
  debit: string;
  credit: string;
  balance: string;
};

/** The pre-formatted statement: every value a layout prints is already a string (no arithmetic at layout time). Words are the layout's. */
export type StatementView = {
  /** The layout that makes the page: part of the content hash, so a new layout makes a new PDF for the same data. */
  layout: string;
  company: { name: string; lines: string[]; logo: string };
  client: { name: string; lines: string[] };
  /** "06 Oct 2026" */
  from: string;
  to: string;
  currency: "INR" | "USD";
  opening: string;
  closing: string;
  totalDebits: string;
  totalCredits: string;
  /** The closing balance, only when it is above zero (07-V "Amount due"). */
  amountDue: string | null;
  entries: StatementViewEntry[];
  billingEmail: string;
  /** "28 Oct 2026". The only value that changes between two makings of the same statement. */
  generatedOn: string;
};
