// The bell [ADM-G-09]: each member's own notifications, unread first, newest first, keyset-paged. The first event is
// "new lead" (the jobs Worker writes one row per member who may read leads, in the lead's own batch; wording in 07-H).
// Own rows only: another member's id is a 404. Marking read is a write, so it is audited like every mutation (ADM-G-06).
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { param, query } from "./http.ts";
import { type Cursor, decodeCursor, encodeCursor } from "./keyset.ts";

type Row = {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  title: string;
  link: string;
  read_at: number | null;
  created_at: number;
};

const listQuery = z.object({
  limit: z.optional(z.enum(["10", "20", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});
const idParam = z.object({ id: z.string().check(z.minLength(1), z.maxLength(80)) });

/** The list order is (unread before read, newest first); the cursor carries the read flag with the time: "0:1760000000000". */
const cursorOf = (r: Row): Cursor => ({ k: `${r.read_at === null ? 0 : 1}:${r.created_at}`, id: r.id });

export const notifications = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const q = c.req.valid("query");
    const limit = Number(q.limit ?? "20");
    const u = actor(c);
    const db = c.env.DB;
    let where = "";
    const bind: unknown[] = [u.id];
    if (q.after !== undefined) {
      const cur = decodeCursor(q.after);
      const m = cur && /^([01]):(\d{1,16})$/.exec(String(cur.k));
      if (!cur || !m) return err(c, BAD_REQUEST, 400);
      where =
        " AND ((read_at IS NOT NULL) > ?2 OR ((read_at IS NOT NULL) = ?2 AND (created_at, id) < (?3, ?4)))";
      bind.push(Number(m[1]), Number(m[2]), cur.id);
    }
    const [list, unread] = await db.batch<Row & { n: number }>([
      db
        .prepare(
          `SELECT id, kind, entity_type, entity_id, title, link, read_at, created_at FROM notifications WHERE user_id = ?1${where} ORDER BY (read_at IS NOT NULL), created_at DESC, id DESC LIMIT ${limit + 1}`,
        )
        .bind(...bind),
      db.prepare("SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL").bind(u.id),
    ]);
    const rows = list?.results ?? [];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return c.json({
      notifications: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        link: r.link,
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
      unread: unread?.results[0]?.n ?? 0,
      next: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null,
    });
  })

  .post("/:id/read", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    const done = await mutate(c, {
      main: c.env.DB.prepare(
        "UPDATE notifications SET read_at = ?1 WHERE id = ?2 AND user_id = ?3 AND read_at IS NULL",
      ).bind(Date.now(), id, u.id),
      action: "notification.read",
      entityType: "notification",
      entityId: id,
    });
    if (done) return c.json({ ok: true });
    // Nothing changed: already read (fine), or not this member's / not there (404, the same answer for both).
    const own = await c.env.DB.prepare("SELECT 1 AS x FROM notifications WHERE id = ?1 AND user_id = ?2")
      .bind(id, u.id)
      .first();
    return own ? c.json({ ok: true }) : err(c, NOT_FOUND, 404);
  })

  .post("/read-all", async (c) => {
    const u = actor(c);
    await mutate(c, {
      main: c.env.DB.prepare(
        "UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND read_at IS NULL",
      ).bind(Date.now(), u.id),
      action: "notification.read_all",
      entityType: "staff_user",
      entityId: u.id,
    });
    return c.json({ ok: true });
  });
