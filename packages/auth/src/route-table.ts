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
