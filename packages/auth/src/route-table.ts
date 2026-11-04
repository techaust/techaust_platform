// Which row of a Worker's route table answers a request (admin and portal share it). Hono names the matched route patterns in
// registration order: middleware first, then the handler that answers. A static path registered before `/:id` (`/care-plans/defaults`)
// is the one Hono runs, but the LAST match is `/:id`, whose table row may allow other roles. So the row is the FIRST matched pattern
// that the table declares, never the last. The Workers pass `matchedRoutes(c)` from `hono/route` (the deprecated `c.req.matchedRoutes`
// is not used); this file takes only the patterns, so it needs no Hono import.

/** What `matchedRoutes(c)` gives for each route: only the pattern is read. */
export type MatchedRoute = { readonly path: string };

/** The table row of the handler that answers: the first matched pattern the table declares, or null (undeclared: deny by default). */
export function answeringRow<T>(
  matched: readonly MatchedRoute[],
  rowOf: (pattern: string) => T | undefined,
): T | null {
  for (const m of matched) {
    const row = rowOf(m.path);
    if (row !== undefined) return row;
  }
  return null;
}

// The router warm-up (M6.2 CPU diagnosis, lead decision 1, 2026-11-01; shared by the admin and portal Workers since M7.1 L19). `hono/tiny`'s PatternRouter
// runs every same-method route regex on each request, and V8 compiles a regex on its first use and again when it tiers up, so an isolate's first requests paid
// for the regexes of every row they passed, inside the metered request. Matching each row a Worker answers three times while the module loads moves that cost
// to the isolate's start, which the Free plan's 10 ms CPU limit does not meter. Pure: no `env`, no `Request`, no I/O; only `app.router.match` on made-up
// paths (each `:param` becomes `x`). Typed by shape, so this file still needs no Hono import.

/** A row's pattern as a concrete path: every `:param` segment becomes `x` (`/api/v1/invoices/:id/pdf` → `/api/v1/invoices/x/pdf`). */
export const samplePath = (pattern: string): string => pattern.replace(/:[A-Za-z0-9_]+/g, "x");

/** What the warm-up reads of a Hono app: its router's `match`, whose handlers are `[[handler, {method}], params]` (Hono's `Result`). */
export type WarmableApp = {
  readonly router: {
    match(
      method: string,
      path: string,
    ): readonly [
      ReadonlyArray<readonly [readonly [unknown, { readonly method: string }], unknown]>,
      ...unknown[],
    ];
  };
};

/**
 * Matches each row's sample path `rounds` times through the app's router; returns how many rows found a ROUTE handler of the row's own method (the middleware,
 * registered for every method, matches any path and is not counted). Never throws.
 */
export function warmRouter(
  app: WarmableApp,
  rows: readonly { readonly method: string; readonly path: string }[],
  rounds = 3,
): number {
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

/**
 * M6.2 CPU diagnosis (lead decision 4, 2026-11-01): the patterns this isolate has answered, so a log line can say "first run here" (`f: 1`) and the staging CPU
 * gate reads first runs directly. Keys are route PATTERNS (`GET /api/v1/invoices/:id`), forwards (`fwd GET ...`) and RPC methods (`rpc processEvent`): never a
 * raw path, an id or anything personal. Bounded (the route table is finite; at most 512 keys are remembered). One set per Worker bundle (each Worker is its
 * own isolate), shared by every caller inside it.
 */
const answered = new Set<string>();
export function firstRun(key: string): 1 | undefined {
  if (answered.has(key)) return undefined;
  if (answered.size < 512) answered.add(key);
  return 1;
}
