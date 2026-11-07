// In-Worker Rate Limiting on the admin FRONT (M7.5 C2, L2, L5, L22; ASVS 5.0 2.4.1). The bindings (`RL_SESSION`, `RL_SIGNIN`, `RL_INVITE`, wrangler.jsonc)
// exist on the front only: the API, finance and invoices Workers are reached only through the front's forwarder, which has already counted the request, so
// their guard finds no binding and skips the check (`underLimit` in @techaust/auth). Every check runs before any D1 work and before Turnstile's siteverify,
// and a refusal writes nothing (no counter row, no access row): the limiter protects the D1 write budget (M1.6 flood note). The exact `auth_attempts`
// counters (lockouts, the Turnstile gate, the per-address block) stay behind it unchanged.
//   - per session (L2): every request that carries the staff cookie and needs a session, 240 a minute (a screen loads several lists), keyed on
//     HMAC(SESSION_HMAC_KEY, the session id);
//   - per address (C2, L5): the public sign-in rows below, each route its own counter, keyed on HMAC(SALT_PEPPER, the address; IPv6 as its /64).
// Over the limit: 429 `rate_limited` with `Retry-After` (the portal's existing quota line).
import {
  addressOf,
  type Limiter,
  RATE_LIMIT_RETRY_S,
  rateLimitKey,
  readCookie,
  tokenHash,
  underLimit,
} from "@techaust/auth";
import { createMiddleware } from "hono/factory";
import { type ApiError, type AppEnv, type Ctx, err } from "./context.ts";
import type { SessionLimit } from "./guard.ts";

/** The 429 body: the portal's existing quota line (07: "Too many requests. Please try again later."), so no new copy. */
export const RATE_LIMITED: ApiError = {
  code: "rate_limited",
  message: "Too many requests. Please try again later.",
};

/** The public sign-in rows limited per address, and the binding of each (C2, L5). Each route keeps its own counter (the key carries the pattern). */
export const ADDRESS_LIMITED: Readonly<Record<string, "RL_SIGNIN" | "RL_INVITE">> = {
  "/api/v1/auth/salt": "RL_SIGNIN",
  "/api/v1/auth/login": "RL_SIGNIN",
  "/api/v1/auth/totp": "RL_SIGNIN",
  "/api/v1/auth/recovery": "RL_SIGNIN",
  "/api/v1/auth/invite/start": "RL_INVITE",
  "/api/v1/auth/invite/finish": "RL_INVITE",
  "/api/v1/auth/invite/totp": "RL_INVITE",
};

/** The 429: nothing written (no access row either), `Retry-After` one period. */
export function tooMany(c: Ctx): Response {
  c.set("accessDone", true);
  c.header("Retry-After", String(RATE_LIMIT_RETRY_S));
  return err(c, RATE_LIMITED, 429);
}

/** The env's limiter of that name, if this Worker has one (the front only). */
const limiterOf = (env: Env, name: "RL_SESSION" | "RL_SIGNIN" | "RL_INVITE"): Limiter | undefined =>
  Reflect.get(env, name) as Limiter | undefined;

/** L2: whether this session may make another request now. No binding (a Worker behind the front) or a warm dry run: yes, with no work at all. */
export async function sessionAllowed(c: Ctx, sessionId: string): Promise<boolean> {
  const limiter = limiterOf(c.env, "RL_SESSION");
  if (!limiter || c.var.warm) return true;
  return underLimit(limiter, await rateLimitKey(c.env.SESSION_HMAC_KEY, "s", sessionId), "admin.session");
}

/** The guard's per-session limit (createApp `sessionLimit`, the front only): the 429 when this session is over the limit, else null. */
export const sessionLimit: SessionLimit = async (c, sessionId) =>
  (await sessionAllowed(c, sessionId)) ? null : tooMany(c);

/**
 * L2 for a request the front forwards (forward.ts runs before any middleware): the cookie's session, if there is one. No cookie: the Worker behind answers
 * 401 without a D1 read, so there is nothing to protect.
 */
export async function forwardAllowed(c: Ctx): Promise<boolean> {
  if (!limiterOf(c.env, "RL_SESSION")) return true;
  const token = readCookie(c.req.header("Cookie"));
  return token ? sessionAllowed(c, await tokenHash(token)) : true;
}

/** C2, L5: the per-address limit of the public sign-in rows, after CSRF and before the body is read, the guard, Turnstile or any D1 statement. */
export const addressLimit = createMiddleware<AppEnv>(async (c, next) => {
  const row = c.var.route;
  const name = row && row.method === "POST" ? ADDRESS_LIMITED[row.path] : undefined;
  const limiter = name ? limiterOf(c.env, name) : undefined;
  if (!row || !limiter || c.var.warm) return next();
  // A request with no address header (never behind Cloudflare) shares one bucket: the strict side.
  const key = await rateLimitKey(c.env.SALT_PEPPER, `a${row.path}`, addressOf(c.var.ip ?? "unknown"));
  if (!(await underLimit(limiter, key, `admin.${name}`))) return tooMany(c);
  return next();
});
