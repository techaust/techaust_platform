// Catalogue, templates and publishing (M4.1, ADM-CAT-01..05; the website reads the published snapshot: WEB-G-07, WEB-SVC-05).
// Every route is a row of ROUTES (guard.ts); every change is ONE batch through `mutate`.
//
// - An item is retired by deactivating it, never deleted (trigger `catalogue_items_no_delete`); its code never changes.
// - A price change writes its `catalogue_price_history` rows in the SAME batch as the update, as side statements guarded by the
//   audit row, which is written only if the update changed a row: a refused update leaves no history.
// - Templates and snapshots are append-only (triggers): an edit of a template is a new version.
// - Publishing builds the public snapshot from the rows (public fields only, `snapshotFromRows`), validates it with the zod/mini
//   twin (the classic schema may not be in this Worker), and stores it once per SHA-256 of its canonical JSON.
// Audit rows hold ids, codes and field names only.
import {
  CATALOGUE_CATEGORIES,
  type CatalogueRow,
  canonicalJson,
  createEntry,
  createTemplate,
  type PricedEntry,
  parseSnapshot,
  patchEntry,
  priceChanges,
  sha256Hex,
  snapshotFromRows,
  unknownPlaceholders,
} from "@techaust/core/catalogue";
import { joinedPastLimit } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { type SiteGap, siteGaps } from "@techaust/core/site-references";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
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
import { body, idParam, isUnique, limitOf, param, query, refusedWith, STALE_VERSION } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, PREFIX_END, pageOf } from "./keyset.ts";

// ---- errors ----------------------------------------------------------------------------------------------------------

const CODE_IN_USE: ApiError = {
  code: "code_in_use",
  message: "A catalogue item with that code already exists",
};
const SLUG_IN_USE: ApiError = {
  code: "slug_in_use",
  message: "Another catalogue item uses that website address",
};
const UNKNOWN_PLACEHOLDER: ApiError = {
  code: "unknown_placeholder",
  message: "The template uses a placeholder that does not exist",
};
const TEMPLATE_JOINED_TOO_LONG: ApiError = {
  code: "template_joined_too_long",
  message:
    "A draft has room for 3 sections of the template's own; the ones after that are joined into the third, and together they pass 6,000 characters",
};
const TEMPLATE_CATEGORY: ApiError = {
  code: "template_category",
  message: "Proposals and estimates need a category; care plan and terms blocks have none",
};
const VERSION_RACE: ApiError = {
  code: "conflict",
  message: "Someone saved a new version at the same moment. Reload and try again",
};
const SNAPSHOT_INVALID: ApiError = {
  code: "snapshot_invalid",
  message: "The catalogue cannot be published yet. Fix the items listed",
};

/** A gap as the API names it: the service code and what is missing, never a value. */
const needOf = (g: SiteGap) =>
  g.kind === "service"
    ? { code: g.code, missing: "service" as const }
    : g.kind === "price"
      ? { code: g.code, missing: "price" as const, currency: g.currency }
      : {
          code: g.code,
          missing: "line" as const,
          line: g.word,
          currency: g.currency,
          ambiguous: g.ambiguous,
        };

// ---- rows and views ----------------------------------------------------------------------------------------------------

const COLS =
  "id, code, name, category, short, long_md, unit, price_inr_minor, price_usd_minor, sac, gst_rate_bp, default_lines, deliverables_md, assumptions_md, exclusions_md, schedule, slug, show_on_site, active, created_at, updated_at";
const LIST_COLS =
  "id, code, name, category, short, unit, price_inr_minor, price_usd_minor, slug, show_on_site, active, updated_at";
/** The numeric part of the code: S2 before S10. Items are few, so the sort needs no index; every filter has one. */
const CODE_NUMBER = "CAST(substr(code, 2) AS INTEGER)";

type ItemRow = {
  id: string;
  code: string;
  name: string;
  category: string;
  short: string;
  long_md: string | null;
  unit: string;
  price_inr_minor: number | null;
  price_usd_minor: number | null;
  sac: string;
  gst_rate_bp: number | null;
  default_lines: string | null;
  deliverables_md: string | null;
  assumptions_md: string | null;
  exclusions_md: string | null;
  schedule: string;
  slug: string | null;
  show_on_site: number;
  active: number;
  created_at: number;
  updated_at: number;
};
type ListItemRow = Pick<
  ItemRow,
  | "id"
  | "code"
  | "name"
  | "category"
  | "short"
  | "unit"
  | "price_inr_minor"
  | "price_usd_minor"
  | "slug"
  | "show_on_site"
  | "active"
  | "updated_at"
