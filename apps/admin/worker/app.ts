import { answeringRow, hex, randomBytes } from "@techaust/auth";
import { accessStmt, clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { matchedRoutes } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { Hono } from "hono/tiny";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AppEnv, accessEntry, BAD_REQUEST, type Ctx, err, FORBIDDEN, NOT_FOUND } from "./context.ts";
import { csrf } from "./csrf.ts";
import { guard, routeFor } from "./guard.ts";

let isolateId: string | undefined;
let isolateRequests = 0;

/** This isolate's random ID and request counter (`ev: "req"` and `ev: "fwd"` lines share them). Random values can't be made at module level in Workers, so `iso` is lazy. */
export function nextRequestNumber() {
  isolateId ??= hex(randomBytes(3));
  return { iso: isolateId, n: ++isolateRequests }; // taken before the request runs, so concurrent requests get distinct numbers
}

/**
 * M6.2 CPU diagnosis (lead decision 4, 2026-11-01): the patterns this isolate has answered, so a log line can say "first run here" (`f: 1`) and the staging CPU
 * gate reads first runs directly. Keys are route PATTERNS (`GET /api/v1/invoices/:id`), forwards (`fwd GET ...`) and RPC methods (`rpc processEvent`): never a
 * raw path, an id or anything personal. Bounded (the route table is finite; at most 512 keys are remembered).
 */
const answered = new Set<string>();
/** A warm app's fixed request facts (createApp `warm`): no counter moves. */
const WARM_REQUEST = { iso: "warm", n: 0 } as const;
export function firstRun(key: string): 1 | undefined {
  if (answered.has(key)) return undefined;
  if (answered.size < 512) answered.add(key);
  return 1;
}

export type App = Hono<AppEnv, Record<string, never>, "/api">;

/**
 * The start-up dry run's JSON bodies (CPU warm-up (b)1, warm-routes.ts): workerd refuses a Request WITH a body at global scope, so a warm call is a bodiless
 * Request whose JSON text is held here and handed to Hono's body cache by the warm app's first middleware. Only a warm app (`createApp(..., { warm: true })`)
 * reads it; a real request is never in it.
 */
export const warmBodies = new WeakMap<Request, string>();

/** What a warm app's `c.json` does: the whole serialiser runs, the answer is a bodiless Response (allowed at global scope) with the same status. */
function warmJson(c: Ctx) {
  return (object: unknown, arg?: number | ResponseInit) => {
    JSON.stringify(object);
    const status = typeof arg === "number" ? arg : (arg?.status ?? 200);
    return c.body(null, status as ContentfulStatusCode);
  };
}

/**
 * One admin Worker's API (M5.0): the middleware chain (logging, CSRF, body limits, guard) plus the route groups `mount` adds.
 * `before` runs ahead of every middleware (the front Worker's forwarders). A factory so a test can build a second app and add a
 * route the table does not declare.
 *
 * `warm: true` (CPU warm-up (b)1, 2026-11-02): a second instance of the SAME chain and handlers for the start-up dry run on a made-up env (warm-routes.ts), so V8
 * compiles them before the first metered request. It differs only where a dry run must leave no trace and must not use what global scope refuses: no request
 * number, no `f: 1` first-run mark, no log line, no access row, a fixed request id, a body from `warmBodies`, `c.json` without a body, and errors answered silently.
 * A Worker's real app is always built without it.
 */
