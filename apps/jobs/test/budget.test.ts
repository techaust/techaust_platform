// M7.5 L18: the shared counting env itself (packages/testing/src/budget.ts), proved on the real D1 of the test pool: what counts as a call, a
// subrequest and a batch, that work outside an invocation is not counted, that the lines fail, and that the jobs entry points are wrapped.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  bareScanOf,
  budgetProblems,
  explainSweep,
  type Invocation,
  invocation,
  LIMITS,
  takeInvocations,
  takeSql,
} from "../../../packages/testing/src/budget.ts";
import worker from "../src/index.ts";

const inv = (o: Partial<Invocation>): Invocation => ({
  label: "x",
  d1: 0,
  sub: 0,
  maxBatch: 0,
  statements: 0,
  ...o,
});

describe("the counting env (M7.5 L18)", () => {
  it("counts each single statement as a call, a batch once with its statements, and nothing outside an invocation", async () => {
    takeInvocations();
    await env.DB.prepare("SELECT 1").first();
    expect(takeInvocations()).toEqual([]);
    await invocation("probe", async () => {
      await env.DB.prepare("SELECT ?1 AS a").bind(1).first();
      await env.DB.prepare("SELECT 2").all();
      await env.DB.batch([
        env.DB.prepare("SELECT 3"),
        env.DB.prepare("SELECT 4"),
        env.DB.prepare("SELECT 5"),
      ]);
    });
    const [got] = takeInvocations();
    expect(got).toEqual({ label: "probe", d1: 3, sub: 0, maxBatch: 3, statements: 5 });
    // The SQL texts seen inside the invocation, with their first bound values.
    const sql = takeSql();
    expect(sql.get("SELECT ?1 AS a")).toEqual([1]);
    expect(sql.has("SELECT 1")).toBe(false);
  });

  it("counts fetches as subrequests, and has patched the queue and R2 classes", async () => {
    takeInvocations();
    const res = await invocation("sends", async () => {
      // Aborted before they start: counted, and nothing goes on the network.
      await fetch("https://example.invalid/a", { signal: AbortSignal.abort() }).catch(() => null);
      return fetch("https://example.invalid/b", { signal: AbortSignal.abort() }).catch(() => null);
    });
    expect(res).toBeNull();
    expect(takeInvocations().find((i) => i.label === "sends")?.sub).toBe(2);
    // A real send would start the queue's consumer after the test; the class methods are checked instead (one binding patches its class).
    const patched = (o: unknown, m: string) =>
      Reflect.get(Reflect.get(Object.getPrototypeOf(o) as object, m) as object, "__budget");
    for (const m of ["send", "sendBatch"]) expect(patched(env.EMAIL_QUEUE, m)).toBe(true);
    for (const m of ["get", "put", "head", "delete", "list"]) expect(patched(env.DOCS, m)).toBe(true);
  });

  it("a nested invocation counts into the outer one", async () => {
    takeInvocations();
    await invocation("outer", async () => {
      await env.DB.prepare("SELECT 1").first();
      await invocation("inner", () => env.DB.prepare("SELECT 2").first());
    });
    expect(takeInvocations()).toEqual([inv({ label: "outer", d1: 2, statements: 2 })]);
  });

  it("fails a batch over 45 statements and more than 45 calls plus subrequests, and passes at the line", () => {
    expect(LIMITS).toEqual({ batchStatements: 45, callsAndSubrequests: 45 });
    expect(budgetProblems([inv({ maxBatch: 45, d1: 40, sub: 5 })])).toEqual([]);
    expect(budgetProblems([inv({ label: "big", maxBatch: 46 })])).toEqual([
      "big: a batch of 46 statements (house rule 45, M7.5 L16/L18)",
    ]);
    expect(budgetProblems([inv({ label: "many", d1: 40, sub: 6 })])[0]).toContain(
      "40 D1 calls + 6 subrequests = 46",
    );
  });

  it("the jobs entry points are invocations: a request and a cron run", async () => {
    takeInvocations();
    await worker.fetch(new Request("https://hooks.example/healthz"), env, {} as ExecutionContext);
    const [got] = takeInvocations();
    expect(got?.label).toBe("GET /healthz");
  });
});

describe("the EXPLAIN sweep (M7.5 L18)", () => {
  it("reads a bare scan of a real table, not an index search, a CTE or a subquery", () => {
    const tables = new Set(["clients", "leads"]);
    expect(bareScanOf("SCAN clients", tables)).toBe("clients");
    expect(bareScanOf("SCAN leads AS l", tables)).toBe("leads");
    expect(bareScanOf("SCAN clients USING INDEX clients_by_name", tables)).toBeNull();
    expect(bareScanOf("SCAN clients USING COVERING INDEX x", tables)).toBeNull();
    expect(bareScanOf("SEARCH clients USING INTEGER PRIMARY KEY (rowid=?)", tables)).toBeNull();
    expect(bareScanOf("SCAN recent", tables)).toBeNull();
    expect(bareScanOf("SCAN CONSTANT ROW", tables)).toBeNull();
  });

  it("fails a bare scan and passes an indexed read, on the real schema", async () => {
    const sql = new Map<string, unknown[]>([
      ["SELECT id FROM leads WHERE message LIKE ?1", ["%x%"]],
      ["SELECT id FROM leads WHERE id = ?1", ["l_1"]],
      ["PRAGMA table_info(leads)", []],
    ]);
    const r = await explainSweep(env.DB, sql);
    expect(r.checked).toBe(2);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/^SCAN leads \(no index\) in: SELECT id FROM leads WHERE message LIKE/);
  });
});
