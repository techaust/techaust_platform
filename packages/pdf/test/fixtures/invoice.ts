// Invoice fixtures for the PDF tests (M5.1 stage B): envelopes built through core's REAL tax engine and sealed with the ISSUE ROUTE'S OWN functions
// (`invoiceSealOf` of @techaust/db/documents, core `contentHash`), so every figure and hash is what an issue produces. SAMPLE DATA ONLY (the repo is
// public): made-up names, @example.test addresses, a made-up GSTIN.
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { type ComputedDocument, computeDocument, type LineInput } from "@techaust/core/tax";
import {
  type DocumentBundle,
  type DocumentRow,
  invoiceSealOf,
  type LineRow,
  type TermsRow,
} from "@techaust/db/documents";
import type { InvoiceIssuerSnapshot, RecipientSnapshot } from "@techaust/db/issue";
import { sha256Hex } from "../../src/hash.ts";
import { buildInvoiceEnvelope } from "../../src/invoice-envelope.ts";
import type { InvoiceEnvelope, InvoiceHeader } from "../../src/invoice-types.ts";
import type { EnvLine } from "../../src/types.ts";

export const SAMPLE_SUPPLIER_GSTIN = "19ABCDE1234F1ZX";

export const INVOICE_FIXTURE_NAMES = ["intra", "inter", "discount", "bare", "signed"] as const;
export type InvoiceFixtureName = (typeof INVOICE_FIXTURE_NAMES)[number];

/** The bytes of a made-up one-pixel PNG: the signature of the "signed" fixture. */
export const SIGNATURE_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const hexOf = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

type Spec = {
  recipient: RecipientSnapshot;
  lines: { description: string; detail?: string; qtyMilli: number; unit: string; rateMinor: number }[];
  documentDiscountBp?: number;
  bare?: boolean;
  signed?: boolean;
  terms?: boolean;
};

