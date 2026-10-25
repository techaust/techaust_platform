// Clients and contacts API (M3.3, ADM-CLI-01..05). Every route is a row of ROUTES (guard.ts); every change is ONE batch through
// `mutate`; the finance boundary, the currency lock and the erase rules are enforced in SQL, not in a read before a write.
//
// Personal data and the audit log (VERIFY WITH CA/LEGAL): `audit_log` is append-only and outlives the people in it, so a client's
// or contact's audit row holds ids, codes, field NAMES, modes and reason codes, never a name, an email, a phone number or an
// address. Client and contact audit rows are all written on entity `client` (the contact's id is in the summary), so a client's
// activity still shows them after a contact was erased.
//
// Finance boundary: `CLIENT_FINANCE_READ_FIELDS` (core) is hidden from a role without `clients.finance.read` (Sales): `clientView` drops
// them. Every `CLIENT_BILLING_FIELDS` field is changed after creation only by `PATCH /clients/:id/billing` (`clients.finance.write`), and
// `PATCH /clients/:id` refuses them with a 400. The tax identity (GST status, GSTIN, state, billing address, currency) is readable.
import { emailAddress } from "@techaust/auth";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import {
  ANONYMISED_CLIENT,
  ANONYMISED_CONTACT,
  anonymisedEmail,
  CLIENT_TYPE_LOCKED_MESSAGE,
  type ClientBillingField,
  clientTaxCheck,
  ERASE_REASONS,
  INVOICE_FAMILY_SQL,
  type TaxCheck,
  type TaxInput,
} from "@techaust/core/clients";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { normaliseEmail } from "@techaust/core/lead-lifecycle";
import { decide, type Role } from "@techaust/core/permissions";
import {
  CONTACT_ON_ISSUED_DOCUMENT_SQL,
  deleteContactAccess,
  revokeContactAccess,
} from "@techaust/db/contact-access";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { refuseAnonymised } from "./anonymised.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
} from "./context.ts";
import { dropObjects } from "./files.ts";
import {
  body,
  idParam,
  isUnique,
  limitOf,
  optText,
  param,
  query,
  refusedWith,
  STALE_VERSION,
  text,
} from "./http.ts";
import { type Direction, decodeCursor, encodeCursor, keysetSql, PREFIX_END, pageOf } from "./keyset.ts";

// ---- errors ----------------------------------------------------------------------------------------------------------

const CURRENCY_LOCKED: ApiError = {
  code: "currency_locked",
  message: "The currency can't change once this client has an invoice.",
};
const TYPE_LOCKED: ApiError = { code: "type_locked", message: CLIENT_TYPE_LOCKED_MESSAGE };
const GSTIN_IN_USE: ApiError = { code: "gstin_in_use", message: "A client with that GSTIN already exists" };
const EMAIL_IN_USE: ApiError = {
  code: "email_in_use",
  message: "This client already has a contact with that email address",
};
const ANONYMISED: ApiError = {
  code: "contact_anonymised",
  message: "This contact was anonymised and can't be changed",
};
const LEGAL_HOLD: ApiError = {
  code: "legal_hold",
  message: "A legal hold stops this. Release the hold first",
};
const ON_ISSUED_DOCUMENT: ApiError = {
  code: "on_issued_document",
  message: "This person is on an issued document, so they can't be erased. Anonymise them instead",
};
const NOT_AVAILABLE: ApiError = { code: "conflict", message: "Nothing was changed. Reload and try again" };

// ---- rows and views ---------------------------------------------------------------------------------------------------

export const CLIENT_COLS =
  "id, code, legal_name, display_name, type, country, gst_status, gstin, state_code, billing_address, service_address, currency, payment_terms_days, reminder_policy, care_auto_issue, attach_pdf, tags, notes, legal_hold, anonymised_at, created_at, updated_at";
const CONTACT_COLS =
  "id, client_id, name, email, phone, title, is_primary, is_billing, portal_access, can_see_finance, marketing_consent, bounced_at, anonymised_at, legal_hold, created_at, updated_at";

export type ClientRow = {
  id: string;
  code: string;
  legal_name: string;
  display_name: string;
  type: string;
  country: string;
  gst_status: "registered" | "unregistered" | "overseas";
  gstin: string | null;
  state_code: string | null;
  billing_address: string | null;
  service_address: string | null;
  currency: string;
  payment_terms_days: number | null;
  reminder_policy: string | null;
  care_auto_issue: number;
  attach_pdf: number;
  tags: string | null;
  notes: string | null;
  legal_hold: number;
  anonymised_at: number | null;
  created_at: number;
  updated_at: number;
};
type ContactRow = {
  id: string;
  client_id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  is_primary: number;
  is_billing: number;
  portal_access: number;
  can_see_finance: number;
  marketing_consent: string | null;
  bounced_at: number | null;
  anonymised_at: number | null;
  legal_hold: number;
  created_at: number;
  updated_at: number;
};

const json = (s: string | null) => (s ? JSON.parse(s) : null);
const canFinance = (role: Role) => decide(role, "clients.finance.read") !== "deny";

/**
 * The ONE mapper from a client row to a response. The finance fields are added only for a role with `clients.finance.read`;
 * a test proves that none of `CLIENT_FINANCE_READ_FIELDS` is in what Sales gets, and that the lists, this mapper, the billing
 * schema and the table's columns agree.
 */
