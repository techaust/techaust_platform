/// <reference types="vite/client" />
// The admin Worker split (M5.0, docs/13 2026-10-27): a front Worker (SPA, sign-in, account, staff) that forwards every other ROUTES row
// over the ADMIN_API binding, and an API Worker that answers them. Proves: every row has one owner; the front forwards untouched and
// touches nothing else; the same statuses and error codes come back through the front as from the combined app; the API app refuses
// what is not its own and what carries no session; a binding failure is a 502; an upload streams across the binding; and no API
// source names a sign-in secret.
// M6.1 stage A (ADM-PAY-01): a third Worker, finance, answers the rows marked `on: "finance"` over the ADMIN_FINANCE binding and exports
// `BillingJobs`. Proves the same for it: one owner per row, the forwarder picks the right binding per row (and never the other), parity
// through the front, the finance app refuses what is not its own, and `BillingJobs` is exported by finance only.
// The fourth admin Worker (2026-11-03, ADM-G-02; docs/runs/admin-split-plan.md F.1): the invoices Worker answers the rows marked `on: "invoices"` over the
// ADMIN_INVOICES binding and exports `BillingJobs` and `GatewayAdvance`; the finance Worker keeps the payments side and `GatewayEvents`/`PortalPayments`.
// Ownership both ways for the three-way split, the forwarder's binding per row, parity through the front, and the entrypoints per Worker.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { decide, ROLES, type Role } from "@techaust/core";
import { PatternRouter } from "hono/router/pattern-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import api, * as apiModule from "./api.ts";
import { createApp } from "./app.ts";
import finance, * as financeModule from "./finance.ts";
import { forwardRoutes, forwardRowOf, forwardTable, workerOf } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import front, * as frontModule from "./index.ts";
import invoicing, * as invoicingModule from "./invoicing.ts";
import { mountApi } from "./routes-api.ts";
import { mountFinance } from "./routes-finance.ts";
import { mountFront } from "./routes-front.ts";
import { mountInvoices } from "./routes-invoices.ts";
import combined from "./test-app.ts";
import { mkClient } from "./test-clients.ts";
import {
  bodyOf,
  counted,
  countOf,
  ORIGIN,
  one,
  sampleRequest,
  sessionFor,
  withAdvance,
  withEnv,
} from "./test-helpers.ts";
import { pdfOfSize, sha256Hex } from "./test-projects.ts";
import { samplePath } from "./warm-router.ts";

const SECRETS = ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY", "TURNSTILE_SECRET"];
const FRONT_ROWS = ROUTES.filter((r) => r.on === "front");
const API_ROWS = ROUTES.filter((r) => r.on === undefined);
const FINANCE_ROWS = ROUTES.filter((r) => r.on === "finance");
const INVOICES_ROWS = ROUTES.filter((r) => r.on === "invoices");
/** Every row the front forwards (to the API, the invoices or the finance Worker). */
const FORWARDED_ROWS = ROUTES.filter((r) => r.on !== "front");
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The bindings the API, invoices and finance Workers have (wrangler.{api,invoices,finance}.jsonc): no sign-in secrets, no assets, none of the front's service
 * bindings. The finance Worker's own ADMIN_ADVANCE is the in-process `GatewayAdvance` (test-helpers.ts `withAdvance`).
 */
const apiEnv: Env = withEnv(env, {
  ...Object.fromEntries(SECRETS.map((s) => [s, undefined])),
  TURNSTILE_SITE_KEY: undefined,
  TURNSTILE_HOSTNAMES: undefined,
  ASSETS: undefined,
  ADMIN_API: undefined,
  ADMIN_FINANCE: undefined,
  ADMIN_INVOICES: undefined,
});
const invoicesEnv: Env = apiEnv;
const financeEnv: Env = withAdvance(apiEnv);

const BINDINGS = ["ADMIN_API", "ADMIN_FINANCE", "ADMIN_INVOICES"] as const;
type Binding = (typeof BINDINGS)[number];

/** The binding name of the Worker that answers a forwarded row. */
const bindingOf = (row: (typeof ROUTES)[number]): Binding =>
  row.on === "finance" ? "ADMIN_FINANCE" : row.on === "invoices" ? "ADMIN_INVOICES" : "ADMIN_API";

/** `stub` on the row's own binding and `other` on the two others. */
const bindingsFor = (row: (typeof ROUTES)[number], stub: unknown, other: unknown) =>
  Object.fromEntries(BINDINGS.map((b) => [b, b === bindingOf(row) ? stub : other]));

/** The same stub on every binding. */
const allBindings = (stub: unknown) => Object.fromEntries(BINDINGS.map((b) => [b, stub]));

type Seen = { req: Request; bytes: Uint8Array };

