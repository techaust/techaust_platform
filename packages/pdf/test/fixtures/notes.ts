// Credit and debit note fixtures for the PDF tests (M5.3 stage B): envelopes built through core's REAL tax engine (`creditNote`, `creditForGross`, `debitNoteInput`) and
// sealed with the issue route's OWN functions (`invoiceSealOf`, core `contentHash`), so every figure and hash is what an issue produces. SAMPLE DATA ONLY (the repo is
// public): made-up names, @example.test addresses, a made-up GSTIN. The invoice a note is against is made here too (its frozen computed document), but never printed.
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { creditForGross, debitNoteInput, type NoteOf, noteOfFromStored } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import {
  type ComputedDocument,
  type CreditedSoFar,
  computeDocument,
  creditNote,
  type LineInput,
  type TaxContext,
} from "@techaust/core/tax";
import { invoiceSealOf } from "@techaust/db/documents";
import type { InvoiceIssuerSnapshot, RecipientSnapshot } from "@techaust/db/issue";
import { buildInvoiceEnvelope } from "../../src/invoice-envelope.ts";
import type { InvoiceEnvelope, InvoiceHeader } from "../../src/invoice-types.ts";
import type { EnvLine } from "../../src/types.ts";
import { OVERSEAS_RECIPIENT, SAMPLE_ARN, SAMPLE_SUPPLIER_GSTIN, WB_RECIPIENT } from "./invoice.ts";

export const NOTE_FIXTURE_NAMES = [
  "credit_lines",
  "credit_amount",
  "credit_full",
  "credit_usd_lut",
  "credit_usd_igst",
  "credit_other",
  "debit",
  "debit_usd_lut",
] as const;
export type NoteFixtureName = (typeof NOTE_FIXTURE_NAMES)[number];

/** The number of the invoice every note fixture is against. */
export const PARENT_NUMBER = "TH/INV/2627/0007";
export const PARENT_DATE = "2026-10-20";
const FX = { rateMicros: 83_123_400, date: "2026-10-20", source: "FBIL reference rate" } as const;

type Spec = {
  kind: "credit" | "debit";
  usd?: "lut" | "igst_paid";
  mode?: "lines" | "amount" | "full";
  /** The lines of the parent (rate in minor units) and what the note takes from them (taxable, minor units). */
  parent: number[];
  takes?: { line: number; taxableMinor: number }[];
  gross?: number;
  reason: { code: string; text: string };
};

const SPECS: Record<NoteFixtureName, Spec> = {
  credit_lines: {
    kind: "credit",
    mode: "lines",
    parent: [2_500_000, 1_800_000],
    takes: [
      { line: 0, taxableMinor: 500_000 },
      { line: 1, taxableMinor: 300_000 },
    ],
    reason: { code: "price_correction", text: "" },
  },
  credit_amount: {
    kind: "credit",
    mode: "amount",
    parent: [2_500_000, 1_800_000],
    gross: 590_000,
    reason: { code: "service_deficient", text: "Two of the five screens were not delivered." },
  },
  credit_full: {
    kind: "credit",
    mode: "full",
    parent: [2_500_000, 1_800_000],
    reason: { code: "service_not_delivered", text: "" },
  },
  credit_usd_lut: {
    kind: "credit",
    usd: "lut",
    mode: "lines",
    parent: [250_000, 270_000],
    takes: [{ line: 1, taxableMinor: 100_000 }],
    reason: { code: "price_correction", text: "" },
  },
  credit_usd_igst: {
    kind: "credit",
    usd: "igst_paid",
    mode: "lines",
    parent: [250_000],
    takes: [{ line: 0, taxableMinor: 50_000 }],
    reason: { code: "discount_after_sale", text: "" },
  },
  credit_other: {
    kind: "credit",
    mode: "lines",
    parent: [2_500_000],
    takes: [{ line: 0, taxableMinor: 100_000 }],
    reason: { code: "other", text: "Duplicate charge for the hosting month of October." },
  },
  debit: {
    kind: "debit",
    mode: "lines",
    parent: [2_500_000, 1_800_000],
    takes: [{ line: 1, taxableMinor: 200_000 }],
    reason: { code: "price_correction", text: "" },
  },
  debit_usd_lut: {
    kind: "debit",
    usd: "lut",
    mode: "lines",
    parent: [250_000],
    takes: [{ line: 0, taxableMinor: 20_000 }],
    reason: { code: "other", text: "Extra revision round agreed by email." },
  },
};