export function clientView(r: ClientRow, role: Role) {
  const view = {
    id: r.id,
    code: r.code,
    legalName: r.legal_name,
    displayName: r.display_name,
    type: r.type,
    country: r.country,
    // The tax identity is who the client is for tax: every role that reads clients reads it.
    gstStatus: r.gst_status,
    gstin: r.gstin,
    stateCode: r.state_code,
    billingAddress: json(r.billing_address),
    currency: r.currency,
    serviceAddress: json(r.service_address),
    tags: json(r.tags),
    notes: r.notes,
    legalHold: Boolean(r.legal_hold),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (!canFinance(role)) return view;
  const finance: Record<Exclude<ClientBillingField, keyof typeof view>, unknown> = {
    paymentTermsDays: r.payment_terms_days,
    reminderPolicy: json(r.reminder_policy),
    careAutoIssue: Boolean(r.care_auto_issue),
    attachPdf: Boolean(r.attach_pdf),
  };
  return { ...view, ...finance };
}

export const contactView = (r: ContactRow) => ({
  id: r.id,
  clientId: r.client_id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  title: r.title,
  isPrimary: Boolean(r.is_primary),
  isBilling: Boolean(r.is_billing),
  portalAccess: Boolean(r.portal_access),
  canSeeFinance: Boolean(r.can_see_finance),
  marketingConsent: json(r.marketing_consent),
  bouncedAt: r.bounced_at,
  anonymisedAt: r.anonymised_at,
  legalHold: Boolean(r.legal_hold),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---- shared SQL (also used by the lead conversion) ------------------------------------------------------------------

/** The next free `C####` (4 digits or more, so the scheme goes on past C9999); the sample clients' codes don't match. */
const NEXT_CODE_SQL =
  "(SELECT printf('C%04d', coalesce(max(cast(substr(code, 2) AS integer)), 0) + 1) FROM clients WHERE code GLOB 'C[0-9][0-9][0-9][0-9]*' AND substr(code, 2) NOT GLOB '*[^0-9]*')";

export type NewClient = {
  id: string;
  legalName: string;
  displayName: string;
  type: string;
  country: string;
  gstStatus: string;
  gstin: string | null;
  stateCode: string | null;
  currency: string;
  serviceAddress?: unknown;
  tags?: unknown;
  notes?: string | null;
};

/**
 * The client insert shared by `POST /clients` and the lead conversion: the next free code taken in the same statement, written
 * only `WHERE <cond>` (the caller's guard; its first placeholder is ?13). A code race is caught by the unique index and retried.
 */
export const insertClientStmt = (
  db: D1Database,
  c: NewClient,
  cond: { sql: string; params: readonly unknown[] } = { sql: "1", params: [] },
) =>
  db
    .prepare(
      `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, gstin, state_code, currency, service_address, tags, notes)
       SELECT ?1, ${NEXT_CODE_SQL}, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE ${cond.sql}`,
    )
    .bind(
      c.id,
      c.legalName,
      c.displayName,
      c.type,
      c.country,
      c.gstStatus,
      c.gstin,
      c.stateCode,
      c.currency,
      c.serviceAddress ? JSON.stringify(c.serviceAddress) : null,
      c.tags ? JSON.stringify(c.tags) : null,
      c.notes ?? null,
      ...cond.params,
    );

/** What a failed tax check answers: 400 with the check's own code and words. */
export const taxError = (c: Ctx, t: Extract<TaxCheck, { ok: false }>) =>
  err(c, { code: t.code, message: t.message }, 400);

/** The warnings of a passed tax check, with the approved 07-J sentence. */
export const taxWarnings = (t: Extract<TaxCheck, { ok: true }>) =>
  t.warnings.map((w) => ({
    code: w.code,
    message: `The state you chose differs from the GSTIN's state (${w.gstinState}). Check it before saving.`,
  }));

// ---- audit-first rows -------------------------------------------------------------------------------------------------

type Who = Parameters<NonNullable<Parameters<typeof mutate>[1]["auditFirst"]>>[1];
const AUDIT_INSERT =
  "INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id)";

/**
 * The audit row written FIRST, from the rows as they are now and only if the change may happen (`from` carries the conditions).
 * `?1` id, `?2` actor, `?3` role, `?4` ip, `?5` user agent, `?6` request id; the caller's placeholders start at `?7`. The action,
 * the entity type and the expressions are code, never input.
 */
const auditRow = (
  db: D1Database,
  auditId: string,
  who: Who,
  action: string,
  entityExpr: string,
  summaryExpr: string,
  from: string,
  params: readonly unknown[],
) =>
  db
    .prepare(
      `${AUDIT_INSERT} SELECT ?1, 'staff', ?2, ?3, '${action}', 'client', ${entityExpr}, ${summaryExpr}, ?4, ?5, ?6 ${from}`,
    )
    .bind(auditId, who.actor.id, who.actor.role, who.ip, who.ua, who.requestId, ...params);

// ---- schemas -----------------------------------------------------------------------------------------------------------

const address = z.strictObject({
  line1: text(200),
  line2: z.optional(text(200)),
  city: text(100),
  state: z.optional(text(100)),
  stateCode: z.optional(z.string().check(z.regex(/^\d{2}$/))),
  postalCode: z.optional(text(20)),
  country: z.string().check(z.regex(/^[A-Z]{2}$/)),
});
const reminderPolicy = z.strictObject({
  enabled: z.boolean(),
  offsetsDays: z.optional(z.array(z.int().check(z.gte(-60), z.lte(365))).check(z.maxLength(10))),
});
const tags = z.array(text(40)).check(z.maxLength(20));
const countryCode = z.string().check(z.regex(/^[A-Z]{2}$/));
const stateCodeText = z.string().check(z.regex(/^\d{2}$/));
const gstinText = z.string().check(z.trim(), z.maxLength(20));
const currencyCode = z.enum(["INR", "USD"]);

const contactFields = {
  name: text(100),
  email: emailAddress,
  phone: z.optional(optText(40)),
  title: z.optional(optText(80)),
  isBilling: z.optional(z.boolean()),
  portalAccess: z.optional(z.boolean()),
  canSeeFinance: z.optional(z.boolean()),
  marketingConsent: z.optional(z.boolean()),
};

const createClient = z.strictObject({
  legalName: text(200),
  displayName: z.optional(text(120)),
  type: z.enum(["business", "individual"]),
  country: countryCode,
  gstStatus: z.enum(["registered", "unregistered", "overseas"]),
  gstin: z.optional(gstinText),
  stateCode: z.optional(stateCodeText),
  currency: currencyCode,
  serviceAddress: z.optional(address),
  tags: z.optional(tags),
  notes: z.optional(optText(4000)),
  contact: z.optional(z.strictObject({ ...contactFields, isPrimary: z.optional(z.literal(true)) })),
});

const patchClient = z.strictObject({
  expectedUpdatedAt: z.int(),
  legalName: z.optional(text(200)),
  displayName: z.optional(text(120)),
  type: z.optional(z.enum(["business", "individual"])),
  serviceAddress: z.optional(z.nullable(address)),
  tags: z.optional(z.nullable(tags)),
  notes: z.optional(optText(4000)),
});

export const patchBilling = z.strictObject({
  expectedUpdatedAt: z.int(),
  country: z.optional(countryCode),
  gstStatus: z.optional(z.enum(["registered", "unregistered", "overseas"])),
  gstin: z.optional(z.nullable(gstinText)),
  stateCode: z.optional(z.nullable(stateCodeText)),
  billingAddress: z.optional(z.nullable(address)),
  currency: z.optional(currencyCode),
  paymentTermsDays: z.optional(z.nullable(z.int().check(z.gte(0), z.lte(365)))),
  reminderPolicy: z.optional(z.nullable(reminderPolicy)),
  careAutoIssue: z.optional(z.boolean()),
  attachPdf: z.optional(z.boolean()),
});

const createContact = z.strictObject({ ...contactFields, isPrimary: z.optional(z.literal(true)) });
const patchContact = z.strictObject({
  expectedUpdatedAt: z.int(),
  name: z.optional(text(100)),
  email: z.optional(emailAddress),
  phone: z.optional(optText(40)),
  title: z.optional(optText(80)),
  isPrimary: z.optional(z.literal(true)),
  isBilling: z.optional(z.boolean()),
  portalAccess: z.optional(z.boolean()),
  canSeeFinance: z.optional(z.boolean()),
  marketingConsent: z.optional(z.boolean()),
});

const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  q: z.optional(z.string().check(z.maxLength(100))),
  gstStatus: z.optional(z.enum(["registered", "unregistered", "overseas"])),
  currency: z.optional(currencyCode),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});
const pageQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});
const statementQuery = z.object({
  from: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  to: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
});
const exportRequest = z.strictObject({
  part: z.optional(
    z.enum([
      "leads",
      "lead_activities",
      "sessions",
      "magic_links",
      "acceptances",
      "documents",
      "email_log",
      "audit_log",
      "access_log",
      "notes",
      "files",
    ]),
  ),
  after: z.optional(z.string().check(z.maxLength(400))),
});
const eraseRequest = z.strictObject({
  mode: z.enum(["erase", "anonymise"]),
  reason: z.enum(ERASE_REASONS),
});

