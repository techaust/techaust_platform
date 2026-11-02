// M6.3 staging fixes, part 3: the layout audit of every PDF the system makes (the owner: "make sure that all the PDFs have the correct layouts"). Each
// kind in its shortest realistic case (one line), its long case (many lines with long descriptions and details, notes, the bank or payment block, the
// signature on and, where it may be off, off) and, through the sweeps of visual/layout-audit.spec.ts, every case in between that ends near the foot of
// a page. Built through the same fixture builders as the other PDF tests (core's real tax engine, the issue route's own seal). SAMPLE DATA ONLY: "Sample …"
// names, @example.test addresses, made-up numbers.
import { footerLine } from "../../src/footer.ts";
import type { InvoiceEnvelope } from "../../src/invoice-types.ts";
import { toInvoiceView } from "../../src/invoice-view.ts";
import type { CertificateView } from "../../src/layout/certificate-skeleton.ts";
import type { StatementLayoutView } from "../../src/layout/statement.ts";
import {
  renderCertificateHtml,
  renderDeedHtml,
  renderDocumentHtml,
  renderStatementHtml,
} from "../../src/render.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../../src/view.ts";
import { deedFixture } from "./deed.ts";
import { buildFixture, type FixtureName } from "./index.ts";
import {
  buildInvoiceLayoutFixture,
  buildInvoiceLayoutSpec,
  type InvoiceLayoutFixture,
  type InvoiceLayoutSpec,
  SAMPLE_SIGNATURE_PNG,
} from "./invoice-layout.ts";
import { buildNoteFixture, buildNoteSpec, type NoteFixtureName, type NoteSpec } from "./notes.ts";

/** One case of the audit: the PDF kind, the case, the closing line's selector, and its HTML. */
export type AuditCase = {
  kind: string;
  case: string;
  /** The document's last line (integrity line, statement foot, deed footer): it must never stand alone on a page. Null: the certificate, which ends with a
   * whole section (the evidence) rather than a closing line. */
  closing: string | null;
  html: () => Promise<string>;
};

const INTEGRITY = "[data-testid=integrity]";
const signature = {
  mime: "image/png" as const,
  base64: Buffer.from(SAMPLE_SIGNATURE_PNG).toString("base64"),
};

const invoiceHtml = (
  e: InvoiceEnvelope,
  opts: { copy?: "supplier"; unsigned?: boolean } = {},
  sig: typeof signature | null = signature,
) => {
  const env = opts.unsigned ? signatoryOff(e) : e;
  return renderDocumentHtml(
    toInvoiceView(env, DEFAULT_VIEW_CONFIG, {
      signature: opts.unsigned ? null : sig,
      portalLink: "portal.techaust.com",
      ...(opts.copy ? { copy: opts.copy } : {}),
    }),
  );
};

/** The checklist's "Authorised signatory" switched off at issue (07-W 5.6): tax and export invoices and proformas only. */
function signatoryOff(e: InvoiceEnvelope): InvoiceEnvelope {
  const c = JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
  c.snapshot.header.issuer.signatory = false;
  c.snapshot.header.issuer.signature = null;
  return c;
}

// ---- invoice-family specs for the long cases ----------------------------------------------------------------------------------------------

const wb = {
  legalName: "Sample Client Private Limited",
  displayName: "Sample Client",
  gstin: "19ABCDE1234F1ZX",
  stateCode: "19",
  address: {
    line1: "1 Sample Road",
    line2: "Sample Park, Second Floor",
    city: "Kolkata",
    state: "West Bengal",
    postalCode: "700001",
    country: "IN",
  },
  email: "client@example.test",
  country: "IN",
  contactId: "con_sample_1",
  contactName: "Sample Contact",
  clientType: "business",
  gstStatus: "registered",
} as InvoiceLayoutSpec["recipient"];

const us = {
  legalName: "Sample Overseas Software Inc.",
  displayName: "Sample Overseas",
  country: "US",
  address: {
    line1: "100 Sample Avenue, Suite 4",
    city: "Austin",
    state: "TX",
    postalCode: "73301",
    country: "US",
  },
  email: "client@example.test",
  contactId: "con_sample_us",
  contactName: "Sample Overseas Contact",
  clientType: "business",
  gstStatus: "overseas",
} as InvoiceLayoutSpec["recipient"];

