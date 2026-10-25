import { hex, randomBytes } from "@techaust/auth";
import { accessStmt, clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono/tiny";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { account } from "./account.ts";
import { audit } from "./audit.ts";
import { auth } from "./auth.ts";
import { catalogue, templates } from "./catalogue.ts";
import { clients, contacts } from "./clients.ts";
import { type AppEnv, accessEntry, BAD_REQUEST, type Ctx, err, FORBIDDEN, NOT_FOUND } from "./context.ts";
import { csrf } from "./csrf.ts";
import { guard, routeFor } from "./guard.ts";
import { leads } from "./leads.ts";
import { notifications } from "./notifications.ts";
import { search } from "./search.ts";
import { settings } from "./settings.ts";
import { users } from "./users.ts";

import "./warm.ts"; // start-up warm-up of the settings schemas and the step-up path (M3.1)

let isolateId: string | undefined;
let isolateRequests = 0;

/** The API. A factory only so a test can build a second app and add a route the table does not declare. */
export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");
  app.use(secureHeaders());

  // One diagnostic line per /api request, to tell cold isolates from busy ones in Workers Logs. Exactly these keys
  // [NFR-6]: the route PATTERN (or "other"), the status, the request ID (`cf-ray` or random), a random per-isolate ID
  // and this isolate's request count. No email, IP, user agent, account ID, token or cookie. (Random values can't be
  // made at module level in Workers, so `iso` is lazy.)

  // The outermost middleware: request ID and facts, the route's table row, the exit log line, and the request's
  // access-log row [NFR-9] unless the handler already wrote it inside its own batch.
  app.use(
    createMiddleware<AppEnv>(async (c, next) => {
      isolateId ??= hex(randomBytes(3));
      const n = ++isolateRequests; // taken before next(), so concurrent requests get distinct numbers
      // Header values are the client's: cut before they reach a log row (audit M2).
      c.set("rid", clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? hex(randomBytes(8)));
      c.set("ip", clipHeader(c.req.header("CF-Connecting-IP"), HEADER_LIMITS.ip));
      c.set("ua", clipHeader(c.req.header("User-Agent"), HEADER_LIMITS.ua));
      const row = routeFor(c.req.method, routePath(c, -1)) ?? null;
      c.set("route", row);
      await next();
      c.header("Cache-Control", "no-store");
      // Every API request by a signed-in member, every sign-in attempt and every refusal (Q2). Not for lookups
      // (health, salt, invite start) and not for undeclared routes. A logging failure never changes the answer.
      const wanted = row && row.log !== false && (row.log !== "refusals" || c.res.status >= 400);
      if (row && wanted && !c.var.accessDone) {
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

  app.get("/v1/health", (c) => c.json({ ok: true, service: "admin", env: c.env.ENVIRONMENT }));
  app.route("/v1/auth", auth);
  app.route("/v1/auth", account);
  app.route("/v1/users", users);
  app.route("/v1/settings", settings);
  app.route("/v1/leads", leads);
  app.route("/v1/catalogue", catalogue);
  app.route("/v1/templates", templates);
  app.route("/v1/clients", clients);
  app.route("/v1/contacts", contacts);
  app.route("/v1/notifications", notifications);
  app.route("/v1/search", search);
  app.route("/v1/audit", audit);

  app.notFound((c) => err(c, NOT_FOUND, 404));
  app.onError((e, c) => {
    if (e instanceof HTTPException) {
      const status = e.status as ContentfulStatusCode;
      return err(c, status === 403 ? FORBIDDEN : BAD_REQUEST, status);
    }
    // The route PATTERN, never the raw path (it can carry ids).
    console.error(
      // Never `e.message`: a driver error can echo SQL or values. The error's class name is enough to find it.
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
