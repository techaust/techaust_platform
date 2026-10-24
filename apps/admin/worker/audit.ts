// The audit-log viewer's API [ADM-AUD-02, ADM-AUD-01]: newest first, keyset-paged (25 or 50), filtered by actor, entity type,
// action and an IST date range (a day is turned into UTC milliseconds here). The owner sees everything; the accountant
// sees the finance events only (the one list in `FINANCE_AUDIT_ACTIONS`) and not the network details. The CSV export is built
// in the browser from these pages. Read-only: the access log records the request.
import { sValidator } from "@hono/standard-validator";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { addDays, fromIst, parseIsoDate } from "@techaust/core/dates";
import { decide } from "@techaust/core/permissions";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err } from "./context.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";

const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const query = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  actor: z.optional(z.string().check(z.maxLength(80))),
  entity: z.optional(z.string().check(z.maxLength(60))),
  action: z.optional(z.string().check(z.maxLength(80))),
  from: z.optional(day),
  to: z.optional(day),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});

type Row = {
  id: string;
  at: number;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  ip: string | null;
  user_agent: string | null;
};

export const audit = new Hono<AppEnv>().get(
  "/",
  sValidator("query", query, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400))),
  async (c) => {
    const f = c.req.valid("query");
    const role = actor(c).role;
    const everything = decide(role, "audit.read") !== "deny";
    const limit = f.limit === "50" ? 50 : 25;
    const dir: Direction = f.before ? "before" : "after";
    const raw = f.before ?? f.after;
    const cur = raw === undefined ? null : decodeCursor(raw);
    if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);

    const where: string[] = [];
    const bind: unknown[] = [];
    const add = (sql: (n: number) => string, ...v: unknown[]) => {
      where.push(sql(bind.length + 1));
      bind.push(...v);
    };
    if (f.actor) add((n) => `a.actor_id = ?${n}`, f.actor);
    if (f.entity) add((n) => `a.entity_type = ?${n}`, f.entity);
    if (f.action) add((n) => `a.action = ?${n}`, f.action);
    for (const [key, value] of [
      ["from", f.from],
      ["to", f.to],
    ] as const) {
      if (value === undefined) continue;
      const d = parseIsoDate(value);
      if (!d) return err(c, BAD_REQUEST, 400);
      // A day in IST: from its first instant, up to (not including) the start of the next day.
      if (key === "from") add((n) => `a.at >= ?${n}`, fromIst(d));
      else add((n) => `a.at < ?${n}`, fromIst(addDays(d, 1)));
    }
    if (!everything) {
      // The accountant: finance events only.
      const marks = FINANCE_AUDIT_ACTIONS.map((_, i) => `?${bind.length + 1 + i}`).join(", ");
      where.push(`a.action IN (${marks})`);
      bind.push(...FINANCE_AUDIT_ACTIONS);
    }
    const order = keysetSql("a.at", "a.id", false, dir, bind.length + 1);
    if (cur) {
      where.push(order.where);
      bind.push(cur.k, cur.id);
    }
    const sql = `SELECT a.id, a.at, a.actor_type, a.actor_id, u.name AS actor_name, a.role, a.action, a.entity_type, a.entity_id, a.summary, a.ip, a.user_agent FROM audit_log a LEFT JOIN staff_users u ON u.id = a.actor_id${
      where.length ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY ${order.order} LIMIT ${limit + 1}`;
    const { results } = await c.env.DB.prepare(sql)
      .bind(...bind)
      .all<Row>();
    const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.at, id: r.id }));
    return c.json({
      entries: page.items.map((r) => ({
        id: r.id,
        at: r.at,
        actorType: r.actor_type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        role: r.role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        summary: r.summary ? JSON.parse(r.summary) : null,
        // Network details are for the owner (security reading); the accountant sees the finance events without them.
        ip: everything ? r.ip : null,
        userAgent: everything ? r.user_agent : null,
      })),
      next: page.next,
      prev: page.prev,
    });
  },
);
