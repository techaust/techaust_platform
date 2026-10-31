// Tax invoice LAYOUT fixtures (M5.1 phase 2, docs/06 §7.5): the cases the designed layout is looked at in, built like `./invoice.ts` builds its own
// (core's REAL tax engine, sealed with the issue route's own `invoiceSealOf`), so every figure, hash and per-head rate is what an issue produces.
// SAMPLE DATA ONLY (the repo is public): "Sample ..." names, @example.test addresses, made-up GSTINs, a made-up bank and a drawn sample signature.
//
//   short        one line, a registered client in the same State (CGST and SGST), bank block, no notes, no signature
//   intra        several lines, two SACs, a line discount and a document discount, a round-off, notes pinned at issue
//   inter        a client in another State: IGST only
//   long         40 lines over three or more pages, notes and a signature
//   long-names   a very long client name, address and contact, long descriptions and a long supplier address
//   bare         `bank.inr = null` and `signature = null`, an unregistered individual, a supplier without legal name, address or GSTIN
//   signed       a signature image (a drawn sample) above "Authorised signatory"
// M5.2 (07-S §1, §2, §8; the statutory lines held as LITERALS here, never imported from core):
//   export-lut      an export invoice in USD under LUT: the endorsement, the LUT line, a delivery address, the INR block, SWIFT with an intermediary
//                   bank and a purpose code, a signature
//   export-igst     an export invoice in USD with IGST paid, to a client in Côte d’Ivoire (a curly apostrophe and accents in the country, an "&" in
//                   the name): the IGST endorsement, the IGST in INR, the extra export note after the endorsement, SWIFT without the optional parts
//   proforma        a proforma (INR, intra-state): its notice under the title, "Proforma number", "Valid until", no copy mark
//   advance         a tax invoice issued for a payment received against a proforma: the "Against proforma" line, no balance due, no "How to pay"
//   advance-export  the same as an export invoice under LUT
// rt2 (T4, T10; 07-ZC): `advance` and `advance-export` carry the signature (an invoice for a payment received is always signed, 08-C RA-17);
//   udyam           a tax invoice with a Udyam registration (a made-up number) printed under the GSTIN line (07-ZC line 6), signed
import { deflateSync } from "node:zlib";
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { type ComputedDocument, computeDocument, type LineInput } from "@techaust/core/tax";
import { invoiceSealOf } from "@techaust/db/documents";
import type { InvoiceIssuerSnapshot, RecipientSnapshot } from "@techaust/db/issue";
import { rgbaPng } from "../../../testing/src/png.ts";
import { sha256Hex } from "../../src/hash.ts";
import { buildInvoiceEnvelope } from "../../src/invoice-envelope.ts";
import type { InvoiceEnvelope, InvoiceHeader, VerifiedSignature } from "../../src/invoice-types.ts";
import type { EnvLine } from "../../src/types.ts";

export const INVOICE_LAYOUT_FIXTURES = [
  "short",
  "intra",
  "inter",
  "long",
  "long-names",
  "bare",
  "signed",
  "export-lut",
  "export-igst",
  "proforma",
  "advance",
  "advance-export",
  "udyam",
] as const;
export type InvoiceLayoutFixture = (typeof INVOICE_LAYOUT_FIXTURES)[number];

/** At least this many pages when printed (06 §7.5: the long fixture runs to 3+ pages). */
export const INVOICE_MIN_PAGES: Partial<Record<InvoiceLayoutFixture, number>> = { long: 3 };

type LineSpec = {
  description: string;
  detail?: string;
  sac?: string;
  qtyMilli: number;
  unit: string;
  rateMinor: number;
  discount?: { kind: "percent"; bp: number } | { kind: "fixed"; minor: number };
};

type Spec = {
  recipient: RecipientSnapshot;
  lines: LineSpec[];
  documentDiscountBp?: number;
  supplier?: "full" | "bare" | "long";
  bank?: boolean;
  signed?: boolean;
  terms?: boolean;
  /** M5.2: the type (default a tax invoice); an export under the given route (an overseas USD client with a rate and SWIFT); paid for a payment received. */
  type?: "tax_invoice" | "export_invoice" | "proforma";
  route?: "lut" | "igst_paid";
  advance?: boolean;
  /** rt2 (T10): the supplier's Udyam registration (sample number), sealed into the issuer block of a tax invoice. */
  udyam?: boolean;
  note?: boolean;
  country?: { code: string; name: string };
};