> & { k: number };

const listView = (r: ListItemRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  category: r.category,
  short: r.short,
  unit: r.unit,
  priceInrMinor: r.price_inr_minor,
  priceUsdMinor: r.price_usd_minor,
  slug: r.slug,
  showOnSite: Boolean(r.show_on_site),
  active: Boolean(r.active),
  updatedAt: r.updated_at,
});

const jsonOr = (s: string | null) => (s === null ? null : JSON.parse(s));

/** The full item (internal fields too: every role may read the catalogue, ADM-CAT permissions in 04 §9). */
export const itemView = (r: ItemRow) => ({
  ...listView({ ...r, k: 0 }),
  longMd: r.long_md,
  sac: r.sac,
  gstRateBp: r.gst_rate_bp,
  defaultLines: jsonOr(r.default_lines),
  deliverablesMd: r.deliverables_md,
  assumptionsMd: r.assumptions_md,
  exclusionsMd: r.exclusions_md,
  schedule: jsonOr(r.schedule),
  createdAt: r.created_at,
});

const pricedOf = (r: ItemRow): PricedEntry => ({
  priceInrMinor: r.price_inr_minor,
  priceUsdMinor: r.price_usd_minor,
  defaultLines: jsonOr(r.default_lines),
});

/** Empty or blank text is none. */
const norm = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

// ---- queries ---------------------------------------------------------------------------------------------------------------

const flagParam = z.enum(["1", "0"]);
const listQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  category: z.optional(z.enum(CATALOGUE_CATEGORIES)),
  active: z.optional(flagParam),
  onSite: z.optional(flagParam),
  q: z.optional(z.string().check(z.maxLength(100))),
  after: z.optional(z.string().check(z.maxLength(400))),
  before: z.optional(z.string().check(z.maxLength(400))),
});
const pageQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});
const activeRequest = z.strictObject({ active: z.boolean() });

/** Prefix match on the code (unique index) and on the name without case (`catalogue_items_name_nocase`), each its own index range. */
export const CATALOGUE_SEARCH_SQL = (at: number) =>
  `id IN (SELECT id FROM catalogue_items WHERE code >= ?${at} AND code < ?${at + 1} UNION SELECT id FROM catalogue_items WHERE name COLLATE NOCASE >= ?${at + 2} AND name COLLATE NOCASE < ?${at + 3})`;

const listItems = async (c: Ctx, f: z.infer<typeof listQuery>) => {
  const limit = limitOf(f.limit);
  const dir: Direction = f.before ? "before" : "after";
  const raw = f.before ?? f.after;
  const cur = raw === undefined ? null : decodeCursor(raw);
  if (raw !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const where: string[] = [];
  const bind: unknown[] = [];
  if (f.category) where.push(`category = ?${bind.push(f.category)}`);
  if (f.active) where.push(`active = ?${bind.push(Number(f.active))}`);
  if (f.onSite) where.push(`show_on_site = ?${bind.push(Number(f.onSite))}`);
  const q = f.q?.trim();
  if (q && q.length >= 1) {
    const at = bind.length + 1;
    where.push(CATALOGUE_SEARCH_SQL(at));
    bind.push(q.toUpperCase(), `${q.toUpperCase()}${PREFIX_END}`, q, `${q}${PREFIX_END}`);
  }
  const order = keysetSql(CODE_NUMBER, "id", true, dir, bind.length + 1);
  if (cur) {
    where.push(order.where);
    bind.push(cur.k, cur.id);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ${LIST_COLS}, ${CODE_NUMBER} AS k FROM catalogue_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
  )
    .bind(...bind)
    .all<ListItemRow>();
  const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.k, id: r.id }));
  return c.json({ items: page.items.map(listView), next: page.next, prev: page.prev });
};

// ---- the routes ------------------------------------------------------------------------------------------------------------

type HistoryRow = {
  id: string;
  field: string;
  old_minor: number | null;
  new_minor: number | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: number;
};