const norm = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};
/** `a = ?n` style column names for the finance fields (camel to the table's snake case). */
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

// ---- clients ----------------------------------------------------------------------------------------------------------

/** The prefix match on the code (index `clients_code`) and the name without case (`clients_name_nocase`). */
export const CLIENT_SEARCH_SQL = (at: number) =>
  `c.id IN (SELECT id FROM clients WHERE code >= ?${at} AND code < ?${at + 1} UNION SELECT id FROM clients WHERE display_name COLLATE NOCASE >= ?${at + 2} AND display_name COLLATE NOCASE < ?${at + 3})`;

const listClients = async (c: Ctx, f: z.infer<typeof listQuery>) => {
  const role = actor(c).role;
  const limit = limitOf(f.limit);
  const dir: Direction = f.before ? "before" : "after";
  const raw = f.before ?? f.after;
  const cur = raw === undefined ? null : decodeCursor(raw);
  if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const where: string[] = [];
  const bind: unknown[] = [];
  if (f.gstStatus) where.push(`c.gst_status = ?${bind.push(f.gstStatus)}`);
  if (f.currency) where.push(`c.currency = ?${bind.push(f.currency)}`);
  const q = f.q?.trim();
  if (q && q.length >= 2) {
    const at = bind.length + 1;
    where.push(CLIENT_SEARCH_SQL(at));
    bind.push(q.toUpperCase(), `${q.toUpperCase()}${PREFIX_END}`, q, `${q}${PREFIX_END}`);
  }
  const order = keysetSql("c.created_at", "c.id", false, dir, bind.length + 1);
  if (cur) {
    where.push(order.where);
    bind.push(cur.k, cur.id);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${CLIENT_COLS.replace(/(\w+)/g, "c.$1")} FROM clients c${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
  )
    .bind(...bind)
    .all<ClientRow>();
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ clients: page.items.map((r) => clientView(r, role)), next: page.next, prev: page.prev });
};

/** The unlock check: an invoice-family document of any status. */
const HAS_INVOICE_SQL = `EXISTS (SELECT 1 FROM documents WHERE client_id = c.id AND type IN (${INVOICE_FAMILY_SQL}))`;
const NO_FROZEN_DOC_SQL =
  "NOT EXISTS (SELECT 1 FROM documents WHERE client_id = ?1 AND frozen_at IS NOT NULL)";
const NO_INVOICE_SQL = `NOT EXISTS (SELECT 1 FROM documents WHERE client_id = ?1 AND type IN (${INVOICE_FAMILY_SQL}))`;

const clientExists = async (c: Ctx, id: string) =>
  (await c.env.DB.prepare("SELECT 1 AS x FROM clients WHERE id = ?1").bind(id).first()) !== null;