/** The statutory lines as LITERALS (07-S §1, §2), so a change of core's constants fails a test until a person has looked at it. */
export const LAYOUT_ENDORSEMENT = {
  lut: "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  igst_paid:
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
} as const;
export const LAYOUT_PROFORMA_NOTICE =
  "This is not a tax invoice. A tax invoice will be issued when payment is received.";
export const LAYOUT_ARN = "AD1910260000017";
export const LAYOUT_EXPORT_NOTE =
  "Sample extra export note: the services were delivered online from India to the recipient abroad.";
export const LAYOUT_ADVANCE = {
  proformaId: "doc_proforma_layout",
  proformaNumber: "TH/PI/2627/0004",
  proformaIssueDate: "2026-10-20",
  receivedOn: "2026-10-27",
  receiptId: "rcp_layout_1",
} as const;
const LAYOUT_FX = { rateMicros: 84_215_600, date: "2026-10-27", source: "FBIL reference rate" } as const;

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
} as RecipientSnapshot;

const mh = {
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
  contactName: "Sample Buyer",
} as RecipientSnapshot;

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
  deliveryAddress: {
    line1: "9 Sample Delivery Street",
    city: "Boston",
    state: "MA",
    postalCode: "02110",
    country: "US",
  },
  email: "client@example.test",
  contactId: "con_sample_us",
  contactName: "Sample Overseas Contact",
  clientType: "business",
  gstStatus: "overseas",
} as RecipientSnapshot;

const ci = {
  legalName: "Sample Abidjan Services & Trading SARL",
  displayName: "Sample Abidjan",
  country: "CI",
  address: {
    line1: "12 Rue d’Exemple, Plateau",
    city: "Abidjan",
    postalCode: "01 BP 0000",
    country: "CI",
  },
  email: "client@example.test",
  contactId: "con_sample_ci",
  contactName: "Sample Côte Contact",
  clientType: "business",
  gstStatus: "overseas",
} as RecipientSnapshot;

const usdLines: LineSpec[] = [
  {
    description: "Sample platform engineering, October",
    detail: "Sample sprint 3 of 4",
    sac: "998314",
    qtyMilli: 10_000,
    unit: "days",
    rateMinor: 45_000,
  },
  {
    description: "Sample code review and hand-over",
    sac: "998313",
    qtyMilli: 1000,
    unit: "fixed",
    rateMinor: 120_000,
  },
];

const manyLines = (n: number): LineSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    description: `Sample line ${i + 1}: a description long enough to wrap onto a second line of the items table`,
    ...(i % 3 === 0 ? { detail: `Sample detail ${i + 1} with more words` } : {}),
    sac: i % 5 === 4 ? "998313" : "998314",
    qtyMilli: 1000 + (i % 4) * 500,
    unit: i % 2 === 0 ? "days" : "hours",
    rateMinor: 150_000 + i * 12_345,
    ...(i % 7 === 0 ? { discount: { kind: "percent" as const, bp: 500 } } : {}),
  }));

