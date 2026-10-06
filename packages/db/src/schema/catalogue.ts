// Service catalogue and templates (docs/05 §5.2, ADM-CAT). Documents snapshot their lines, so catalogue edits
// never change existing documents.
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, flag, id, oneOf, updatedAt } from "./common.ts";
import { staffUsers } from "./identity.ts";

export const CATEGORIES = ["advise", "build", "automate", "connect", "run"] as const;
export const UNITS = ["fixed", "milestone", "month", "hour", "workflow", "connector", "document"] as const;
export const SCHEDULE_TRIGGERS = ["on_accept", "milestone", "delivery", "monthly"] as const;

export type ScheduleStep = { label: string; pctBp: number; trigger: (typeof SCHEDULE_TRIGGERS)[number] };
export type DefaultLine = {
  description: string;
  unit: (typeof UNITS)[number];
  qtyMilli: number;
  rateInrMinor: number | null;
  rateUsdMinor: number | null;
};

export const catalogueItems = sqliteTable(
  "catalogue_items",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category", { enum: CATEGORIES }).notNull(),
    short: text("short").notNull(),
    longMd: text("long_md"),
    unit: text("unit", { enum: UNITS }).notNull(),
    /** "From" prices; null where a market isn't offered (e.g. S3 is India-only). */
    priceInrMinor: integer("price_inr_minor"),
    priceUsdMinor: integer("price_usd_minor"),
    /** SAC code, VERIFY WITH CA (docs/08 §7.1 G-2). */
    sac: text("sac").notNull(),
    gstRateBp: integer("gst_rate_bp"),
    defaultLines: text("default_lines", { mode: "json" }).$type<DefaultLine[]>(),
    deliverablesMd: text("deliverables_md"),
    assumptionsMd: text("assumptions_md"),
    exclusionsMd: text("exclusions_md"),
    schedule: text("schedule", { mode: "json" }).$type<ScheduleStep[]>().notNull(),
    slug: text("slug"),
    showOnSite: flag("show_on_site"),
    active: flag("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("catalogue_items_code").on(t.code),
    uniqueIndex("catalogue_items_slug").on(t.slug).where(sql`${t.slug} is not null`),
    check("catalogue_items_category", oneOf(t.category, CATEGORIES)),
    check("catalogue_items_unit", oneOf(t.unit, UNITS)),
    check("catalogue_items_sac", sql`${t.sac} glob '[0-9][0-9][0-9][0-9][0-9][0-9]'`),
    check(
      "catalogue_items_prices",
      sql`coalesce(${t.priceInrMinor}, 0) >= 0 and coalesce(${t.priceUsdMinor}, 0) >= 0`,
    ),
  ],
);

/** Append-only (trigger): who changed which price, when (ADM-CAT-04). */
export const cataloguePriceHistory = sqliteTable(
  "catalogue_price_history",
  {
    id: id(),
    itemId: text("item_id")
      .notNull()
      .references(() => catalogueItems.id),
    field: text("field").notNull(),
    oldMinor: integer("old_minor"),
    newMinor: integer("new_minor"),
    changedBy: text("changed_by").references(() => staffUsers.id),
    changedAt: createdAt(),
  },
  (t) => [index("catalogue_price_history_item").on(t.itemId, t.changedAt)],
);

export const TEMPLATE_KINDS = ["proposal", "estimate", "care_block", "terms_block"] as const;

export const templates = sqliteTable(
  "templates",
  {
    id: id(),
    category: text("category", { enum: CATEGORIES }),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    version: integer("version").notNull(),
    body: text("body", { mode: "json" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("templates_kind_category_version").on(t.kind, t.category, t.version),
    check("templates_kind", oneOf(t.kind, TEMPLATE_KINDS)),
  ],
);

/** Public catalogue snapshots for the website build (ADM-CAT-05): public fields only. */
export const siteSnapshots = sqliteTable(
  "site_snapshots",
  {
    id: id(),
    sha256: text("sha256").notNull(),
    json: text("json").notNull(),
    publishedBy: text("published_by").references(() => staffUsers.id),
    publishedAt: createdAt(),
  },
  (t) => [index("site_snapshots_published").on(t.publishedAt)],
);
