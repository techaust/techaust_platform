/// <reference types="vite/client" />
// The admin Worker split (M5.0, docs/13 2026-10-27): a front Worker (SPA, sign-in, account, staff) that forwards every other ROUTES row
// over the ADMIN_API binding, and an API Worker that answers them. Proves: every row has one owner; the front forwards untouched and
// touches nothing else; the same statuses and error codes come back through the front as from the combined app; the API app refuses
// what is not its own and what carries no session; a binding failure is a 502; an upload streams across the binding; and no API
// source names a sign-in secret.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { decide, ROLES, type Role } from "@techaust/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "./api.ts";
import { createApp } from "./app.ts";
import { ROUTES } from "./guard.ts";
import front from "./index.ts";
import { mountApi } from "./routes-api.ts";
import { mountFront } from "./routes-front.ts";
import combined from "./test-app.ts";
import { mkClient } from "./test-clients.ts";
import { bodyOf, counted, countOf, ORIGIN, one, sampleRequest, sessionFor, withEnv } from "./test-helpers.ts";
import { pdfOfSize, sha256Hex } from "./test-projects.ts";

const SECRETS = ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY", "TURNSTILE_SECRET"];
const FRONT_ROWS = ROUTES.filter((r) => r.on === "front");
const API_ROWS = ROUTES.filter((r) => r.on !== "front");
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The bindings the API Worker has (wrangler.api.jsonc): no secrets, no assets, no service binding. */
const apiEnv: Env = withEnv(env, {
  ...Object.fromEntries(SECRETS.map((s) => [s, undefined])),
  TURNSTILE_SITE_KEY: undefined,
  TURNSTILE_HOSTNAMES: undefined,
  ASSETS: undefined,
  ADMIN_API: undefined,
});

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

  it("the table has front rows and API rows, and no row is both", () => {
    expect(FRONT_ROWS.length).toBe(24);
    expect(API_ROWS.length).toBe(ROUTES.length - 24);
    expect(new Set([...FRONT_ROWS, ...API_ROWS].map(key)).size).toBe(ROUTES.length);
  });

  it("the front rows are health, sign-in, the member's account and staff management", () => {
    for (const r of FRONT_ROWS) {
      expect(r.path.startsWith("/api/v1/health") || /^\/api\/v1\/(auth|users)(\/|$)/.test(r.path)).toBe(true);
    }
    for (const r of API_ROWS) expect(r.path).not.toMatch(/^\/api\/v1\/(health|auth|users)(\/|$)/);
  });

  it("the front mounts exactly the front rows and the API app exactly the API rows", () => {
    expect(routesOf(createApp(mountFront))).toEqual(FRONT_ROWS.map(key).sort());
    expect(routesOf(createApp(mountApi))).toEqual(API_ROWS.map(key).sort());
  });

  it("no handler is mounted twice (early check B1: a router mounted twice registers its routes twice)", () => {
    // A route's middleware and handler are separate entries, so the same path appears more than once; the same FUNCTION on the same path never should.
    for (const app of [createApp(mountFront), createApp(mountApi)]) {
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

  it("the front entry answers every row (its own or a forwarder) and nothing else", () => {
    expect(routesOf(front)).toEqual(ROUTES.map(key).sort());
  });

  it("every API row is non-public", () => {
    for (const r of API_ROWS) expect(r.access, key(r)).not.toBe("public");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("forwarding fidelity: the front passes the request on untouched", () => {
  for (const row of API_ROWS) {
    it(`${key(row)}: one call, same request, no D1 call, no access row`, async () => {
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
      const c = counted();
      const before = await countOf("access_log");
      const res = await run(front, req, withEnv(c.env, { ADMIN_API: stub }));
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

  it("front rows never call the binding", async () => {
    // No cookie: the sign-out and revoke-all rows would end the sessions the other tests share.
    const stub = { fetch: vi.fn(async () => new Response("no")) };
    for (const row of FRONT_ROWS) {
      await run(front, requestFor(row, {}), withEnv(env, { ADMIN_API: stub }));
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
    ] as const) {
      const res = await run(
        front,
        new Request(`${ORIGIN}${path}`, { method, headers: jsonHeaders(o.cookie) }),
        withEnv(env, { ADMIN_API: stub }),
      );
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await bodyOf(res)).toEqual({ error: { code: "not_found", message: "Not found" } });
    }
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("parity: through the front and the API Worker the answers are the combined app's", () => {
  async function both(row: (typeof ROUTES)[number], o: Opts) {
    const pending: Promise<unknown>[] = [];
    const viaFront = await run(front, requestFor(row, o), withEnv(env, { ADMIN_API: realApi(pending) }));
    await Promise.all(pending);
    const direct = await run(combined, requestFor(row, o), env);
    return { front: await outcome(viaFront), direct: await outcome(direct) };
  }

  for (const row of API_ROWS) {
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

  it("answers 404 for front rows and undeclared paths, even with an owner's session", async () => {
    const o = await sess("owner", true);
    for (const row of FRONT_ROWS) {
      const res = await direct(requestFor(row, { cookie: o.cookie }));
      expect(res.status, key(row)).toBe(404);
    }
    for (const path of ["/api/v1/not-a-route", "/api/v1/auth/me", "/api/other"]) {
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
    const res = await direct(new Request(`${ORIGIN}/api/v1/dashboard`, { headers: jsonHeaders(o.cookie) }));
    expect(res.status).toBe(200);
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
    expect(Object.keys(line).sort()).toEqual(["ev", "iso", "n", "r", "rid", "s"]);
    expect(line).toMatchObject({ ev: "fwd", r: "/api/v1/leads", s: 200 });
  });
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
  const allowed = (f: string) =>
    ["./auth.ts", "./account.ts", "./users.ts"].includes(f) ||
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

  it("the API entry's own modules do not import the sign-in routers", () => {
    for (const f of ["./api.ts", "./routes-api.ts"]) {
      expect(sources[f], f).not.toMatch(/from "\.\/(auth|account|users)\.ts"/);
    }
  });
});
