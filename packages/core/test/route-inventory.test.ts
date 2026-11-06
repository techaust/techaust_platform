// M7.5 B2 (brief B, I1): the route inventory's pure check. Every row has exactly one reading or one named proxy with its reason, NFR-2's limits for its
// kind, and its figures within them; the check fails otherwise.
import { describe, expect, it } from "vitest";
import {
  type Inventory,
  type InventoryRow,
  inventoryCounts,
  inventoryProblems,
  limitsFor,
  patternMatches,
} from "../src/route-inventory.ts";

const row = (o: Partial<InventoryRow> = {}): InventoryRow => ({
  id: "admin-api GET /api/v1/leads",
  worker: "admin-api",
  kind: "route",
  method: "GET",
  path: "/api/v1/leads",
  limits: { firstMs: 7, warmP99Ms: 7 },
  measure: { type: "reading", via: "bench" },
  d1: null,
  ...o,
});
const inv = (...rows: InventoryRow[]): Inventory => ({
  version: 1,
  generatedAt: "2026-11-07T00:00:00Z",
  rows,
});

describe("limits (NFR-2, brief I1)", () => {
  it("sign-in 5 (the M1.4 exception 6), hooks 5, crons 5, RPC first call 7, the rest 7; warm p99 7 everywhere", () => {
    expect(limitsFor("login")).toEqual({ firstMs: 5, warmP99Ms: 7 });
    expect(limitsFor("login", { loginException: true })).toEqual({ firstMs: 6, warmP99Ms: 7 });
    expect(limitsFor("hook")).toEqual({ firstMs: 5, warmP99Ms: 7 });
    expect(limitsFor("cron")).toEqual({ firstMs: 5, warmP99Ms: 7 });
    expect(limitsFor("rpc")).toEqual({ firstMs: 7, warmP99Ms: 7 });
    expect(limitsFor("queue")).toEqual({ firstMs: 7, warmP99Ms: 7 });
    expect(limitsFor("route")).toEqual({ firstMs: 7, warmP99Ms: 7 });
  });
});

describe("inventoryProblems", () => {
  it("passes a reading and a named proxy with a reason", () => {
    expect(
      inventoryProblems(
        inv(
          row(),
          row({
            id: "admin-api POST /api/v1/leads",
            method: "POST",
            measure: {
              type: "proxy",
              name: "local-first-request-probe",
              reason: "a write the bench can't undo",
              probeMs: 2.5,
            },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("fails a row with no measure, a proxy that isn't named or has no reason, and a row with both", () => {
    expect(inventoryProblems(inv(row({ measure: null })))).toEqual([
      "admin-api GET /api/v1/leads: no reading and no named proxy",
    ]);
    expect(
      inventoryProblems(
        inv(row({ measure: { type: "proxy", name: "guess" as never, reason: "because it is" } })),
      ).join(),
    ).toContain("is not a named proxy");
    expect(
      inventoryProblems(
        inv(row({ measure: { type: "proxy", name: "local-first-request-probe", reason: "" } })),
      ).join(),
    ).toContain("needs its reason");
    expect(
      inventoryProblems(
        inv(row({ measure: { type: "reading", via: "bench", name: "x", reason: "y" } as never })),
      ).join(),
    ).toContain("a reading and a proxy at once");
    expect(inventoryProblems(inv(row({ measure: { type: "other" } as never }))).join()).toContain("must be");
  });

  it("fails figures over the row's limits, over 10 ms, and a proxy over 2.5 ms", () => {
    const p = inventoryProblems(
      inv(
        row({ measure: { type: "reading", via: "bench", firstMs: 7.5, warmP99Ms: 11 } }),
        row({
          id: "x",
          measure: {
            type: "proxy",
            name: "local-first-request-probe",
            reason: "a write it can't undo",
            probeMs: 3,
          },
        }),
      ),
    ).join("\n");
    expect(p).toContain("first run 7.5 ms over its 7 ms");
    expect(p).toContain("warm p99 11 ms over 7 ms");
    expect(p).toContain("over the Free plan's 10 ms");
    expect(p).toContain("local first request 3 ms over 2.5 ms");
  });

  it("fails limits that aren't NFR-2's for the kind, a duplicate id, unknown workers and kinds, an empty inventory", () => {
    expect(inventoryProblems(inv(row({ kind: "login" }))).join()).toContain("limits must be first 5 ms");
    expect(
      inventoryProblems(inv(row({ kind: "login", limits: { firstMs: 6, warmP99Ms: 7 } })), {
        loginExceptions: ["admin-api GET /api/v1/leads"],
      }),
    ).toEqual([]);
    expect(inventoryProblems(inv(row(), row())).join()).toContain("listed twice");
    expect(inventoryProblems(inv(row({ worker: "x" as never }))).join()).toContain("unknown worker");
    expect(inventoryProblems(inv(row({ kind: "x" as never }))).join()).toContain("unknown kind");
    expect(inventoryProblems(inv())).toEqual(["inventory has no rows"]);
    expect(inventoryProblems({ ...inv(row()), version: 2 as never })).toEqual([
      "inventory version must be 1",
    ]);
    expect(
      inventoryProblems(inv(row({ measure: { type: "reading", via: "guess" as never } }))).join(),
    ).toContain("unknown reading source");
  });

  it("fails D1 figures over the house line of 45 (L16)", () => {
    expect(inventoryProblems(inv(row({ d1: { calls: 40, subrequests: 5, maxBatch: 45 } })))).toEqual([]);
    const p = inventoryProblems(inv(row({ d1: { calls: 40, subrequests: 6, maxBatch: 46 } }))).join("\n");
    expect(p).toContain("40 D1 calls + 6 subrequests over 45");
    expect(p).toContain("a batch of 46 statements over 45");
  });
});

describe("helpers", () => {
  it("counts per worker, kind and measure", () => {
    expect(inventoryCounts([row(), row({ id: "q", worker: "jobs", kind: "queue", measure: null })])).toEqual({
      "admin-api": 1,
      jobs: 1,
      "kind:route": 1,
      "kind:queue": 1,
      "measure:reading": 1,
      "measure:none": 1,
    });
  });

  it("matches a path pattern against a concrete path", () => {
    expect(patternMatches("/api/v1/invoices/:id", "/api/v1/invoices/inv_1")).toBe(true);
    expect(patternMatches("/api/v1/invoices/:id", "/api/v1/invoices/inv_1?x=1")).toBe(true);
    expect(patternMatches("/api/v1/invoices/:id", "/api/v1/invoices/inv_1/pdf")).toBe(false);
    expect(patternMatches("/api/v1/invoices/:id", "/api/v1/clients/c_1")).toBe(false);
    expect(patternMatches("/api/forms/*", "/api/forms/contact")).toBe(true);
  });
});
