// The front Worker's forwarders (M5.0; the third Worker in M6.1 stage A, ADM-PAY-01): for every ROUTES row another admin Worker answers,
// `<binding>.fetch(request)` with the request untouched and the response not wrapped: `ADMIN_FINANCE` for a row marked `on: "finance"`,
// `ADMIN_API` for every other non-front row. Registered before any middleware (CSRF, body limits and the guard run in the Worker that
// answers, once). An undeclared path is not forwarded: it gets the front's 404. A binding failure is 502 with the standard error body (LD5).
//
// CPU warm-up (b)2 (2026-11-02): ONE catch-all handler (`/api/v1/*`, every method) in place of one route per forwarded row (155 of them). It looks the request
// up in its own table of the forwarded rows (Hono's TrieRouter: a walk over the path's segments, no regular expression per row) and forwards for the FIRST
// row that matches in table order, exactly as the first of the per-row handlers answered before; with no forwarded row it hands the request on (`next`) to
// the front's own routes and middleware, so an undeclared path still gets the front's 404.
import { hex, randomBytes } from "@techaust/auth";
import { clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { TrieRouter } from "hono/router/trie-router";
import { type App, firstRun, nextRequestNumber } from "./app.ts";
import { err, type RouteDef } from "./context.ts";

const BAD_GATEWAY = { code: "bad_gateway", message: "Something went wrong" };

/** Which Worker answers a forwarded row: `w` in the log lines ("api" or "finance"). */
export const workerOf = (row: RouteDef): "api" | "finance" => (row.on === "finance" ? "finance" : "api");

/** The forwarded rows (every row not marked `on: "front"`), by method and pattern, in table order. */
export function forwardTable(routes: readonly RouteDef[]): TrieRouter<RouteDef> {
  const table = new TrieRouter<RouteDef>();
  for (const row of routes) if (row.on !== "front") table.add(row.method, row.path, row);
  return table;
}

/**
 * The row a request is forwarded for: the first forwarded row, in table order, whose pattern matches the method and the full path; undefined: none. One
 * trailing slash is allowed, as the per-row PatternRouter routes allowed it (`/api/v1/settings/` was the settings row): no row pattern ends with a slash, so
 * such a path is looked up without it (split.test.ts compares the two on every row's paths). A HEAD request is looked up as a GET (early check finding 3): Hono
 * dispatches HEAD through the GET routes but leaves `c.req.method` "HEAD", so the per-row routes forwarded it for a GET row, and so does the table.
 */
export function forwardRowOf(
  table: TrieRouter<RouteDef>,
  method: string,
  path: string,
): RouteDef | undefined {
  const bare = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const [matches] = table.match(method === "HEAD" ? "GET" : method, bare);
  return matches[0]?.[0];
}

/**
 * Matches each forwarded row's sample path (`:param` → `x`) through the table `rounds` times while the module loads (like warm-router.ts for the routers); the
 * number of rows that resolve to themselves (a test pins it). Pure, never throws.
 */
export function warmForwardTable(
  table: TrieRouter<RouteDef>,
  routes: readonly RouteDef[],
  rounds = 3,
): number {
  let found = 0;
  try {
    for (const row of routes) {
      if (row.on === "front") continue;
      const path = row.path.replace(/:[A-Za-z0-9_]+/g, "x");
      let hit = false;
      for (let i = 0; i < rounds; i++) hit = forwardRowOf(table, row.method, path) === row;
      if (hit) found++;
    }
  } catch {
    return found; // never stop a Worker from starting
  }
  return found;
}

/**
 * Registers the catch-all on `app` (before any middleware) and returns its table. `warm` (CPU warm-up (b)1): the forwarder of a warm app (createApp `warm`)
 * for the start-up dry run: no request number, no random id, no `f: 1` mark, no log line. A Worker's real forwarder is always built without it.
 */
export function forwardRoutes(app: App, routes: readonly RouteDef[], warm = false): TrieRouter<RouteDef> {
  const table = forwardTable(routes);
  app.all("/v1/*", async (c, next) => {
    const row = forwardRowOf(table, c.req.method, c.req.path);
    if (!row) return next();
    const w = workerOf(row);
    const { iso, n } = warm ? { iso: "warm", n: 0 } : nextRequestNumber();
    const rid =
      clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? (warm ? "warm" : hex(randomBytes(8)));
    let res: Response;
    try {
      res = await (w === "finance" ? c.env.ADMIN_FINANCE : c.env.ADMIN_API).fetch(c.req.raw);
    } catch (e) {
      // The route PATTERN, never the raw path; never `e.message`.
      if (!warm)
        console.error(
          JSON.stringify({
            level: "error",
            route: row.path,
            message: "admin api binding failed",
            w,
            rid,
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
      c.set("rid", rid);
      // Built outside the middleware chain, so the headers every other /api answer carries are set here.
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return err(c, BAD_GATEWAY, 502);
    }
    // M6.2 (CPU diagnosis, lead decision 4): `f: 1` on this isolate's first forward of the row.
    const f = warm ? undefined : firstRun(`fwd ${row.method} ${row.path}`);
    const line = JSON.stringify({ ev: "fwd", r: row.path, w, s: res.status, rid, iso, n, f });
    if (!warm) console.log(line);
    return res;
  });
  return table;
}
