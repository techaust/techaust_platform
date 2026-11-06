// In-Worker Rate Limiting on the portal (M7.5 C2, L2, L22; ASVS 5.0 2.4.1). Bindings (wrangler.jsonc, every scope): `RL_SESSION` per signed-in session
// (120 a minute), `RL_SIGNIN` per address on /auth/magic and /auth/magic/verify, `RL_LINKS` per address on every /t/* route (each route its own counter).
// Every check runs before any D1 work and before Turnstile's siteverify; a refusal writes nothing (the guard has set no scope, so no access row either).
// Keys are HMACs under PORTAL_KEY_PEPPER, as the D1 quotas' are (`p:req:` and the others). The exact D1 quotas (link requests per address and per email,
// failed links per address, PayPal returns) stay behind it unchanged. Over the limit: the existing 429 `rate_limited` with `Retry-After`.
import { addressOf, type Limiter, RATE_LIMIT_RETRY_S, rateLimitKey, underLimit } from "@techaust/auth";
import { createMiddleware } from "hono/factory";
import { type AppEnv, type Ctx, rateLimited } from "./context.ts";

/** The public rows limited per address and the binding of each: the two sign-in rows, and every emailed-link row (`/t/...`). */
export function addressBindingOf(path: string): "RL_SIGNIN" | "RL_LINKS" | null {
  if (path === "/api/v1/auth/magic" || path === "/api/v1/auth/magic/verify") return "RL_SIGNIN";
  if (path.startsWith("/api/v1/t/")) return "RL_LINKS";
  return null;
}

const limiterOf = (env: Env, name: "RL_SESSION" | "RL_SIGNIN" | "RL_LINKS"): Limiter | undefined =>
  Reflect.get(env, name) as Limiter | undefined;

/** L2: whether this session may make another request now (asked by the guard before the session read). No binding or a warm dry run (L39): yes, no work. */
export async function sessionAllowed(c: Ctx, sessionId: string): Promise<boolean> {
  const limiter = limiterOf(c.env, "RL_SESSION");
  if (!limiter || c.var.warm) return true;
  return underLimit(limiter, await rateLimitKey(c.env.PORTAL_KEY_PEPPER, "s", sessionId), "portal.session");
}

/** The 429 of a limiter: the existing quota body, `Retry-After` one period. */
export const tooMany = (c: Ctx) => rateLimited(c, RATE_LIMIT_RETRY_S);

/** C2: the per-address limit of the sign-in and emailed-link rows, after CSRF and before the body is read, the guard, Turnstile or any D1 statement. */
export const addressLimit = createMiddleware<AppEnv>(async (c, next) => {
  const row = c.var.route;
  const name = row && row.method === "POST" ? addressBindingOf(row.path) : null;
  const limiter = name ? limiterOf(c.env, name) : undefined;
  if (!row || !name || !limiter || c.var.warm) return next();
  // A request with no address header (never behind Cloudflare) shares one bucket: the strict side (as `callerAddress`).
  const key = await rateLimitKey(c.env.PORTAL_KEY_PEPPER, `a${row.path}`, addressOf(c.var.ip ?? "unknown"));
  if (!(await underLimit(limiter, key, `portal.${name}`))) return tooMany(c);
  return next();
});