export function createApp(
  mount: (app: App) => void,
  before?: (app: App) => void,
  opts: { warm?: boolean } = {},
) {
  const warm = opts.warm === true;
  const app: App = new Hono<AppEnv>().basePath("/api");
  if (warm)
    app.use(async (c, next) => {
      const text = warmBodies.get(c.req.raw);
      // Hono keeps the PROMISE of each body reading in `bodyCache` (its type names the value); `c.req.json()` reads `text` from it.
      if (text !== undefined) Reflect.set(c.req.bodyCache, "text", Promise.resolve(text));
      // An own property over Hono's (an instance field), on this warm context only.
      Object.defineProperty(c, "json", { value: warmJson(c), configurable: true, writable: true });
      await next();
    });
  before?.(app);
  // docs/08 section 3.1 on every API answer (audit A1 finding 4): Hono's defaults, plus HSTS for one year with subdomains (its
  // default is 180 days) and the same Permissions-Policy as the static files (public/_headers).
  app.use(
    secureHeaders({
      strictTransportSecurity: "max-age=31536000; includeSubDomains",
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
    }),
  );

  // One diagnostic line per /api request, to tell cold isolates from busy ones in Workers Logs. Exactly these keys
  // [NFR-6]: the route PATTERN (or "other"), the status, the request ID (`cf-ray` or random), a random per-isolate ID,
  // this isolate's request count, and (M6.2) `f: 1` only on the first request of that pattern in this isolate. No email,
  // IP, user agent, account ID, token or cookie.

  // The outermost middleware: request ID and facts, the route's table row, the exit log line, and the request's
  // access-log row [NFR-9] unless the handler already wrote it inside its own batch.
  app.use(
    createMiddleware<AppEnv>(async (c, next) => {
      // A warm app counts no request and draws no random id (global scope refuses random values).
      const { iso, n } = warm ? WARM_REQUEST : nextRequestNumber();
      // Header values are the client's: cut before they reach a log row (audit M2).
      c.set(
        "rid",
        clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? (warm ? "warm" : hex(randomBytes(8))),
      );
      c.set("ip", clipHeader(c.req.header("CF-Connecting-IP"), HEADER_LIMITS.ip));
      c.set("ua", clipHeader(c.req.header("User-Agent"), HEADER_LIMITS.ua));
      // The row of the handler that ANSWERS: the first matched pattern that is a table row. Hono runs a static path registered before
      // `/:id` first (`/care-plans/defaults`), but the LAST match is `/:id`, whose guard row may differ (shared with the portal).
      const row = answeringRow(matchedRoutes(c), (p) => routeFor(c.req.method, p));
      c.set("route", row);
      await next();
      // A handler that never read the body (`{}` on a mark-read POST): read it to the end before answering. Through the front's
      // service binding an unread body fails the front with "Can't read from request stream after response has been sent"
      // (staging, 2026-10-28). Only a body that declares at most 16 KB: a refused large or unsized body is left unread.
      const declared = Number(c.req.header("content-length") ?? Number.NaN);
      if (declared > 0 && declared <= 16 * 1024 && c.req.raw.body && !c.req.raw.bodyUsed) {
        try {
          await c.req.raw.arrayBuffer();
        } catch {
          // Already cut off by the client: nothing left to read.
        }
      }
      c.header("Cache-Control", "no-store");
      // Every API request by a signed-in member, every sign-in attempt and every refusal (Q2). Not for lookups
      // (health, salt, invite start) and not for undeclared routes. A logging failure never changes the answer.
      const wanted = row && row.log !== false && (row.log !== "refusals" || c.res.status >= 400);
      if (row && wanted && !c.var.accessDone && !warm) {
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
      // A warm app builds the line (its code runs) but neither marks a first run nor prints it.
      const line = JSON.stringify({
        ev: "req",
        r: row?.path ?? "other",
        s: c.res.status,
        rid: c.var.rid,
        iso,
        n,
        f: warm ? undefined : firstRun(`${c.req.method} ${row?.path ?? "other"}`),
      });
      if (!warm) console.log(line);
    }),
  );
  app.use(csrf);
  const jsonLimit = bodyLimit({ maxSize: 16 * 1024, onError: (c) => err(c as Ctx, BAD_REQUEST, 413) });
  // An upload route (`body: "upload"`) checks its own declared length and streams; a route marked `body: "large"` (the catalogue
  // and template saves) reads up to 32 KB; every other route stays at 16 KB.
  const largeLimit = bodyLimit({ maxSize: 32 * 1024, onError: (c) => err(c as Ctx, BAD_REQUEST, 413) });
  // A proposal save (`body: "document"`): 100 lines and 30,000 characters of sections, with room for multi-byte text (lead decision 13).
  const documentLimit = bodyLimit({ maxSize: 96 * 1024, onError: (c) => err(c as Ctx, BAD_REQUEST, 413) });
  app.use((c, next) => {
    const kind = c.var.route?.body;
    if (kind === "upload") return next();
    return kind === "document"
      ? documentLimit(c, next)
      : kind === "large"
        ? largeLimit(c, next)
        : jsonLimit(c, next);
  });
  app.use(guard);

  mount(app);

  app.notFound((c) => err(c, NOT_FOUND, 404));
  app.onError((e, c) => {
    // A warm app answers an error silently: at global scope a step that needs a random value or an I/O stops the dry run there.
    if (warm) return c.body(null, 500);
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
