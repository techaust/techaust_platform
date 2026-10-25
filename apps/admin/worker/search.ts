// Global search [ADM-G-05]: one box over what exists today and what the role may read: staff (owner only, `users.read`) and
// leads (`leads.read`: by reference, the start of the contact's email or the start of the company name). At most five per type; prefix matches as index
// ranges (`leads_ref`, `leads_email`, `leads_company_nocase`, `staff_users_email`), never a table scan of a big table. Clients, contacts, projects and
// documents join as their milestones create them (M3.2 and later). Read-only, so no audit row (the access log has the request).
import { decide } from "@techaust/core/permissions";
import { escapeLike } from "@techaust/core/text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor } from "./context.ts";
import { query } from "./http.ts";
import { PREFIX_END } from "./keyset.ts";

const searchQuery = z.object({ q: z.string().check(z.maxLength(100)) });
const PER_TYPE = 5;
const MIN_CHARS = 2;

type Item = { id: string; title: string; subtitle: string; link: string };
type Group = { type: "user" | "lead" | "client" | "contact"; label: string; items: Item[] };

/** The two reads, exported so a test can EXPLAIN them: leads by the start of the reference or the email (index ranges), staff by email range or name. */
export const LEADS_SQL = `SELECT id, ref, contact_name, contact_email FROM (
  SELECT id, ref, contact_name, contact_email FROM leads WHERE ref >= ?1 AND ref < ?2
  UNION SELECT id, ref, contact_name, contact_email FROM leads WHERE contact_email >= ?3 AND contact_email < ?4
  UNION SELECT id, ref, contact_name, contact_email FROM leads WHERE contact_company COLLATE NOCASE >= ?5 AND contact_company COLLATE NOCASE < ?6
) ORDER BY ref LIMIT ${PER_TYPE}`;
/** Clients by the start of the code or the name (no case), contacts by the start of the email: index ranges (`clients_code`, `clients_name_nocase`, `contacts_email`). */
export const CLIENTS_SQL = `SELECT id, code, display_name FROM (
  SELECT id, code, display_name FROM clients WHERE code >= ?1 AND code < ?2
  UNION SELECT id, code, display_name FROM clients WHERE display_name COLLATE NOCASE >= ?3 AND display_name COLLATE NOCASE < ?4
) ORDER BY code LIMIT ${PER_TYPE}`;
export const CONTACTS_SQL = `SELECT id, client_id, name, email FROM contacts WHERE email >= ?1 AND email < ?2 AND anonymised_at IS NULL ORDER BY email LIMIT ${PER_TYPE}`;
export const USERS_SQL = `SELECT id, name, email, role FROM staff_users WHERE (email >= ?1 AND email < ?2) OR name LIKE ?3 ESCAPE '\\' ORDER BY name LIMIT ${PER_TYPE}`;

export const search = new Hono<AppEnv>().get("/", query(searchQuery), async (c) => {
  const q = c.req.valid("query").q.trim();
  if (q.length < MIN_CHARS) return c.json({ q, groups: [] satisfies Group[] });
  const role = actor(c).role;
  const db = c.env.DB;
  const lower = q.toLowerCase();
  const stmts: D1PreparedStatement[] = [];
  const kinds: Group["type"][] = [];
  if (decide(role, "leads.read") !== "deny") {
    const ref = q.toUpperCase();
    stmts.push(
      db
        .prepare(LEADS_SQL)
        .bind(ref, `${ref}${PREFIX_END}`, lower, `${lower}${PREFIX_END}`, q, `${q}${PREFIX_END}`),
    );
    kinds.push("lead");
  }
  if (decide(role, "clients.read") !== "deny") {
    const code = q.toUpperCase();
    stmts.push(db.prepare(CLIENTS_SQL).bind(code, `${code}${PREFIX_END}`, q, `${q}${PREFIX_END}`));
    kinds.push("client");
    stmts.push(db.prepare(CONTACTS_SQL).bind(lower, `${lower}${PREFIX_END}`));
    kinds.push("contact");
  }
  if (decide(role, "users.read") !== "deny") {
    stmts.push(db.prepare(USERS_SQL).bind(lower, `${lower}${PREFIX_END}`, `${escapeLike(q)}%`));
    kinds.push("user");
  }
  const results = stmts.length ? await db.batch<Record<string, string>>(stmts) : [];
  const groups: Group[] = kinds.map((type, i) => {
    const rows = results[i]?.results ?? [];
    if (type === "client")
      return {
        type,
        label: "Clients",
        items: rows.map((r) => ({
          id: r.id as string,
          title: `${r.code} ${r.display_name}`,
          subtitle: "Client",
          link: `/clients/${r.id}`,
        })),
      };
    if (type === "contact")
      return {
        type,
        label: "Contacts",
        items: rows.map((r) => ({
          id: r.id as string,
          title: r.name as string,
          subtitle: r.email as string,
          link: `/clients/${r.client_id}`,
        })),
      };
    return type === "lead"
      ? {
          type,
          label: "Leads",
          items: rows.map((r) => ({
            id: r.id as string,
            title: `${r.ref} ${r.contact_name}`,
            subtitle: r.contact_email as string,
            link: `/leads/${r.id}`,
          })),
        }
      : {
          type,
          label: "Staff",
          items: rows.map((r) => ({
            id: r.id as string,
            title: r.name as string,
            subtitle: `${r.email}, ${r.role}`,
            link: "/settings/users",
          })),
        };
  });
  return c.json({ q, groups });
});
