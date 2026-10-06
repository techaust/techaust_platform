// Settings and reference data (docs/05 §5.2). Tax and legal rules are settings with researched defaults
// (docs/08 §7.1, VERIFY WITH CA), never hard-coded.
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, flag, id, oneOf, updatedAt } from "./common.ts";
import { staffUsers } from "./identity.ts";

export const SETTING_KEYS = [
  "company",
  "tax",
  "numbering",
  "payment_terms",
  "email",
  "retention",
  "flags",
  "gateways",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** One JSON document per key, validated with zod in the app; every change is audit-logged (before/after). */
export const settings = sqliteTable(
  "settings",
  {
    key: text("key", { enum: SETTING_KEYS }).primaryKey(),
    value: text("value", { mode: "json" }).notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").references(() => staffUsers.id),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_key", oneOf(t.key, SETTING_KEYS))],
);

export const BANK_KINDS = ["INR", "USD_SWIFT"] as const;

/** Entered by the Owner in the admin only (ADM-SET-02); never seeded, never logged in plain text. */
export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: id(),
    kind: text("kind", { enum: BANK_KINDS }).notNull(),
    accountName: text("account_name").notNull(),
    accountNo: text("account_no").notNull(),
    ifsc: text("ifsc"),
    swift: text("swift"),
    bankName: text("bank_name").notNull(),
    branch: text("branch"),
    bankAddress: text("bank_address"),
    intermediary: text("intermediary"),
    active: flag("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("bank_accounts_kind", oneOf(t.kind, BANK_KINDS))],
);

/** Gap-free counters per document series and FY (docs/05 §5.4). A trigger stops next_no going down. */
export const docCounters = sqliteTable(
  "doc_counters",
  {
    series: text("series").notNull(),
    fy: text("fy").notNull(),
    nextNo: integer("next_no").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.series, t.fy] }),
    check("doc_counters_fy", sql`${t.fy} glob '[0-9][0-9][0-9][0-9]'`),
    check("doc_counters_next_no", sql`${t.nextNo} >= 1`),
  ],
);

export const TERMS_KINDS = ["proposal", "invoice", "website"] as const;

export const termsVersions = sqliteTable(
  "terms_versions",
  {
    id: id(),
    kind: text("kind", { enum: TERMS_KINDS }).notNull(),
    version: integer("version").notNull(),
    bodyMd: text("body_md").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("terms_versions_kind_version").on(t.kind, t.version),
    check("terms_versions_kind", oneOf(t.kind, TERMS_KINDS)),
  ],
);

export const FX_SOURCES = ["FBIL/RBI", "manual"] as const;

/** Reference FX rates (ADM-INV-08): INR micros per unit of the foreign currency. */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: id(),
    date: text("date").notNull(),
    pair: text("pair").notNull(),
    rateMicros: integer("rate_micros").notNull(),
    source: text("source", { enum: FX_SOURCES }).notNull(),
    enteredBy: text("entered_by").references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fx_rates_pair_date_source").on(t.pair, t.date, t.source),
    index("fx_rates_date").on(t.date),
    check("fx_rates_rate", sql`${t.rateMicros} > 0`),
    check("fx_rates_source", oneOf(t.source, FX_SOURCES)),
  ],
);
