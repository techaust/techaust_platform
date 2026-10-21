// CSRF protection for the portal API [docs/05 §7.1, POR-02]. The rule is `csrfCheck` in @techaust/auth, shared with
// the admin Worker (see its header); this wraps it in the portal's middleware and error bodies.
import { csrfCheck } from "@techaust/auth";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { type AppEnv, err } from "./context.ts";

export const CROSS_SITE = { code: "forbidden", message: "Request refused" } as const;
export const NOT_JSON = { code: "unsupported_media_type", message: "Send JSON" } as const;

/** A body is there when a length (not 0) or chunked encoding is declared, or the runtime hands over a stream. */
const hasBody = (c: Context<AppEnv>) => {
  const length = c.req.header("Content-Length");
  if (length === "0") return false;
  return length !== undefined || c.req.header("Transfer-Encoding") !== undefined || c.req.raw.body !== null;
};

export const csrf = createMiddleware<AppEnv>(async (c, next) => {
  const verdict = csrfCheck({
    method: c.req.method,
    origin: c.req.header("Origin"),
    secFetchSite: c.req.header("Sec-Fetch-Site"),
    url: c.req.url,
    contentType: c.req.header("Content-Type"),
    hasBody: hasBody(c),
  });
  if (verdict === "cross_site") return err(c, CROSS_SITE, 403);
  if (verdict === "not_json") return err(c, NOT_JSON, 415);
  return next();
});
