import { hex, randomBytes } from "@techaust/auth";
import { accessStmt, clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono/tiny";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authRoutes } from "./auth.ts";
import { type AppEnv, accessEntry, BAD_REQUEST, type Ctx, err, NOT_FOUND, type RouteDef } from "./context.ts";
import { csrf } from "./csrf.ts";
import { docToken } from "./doc-token.ts";
import { guard, ROUTES, tableOf } from "./guard.ts";
import { me } from "./me.ts";
import type { MagicLinkSender } from "./sender.ts";

let isolateId: string | undefined;
let isolateRequests = 0;

/** A route that exists only in a test: its table row and its handler (the table itself stays the product's). */
export type TestRoute = { def: RouteDef; handler: (c: Ctx) => Response | Promise<Response> };

export type Deps = {
  /** How a link reaches a person. Default: the email queue (`queueSender`); tests inject a capturing sender. */
  sender?: MagicLinkSender;
  testRoutes?: TestRoute[];
};

/** The API. A factory so a test can inject a capturing sender and add routes the table does not declare. */
export function createApp(deps: Deps = {}) {
  const sender = deps.sender;
  const routeFor = tableOf([...ROUTES, ...(deps.testRoutes ?? []).map((t) => t.def)]);
  const app = new Hono<AppEnv>().basePath("/api");
  app.use(secureHeaders());

  // The outermost middleware: request ID and facts, the route's table row, the exit log line, and the access-log
  // row of a SIGNED-IN request (owner's Q1 = A) unless the handler already wrote it inside its own batch. Anonymous
  // refusals (no cookie, a dead session, CSRF, an unknown route, a quota) write no row. One diagnostic line per /api
  // request, with exactly these keys [NFR-6]: the route PATTERN (or "other"), the status, the request ID (`cf-ray`
  // or random), a random per-isolate ID and this isolate's request count. No email, IP, user agent, contact ID,
  // token or cookie. (Random values can't be made at module level in Workers, so `iso` is lazy.)
  app.use(
    createMiddleware<AppEnv>(async (c, next) => {
      isolateId ??= hex(randomBytes(3));
      const n = ++isolateRequests; // taken before next(), so concurrent requests get distinct numbers
      // Header values are the client's: cut before they reach a log row (audit M2).
      c.set("rid", clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? hex(randomBytes(8)));
      c.set("ip", clipHeader(c.req.header("CF-Connecting-IP"), HEADER_LIMITS.ip));
      c.set("ua", clipHeader(c.req.header("User-Agent"), HEADER_LIMITS.ua));
      c.set("sender", sender);
      const row = routeFor(c.req.method, routePath(c, -1)) ?? null;
      c.set("route", row);
      await next();
      c.header("Cache-Control", "no-store");
      if (row && row.log !== false && c.var.scope && !c.var.accessDone) {
        // The write rides in the execution context: the response does not wait for it (audit L5). The statements
        // are built before the first await, so they see this request's final state.
        const write = async () => {
          try {
            const stmts = [
              ...(c.var.touch ? [c.var.touch] : []),
              accessStmt(c.env.DB, accessEntry(c, c.res.status)),
            ];
            if (stmts.length === 1) await stmts[0]?.run();
            else await c.env.DB.batch(stmts);
          } catch (e) {
            // A logging failure never changes the answer.
            console.error(
              JSON.stringify({
                level: "error",
                route: row.path,
                message: "access log write failed",
                rid: c.var.rid,
                cause: e instanceof Error ? e.name : "unknown",
              }),
            );
          }
        };
        c.executionCtx.waitUntil(write());
      }
      console.log(
        JSON.stringify({
          ev: "req",
          r: row?.path ?? "other",
          s: c.res.status,
          rid: c.var.rid,
          iso: isolateId,
          n,
        }),
      );
    }),
  );
  app.use(csrf);
  app.use(bodyLimit({ maxSize: 16 * 1024, onError: (c) => err(c as Ctx, BAD_REQUEST, 413) }));
  app.use(guard);

  app.get("/v1/health", (c) => c.json({ ok: true, service: "portal", env: c.env.ENVIRONMENT }));
  app.route("/v1/auth", authRoutes);
  app.route("/v1/me", me);
  app.route("/v1/t", docToken);
  for (const t of deps.testRoutes ?? []) {
    const path = t.def.path.replace(/^\/api/, "");
    if (t.def.method === "GET") app.get(path, (c) => t.handler(c));
    else app.post(path, (c) => t.handler(c));
  }

  app.notFound((c) => err(c, NOT_FOUND, 404));
  app.onError((e, c) => {
    if (e instanceof HTTPException) {
      const status = e.status as ContentfulStatusCode;
      return err(c, status === 404 ? NOT_FOUND : BAD_REQUEST, status);
    }
    // The route PATTERN, never the raw path. Never `e.message`: a driver error can echo SQL or values; the class
    // name is enough to find it.
    console.error(
      JSON.stringify({
        level: "error",
        route: c.var.route?.path ?? "other",
        message: "unhandled error",
        cause: e.name,
      }),
    );
    return err(c, { code: "internal", message: "Something went wrong" }, 500);
  });

  return app;
}

const app = createApp();
export default app satisfies ExportedHandler<Env>;
