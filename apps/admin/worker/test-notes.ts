// Fixtures of the M5.3 note tests: issued invoices of several lines (through the API, as the SPA would), registered clients (IMS), and short helpers to draft, issue and read
// credit and debit notes. Rows are written straight to the test database only where the API has no route.
import { env } from "cloudflare:workers";
import { gstinCheckChar } from "@techaust/core";
import { type CreditedSoFar, creditNote } from "@techaust/core/tax";
import { call, one, type TestSession } from "./test-helpers.ts";
import { issueInvoice, type J, json, mkInvoiceClient, mkOverseasClient } from "./test-invoices.ts";
import { mkService } from "./test-quotes.ts";

let n = 0;
/** A GSTIN of West Bengal with a valid check character, unique per call. */
export const regGstin = () => {
  const first14 = `19AAAAA${String(++n).padStart(4, "0")}A1Z`;
  return first14 + gstinCheckChar(first14);
};

/** A GST-registered client in the company's state (intra-state): its credit notes start with the IMS status `pending`. */
export const mkRegisteredClient = () => mkInvoiceClient({ gst_status: "registered", gstin: regGstin() });

export type Issued = {
  id: string;
  clientId: string;
  contactId: string;
  number: string;
  total: number;
  /** The `computed` document as frozen. */
  computed: J;
};

/**
 * An issued invoice of one line per price (paise, taxable, each priced by its own catalogue service at 18 %). The client is an INR business client in the company's state
 * unless `client` says otherwise (`mkOverseasClient` makes an export invoice: set the rate with `setFx` before; here a USD rate is typed in).
 */
export async function mkIssuedInvoice(
  o: TestSession,
  opts: { prices?: number[]; client?: () => Promise<{ clientId: string; contactId: string }> } = {},
): Promise<Issued> {
  const client = await (opts.client ?? mkInvoiceClient)();
  const items = [];
  for (const price of opts.prices ?? [100_000]) items.push(await mkService(price));
  const res = await call("/invoices", {
    cookie: o.cookie,
    body: { clientId: client.clientId, services: items.map((i) => ({ catalogueItemId: i.id })) },
  });
  if (res.status !== 201) throw new Error(`could not make an invoice: ${res.status} ${await res.text()}`);
  const made = await json(res);
  if (opts.client === mkOverseasClient) {
    const doc = await json(await call(`/invoices/${made.id}`, { cookie: o.cookie }));
    const fx = await call(`/invoices/${made.id}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: {
        expectedUpdatedAt: doc.updatedAt,
        fields: { fx: { rate: "83.1234", date: new Date().toISOString().slice(0, 10), source: "FBIL" } },
      },
    });
    if (fx.status !== 200) throw new Error(`could not set the rate: ${fx.status} ${await fx.text()}`);
  }
  const issued = await issueInvoice(o, made.id);
  if (issued.status !== 200)
    throw new Error(`could not issue the invoice: ${issued.status} ${await issued.text()}`);
  const row = await one<{ number_display: string; total_minor: number; computed: string }>(
    "SELECT number_display, total_minor, computed FROM documents WHERE id = ?",
    made.id,
  );
  return {
    id: made.id,
    clientId: client.clientId,
    contactId: client.contactId,
    number: row?.number_display ?? "",
    total: row?.total_minor ?? 0,
    computed: JSON.parse(row?.computed ?? "{}"),
  };
}

export const stampOf = async (id: string) =>
  (await one<{ updated_at: number; credited_minor: number }>(
    "SELECT updated_at, credited_minor FROM documents WHERE id = ?",
    id,
  )) ?? { updated_at: 0, credited_minor: 0 };

/** POST /invoices/:id/credit-note with the invoice's current stamp (override anything in `body`). */
export const draftCredit = async (s: TestSession, parentId: string, body: Record<string, unknown>) =>
  call(`/invoices/${parentId}/credit-note`, {
    cookie: s.cookie,
    body: {
      expectedParentUpdatedAt: (await stampOf(parentId)).updated_at,
      reasonCode: "price_correction",
      ...body,
    },
  });

export const draftDebit = async (s: TestSession, parentId: string, body: Record<string, unknown>) =>
  call(`/invoices/${parentId}/debit-note`, {
    cookie: s.cookie,
    body: {
      expectedParentUpdatedAt: (await stampOf(parentId)).updated_at,
      reasonCode: "price_correction",
      ...body,
    },
  });

/** A credit note draft made and issued by the Owner; returns its id and the issue answer. */
export async function issueCredit(
  o: TestSession,
  parentId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; issued: J }> {
  const res = await draftCredit(o, parentId, body);
  if (res.status !== 201) throw new Error(`could not draft a credit note: ${res.status} ${await res.text()}`);
  const { id } = await json(res);
  const issued = await issueInvoice(o, id);
  if (issued.status !== 200)
    throw new Error(`could not issue the credit note: ${issued.status} ${await issued.text()}`);
  return { id, issued: await json(issued) };
}

export async function issueDebit(
  o: TestSession,
  parentId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; issued: J }> {
  const res = await draftDebit(o, parentId, body);
  if (res.status !== 201) throw new Error(`could not draft a debit note: ${res.status} ${await res.text()}`);
  const { id } = await json(res);
  const issued = await issueInvoice(o, id);
  if (issued.status !== 200)
    throw new Error(`could not issue the debit note: ${issued.status} ${await issued.text()}`);
  return { id, issued: await json(issued) };
}

export const noteRow = (id: string) =>
  one<Record<string, unknown>>(
    "SELECT type, status, parent_id, series, fy, number_display, issue_date, due_date, balance_minor, total_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, total_inr_minor, credited_minor, ims_status, frozen_at, header_extras, content_sha256, updated_at, contact_id, export_mode, fx_rate_micros, supply_type, place_of_supply_code, recipient, issuer, terms_version_id FROM documents WHERE id = ?",
    id,
  );

export const parentRow = (id: string) =>
  one<{
    status: string;
    credited_minor: number;
    balance_minor: number;
    paid_minor: number;
    total_minor: number;
    updated_at: number;
  }>(
    "SELECT status, credited_minor, balance_minor, paid_minor, total_minor, updated_at FROM documents WHERE id = ?",
    id,
  );

export const creditNoteCounter = async (fy: string) =>
  (
    await one<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'creditNote' AND fy = ?",
      fy,
    )
  )?.next_no ?? null;

export const docCount = async () => (await one<{ c: number }>("SELECT count(*) AS c FROM documents"))?.c ?? 0;

/** What the engine gives for a credit of `taxable` on one line of `computed` (the figures a test expects of the route). */
export function expectedCredit(
  computed: J,
  taxable: [number, number][],
  ctx: Parameters<typeof creditNote>[3],
  so?: CreditedSoFar,
) {
  const lines = (computed.lines as J[]).map(() => ({
    taxableMinor: 0,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
  }));
  const r = creditNote(
    computed as never,
    so ?? { lines, creditedTotalMinor: 0 },
    { kind: "lines", lines: taxable.map(([line, taxableMinor]) => ({ line, taxableMinor })) },
    ctx,
  );
  if (!r.ok) throw new Error(`does not compute: ${JSON.stringify(r.errors)}`);
  return r.value;
}

export { env };
