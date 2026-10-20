// CSRF protection for a JSON API [docs/05 §7.1, ADM-G-02]. Hono's built-in csrf() only looks at form bodies; ours
// covers every unsafe request: it must come from the app's own origin and carry JSON (a cross-site page can only
// send form-like content types without a CORS preflight, and there is no CORS here at all).
//   1. Unsafe methods (anything but GET, HEAD, OPTIONS): `Origin` must equal the app origin. Without an `Origin`
//      header (some same-origin requests), `Sec-Fetch-Site: same-origin` must be present.
//   2. A request that has a body must be `application/json`.
import { createMiddleware } from "hono/factory";
import { type AppEnv, err } from "./context.ts";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_SITE = { code: "forbidden", message: "Request refused" } as const;
export const NOT_JSON = { code: "unsupported_media_type", message: "Send JSON" } as const;

const hasBody = (c: { req: { header: (n: string) => string | undefined } }) => {
  const length = c.req.header("Content-Length");
  return (length !== undefined && length !== "0") || c.req.header("Transfer-Encoding") !== undefined;
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
