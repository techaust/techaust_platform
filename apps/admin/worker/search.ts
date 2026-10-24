// Global search [ADM-G-05]: one box over what exists today and what the role may read: staff (owner only, `users.read`) and
// leads (`leads.read`: by reference or the start of the contact's email). At most five per type; prefix matches as index
// ranges (`leads_ref`, `leads_email`, `staff_users_email`), never a table scan of a big table. Clients, contacts, projects and
// documents join as their milestones create them (M3.2 and later). Read-only, so no audit row (the access log has the request).
import { sValidator } from "@hono/standard-validator";
import { decide } from "@techaust/core/permissions";
import { escapeLike } from "@techaust/core/text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err } from "./context.ts";
import { PREFIX_END } from "./keyset.ts";

const query = z.object({ q: z.string().check(z.maxLength(100)) });
const PER_TYPE = 5;
const MIN_CHARS = 2;

type Item = { id: string; title: string; subtitle: string; link: string };
type Group = { type: "user" | "lead"; label: string; items: Item[] };

/** The two reads, exported so a test can EXPLAIN them: leads by the start of the reference or the email (index ranges), staff by email range or name. */
export const LEADS_SQL = `SELECT id, ref, contact_name, contact_email FROM leads WHERE (ref >= ?1 AND ref < ?2) OR (contact_email >= ?3 AND contact_email < ?4) ORDER BY ref LIMIT ${PER_TYPE}`;
export const USERS_SQL = `SELECT id, name, email, role FROM staff_users WHERE (email >= ?1 AND email < ?2) OR name LIKE ?3 ESCAPE '\\' ORDER BY name LIMIT ${PER_TYPE}`;

export const search = new Hono<AppEnv>().get(
  "/",
  sValidator("query", query, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400))),
  async (c) => {
    const q = c.req.valid("query").q.trim();
    if (q.length < MIN_CHARS) return c.json({ q, groups: [] satisfies Group[] });
    const role = actor(c).role;
    const db = c.env.DB;
    const lower = q.toLowerCase();
    const stmts: D1PreparedStatement[] = [];
    const kinds: Group["type"][] = [];
    if (decide(role, "leads.read") !== "deny") {
      const ref = q.toUpperCase();
      stmts.push(db.prepare(LEADS_SQL).bind(ref, `${ref}${PREFIX_END}`, lower, `${lower}${PREFIX_END}`));
      kinds.push("lead");
    }
    if (decide(role, "users.read") !== "deny") {
      stmts.push(db.prepare(USERS_SQL).bind(lower, `${lower}${PREFIX_END}`, `${escapeLike(q)}%`));
      kinds.push("user");
    }
    const results = stmts.length ? await db.batch<Record<string, string>>(stmts) : [];
    const groups: Group[] = kinds.map((type, i) => {
      const rows = results[i]?.results ?? [];
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
  },
);