const lines = (n: number, rate: number): InvoiceLayoutSpec["lines"] =>
  Array.from({ length: n }, (_, i) => ({
    description: `Sample line ${i + 1}: a description long enough to wrap onto a second line of the items table, as a real scope line does`,
    ...(i % 2 === 0
      ? {
          detail: `Sample detail ${i + 1}: what was delivered, with the dates and the people who signed it off`,
        }
      : {}),
    sac: i % 5 === 4 ? "998313" : "998314",
    qtyMilli: 1000 + (i % 4) * 500,
    unit: i % 3 === 0 ? "fixed" : i % 3 === 1 ? "days" : "hours",
    rateMinor: rate + i * 1_234,
    ...(i % 6 === 0 ? { discount: { kind: "percent" as const, bp: 500 } } : {}),
  }));

const oneLine = (description: string, rateMinor: number): InvoiceLayoutSpec["lines"] => [
  { description, sac: "998314", qtyMilli: 1000, unit: "fixed", rateMinor },
];

const INVOICE_SPECS: Record<string, InvoiceLayoutSpec> = {
  "tax-intra-long": {
    recipient: wb,
    bank: true,
    signed: true,
    terms: true,
    longTerms: true,
    lines: lines(24, 150_000),
  },
  "export-lut-long": {
    recipient: us,
    type: "export_invoice",
    route: "lut",
    bank: true,
    signed: true,
    terms: true,
    longTerms: true,
    country: { code: "US", name: "United States" },
    lines: lines(18, 45_000),
  },
  "export-igst-long": {
    recipient: us,
    type: "export_invoice",
    route: "igst_paid",
    bank: true,
    signed: true,
    note: true,
    terms: true,
    country: { code: "US", name: "United States" },
    lines: lines(18, 45_000),
  },
  "proforma-inr-long": {
    recipient: wb,
    type: "proforma",
    bank: true,
    gstEstimate: true,
    terms: true,
    longTerms: true,
    lines: lines(20, 150_000),
  },
  "proforma-usd-short": {
    recipient: us,
    type: "proforma",
    usd: true,
    route: "lut",
    bank: true,
    gstEstimate: true,
    country: { code: "US", name: "United States" },
    lines: oneLine("Sample advance: 40 % of proposal TH/PRP/2627/0003", 200_000),
  },
  "proforma-usd-igst-long": {
    recipient: us,
    type: "proforma",
    usd: true,
    route: "igst_paid",
    bank: true,
    gstEstimate: true,
    terms: true,
    longTerms: true,
    country: { code: "US", name: "United States" },
    lines: lines(16, 45_000),
  },
};

const NOTE_SPECS: Record<string, NoteSpec> = {
  "credit-long": {
    kind: "credit",
    mode: "lines",
    parent: Array.from({ length: 24 }, (_, i) => 150_000 + i * 1_000),
    takes: Array.from({ length: 24 }, (_, i) => ({ line: i, taxableMinor: 50_000 })),
    reason: {
      code: "other",
      text: "Sample reason typed for the credit: two of the screens were replaced by a simpler page, agreed by email.",
    },
  },
  "debit-long": {
    kind: "debit",
    mode: "lines",
    parent: Array.from({ length: 24 }, (_, i) => 150_000 + i * 1_000),
    takes: Array.from({ length: 24 }, (_, i) => ({ line: i, taxableMinor: 20_000 })),
    reason: { code: "other", text: "Extra revision rounds agreed by email." },
  },
  "debit-tax-only": {
    kind: "debit",
    mode: "lines",
    parent: [2_500_000, 1_800_000],
    taxOnly: 10_000,
    reason: { code: "tax_charged_too_low", text: "" },
  },
};

// ---- the statement ------------------------------------------------------------------------------------------------------------------------

