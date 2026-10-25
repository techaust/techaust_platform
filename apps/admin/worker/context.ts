// Shared types and helpers of the admin API: the Hono environment, error bodies that carry the request ID, the
// request facts every log row needs, and `mutate` (one batch = the change + its audit row + its access row).
import { uuidv7 } from "@techaust/core/ids";
import type { Action, Role } from "@techaust/core/permissions";
import {
  type AccessEntry,
  accessStmt,
  auditStmt,
  type Guard,
  type GuardSql,
  guardSql,
} from "@techaust/db/log";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type RouteDef = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The full Hono pattern, e.g. `/api/v1/users/:id`. */
  path: string;
  /** `public`: no session needed (the handler does its own checks); otherwise the matrix action it needs. */
  access: "public" | Action;
  /** The audit action a successful mutation writes (informational: the handler writes it). */
  audit?: string;
  /** false: never an access-log row (health). "refusals": only when the answer is 4xx/5xx (the salt and invite-start lookups). Default true. */
  log?: boolean | "refusals";
  /** "large": a JSON body of up to 32 KB (the catalogue's service and template saves can be longer than 16 KB). Absent: JSON, 16 KB. */
  body?: "large";
};

export type Actor = {
  id: string;
  role: Role;
  sessionId: string;
  stepUpUntil: number | null;
  name: string;
  email: string;
};

export type Vars = {
  /** `cf-ray`, else 16 random hex characters; in every error body and every log row of the request. */
  rid: string;
  ip: string | null;
  ua: string | null;
  route: RouteDef | null;
  user?: Actor;
  /** The 15-minute `last_seen_at` refresh, when one is due: it rides in the request's single log write. */
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
export const FORBIDDEN: ApiError = { code: "forbidden", message: "You can't do that" };
export const STEP_UP_REQUIRED: ApiError = {
  code: "step_up_required",
  message: "Confirm with a fresh code from your authenticator first",
};

/** The signed-in member of a guarded route (the guard set it; a route without a session never gets here). */
export function actor(c: Ctx): Actor {
  const user = c.var.user;
  if (!user) throw new Error("guarded route reached without a session");
  return user;
}

/** Every error body is `{ error: { code, message }, request_id }` [05 §7.1]. */
export const err = (c: Ctx, e: ApiError, status: ContentfulStatusCode) =>
  c.json({ error: { code: e.code, message: e.message }, request_id: c.var.rid }, status);

/** Who and where, for audit and access rows. */
export const requestInfo = (c: Ctx) => ({ requestId: c.var.rid, ip: c.var.ip, ua: c.var.ua });

/** Country and city as Cloudflare saw them: for alert summaries only (never stored elsewhere). */
export const geo = (c: Ctx) => {
  const cf = c.req.raw.cf as { country?: string; city?: string } | undefined;
  return { country: cf?.country ?? null, city: cf?.city ?? null };
};

export const accessEntry = (c: Ctx, status: number, actorId?: string | null): AccessEntry => ({
  ...requestInfo(c),
  actorId: actorId ?? c.var.user?.id ?? null,
  method: c.req.method,
  route: c.var.route?.path ?? "other",
  status,
});

/**
 * One D1 call for a failed or special outcome of a public route: the given statements plus this request's access
 * row (and the due session touch, if any). Marks the access row as written.
 */
export async function logBatch(c: Ctx, status: number, extra: D1PreparedStatement[] = []) {
  c.set("accessDone", true);
  await c.env.DB.batch([
    ...extra,
    ...(c.var.touch ? [c.var.touch] : []),
    accessStmt(c.env.DB, accessEntry(c, status)),
  ]);
}

/** The statements a handler gets for the rest of its batch: they apply only if the audit row was written. */
export type SideGuard = GuardSql;

export type Mutation = {
  /** The conditional primary statement(s); the LAST one decides (the audit row follows it with `changes() > 0`). None: always written. */
  main?: D1PreparedStatement | D1PreparedStatement[];
  action: string;
  entityType: string;
  entityId: string | null;
  summary?: unknown;
  /**
   * Audit-first (when the summary needs the row as it was BEFORE the change): the caller's own audit statement,
   * written with the row's conditions in its WHERE, runs first; `after` then builds the change itself, guarded on
   * that audit row existing. Replaces `main` and `summary`.
   */
  auditFirst?: (
    auditId: string,
    who: { actor: Actor; requestId: string | null; ip: string | null; ua: string | null },
  ) => D1PreparedStatement;
  after?: (g: SideGuard, auditId: string) => D1PreparedStatement[];
  /** Further statements (revoke sessions, insert an invite…); bind `...g.params` after your own values and use `g.sql(n)`, n = the number of that first placeholder. */
  side?: (g: SideGuard, auditId: string) => D1PreparedStatement[];
  /** The status the access row records (the handler must answer with it). Default 200. */
  status?: number;
};

/**
 * A signed-in mutation in ONE D1 call [ADM-G-06, ADM-AUD-01, NFR-9]: [touch], the conditional statement, its
 * audit row (written only if that statement changed a row), the side statements and the access row (both only if
 * the audit row exists). Returns whether it happened; false means the condition failed and nothing was written,
 * so the handler answers with its error and the request's access row is written on the way out.
 */
export async function mutate(c: Ctx, m: Mutation): Promise<boolean> {
  const db = c.env.DB;
  const user = c.var.user as Actor;
  const auditId = uuidv7();
  const stmts: D1PreparedStatement[] = [];
  if (c.var.touch) stmts.push(c.var.touch);
  const g = guardSql({ auditId });
  let auditAt: number;
  if (m.auditFirst) {
    auditAt = stmts.length;
    stmts.push(m.auditFirst(auditId, { actor: user, ...requestInfo(c) }), ...(m.after?.(g, auditId) ?? []));
  } else {
    const mains = m.main === undefined ? [] : Array.isArray(m.main) ? m.main : [m.main];
    stmts.push(...mains);
    auditAt = stmts.length;
    stmts.push(
      auditStmt(
        db,
        {
          ...requestInfo(c),
          id: auditId,
          actorId: user.id,
          role: user.role,
          action: m.action,
          entityType: m.entityType,
          entityId: m.entityId,
          summary: m.summary,
        },
        mains.length ? "changes" : undefined,
      ),
    );
  }
  stmts.push(...(m.side?.(g, auditId) ?? []));
  stmts.push(accessStmt(db, accessEntry(c, m.status ?? 200, user.id), { auditId } satisfies Guard));
  const results = await db.batch(stmts);
  c.set("touch", undefined); // done (or harmless to repeat): the exit write must not add it again
  const written = results[auditAt]?.meta.changes === 1;
  if (written) c.set("accessDone", true);
  return written;
}