const SPECS: Record<InvoiceLayoutFixture, Spec> = {
  short: {
    recipient: wb,
    bank: true,
    lines: [
      { description: "Sample website care, October", qtyMilli: 1000, unit: "month", rateMinor: 1_500_000 },
    ],
  },
  intra: {
    recipient: wb,
    bank: true,
    terms: true,
    documentDiscountBp: 250,
    lines: [
      {
        description: "Sample design work",
        detail: "Two sample screens and their states",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 2_500_000,
      },
      {
        description: "Sample build",
        qtyMilli: 1500,
        unit: "days",
        rateMinor: 1_200_033,
        discount: { kind: "percent", bp: 1000 },
      },
      {
        description: "Sample hosting set-up",
        sac: "998315",
        qtyMilli: 1000,
        unit: "item",
        rateMinor: 450_000,
        discount: { kind: "fixed", minor: 50_000 },
      },
    ],
  },
  inter: {
    recipient: mh,
    bank: true,
    lines: [
      { description: "Sample integration", qtyMilli: 2500, unit: "days", rateMinor: 1_800_000 },
      {
        description: "Sample data migration",
        detail: "Two sample sources",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 900_000,
      },
      {
        description: "Sample training session",
        sac: "999293",
        qtyMilli: 3000,
        unit: "hours",
        rateMinor: 250_000,
      },
    ],
  },
  long: {
    recipient: mh,
    bank: true,
    terms: true,
    signed: true,
    lines: manyLines(40),
  },
  "long-names": {
    recipient: {
      legalName: "Sample Extraordinarily Long Named Technology and Consultancy Services Private Limited",
      displayName: "Sample Extraordinarily Long Named Technology and Consultancy Services",
      gstin: "19ABCDE1234F1ZX",
      stateCode: "19",
      address: {
        line1:
          "Flat 12B, Sample Tower Number Forty-Two, Extraordinarily Long Sample Road Name Near The Sample Junction",
        line2: "Opposite the Sample Landmark That Also Has A Very Long Name",
        city: "Balurghat",
        state: "West Bengal",
        postalCode: "733101",
        country: "IN",
      },
      email: "client@example.test",
      country: "IN",
      contactId: "con_sample_3",
      contactName: "Sample Contact With An Unusually Long Full Name And Designation",
      clientType: "business",
      gstStatus: "registered",
    } as RecipientSnapshot,
    supplier: "long",
    bank: true,
    lines: [
      {
        description:
          "Sample line with an extraordinarily long description that keeps going well past the width of the description column so that it must wrap",
        detail:
          "Sample detail text that is also long enough to need several lines inside its cell of the table",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 9_999_900,
      },
      {
        description: "Sample_unbroken_identifier_without_spaces_that_must_still_wrap_inside_the_cell",
        qtyMilli: 12_500,
        unit: "hours",
        rateMinor: 123_456,
      },
    ],
  },
  bare: {
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
    supplier: "bare",
    bank: false,
    lines: [{ description: "Sample line", qtyMilli: 1000, unit: "item", rateMinor: 100_000 }],
  },
  signed: {
    recipient: wb,
    bank: true,
    signed: true,
    lines: [{ description: "Sample line", qtyMilli: 1000, unit: "item", rateMinor: 100_000 }],
  },
  "export-lut": {
    recipient: us,
    type: "export_invoice",
    route: "lut",
    bank: true,
    signed: true,
    country: { code: "US", name: "United States" },
    lines: usdLines,
  },
  "export-igst": {
    recipient: ci,
    type: "export_invoice",
    route: "igst_paid",
    bank: true,
    note: true,
    country: { code: "CI", name: "Côte d’Ivoire" },
    lines: [usdLines[0] as LineSpec],
  },
  proforma: {
    recipient: wb,
    type: "proforma",
    bank: true,
    lines: [
      {
        description: "Sample advance: 40 % of proposal TH/PRP/2627/0003",
        detail: "Sample first instalment, before the work starts",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 4_000_000,
      },
    ],
  },
  advance: {
    recipient: wb,
    advance: true,
    signed: true,
    lines: [
      {
        description: "Payment received against proforma TH/PI/2627/0004",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 3_389_831,
      },
    ],
  },
  "advance-export": {
    recipient: us,
    type: "export_invoice",
    route: "lut",
    bank: true,
    advance: true,
    signed: true,
    country: { code: "US", name: "United States" },
    lines: [
      {
        description: "Payment received against proforma TH/PI/2627/0004",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 150_000,
      },
    ],
  },
  udyam: {
    recipient: wb,
    bank: true,
    signed: true,
    udyam: true,
    lines: [
      {
        description: "Sample website build, phase one",
        sac: "998314",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 4_500_000,
      },
      {
        description: "Sample hosting set-up",
        sac: "998313",
        qtyMilli: 1000,
        unit: "fixed",
        rateMinor: 600_000,
      },
    ],
  },
};

// ---- a drawn sample signature (a made-up stroke, not anyone's signature) ------------------------------------------------------------