function statementView(entries: number, longNames = false): StatementLayoutView {
  const rows: StatementLayoutView["entries"][number][] = [];
  let balance = 0;
  for (let i = 0; i < entries; i++) {
    const kind = (["tax_invoice", "receipt", "credit_note", "tax_invoice", "tds", "debit_note"] as const)[
      i % 6
    ] as StatementLayoutView["entries"][number]["kind"];
    const debit = kind === "tax_invoice" || kind === "debit_note";
    const amount = 1_18_000 + i * 100;
    balance += debit ? amount : -Math.min(amount, Math.max(balance, 0));
    const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}.00`;
    rows.push({
      date: `${String((i % 28) + 1).padStart(2, "0")} Jun 26`,
      number: `TH/${kind === "credit_note" ? "CN" : kind === "debit_note" ? "DN" : kind === "tax_invoice" ? "INV" : "RC"}/2627/${String(i + 1).padStart(4, "0")}`,
      kind,
      againstNumber: kind === "credit_note" || kind === "debit_note" ? "TH/INV/2627/0001" : null,
      debit: debit ? fmt(amount) : null,
      credit: debit ? null : fmt(amount),
      balance: fmt(balance),
    });
  }
  return {
    title: "Statement of account SAMPLE01 01 Apr 26 to 28 Oct 26",
    logo: "logo-primary-color.svg",
    company: {
      name: "TecHaust Technologies",
      lines: [
        "Sample address line (fake), Balurghat, West Bengal 733101",
        "GSTIN 19ABCDE1234F1ZX · State West Bengal (19)",
        "billing@techaust.com",
      ],
    },
    client: {
      name: longNames
        ? "Sample Extraordinarily Long Named Technology and Consultancy Services Private Limited (fake)"
        : "Sample client A (fake)",
      lines: longNames
        ? [
            "Flat 12B, Sample Tower Number Forty-Two, Extraordinarily Long Sample Road Name Near The Sample Junction, Kolkata, West Bengal 700001",
            "GSTIN 19ABCDE1234F1ZX",
          ]
        : ["1 Sample Road, Kolkata, West Bengal 700001", "GSTIN 19ABCDE1234F1ZX"],
    },
    clientCode: "SAMPLE01",
    period: { from: "01 Apr 26", to: "28 Oct 26" },
    currency: "INR",
    opening: "₹0.00",
    debits: "₹1,41,600.00",
    credits: "₹23,600.00",
    closing: "₹1,18,000.00",
    amountDue: "₹1,18,000.00",
    entries: rows,
    generatedOn: "28 Oct 26",
    email: "billing@techaust.com",
    footerBrand: footerLine("billing@techaust.com"),
  };
}

// ---- the acceptance certificate -----------------------------------------------------------------------------------------------------------

const certificate: CertificateView = {
  number: "TH/PRP/2627/0003",
  version: "2",
  total: "₹2,95,000.00",
  kind: "Proposal",
  title: "Website rebuild",
  clientLegalName: "Sample Traders Pvt Ltd",
  typedName: "Sample Contact",
  email: "client@example.test",
  acceptedAtIst: "26 Oct 2026, 10:30 IST",
  acceptedAtUtc: "2026-10-26 05:00:00 UTC",
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0 (sample)",
  country: "IN",
  via: "link",
  pdfSha256: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  termsVersion: "2",
  termsSha256: "c".repeat(64),
};
const certificateLong: CertificateView = {
  ...certificate,
  kind: "Estimate",
  title:
    "Sample rebuild of the website, the client portal, the admin, the payment integration and the reporting suite, with the migration of every record from the old system",
  clientLegalName: "Sample Extraordinarily Long Named Technology and Consultancy Services Private Limited",
  typedName: "Sample Contact With An Unusually Long Full Name And Designation",
  email: "sample.contact.with.a.very.long.address@extraordinarily-long-sample-domain.example.test",
  ip: "2001:db8:85a3:0000:0000:8a2e:0370:7334",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0 (sample, long)",
};

// ---- every case ---------------------------------------------------------------------------------------------------------------------------

const fromFixture = (
  kind: string,
  c: string,
  name: InvoiceLayoutFixture,
  opts: { copy?: "supplier"; unsigned?: boolean } = {},
): AuditCase => ({
  kind,
  case: c,
  closing: INTEGRITY,
  html: async () => {
    const built = await buildInvoiceLayoutFixture(name);
    return invoiceHtml(built.envelope, opts, built.signature);
  },
});
const fromSpec = (
  kind: string,
  c: string,
  id: string,
  opts: { copy?: "supplier"; unsigned?: boolean } = {},
): AuditCase => ({
  kind,
  case: c,
  closing: INTEGRITY,
  html: async () => {
    const built = await buildInvoiceLayoutSpec(id, INVOICE_SPECS[id] as InvoiceLayoutSpec);
    return invoiceHtml(built.envelope, opts, built.signature);
  },
});
const fromNote = (kind: string, c: string, name: NoteFixtureName): AuditCase => ({
  kind,
  case: c,
  closing: INTEGRITY,
  html: async () => invoiceHtml((await buildNoteFixture(name)).envelope),
});
const fromNoteSpec = (kind: string, c: string, id: string): AuditCase => ({
  kind,
  case: c,
  closing: INTEGRITY,
  html: async () => invoiceHtml((await buildNoteSpec(id, NOTE_SPECS[id] as NoteSpec)).envelope),
});
const fromDocument = (kind: string, c: string, name: FixtureName): AuditCase => ({
  kind,
  case: c,
  closing: INTEGRITY,
  html: async () => renderDocumentHtml(toPdfView((await buildFixture(name)).envelope)),
});

export const AUDIT_CASES: AuditCase[] = [
  fromDocument("proposal", "short", "short-intra-inr"),
  fromDocument("proposal", "long", "long-inter-inr"),
  fromDocument("proposal", "usd", "usd-export"),
  fromDocument("proposal", "long names", "long-names"),
  fromDocument("estimate", "intra", "intra-estimate"),
  fromDocument("estimate", "inter", "inter-estimate"),
  {
    kind: "certificate",
    case: "short",
    closing: null,
    html: async () => renderCertificateHtml(certificate),
  },
  {
    kind: "certificate",
    case: "long",
    closing: null,
    html: async () => renderCertificateHtml(certificateLong),
  },
  fromFixture("tax invoice INR intra", "short", "short"),
  fromFixture("tax invoice INR intra", "several lines and notes", "intra"),
  fromSpec("tax invoice INR intra", "long, signed", "tax-intra-long"),
  fromSpec("tax invoice INR intra", "long, signatory off", "tax-intra-long", { unsigned: true }),
  fromFixture("tax invoice INR intra", "short, signatory off", "short", { unsigned: true }),
  fromFixture("tax invoice INR intra", "Udyam line", "udyam"),
  fromFixture("tax invoice INR intra", "long names", "long-names"),
  fromFixture("tax invoice INR intra", "bare (no bank, no signature)", "bare"),
  fromFixture("tax invoice INR inter", "short", "inter"),
  fromFixture("tax invoice INR inter", "long (40 lines)", "long"),
  fromFixture("export invoice LUT", "short", "export-lut"),
  fromSpec("export invoice LUT", "long", "export-lut-long"),
  fromFixture("export invoice IGST", "short", "export-igst"),
  fromSpec("export invoice IGST", "long", "export-igst-long"),
  fromFixture("proforma INR", "short", "proforma"),
  fromSpec("proforma INR", "long", "proforma-inr-long"),
  fromSpec("proforma USD", "short", "proforma-usd-short"),
  fromSpec("proforma USD", "long (IGST route)", "proforma-usd-igst-long"),
  fromFixture("invoice for a payment received", "INR", "advance"),
  fromFixture("invoice for a payment received", "export LUT", "advance-export"),
  fromFixture("invoice for a payment received", "export IGST (owner's case)", "advance-export-igst"),
  fromNote("credit note", "short (lines)", "credit_lines"),
  fromNote("credit note", "by amount", "credit_amount"),
  fromNote("credit note", "USD IGST", "credit_usd_igst"),
  fromNoteSpec("credit note", "long", "credit-long"),
  fromNote("debit note", "short", "debit"),
  fromNote("debit note", "USD LUT", "debit_usd_lut"),
  fromNoteSpec("debit note", "tax only", "debit-tax-only"),
  fromNoteSpec("debit note", "long", "debit-long"),
  fromFixture("duplicate for supplier", "short", "short", { copy: "supplier" }),
  fromFixture("duplicate for supplier", "export LUT", "export-lut", { copy: "supplier" }),
  fromSpec("duplicate for supplier", "long", "tax-intra-long", { copy: "supplier" }),
  {
    kind: "statement",
    case: "short (3 entries)",
    closing: ".stm-foot",
    html: async () => renderStatementHtml(statementView(3)),
  },
  {
    kind: "statement",
    case: "long (200 entries)",
    closing: ".stm-foot",
    html: async () => renderStatementHtml(statementView(200)),
  },
  {
    kind: "statement",
    case: "long names",
    closing: ".stm-foot",
    html: async () => renderStatementHtml(statementView(12, true)),
  },
  {
    kind: "deed",
    case: "short INR",
    closing: "[data-testid=deed-footer]",
    html: async () => renderDeedHtml(deedFixture("short-inr")),
  },
  {
    kind: "deed",
    case: "long INR",
    closing: "[data-testid=deed-footer]",
    html: async () => renderDeedHtml(deedFixture("long-inr")),
  },
  {
    kind: "deed",
    case: "USD",
    closing: "[data-testid=deed-footer]",
    html: async () => renderDeedHtml(deedFixture("usd")),
  },
];

/** A file-safe name of a case. */
export const auditSlug = (c: AuditCase): string =>
  `${c.kind}-${c.case}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/, "");
