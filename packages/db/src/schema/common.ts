// Shared column helpers and conventions (docs/05 §5.1):
// - IDs: UUIDv7 text (`uuidv7()` from core); seed rows use `stableId()`.
// - Time: INTEGER ms since the epoch, UTC. Calendar dates (IST) are TEXT "YYYY-MM-DD".
// - Money: INTEGER minor units + a currency column. Rates in basis points, quantities in milli-units,
//   FX as INR micros per USD.
import { type SQL, sql } from "drizzle-orm";
import { integer, type SQLiteColumn, text } from "drizzle-orm/sqlite-core";

/** Default for created_at/updated_at: the current time in UTC milliseconds, computed by SQLite. */
export const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const id = () => text("id").primaryKey();
export const createdAt = () => integer("created_at").notNull().default(nowMs);
export const updatedAt = () => integer("updated_at").notNull().default(nowMs);

export const CURRENCY_CODES = ["INR", "USD"] as const;
export const currency = (name = "currency") => text(name, { enum: CURRENCY_CODES }).notNull();

/** `column IN ('a', 'b')` for CHECK constraints (values are code constants, never user input). */
export const oneOf = (column: SQLiteColumn, values: readonly string[]): SQL =>
  sql`${column} in ${sql.raw(`(${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ")})`)}`;

/** A boolean stored as 0/1. */
export const flag = (name: string) => integer(name, { mode: "boolean" }).notNull().default(false);
