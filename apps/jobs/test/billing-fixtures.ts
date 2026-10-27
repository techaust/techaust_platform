// Fixtures of the M5.4 stage B tests in the jobs Worker: the database through `cloudflare:workers`, recording fakes for the queues and the admin API's entrypoint, owners
// and staff, a client with contacts, an issued invoice-family document with its stored PDF, its sends and its reminders. Everything is inserted the way the code under
// test finds it (the admin API's own tests cover how it is written).
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { afterEach, beforeEach, vi } from "vitest";

export const DAY = 86_400_000;
export const PORTAL = "https://portal.example/";
export const ADMIN = "https://admin.example/";

export const db = realEnv.DB;
export const run = (sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .run();
export const one = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .first<T>();
export const all = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;

/** What a fake queue binding records: every body, with the options of the call. */
export type Sent = { body: unknown; delaySeconds?: number | undefined; via: "send" | "sendBatch" };

export type Fakes = {
  email: Sent[];
  leads: Sent[];
  pdf: Sent[];
  /** `sendBatch` calls on the email queue (a size per call), to prove chunking. */
  emailBatches: number[];
  /** The admin API's entrypoint calls, in order. */
  rpc: { method: string; arg: unknown }[];
};

const recorder = (into: Sent[], batches?: number[]) => ({
  send: async (body: unknown, opts?: { delaySeconds?: number }) => {
    into.push({ body, delaySeconds: opts?.delaySeconds, via: "send" });
  },
  sendBatch: async (items: { body: unknown; delaySeconds?: number }[]) => {
    batches?.push(items.length);
    for (const i of items) into.push({ body: i.body, delaySeconds: i.delaySeconds, via: "sendBatch" });
  },
});

export let fakes: Fakes;

export type EnvOver = Record<string, unknown>;

/** The jobs Env with the real D1, recording queues and (when `rpc` is given) a stand-in for the admin API's `BillingJobs`. */
export const makeEnv = (
  over: EnvOver = {},
  rpc?: {
    draftCarePlan?: (a: { planId: string }) => unknown;
    issueCareDraft?: (a: { documentId: string }) => unknown;
  },
) =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    ADMIN_URL: ADMIN,
    PORTAL_URL: PORTAL,
    EMAIL_ALLOWED_RECIPIENTS: "",
    EMAIL_TRANSPORT: "log",
    EMAIL_ASSET_BASE: "https://assets.example.test/brand/",
    LEAD_ALERT_TO: "alerts@example.test",
    EMAIL_QUEUE: recorder(fakes.email, fakes.emailBatches),
    LEADS_QUEUE: recorder(fakes.leads),
    PDF_QUEUE: recorder(fakes.pdf),
    ...(rpc
      ? {
          ADMIN_JOBS: {
            draftCarePlan: async (arg: { planId: string }) => {
              fakes.rpc.push({ method: "draftCarePlan", arg });
              return rpc.draftCarePlan?.(arg);
            },
            issueCareDraft: async (arg: { documentId: string }) => {
              fakes.rpc.push({ method: "issueCareDraft", arg });
              return rpc.issueCareDraft?.(arg);
            },
          },
        }
      : {}),
    ...over,
  }) as unknown as Env;

export let logs: string[];
const spies: ReturnType<typeof vi.spyOn>[] = [];

/** Call once at the top of a test file: fresh fakes and a captured console for every test. */
export function useFakes() {
  beforeEach(() => {
    fakes = { email: [], leads: [], pdf: [], emailBatches: [], rpc: [] };
    logs = [];
    for (const m of ["log", "error", "warn", "info"] as const)
      spies.push(
        vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
      );
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });
}

let seq = 0;
export const next = () => ++seq;

export async function staff(
  role: "owner" | "staff",
  over: { status?: string; name?: string; email?: string } = {},
) {
  const id = uuidv7();
  const n = next();
  const email = over.email ?? `${role}${n}@example.test`;
  const name = over.name ?? `${role} ${n}`;
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, ?3, ?4, ?5)",
    id,
    email,
    name,
    role,
    over.status ?? "active",
  );
  return { id, email, name };
}

export async function mkClient(
  o: { policy?: string | null; currency?: "INR" | "USD"; anonymised?: boolean; displayName?: string } = {},
) {
  const id = uuidv7();
  const n = next();
  await run(
    `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, reminder_policy, anonymised_at)
     VALUES (?1, ?2, 'Sample Traders Pvt Ltd', ?3, 'business', ?4, ?5, ?6, ?7, ?8, ?9)`,
    id,
    `J${n}`,
    o.displayName ?? "Sample Traders",
    o.currency === "USD" ? "US" : "IN",
    o.currency === "USD" ? "overseas" : "unregistered",
    o.currency === "USD" ? null : "19",
    o.currency === "USD" ? "USD" : "INR",
    o.policy ?? null,
    o.anonymised ? 5 : null,
  );
  return id;
}