const none = (n: number, usd: boolean): CreditedSoFar => {
  const zero = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
  return {
    lines: Array.from({ length: n }, () => zero),
    creditedTotalMinor: 0,
    ...(usd ? { inr: { lines: Array.from({ length: n }, () => zero), totalMinor: 0 } } : {}),
  };
};

const good = <T>(r: { ok: true; value: T } | { ok: false; errors: unknown }): T => {
  if (!r.ok) throw new Error(`note fixture: ${JSON.stringify(r.errors)}`);
  return r.value;
};

export type NoteFixture = {
  name: NoteFixtureName;
  envelope: InvoiceEnvelope;
  parentComputed: ComputedDocument;
  computed: ComputedDocument;
  noteOf: NoteOf;
};

/** One sealed credit or debit note envelope, made the way the issue route and the snapshot step make it. */
export async function buildNoteFixture(name: NoteFixtureName): Promise<NoteFixture> {
  const spec = SPECS[name];
  const usd = spec.usd !== undefined;
  const recipient: RecipientSnapshot = usd ? OVERSEAS_RECIPIENT : WB_RECIPIENT;
  const ctx: TaxContext = {
    tax: SETTINGS_DEFAULTS.tax,
    supplierStateCode: "19",
    luts: spec.usd === "lut" ? [{ fy: "2627", arn: SAMPLE_ARN }] : [],
  };
  const parentInputs: LineInput[] = spec.parent.map((rateMinor) => ({
    sac: "998314",
    qtyMilli: 1000,
    rateMinor,
  }));
  const parentComputed = good(
    computeDocument(
      {
        currency: usd ? "USD" : "INR",
        documentDate: { year: 2026, month: 10, day: 20 },
        recipient: {
          gstStatus: recipient.gstStatus ?? "registered",
          country: recipient.country,
          ...(recipient.gstin ? { gstin: recipient.gstin } : {}),
          ...(recipient.stateCode ? { stateCode: recipient.stateCode } : {}),
        },
        ...(spec.usd ? { exportMode: spec.usd, fx: { rateMicros: FX.rateMicros } } : {}),
        lines: parentInputs,
      },
      ctx,
    ),
  );
  const noteDate = { year: 2026, month: 10, day: 28 } as const;
  let computed: ComputedDocument;
  let takes: { line: number; taxableMinor: number }[];
  if (spec.kind === "debit") {
    takes = spec.takes ?? [];
    const input = debitNoteInput(
      { computed: parentComputed, recipientStatus: recipient.gstStatus ?? "registered" },
      takes,
      noteDate,
    );
    if (!input.ok) throw new Error(`debit fixture ${name}: ${JSON.stringify(input.errors)}`);
    computed = good(computeDocument(input.input, ctx));
  } else if (spec.mode === "full") {
    computed = good(
      creditNote(parentComputed, none(parentComputed.lines.length, usd), { kind: "full" }, ctx),
    );
    takes = computed.lines.map((l) => ({ line: l.index, taxableMinor: l.taxableMinor }));
  } else if (spec.mode === "amount") {
    const r = creditForGross(parentComputed, none(parentComputed.lines.length, usd), spec.gross ?? 0, ctx);
    if (!r.ok) throw new Error(`credit fixture ${name}: ${r.reason}`);
    computed = r.document;
    takes = [...r.takes];
  } else {
    takes = spec.takes ?? [];
    computed = good(
      creditNote(
        parentComputed,
        none(parentComputed.lines.length, usd),
        { kind: "lines", lines: takes },
        ctx,
      ),
    );
  }
  const lines: EnvLine[] = takes.map((t) => ({
    catalogueItemId: null,
    description: `Sample line ${t.line + 1}`,
    detail: null,
    sac: "998314",
    qtyMilli: 1000,
    unit: "item",
    rateMinor: t.taxableMinor,
    discountKind: null,
    discountValue: null,
    gstRateBp: 1800,
    catalogueRateMinor: null,
    catalogueLine: null,
  }));
  const noteOf = noteOfFromStored({
    kind: spec.kind,
    parent: {
      id: "doc_parent_sample",
      type: usd ? "export_invoice" : "tax_invoice",
      fy: "2627",
      number: PARENT_NUMBER,
      issueDate: PARENT_DATE,
      supplyType: parentComputed.supply.type,
      recipientStatus: recipient.gstStatus ?? "registered",
      placeOfSupplyCode: parentComputed.supply.placeOfSupplyCode,
      totalMinor: parentComputed.totalMinor,
      totalInrMinor: parentComputed.inr?.totalMinor ?? null,
      ...(spec.usd === "lut" ? { lut: { fy: "2627", arn: SAMPLE_ARN } } : {}),
    },
    reason: spec.reason,
    request: {
      mode: spec.mode ?? "lines",
      ...(spec.mode === "amount" ? { grossMinor: spec.gross } : {}),
      takes,
    },
  });
  if (!noteOf) throw new Error(`note fixture ${name}: noteOf is malformed`);
  const type = spec.kind === "credit" ? "credit_note" : "debit_note";
  const draft: DraftContent = {
    type,
    clientId: "cli_sample_1",
    contactId: recipient.contactId ?? null,
    title: null,
    currency: usd ? "USD" : "INR",
    validityDays: null,
    termsVersionId: null,
    discountKind: null,
    discountValue: null,
    exportMode: spec.usd ?? null,
    ...(usd ? { fx: { ...FX } } : {}),
    lines,
    sections: [],
    schedule: [],
    note: {
      parentId: noteOf.parent.id,
      kind: noteOf.kind,
      reasonCode: noteOf.reason.code,
      reasonText: noteOf.reason.text,
      mode: noteOf.request.mode,
      grossMinor: noteOf.request.grossMinor ?? null,
      takes: noteOf.request.takes,
    },
  };
  const contentSha = await contentHash(draft, computed);
  const issuer: InvoiceIssuerSnapshot = {
    company: {
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
    // a credit note carries no bank block; a debit note is paid like an invoice (07-T / LD52)
    bank:
      spec.kind === "credit"
        ? { inr: null }
        : usd
          ? {
              inr: null,
              swift: {
                accountName: "Sample Proprietor",
                accountNo: "SAMPLEUSD0001",
                swift: "SAMPINBBXXX",
                bankName: "SAMPLE BANK",
                branch: "Sample branch",
                bankAddress: "3 Sample Bank Street, Kolkata",
                intermediary: null,
                purposeCode: "P0802",
              },
            }
          : {
              inr: {
                accountName: "Sample Proprietor",
                accountNo: "SAMPLE0001",
                ifsc: "SAMP0000001",
                bankName: "SAMPLE BANK",
                branch: "Sample branch",
              },
            },
    signature: null,
    reverseChargeText: "Tax payable on reverse charge: No",
    sender: { staffId: "stf_sample_1", name: "Sample Proprietor", email: "sender@example.test" },
  };
  const seal = await invoiceSealOf({
    document: {
      type,
      clientId: "cli_sample_1",
      currency: usd ? "USD" : "INR",
      issueDate: "2026-10-28",
      dueDate: spec.kind === "credit" ? null : "2026-11-04",
      contentSha256: contentSha,
      termsRef: null,
      exportMode: spec.usd ?? null,
    },
    computed,
    recipient,
    issuer,
    ...(usd ? { fx: { ...FX } } : {}),
    noteOf,
  });
  const envelope = buildInvoiceEnvelope({
    documentId: `doc_note_${name}`,
    type,
    number: 1,
    numberDisplay: spec.kind === "credit" ? "TH/CN/2627/0001" : "TH/DN/2627/0001",
    series: spec.kind === "credit" ? "creditNote" : "debitNote",
    fy: "2026-27",
    issuedAt: 1_793_000_000_000,
    snapshotSha256: seal.snapshotSha256,
    snapshot: {
      header: seal.input as unknown as InvoiceHeader,
      computedJson: seal.computedJson,
      discountKind: null,
      discountValue: null,
      lines,
      terms: null,
    },
  });
  return { name, envelope, parentComputed, computed, noteOf };
}
