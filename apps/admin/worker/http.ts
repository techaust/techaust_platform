// Request helpers shared by the admin routes (M3.3): validators that answer in the API's error shape, the text schemas, the
// unique-constraint test and the stale-version error. One copy, so the bundle carries them once.
import { sValidator } from "@hono/standard-validator";
import * as z from "zod/mini";
import { type ApiError, BAD_REQUEST, type Ctx, err, NOT_FOUND } from "./context.ts";

type Schema = Parameters<typeof sValidator>[1];

/** `{ id }` in a path. */
export const idParam = z.object({ id: z.string().check(z.minLength(1), z.maxLength(64)) });

/** Path parameters that do not fit: 404 (the record cannot exist). */
export const param = <S extends Schema>(schema: S) =>
  sValidator("param", schema, (r, c) => (r.success ? undefined : err(c as Ctx, NOT_FOUND, 404)));
/** A JSON body or a query string that does not fit: 400. */
export const body = <S extends Schema>(schema: S) =>
  sValidator("json", schema, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));
export const query = <S extends Schema>(schema: S) =>
  sValidator("query", schema, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));

/** A required string: trimmed, 1 to `max` characters. */
export const text = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max));
/** An optional string that may be sent as null or empty (empty means none). */
export const optText = (max: number) => z.nullable(z.string().check(z.trim(), z.maxLength(max)));

/** True when D1 refused a write because `table.column` (as SQLite words it, e.g. `leads.ref`) is not unique. */
export const isUnique = (e: unknown, column: string) =>
  new RegExp(`UNIQUE constraint failed: ${column}`).test(String(e) + String((e as Error)?.cause ?? ""));

/** True when a trigger or a constraint refused a write with this text. */
export const refusedWith = (e: unknown, pattern: RegExp) =>
  pattern.test(String(e) + String((e as Error)?.cause ?? ""));

export const STALE_VERSION: ApiError = {
  code: "stale_version",
  message: "Someone else changed this record. Reload it and try again",
};

/** The look-ahead page size of the list routes: 25 (default) or 50. */
export const limitOf = (v: string | undefined) => (v === "50" ? 50 : 25);
