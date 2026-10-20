import { hex, randomBytes } from "@techaust/auth";
import { accessStmt } from "@techaust/db/log";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { account } from "./account.ts";
import { auth } from "./auth.ts";
import { type AppEnv, accessEntry, BAD_REQUEST, type Ctx, err, FORBIDDEN, NOT_FOUND } from "./context.ts";
import { csrf } from "./csrf.ts";
import { guard, routeFor } from "./guard.ts";
import { users } from "./users.ts";

const app = new Hono<AppEnv>().basePath("/api");
app.use(secureHeaders());

// One diagnostic line per /api request, to tell cold isolates from busy ones in Workers Logs. Exactly these keys
// [NFR-6]: the route PATTERN (or "other"), the status, the request ID (`cf-ray` or random), a random per-isolate ID
// and this isolate's request count. No email, IP, user agent, account ID, token or cookie. (Random values can't be
// made at module level in Workers, so `iso` is lazy.)
let isolateId: string | undefined;
let isolateRequests = 0;

// The outermost middleware: request ID and facts, the route's table row, the exit log line, and the request's
// access-log row [NFR-9] unless the handler already wrote it inside its own batch.
app.use(
  createMiddleware<AppEnv>(async (c, next) => {
    isolateId ??= hex(randomBytes(3));
    const n = ++isolateRequests; // taken before next(), so concurrent requests get distinct numbers
    c.set("rid", c.req.header("cf-ray") ?? hex(randomBytes(8)));
    c.set("ip", c.req.header("CF-Connecting-IP") ?? null);
    c.set("ua", c.req.header("User-Agent") ?? null);
    const row = routeFor(c.req.method, routePath(c, -1)) ?? null;
    c.set("route", row);
    await next();
    c.header("Cache-Control", "no-store");
    // Every API request by a signed-in member, every sign-in attempt and every refusal (Q2). Not for lookups
    // (health, salt, invite start) and not for undeclared routes. A logging failure never changes the answer.
    if (row && row.log !== false && !c.var.accessDone) {
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

app.notFound((c) => err(c, NOT_FOUND, 404));
app.onError((e, c) => {
  if (e instanceof HTTPException) {
    const status = e.status as ContentfulStatusCode;
    return err(c, status === 403 ? FORBIDDEN : BAD_REQUEST, status);
  }
  // The route PATTERN, never the raw path (it can carry ids).
  console.error(JSON.stringify({ level: "error", route: c.var.route?.path ?? "other", message: e.message }));
  return err(c, { code: "internal", message: "Something went wrong" }, 500);
});

export default app satisfies ExportedHandler<Env>;