export async function mkContact(
  clientId: string,
  o: { portal?: boolean; email?: string; name?: string; anonymised?: boolean; finance?: boolean } = {},
) {
  const id = uuidv7();
  const n = next();
  const email = o.email ?? `asha${n}@example.test`;
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, anonymised_at, can_see_finance) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    clientId,
    o.name ?? "Asha Rao",
    email,
    o.portal === false ? 0 : 1,
    o.anonymised ? 5 : null,
    o.finance === false ? 0 : 1,
  );
  return { id, email, name: o.name ?? "Asha Rao" };
}

export type DocOver = {
  type?: "tax_invoice" | "export_invoice" | "proforma" | "credit_note" | "debit_note" | "proposal";
  status?: string;
  currency?: "INR" | "USD";
  /** When false the PDF is not stored yet. */
  rendered?: boolean;
  balance?: number;
  total?: number;
  dueDate?: string;
  issueDate?: string;
  voided?: boolean;
  parentId?: string;
  pdfKey?: string;
  /** The sealed `header_extras` JSON text (a note carries `{noteOf:{reason}}`). */
  headerExtras?: string;
};

/** An issued (frozen) document of the invoice family, with its stored PDF unless `rendered: false`. */
export async function mkDoc(
  clientId: string,
  billing: { name: string; email: string } | null,
  o: DocOver = {},
): Promise<{ id: string; number: number; numberDisplay: string; key: string; billing: typeof billing }> {
  // A credit or debit note names its invoice (a trigger): one is made when the caller gave none.
  if ((o.type === "credit_note" || o.type === "debit_note") && !o.parentId)
    return mkDoc(clientId, billing, {
      ...o,
      parentId: (await mkDoc(clientId, billing, { type: "tax_invoice" })).id,
    });
  const id = uuidv7();
  const n = next();
  const type = o.type ?? "tax_invoice";
  const status = o.status ?? "issued";
  const series = type === "tax_invoice" ? "invoice" : type === "export_invoice" ? "export" : type;
  const prefix = {
    tax_invoice: "INV",
    export_invoice: "EXP",
    proforma: "PI",
    credit_note: "CN",
    debit_note: "DN",
    proposal: "PRP",
  }[type];
  const number = 8000 + n;
  const rendered = o.rendered ?? true;
  const issuer = JSON.stringify({
    company: {
      tradeName: "TecHaust",
      legalName: null,
      address: null,
      gstin: null,
      stateCode: "19",
      logo: "x",
    },
    sender: { staffId: "system", name: "TecHaust", email: "billing@example.test" },
  });
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor,
       content_sha256, pdf_r2_key, pdf_sha256, snapshot_sha256, issuer, parent_id, voided_at, void_reason, header_extras, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?1, 1, ?6, '2627', ?7, ?8, 1000, ?9, ?10, 100000, 100000, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 7000)`,
    id,
    type,
    status,
    clientId,
    o.currency ?? "INR",
    series,
    number,
    `TH/${prefix}/2627/${number}`,
    o.issueDate ?? "2026-10-26",
    o.dueDate ?? "2026-11-02",
    o.total ?? 118_000,
    o.balance ?? 118_000,
    "h".repeat(64),
    rendered ? (o.pdfKey ?? `docs/${type}/2026-27/${number}-v1.pdf`) : null,
    rendered ? "pdfsha" : null,
    rendered ? "snapsha" : null,
    issuer,
    o.parentId ?? null,
    status === "void" || o.voided ? 5 : null,
    status === "void" || o.voided ? "x" : null,
    o.headerExtras ?? null,
  );
  return {
    id,
    number,
    numberDisplay: `TH/${prefix}/2627/${number}`,
    key: `docs/${type}/2026-27/${number}-v1.pdf`,
    billing,
  };
}
export type Doc = Awaited<ReturnType<typeof mkDoc>>;

export async function mkSend(
  doc: { id: string },
  clientId: string,
  contact: { id: string; email: string } | null,
  o: {
    createdBy: string;
    kind?: "send" | "resend" | "auto";
    attach?: boolean;
    queued?: boolean;
    cancelled?: boolean;
    createdAt?: number;
  },
) {
  const id = uuidv7();
  await run(
    "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, cancelled_at, created_by, created_at) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    id,
    doc.id,
    clientId,
    contact?.id ?? null,
    contact?.email.toLowerCase() ?? null,
    o.attach ? 1 : 0,
    o.kind ?? "send",
    o.queued ? 1 : null,
    o.cancelled ? 2 : null,
    o.createdBy,
    o.createdAt ?? 1_000,
  );
  return id;
}

export async function mkReminder(
  doc: { id: string },
  offset: number,
  dueAt: number,
  o: { sentAt?: number | null; skipped?: string | null; emailLogId?: string | null } = {},
) {
  const id = uuidv7();
  await run(
    "INSERT INTO reminders (id, document_id, offset_days, due_at, sent_at, skipped_reason, email_log_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    doc.id,
    offset,
    dueAt,
    o.sentAt ?? null,
    o.skipped ?? null,
    o.emailLogId ?? null,
  );
  return id;
}

/** The email bodies queued so far, as messages (the invoice family also queues expansion bodies; filter by `kind` or `template`). */
export const emailsQueued = () => fakes.email.map((s) => s.body as EmailMessage & { kind?: string });
