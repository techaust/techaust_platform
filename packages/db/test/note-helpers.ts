// Helpers for the M5.3 database tests: a client, an ISSUED invoice with a real computed document, and note drafts and issues through the real statements.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { creditedSoFarOf, creditedSumOf } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import {
  type ComputedDocument,
  type CreditedSoFar,
  computeDocument,
  creditNote,
  type LineInput,
  type TaxContext,
} from "@techaust/core/tax";
import { type InvoiceIssueArgs, invoiceIssueStatements, noteDraftStatements } from "../src/issue.ts";
import { all, first, run } from "./helpers.ts";

let seq = 0;
let fyN = 7000;
export const nextFy = () => String(++fyN);

export const CTX: TaxContext = {
  tax: SETTINGS_DEFAULTS.tax,
  supplierStateCode: "19",
  luts: [{ fy: "2627", arn: "TEST-ARN" }],
};
export const DATE = { year: 2026, month: 10, day: 25 } as const;
export const line = (rateMinor: number, extra: Partial<LineInput> = {}): LineInput => ({
  sac: "998314",
  qtyMilli: 1000,
  rateMinor,
  ...extra,
});

export async function mkClient(over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row: Record<string, unknown> = {
    id,
    code: `C-N${String(++seq).padStart(5, "0")}`,
    legal_name: "L",
    display_name: "D",
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    // (no GSTIN on the row: it is unique, and the tests do not need one in the database; the computed document carries its own recipient)
    gstin: null,
    state_code: "19",
    currency: "INR",
    updated_at: 5_000,
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}

export async function mkOwner(stepUp?: number | null) {
  const ownerId = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
    ownerId,
    `${ownerId}@example.com`,
  );
  const sessionId = `sess-${uuidv7()}`;
  const now = Date.now();
  await run(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    sessionId,
    ownerId,
    now,
    now + 3_600_000,
    now + 3_600_000,
    stepUp === undefined ? now + 600_000 : stepUp,
  );
  return { ownerId, sessionId };
}

export const PATTERNS = {
  creditNote: sqlPrintfPattern(defaultFormat("creditNote")),
  debitNote: sqlPrintfPattern(defaultFormat("debitNote")),
};

export const versions = async () => {
  const get = async (key: string) =>
    (await first<{ version: number }>("SELECT version FROM settings WHERE key = ?", key))?.version ?? null;
  return {
    numberingVersion: await get("numbering"),
    companyVersion: await get("company"),
    taxVersion: await get("tax"),
    paymentTermsVersion: await get("payment_terms"),
    bankStamp:
      (await first<{ m: number | null }>("SELECT max(updated_at) AS m FROM bank_accounts WHERE active = 1"))
        ?.m ?? null,
  };
};

