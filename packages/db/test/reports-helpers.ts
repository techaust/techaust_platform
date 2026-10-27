// Helpers for the M5.5b database tests: issued (frozen) documents of every reportable kind with a real computed document, inserted as the freeze leaves
// them (like `parentInvoice` in note-helpers.ts), and client, receipt and settings rows. All names, GSTINs and amounts are invented test data.
import { uuidv7 } from "@techaust/core";
import { type ComputedDocument, computeDocument, type LineInput } from "@techaust/core/tax";
import { run } from "./helpers.ts";
import { CTX, DATE, line, mkClient, mkOwner, nextFy } from "./note-helpers.ts";

export { CTX, DATE, line, mkClient, mkOwner };

export type Spec = {
  type?: "tax_invoice" | "export_invoice" | "credit_note" | "debit_note" | "proforma";
  clientId: string;
  currency?: "INR" | "USD";
  issueDate: string;
  lines?: LineInput[];
  /** INR documents: the recipient (default registered, West Bengal: CGST + SGST); USD: the export route. */
  recipient?: "registered" | "unregistered";
  stateCode?: string;
  fx?: number;
  exportMode?: "lut" | "igst_paid";
  number?: number;
  status?: string;
  voided?: boolean;
  balance?: number;
  dueDate?: string | null;
  parentId?: string | null;
  frozen?: boolean;
  headerExtras?: unknown;
  issuer?: unknown;
  recipientSnapshot?: unknown;
  /** A document already computed (the engine's golden cases): used as it is; `currency` then follows it. */
  computed?: ComputedDocument;
  /** Overrides on the row, last. */
  over?: Record<string, unknown>;
};

let seq = 0;

/** Compute a document as the engine does (INR: registered or not, intra or inter; USD: an export with FX). */
export function computeFor(spec: Spec): ComputedDocument {
  const lines = spec.lines ?? [line(1_000_00), line(500_00, { sac: "998313" })];
  const usd = (spec.currency ?? "INR") === "USD";
  const input = usd
    ? {
        currency: "USD" as const,
        documentDate: DATE,
        recipient: { gstStatus: "overseas" as const, country: "US" },
        lines,
        fx: { rateMicros: spec.fx ?? 83_123_400 },
        exportMode: spec.exportMode,
      }
    : {
        currency: "INR" as const,
        documentDate: DATE,
        recipient: {
          gstStatus: spec.recipient ?? ("registered" as const),
          country: "IN",
          gstin:
            spec.recipient === "unregistered"
              ? null
              : spec.stateCode === "29"
                ? "29ABCDE1234F1ZW"
                : "19ABCDE1234F1ZX",
          stateCode: spec.stateCode ?? "19",
        },
        lines,
      };
  const r = computeDocument(input, CTX);
  if (!r.ok) throw new Error(`the document does not compute: ${JSON.stringify(r.errors)}`);
  return r.value;
}

const SERIES = {
  tax_invoice: "invoice",
  export_invoice: "export",
  credit_note: "creditNote",
  debit_note: "debitNote",
  proforma: "proforma",
} as const;

/** Insert one document; returns its id and the computed document. The row is frozen unless `frozen: false`. */
export async function addDoc(
  spec: Spec,
): Promise<{ id: string; computed: ComputedDocument; number: string }> {
  const computed = spec.computed ?? computeFor(spec);
  const cur: "INR" | "USD" = spec.computed ? spec.computed.currency : (spec.currency ?? "INR");
  const type = spec.type ?? (cur === "USD" ? "export_invoice" : "tax_invoice");
  const id = uuidv7();
  const n = spec.number ?? ++seq;
  const fy = "2627";
  const frozen = spec.frozen !== false;
  const status = spec.status ?? (spec.voided ? "void" : "issued");
  const display = `${SERIES[type].slice(0, 1).toUpperCase()}/${String(n).padStart(4, "0")}`;
  const total = computed.totalMinor;
  const row: Record<string, unknown> = {
    id,
    type,
    status: frozen ? status : "draft",
    client_id: spec.clientId,
    currency: cur,
    parent_id: spec.parentId ?? null,
    series: frozen ? SERIES[type] : null,
    fy: frozen ? fy : null,
    number: frozen ? n : null,
    number_display: frozen ? display : null,
    frozen_at: frozen ? 1_000 : null,
    issue_date: frozen ? spec.issueDate : null,
    due_date: spec.dueDate === undefined ? "2026-11-01" : spec.dueDate,
    content_sha256: "p".repeat(64),
    snapshot_sha256: frozen ? "q".repeat(64) : null,
    export_mode: cur === "USD" ? (spec.exportMode ?? "lut") : null,
    fx_rate_micros: cur === "USD" ? (spec.fx ?? 83_123_400) : null,
    fx_date: cur === "USD" ? "2026-10-24" : null,
    fx_source: cur === "USD" ? "FBIL" : null,
    paid_minor: 0,
    balance_minor: spec.balance ?? total,
    updated_at: 7_000,
    recipient: JSON.stringify(
      spec.recipientSnapshot ?? {
        legalName: `Client ${spec.clientId.slice(-4)}`,
        country: cur === "USD" ? "US" : "IN",
        gstStatus: "registered",
      },
    ),
    issuer: spec.issuer === undefined ? null : JSON.stringify(spec.issuer),
    header_extras: spec.headerExtras === undefined ? null : JSON.stringify(spec.headerExtras),
    ...(spec.voided ? { voided_at: 5, void_reason: "x" } : {}),
    subtotal_minor: computed.subtotalMinor,
    discount_minor: computed.discountMinor,
    taxable_minor: computed.taxableMinor,
    cgst_minor: computed.cgstMinor,
    sgst_minor: computed.sgstMinor,
    igst_minor: computed.igstMinor,
    round_off_minor: computed.roundOffMinor,
    total_minor: total,
    total_inr_minor: computed.inr?.totalMinor ?? null,
    supply_type: computed.supply.type,
    place_of_supply_code: computed.supply.placeOfSupplyCode,
    computed: JSON.stringify(computed),
    ...spec.over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return { id, computed, number: display };
}

/** A client of a given currency and GST status (distinct code per call); USD clients are overseas. */
export const mkReportClient = (currency: "INR" | "USD" = "INR", over: Record<string, unknown> = {}) =>
  mkClient(
    currency === "USD"
      ? { country: "US", gst_status: "overseas", state_code: null, currency: "USD", ...over }
      : { currency: "INR", ...over },
  );

/** A Q9 advance receipt row against an advance invoice of the client (the proforma id and the invoice id are real documents). */
export async function addReceipt(o: {
  clientId: string;
  proformaId: string;
  invoiceId: string;
  currency: "INR" | "USD";
  amountMinor: number;
  receivedOn: string;
  ownerId: string;
}): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    id,
    o.proformaId,
    o.invoiceId,
    o.clientId,
    o.currency,
    o.amountMinor,
    o.receivedOn,
    `REF-${id.slice(-8)}`,
    o.ownerId,
  );
  return id;
}

export const freshFy = nextFy;

/** Store (or replace) the `tax` settings row; the database tests start without a seed. */
export async function putTax(value: unknown): Promise<void> {
  await run(
    "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
    JSON.stringify(value),
  );
}
