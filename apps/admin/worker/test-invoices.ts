// Fixtures of the invoice tests (M5.1): the company the invoices are issued by, clients in India and overseas, drafts made through the API as the SPA
// would, and short helpers for issuing, voiding and reading the state afterwards. Rows are written straight to the test database where the API
// has no route (the company setting, bank accounts, a milestone).
import { env } from "cloudflare:workers";
import { gstinCheckChar } from "@techaust/core";
import { uuidv7 } from "@techaust/core/ids";
import { issueFyOf } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { insert, mkClient, mkContact } from "./test-clients.ts";
import { call, one, sessionFor, type TestSession } from "./test-helpers.ts";
import { mkMilestone, mkProject } from "./test-projects.ts";
import { mkService } from "./test-quotes.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
export type J = Record<string, any>;
export const json = async (res: Response): Promise<J> => (await res.json()) as J;
export const codeOf = async (res: Response): Promise<string> => ((await res.json()) as J).error?.code;

const FIRST14 = "19ABCDE1234F1Z";
export const COMPANY_GSTIN = `${FIRST14}${gstinCheckChar(FIRST14)}`;

/** The company the invoices are issued by: everything the minimal Rule 46 list asks of the supplier. A row with a new version each time. */
export async function putCompany(over: Record<string, unknown> = {}) {
  const value = {
    ...SETTINGS_DEFAULTS.company,
    legalName: "Rupak Sarkar trading as TecHaust Technologies",
    gstin: COMPANY_GSTIN,
    address: "1 Example Road, Balurghat, West Bengal 733101",
    documentsPhone: "+91 90000 00000",
    principalPlace: "1 Example Road, Balurghat",
    ...over,
  };
  await env.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('company', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(JSON.stringify(value))
    .run();
}

export async function bumpSetting(key: string) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES (?1, '{}', 1) ON CONFLICT(key) DO UPDATE SET version = version + 1",
  )
    .bind(key)
    .run();
}

/** An active INR bank account (the issue batch guards on the newest `updated_at` of the active rows). */
export async function putBank(updatedAt = Date.now() - 5_000) {
  await env.DB.prepare("UPDATE bank_accounts SET active = 0 WHERE kind = 'INR'").run();
  await insert("bank_accounts", {
    id: uuidv7(),
    kind: "INR",
    account_name: "TecHaust Technologies",
    account_no: "SAMPLEBANK0001",
    ifsc: "SAMP0000001",
    bank_name: "SAMPLE BANK",
    branch: "Sample branch",
    active: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
  });
}

/** An INR business client in West Bengal with a billing address and a primary contact (intra-state tax with the default company state 19). */
export async function mkInvoiceClient(over: Record<string, unknown> = {}) {
  const clientId = await mkClient({
    gst_status: "unregistered",
    state_code: "19",
    legal_name: "Asha Traders Private Limited",
    billing_address: JSON.stringify({
      line1: "5 Market Street",
      city: "Kolkata",
      state: "West Bengal",
      stateCode: "19",
      postalCode: "700001",
      country: "IN",
    }),
    ...over,
  });
  const contact = await mkContact(clientId, { is_primary: 1, name: "Asha Rao" });
  return { clientId, contactId: contact.id, email: contact.email };
}

/** A client in another state (inter-state tax) and a registered one, for the supply and GSTIN cases. */
export const mkInterClient = () => mkInvoiceClient({ state_code: "27" });

/** A US client (export, USD). */
export const mkOverseasClient = () =>
  mkInvoiceClient({
    country: "US",
    gst_status: "overseas",
    state_code: null,
    currency: "USD",
    billing_address: JSON.stringify({ line1: "1 Main St", city: "Austin", country: "US" }),
  });

export type MadeInvoice = {
  id: string;
  updatedAt: number;
  contentSha256: string;
  clientId: string;
  contactId: string;
};

