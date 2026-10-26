// The guard row of a request is the FIRST matched pattern the table declares [ADM-G-02, early check M2]. Hono runs a static path
// registered before `/:id` (`/care-plans/defaults`), but the last match is `/:id`, whose row may allow other roles. This proves, for every
// row of ROUTES, that a request to its own path (the `:params` filled with samples) resolves to that very row, through the Hono router
// the Worker uses and the shared helper the middleware calls.
import { answeringRow } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { ROUTES, routeFor } from "./guard.ts";
import { createApp } from "./test-app.ts";

const app = createApp();
const fill = (path: string) => path.replace(/:\w+/g, "sample-1");
/** What `matchedRoutes(c)` of `hono/route` returns for a request: the registered route of every matching handler, in order. */
const matched = (method: string, path: string) =>
  app.router.match(method as never, path)[0].map(([[, route]]) => route as { path: string });

describe("every ROUTES row is the row its own path resolves to", () => {
  it("the table has rows to prove", () => expect(ROUTES.length).toBeGreaterThan(100));

  for (const r of ROUTES) {
    it(`${r.method} ${r.path}`, () => {
      const row = answeringRow(matched(r.method, fill(r.path)), (p) => routeFor(r.method, p));
      expect(row?.path).toBe(r.path);
      expect(row?.method).toBe(r.method);
      expect(row?.access).toBe(r.access);
    });
  }

  it("a path the table does not declare resolves to no row (deny by default)", () => {
    expect(answeringRow(matched("GET", "/api/v1/not-a-route"), (p) => routeFor("GET", p))).toBeNull();
  });

  it("the first match wins over the last: /care-plans/defaults is carePlans.write, not the /:id row", () => {
    const m = matched("GET", "/api/v1/care-plans/defaults");
    expect(m.map((x) => x.path)).toContain("/api/v1/care-plans/:id");
    expect(answeringRow(m, (p) => routeFor("GET", p))?.access).toBe("carePlans.write");
  });
});
