// Fixtures of the clients and contacts tests (M3.3): rows written straight to the test database, and a few readers.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { withDb } from "./test-helpers.ts";

let seq = 0;

/** Insert a row from an object (column names are the keys). */
export async function insert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`,
  )
    .bind(...Object.values(row))
    .run();
}

/** A client with codes `T0001`... (the lead conversion's `C####` sequence is not disturbed). */
export async function mkClient(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const id = uuidv7();
  await insert("clients", {
    id,
    code: `T${String(n).padStart(4, "0")}`,
    legal_name: `Test Co ${n}`,
    display_name: `Test Co ${n}`,
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    state_code: "19",
    currency: "INR",
    ...over,
  });
  return id;
}

export async function mkContact(clientId: string, over: Record<string, unknown> = {}) {
  const n = ++seq;
  const id = uuidv7();
  const email = (over.email as string | undefined) ?? `person${n}@example.test`;
  await insert("contacts", { id, client_id: clientId, name: `Person ${n}`, ...over, email });
  return { id, email };
}

/** A live portal session and an unused sign-in link for a contact. */
export async function mkAccess(contactId: string, clientId: string) {
  const t = Date.now();
  const session = `sess-${uuidv7()}`;
  const link = `link-${uuidv7()}`;
  await insert("client_sessions", {
    id: session,
    contact_id: contactId,
    client_id: clientId,
    last_seen_at: t,
    idle_expires_at: t + 3_600_000,
    abs_expires_at: t + 3_600_000,
    ip: "203.0.113.9",
    user_agent: "Test/1.0",
  });
  await insert("magic_link_tokens", { token_hash: link, contact_id: contactId, expires_at: t + 900_000 });
  return { session, link };
}

/** A lead whose contact email is `email`. */
export async function mkLead(email: string, over: Record<string, unknown> = {}, notifyUserId?: string) {
  const n = ++seq;
  const id = uuidv7();
  await insert("leads", {
    id,
    ref: `L-T${String(n).padStart(4, "0")}`,
    source: "web",
    form_version: "contact-1",
    contact_name: "Lead Person",
    contact_email: email,
    contact_phone: "+91 90000 11111",
    contact_company: "Lead Co",
    message: "Please call me about the website",
    call_window: "evening",
    source_page: "/services",
    referrer_host: "example.org",
    next_action_note: "Ring back",
    consent: JSON.stringify({
      noticeVersion: "v1",
      purposes: ["reply"],
      at: 1,
      ipHash: "abc123",
      marketing: false,
    }),
    ...over,
  });
  await insert("lead_activities", {
    id: uuidv7(),
    lead_id: id,
    kind: "note",
    body: "Spoke about pricing",
    created_at: 1,
  });
  if (notifyUserId)
    await insert("notifications", {
      id: `n_${uuidv7()}`,
      user_id: notifyUserId,
      kind: "lead.new",
      entity_type: "lead",
      entity_id: id,
      title: "New lead: Lead Person, Website",
      link: `/leads/${id}`,
    });
  return id;
}

/** A document of a client; `frozen` makes it an issued one with a number (and the recipient snapshot). */
export async function mkDoc(
  clientId: string,
  type: string,
  opts: { frozen?: boolean; recipientEmail?: string } = {},
) {
  const id = uuidv7();
  const n = ++seq;
  await insert("documents", {
    id,
    type,
    client_id: clientId,
    currency: "INR",
    ...(opts.frozen
      ? {
          status: "issued",
          series: "invoice",
          fy: "2026-27",
          number: n,
          number_display: `TEST/${n}`,
          frozen_at: Date.now(),
        }
      : {}),
    ...(opts.recipientEmail
      ? { recipient: JSON.stringify({ legalName: "L", country: "IN", email: opts.recipientEmail }) }
      : {}),
  });
  return id;
}

/** `env` whose first D1 batch is held back until `before` has run: a write that lands "between the read and the batch". */
export function beforeBatch(before: () => Promise<void>): Env {
  const db = {
    prepare: (q: string) => env.DB.prepare(q),
    batch: async (stmts: D1PreparedStatement[]) => {
      await before();
      return env.DB.batch(stmts);
    },
  } as unknown as D1Database;
  return withDb(db);
}

/** The state of every table an erase may touch, as one string (equal before and after a refused request). */
export async function snapshot() {
  const tables: [string, string][] = [
    ["clients", "id"],
    ["contacts", "id"],
    ["leads", "id"],
    ["lead_activities", "id"],
    ["notifications", "id"],
    ["client_sessions", "id"],
    ["magic_link_tokens", "token_hash"],
    ["audit_log", "id"],
    ["email_log", "id"],
  ];
  const out: unknown[] = [];
  for (const [t, key] of tables)
    out.push((await env.DB.prepare(`SELECT * FROM ${t} ORDER BY ${key}`).all()).results);
  return JSON.stringify(out);
}

/** Every key of a JSON value, at any depth. */
export function keysDeep(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysDeep);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]);
  return [];
}
