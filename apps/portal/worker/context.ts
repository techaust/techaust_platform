// Shared types and helpers of the portal API: the Hono environment, error bodies that carry the request ID, and the
// request facts every log row needs. The same shapes as the admin API (docs/05 §7.1), with a different realm.
import { addressOf } from "@techaust/auth";
import { type AccessEntry, accessStmt } from "@techaust/db/log";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ClientScope } from "./scope.ts";
import type { MagicLinkSender } from "./sender.ts";

export type RouteDef = {
  method: "GET" | "POST";
  /** The full Hono pattern, e.g. `/api/v1/me`. */
  path: string;
  /**
   * `public`: no session needed (the handler does its own checks); `session`: any signed-in contact; `finance`: a
   * signed-in contact who may see finance (anyone else gets a 404, as for a document that isn't theirs).
   */
  access: "public" | "session" | "finance";
  /** The audit action a successful call writes (informational: the handler writes it). */
  audit?: string;
  /** false: never an access-log row (health). */
  log?: boolean;
};

/** Who is signed in, for `GET /me` (the guard's read already has all of it: no second query). */
export type Who = { name: string; email: string; organisation: string };

export type Vars = {
  /** `cf-ray`, else 16 random hex characters; in every error body and every log row of the request. */
  rid: string;
  ip: string | null;
  ua: string | null;
  route: RouteDef | null;
  /** Injected by tests; absent in production, where the email queue is used. */
  sender?: MagicLinkSender | undefined;
  /** Set by the guard only, from the session row. Read it with `scope(c)`. */
  scope?: ClientScope;
  who?: Who;
  /** The 15-minute `last_seen_at` refresh, when one is due: it rides in the request's single access write. */
  touch?: D1PreparedStatement;
  /** The handler already wrote this request's access row (inside its batch), or must write none. */
  accessDone?: boolean;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
export type Ctx = Context<AppEnv>;

export type ApiError = { code: string; message: string };

export const BAD_REQUEST: ApiError = { code: "bad_request", message: "Check the form and try again" };
export const NOT_FOUND: ApiError = { code: "not_found", message: "Not found" };
export const UNAUTHENTICATED: ApiError = { code: "unauthenticated", message: "Sign in" };
export const RATE_LIMITED: ApiError = {
  code: "rate_limited",
  message: "Too many requests. Please try again later.",
};

/** Every error body is `{ error: { code, message }, request_id }` [05 §7.1]. */
export const err = (c: Ctx, e: ApiError, status: ContentfulStatusCode) =>
  c.json({ error: { code: e.code, message: e.message }, request_id: c.var.rid }, status);

/** The 429: the same body for every quota, with the seconds until the earliest lock ends. */
export function rateLimited(c: Ctx, retryAfterS: number) {
  c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterS))));
  return err(c, RATE_LIMITED, 429);
}

/**
 * The address a quota counts for this request: IPv4 as it is, IPv6 as its /64 (see `addressOf`). A request with no
 * address header (never behind Cloudflare) shares one bucket: the strict side.
 */
export const callerAddress = (c: Ctx) => addressOf(c.var.ip ?? "unknown");

/** Who and where, for audit and access rows. */
export const requestInfo = (c: Ctx) => ({ requestId: c.var.rid, ip: c.var.ip, ua: c.var.ua });

/** The access-log entry of this request; the actor is the signed-in contact (NULL before sign-in). */
export const accessEntry = (c: Ctx, status: number, actorId?: string | null): AccessEntry => ({
  ...requestInfo(c),
  realm: "portal",
  actorId: actorId === undefined ? (c.var.scope?.contactId ?? null) : actorId,
  method: c.req.method,
  route: c.var.route?.path ?? "other",
  status,
});

/**
 * One D1 call for a failed or special outcome of a public route: the given statements plus this request's access
 * row (a sign-in event, Q1 = A). Marks the access row as written.
 */
export async function logBatch(c: Ctx, status: number, extra: D1PreparedStatement[] = []) {
  c.set("accessDone", true);
  await c.env.DB.batch([...extra, accessStmt(c.env.DB, accessEntry(c, status))]);
}
