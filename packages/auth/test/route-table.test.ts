// answeringRow: the first matched pattern the table declares, never the last [early check M2].
import { describe, expect, it } from "vitest";
import { answeringRow, firstRun, samplePath, warmRouter } from "../src/route-table.ts";

const table = new Map([
  ["/api/x/:id", { who: "any" }],
  ["/api/x/defaults", { who: "owner" }],
]);
const rowOf = (p: string) => table.get(p);

describe("answeringRow", () => {
  it("takes the first declared pattern, so a static path registered before /:id wins", () => {
    const matched = [{ path: "*" }, { path: "/api/x/defaults" }, { path: "/api/x/:id" }];
    expect(answeringRow(matched, rowOf)).toEqual({ who: "owner" });
  });

  it("skips middleware patterns that are not rows", () => {
    expect(answeringRow([{ path: "*" }, { path: "/api/*" }, { path: "/api/x/:id" }], rowOf)).toEqual({
      who: "any",
    });
  });

  it("is null when no matched pattern is declared (deny by default), and for no match at all", () => {
    expect(answeringRow([{ path: "*" }, { path: "/api/*" }], rowOf)).toBeNull();
    expect(answeringRow([], rowOf)).toBeNull();
  });
});

// M7.1 L19: the router warm-up and the first-run marker, moved here from the admin Worker so the portal shares them. The admin's warm-router.test.ts still pins
// every admin row through the real routers; these pin the helpers on a router of the same shape.
describe("samplePath, warmRouter and firstRun [M6.2 CPU diagnosis, M7.1 L19]", () => {
  it("turns each :param into x", () => {
    expect(samplePath("/api/v1/invoices/:id/realisation-extensions/:eid/letter")).toBe(
      "/api/v1/invoices/x/realisation-extensions/x/letter",
    );
    expect(samplePath("/api/v1/health")).toBe("/api/v1/health");
  });

  // A router of Hono's `match` shape: the catch-all middleware (every method) and one GET route.
  const seen: string[] = [];
  const middleware = [[() => 0, { method: "ALL" }], {}] as const;
  const route = [[() => 0, { method: "GET" }], {}] as const;
  const app = {
    router: {
      match(method: string, path: string) {
        seen.push(`${method} ${path}`);
        return [
          method === "GET" && path === "/api/v1/things/x" ? [middleware, route] : [middleware],
        ] as const;
      },
    },
  };

  it("counts a row only when a route of its own method answers, matching each row `rounds` times", () => {
    seen.length = 0;
    const rows = [
      { method: "GET", path: "/api/v1/things/:id" },
      { method: "POST", path: "/api/v1/things/:id" },
      { method: "GET", path: "/api/v1/none" },
    ];
    expect(warmRouter(app, rows)).toBe(1);
    expect(seen).toHaveLength(9);
    expect(seen.slice(0, 3)).toEqual(Array(3).fill("GET /api/v1/things/x"));
    expect(warmRouter(app, rows, 1)).toBe(1);
  });

  it("never throws: a router that throws stops the warm-up with the count so far", () => {
    const broken = {
      router: {
        match(): never {
          throw new Error("boom");
        },
      },
    };
    expect(warmRouter(broken, [{ method: "GET", path: "/x" }])).toBe(0);
  });

  it("firstRun is 1 once per key, then absent", () => {
    const key = `test ${Math.random()}`;
    expect(firstRun(key)).toBe(1);
    expect(firstRun(key)).toBeUndefined();
    expect(JSON.stringify({ f: firstRun(key) })).toBe("{}");
  });
});
