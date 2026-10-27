// Invoice fixtures for the PDF tests (M5.1 stage B): envelopes built through core's REAL tax engine and sealed with the ISSUE ROUTE'S OWN functions
// (`invoiceSealOf` of @techaust/db/documents, core `contentHash`), so every figure and hash is what an issue produces. SAMPLE DATA ONLY (the repo is
// public): made-up names, @example.test addresses, a made-up GSTIN.
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { type ComputedDocument, computeDocument, type LineInput } from "@techaust/core/tax";
import {
  type DocumentBundle,
  type DocumentRow,
  headerExtrasJson,
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

/** M5.2 fixtures: the statutory lines are held as LITERALS here (not imported from core), so a change of the constants fails a test until a person has looked at it. */
export const LITERAL_ENDORSEMENT = {
  lut: "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  igst_paid:
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
} as const;
export const LITERAL_PROFORMA_NOTICE =
  "This is not a tax invoice. A tax invoice will be issued when payment is received.";
export const SAMPLE_ARN = "AD0000000000001";
export const SAMPLE_ADVANCE = {
  proformaId: "doc_proforma_sample",
  proformaNumber: "TH/PI/2627/0003",
  proformaIssueDate: "2026-10-20",
  receivedOn: "2026-10-27",
  receiptId: "rcp_sample_1",
} as const;

type Spec = {
  recipient: RecipientSnapshot;
  lines: { description: string; detail?: string; qtyMilli: number; unit: string; rateMinor: number }[];
  documentDiscountBp?: number;
  bare?: boolean;
  signed?: boolean;
  terms?: boolean;
  /** M5.2: the type (default a tax invoice), an export under the given route (an overseas USD client), a proforma, the invoice made for money received. */
  type?: "tax_invoice" | "export_invoice" | "proforma";
  export?: "lut" | "igst_paid";
  advance?: boolean;
  /** An export invoice that carries the optional extra export note (its text is frozen into the header). */
  note?: boolean;
};

export const TYPED_FIXTURE_NAMES = [
  "export_lut",
  "export_igst",
  "proforma",
  "advance",
  "advance_export",
  "export_note",
] as const;
export type TypedFixtureName = (typeof TYPED_FIXTURE_NAMES)[number];

const overseas: RecipientSnapshot = {
  legalName: "Sample Overseas Inc.",
  displayName: "Sample Overseas",
  country: "US",
  address: { line1: "1 Sample Avenue", city: "Springfield", state: "IL", postalCode: "62701", country: "US" },
  deliveryAddress: {
    line1: "9 Delivery Road",
    city: "Chicago",
    state: "IL",
    postalCode: "60601",
    country: "US",
  },
  email: "client@example.test",
  contactId: "con_sample_2",
  contactName: "Sample Overseas Contact",
  clientType: "business",
  gstStatus: "overseas",
} as RecipientSnapshot;

const lineOf = (n: number) => ({
  description: `Sample overseas line ${n}`,
  qtyMilli: 1000,
  unit: "item",
  rateMinor: 250_000 + n * 10_000,
});

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

/** The two sample recipients, for the note fixtures (an Indian GST-registered client in West Bengal, an overseas one). */
export const WB_RECIPIENT = wb;
export const OVERSEAS_RECIPIENT = overseas;

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

/** The M5.2 specs (after `wb` and `overseas` exist). */
const TYPED_SPECS: Record<TypedFixtureName, Spec> = {
  export_lut: {
    recipient: overseas,
    type: "export_invoice",
    export: "lut",
    signed: true,
    lines: [lineOf(1), lineOf(2)],
  },
  export_igst: { recipient: overseas, type: "export_invoice", export: "igst_paid", lines: [lineOf(1)] },
  proforma: {
    recipient: wb,
    type: "proforma",
    lines: [{ description: "Sample proforma line", qtyMilli: 1000, unit: "item", rateMinor: 300_000 }],
  },
  advance: {
    recipient: wb,
    advance: true,
    lines: [{ description: "Sample line", qtyMilli: 1000, unit: "item", rateMinor: 100_000 }],
  },
  export_note: {
    recipient: overseas,
    type: "export_invoice",
    export: "lut",
    note: true,
    lines: [lineOf(1)],
  },
  advance_export: {
    recipient: overseas,
    type: "export_invoice",
    export: "lut",
    advance: true,
    lines: [lineOf(1)],
  },
};

/** The sample extra export note. */
export const EXPORT_NOTE_TEXT = "Sample extra export note.";

const FX = { rateMicros: 83_123_400, date: "2026-10-27", source: "FBIL reference rate" } as const;

export type InvoiceFixture = {
  name: InvoiceFixtureName | TypedFixtureName;
  envelope: InvoiceEnvelope;
  computed: ComputedDocument;
};

/** One sealed invoice envelope, made the way the issue route and the snapshot step make it. */
export async function buildInvoiceFixture(
  name: InvoiceFixtureName | TypedFixtureName,
): Promise<InvoiceFixture> {
  const spec = name in SPECS ? SPECS[name as InvoiceFixtureName] : TYPED_SPECS[name as TypedFixtureName];
  const type = spec.type ?? "tax_invoice";
  const route = spec.export ?? null;
  const isExport = type === "export_invoice";
  const currency = isExport ? "USD" : "INR";
  const fx = isExport ? FX : null;
  const series = type === "export_invoice" ? "export" : type === "proforma" ? "proforma" : "invoice";
  const numberDisplay = `TH/${type === "export_invoice" ? "EXP" : type === "proforma" ? "PI" : "INV"}/2627/0012`;
  const lineInputs: LineInput[] = spec.lines.map((l) => ({
    sac: "998314",
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
  }));
  const result = computeDocument(
    {
      currency,
      documentDate: { year: 2026, month: 10, day: 28 },
      recipient: {
        gstStatus: spec.recipient.gstStatus ?? "registered",
        country: spec.recipient.country,
        ...(spec.recipient.gstin ? { gstin: spec.recipient.gstin } : {}),
        ...(spec.recipient.stateCode ? { stateCode: spec.recipient.stateCode } : {}),
      },
      ...(route ? { exportMode: route } : {}),
      ...(fx ? { fx: { rateMicros: fx.rateMicros } } : {}),
      lines: lineInputs,
      ...(spec.documentDiscountBp
        ? { documentDiscount: { kind: "percent" as const, bp: spec.documentDiscountBp } }
        : {}),
    },
    {
      tax: SETTINGS_DEFAULTS.tax,
      supplierStateCode: "19",
      luts: route === "lut" ? [{ fy: "2627", arn: SAMPLE_ARN }] : [],
    },
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
    type,
    clientId: "cli_sample_1",
    contactId: spec.recipient.contactId ?? null,
    title: null,
    currency,
    validityDays: null,
    termsVersionId: null,
    discountKind: spec.documentDiscountBp ? "percent" : null,
    discountValue: spec.documentDiscountBp ?? null,
    exportMode: route,
    ...(fx ? { fx: { ...fx } } : {}),
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
    bank: isExport
      ? {
          inr: null,
          swift: {
            accountName: "Sample Proprietor",
            accountNo: "SAMPLEUSD0001",
            swift: "SAMPINBBXXX",
            bankName: "SAMPLE BANK",
            branch: "Sample branch",
            bankAddress: "3 Sample Bank Street, Kolkata",
            intermediary: "Sample Intermediary Bank, New York",
            purposeCode: "P0802",
          },
        }
      : {
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
      type,
      clientId: "cli_sample_1",
      currency,
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: contentSha,
      termsRef,
      exportMode: route,
    },
    computed,
    recipient: spec.recipient,
    issuer,
    ...(isExport && route
      ? {
          export: {
            mode: route,
            endorsement: LITERAL_ENDORSEMENT[route],
            lut: route === "lut" ? { fy: "2627", arn: SAMPLE_ARN } : null,
            countryCode: "US",
            countryName: "United States",
            declarationRef: spec.note
              ? { id: "note-1", version: 1, sha256: await sha256Hex(EXPORT_NOTE_TEXT) }
              : null,
            ...(spec.note ? { declarationText: EXPORT_NOTE_TEXT } : {}),
          },
        }
      : {}),
    ...(fx ? { fx: { ...fx } } : {}),
    ...(type === "proforma" ? { proforma: { notice: LITERAL_PROFORMA_NOTICE } } : {}),
    ...(spec.advance ? { advance: { ...SAMPLE_ADVANCE } } : {}),
  });
  const envelope = buildInvoiceEnvelope({
    documentId: `doc_invoice_${name}`,
    type,
    number: 12,
    numberDisplay,
    series,
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
    // M5.2 (LD37): the sealed keys the other columns cannot give, as the freeze writes them; the rate comes from its own columns.
    header_extras: headerExtrasJson({
      ...(h.export ? { export: h.export } : {}),
      ...(h.proforma ? { proforma: h.proforma } : {}),
      ...(h.advance ? { advance: h.advance } : {}),
      ...(h.noteOf ? { noteOf: h.noteOf } : {}),
    }),
    fx_rate_micros: h.fx?.rateMicros ?? null,
    fx_date: h.fx?.date ?? null,
    fx_source: h.fx?.source ?? null,
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