export const catalogue = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listItems(c, c.req.valid("query")))

  // The last 20 published snapshots. Registered before `/:id`.
  .get("/snapshots", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT s.id, s.sha256, s.published_by, (SELECT name FROM staff_users WHERE id = s.published_by) AS published_by_name, s.created_at AS published_at, length(s.json) AS bytes FROM site_snapshots s ORDER BY s.created_at DESC, s.id DESC LIMIT 20",
    ).all<{
      id: string;
      sha256: string;
      published_by: string | null;
      published_by_name: string | null;
      published_at: number;
      bytes: number;
    }>();
    return c.json({
      snapshots: results.map((r, i) => ({
        id: r.id,
        sha256: r.sha256,
        publishedBy: r.published_by,
        publishedByName: r.published_by_name,
        publishedAt: r.published_at,
        bytes: r.bytes,
        latest: i === 0,
      })),
    });
  })

  // ---- publish (ADM-CAT-05): build, validate, store once per SHA-256 ----
  .post("/publish", async (c) => {
    const db = c.env.DB;
    const [items, setting] = await db.batch([
      db.prepare(
        "SELECT id, code, name, slug, category, unit, price_inr_minor, price_usd_minor, schedule, default_lines, show_on_site, active FROM catalogue_items",
      ),
      db.prepare("SELECT value FROM settings WHERE key = 'payment_terms'"),
    ]);
    const terms = (setting?.results[0] as { value: string } | undefined)?.value;
    const built = snapshotFromRows(
      (items?.results ?? []) as CatalogueRow[],
      terms ? JSON.parse(terms) : null,
    );
    const parsed = parseSnapshot(built);
    if (!parsed.ok)
      return c.json(
        {
          error: { code: SNAPSHOT_INVALID.code, message: SNAPSHOT_INVALID.message },
          paths: parsed.paths.slice(0, 20),
          request_id: c.var.rid,
        },
        422,
      );
    // The website's build throws on a price it prints that is missing, and so would every later staging deploy. So a snapshot
    // that lacks something the pages use (core's SITE_REFERENCES) is refused here, not stored (review finding 2). The paths are
    // codes (`items.S7`, `items.S11.lines.setup`), never values; `needs` says the same in a form the screen can word.
    const gaps = siteGaps(parsed.data.items);
    // The service's id (when it exists at all) lets the screen link straight to it: a search for "S1" also lists S10 to S18.
    const idOf = new Map(
      ((items?.results ?? []) as { id: string; code: string }[]).map((r) => [r.code, r.id]),
    );
    if (gaps.length)
      return c.json(
        {
          error: { code: SNAPSHOT_INVALID.code, message: SNAPSHOT_INVALID.message },
          paths: gaps.map((g) => g.path),
          needs: gaps.map((g) => {
            const n = needOf(g);
            return { ...n, id: idOf.get(n.code) ?? null };
          }),
          request_id: c.var.rid,
        },
        422,
      );
    const json = canonicalJson(parsed.data);
    const sha256 = await sha256Hex(json);
    const id = uuidv7();
    const done = await mutate(c, {
      main: db
        .prepare(
          "INSERT INTO site_snapshots (id, sha256, json, published_by) SELECT ?1, ?2, ?3, ?4 WHERE ?2 IS NOT (SELECT sha256 FROM site_snapshots ORDER BY created_at DESC, id DESC LIMIT 1)",
        )
        .bind(id, sha256, json, actor(c).id),
      action: "catalogue.publish",
      entityType: "site_snapshot",
      entityId: id,
      summary: { snapshotId: id, sha256, items: parsed.data.items.length },
      status: 201,
    });
    if (done) return c.json({ sha256, unchanged: false, id, items: parsed.data.items.length }, 201);
    // Not stored: the newest snapshot already has this SHA. Republishing an older price list stores a new row (lead, 2026-10-25),
    // so the website can go back to it.
    return c.json({ sha256, unchanged: true });
  })

  .post("/", body(createEntry), async (c) => {
    const f = c.req.valid("json");
    const id = uuidv7();
    try {
      const done = await mutate(c, {
        main: c.env.DB.prepare(
          `INSERT INTO catalogue_items (id, code, name, category, short, long_md, unit, price_inr_minor, price_usd_minor, sac, gst_rate_bp, default_lines, deliverables_md, assumptions_md, exclusions_md, schedule, slug, show_on_site, active)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`,
        ).bind(
          id,
          f.code,
          f.name,
          f.category,
          f.short,
          norm(f.longMd),
          f.unit,
          f.priceInrMinor,
          f.priceUsdMinor,
          f.sac,
          f.gstRateBp,
          f.defaultLines === null ? null : JSON.stringify(f.defaultLines),
          norm(f.deliverablesMd),
          norm(f.assumptionsMd),
          norm(f.exclusionsMd),
          JSON.stringify(f.schedule),
          f.slug,
          f.showOnSite ? 1 : 0,
          f.active === false ? 0 : 1,
        ),
        action: "catalogue.create",
        entityType: "catalogue_item",
        entityId: id,
        summary: { itemId: id, itemCode: f.code },
        status: 201,
      });
      if (!done) return err(c, BAD_REQUEST, 400);
    } catch (e) {
      if (isUnique(e, "catalogue_items.code")) return err(c, CODE_IN_USE, 409);
      if (isUnique(e, "catalogue_items.slug")) return err(c, SLUG_IN_USE, 409);
      throw e;
    }
    return c.json({ ok: true, id, code: f.code }, 201);
  })

  .get("/:id", param(idParam), query(pageQuery), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("query");
    const limit = limitOf(f.limit);
    const cur = f.after === undefined ? null : decodeCursor(f.after);
    if (f.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const order = keysetSql("h.created_at", "h.id", false, "after", 2);
    const [item, history] = await db.batch([
      db.prepare(`SELECT ${COLS} FROM catalogue_items WHERE id = ?1`).bind(id),
      db
        .prepare(
          `SELECT h.id, h.field, h.old_minor, h.new_minor, h.changed_by, (SELECT name FROM staff_users WHERE id = h.changed_by) AS changed_by_name, h.created_at AS changed_at
           FROM catalogue_price_history h WHERE h.item_id = ?1${cur ? ` AND ${order.where}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
        )
        .bind(...(cur ? [id, cur.k, cur.id] : [id])),
    ]);
    const row = item?.results[0] as ItemRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const page = pageOf((history?.results ?? []) as HistoryRow[], limit, "after", cur !== null, (r) => ({
      k: r.changed_at,
      id: r.id,
    }));
    return c.json({
      item: itemView(row),
      history: {
        items: page.items.map((h) => ({
          id: h.id,
          field: h.field,
          oldMinor: h.old_minor,
          newMinor: h.new_minor,
          changedBy: h.changed_by,
          changedByName: h.changed_by_name,
          changedAt: h.changed_at,
        })),
        next: page.next,
      },
    });
  })

  .patch("/:id", param(idParam), body(patchEntry), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(`SELECT ${COLS} FROM catalogue_items WHERE id = ?1`)
      .bind(id)
      .first<ItemRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);

    // [name, column, the stored value, the new value]; undefined = not sent. JSON fields compare by canonical text.
    const asJson = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
    const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
    const wanted: [string, string, unknown, unknown, unknown][] = [
      ["name", "name", row.name, f.name, f.name],
      ["category", "category", row.category, f.category, f.category],
      ["short", "short", row.short, f.short, f.short],
      ["longMd", "long_md", row.long_md, f.longMd === undefined ? undefined : norm(f.longMd), undefined],
      ["unit", "unit", row.unit, f.unit, f.unit],
      ["priceInrMinor", "price_inr_minor", row.price_inr_minor, f.priceInrMinor, f.priceInrMinor],
      ["priceUsdMinor", "price_usd_minor", row.price_usd_minor, f.priceUsdMinor, f.priceUsdMinor],
      ["sac", "sac", row.sac, f.sac, f.sac],
      ["gstRateBp", "gst_rate_bp", row.gst_rate_bp, f.gstRateBp, f.gstRateBp],
      ["defaultLines", "default_lines", jsonOr(row.default_lines), f.defaultLines, asJson(f.defaultLines)],
      [
        "deliverablesMd",
        "deliverables_md",
        row.deliverables_md,
        f.deliverablesMd === undefined ? undefined : norm(f.deliverablesMd),
        undefined,
      ],
      [
        "assumptionsMd",
        "assumptions_md",
        row.assumptions_md,
        f.assumptionsMd === undefined ? undefined : norm(f.assumptionsMd),
        undefined,
      ],
      [
        "exclusionsMd",
        "exclusions_md",
        row.exclusions_md,
        f.exclusionsMd === undefined ? undefined : norm(f.exclusionsMd),
        undefined,
      ],
      ["schedule", "schedule", jsonOr(row.schedule), f.schedule, asJson(f.schedule)],
      ["slug", "slug", row.slug, f.slug, f.slug],
      ["showOnSite", "show_on_site", Boolean(row.show_on_site), f.showOnSite, f.showOnSite ? 1 : 0],
    ];
    // The value to store: the normalised text for the markdown fields (the fifth slot is undefined for them), else the fifth slot.
    const changes = wanted
      .filter(([, , stored, next]) => next !== undefined && !same(stored, next))
      .map(([name, col, , next, store]) => ({ name, col, value: store === undefined ? next : store }));
    if (!changes.length) return c.json({ ok: true, changed: false, updatedAt: row.updated_at });

    // The prices as they would be: what was sent over what is stored. The history rows are written with the update, below.
    const after: PricedEntry = {
      priceInrMinor: f.priceInrMinor === undefined ? row.price_inr_minor : f.priceInrMinor,
      priceUsdMinor: f.priceUsdMinor === undefined ? row.price_usd_minor : f.priceUsdMinor,
      defaultLines: f.defaultLines === undefined ? jsonOr(row.default_lines) : f.defaultLines,
    };
    const history = priceChanges(pricedOf(row), after);
    const t = Date.now();
    const actorId = actor(c).id;
    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE catalogue_items SET ${changes.map((ch, i) => `${ch.col} = ?${i + 4}`).join(", ")}, updated_at = ?3 WHERE id = ?1 AND updated_at = ?2`,
          )
          .bind(id, f.expectedUpdatedAt, t, ...changes.map((ch) => ch.value as string | number | null)),
        action: "catalogue.update",
        entityType: "catalogue_item",
        entityId: id,
        summary: {
          itemId: id,
          itemCode: row.code,
          changed: changes.map((ch) => ch.name),
          priceChanges: history.length,
        },
        side: (g) =>
          history.map((h) =>
            db
              .prepare(
                `INSERT INTO catalogue_price_history (id, item_id, field, old_minor, new_minor, changed_by, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ${g.sql(8)}`,
              )
              .bind(uuidv7(), id, h.field, h.oldMinor, h.newMinor, actorId, t, ...g.params),
          ),
      });
    } catch (e) {
      if (isUnique(e, "catalogue_items.slug")) return err(c, SLUG_IN_USE, 409);
      throw e;
    }
    if (!done) {
      const again = await db.prepare("SELECT 1 AS x FROM catalogue_items WHERE id = ?1").bind(id).first();
      return again ? err(c, STALE_VERSION, 409) : err(c, NOT_FOUND, 404);
    }
    return c.json({ ok: true, changed: true, updatedAt: t });
  })

  // Retire or bring back (never a delete). The audit action is `catalogue.activate` or `catalogue.deactivate`.
  .post("/:id/active", param(idParam), body(activeRequest), async (c) => {
    const { id } = c.req.valid("param");
    const { active } = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare("SELECT code, active FROM catalogue_items WHERE id = ?1")
      .bind(id)
      .first<{ code: string; active: number }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (Boolean(row.active) === active) return c.json({ ok: true, changed: false });
    const t = Date.now();
    const done = await mutate(c, {
      main: db
        .prepare("UPDATE catalogue_items SET active = ?2, updated_at = ?3 WHERE id = ?1 AND active != ?2")
        .bind(id, active ? 1 : 0, t),
      action: active ? "catalogue.activate" : "catalogue.deactivate",
      entityType: "catalogue_item",
      entityId: id,
      summary: { itemId: id, itemCode: row.code },
    });
    return c.json({ ok: true, changed: done, updatedAt: done ? t : undefined });
  });

// ---- templates (ADM-CAT-03) --------------------------------------------------------------------------------------------------

const templateListQuery = z.object({
  limit: z.optional(z.enum(["25", "50"])),
  kind: z.optional(z.enum(["proposal", "estimate", "care_block", "terms_block"])),
  category: z.optional(z.enum(CATALOGUE_CATEGORIES)),
  history: z.optional(z.literal("1")),
  after: z.optional(z.string().check(z.maxLength(400))),
});

type TemplateRow = {
  id: string;
  category: string | null;
  kind: string;
  version: number;
  body: string;
  created_at: number;
  saved_by_name: string | null;
};

/**
 * Who saved a version: templates have no author column, so it is the actor of the version's own `template.version` audit row
 * (index `audit_log_entity`). Seeded versions have none (null). For the screens' "Version {n}, saved by {person}" line (07-L).
 */
const SAVED_BY = (t: string) =>
  `(SELECT u.name FROM audit_log a JOIN staff_users u ON u.id = a.actor_id WHERE a.entity_type = 'template' AND a.entity_id = ${t}.id AND a.action = 'template.version' LIMIT 1) AS saved_by_name`;

const templateMeta = (r: Omit<TemplateRow, "body">) => ({
  id: r.id,
  kind: r.kind,
  category: r.category,
  version: r.version,
  createdAt: r.created_at,
  savedByName: r.saved_by_name,
});

const BLOCK_KINDS = ["care_block", "terms_block"];

export const templates = new Hono<AppEnv>()
  // The newest version of each kind and category (all versions with `history=1`).
  .get("/", query(templateListQuery), async (c) => {
    const f = c.req.valid("query");
    const limit = limitOf(f.limit);
    const cur = f.after === undefined ? null : decodeCursor(f.after);
    if (f.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
    const where: string[] = [];
    const bind: unknown[] = [];
    if (f.kind) where.push(`t.kind = ?${bind.push(f.kind)}`);
    if (f.category) where.push(`t.category = ?${bind.push(f.category)}`);
    if (!f.history)
      where.push(
        "t.version = (SELECT max(version) FROM templates WHERE kind = t.kind AND coalesce(category, '') = coalesce(t.category, ''))",
      );
    const order = keysetSql("t.created_at", "t.id", false, "after", bind.length + 1);
    if (cur) {
      where.push(order.where);
      bind.push(cur.k, cur.id);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, t.category, t.kind, t.version, t.created_at, ${SAVED_BY("t")} FROM templates t${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order.order} LIMIT ${limit + 1}`,
    )
      .bind(...bind)
      .all<Omit<TemplateRow, "body">>();
    const page = pageOf(results, limit, "after", cur !== null, (r) => ({ k: r.created_at, id: r.id }));
    return c.json({ templates: page.items.map(templateMeta), next: page.next });
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT t.id, t.category, t.kind, t.version, t.body, t.created_at, ${SAVED_BY("t")} FROM templates t WHERE t.id = ?1`,
      )
      .bind(id)
      .first<TemplateRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    const { results } = await db
      .prepare(
        `SELECT t.id, t.category, t.kind, t.version, t.created_at, ${SAVED_BY("t")} FROM templates t WHERE t.kind = ?1 AND coalesce(t.category, '') = coalesce(?2, '') ORDER BY t.version DESC LIMIT 50`,
      )
      .bind(row.kind, row.category)
      .all<Omit<TemplateRow, "body">>();
    return c.json({
      template: { ...templateMeta(row), body: JSON.parse(row.body) },
      versions: results.map(templateMeta),
    });
  })

  // An edit is a new version of the same kind and category; the earlier versions stay (documents may point at them).
  .post("/", body(createTemplate), async (c) => {
    const f = c.req.valid("json");
    const isBlock = BLOCK_KINDS.includes(f.kind);
    if (isBlock !== (f.category === null)) return err(c, TEMPLATE_CATEGORY, 400);
    if (unknownPlaceholders(f.body).length) return err(c, UNKNOWN_PLACEHOLDER, 400);
    // A draft joins the custom sections past the third into the third (`sectionsFromTemplate`): a template whose joined text would pass
    // a section's 6,000 characters would make drafts every save refuses, so it is refused here, naming the sections (0-based) joined
    // (FX-3 round 3, lead's answer to round 2 Q2, docs/13 2026-10-29). Care plan and terms blocks are never made into drafts.
    const joined = isBlock ? [] : joinedPastLimit(f.body.sections);
    if (joined.length)
      return c.json(
        {
          error: { code: TEMPLATE_JOINED_TOO_LONG.code, message: TEMPLATE_JOINED_TOO_LONG.message },
          sections: joined,
          request_id: c.var.rid,
        },
        400,
      );
    const db = c.env.DB;
    const id = uuidv7();
    try {
      const done = await mutate(c, {
        main: db
          .prepare(
            `INSERT INTO templates (id, category, kind, version, body)
             SELECT ?1, ?2, ?3, coalesce(max(version), 0) + 1, ?4 FROM templates WHERE kind = ?3 AND coalesce(category, '') = coalesce(?2, '')`,
          )
          .bind(id, f.category, f.kind, JSON.stringify(f.body)),
        action: "template.version",
        entityType: "template",
        entityId: id,
        summary: { templateId: id, kind: f.kind, category: f.category },
        status: 201,
      });
      if (!done) return err(c, BAD_REQUEST, 400);
    } catch (e) {
      // Two saves at the same moment took the same version number; the unique index refused the second.
      if (isUnique(e, "templates.kind") || refusedWith(e, /templates_kind_category_version_coalesced/))
        return err(c, VERSION_RACE, 409);
      throw e;
    }
    const row = await db
      .prepare("SELECT version FROM templates WHERE id = ?1")
      .bind(id)
      .first<{ version: number }>();
    return c.json({ ok: true, id, version: row?.version }, 201);
  });
