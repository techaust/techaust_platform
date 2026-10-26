// The front Worker's forwarders (M5.0): for every ROUTES row the API Worker answers, `ADMIN_API.fetch(request)` with the request untouched
// and the response not wrapped. Registered before any middleware (CSRF, body limits and the guard run in the API Worker, once).
// An undeclared path is not forwarded: it gets the front's 404. A binding failure is 502 with the standard error body (LD5).
import { hex, randomBytes } from "@techaust/auth";
import { clipHeader, HEADER_LIMITS } from "@techaust/db/log";
import { type App, nextRequestNumber } from "./app.ts";
import { err, type RouteDef } from "./context.ts";

const BAD_GATEWAY = { code: "bad_gateway", message: "Something went wrong" };

export function forwardRoutes(app: App, routes: readonly RouteDef[]) {
  for (const row of routes) {
    if (row.on === "front") continue;
    // The Hono pattern of the row, below the /api base path.
    app.on(row.method, row.path.slice("/api".length), async (c) => {
      const { iso, n } = nextRequestNumber();
      const rid = clipHeader(c.req.header("cf-ray"), HEADER_LIMITS.requestId) ?? hex(randomBytes(8));
      let res: Response;
      try {
        res = await c.env.ADMIN_API.fetch(c.req.raw);
      } catch (e) {
        // The route PATTERN, never the raw path; never `e.message`.
        console.error(
          JSON.stringify({
            level: "error",
            route: row.path,
            message: "admin api binding failed",
            rid,
            cause: e instanceof Error ? e.name : "unknown",
          }),
        );
        c.set("rid", rid);
        return err(c, BAD_GATEWAY, 502);
      }
      console.log(JSON.stringify({ ev: "fwd", r: row.path, s: res.status, rid, iso, n }));
      return res;
    });
  }
}