/** A 360 × 108 RGBA PNG of an ink stroke on transparent: deterministic, so the screenshots stay stable. */
function sampleSignaturePng(): Uint8Array {
  const w = 360;
  const h = 108;
  const px = new Uint8Array(w * h * 4);
  const ink = [0x14, 0x23, 0x1f];
  const dot = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const o = (Y * w + X) * 4;
        px.set([...ink, 255], o);
      }
  };
  for (let t = 0; t <= 1; t += 0.0004) {
    const x = 20 + t * 320;
    const y = 58 + Math.sin(t * Math.PI * 7) * (26 - t * 14) + Math.cos(t * Math.PI * 3) * 6;
    dot(x, y, 2);
  }
  for (let t = 0; t <= 1; t += 0.001) dot(60 + t * 250, 88 - t * 6, 1);
  // the shared test encoder (test-hardening 4c; the bytes are unchanged, pinned by packages/testing/test/png.test.ts)
  return rgbaPng(w, h, px, (raw) => deflateSync(raw, { level: 9 }));
}

export const SAMPLE_SIGNATURE_PNG = sampleSignaturePng();
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The verified signature a fixture hands to `toInvoiceView` (the jobs Worker passes it only after checking the frozen SHA-256). */
export const sampleSignatureOf = (name: InvoiceLayoutFixture): VerifiedSignature | null =>
  SPECS[name].signed ? { mime: "image/png", base64: toBase64(SAMPLE_SIGNATURE_PNG) } : null;

const hexOf = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** A made-up Udyam registration in the canonical shape (07-ZC line 4), never a real one. */
export const LAYOUT_UDYAM = { number: "UDYAM-WB-00-0000001", category: "micro" } as const;

function companyOf(kind: Spec["supplier"]): InvoiceIssuerSnapshot["company"] {
  if (kind === "bare")
    return {
      tradeName: "TecHaust Technologies",
      legalName: null,
      address: null,
      gstin: null,
      stateCode: "19",
      logo: "logo-primary-color.svg",
    } as InvoiceIssuerSnapshot["company"];
  return {
    tradeName: "TecHaust Technologies",
    legalName: "Sample Proprietor",
    address:
      kind === "long"
        ? "Sample Building Number Seventeen, Second Floor, Extraordinarily Long Sample Supplier Road, Near the Sample Bus Stand, Balurghat, Dakshin Dinajpur, West Bengal 733101"
        : "1 Sample Supplier Road, Balurghat, West Bengal 733101",
    gstin: "19ABCDE1234F1ZX",
    stateCode: "19",
    logo: "logo-primary-color.svg",
    email: "billing@example.test",
    phone: "+91 90000 00000",
    principalPlace: "2 Sample Office Lane, Balurghat",
  } as InvoiceIssuerSnapshot["company"];
}

export type InvoiceLayoutBuilt = {
  name: InvoiceLayoutFixture;
  envelope: InvoiceEnvelope;
  computed: ComputedDocument;
  signature: VerifiedSignature | null;
};