export const issuerOf = (staffId: string) => ({
  company: {
    tradeName: "T",
    legalName: "L",
    address: "A",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  bank: { inr: null },
  signature: null,
  reverseChargeText: "Tax payable on reverse charge: No",
  sender: { staffId, name: "N", email: "billing@example.com" },
});

export type Parent = {
  id: string;
  clientId: string;
  computed: ComputedDocument;
  fy: string;
  ownerId: string;
  sessionId: string;
  updatedAt: number;
};

const colsOfComputed = (k: ComputedDocument) => ({
  subtotal_minor: k.subtotalMinor,
  discount_minor: k.discountMinor,
  taxable_minor: k.taxableMinor,
  cgst_minor: k.cgstMinor,
  sgst_minor: k.sgstMinor,
  igst_minor: k.igstMinor,
  round_off_minor: k.roundOffMinor,
  total_minor: k.totalMinor,
  total_inr_minor: k.inr?.totalMinor ?? null,
  supply_type: k.supply.type,
  place_of_supply_code: k.supply.placeOfSupplyCode,
  computed: JSON.stringify(k),
});

/** An issued (frozen) tax invoice, or an export invoice (USD, with a rate), with a real computed document. Inserted frozen, as the freeze would leave it. */
export async function parentInvoice(
  over: {
    lines?: LineInput[];
    overseas?: boolean;
    stateCode?: string;
    status?: string;
    paid?: number;
    fx?: number;
    exportMode?: "lut" | "igst_paid";
    gstStatus?: "registered" | "unregistered";
  } = {},
): Promise<Parent> {
  const fy = nextFy();
  const overseas = over.overseas === true;
  const clientId = await mkClient(
    overseas
      ? { country: "US", gst_status: "overseas", gstin: null, state_code: null, currency: "USD" }
      : {
          state_code: over.stateCode ?? "19",
        },
  );
  const { ownerId, sessionId } = await mkOwner();
  const lines = over.lines ?? [line(1_000_00), line(500_00, { sac: "998313" })];
  const input = overseas
    ? {
        currency: "USD" as const,
        documentDate: DATE,
        recipient: { gstStatus: "overseas" as const, country: "US" },
        lines,
        fx: { rateMicros: over.fx ?? 83_123_400 },
        exportMode: over.exportMode,
      }
    : {
        currency: "INR" as const,
        documentDate: DATE,
        recipient: {
          gstStatus: over.gstStatus ?? ("registered" as const),
          country: "IN",
          gstin:
            over.gstStatus === "unregistered"
              ? null
              : over.stateCode === "29"
                ? "29ABCDE1234F1ZW"
                : "19ABCDE1234F1ZX",
          stateCode: over.stateCode ?? "19",
        },
        lines,
      };
  const r = computeDocument(input, CTX);
  if (!r.ok) throw new Error(`parent does not compute: ${JSON.stringify(r.errors)}`);
  const k = r.value;
  const id = uuidv7();
  const n = ++seq;
  const updatedAt = 7_000;
  const status = over.status ?? "issued";
  const row: Record<string, unknown> = {
    id,
    type: overseas ? "export_invoice" : "tax_invoice",
    status,
    client_id: clientId,
    currency: overseas ? "USD" : "INR",
    series: overseas ? "export" : "invoice",
    fy,
    number: n,
    number_display: `P/${fy}/${n}`,
    frozen_at: 1_000,
    issue_date: "2026-10-25",
    due_date: "2026-11-01",
    content_sha256: "p".repeat(64),
    snapshot_sha256: "q".repeat(64),
    export_mode: overseas ? (over.exportMode ?? "lut") : null,
    fx_rate_micros: overseas ? (over.fx ?? 83_123_400) : null,
    fx_date: overseas ? "2026-10-24" : null,
    fx_source: overseas ? "FBIL" : null,
    paid_minor: over.paid ?? 0,
    balance_minor: Math.max(0, k.totalMinor - (over.paid ?? 0)),
    updated_at: updatedAt,
    ...(status === "void" ? { voided_at: 5, void_reason: "x" } : {}),
    ...colsOfComputed(k),
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return { id, clientId, computed: k, fy, ownerId, sessionId, updatedAt };
}

/** What the issued credit notes of a parent took so far, worked out BY SQL (the statements the Worker reads). */
export async function creditedBySql(parentId: string, original: ComputedDocument): Promise<CreditedSoFar> {
  const { CREDITED_SO_FAR_SQL, CREDITED_TOTALS_SQL } = await import("../src/issue.ts");
  const rows = await all<{
    idx: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    inrTaxable: number;
    inrCgst: number;
    inrSgst: number;
    inrIgst: number;
  }>(CREDITED_SO_FAR_SQL, parentId);
  const t = await first<{ total: number; totalInr: number; count: number }>(CREDITED_TOTALS_SQL, parentId);
  const out = creditedSoFarOf(original, rows, {
    total: t?.total ?? 0,
    totalInr: t?.totalInr ?? 0,
    count: t?.count ?? 0,
  });
  if (!out) throw new Error("the stored credits do not read back");
  return out;
}

export { creditedSumOf };

export type Draft = {
  id: string;
  type: "credit_note" | "debit_note";
  computed: ComputedDocument;
  updatedAt: number;
  contentSha256: string;
  headerExtras: string;
};

const NOTE_OF = (
  kind: "credit" | "debit",
  p: Parent,
  mode: string,
  takes: { line: number; taxableMinor: number }[],
) => ({
  kind,
  parent: {
    id: p.id,
    type: p.computed.currency === "USD" ? "export_invoice" : "tax_invoice",
    fy: p.fy,
    number: "P/1",
    issueDate: "2026-10-25",
    supplyType: p.computed.supply.type,
    recipientStatus: p.computed.currency === "USD" ? "overseas" : "registered",
    placeOfSupplyCode: p.computed.supply.placeOfSupplyCode,
    totalMinor: p.computed.totalMinor,
    totalInrMinor: p.computed.inr?.totalMinor ?? null,
  },
  reason: { code: "price_correction", text: "" },
  request: { mode, takes },
});

/** Inserts a note draft through `noteDraftStatements` (the guard of its SQL included). Throws when the guard or a unique key refuses. */
export async function insertNoteDraft(
  p: Parent,
  kind: "credit" | "debit",
  computed: ComputedDocument,
  over: {
    expectedParentUpdatedAt?: number;
    expectedParentCredited?: number;
    today?: string;
    deadline?: { lastDay: string; filedOn: string | null } | null;
    mode?: string;
  } = {},
): Promise<Draft> {
  const id = uuidv7();
  const takes = computed.lines.map((l) => ({ line: l.index, taxableMinor: l.taxableMinor }));
  const headerExtras = JSON.stringify({ noteOf: NOTE_OF(kind, p, over.mode ?? "lines", takes) });
  const credited =
    (await first<{ c: number }>("SELECT credited_minor AS c FROM documents WHERE id = ?", p.id))?.c ?? 0;
  const parentUpdated =
    (await first<{ u: number }>("SELECT updated_at AS u FROM documents WHERE id = ?", p.id))?.u ?? 0;
  const contentSha256 = "d".repeat(63) + String(seq++ % 10);
  const type = kind === "credit" ? "credit_note" : "debit_note";
  const stmts = noteDraftStatements(env.DB, {
    columns: {
      id,
      type,
      status: "draft",
      client_id: p.clientId,
      parent_id: p.id,
      currency: p.computed.currency,
      export_mode: p.computed.currency === "USD" ? "lut" : null,
      fx_rate_micros: p.computed.fxRateMicros,
      fx_date: p.computed.fxRateMicros ? "2026-10-24" : null,
      fx_source: p.computed.fxRateMicros ? "FBIL" : null,
      content_sha256: contentSha256,
      header_extras: headerExtras,
      created_at: 8_000,
      updated_at: 8_000,
      ...colsOfComputed(computed),
    },
    kind,
    parentId: p.id,
    clientId: p.clientId,
    expectedParentUpdatedAt: over.expectedParentUpdatedAt ?? parentUpdated,
    expectedParentCredited: over.expectedParentCredited ?? credited,
    today: over.today ?? "2026-11-05",
    deadline: over.deadline === undefined ? { lastDay: "2027-11-30", filedOn: null } : over.deadline,
  });
  const res = await env.DB.batch(stmts);
  if (res[0]?.meta.changes !== 1) throw new Error("note draft guard refused");
  return { id, type, computed, updatedAt: 8_000, contentSha256, headerExtras };
}

export const sampleCredit = (
  p: Parent,
  taxable: [number, number][],
  credited?: CreditedSoFar,
): ComputedDocument => {
  const so: CreditedSoFar = credited ?? {
    lines: p.computed.lines.map(() => ({ taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 })),
    creditedTotalMinor: 0,
  };
  const r = creditNote(
    p.computed,
    so,
    { kind: "lines", lines: taxable.map(([line, taxableMinor]) => ({ line, taxableMinor })) },
    CTX,
  );
  if (!r.ok) throw new Error(`credit does not compute: ${JSON.stringify(r.errors)}`);
  return r.value;
};

/** The arguments of the issue batch of a note draft. */
export async function noteIssueArgs(
  p: Parent,
  d: Draft,
  kind: "credit" | "debit",
  over: Omit<Partial<InvoiceIssueArgs>, "note" | "imsStatus"> & {
    imsStatus?: string | null;
    note?: Partial<NonNullable<InvoiceIssueArgs["note"]>>;
  } = {},
): Promise<InvoiceIssueArgs> {
  const v = await versions();
  const client = await first<{ updated_at: number }>(
    "SELECT updated_at FROM clients WHERE id = ?",
    p.clientId,
  );
  const parentRow = await first<{ updated_at: number; credited_minor: number }>(
    "SELECT updated_at, credited_minor FROM documents WHERE id = ?",
    p.id,
  );
  const { note: noteOver, ...rest } = over;
  return {
    documentId: d.id,
    type: d.type,
    series: kind === "credit" ? "creditNote" : "debitNote",
    fy: p.fy,
    pattern: (kind === "credit" ? PATTERNS.creditNote : PATTERNS.debitNote).pattern,
    argOrder: (kind === "credit" ? PATTERNS.creditNote : PATTERNS.debitNote).argOrder,
    maxNumber: 9999,
    now: Date.now(),
    issueDate: "2026-11-05",
    dueDate: kind === "credit" ? null : "2026-11-12",
    recipient: { legalName: "L", country: p.computed.currency === "USD" ? "US" : "IN" },
    issuer: issuerOf(p.ownerId),
    computedJson: JSON.stringify(d.computed),
    snapshotSha256: "s".repeat(64),
    issuedBy: p.ownerId,
    termsVersionId: null,
    headerExtras: d.headerExtras,
    imsStatus: kind === "credit" ? "pending" : null,
    note: {
      kind,
      parentId: p.id,
      expectedParentUpdatedAt: parentRow?.updated_at ?? 0,
      expectedParentCredited: parentRow?.credited_minor ?? 0,
      deadline: kind === "credit" ? { lastDay: "2027-11-30", filedOn: null } : null,
      ...noteOver,
    },
    expected: {
      updatedAt: d.updatedAt,
      contentSha256: d.contentSha256,
      ...v,
      clientUpdatedAt: client?.updated_at ?? 5_000,
      contact: null,
    },
    authority: { kind: "owner", sessionId: p.sessionId },
    bell: {
      clientName: "D",
      linkPrefix: "/invoices/",
      subject: kind === "credit" ? "credit note" : "debit note",
    },
    ...rest,
  } as InvoiceIssueArgs;
}

/** Issues the draft through the real statements (no audit row: these tests are about the batch itself). */
export async function issueNote(
  p: Parent,
  d: Draft,
  kind: "credit" | "debit",
  over: Parameters<typeof noteIssueArgs>[3] = {},
) {
  const a = await noteIssueArgs(p, d, kind, over);
  const s = invoiceIssueStatements(env.DB, a);
  return env.DB.batch([...s.main, ...s.postAudit]);
}

export const parentState = (id: string) =>
  first<{
    status: string;
    credited_minor: number;
    balance_minor: number;
    paid_minor: number;
    updated_at: number;
    total_minor: number;
  }>(
    "SELECT status, credited_minor, balance_minor, paid_minor, updated_at, total_minor FROM documents WHERE id = ?",
    id,
  );