/** Runs a request through an app entry with its own execution context, waiting for every `waitUntil` (the access-log write) to settle. */
async function run(
  app: { fetch: (r: Request, e: Env, c: ExecutionContext) => Response | Promise<Response> },
  req: Request,
  e: Env,
) {
  const ctx = createExecutionContext();
  const res = await app.fetch(req, e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** The ADMIN_API binding as the API Worker would answer it (its own env), to be waited for after the front's response. */
function realApi(pending: Promise<unknown>[] = []) {
  return {
    fetch: async (req: Request) => {
      const ctx = createExecutionContext();
      const res = await api.fetch(req, apiEnv, ctx);
      pending.push(waitOnExecutionContext(ctx));
      return res;
    },
  };
}

/** The ADMIN_FINANCE binding as the finance Worker would answer it (its own env). */
function realFinance(pending: Promise<unknown>[] = []) {
  return {
    fetch: async (req: Request) => {
      const ctx = createExecutionContext();
      const res = await finance.fetch(req, financeEnv, ctx);
      pending.push(waitOnExecutionContext(ctx));
      return res;
    },
  };
}

/** The ADMIN_INVOICES binding as the invoices Worker would answer it (its own env). */
function realInvoices(pending: Promise<unknown>[] = []) {
  return {
    fetch: async (req: Request) => {
      const ctx = createExecutionContext();
      const res = await invoicing.fetch(req, invoicesEnv, ctx);
      pending.push(waitOnExecutionContext(ctx));
      return res;
    },
  };
}

/** Every binding as the real Workers would answer them. */
const realAll = (pending: Promise<unknown>[] = []) => ({
  ADMIN_API: realApi(pending),
  ADMIN_FINANCE: realFinance(pending),
  ADMIN_INVOICES: realInvoices(pending),
});

const jsonHeaders = (cookie?: string, extra: Record<string, string> = {}) => ({
  "Content-Type": "application/json",
  Origin: ORIGIN,
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": "SplitTest/1.0",
  "CF-Connecting-IP": "203.0.113.7",
  ...(cookie ? { Cookie: cookie } : {}),
  ...extra,
});

type Opts = { cookie?: string; origin?: string; big?: boolean };

/** A request to a row's own path, as the SPA would send it. */
function requestFor(row: (typeof ROUTES)[number], o: Opts = {}) {
  const { path, init } = sampleRequest(row);
  const method = init.method;
  const headers: Record<string, string> = jsonHeaders(o.cookie, o.origin ? { Origin: o.origin } : {});
  let body: BodyInit | null = null;
  if ("raw" in init && init.raw) {
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Length"] = String(init.raw.byteLength);
    body = init.raw;
  } else if (MUTATING.has(method) && "body" in init) {
    body = o.big ? JSON.stringify({ pad: "x".repeat(200_000) }) : JSON.stringify(init.body ?? {});
  }
  if (body === null) delete headers["Content-Type"];
  return new Request(`${ORIGIN}/api/v1${path}`, { method, headers, body });
}

const codeOf = async (res: Response) => {
  const j = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string } } | null;
  return j?.error?.code ?? null;
};
const outcome = async (res: Response) => ({ status: res.status, code: await codeOf(res) });