/** One sealed invoice envelope (tax, export or proforma) for a layout fixture, made the way the issue route and the snapshot step make it. */
export async function buildInvoiceLayoutFixture(name: InvoiceLayoutFixture): Promise<InvoiceLayoutBuilt> {
  const spec = SPECS[name];
  const type = spec.type ?? "tax_invoice";
  const route = type === "export_invoice" ? (spec.route ?? "lut") : null;
  const isExport = type === "export_invoice";
  const currency = isExport ? "USD" : "INR";
  const fx = isExport ? LAYOUT_FX : null;
  const discountOf = (l: LineSpec) =>
    l.discount?.kind === "percent"
      ? { kind: "percent" as const, bp: l.discount.bp }
      : l.discount?.kind === "fixed"
        ? { kind: "fixed" as const, minor: l.discount.minor }
        : null;
  const lineInputs: LineInput[] = spec.lines.map((l) => ({
    sac: l.sac ?? "998314",
    qtyMilli: l.qtyMilli,
    rateMinor: l.rateMinor,
    discount: discountOf(l),
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
      luts: route === "lut" ? [{ fy: "2627", arn: LAYOUT_ARN }] : [],
    },
  );
  if (!result.ok) throw new Error(`invoice layout fixture ${name}: ${JSON.stringify(result.errors)}`);
  const computed = result.value;
  const lines: EnvLine[] = spec.lines.map((l) => ({
    catalogueItemId: null,
    description: l.description,
    detail: l.detail ?? null,
    sac: l.sac ?? "998314",
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
    discountKind: l.discount?.kind ?? null,
    discountValue: l.discount ? (l.discount.kind === "percent" ? l.discount.bp : l.discount.minor) : null,
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
  const termsBody =
    "Sample notes pinned at issue.\n\n1. Sample note one: payment is due on the due date shown above.\n2. Sample note two, long enough to wrap onto a second line of the notes block at the foot of the invoice.";
  const termsSha = await sha256Hex(termsBody);
  const issuer: InvoiceIssuerSnapshot = {
    company: spec.udyam ? { ...companyOf(spec.supplier), udyam: LAYOUT_UDYAM } : companyOf(spec.supplier),
    bank: isExport
      ? {
          inr: null,
          swift: spec.bank
            ? spec.note
              ? {
                  accountName: "Sample Proprietor",
                  accountNo: "SAMPLEUSD000123",
                  swift: "SAMPINBB",
                  bankName: "Sample Bank",
                  branch: null,
                  bankAddress: null,
                  intermediary: null,
                  purposeCode: null,
                }
              : {
                  accountName: "Sample Proprietor",
                  accountNo: "SAMPLEUSD000123",
                  swift: "SAMPINBBXXX",
                  bankName: "Sample Bank",
                  branch: "Sample Branch, Kolkata",
                  bankAddress: "3 Sample Bank Street, Kolkata 700001, India",
                  intermediary: "Sample Intermediary Bank, New York (SAMPUS33)",
                  purposeCode: "P0802",
                }
            : null,
        }
      : {
          inr: spec.bank
            ? {
                accountName: "Sample Proprietor",
                accountNo: "SAMPLE0001234567",
                ifsc: "SAMP0000001",
                bankName: "Sample Bank",
                branch: "Sample Branch, Balurghat",
              }
            : null,
        },
    signature: spec.signed
      ? {
          key: "settings/signature-0123456789abcdef.png",
          sha256: await hexOf(SAMPLE_SIGNATURE_PNG),
          mime: "image/png",
        }
      : null,
    reverseChargeText: "Tax payable on reverse charge: No",
    sender: { staffId: "stf_sample_1", name: "Sample Proprietor", email: "sender@example.test" },
  } as InvoiceIssuerSnapshot;
  const termsRef = spec.terms ? { id: "trm_sample_1", version: 2, sha256: termsSha } : null;
  const country = spec.country ?? { code: "US", name: "United States" };
  const seal = await invoiceSealOf({
    document: {
      type,
      clientId: "cli_sample_1",
      currency,
      issueDate: "2026-10-28",
      dueDate: spec.advance ? "2026-10-28" : "2026-11-04",
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
            endorsement: LAYOUT_ENDORSEMENT[route],
            lut: route === "lut" ? { fy: "2627", arn: LAYOUT_ARN } : null,
            countryCode: country.code,
            countryName: country.name,
            declarationRef: spec.note
              ? { id: "trm_export_note", version: 1, sha256: await sha256Hex(LAYOUT_EXPORT_NOTE) }
              : null,
            ...(spec.note ? { declarationText: LAYOUT_EXPORT_NOTE } : {}),
          },
        }
      : {}),
    ...(fx ? { fx: { ...fx } } : {}),
    ...(type === "proforma" ? { proforma: { notice: LAYOUT_PROFORMA_NOTICE } } : {}),
    ...(spec.advance ? { advance: { ...LAYOUT_ADVANCE } } : {}),
  });
  const prefix = isExport ? "EXP" : type === "proforma" ? "PI" : "INV";
  const envelope = buildInvoiceEnvelope({
    documentId: `doc_invoice_layout_${name}`,
    type,
    number: 12,
    numberDisplay: `TH/${prefix}/2627/0012`,
    series: isExport ? "export" : type === "proforma" ? "proforma" : "invoice",
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
  return { name, envelope, computed, signature: sampleSignatureOf(name) };
}
