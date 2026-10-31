// The router warm-up (M6.2 CPU diagnosis, lead decision 1, 2026-11-01). `hono/tiny`'s PatternRouter runs every same-method route regex on each request, and V8
// compiles a regex on its first use and again when it tiers up, so an isolate's first requests paid for the regexes of every row they passed (the front holds
// ~184 rows, mostly the forwarders), inside the metered request. Matching each row this Worker answers three times while the module loads moves that cost to the
// isolate's start, which the Free plan's 10 ms CPU limit does not meter. Pure: no `env`, no `Request`, no I/O; only `app.router.match` on made-up paths
// (each `:param` becomes `x`).
import type { App } from "./app.ts";
import type { RouteDef } from "./context.ts";

/** A row's pattern as a concrete path: every `:param` segment becomes `x` (`/api/v1/invoices/:id/pdf` → `/api/v1/invoices/x/pdf`). */
export const samplePath = (pattern: string): string => pattern.replace(/:[A-Za-z0-9_]+/g, "x");

/**
 * Matches each row's sample path `rounds` times through the app's router; returns how many rows found a ROUTE handler of the row's own method (the middleware,
 * registered for every method, matches any path and is not counted). Never throws.
 */
export function warmRouter(app: App, rows: readonly RouteDef[], rounds = 3): number {
  let matched = 0;
  try {
    for (const row of rows) {
      const path = samplePath(row.path);
      let hit = false;
      for (let i = 0; i < rounds; i++) {
        const [handlers] = app.router.match(row.method, path);
        if (handlers.some((h) => h[0][1].method === row.method)) hit = true;
      }
      if (hit) matched++;
    }
  } catch {
    return matched; // never stop a Worker from starting
  }
  return matched;
}