/** A draft tax invoice made through POST /invoices from one service (priced `price` paise, 18 % GST, SAC 998314). */
export async function mkInvoice(
  s: TestSession,
  opts: {
    price?: number;
    clientId?: string;
    contactId?: string;
    client?: () => Promise<{ clientId: string; contactId: string }>;
  } = {},
): Promise<MadeInvoice> {
  const client = opts.clientId
    ? { clientId: opts.clientId, contactId: opts.contactId ?? "" }
    : await (opts.client ?? mkInvoiceClient)();
  const item = await mkService(opts.price ?? 100_000);
  const res = await call("/invoices", {
    cookie: s.cookie,
    body: { clientId: client.clientId, services: [{ catalogueItemId: item.id }] },
  });
  if (res.status !== 201) throw new Error(`could not make an invoice: ${res.status} ${await res.text()}`);
  const b = await json(res);
  return {
    id: b.id,
    updatedAt: b.updatedAt,
    contentSha256: b.contentSha256,
    clientId: client.clientId,
    contactId: client.contactId,
  };
}

export const getInvoice = async (s: TestSession, id: string) =>
  json(await call(`/invoices/${id}`, { cookie: s.cookie }));

export const patchInvoice = (s: TestSession, id: string, body: unknown) =>
  call(`/invoices/${id}`, { method: "PATCH", cookie: s.cookie, body });

/** The issue request body for what is stored now. */
export async function issueBodyOf(id: string) {
  const row = await one<{ updated_at: number; content_sha256: string }>(
    "SELECT updated_at, content_sha256 FROM documents WHERE id = ?",
    id,
  );
  return { expectedUpdatedAt: row?.updated_at, expectedContentSha256: row?.content_sha256 };
}

export const issueInvoice = async (s: TestSession, id: string, body?: unknown) =>
  call(`/invoices/${id}/issue`, { cookie: s.cookie, body: body ?? (await issueBodyOf(id)) });

export const requestIssue = async (s: TestSession, id: string, reason?: string) => {
  const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", id);
  return call(`/invoices/${id}/issue-request`, {
    cookie: s.cookie,
    body: { expectedUpdatedAt: row?.updated_at, ...(reason ? { reason } : {}) },
  });
};

export const decideApproval = (s: TestSession, id: string, decision: "approve" | "reject", note?: string) =>
  call(`/approvals/${id}/decide`, { cookie: s.cookie, body: { decision, ...(note ? { note } : {}) } });

export const voidInvoice = async (s: TestSession, id: string, reason = "Issued in error") => {
  const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", id);
  return call(`/invoices/${id}/void`, {
    cookie: s.cookie,
    body: { expectedUpdatedAt: row?.updated_at, reason },
  });
};

export const invoiceRow = (id: string) =>
  one<Record<string, unknown>>(
    "SELECT status, type, series, fy, number, number_display, issue_date, due_date, frozen_at, issued_by, balance_minor, total_minor, voided_at, void_reason, updated_at, content_sha256, terms_version_id FROM documents WHERE id = ?",
    id,
  );

const REAL_FY = issueFyOf(Date.now()); // taken at load, before any test moves the clock

/** The invoice counter's next number for the FY (the real one by default; null: no row yet). */
export const invoiceCounter = async (fy: string = REAL_FY) =>
  (await one<{ next_no: number }>("SELECT next_no FROM doc_counters WHERE series = 'invoice' AND fy = ?", fy))
    ?.next_no ?? null;

/** A milestone that is ready to bill, with its project (the client's), amount tax included. */
export async function mkReadyMilestone(
  clientId: string,
  amount = 11_800_00,
  over: Record<string, unknown> = {},
) {
  const project = await mkProject(clientId, { budget_minor: 1_000_000_00 });
  const m = await mkMilestone(project.id, {
    amount_minor: amount,
    status: "ready_to_bill",
    title: "Design",
    ...over,
  });
  return { ...m, projectId: project.id };
}

/** A member whose session and step-up survive a faked clock (the FY rollover tests move `Date`). */
export async function farSession(
  role: "owner" | "staff" | "accountant" | "sales" = "owner",
): Promise<TestSession> {
  const far = 4_000_000_000_000;
  const s = await sessionFor(role, { stepUp: far });
  await env.DB.prepare("UPDATE staff_sessions SET idle_expires_at = ?2, abs_expires_at = ?2 WHERE id = ?1")
    .bind(s.sessionId, far)
    .run();
  return s;
}

/** Audit rows of one action (and, optionally, one entity). */
export const auditCount = async (action: string, entityId?: string) =>
  (
    (await one<{ n: number }>(
      `SELECT count(*) AS n FROM audit_log WHERE action = ?1${entityId ? " AND entity_id = ?2" : ""}`,
      action,
      ...(entityId ? [entityId] : []),
    )) as { n: number }
  ).n;
