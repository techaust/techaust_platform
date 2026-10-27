// Fixtures of the M5.5b report tests: issued (frozen) documents of the four GST kinds, inserted as the freeze leaves them (like `parentInvoice` in the database tests), with a real
// computed document, and the Q9 receipt rows. Used where a test needs many documents on chosen dates: the totals test (M5.5b) issues through the real routes instead.
import { uuidv7 } from "@techaust/core/ids";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { type ComputedDocument, computeDocument, type LineInput, type TaxContext } from "@techaust/core/tax";
import { insert, mkClient } from "./test-clients.ts";

const CTX: TaxContext = {
  tax: SETTINGS_DEFAULTS.tax,
  supplierStateCode: "19",
  luts: [{ fy: "2627", arn: "TEST-ARN" }],
};
const DATE = { year: 2026, month: 10, day: 25 } as const;
export const line = (rateMinor: number, extra: Partial<LineInput> = {}): LineInput => ({
  sac: "998314",
  qtyMilli: 1000,
  rateMinor,
  ...extra,
});

export type DocSpec = {
  type?: "tax_invoice" | "export_invoice" | "credit_note" | "debit_note" | "proforma";
  clientId: string;
  currency?: "INR" | "USD";
  issueDate: string;
  lines?: LineInput[];
  recipient?: "registered" | "unregistered";
  stateCode?: string;
  fx?: number;
  number?: number;
  voided?: boolean;
  balance?: number;
  dueDate?: string | null;
  parentId?: string | null;
  status?: string;
  over?: Record<string, unknown>;
};

let seq = 0;
const SERIES = {
  tax_invoice: "invoice",
  export_invoice: "export",
  credit_note: "creditNote",
  debit_note: "debitNote",
  proforma: "proforma",
} as const;

export function computeFor(spec: DocSpec): ComputedDocument {
  const lines = spec.lines ?? [line(1_000_00)];
  const usd = (spec.currency ?? "INR") === "USD";
  const r = computeDocument(
    usd
      ? {
          currency: "USD" as const,
          documentDate: DATE,
          recipient: { gstStatus: "overseas" as const, country: "US" },
          lines,
          fx: { rateMicros: spec.fx ?? 83_123_400 },
        }
      : {
          currency: "INR" as const,
          documentDate: DATE,
          recipient: {
            gstStatus: spec.recipient ?? ("registered" as const),
            country: "IN",
            gstin: spec.recipient === "unregistered" ? null : "19ABCDE1234F1ZX",
            stateCode: spec.stateCode ?? "19",
          },
          lines,
        },
    CTX,
  );
  if (!r.ok) throw new Error(`does not compute: ${JSON.stringify(r.errors)}`);
  return r.value;
}

/** Insert one frozen document of a client; returns its id, number and computed document. */
export async function addDoc(
  spec: DocSpec,
): Promise<{ id: string; number: string; computed: ComputedDocument }> {
  const type = spec.type ?? (spec.currency === "USD" ? "export_invoice" : "tax_invoice");
  const computed = computeFor(spec);
  const id = uuidv7();
  const n = spec.number ?? 5_000 + ++seq;
  const usd = (spec.currency ?? "INR") === "USD";
  const number = `${SERIES[type].slice(0, 1).toUpperCase()}/${String(n).padStart(4, "0")}`;
  await insert("documents", {
    id,
    type,
    status: spec.status ?? (spec.voided ? "void" : "issued"),
    client_id: spec.clientId,
    currency: spec.currency ?? "INR",
    parent_id: spec.parentId ?? null,
    series: SERIES[type],
    fy: "2627",
    number: n,
    number_display: number,
    frozen_at: 1_000,
    issue_date: spec.issueDate,
    due_date: spec.dueDate === undefined ? "2026-11-01" : spec.dueDate,
    content_sha256: "p".repeat(64),
    snapshot_sha256: "q".repeat(64),
    export_mode: usd ? "lut" : null,
    fx_rate_micros: usd ? (spec.fx ?? 83_123_400) : null,
    fx_date: usd ? "2026-10-24" : null,
    fx_source: usd ? "FBIL" : null,
    paid_minor: 0,
    balance_minor: spec.balance ?? computed.totalMinor,
    updated_at: 7_000,
    recipient: JSON.stringify({
      legalName: `Client ${n}`,
      country: usd ? "US" : "IN",
      gstStatus: usd ? "overseas" : "registered",
    }),
    ...(spec.voided ? { voided_at: 5, void_reason: "x" } : {}),
    subtotal_minor: computed.subtotalMinor,
    discount_minor: computed.discountMinor,
    taxable_minor: computed.taxableMinor,
    cgst_minor: computed.cgstMinor,
    sgst_minor: computed.sgstMinor,
    igst_minor: computed.igstMinor,
    round_off_minor: computed.roundOffMinor,
    total_minor: computed.totalMinor,
    total_inr_minor: computed.inr?.totalMinor ?? null,
    supply_type: computed.supply.type,
    place_of_supply_code: computed.supply.placeOfSupplyCode,
    computed: JSON.stringify(computed),
    ...spec.over,
  });
  return { id, number, computed };
}

/** An overseas (USD) or domestic (INR) client with codes of its own. */
export const mkReportClient = (currency: "INR" | "USD" = "INR", over: Record<string, unknown> = {}) =>
  mkClient(
    currency === "USD"
      ? { country: "US", gst_status: "overseas", state_code: null, currency: "USD", ...over }
      : over,
  );

/** A Q9 advance receipt (the proforma, the advance tax invoice made from it, and the money). */
export async function addReceipt(o: {
  clientId: string;
  proformaId: string;
  invoiceId: string;
  currency: "INR" | "USD";
  amountMinor: number;
  receivedOn: string;
  createdBy: string;
}): Promise<string> {
  const id = uuidv7();
  await insert("advance_receipts", {
    id,
    proforma_id: o.proformaId,
    invoice_id: o.invoiceId,
    client_id: o.clientId,
    currency: o.currency,
    amount_minor: o.amountMinor,
    received_on: o.receivedOn,
    reference_norm: `REF-${id.slice(-8)}`,
    created_by: o.createdBy,
  });
  return id;
}
