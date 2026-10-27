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
import { deflateSync } from "node:zlib";
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { type ComputedDocument, computeDocument, type LineInput } from "@techaust/core/tax";
import { invoiceSealOf } from "@techaust/db/documents";
import type { InvoiceIssuerSnapshot, RecipientSnapshot } from "@techaust/db/issue";
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
};

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
};

// ---- a drawn sample signature (a made-up stroke, not anyone's signature) ------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
  return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))]);
}

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
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, 6, 0, 0, 0]);
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    ...chunk("IEND", new Uint8Array()),
  ]);
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

/** One sealed tax invoice envelope for a layout fixture, made the way the issue route and the snapshot step make it. */
export async function buildInvoiceLayoutFixture(name: InvoiceLayoutFixture): Promise<InvoiceLayoutBuilt> {
  const spec = SPECS[name];
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
  const termsBody =
    "Sample notes pinned at issue.\n\n1. Sample note one: payment is due on the due date shown above.\n2. Sample note two, long enough to wrap onto a second line of the notes block at the foot of the invoice.";
  const termsSha = await sha256Hex(termsBody);
  const issuer: InvoiceIssuerSnapshot = {
    company: companyOf(spec.supplier),
    bank: {
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
    documentId: `doc_invoice_layout_${name}`,
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
  return { name, envelope, computed, signature: sampleSignatureOf(name) };
}