const wb: RecipientSnapshot = {
  legalName: "Sample Client Private Limited",
  displayName: "Sample Client",
  gstin: "19ABCDE1234F1ZX",
  stateCode: "19",
  address: {
    line1: "1 Sample Road",
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
} as RecipientSnapshot;

const SPECS: Record<InvoiceFixtureName, Spec> = {
  intra: {
    recipient: wb,
    terms: true,
    lines: [
      {
        description: "Sample design work",
        detail: "Two sample screens",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 2_500_000,
      },
      { description: "Sample build", qtyMilli: 1500, unit: "days", rateMinor: 1_200_000 },
    ],
  },
  inter: {
    recipient: {
      ...wb,
      legalName: "Sample Maharashtra Industries Limited",
      displayName: "Sample Maharashtra",
      gstin: "27ABCDE1234F1Z0",
      stateCode: "27",
      address: {
        line1: "7 Sample Street",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "IN",
      },
    } as RecipientSnapshot,
    lines: [{ description: "Sample integration", qtyMilli: 2500, unit: "days", rateMinor: 1_800_000 }],
  },
  discount: {
    recipient: {
      legalName: "Sample Unregistered Person",
      country: "IN",
      stateCode: "19",
      address: {
        line1: "2 Sample Lane",
        city: "Balurghat",
        state: "West Bengal",
        postalCode: "733101",
        country: "IN",
      },
      gstStatus: "unregistered",
      clientType: "individual",
    } as RecipientSnapshot,
    documentDiscountBp: 500,
    lines: [
      { description: "Sample line one", qtyMilli: 1000, unit: "item", rateMinor: 500_000 },
      { description: "Sample line two", qtyMilli: 3000, unit: "hours", rateMinor: 150_050 },
    ],
  },
  bare: {
    recipient: wb,
    bare: true,
    lines: [{ description: "Sample line", qtyMilli: 1000, unit: "item", rateMinor: 100_000 }],
  },
  signed: {
    recipient: wb,
    signed: true,
    lines: [{ description: "Sample line", qtyMilli: 1000, unit: "item", rateMinor: 100_000 }],
  },
};

export type InvoiceFixture = {
  name: InvoiceFixtureName;
  envelope: InvoiceEnvelope;
  computed: ComputedDocument;
};

/** One sealed invoice envelope, made the way the issue route and the snapshot step make it. */
export async function buildInvoiceFixture(name: InvoiceFixtureName): Promise<InvoiceFixture> {
  const spec = SPECS[name];
  const lineInputs: LineInput[] = spec.lines.map((l) => ({
    sac: "998314",
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
  }));
  const result = computeDocument(
    {
      currency: "INR",
      documentDate: { year: 2026, month: 10, day: 28 },
      recipient: {
        gstStatus: spec.recipient.gstStatus ?? "registered",
        country: spec.recipient.country,
        ...(spec.recipient.gstin ? { gstin: spec.recipient.gstin } : {}),
        ...(spec.recipient.stateCode ? { stateCode: spec.recipient.stateCode } : {}),
      },
      lines: lineInputs,
      ...(spec.documentDiscountBp
        ? { documentDiscount: { kind: "percent" as const, bp: spec.documentDiscountBp } }
        : {}),
    },
    { tax: SETTINGS_DEFAULTS.tax, supplierStateCode: "19", luts: [] },
  );
  if (!result.ok) throw new Error(`invoice fixture ${name}: ${JSON.stringify(result.errors)}`);
  const computed = result.value;
  const lines: EnvLine[] = spec.lines.map((l) => ({
    catalogueItemId: null,
    description: l.description,
    detail: l.detail ?? null,
    sac: "998314",
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
    discountKind: null,
    discountValue: null,
    gstRateBp: 1800,
    catalogueRateMinor: null,
    catalogueLine: null,
  }));
  const draft: DraftContent = {
    type: "tax_invoice",
    clientId: "cli_sample_1",
    contactId: spec.recipient.contactId ?? null,
    title: null,
    currency: "INR",
    validityDays: null,
    termsVersionId: null,
    discountKind: spec.documentDiscountBp ? "percent" : null,
    discountValue: spec.documentDiscountBp ?? null,
    exportMode: null,
    lines,
    sections: [],
    schedule: [],
  };
  const contentSha = await contentHash(draft, computed);
  const termsBody = "Sample notes.\n\n1. Payment is due on the due date.";
  const termsSha = await sha256Hex(termsBody);
  const issuer: InvoiceIssuerSnapshot = {
    company: spec.bare
      ? {
          tradeName: "TecHaust Technologies",
          legalName: null,
          address: null,
          gstin: null,
          stateCode: "19",
          logo: "logo-primary-color.svg",
        }
      : {
          tradeName: "TecHaust Technologies",
          legalName: "Sample Proprietor",
          address: "1 Sample Supplier Road, Balurghat, West Bengal 733101",
          gstin: SAMPLE_SUPPLIER_GSTIN,
          stateCode: "19",
          logo: "logo-primary-color.svg",
          email: "billing@example.test",
          phone: "+91 90000 00000",
          principalPlace: "2 Sample Office Lane, Balurghat",
        },
    bank: {
      inr: spec.bare
        ? null
        : {
            accountName: "Sample Proprietor",
            accountNo: "SAMPLE0001",
            ifsc: "SAMP0000001",
            bankName: "SAMPLE BANK",
            branch: "Sample branch",
          },
    },
    signature: spec.signed
      ? {
          key: "settings/signature-0123456789abcdef.png",
          sha256: await hexOf(SIGNATURE_BYTES),
          mime: "image/png",
        }
      : null,
    reverseChargeText: "Tax payable on reverse charge: No",
    sender: { staffId: "stf_sample_1", name: "Sample Proprietor", email: "sender@example.test" },
  };
  const termsRef = spec.terms ? { id: "trm_sample_1", version: 2, sha256: termsSha } : null;
  const seal = await invoiceSealOf({
    document: {
      type: "tax_invoice",
      clientId: "cli_sample_1",
      currency: "INR",
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: contentSha,
      termsRef,
      exportMode: null,
    },
    computed,
    recipient: spec.recipient,
    issuer,
  });
  const envelope = buildInvoiceEnvelope({
    documentId: `doc_invoice_${name}`,
    type: "tax_invoice",
    number: 12,
    numberDisplay: "TH/INV/2627/0012",
    series: "invoice",
    fy: "2026-27",
    issuedAt: 1_793_000_000_000,
    snapshotSha256: seal.snapshotSha256,
    snapshot: {
      header: seal.input as unknown as InvoiceHeader,
      computedJson: seal.computedJson,
      discountKind: draft.discountKind,
      discountValue: draft.discountValue,
      lines,
      terms: termsRef ? { ...termsRef, bodyMd: termsBody } : null,
    },
  });
  return { name, envelope, computed };
}

/** The rows a D1 read of this issued invoice would give (snake_case, JSON columns parsed). */
export function invoiceBundleOf(source: InvoiceEnvelope): DocumentBundle<TermsRow> {
  const e = structuredClone(source);
  const s = e.snapshot;
  const h = s.header;
  const document = {
    id: e.documentId,
    type: e.type,
    status: "issued",
    client_id: h.document.clientId,
    version_group_id: null,
    version: 1,
    series: e.series,
    fy: e.fy.slice(2, 4) + e.fy.slice(5, 7),
    number: e.number,
    number_display: e.numberDisplay,
    currency: h.document.currency,
    issue_date: h.document.issueDate,
    due_date: h.document.dueDate,
    terms_version_id: h.document.termsRef?.id ?? null,
    snapshot_sha256: e.snapshotSha256,
    frozen_at: e.issuedAt,
    contact_id: h.recipient.contactId ?? null,
    discount_kind: s.discountKind,
    discount_value: s.discountValue,
    export_mode: h.document.exportMode,
    content_sha256: h.document.contentSha256,
    recipient: h.recipient,
    issuer: h.issuer,
    computed: JSON.parse(s.computedJson),
  } as unknown as DocumentRow;
  return {
    document,
    lines: s.lines.map((l, i) => ({
      id: `l${i}`,
      position: i,
      catalogue_item_id: l.catalogueItemId,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qty_milli: l.qtyMilli,
      unit: l.unit,
      rate_minor: l.rateMinor,
      discount_kind: l.discountKind,
      discount_value: l.discountValue,
      gst_rate_bp: l.gstRateBp,
      catalogue_rate_minor: l.catalogueRateMinor,
      catalogue_line: l.catalogueLine,
    })) as unknown as LineRow[],
    sections: [],
    schedule: [],
    versions: [],
    terms: s.terms
      ? {
          id: s.terms.id,
          kind: "invoice",
          version: s.terms.version,
          sha256: s.terms.sha256,
          body_md: s.terms.bodyMd,
        }
      : null,
    approvals: [],
  };
}
