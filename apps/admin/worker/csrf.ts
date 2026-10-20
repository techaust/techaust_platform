// CSRF protection for a JSON API [docs/05 §7.1, ADM-G-02]. Hono's built-in csrf() only looks at form bodies; ours
// covers every unsafe request: it must come from the app's own origin and carry JSON (a cross-site page can only
// send form-like content types without a CORS preflight, and there is no CORS here at all).
//   1. Unsafe methods (anything but GET, HEAD, OPTIONS): `Origin` must equal the app origin. Without an `Origin`
//      header (some same-origin requests), `Sec-Fetch-Site: same-origin` must be present.
//   2. A request that has a body must be `application/json`.
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { type AppEnv, err } from "./context.ts";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_SITE = { code: "forbidden", message: "Request refused" } as const;
export const NOT_JSON = { code: "unsupported_media_type", message: "Send JSON" } as const;

/** A body is there when a length (not 0) or chunked encoding is declared, or the runtime hands over a stream. */
const hasBody = (c: Context<AppEnv>) => {
  const length = c.req.header("Content-Length");
  if (length === "0") return false;
  return length !== undefined || c.req.header("Transfer-Encoding") !== undefined || c.req.raw.body !== null;
};

export const csrf = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE.has(c.req.method)) return next();
  const origin = c.req.header("Origin");
  const sameOrigin = origin
    ? origin === new URL(c.req.url).origin
    : c.req.header("Sec-Fetch-Site") === "same-origin";
  if (!sameOrigin) return err(c, CROSS_SITE, 403);
  if (hasBody(c) && !/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? ""))
    return err(c, NOT_JSON, 415);
  return next();
});
