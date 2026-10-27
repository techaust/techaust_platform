// A tiny made-up envelope for the jobs Worker's start-up warm-up (CPU tuning, the same idea as apps/jobs/src/warm.ts): one render at module
// load compiles the view, Markdown and HTML code, so the first real message does not pay for it. Hand-written, so it pulls in no tax
// engine and no zod. The hashes are placeholders: the warm-up never verifies. Nothing here is stored, sent or logged.
import { buildEnvelope } from "./envelope.ts";
import { buildInvoiceEnvelope } from "./invoice-envelope.ts";
import type { InvoiceEnvelope } from "./invoice-types.ts";
import { toInvoiceView } from "./invoice-view.ts";
import { renderDocumentHtml } from "./render.ts";
import type { Envelope } from "./types.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "./view.ts";

const ZERO = "0".repeat(64);

const COMPUTED = {
  currency: "INR",
  supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
  fxRateMicros: null,
  lines: [
    {
      index: 0,
      sac: "998314",
      grossMinor: 100_000,
      lineDiscountMinor: 0,
      documentDiscountMinor: 0,
      discountMinor: 0,
      taxableMinor: 100_000,
      gstRateBp: 1800,
      effectiveRateBp: 1800,
      cgstMinor: 9000,
      sgstMinor: 9000,
      igstMinor: 0,
      lineTotalMinor: 118_000,
      inr: null,
    },
  ],
  summary: [
    {
      sac: "998314",
      gstRateBp: 1800,
      effectiveRateBp: 1800,
      taxableMinor: 100_000,
      cgstMinor: 9000,
      sgstMinor: 9000,
      igstMinor: 0,
    },
  ],
  subtotalMinor: 100_000,
  discountMinor: 0,
  taxableMinor: 100_000,
  cgstMinor: 9000,
  sgstMinor: 9000,
  igstMinor: 0,
  roundOffMinor: 0,
  totalMinor: 118_000,
  words: "One thousand one hundred and eighty rupees only",
  inr: null,
};

/** A valid-looking envelope of made-up data, for warming the render code. */
export function warmEnvelope(): Envelope {
  const header = {
    document: {
      type: "proposal" as const,
      clientId: "warm",
      versionGroupId: "warm",
      version: 1,
      currency: "INR",
      title: "Warm up",
      issueDate: "2026-10-26",
      validUntil: "2026-11-10",
      validityDays: 15,
      contentSha256: ZERO,
      discountKind: null,
      discountValue: null,
      exportMode: null,
    },
    supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
    recipient: { legalName: "Warm Up Client", country: "IN", stateCode: "19", contactName: "Warm Contact" },
    issuer: {
      company: {
        tradeName: "Warm Up",
        legalName: null,
        address: null,
        gstin: null,
        stateCode: "19",
        logo: "logo-primary-color.svg",
      },
      sender: { staffId: "warm", name: "Warm Up", email: "warm@example.test" },
    },
    terms: { id: "warm", version: 1, sha256: ZERO },
    instalmentAmounts: [118_000],
    computedSha256: ZERO,
  };
  return buildEnvelope({
    documentId: "warm",
    type: "proposal",
    version: 1,
    number: 1,
    numberDisplay: "TH/PRP/2627/0001",
    series: "proposal",
    fy: "2026-27",
    sentAt: 1_790_000_000_000,
    snapshotSha256: ZERO,
    snapshot: {
      v: 2,
      header,
      computedJson: JSON.stringify(COMPUTED),
      lines: [
        {
          catalogueItemId: null,
          description: "Warm up work with **bold** and a [link](https://warm-up.invalid/)",
          detail: "Detail",
          sac: "998314",
          qtyMilli: 1000,
          unit: "item",
          rateMinor: 100_000,
          discountKind: null,
          discountValue: null,
          gstRateBp: 1800,
          catalogueRateMinor: null,
          catalogueLine: null,
        },
      ],
      sections: [
        { kind: "summary", title: null, bodyMd: "A *warm* summary.\n\n- one\n- two", hidden: false },
        { kind: "estimate", title: null, bodyMd: "Below.", hidden: false },
      ],
      schedule: [
        { label: "On acceptance", trigger: "on_accept", pctBp: 10_000, detail: null, targetDate: null },
      ],
      terms: { id: "warm", version: 1, sha256: ZERO, bodyMd: "1. Warm terms." },
    },
  });
}

/** Renders the sample once; returns the HTML length (a test notices a warm-up that silently stopped working). */
export function warmPdf(): number {
  try {
    return renderDocumentHtml(toPdfView(warmEnvelope())).length;
  } catch {
    // never stop a Worker from starting
    return 0;
  }
}

/** A valid-looking invoice envelope of made-up data (M5.1), for warming the invoice view and layout. */
export function warmInvoiceEnvelope(): InvoiceEnvelope {
  return buildInvoiceEnvelope({
    documentId: "warm",
    type: "tax_invoice",
    number: 1,
    numberDisplay: "TH/INV/2627/0001",
    series: "invoice",
    fy: "2026-27",
    issuedAt: 1_790_000_000_000,
    snapshotSha256: ZERO,
    snapshot: {
      header: {
        document: {
          type: "tax_invoice",
          clientId: "warm",
          currency: "INR",
          issueDate: "2026-10-26",
          dueDate: "2026-11-02",
          contentSha256: ZERO,
          termsRef: { id: "warm", version: 1, sha256: ZERO },
          exportMode: null,
        },
        supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
        recipient: {
          legalName: "Warm Up Client",
          country: "IN",
          stateCode: "19",
          contactName: "Warm Contact",
        },
        issuer: {
          company: {
            tradeName: "Warm Up",
            legalName: null,
            address: null,
            gstin: null,
            stateCode: "19",
            logo: "logo-primary-color.svg",
          },
          bank: { inr: null },
          signature: null,
          reverseChargeText: "Tax payable on reverse charge: No",
          sender: { staffId: "warm", name: "Warm Up", email: "warm@example.test" },
        },
        computedSha256: ZERO,
      },
      computedJson: JSON.stringify(COMPUTED),
      discountKind: null,
      discountValue: null,
      lines: [
        {
          catalogueItemId: null,
          description: "Warm up work",
          detail: "Detail",
          sac: "998314",
          qtyMilli: 1000,
          unit: "item",
          rateMinor: 100_000,
          discountKind: null,
          discountValue: null,
          gstRateBp: 1800,
          catalogueRateMinor: null,
          catalogueLine: null,
        },
      ],
      terms: { id: "warm", version: 1, sha256: ZERO, bodyMd: "1. Warm notes." },
    },
  });
}

/** Renders the invoice sample once; returns the HTML length (0 on failure: it never stops a Worker from starting). */
export function warmInvoicePdf(): number {
  try {
    return renderDocumentHtml(toInvoiceView(warmInvoiceEnvelope(), DEFAULT_VIEW_CONFIG)).length;
  } catch {
    return 0;
  }
}