export const clients = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listClients(c, c.req.valid("query")))

  .post("/", body(createClient), async (c) => {
    const f = c.req.valid("json");
    const db = c.env.DB;
    const tax = clientTaxCheck({ ...f });
    if (!tax.ok) return taxError(c, tax);
    const id = uuidv7();
    const t = Date.now();
    const contact = f.contact;
    const contactId = uuidv7();
    for (let attempt = 0; ; attempt++) {
      try {
        const done = await mutate(c, {
          main: [
            insertClientStmt(db, {
              id,
              legalName: f.legalName,
              displayName: f.displayName ?? f.legalName,
              type: f.type,
              country: f.country,
              gstStatus: f.gstStatus,
              gstin: tax.gstin,
              stateCode: tax.stateCode,
              currency: f.currency,
              serviceAddress: f.serviceAddress,
              tags: f.tags,
              notes: norm(f.notes),
            }),
            ...(contact
              ? [
                  db
                    .prepare(
                      `INSERT INTO contacts (id, client_id, name, email, phone, title, is_primary, is_billing, portal_access, can_see_finance, marketing_consent)
                       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10 WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?2)`,
                    )
                    .bind(
                      contactId,
                      id,
                      contact.name,
                      normaliseEmail(contact.email),
                      norm(contact.phone),
                      norm(contact.title),
                      contact.isBilling ? 1 : 0,
                      contact.portalAccess ? 1 : 0,
                      (contact.canSeeFinance ?? contact.isBilling) ? 1 : 0,
                      contact.marketingConsent
                        ? JSON.stringify({ granted: true, at: t, source: "admin" })
                        : null,
                    ),
                ]
              : []),
          ],
          action: "client.create",
          entityType: "client",
          entityId: id,
          summary: { clientId: id, ...(contact ? { contactId } : {}) },
          status: 201,
        });
        if (!done) return err(c, NOT_FOUND, 404);
        break;
      } catch (e) {
        if (isUnique(e, "clients.code") && attempt < 2) continue;
        if (isUnique(e, "clients.gstin")) return err(c, GSTIN_IN_USE, 409);
        throw e;
      }
    }
    const made = await db
      .prepare("SELECT code FROM clients WHERE id = ?1")
      .bind(id)
      .first<{ code: string }>();
    return c.json(
      { id, code: made?.code ?? "", ...(contact ? { contactId } : {}), warnings: taxWarnings(tax) },
      201,
    );
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const role = actor(c).role;
    const db = c.env.DB;
    const [client, contacts, live, lead, locked] = await db.batch<
      ClientRow & ContactRow & { ref: string; x: number; n: number }
    >([
      db.prepare(`SELECT ${CLIENT_COLS} FROM clients WHERE id = ?1`).bind(id),
      db
        .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE client_id = ?1 ORDER BY email, id LIMIT 101`)
        .bind(id),
      db
        .prepare("SELECT count(*) AS n FROM contacts WHERE client_id = ?1 AND anonymised_at IS NULL")
        .bind(id),
      db.prepare("SELECT id, ref FROM leads WHERE client_id = ?1 ORDER BY created_at, id LIMIT 1").bind(id),
      db.prepare(`SELECT ${HAS_INVOICE_SQL} AS x FROM clients c WHERE c.id = ?1`).bind(id),
    ]);
    const row = client?.results[0] as ClientRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const list = (contacts?.results ?? []) as ContactRow[];
    const shown = list.slice(0, 100);
    const last = shown[shown.length - 1];
    return c.json({
      client: clientView(row, role),
      contacts: shown.map(contactView),
      moreContacts: list.length > 100,
      // Where "Show more" continues: the same cursor as GET /clients/:id/contacts?after=.
      contactsNext: list.length > 100 && last ? encodeCursor({ k: last.email, id: last.id }) : null,
      // Contacts that are not anonymised (the list above keeps the tombstones).
      liveContactCount: (live?.results[0] as { n: number } | undefined)?.n ?? 0,
      // An individual whose personal details were removed: the screens show it read-only (M3.4 review; see anonymised.ts).
      anonymised: row.anonymised_at !== null,
      sourceLead: (lead?.results[0] as { id: string; ref: string } | undefined) ?? null,
      // The lock is a finance fact: only a role that reads finance is told.
      ...(canFinance(role)
        ? { currencyLocked: Boolean((locked?.results[0] as { x: number } | undefined)?.x) }
        : {}),
    });
  })

  .patch("/:id", param(idParam), body(patchClient), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(`SELECT ${CLIENT_COLS} FROM clients WHERE id = ?1`)
      .bind(id)
      .first<ClientRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const j = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
    const wanted: [string, string, string | number | null | undefined][] = [
      ["legalName", "legal_name", f.legalName],
      ["displayName", "display_name", f.displayName],
      ["type", "type", f.type],
      ["serviceAddress", "service_address", f.serviceAddress === undefined ? undefined : j(f.serviceAddress)],
      ["tags", "tags", f.tags === undefined ? undefined : j(f.tags)],
      ["notes", "notes", f.notes === undefined ? undefined : norm(f.notes)],
    ];
    const changes = wanted.filter(
      (w): w is [string, string, string | number | null] =>
        w[2] !== undefined && w[2] !== (row as unknown as Record<string, unknown>)[w[1]],
    );
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const t = Date.now();
    // The type decides which erase rules apply, so once an issued (frozen) document exists it is fixed: the condition is part
    // of the write, like the currency lock (an individual client cannot be turned into a business to make a contact erasable).
    const typeChanges = changes.some(([name]) => name === "type");
    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE clients SET ${changes.map(([, col], i) => `${col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND anonymised_at IS NULL${typeChanges ? ` AND ${NO_FROZEN_DOC_SQL}` : ""}`,
          )
          .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch[2])),
        action: "client.update",
        entityType: "client",
        entityId: id,
        summary: { clientCode: row.code, changed: changes.map(([name]) => name) },
      });
    } catch (e) {
      // The trigger `clients_type_locked` is the backstop behind the condition above.
      if (refusedWith(e, /client type is locked/)) return err(c, TYPE_LOCKED, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare("SELECT updated_at, anonymised_at FROM clients WHERE id = ?1")
        .bind(id)
        .first<{ updated_at: number; anonymised_at: number | null }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.anonymised_at !== null) return refuseAnonymised(c);
      return again.updated_at !== f.expectedUpdatedAt || !typeChanges
        ? err(c, STALE_VERSION, 409)
        : err(c, TYPE_LOCKED, 409);
    }
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  // ---- billing: the finance fields, one conditional write (the currency lock is part of the statement) ----
  .patch("/:id/billing", param(idParam), body(patchBilling), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(`SELECT ${CLIENT_COLS} FROM clients WHERE id = ?1`)
      .bind(id)
      .first<ClientRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);

    // The tax identity as it would be: what was sent over what is stored. A new status drops what it cannot hold; a new GSTIN
    // takes the state from itself unless one is sent.
    const gstStatus = f.gstStatus ?? row.gst_status;
    const next: TaxInput = {
      gstStatus,
      country: f.country ?? row.country,
      gstin: f.gstin !== undefined ? f.gstin : gstStatus === "registered" ? row.gstin : null,
      stateCode:
        f.stateCode !== undefined
          ? f.stateCode
          : gstStatus === "overseas"
            ? null
            : f.gstin !== undefined && gstStatus === "registered"
              ? null
              : row.state_code,
    };
    // The tax rules run only when the save touches the tax identity: a terms-only save on an old client with no state still works.
    const taxTouched =
      f.country !== undefined ||
      f.gstStatus !== undefined ||
      f.gstin !== undefined ||
      f.stateCode !== undefined;
    const tax = taxTouched ? clientTaxCheck(next) : null;
    if (tax && !tax.ok) return taxError(c, tax);
    const warnings = tax?.ok ? taxWarnings(tax) : [];

    const j = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
    const cur = row as unknown as Record<string, unknown>;
    const wanted: [ClientBillingField, unknown][] = [
      ["country", f.country],
      ["gstStatus", f.gstStatus],
      ["gstin", tax?.ok ? tax.gstin : undefined],
      ["stateCode", tax?.ok ? tax.stateCode : undefined],
      ["billingAddress", f.billingAddress === undefined ? undefined : j(f.billingAddress)],
      ["currency", f.currency],
      ["paymentTermsDays", f.paymentTermsDays],
      ["reminderPolicy", f.reminderPolicy === undefined ? undefined : j(f.reminderPolicy)],
      ["careAutoIssue", f.careAutoIssue === undefined ? undefined : f.careAutoIssue ? 1 : 0],
      ["attachPdf", f.attachPdf === undefined ? undefined : f.attachPdf ? 1 : 0],
    ];
    const changes = wanted.filter(
      (w): w is [ClientBillingField, string | number | null] =>
        w[1] !== undefined && w[1] !== cur[snake(w[0])],
    );
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at, warnings });

    const t = Date.now();
    const currencyChanges = changes.some(([k]) => k === "currency");
    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE clients SET ${changes.map(([k], i) => `${snake(k)} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND anonymised_at IS NULL${currencyChanges ? ` AND ${NO_INVOICE_SQL}` : ""}`,
          )
          .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch[1])),
        action: "client.billing_update",
        entityType: "client",
        entityId: id,
        summary: { clientCode: row.code, changed: changes.map(([name]) => name) },
      });
    } catch (e) {
      if (isUnique(e, "clients.gstin")) return err(c, GSTIN_IN_USE, 409);
      // The trigger is the backstop for an invoice that appeared between the statement's check and its write.
      if (refusedWith(e, /currency is locked/)) return err(c, CURRENCY_LOCKED, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare("SELECT updated_at, anonymised_at FROM clients WHERE id = ?1")
        .bind(id)
        .first<{ updated_at: number; anonymised_at: number | null }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.anonymised_at !== null) return refuseAnonymised(c);
      return again.updated_at !== f.expectedUpdatedAt || !currencyChanges
        ? err(c, STALE_VERSION, 409)
        : err(c, CURRENCY_LOCKED, 409);
    }
    return c.json({ ok: true, changed: true, updatedAt: t, warnings });
  })

  // ---- the finance tabs and the statement arrive with invoicing (M5/M6); the boundary is in place now ----
  .get("/:id/finance", param(idParam), async (c) =>
    (await clientExists(c, c.req.valid("param").id)) ? c.json({ available: false }) : err(c, NOT_FOUND, 404),
  )
  .get("/:id/statement", param(idParam), query(statementQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    const a = parseIsoDate(from);
    const b = parseIsoDate(to);
    if (!a || !b || fromIst(b) < fromIst(a)) return err(c, BAD_REQUEST, 400);
    if (!(await clientExists(c, c.req.valid("param").id))) return err(c, NOT_FOUND, 404);
    return c.json({ available: false, from, to });
  })

  // ---- activity: the audit rows about the client and its contacts, newest first; finance actions only for a finance role ----
  .get("/:id/activity", param(idParam), query(pageQuery), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const role = actor(c).role;
    const limit = limitOf(q.limit);
    const cur = q.after === undefined ? null : decodeCursor(q.after);
    if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
    if (!(await clientExists(c, id))) return err(c, NOT_FOUND, 404);
    const hidden = canFinance(role) ? [] : [...FINANCE_AUDIT_ACTIONS];
    const order = keysetSql("a.at", "a.id", false, "after", 2);
    const marks = hidden.map((_, i) => `?${(cur ? 4 : 2) + i}`).join(", ");
    const { results } = await c.env.DB.prepare(
      `SELECT a.id, a.at, a.actor_type, a.actor_id, (SELECT name FROM staff_users WHERE id = a.actor_id) AS actor_name, a.action, a.entity_type, a.entity_id, a.summary
       FROM audit_log a WHERE ((a.entity_type = 'client' AND a.entity_id = ?1) OR (a.entity_type = 'contact' AND a.entity_id IN (SELECT id FROM contacts WHERE client_id = ?1)))${cur ? ` AND ${order.where}` : ""}${hidden.length ? ` AND a.action NOT IN (${marks})` : ""}
       ORDER BY ${order.order} LIMIT ${limit + 1}`,
    )
      .bind(id, ...(cur ? [cur.k, cur.id] : []), ...hidden)
      .all<{
        id: string;
        at: number;
        actor_type: string;
        actor_id: string | null;
        actor_name: string | null;
        action: string;
        entity_type: string;
        entity_id: string;
        summary: string | null;
      }>();
    const page = pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.at, id: r.id }));
    return c.json({
      entries: page.items.map((r) => ({
        id: r.id,
        at: r.at,
        actorType: r.actor_type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: json(r.summary),
      })),
      next: page.next,
    });
  })

  // ---- contacts of a client ----
  .get("/:id/contacts", param(idParam), query(pageQuery), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const limit = limitOf(q.limit);
    const cur = q.after === undefined ? null : decodeCursor(q.after);
    if (q.after !== undefined && (!cur || typeof cur.k !== "string")) return err(c, BAD_REQUEST, 400);
    if (!(await clientExists(c, id))) return err(c, NOT_FOUND, 404);
    const order = keysetSql("c.email", "c.id", true, "after", 2);
    const { results } = await c.env.DB.prepare(
      `SELECT ${CONTACT_COLS.replace(/(\w+)/g, "c.$1")} FROM contacts c WHERE c.client_id = ?1${cur ? ` AND ${order.where}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
    )
      .bind(id, ...(cur ? [cur.k, cur.id] : []))
      .all<ContactRow>();
    const page = pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.email, id: r.id }));
    return c.json({ contacts: page.items.map(contactView), next: page.next });
  })

  .post("/:id/contacts", param(idParam), body(createContact), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const contactId = uuidv7();
    const email = normaliseEmail(f.email);
    const t = Date.now();
    let done: boolean;
    try {
      done = await mutate(c, {
        action: "contact.create",
        entityType: "client",
        entityId: id,
        status: 201,
        // Written only for a client that exists and has no contact at that address yet.
        auditFirst: (auditId, who) =>
          auditRow(
            db,
            auditId,
            who,
            "contact.create",
            "cl.id",
            "json_object('contactId', ?8)",
            "FROM clients cl WHERE cl.id = ?7 AND cl.anonymised_at IS NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE client_id = cl.id AND email = ?9)",
            [id, contactId, email],
          ),
        after: (g) => [
          ...(f.isPrimary
            ? [
                db
                  .prepare(
                    `UPDATE contacts SET is_primary = 0, updated_at = ?2 WHERE client_id = ?1 AND is_primary = 1 AND ${g.sql(3)}`,
                  )
                  .bind(id, t, ...g.params),
              ]
            : []),
          // The first contact of a client is its primary one, whatever was asked.
          db
            .prepare(
              `INSERT INTO contacts (id, client_id, name, email, phone, title, is_primary, is_billing, portal_access, can_see_finance, marketing_consent)
               SELECT ?1, ?2, ?3, ?4, ?5, ?6, (?7 OR NOT EXISTS (SELECT 1 FROM contacts WHERE client_id = ?2 AND is_primary = 1)), ?8, ?9, ?10, ?11 WHERE ${g.sql(12)}`,
            )
            .bind(
              contactId,
              id,
              f.name,
              email,
              norm(f.phone),
              norm(f.title),
              f.isPrimary ? 1 : 0,
              f.isBilling ? 1 : 0,
              f.portalAccess ? 1 : 0,
              (f.canSeeFinance ?? f.isBilling) ? 1 : 0,
              f.marketingConsent ? JSON.stringify({ granted: true, at: t, source: "admin" }) : null,
              ...g.params,
            ),
        ],
      });
    } catch (e) {
      if (isUnique(e, "contacts.client_id, contacts.email")) return err(c, EMAIL_IN_USE, 409);
      throw e;
    }
    if (done) return c.json({ id: contactId }, 201);
    const cl = await db
      .prepare("SELECT anonymised_at FROM clients WHERE id = ?1")
      .bind(id)
      .first<{ anonymised_at: number | null }>();
    if (!cl) return err(c, NOT_FOUND, 404);
    return cl.anonymised_at !== null ? refuseAnonymised(c) : err(c, EMAIL_IN_USE, 409);
  });

// ---- contacts ----------------------------------------------------------------------------------------------------------

const UNIQUE_PRIMARY = /contacts\.client_id|contacts_one_primary/;

/** Which part of the export, as SQL: `?1` contact, `?2` email, `?3` client; a cursor adds `?4` (and `?5`). Each part pages 50. */
export const EXPORT_PARTS: Record<string, { sql: (cur: boolean) => string; time?: true }> = {
  leads: {
    sql: (cur) =>
      `SELECT * FROM leads WHERE (contact_id = ?1 OR (contact_email = ?2 AND (client_id IS NULL OR client_id = ?3)))${cur ? " AND id > ?5" : ""} ORDER BY id LIMIT 51`,
  },
  lead_activities: {
    sql: (cur) =>
      `SELECT id, lead_id, kind, body, actor_id, created_at FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = ?1 OR (contact_email = ?2 AND (client_id IS NULL OR client_id = ?3)))${cur ? " AND id > ?5" : ""} ORDER BY id LIMIT 51`,
  },
  // No token hash: a session is described by its times and where it came from.
  sessions: {
    sql: (cur) =>
      `SELECT rowid AS id, created_at, last_seen_at, idle_expires_at, abs_expires_at, ip, user_agent, revoked_at FROM client_sessions WHERE contact_id = ?1${cur ? " AND rowid > ?5" : ""} ORDER BY rowid LIMIT 51`,
  },
  magic_links: {
    sql: (cur) =>
      `SELECT rowid AS id, created_at, expires_at, used_at FROM magic_link_tokens WHERE contact_id = ?1${cur ? " AND rowid > ?5" : ""} ORDER BY rowid LIMIT 51`,
  },
  acceptances: {
    sql: (cur) =>
      `SELECT id, document_id, contact_id, typed_name, email, accepted_at, ip, user_agent, country, pdf_sha256, terms_version_id FROM acceptances WHERE contact_id = ?1${cur ? " AND id > ?5" : ""} ORDER BY id LIMIT 51`,
  },
  documents: {
    sql: (cur) =>
      `SELECT id, type, status, number_display, issue_date, total_minor, currency, recipient, frozen_at FROM documents WHERE client_id = ?3 AND frozen_at IS NOT NULL AND ((SELECT type FROM clients WHERE id = ?3) = 'individual' OR lower(json_extract(recipient, '$.email')) = ?2)${cur ? " AND id > ?5" : ""} ORDER BY id LIMIT 51`,
  },
  email_log: {
    sql: (cur) =>
      `SELECT id, to_email, template, entity_type, entity_id, status, created_at AS at FROM email_log WHERE to_email = ?2 AND (entity_type IS NULL OR entity_type NOT IN ('lead', 'lead_reply', 'document') OR (entity_type = 'lead' AND NOT EXISTS (SELECT 1 FROM leads x WHERE x.ref = email_log.entity_id AND x.client_id IS NOT NULL AND x.client_id <> ?3)) OR (entity_type = 'lead_reply' AND NOT EXISTS (SELECT 1 FROM lead_activities a JOIN leads x ON x.id = a.lead_id WHERE a.id = email_log.entity_id AND x.client_id IS NOT NULL AND x.client_id <> ?3)) OR (entity_type = 'document' AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.id = email_log.entity_id AND x.client_id IS NOT NULL AND x.client_id <> ?3)))${cur ? " AND (created_at, id) > (?4, ?5)" : ""} ORDER BY created_at, id LIMIT 51`,
    time: true,
  },
  audit_log: {
    sql: (cur) =>
      `SELECT id, at, actor_type, actor_id, action, entity_type, entity_id, summary, CASE WHEN actor_id = ?1 THEN ip END AS ip, CASE WHEN actor_id = ?1 THEN user_agent END AS user_agent FROM (SELECT id, at, actor_type, actor_id, action, entity_type, entity_id, summary, ip, user_agent FROM audit_log WHERE actor_id = ?1 UNION SELECT id, at, actor_type, actor_id, action, entity_type, entity_id, summary, ip, user_agent FROM audit_log WHERE entity_type = 'contact' AND entity_id = ?1 UNION SELECT id, at, actor_type, actor_id, action, entity_type, entity_id, summary, ip, user_agent FROM audit_log WHERE entity_type = 'client' AND entity_id = ?3 AND json_extract(summary, '$.contactId') = ?1)${cur ? " WHERE (at, id) > (?4, ?5)" : ""} ORDER BY at, id LIMIT 51`,
    time: true,
  },
  access_log: {
    sql: (cur) =>
      `SELECT id, at, realm, actor_id, method, route, status, ip, user_agent FROM access_log WHERE actor_id = ?1${cur ? " AND (at, id) > (?4, ?5)" : ""} ORDER BY at, id LIMIT 51`,
    time: true,
  },
  // The client's notes and file records, only where the erase would delete them: the contact is an individual client's last live
  // contact (`LAST_LIVE_INDIVIDUAL`; the manifest lists these two parts only then, and the SQL repeats the condition). Metadata only:
  // never the file bytes or the R2 key. Whether the file contents belong in an export is VERIFY WITH CA/LEGAL.
  notes: {
    sql: (cur) =>
      `SELECT n.id, n.body_md AS body, n.visibility, (SELECT code FROM projects WHERE id = n.project_id) AS project_code, n.created_at FROM notes n WHERE n.client_id = ?3 AND ${LAST_LIVE_INDIVIDUAL("n.client_id")}${cur ? " AND n.id > ?5" : ""} ORDER BY n.id LIMIT 51`,
  },
  files: {
    sql: (cur) =>
      `SELECT f.id, f.filename, f.mime, f.size, f.sha256, f.shared, (SELECT code FROM projects WHERE id = f.project_id) AS project_code, f.created_at FROM files f WHERE f.client_id = ?3 AND ${LAST_LIVE_INDIVIDUAL("f.client_id")}${cur ? " AND f.id > ?5" : ""} ORDER BY f.id LIMIT 51`,
  },
};
/** The export parts that exist only for an individual client's last live contact. */
const LAST_CONTACT_PARTS = ["notes", "files"];

/** The statements that anonymise (or delete) a person's leads: the lead this contact was made from (`leads.contact_id`, which survives an email change), or by the contact's current email at this client or at none. */
const MATCHED_LEADS =
  "SELECT l.id FROM leads l WHERE l.contact_id = ?1 OR (l.contact_email = (SELECT email FROM contacts WHERE id = ?1) AND (l.client_id IS NULL OR l.client_id = (SELECT client_id FROM contacts WHERE id = ?1)))";
const HELD_LEAD_SQL =
  "EXISTS (SELECT 1 FROM leads l WHERE l.legal_hold = 1 AND (l.contact_id = c.id OR (l.contact_email = c.email AND (l.client_id IS NULL OR l.client_id = c.client_id))))";

/** The client of contact `?1` is an individual and this contact is its last live one: the condition of the client's own erase (`col` is the row's client column). */
const LAST_LIVE_INDIVIDUAL = (col: string) =>
  `${col} = (SELECT client_id FROM contacts WHERE id = ?1) AND EXISTS (SELECT 1 FROM clients cl WHERE cl.id = ${col} AND cl.type = 'individual') AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = ${col} AND o.id <> ?1 AND o.anonymised_at IS NULL)`;

export const contacts = new Hono<AppEnv>()
  .patch("/:id", param(idParam), body(patchContact), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = ?1`)
      .bind(id)
      .first<ContactRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.anonymised_at !== null) return err(c, ANONYMISED, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);

    const email = f.email === undefined ? undefined : normaliseEmail(f.email);
    const consent = json(row.marketing_consent) as { granted?: boolean } | null;
    const t = Date.now();
    let consentJson: string | null | undefined;
    if (f.marketingConsent === true && !consent?.granted)
      consentJson = JSON.stringify({ granted: true, at: t, source: "admin" });
    else if (f.marketingConsent === false && consent?.granted)
      consentJson = JSON.stringify({ ...consent, granted: false, withdrawnAt: t });
    const flag = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
    const wanted: [string, string, string | number | null | undefined][] = [
      ["name", "name", f.name],
      ["email", "email", email],
      ["phone", "phone", f.phone === undefined ? undefined : norm(f.phone)],
      ["title", "title", f.title === undefined ? undefined : norm(f.title)],
      ["isPrimary", "is_primary", f.isPrimary ? 1 : undefined],
      ["isBilling", "is_billing", flag(f.isBilling)],
      ["portalAccess", "portal_access", flag(f.portalAccess)],
      ["canSeeFinance", "can_see_finance", flag(f.canSeeFinance)],
      ["marketingConsent", "marketing_consent", consentJson],
    ];
    const changes = wanted.filter(
      (w): w is [string, string, string | number | null] =>
        w[2] !== undefined && w[2] !== (row as unknown as Record<string, unknown>)[w[1]],
    );
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });
    const names = changes.map(([n]) => n);
    // Portal access ends (off, or a new address): sessions and unused sign-in links go in the same batch.
    const endsAccess =
      (names.includes("portalAccess") && row.portal_access === 1 && f.portalAccess === false) ||
      names.includes("email");

    let done: boolean;
    try {
      done = await mutate(c, {
        action: "contact.update",
        entityType: "client",
        entityId: row.client_id,
        auditFirst: (auditId, who) =>
          auditRow(
            db,
            auditId,
            who,
            "contact.update",
            "c.client_id",
            "json_object('contactId', c.id, 'changed', json(?9))",
            `FROM contacts c WHERE c.id = ?7 AND c.updated_at = ?8 AND c.anonymised_at IS NULL${email !== undefined && email !== row.email ? " AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = c.client_id AND o.email = ?10 AND o.id <> c.id)" : ""}`,
            [
              id,
              f.expectedUpdatedAt,
              JSON.stringify(names),
              ...(email !== undefined && email !== row.email ? [email] : []),
            ],
          ),
        after: (g) => [
          ...(f.isPrimary
            ? [
                db
                  .prepare(
                    `UPDATE contacts SET is_primary = 0, updated_at = ?3 WHERE client_id = ?1 AND is_primary = 1 AND id <> ?2 AND ${g.sql(4)}`,
                  )
                  .bind(row.client_id, id, t, ...g.params),
              ]
            : []),
          db
            .prepare(
              `UPDATE contacts SET ${changes.map(([, col], i) => `${col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND ${g.sql(changes.length + 4)}`,
            )
            .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch[2]), ...g.params),
          ...(endsAccess ? revokeContactAccess(db, id, t, g) : []),
        ],
      });
    } catch (e) {
      if (isUnique(e, "contacts.client_id, contacts.email")) return err(c, EMAIL_IN_USE, 409);
      if (refusedWith(e, UNIQUE_PRIMARY)) return err(c, STALE_VERSION, 409);
      if (refusedWith(e, /anonymised contact/)) return err(c, ANONYMISED, 409);
      throw e;
    }
    if (done) return c.json({ ok: true, changed: true, updatedAt: t });
    const again = await db
      .prepare("SELECT updated_at, anonymised_at FROM contacts WHERE id = ?1")
      .bind(id)
      .first<{ updated_at: number; anonymised_at: number | null }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.anonymised_at !== null) return err(c, ANONYMISED, 409);
    return again.updated_at !== f.expectedUpdatedAt ? err(c, STALE_VERSION, 409) : err(c, EMAIL_IN_USE, 409);
  })

  // ---- data-subject export (step-up): a summary, then pages of one part each; the browser assembles the file ----
  .post("/:id/export", param(idParam), body(exportRequest), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const contact = await db
      .prepare(
        "SELECT c.*, cl.type AS client_type, (cl.type = 'individual' AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = c.client_id AND o.id <> c.id AND o.anonymised_at IS NULL)) AS last_live FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?1",
      )
      .bind(id)
      .first<ContactRow & { client_type: string; last_live: number }>();
    if (!contact) return err(c, NOT_FOUND, 404);
    if (contact.anonymised_at !== null) return err(c, ANONYMISED, 409);
    const base = [id, contact.email, contact.client_id];

    let out: Record<string, unknown>;
    let rows: number;
    if (!f.part) {
      const [client, supp] = await db.batch<Record<string, unknown>>([
        db
          .prepare(
            contact.client_type === "individual"
              ? "SELECT * FROM clients WHERE id = ?1"
              : "SELECT code, display_name FROM clients WHERE id = ?1",
          )
          .bind(contact.client_id),
        db.prepare("SELECT * FROM email_suppressions WHERE email = ?1").bind(contact.email),
      ]);
      const { client_type: _kind, last_live: _last, ...plain } = contact;
      out = {
        contact: plain,
        client: client?.results[0] ?? null,
        suppression: supp?.results[0] ?? null,
        // The parts to ask for next, in order (notes and files only for an individual client's last live contact).
        manifest: Object.keys(EXPORT_PARTS).filter(
          (p) => contact.last_live === 1 || !LAST_CONTACT_PARTS.includes(p),
        ),
      };
      rows = 1;
    } else {
      const part = EXPORT_PARTS[f.part];
      const cur = f.after === undefined ? null : decodeCursor(f.after);
      if (f.after !== undefined && !cur) return err(c, BAD_REQUEST, 400);
      if (!part || (LAST_CONTACT_PARTS.includes(f.part) && contact.last_live !== 1))
        return err(c, BAD_REQUEST, 400);
      // Id-ordered parts compare the id (?5); time-ordered ones the pair (?4, ?5). rowid parts carry the number as text.
      const sql = part.sql(cur !== null);
      const bind = cur
        ? [...base, cur.k, f.part === "sessions" || f.part === "magic_links" ? Number(cur.id) : cur.id]
        : base;
      // Bind exactly as many values as the statement has parameters (D1 refuses extra ones).
      const params = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      const { results } = await db
        .prepare(sql)
        .bind(...bind.slice(0, params))
        .all<Record<string, unknown>>();
      const more = results.length > 50;
      const items = more ? results.slice(0, 50) : results;
      const last = items.at(-1);
      out = {
        part: f.part,
        items,
        next:
          more && last ? encodeCursor({ k: part.time ? (last.at as number) : 0, id: String(last.id) }) : null,
      };
      rows = items.length;
    }
    // The audit row is written before anything leaves; one row per call, with ids and counts only.
    await mutate(c, {
      action: "contact.export",
      entityType: "client",
      entityId: contact.client_id,
      summary: { contactId: id, part: f.part ?? "summary", rows },
    });
    return c.json(out);
  })

  // ---- erase or anonymise (owner, step-up): ONE audit-first batch; nothing is read before it ----
  .post("/:id/erase", param(idParam), body(eraseRequest), async (c) => {
    const { id } = c.req.valid("param");
    const { mode, reason } = c.req.valid("json");
    const db = c.env.DB;
    const t = Date.now();
    const erase = mode === "erase";
    const fileKeys: string[] = [];
    const done = await mutate(c, {
      action: erase ? "contact.erase" : "contact.anonymise",
      entityType: "client",
      entityId: null,
      // The only statement that returns rows is the files DELETE ... RETURNING r2_key: those objects are deleted after the batch.
      onResults: (results) => {
        for (const r of results)
          for (const row of r.results as { r2_key?: string }[]) if (row.r2_key) fileKeys.push(row.r2_key);
      },
      // The row is written only while the contact is live, no legal hold stands on the contact, its client or a lead of theirs, and
      // (erase only) the contact is on no issued document. Every following statement is guarded on this row.
      auditFirst: (auditId, who) =>
        auditRow(
          db,
          auditId,
          who,
          erase ? "contact.erase" : "contact.anonymise",
          "c.client_id",
          "json_object('contactId', c.id, 'mode', ?8, 'reason', ?9)",
          `FROM contacts c JOIN clients cl ON cl.id = c.client_id
           WHERE c.id = ?7 AND c.anonymised_at IS NULL AND c.legal_hold = 0 AND cl.legal_hold = 0 AND NOT ${HELD_LEAD_SQL}${erase ? ` AND NOT ${CONTACT_ON_ISSUED_DOCUMENT_SQL}` : ""}`,
          [id, mode, reason],
        ),
      after: (g) => [
        // 1. what the person wrote and what the bell shows about their leads (matched by the contact's email, before it changes)
        db
          .prepare(
            `UPDATE lead_activities SET body = NULL WHERE lead_id IN (${MATCHED_LEADS}) AND body IS NOT NULL AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
        db
          .prepare(
            `DELETE FROM notifications WHERE entity_type = 'lead' AND entity_id IN (${MATCHED_LEADS}) AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
        db
          .prepare(
            `UPDATE leads SET contact_name = ?2, contact_email = ?3, contact_phone = NULL, contact_company = NULL, message = NULL, call_window = NULL, utm = NULL, source_page = NULL, referrer_host = NULL, next_action_note = NULL, consent = CASE WHEN consent IS NULL THEN NULL ELSE json_remove(consent, '$.ipHash') END, updated_at = ?4
             WHERE id IN (${MATCHED_LEADS}) AND ${g.sql(5)}`,
          )
          .bind(id, ANONYMISED_CONTACT, anonymisedEmail(id), t, ...g.params),
        // 2. sign-in access: sessions and links of this contact
        ...deleteContactAccess(db, id, g),
        // 2b. an individual client's notes and files go with its last live contact (owner, 2026-10-25; VERIFY WITH CA/LEGAL; a
        //     business client's are never touched). The same conditions as step 3, in the same batch, before the contact changes.
        //     The file rows come back (RETURNING) so their R2 objects can be deleted after the batch.
        db
          .prepare(`DELETE FROM notes WHERE ${LAST_LIVE_INDIVIDUAL("notes.client_id")} AND ${g.sql(2)}`)
          .bind(id, ...g.params),
        db
          .prepare(
            `DELETE FROM files WHERE ${LAST_LIVE_INDIVIDUAL("files.client_id")} AND ${g.sql(2)} RETURNING r2_key`,
          )
          .bind(id, ...g.params),
        // 2c. its projects keep only their codes, and their milestones become "Milestone 1, 2, ..." in order (owner, 2026-10-25;
        //     free-text names can name the person; amounts, dates and statuses stay; VERIFY WITH CA/LEGAL). Same conditions.
        db
          .prepare(
            `UPDATE milestones SET title = 'Milestone ' || (SELECT count(*) FROM milestones m2 WHERE m2.project_id = milestones.project_id AND m2.position <= milestones.position), updated_at = max(?2, updated_at + 1)
             WHERE project_id IN (SELECT id FROM projects WHERE ${LAST_LIVE_INDIVIDUAL("projects.client_id")}) AND ${g.sql(3)}`,
          )
          .bind(id, t, ...g.params),
        db
          .prepare(
            `UPDATE projects SET name = code, updated_at = max(?2, updated_at + 1) WHERE ${LAST_LIVE_INDIVIDUAL("projects.client_id")} AND ${g.sql(3)}`,
          )
          .bind(id, t, ...g.params),
        // 3. an individual client's own record, when this is its last live contact (before the contact changes)
        db
          .prepare(
            `UPDATE clients SET legal_name = ?2, display_name = ?2, billing_address = NULL, service_address = NULL, notes = NULL, tags = NULL, anonymised_at = ?3, updated_at = ?3
             WHERE id = (SELECT client_id FROM contacts WHERE id = ?1) AND type = 'individual'
               AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = clients.id AND o.id <> ?1 AND o.anonymised_at IS NULL) AND ${g.sql(4)}`,
          )
          .bind(id, ANONYMISED_CLIENT, t, ...g.params),
        //    and its GSTIN, which holds the person's PAN: a registered one becomes unregistered (owner, 2026-10-25; issued
        //    documents keep their own snapshot; VERIFY WITH CA/LEGAL). Its own statement, so the state trigger only meets
        //    registered rows and an older client without a state still erases.
        db
          .prepare(
            `UPDATE clients SET gstin = NULL, gst_status = 'unregistered'
             WHERE id = (SELECT client_id FROM contacts WHERE id = ?1) AND type = 'individual' AND gst_status = 'registered'
               AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = clients.id AND o.id <> ?1 AND o.anonymised_at IS NULL) AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
        // 4. the contact itself
        erase
          ? db.prepare(`DELETE FROM contacts WHERE id = ?1 AND ${g.sql(2)}`).bind(id, ...g.params)
          : db
              .prepare(
                `UPDATE contacts SET name = ?2, email = ?3, phone = NULL, title = NULL, is_primary = 0, is_billing = 0, portal_access = 0, can_see_finance = 0, marketing_consent = NULL, bounced_at = NULL, anonymised_at = ?4, updated_at = ?4 WHERE id = ?1 AND ${g.sql(5)}`,
              )
              .bind(id, ANONYMISED_CONTACT, anonymisedEmail(id), t, ...g.params),
      ],
    });
    if (done) {
      if (fileKeys.length) c.executionCtx.waitUntil(dropObjects(c.env, fileKeys, "client erased"));
      return c.json({ ok: true, mode });
    }
    // Nothing was written: say why.
    const why = await c.env.DB.prepare(
      `SELECT c.anonymised_at AS gone, (c.legal_hold = 1 OR cl.legal_hold = 1 OR ${HELD_LEAD_SQL}) AS held, ${CONTACT_ON_ISSUED_DOCUMENT_SQL} AS doc FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?1`,
    )
      .bind(id)
      .first<{ gone: number | null; held: number; doc: number }>();
    if (!why) return err(c, NOT_FOUND, 404);
    if (why.gone !== null) return err(c, ANONYMISED, 409);
    if (why.held) return err(c, LEGAL_HOLD, 409);
    if (erase && why.doc) return err(c, ON_ISSUED_DOCUMENT, 409);
    return err(c, NOT_AVAILABLE, 409);
  });