let sessions: Record<string, Awaited<ReturnType<typeof sessionFor>>> | undefined;
async function sess(role: Role, stepUp: boolean) {
  sessions ??= {};
  const k = `${role}:${stepUp}`;
  sessions[k] ??= await sessionFor(role, { stepUp });
  return sessions[k];
}

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------------------
describe("every ROUTES row has one owner", () => {
  const routesOf = (app: { routes: { method: string; path: string }[] }) =>
    [...new Set(app.routes.filter((r) => r.method !== "ALL").map(key))].sort();

  it("the table has front, API, invoices and finance rows, and no row is two of them", () => {
    expect(FRONT_ROWS.length).toBe(24);
    // M6.1 (added on purpose): 15 payment rows (payments, a client's credit, an invoice's panel, credit release, FEMA extensions, the payments register);
    // main's proforma withdraw (ADM-INV-10) joins them as an invoice route.
    // M6.2: seven gateway rows (payment links, Needs review, the gateways' status).
    // M6.4: eight remittance advice rows (the list, add, one advice, its file both ways, link, the Owner's remove, Without advice).
    // The fourth admin Worker (2026-11-03, brief A.2): the 61 finance rows of M6.4 split 32 (invoices) and 29 (finance).
    expect(INVOICES_ROWS.length).toBe(32);
    expect(FINANCE_ROWS.length).toBe(29);
    expect(API_ROWS.length).toBe(ROUTES.length - 24 - 32 - 29);
    expect(new Set([...FRONT_ROWS, ...API_ROWS, ...INVOICES_ROWS, ...FINANCE_ROWS].map(key)).size).toBe(
      ROUTES.length,
    );
    // Every row has one of the four owners (an unknown `on` would be forwarded to the API Worker).
    for (const r of ROUTES) expect([undefined, "front", "invoices", "finance"], key(r)).toContain(r.on);
  });

  it("the front rows are health, sign-in, the member's account and staff management", () => {
    for (const r of FRONT_ROWS) {
      expect(r.path.startsWith("/api/v1/health") || /^\/api\/v1\/(auth|users)(\/|$)/.test(r.path)).toBe(true);
    }
    for (const r of FORWARDED_ROWS) expect(r.path).not.toMatch(/^\/api\/v1\/(health|auth|users)(\/|$)/);
  });

  // The fourth admin Worker (brief A.2): invoices, notes, their sends and PDFs, a client's invoices and statement, reports, approvals and the dashboard go to
  // the invoices Worker; payments, the ledger panels, credit, advices and the gateways stay in the finance Worker.
  const INVOICES =
    /^\/api\/v1\/(invoices(\/:id(\/(issue|issue-request|void|withdraw|service-completed|advance-invoice|credit-note|debit-note|ims-status|pdf|pdf\/supplier|pdf\/retry|send|links\/revoke|reminders\/(pause|resume)))?)?$|clients\/:id\/invoices$|clients\/:id\/statement(\/|$)|reports\/|approvals(\/|$)|dashboard$)/;
  const FINANCE =
    /^\/api\/v1\/(payments(\/|$)|clients\/:id\/credit(\/|$)|invoices\/:id\/(payment-link(\/cancel)?|payments|credit\/release|realisation-extensions(\/:eid\/letter)?)$)/;

  it("the invoices rows are invoices and notes, a client's invoices and statement, reports, approvals and the dashboard (the fourth admin Worker)", () => {
    for (const r of INVOICES_ROWS) expect(r.path, key(r)).toMatch(INVOICES);
    // The other way: no API or finance row matches, so an invoice route can't be left behind.
    for (const r of [...API_ROWS, ...FINANCE_ROWS]) expect(r.path, key(r)).not.toMatch(INVOICES);
  });

  it("the finance rows are payments, TDS, credit, an invoice's ledger panel and credit moves, FEMA extensions, payment links, Needs review, advices and the gateways", () => {
    for (const r of FINANCE_ROWS) expect(r.path, key(r)).toMatch(FINANCE);
    for (const r of [...API_ROWS, ...INVOICES_ROWS]) expect(r.path, key(r)).not.toMatch(FINANCE);
    // The client's money summary and the proposal and estimate routes (their PDFs too) stay in the API Worker.
    for (const p of [
      "/api/v1/clients/:id/finance",
      "/api/v1/documents/:id/pdf",
      "/api/v1/documents/:id/approval-request",
    ])
      expect(API_ROWS.map((r) => r.path)).toContain(p);
  });

  it("the front, API, invoices and finance apps each mount exactly their own rows, and together exactly ROUTES (parity)", () => {
    expect(routesOf(createApp(mountFront))).toEqual(FRONT_ROWS.map(key).sort());
    expect(routesOf(createApp(mountApi))).toEqual(API_ROWS.map(key).sort());
    expect(routesOf(createApp(mountInvoices))).toEqual(INVOICES_ROWS.map(key).sort());
    expect(routesOf(createApp(mountFinance))).toEqual(FINANCE_ROWS.map(key).sort());
    const union = [mountFront, mountApi, mountInvoices, mountFinance].flatMap((m) => routesOf(createApp(m)));
    expect(union.sort()).toEqual(ROUTES.map(key).sort());
  });

  it("no handler is mounted twice (early check B1: a router mounted twice registers its routes twice)", () => {
    // A route's middleware and handler are separate entries, so the same path appears more than once; the same FUNCTION on the same path never should.
    for (const app of [
      createApp(mountFront),
      createApp(mountApi),
      createApp(mountInvoices),
      createApp(mountFinance),
    ]) {
      const seen = new Map<string, Set<unknown>>();
      const twice: string[] = [];
      for (const r of app.routes.filter((x) => x.method !== "ALL")) {
        const fns = seen.get(key(r)) ?? new Set<unknown>();
        if (fns.has(r.handler)) twice.push(key(r));
        fns.add(r.handler);
        seen.set(key(r), fns);
      }
      expect(twice).toEqual([]);
    }
  });

  it("the front entry answers its own rows and forwards every other row through its table (CPU warm-up (b)2)", () => {
    expect(routesOf(front)).toEqual(FRONT_ROWS.map(key).sort());
    // One catch-all, every method, below /api/v1.
    expect(front.routes.filter((r) => r.method === "ALL" && r.path === "/api/v1/*")).toHaveLength(1);
    const table = forwardTable(ROUTES);
    for (const r of FORWARDED_ROWS) expect(forwardRowOf(table, r.method, samplePath(r.path)), key(r)).toBe(r);
    for (const r of FRONT_ROWS)
      expect(forwardRowOf(table, r.method, samplePath(r.path)), key(r)).toBeUndefined();
  });

  it("the table forwards exactly what one route per forwarded row did: the first matching row in table order, or none (CPU warm-up (b)2)", () => {
    // The pre-(b)2 forwarder: one PatternRouter route per forwarded row, in table order; the first match answered.
    const perRow = new PatternRouter<(typeof ROUTES)[number]>();
    for (const r of FORWARDED_ROWS) perRow.add(r.method, r.path, r);
    const table = forwardTable(ROUTES);
    const paths = new Set<string>();
    for (const r of ROUTES) {
      const p = samplePath(r.path);
      for (const v of [
        p,
        `${p}/`,
        `${p}/x`,
        p.replace(/\/x(\/|$)/, "/defaults$1"),
        p.replace(/\/x(\/|$)/, "/new$1"),
      ])
        paths.add(v);
    }
    for (const extra of [
      "/api/v1",
      "/api/v1/",
      "/api/v1/not-a-route",
      "/api/other",
      "/api/v1/invoices/x/y/z",
      "/api/v1//invoices",
    ])
      paths.add(extra);
    let compared = 0;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of paths) {
        const [old] = perRow.match(method, path);
        expect(forwardRowOf(table, method, path), `${method} ${path}`).toBe(old[0]?.[0]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });

  it("forwardRoutes returns the very table its catch-all looks requests up in, the one the entry warms (early check finding 8)", async () => {
    let table: ReturnType<typeof forwardTable> | undefined;
    const app = createApp(mountFront, (a) => {
      table = forwardRoutes(a, ROUTES);
    });
    expect(table).toBeDefined();
    const match = vi.spyOn(table as ReturnType<typeof forwardTable>, "match");
    const stub = { fetch: vi.fn(async () => new Response("from the stub", { status: 207 })) };
    const res = await run(
      app,
      new Request(`${ORIGIN}/api/v1/dashboard`, { headers: jsonHeaders() }),
      withEnv(env, allBindings(stub)),
    );
    expect(res.status).toBe(207);
    expect(match).toHaveBeenCalledWith("GET", "/api/v1/dashboard");
  });

  it("every forwarded row is non-public", () => {
    for (const r of FORWARDED_ROWS) expect(r.access, key(r)).not.toBe("public");
  });

  it("the forwarder names the invoices Worker for invoices rows, the finance Worker for finance rows and the API Worker for the rest", () => {
    for (const r of INVOICES_ROWS) expect(workerOf(r), key(r)).toBe("invoices");
    for (const r of FINANCE_ROWS) expect(workerOf(r), key(r)).toBe("finance");
    for (const r of API_ROWS) expect(workerOf(r), key(r)).toBe("api");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("forwarding fidelity: the front passes the request on untouched", () => {
  for (const row of FORWARDED_ROWS) {
    it(`${key(row)}: one call to ${bindingOf(row)}, none to the other bindings, same request, no D1 call, no access row`, async () => {
      const o = await sess("owner", true);
      const req = requestFor(row, { cookie: o.cookie });
      const sent = new Request(req.clone());
      const sentBytes = new Uint8Array(await sent.arrayBuffer());
      const seen: Seen[] = [];
      const stub = {
        fetch: async (r: Request) => {
          seen.push({ req: r, bytes: new Uint8Array(await r.clone().arrayBuffer()) });
          return new Response("from the stub", { status: 207, headers: { "X-Stub": "1" } });
        },
      };
      const other = { fetch: vi.fn(async () => new Response("wrong worker", { status: 418 })) };
      const bindings = bindingsFor(row, stub, other);
      const c = counted();
      const before = await countOf("access_log");
      const res = await run(front, req, withEnv(c.env, bindings));
      expect(other.fetch).not.toHaveBeenCalled();
      expect(seen).toHaveLength(1);
      const got = seen[0] as Seen;
      expect(got.req.method).toBe(sent.method);
      expect(got.req.url).toBe(sent.url);
      for (const h of [
        "Cookie",
        "Origin",
        "Sec-Fetch-Site",
        "Content-Type",
        "Content-Length",
        "User-Agent",
        "CF-Connecting-IP",
      ]) {
        expect(got.req.headers.get(h), h).toBe(sent.headers.get(h));
      }
      expect([...got.req.headers].sort()).toEqual([...sent.headers].sort());
      expect(got.bytes).toEqual(sentBytes);
      // The response is the stub's own, not wrapped.
      expect(res.status).toBe(207);
      expect(res.headers.get("X-Stub")).toBe("1");
      expect(await res.text()).toBe("from the stub");
      expect(c.calls()).toBe(0);
      expect(await countOf("access_log")).toBe(before);
    });
  }

  it("front rows never call any binding", async () => {
    // No cookie: the sign-out and revoke-all rows would end the sessions the other tests share.
    const stub = { fetch: vi.fn(async () => new Response("no")) };
    for (const row of FRONT_ROWS) {
      await run(front, requestFor(row, {}), withEnv(env, allBindings(stub)));
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("an undeclared path is a 404 from the front and is never forwarded", async () => {
    const o = await sess("owner", true);
    const stub = { fetch: vi.fn(async () => new Response("no")) };
    for (const [method, path] of [
      ["GET", "/api/v1/not-a-route"],
      ["POST", "/api/v1/leads/x/y/z"],
      ["GET", "/api/other"],
      ["DELETE", "/api/v1/auth"],
      ["GET", "/api/v1/invoices/x/y/z"],
      ["PUT", "/api/v1/dashboard"],
    ] as const) {
      const res = await run(
        front,
        new Request(`${ORIGIN}${path}`, { method, headers: jsonHeaders(o.cookie) }),
        withEnv(env, allBindings(stub)),
      );
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await bodyOf(res)).toEqual({ error: { code: "not_found", message: "Not found" } });
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("a HEAD request for a forwarded GET row is forwarded as a HEAD to the same Worker; a HEAD with no GET row is the front's 404 (early check finding 3)", async () => {
    const o = await sess("owner", true);
    const gets = FORWARDED_ROWS.filter((r) => r.method === "GET");
    expect(gets.length).toBeGreaterThan(0);
    for (const row of gets) {
      const seen: string[] = [];
      const stub = {
        fetch: async (r: Request) => {
          seen.push(`${r.method} ${new URL(r.url).pathname}`);
          return new Response("from the stub", { status: 207, headers: { "X-Stub": "1" } });
        },
      };
      const other = { fetch: vi.fn(async () => new Response("wrong worker", { status: 418 })) };
      const bindings = bindingsFor(row, stub, other);
      const { path } = sampleRequest(row);
      const res = await run(
        front,
        new Request(`${ORIGIN}/api/v1${path}`, { method: "HEAD", headers: jsonHeaders(o.cookie) }),
        withEnv(env, bindings),
      );
      expect(other.fetch, key(row)).not.toHaveBeenCalled();
      expect(seen, key(row)).toEqual([`HEAD ${new URL(`${ORIGIN}/api/v1${path}`).pathname}`]);
      expect(res.status, key(row)).toBe(207);
      expect(res.headers.get("X-Stub"), key(row)).toBe("1");
      expect(await res.text(), key(row)).toBe("");
    }
    const stub = { fetch: vi.fn(async () => new Response("no")) };
    const getPaths = new Set(gets.map((r) => samplePath(r.path)));
    const postOnly = FORWARDED_ROWS.find((r) => r.method === "POST" && !getPaths.has(samplePath(r.path)));
    expect(postOnly).toBeDefined();
    for (const path of ["/api/v1/not-a-route", samplePath(postOnly?.path ?? "/api/v1/none")]) {
      const res = await run(
        front,
        new Request(`${ORIGIN}${path}`, { method: "HEAD", headers: jsonHeaders(o.cookie) }),
        withEnv(env, allBindings(stub)),
      );
      expect(res.status, path).toBe(404);
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("parity: through the front and the API, invoices or finance Worker the answers are the combined app's", () => {
  async function both(row: (typeof ROUTES)[number], o: Opts) {
    const pending: Promise<unknown>[] = [];
    const viaFront = await run(front, requestFor(row, o), withEnv(env, realAll(pending)));
    await Promise.all(pending);
    const direct = await run(combined, requestFor(row, o), env);
    return { front: await outcome(viaFront), direct: await outcome(direct) };
  }

  for (const row of FORWARDED_ROWS) {
    it(`${key(row)}`, async () => {
      const owner = await sess("owner", true);
      // No cookie: 401.
      const none = await both(row, {});
      expect(none.front.status).toBe(401);
      expect(none.front).toEqual(none.direct);
      // A role the matrix denies: 403.
      const denied = ROLES.find((r) => decide(r, row.access as never) === "deny");
      if (denied) {
        const d = await both(row, { cookie: (await sess(denied, true)).cookie });
        expect(d.front.status).toBe(403);
        expect(d.front).toEqual(d.direct);
      }
      // A role that needs a step-up, without one: 403 step_up_required.
      const needs = ROLES.find((r) => decide(r, row.access as never) === "step-up");
      if (needs) {
        const s = await both(row, { cookie: (await sess(needs, false)).cookie });
        expect(s.front).toEqual({ status: 403, code: "step_up_required" });
        expect(s.front).toEqual(s.direct);
      }
      if (MUTATING.has(row.method)) {
        // A cross-site POST: 403 before anything else.
        const x = await both(row, { cookie: owner.cookie, origin: "https://evil.example" });
        expect(x.front.status).toBe(403);
        expect(x.front).toEqual(x.direct);
        // A body over the limit: 413 (the upload rows check their own length in the handler).
        if (row.body !== "upload") {
          const big = await both(row, { cookie: owner.cookie, big: true });
          expect(big.front.status).toBe(413);
          expect(big.front).toEqual(big.direct);
        }
      }
      // An allowed request reaches the handler: same answer as the combined app (the same database, so a write may repeat).
      const ok = await both(row, { cookie: owner.cookie });
      expect([401, 403]).not.toContain(ok.front.status);
      expect(ok.front.status).toBe(ok.direct.status);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
describe("the API app called directly", () => {
  const direct = (req: Request) => run(api, req, apiEnv);

  it("answers 401 on every API row without a session", async () => {
    for (const row of API_ROWS) {
      const res = await direct(requestFor(row, {}));
      expect(res.status, key(row)).toBe(401);
    }
  });

  it("answers 404 for front rows, invoices and finance rows and undeclared paths, even with an owner's session", async () => {
    const o = await sess("owner", true);
    // GET rows only for invoices and finance: a POST would reach nothing anyway (404 before any handler), but GETs keep the shared database untouched by design.
    for (const row of [
      ...FRONT_ROWS,
      ...[...INVOICES_ROWS, ...FINANCE_ROWS].filter((r) => r.method === "GET"),
    ]) {
      const res = await direct(requestFor(row, { cookie: o.cookie }));
      expect(res.status, key(row)).toBe(404);
    }
    for (const path of ["/api/v1/not-a-route", "/api/v1/auth/me", "/api/other", "/api/v1/dashboard"]) {
      const res = await direct(new Request(`${ORIGIN}${path}`, { headers: jsonHeaders(o.cookie) }));
      expect(res.status, path).toBe(404);
    }
  });

  it("answers 403 on a cross-site Origin", async () => {
    const o = await sess("owner", true);
    const row = API_ROWS.find((r) => r.method === "POST" && r.body === undefined);
    if (!row) throw new Error("no POST row");
    const res = await direct(requestFor(row, { cookie: o.cookie, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("works with only the API Worker's bindings (no secrets, no assets)", async () => {
    const o = await sess("owner", true);
    const res = await direct(new Request(`${ORIGIN}/api/v1/leads`, { headers: jsonHeaders(o.cookie) }));
    expect(res.status).toBe(200);
  });

  it("does not export BillingJobs (M6.1 stage A: the finance Worker did; the invoices Worker does since the fourth admin Worker)", () => {
    expect("BillingJobs" in apiModule).toBe(false);
    expect(Object.keys(apiModule)).toEqual(["default"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the invoices app called directly (the fourth admin Worker)", () => {
  const direct = (req: Request) => run(invoicing, req, invoicesEnv);

  it("answers 401 on every invoices row without a session", async () => {
    for (const row of INVOICES_ROWS) {
      const res = await direct(requestFor(row, {}));
      expect(res.status, key(row)).toBe(401);
    }
  });

  it("answers 404 for front rows, API and finance GET rows and undeclared paths, even with an owner's session", async () => {
    const o = await sess("owner", true);
    for (const row of [...FRONT_ROWS, ...[...API_ROWS, ...FINANCE_ROWS].filter((r) => r.method === "GET")]) {
      const res = await direct(requestFor(row, { cookie: o.cookie }));
      expect(res.status, key(row)).toBe(404);
    }
    for (const path of ["/api/v1/not-a-route", "/api/v1/auth/me", "/api/other", "/api/v1/payments"]) {
      const res = await direct(new Request(`${ORIGIN}${path}`, { headers: jsonHeaders(o.cookie) }));
      expect(res.status, path).toBe(404);
    }
  });

  it("answers 403 on a cross-site Origin", async () => {
    const o = await sess("owner", true);
    const row = INVOICES_ROWS.find((r) => r.method === "POST" && r.body === undefined);
    if (!row) throw new Error("no POST row");
    const res = await direct(requestFor(row, { cookie: o.cookie, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("works with only the invoices Worker's bindings (no secrets, no assets, no service binding)", async () => {
    const o = await sess("owner", true);
    const res = await direct(new Request(`${ORIGIN}/api/v1/dashboard`, { headers: jsonHeaders(o.cookie) }));
    expect(res.status).toBe(200);
  });

  it("exports the BillingJobs and GatewayAdvance entrypoints next to its default handler, each with exactly its methods", () => {
    expect(Object.keys(invoicingModule).sort()).toEqual(["BillingJobs", "GatewayAdvance", "default"]);
    expect(Object.getOwnPropertyNames(invoicingModule.BillingJobs.prototype).sort()).toEqual([
      "constructor",
      "draftCarePlan",
      "issueCareDraft",
    ]);
    expect(Object.getOwnPropertyNames(invoicingModule.GatewayAdvance.prototype).sort()).toEqual([
      "constructor",
      "issueGatewayAdvance",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the finance app called directly (M6.1 stage A; the payments side since the fourth admin Worker)", () => {
  const direct = (req: Request) => run(finance, req, financeEnv);

  it("answers 401 on every finance row without a session", async () => {
    for (const row of FINANCE_ROWS) {
      const res = await direct(requestFor(row, {}));
      expect(res.status, key(row)).toBe(401);
    }
  });

  it("answers 404 for front rows, API and invoices GET rows and undeclared paths, even with an owner's session", async () => {
    const o = await sess("owner", true);
    for (const row of [...FRONT_ROWS, ...[...API_ROWS, ...INVOICES_ROWS].filter((r) => r.method === "GET")]) {
      const res = await direct(requestFor(row, { cookie: o.cookie }));
      expect(res.status, key(row)).toBe(404);
    }
    for (const path of [
      "/api/v1/not-a-route",
      "/api/v1/auth/me",
      "/api/other",
      "/api/v1/leads",
      "/api/v1/dashboard",
    ]) {
      const res = await direct(new Request(`${ORIGIN}${path}`, { headers: jsonHeaders(o.cookie) }));
      expect(res.status, path).toBe(404);
    }
  });

  it("answers 403 on a cross-site Origin", async () => {
    const o = await sess("owner", true);
    const row = FINANCE_ROWS.find((r) => r.method === "POST" && r.body === undefined);
    if (!row) throw new Error("no POST row");
    const res = await direct(requestFor(row, { cookie: o.cookie, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("works with only the finance Worker's bindings (no sign-in secrets, no assets)", async () => {
    const o = await sess("owner", true);
    const res = await direct(new Request(`${ORIGIN}/api/v1/payments`, { headers: jsonHeaders(o.cookie) }));
    expect(res.status).toBe(200);
  });

  it("exports the GatewayEvents and PortalPayments entrypoints next to its default handler, each with exactly its methods (M6.2; the fourth admin Worker)", () => {
    expect(Object.keys(financeModule).sort()).toEqual(["GatewayEvents", "PortalPayments", "default"]);
    expect(Object.getOwnPropertyNames(financeModule.GatewayEvents.prototype).sort()).toEqual([
      "constructor",
      "processEvent",
      // M6.3 (L13, L14): the sweep's generic refresh. The fourth admin Worker: `issueGatewayAdvance` moved to the invoices Worker's `GatewayAdvance`.
      "refreshCheckout",
    ]);
    expect(Object.getOwnPropertyNames(financeModule.PortalPayments.prototype).sort()).toEqual([
      // M6.4: PayPal's return (core `PortalPaymentsApi`).
      "capturePayPalReturn",
      "constructor",
      "createLink",
      "refreshForClient",
    ]);
    // Each entrypoint is exported by one entry only (the API and front entries export the default handler only).
    expect(Object.keys(apiModule)).toEqual(["default"]);
    expect(Object.keys(frontModule)).toEqual(["default"]);
    expect("BillingJobs" in financeModule || "GatewayAdvance" in financeModule).toBe(false);
    expect("GatewayEvents" in invoicingModule || "PortalPayments" in invoicingModule).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a binding failure", () => {
  const leadsRow = API_ROWS.find((r) => r.method === "GET" && r.path === "/api/v1/leads");
  if (!leadsRow) throw new Error("no leads row");

  it("is 502 with the standard error body and one error log line naming the pattern, never the path", async () => {
    const o = await sess("owner", true);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing = {
      fetch: async () => {
        throw new TypeError("secret detail: do not log me");
      },
    };
    const req = new Request(`${ORIGIN}/api/v1/clients/CLIENT-ID-123/files`, {
      headers: jsonHeaders(o.cookie, { "cf-ray": "ray-abc" }),
    });
    const res = await run(front, req, withEnv(env, { ADMIN_API: throwing }));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({
      error: { code: "bad_gateway", message: "Something went wrong" },
      request_id: "ray-abc",
    });
    expect(errors).toHaveBeenCalledTimes(1);
    const line = String(errors.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      route: "/api/v1/clients/:id/files",
      rid: "ray-abc",
    });
    expect(line).not.toContain("CLIENT-ID-123");
    expect(line).not.toContain("secret detail");
  });

  it("a stub that answers 500 passes through unchanged", async () => {
    const o = await sess("owner", true);
    const stub = {
      fetch: async () =>
        new Response('{"error":{"code":"internal"}}', { status: 500, headers: { "X-From": "api" } }),
    };
    const res = await run(
      front,
      requestFor(leadsRow, { cookie: o.cookie }),
      withEnv(env, { ADMIN_API: stub }),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("X-From")).toBe("api");
    expect(await res.text()).toBe('{"error":{"code":"internal"}}');
  });

  it("logs one fwd line per forward with the keys of the req line", async () => {
    const o = await sess("owner", true);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const stub = { fetch: async () => new Response("ok", { status: 200 }) };
    await run(front, requestFor(leadsRow, { cookie: o.cookie }), withEnv(env, { ADMIN_API: stub }));
    expect(logs).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(logs.mock.calls[0]?.[0]));
    // M6.1 stage A: `w` names the Worker that answered ("api" or "finance").
    // M6.2 (CPU diagnosis, lead decision 4): `f: 1` only on the isolate's first forward of the row.
    expect(
      Object.keys(line)
        .filter((k) => k !== "f")
        .sort(),
    ).toEqual(["ev", "iso", "n", "r", "rid", "s", "w"]);
    if ("f" in line) expect(line.f).toBe(1);
    logs.mockClear();
    await run(front, requestFor(leadsRow, { cookie: o.cookie }), withEnv(env, { ADMIN_API: stub }));
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).not.toHaveProperty("f");
    expect(line).toMatchObject({ ev: "fwd", r: "/api/v1/leads", w: "api", s: 200 });
  });

  // The fourth admin Worker: an invoices row's failure names the invoices Worker, a finance row's the finance Worker; the other bindings are never called.
  for (const [w, binding, path, pattern, okPath] of [
    ["invoices", "ADMIN_INVOICES", "/api/v1/invoices/INV-ID-9", "/api/v1/invoices/:id", "/api/v1/dashboard"],
    ["finance", "ADMIN_FINANCE", "/api/v1/payments/INV-ID-9", "/api/v1/payments/:id", "/api/v1/payments"],
  ] as const) {
    it(`a ${w} row's failure is the same 502, and its log lines name the ${w} Worker`, async () => {
      const o = await sess("owner", true);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const logs = vi.spyOn(console, "log").mockImplementation(() => {});
      const throwing = {
        fetch: async () => {
          throw new TypeError("secret detail: do not log me");
        },
      };
      const other = { fetch: vi.fn(async () => new Response("no")) };
      const req = new Request(`${ORIGIN}${path}`, {
        headers: jsonHeaders(o.cookie, { "cf-ray": "ray-fin" }),
      });
      const res = await run(front, req, withEnv(env, { ...allBindings(other), [binding]: throwing }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: { code: "bad_gateway", message: "Something went wrong" },
        request_id: "ray-fin",
      });
      expect(other.fetch).not.toHaveBeenCalled();
      const line = String(errors.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toMatchObject({ level: "error", route: pattern, w });
      expect(line).not.toContain("INV-ID-9");
      const stub = { fetch: async () => new Response("ok", { status: 200 }) };
      await run(
        front,
        new Request(`${ORIGIN}${okPath}`, { headers: jsonHeaders(o.cookie) }),
        withEnv(env, { ...allBindings(other), [binding]: stub }),
      );
      expect(other.fetch).not.toHaveBeenCalled();
      expect(JSON.parse(String(logs.mock.calls.at(-1)?.[0]))).toMatchObject({
        ev: "fwd",
        r: okPath,
        w,
        s: 200,
      });
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
describe("an upload and its download cross the binding as streams", () => {
  it("stores a 1 MiB file of the declared length and streams it back", async () => {
    const o = await sess("owner", true);
    const clientId = await mkClient();
    const bytes = pdfOfSize(1024 * 1024);
    const sha = await sha256Hex(bytes);
    const pending: Promise<unknown>[] = [];
    const e = withEnv(env, { ADMIN_API: realApi(pending) });
    const up = await run(
      front,
      new Request(`${ORIGIN}/api/v1/clients/${clientId}/files`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.byteLength),
          "X-File-Name": encodeURIComponent("big.pdf"),
          "X-File-Sha256": sha,
          Cookie: o.cookie,
        },
        body: bytes,
      }),
      e,
    );
    await Promise.all(pending);
    expect(up.status, await up.clone().text()).toBe(201);
    const made = (await up.json()) as { id: string; size: number };
    expect(made.size).toBe(bytes.byteLength);
    const row = await one<{ r2_key: string }>("SELECT r2_key FROM files WHERE id = ?", made.id);
    const head = await env.FILES.head(row?.r2_key ?? "");
    expect(head?.size).toBe(bytes.byteLength);
    const dl = await run(
      front,
      new Request(`${ORIGIN}/api/v1/files/${made.id}/download`, { headers: jsonHeaders(o.cookie) }),
      withEnv(env, { ADMIN_API: realApi(pending) }),
    );
    expect(dl.status).toBe(200);
    const got = new Uint8Array(await dl.arrayBuffer());
    expect(got.byteLength).toBe(bytes.byteLength);
    expect(await sha256Hex(got)).toBe(sha);
    await Promise.all(pending);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("no sign-in secret outside the front's sources", () => {
  const sources = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >;
  // warm-front.ts (CPU warm-up (b)1): the front's start-up dry run names the sign-in keys with MADE-UP test values only; front-only (the next test, and the
  // bundle guard SIGN_IN_TABLES keeps every such name out of the API and finance bundles).
  const allowed = (f: string) =>
    ["./auth.ts", "./account.ts", "./users.ts", "./warm-front.ts"].includes(f) ||
    f.startsWith("./test-") ||
    f.endsWith(".test.ts") ||
    f.endsWith(".d.ts");

  it("only auth.ts, account.ts, users.ts and the test helpers name a secret", () => {
    const offenders = Object.entries(sources)
      .filter(([f]) => !allowed(f))
      .filter(([, text]) => SECRETS.some((s) => text.includes(s)))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it("the API, invoices and finance entries' own modules do not import the sign-in routers", () => {
    for (const f of [
      "./api.ts",
      "./routes-api.ts",
      "./finance.ts",
      "./routes-finance.ts",
      "./invoicing.ts",
      "./routes-invoices.ts",
      "./rpc.ts",
    ]) {
      expect(sources[f], f).not.toMatch(/from "\.\/(auth|account|users|warm-front)\.ts"/);
    }
  });

  // The fourth admin Worker (brief A.6, Step 0.3): the import cuts, both ways, at the source (the bundle checks are INVOICE_CODE and ADVANCE_CODE in finance,
  // GATEWAY_CODE in the invoices, API and front bundles).
  const gatewaySources = import.meta.glob("./gateway/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  const CHAIN =
    /from "\.\.?\/(invoice-(?!consts)[a-z-]+|invoices|note-(?!consts)[a-z-]+|quote-model|documents|document-[a-z-]+|approvals|client-invoices|statements?|statement-pdf|reports?|report-rows|dashboard|care-billing)\.ts"/;

  it("the finance Worker's own modules and the payments side name no invoice-chain module and never the automatic advance", () => {
    for (const f of [
      "./finance.ts",
      "./routes-finance.ts",
      "./warm-finance.ts",
      "./warm-rpc.ts",
      "./rpc.ts",
      "./payments.ts",
      "./payment-ledger.ts",
      "./payment-messages.ts",
      "./advices.ts",
      "./docs-upload.ts",
      "./anonymised.ts",
      "./invoice-consts.ts",
    ]) {
      expect(sources[f], f).toBeDefined();
      expect(sources[f], f).not.toMatch(CHAIN);
      expect(sources[f], f).not.toMatch(/from "\.\/gateway\/advance\.ts"/);
    }
    for (const [f, text] of Object.entries(gatewaySources)) {
      if (f === "./gateway/advance.ts") continue;
      expect(text, f).not.toMatch(CHAIN);
      expect(text, f).not.toMatch(/from "\.\/advance\.ts"/);
    }
  });

  it("the invoices Worker's own modules name no gateway client and no payments-side module; advance.ts takes only wording and the link from the gateway folder", () => {
    const PAYMENTS_SIDE = /from "\.\.?\/(payments|payment-ledger|advices)\.ts"/;
    const GATEWAY_CLIENT = /from "\.\/gateway\/(?!(messages|reasons|consts|advance)\.ts")[a-z-]+\.ts"/;
    for (const f of ["./invoicing.ts", "./routes-invoices.ts", "./warm-invoices.ts"]) {
      expect(sources[f], f).toBeDefined();
      expect(sources[f], f).not.toMatch(PAYMENTS_SIDE);
      expect(sources[f], f).not.toMatch(GATEWAY_CLIENT);
    }
    const advance = gatewaySources["./gateway/advance.ts"] ?? "";
    const local = [...advance.matchAll(/from "\.\/([a-z-]+)\.ts"/g)].map((m) => m[1]).sort();
    expect(local).toEqual(["consts", "messages"]);
    expect(advance).not.toMatch(PAYMENTS_SIDE);
  });

  it("the API entry's routes and the import cuts name no invoice module (M6.1 stage A; the bundle check is INVOICE_CODE)", () => {
    const INVOICE =
      /from "\.\/(invoice-(?!consts)[a-z-]+|invoices|note-(?!consts)[a-z-]+|approvals|client-invoices|statements?|statement-pdf|reports?|report-rows|dashboard|care-billing)\.ts"/;
    for (const f of [
      "./api.ts",
      "./routes-api.ts",
      "./warm-api.ts",
      "./document-warm.ts",
      "./approval-requests.ts",
      "./client-tabs.ts",
      "./settings.ts",
      "./clients.ts",
      "./document-pdf.ts",
      "./document-send.ts",
      "./invoice-consts.ts",
      "./note-consts.ts",
    ]) {
      expect(sources[f], f).not.toMatch(INVOICE);
    }
  });
});
