// The bell [ADM-G-09]: each member's own notifications, unread first, newest first, keyset-paged. The first event is
// "new lead" (the jobs Worker writes one row per member who may read leads, in the lead's own batch; wording in 07-H).
// Own rows only: another member's id is a 404. Marking read is a write, so it is audited like every mutation (ADM-G-06).
import { PREF_DEFAULTS, type PrefsRow, prefsOf } from "@techaust/core/notifications";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { body, param, query, STALE_VERSION } from "./http.ts";
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

const DIGEST_OWNER_ONLY: ApiError = {
  code: "digest_owner_only",
  message: "The weekly digest goes to owners only",
};

const prefsBodySchema = z.object({
  digestWeekly: z.optional(z.boolean()),
  offerViewed: z.optional(z.boolean()),
  paymentReceived: z.optional(z.boolean()),
  approvals: z.optional(z.boolean()),
  hookFailed: z.optional(z.boolean()),
  /** The `updatedAt` the screen read; null while the member has no row yet. */
  expectedUpdatedAt: z.nullable(z.number()),
});

type PrefsDbRow = PrefsRow & { digest_off_via: string | null; updated_at: number | null };

const readPrefs = (db: D1Database, userId: string) =>
  db
    .prepare(
      "SELECT digest_weekly, email_offer_viewed, email_payment_received, email_approvals, email_hook_failed, digest_off_via, updated_at FROM staff_notification_prefs WHERE user_id = ?1",
    )
    .bind(userId)
    .first<PrefsDbRow>();

/** The Notifications page's data: the switches (`prefsOf`: a missing row reads as the defaults; the digest only for owners), whether the digest applies, and the version. */
function prefsBody(row: PrefsDbRow | null, role: string) {
  return {
    prefs: prefsOf(row, role),
    digestAvailable: role === "owner",
    digestOffVia: row?.digest_off_via ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

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
  })

  // M7.2 (ADM-G-09; Q1 A, Q2 A; run file C.1, G1): the member's own email switches (Your account › Notifications). A missing row reads as the defaults.
  .get("/prefs", async (c) => {
    const u = actor(c);
    const row = await readPrefs(c.env.DB, u.id);
    return c.json(prefsBody(row, u.role));
  })

  .put("/prefs", body(prefsBodySchema), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    // L7: the digest goes to owners only; a non-owner can't switch it on (switching off is harmless and allowed).
    if (f.digestWeekly === true && u.role !== "owner") return err(c, DIGEST_OWNER_ONLY, 403);
    const db = c.env.DB;
    const row = await readPrefs(db, u.id);
    if ((row?.updated_at ?? null) !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const base = row ?? { ...PREF_DEFAULTS, digest_off_via: null, updated_at: null };
    const flag = (v: boolean | undefined, old: number) => (v === undefined ? old : v ? 1 : 0);
    const next = {
      digest_weekly: flag(f.digestWeekly, base.digest_weekly),
      email_offer_viewed: flag(f.offerViewed, base.email_offer_viewed),
      email_payment_received: flag(f.paymentReceived, base.email_payment_received),
      email_approvals: flag(f.approvals, base.email_approvals),
      email_hook_failed: flag(f.hookFailed, base.email_hook_failed),
    };
    // `digest_off_via` (trigger `staff_notification_prefs_values`): set only while the digest is off; switched off here it says `settings`, kept when unchanged.
    const offVia =
      next.digest_weekly === 1
        ? null
        : base.digest_weekly === 0
          ? (base.digest_off_via ?? "settings")
          : "settings";
    const now = Date.now();
    const done = await mutate(c, {
      // One upsert, guarded on the version read: no row yet and none expected, or the row still at that version.
      main: db
        .prepare(
          `INSERT INTO staff_notification_prefs (user_id, digest_weekly, email_offer_viewed, email_payment_received, email_approvals, email_hook_failed, digest_off_via, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
           WHERE (?9 IS NULL AND NOT EXISTS (SELECT 1 FROM staff_notification_prefs WHERE user_id = ?1))
              OR EXISTS (SELECT 1 FROM staff_notification_prefs WHERE user_id = ?1 AND updated_at = ?9)
           ON CONFLICT (user_id) DO UPDATE SET digest_weekly = excluded.digest_weekly, email_offer_viewed = excluded.email_offer_viewed,
             email_payment_received = excluded.email_payment_received, email_approvals = excluded.email_approvals, email_hook_failed = excluded.email_hook_failed,
             digest_off_via = excluded.digest_off_via, updated_at = max(excluded.updated_at, staff_notification_prefs.updated_at + 1)
           WHERE staff_notification_prefs.updated_at = ?9`,
        )
        .bind(
          u.id,
          next.digest_weekly,
          next.email_offer_viewed,
          next.email_payment_received,
          next.email_approvals,
          next.email_hook_failed,
          offVia,
          now,
          f.expectedUpdatedAt,
        ),
      action: "notification.prefs",
      entityType: "staff_user",
      entityId: u.id,
      summary: {
        digestWeekly: next.digest_weekly === 1,
        offerViewed: next.email_offer_viewed === 1,
        paymentReceived: next.email_payment_received === 1,
        approvals: next.email_approvals === 1,
        hookFailed: next.email_hook_failed === 1,
      },
    });
    if (!done) return err(c, STALE_VERSION, 409);
    return c.json(prefsBody(await readPrefs(db, u.id), u.role));
  });
