// The front Worker's forwarders (M5.0; the third Worker in M6.1 stage A, ADM-PAY-01): for every ROUTES row another admin Worker answers,
// `<binding>.fetch(request)` with the request untouched and the response not wrapped: `ADMIN_FINANCE` for a row marked `on: "finance"`,
// `ADMIN_API` for every other non-front row. Registered before any middleware (CSRF, body limits and the guard run in the Worker that
// answers, once). An undeclared path is not forwarded: it gets the front's 404. A binding failure is 502 with the standard error body (LD5).
import { hex, randomBytes } from "@techaust/auth";
import { clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { type App, nextRequestNumber } from "./app.ts";
import { err, type RouteDef } from "./context.ts";

const BAD_GATEWAY = { code: "bad_gateway", message: "Something went wrong" };

/** Which Worker answers a forwarded row: `w` in the log lines ("api" or "finance"). */
export const workerOf = (row: RouteDef): "api" | "finance" => (row.on === "finance" ? "finance" : "api");

export function forwardRoutes(app: App, routes: readonly RouteDef[]) {
  for (const row of routes) {
    if (row.on === "front") continue;
    const w = workerOf(row);
    // The Hono pattern of the row, below the /api base path.
    app.on(row.method, row.path.slice("/api".length), async (c) => {
      const { iso, n } = nextRequestNumber();
      const rid = clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? hex(randomBytes(8));
      let res: Response;
      try {
        res = await (w === "finance" ? c.env.ADMIN_FINANCE : c.env.ADMIN_API).fetch(c.req.raw);
      } catch (e) {
        // The route PATTERN, never the raw path; never `e.message`.
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
      console.log(JSON.stringify({ ev: "fwd", r: row.path, w, s: res.status, rid, iso, n }));
      return res;
    });
  }
}
