// What the portal writes to its logs [NFR-6, NFR-9, Q1 = A]: one console line per /api request with exactly
// ev, r, s, rid, iso and n and no personal data anywhere; the audit rows of the sign-in events; the access rows of a
// signed-in contact's requests and of every sign-in event, and none for an anonymous request that is simply refused.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import app, { createApp } from "./index.ts";
import {
  call,
  callerFor,
  capture,
  countOf,
  extraContact,
  linkFor,
  nextIp,
  ORIGIN,
  rows,
  send,
  sessionFor,
  spyConsole,
  tokenOfLink,
  verify,
  withDb,
} from "./test-helpers.ts";

const reqLines = (lines: string[]) =>
  lines.flatMap((l) => {
    try {
      const o = JSON.parse(l) as Record<string, unknown>;
      return o.ev === "req" ? [o] : [];
    } catch {
      return [];
    }
  });

/** The access rows of one request id. */
const accessOf = (rid: string) =>
  rows<{ realm: string; actor_id: string | null; method: string; route: string; status: number }>(
    "SELECT realm, actor_id, method, route, status FROM access_log WHERE request_id = ?",
    rid,
  );

describe("the request log line [NFR-6]", () => {
  it("has exactly ev, r, s, rid, iso and n; r is the route PATTERN (or 'other')", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const spy = spyConsole();
    try {
      await call("/auth/magic", { body: { email: "someone@example.test" }, headers: { "cf-ray": "ray-1" } });
      await call("/me", { cookie: s.cookie, headers: { "cf-ray": "ray-2" } });
      await call("/auth/magic/verify", { body: { token: "nope" }, headers: { "cf-ray": "ray-3" } });
      await call("/nope/at/all", { headers: { "cf-ray": "ray-4" } });
      await call("/health", { headers: { "cf-ray": "ray-5" } });
    } finally {
      spy.stop();
    }
    const logged = reqLines(spy.lines);
    expect(logged).toHaveLength(5);
    for (const l of logged) expect(Object.keys(l).sort()).toEqual(["ev", "iso", "n", "r", "rid", "s"]);
    expect(logged.map((l) => [l.r, l.s, l.rid])).toEqual([
      ["/api/v1/auth/magic", 200, "ray-1"],
      ["/api/v1/me", 200, "ray-2"],
      ["/api/v1/auth/magic/verify", 401, "ray-3"],
      ["other", 404, "ray-4"],
      ["/api/v1/health", 200, "ray-5"],
    ]);
    expect(new Set(logged.map((l) => l.iso)).size).toBe(1);
    expect(logged[0]?.iso).toMatch(/^[0-9a-f]{6}$/);
    const ns = logged.map((l) => l.n as number);
    for (let i = 1; i < ns.length; i++) expect(ns[i]).toBe((ns[i - 1] as number) + 1);
  });

  it("a request with no cf-ray logs its own random 16-hex request id", async () => {
    const spy = spyConsole();
    try {
      await call("/health");
    } finally {
      spy.stop();
    }
    expect(reqLines(spy.lines)[0]?.rid).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("no personal data on the console [NFR-6]", () => {
  const IP = "203.0.113.199";
  const UA = "Mozilla/5.0 (LogTest; unique-agent-marker-9917)";
  const headers = { "User-Agent": UA, "cf-ray": "ray-pii" };

  it("a whole day's flows (link requests, sign-in, refusals, sign-out, a document link, a crash) leave no email, IP, agent, token, cookie or contact id", async () => {
    const f = await fixtures();
    const cap = capture();
    const who = await extraContact(f.a.id, { email: "pii-check-person@example.test" });
    const crash = createApp({
      testRoutes: [
        {
          def: { method: "GET", path: "/api/v1/test/crash", access: "public" },
          handler: () => {
            throw new Error(`boom for ${who.email} from ${IP} with ${UA}`);
          },
        },
      ],
    });
    const spy = spyConsole();
    let token = "";
    let cookie = "";
    const secrets: string[] = [];
    try {
      // a link request for a known and an unknown email, then use the link
      await callerFor(cap.app)("/auth/magic", { body: { email: who.email }, ip: IP, headers });
      await callerFor(cap.app)("/auth/magic", {
        body: { email: "pii-nobody@example.test" },
        ip: IP,
        headers,
      });
      token = tokenOfLink(cap.sent[0]?.url as string);
      const ok = await verify(token, { ip: IP, headers });
      cookie = ok.cookie as string;
      secrets.push(token, cookie, cookie.split("=")[1] as string);
      await call("/auth/magic/verify", { body: { token: "wrong-token-value-1234567890" }, ip: IP, headers });
      secrets.push("wrong-token-value-1234567890");
      // signed in, then out; a bad cookie; a CSRF refusal; a document link, good and bad
      await call("/me", { cookie, ip: IP, headers });
      await call("/me", { cookie: "__Host-ta_portal=junkjunkjunkjunk", ip: IP, headers });
      secrets.push("junkjunkjunkjunk");
      await call("/auth/logout", {
        method: "POST",
        ip: IP,
        headers: { ...headers, Origin: "https://evil.example" },
      });
      await call("/t/document", { body: { token: f.tokens.aIssued }, ip: IP, headers });
      await call("/t/document", { body: { token: "bad-doc-token-abcdef" }, ip: IP, headers });
      secrets.push(f.tokens.aIssued, "bad-doc-token-abcdef");
      await call("/auth/sessions/revoke-all", { method: "POST", cookie, ip: IP, headers });
      await call("/auth/logout", { method: "POST", cookie, ip: IP, headers });
      // a crash with personal data in its message, and a quota refusal
      const crashed = await callerFor(crash)("/test/crash", { ip: IP, headers });
      expect(crashed.status).toBe(500);
      for (let i = 0; i < 4; i++)
        await callerFor(cap.app)("/auth/magic", {
          body: { email: "pii-flood@example.test" },
          ip: IP,
          headers,
        });
    } finally {
      spy.stop();
    }
    const all = spy.lines.join("\n");
    expect(all.length).toBeGreaterThan(0);
    for (const s of [
      IP,
      UA,
      "unique-agent-marker",
      who.email,
      "pii-nobody",
      "pii-flood",
      who.id,
      f.a.id,
      ...secrets,
    ])
      expect(all, s).not.toContain(s);
    expect(all).not.toMatch(/example\.test|boom for/);
    // every crash line is the route pattern and the error class only
    const errors = spy.lines.filter((l) => l.includes('"level":"error"'));
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors)
      expect(Object.keys(JSON.parse(e)).sort()).toEqual(["cause", "level", "message", "route"]);
  });
});

describe("audit rows: one per sign-in event, none for failures [ADM-AUD-01-style, NFR-9]", () => {
  it("login, logout, revoke-all and document-token use each write exactly one audit row, with request id, ip and agent", async () => {
    const f = await fixtures();
    const who = await extraContact(f.b.id);
    const h = (rid: string) => ({ "cf-ray": rid, "User-Agent": "audit-agent" });
    const ip = "192.0.2.111";
    const ok = await verify(await linkFor(who.id), { ip, headers: h("a-login") });
    const cookie = ok.cookie as string;
    await sessionFor(who); // a second device
    await call("/t/document", { body: { token: f.tokens.bIssued }, ip, headers: h("a-doc") });
    await call("/auth/sessions/revoke-all", { method: "POST", cookie, ip, headers: h("a-all") });
    const third = await sessionFor(who);
    await call("/auth/logout", { method: "POST", cookie: third.cookie, ip, headers: h("a-out") });
    for (const [rid, action] of [
      ["a-login", "portal.login"],
      ["a-doc", "doc_token.use"],
      ["a-all", "portal.sessions_revoke_all"],
      ["a-out", "portal.logout"],
    ] as const) {
      const r = await rows<Record<string, unknown>>(
        "SELECT actor_type, action, ip, user_agent, request_id FROM audit_log WHERE request_id = ?",
        rid,
      );
      expect(r, rid).toEqual([
        { actor_type: "contact", action, ip, user_agent: "audit-agent", request_id: rid },
      ]);
    }
  });

  it("failures write no audit row: a bad link, a bad document link, a refused quota, a 401", async () => {
    const before = await countOf("audit_log");
    await call("/auth/magic/verify", { body: { token: "bad" } });
    await call("/t/document", { body: { token: "bad" } });
    await call("/me");
    for (let i = 0; i < 4; i++) await call("/auth/magic", { body: { email: "audit-flood@example.test" } });
    expect(await countOf("audit_log")).toBe(before);
  });

  it("audit rows can't be changed or deleted (append-only trigger)", async () => {
    await expect(env.DB.prepare("UPDATE audit_log SET action = 'x'").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM audit_log").run()).rejects.toThrow(/append-only/);
  });
});

describe("access rows: every signed-in request and every sign-in event, nothing else [NFR-9, Q1 = A]", () => {
  const rid = (name: string) => `acc-${name}`;
  const h = (name: string) => ({ "cf-ray": rid(name) });

  it("sign-in events each write one row: link requested (known and unknown), link used (ok and failed), document link (ok and failed), sign out", async () => {
    const f = await fixtures();
    const who = await extraContact(f.a.id);
    const cap = capture();
    await callerFor(cap.app)("/auth/magic", { body: { email: who.email }, headers: h("magic-known") });
    await callerFor(cap.app)("/auth/magic", {
      body: { email: "acc-nobody@example.test" },
      headers: h("magic-unknown"),
    });
    const ok = await verify(await linkFor(who.id), { headers: h("verify-ok") });
    await call("/auth/magic/verify", { body: { token: "bad" }, headers: h("verify-bad") });
    await call("/t/document", { body: { token: f.tokens.aIssued }, headers: h("doc-ok") });
    await call("/t/document", { body: { token: "bad" }, headers: h("doc-bad") });
    await call("/auth/logout", { method: "POST", cookie: ok.cookie as string, headers: h("logout") });
    const expected: [string, number, string | null][] = [
      ["magic-known", 200, null],
      ["magic-unknown", 200, null],
      ["verify-ok", 200, who.id],
      ["verify-bad", 401, null],
      ["doc-ok", 200, f.a.finance.id],
      ["doc-bad", 404, null],
      ["logout", 204, who.id],
    ];
    for (const [name, status, actor] of expected) {
      const r = await accessOf(rid(name));
      expect(r, name).toHaveLength(1);
      expect(r[0], name).toMatchObject({ realm: "portal", status, actor_id: actor, method: "POST" });
      expect(r[0]?.route, name).toMatch(/^\/api\/v1\//);
    }
  });

  it("every signed-in request writes one row, whatever the answer: a 200, a 404 and the finance 404", async () => {
    const f = await fixtures();
    const extra = createApp({
      testRoutes: [
        {
          def: { method: "GET", path: "/api/v1/test/finance", access: "finance" },
          handler: (c) => c.json({ ok: true }),
        },
        {
          def: { method: "GET", path: "/api/v1/test/bad", access: "session" },
          handler: (c) => c.json({ error: "x" }, 400),
        },
      ],
    });
    const s = await sessionFor(f.a.plain);
    const send = callerFor(extra);
    await send("/me", { cookie: s.cookie, headers: h("s-me") });
    await send("/test/finance", { cookie: s.cookie, headers: h("s-fin") });
    await send("/test/bad", { cookie: s.cookie, headers: h("s-bad") });
    await send("/nothing-here", { cookie: s.cookie, headers: h("s-404") });
    expect(await accessOf(rid("s-me"))).toEqual([
      { realm: "portal", actor_id: f.a.plain.id, method: "GET", route: "/api/v1/me", status: 200 },
    ]);
    expect(await accessOf(rid("s-fin"))).toEqual([
      { realm: "portal", actor_id: f.a.plain.id, method: "GET", route: "/api/v1/test/finance", status: 404 },
    ]);
    expect(await accessOf(rid("s-bad"))).toEqual([
      { realm: "portal", actor_id: f.a.plain.id, method: "GET", route: "/api/v1/test/bad", status: 400 },
    ]);
    expect(await accessOf(rid("s-404"))).toEqual([]); // an undeclared route is no business of the log
  });

  it("an anonymous request that is simply refused writes NO row: no cookie, a bad cookie, CSRF 403 and 415, an unknown route, a quota 429, a blocked address", async () => {
    const f = await fixtures();
    const cap = capture();
    for (let i = 0; i < 3; i++)
      await callerFor(cap.app)("/auth/magic", { body: { email: "acc-quota@example.test" } });
    const blockedIp = "192.0.2.131";
    for (let i = 0; i < 20; i++) await call("/auth/magic/verify", { body: { token: "bad" }, ip: blockedIp });
    const none: [string, number, () => Promise<Response>][] = [
      ["no-cookie", 401, () => call("/me", { headers: h("no-cookie") })],
      [
        "logout-junk",
        204,
        () =>
          call("/auth/logout", {
            method: "POST",
            cookie: "__Host-ta_portal=junk",
            headers: h("logout-junk"),
          }),
      ],
      [
        "logout-again",
        204,
        async () => {
          const s = await sessionFor(f.a.plain, { revoked: Date.now() - 5 });
          return call("/auth/logout", { method: "POST", cookie: s.cookie, headers: h("logout-again") });
        },
      ],
      ["bad-cookie", 401, () => call("/me", { cookie: "__Host-ta_portal=bad", headers: h("bad-cookie") })],
      [
        "dead-session",
        401,
        async () =>
          call("/me", {
            cookie: (await sessionFor(f.a.plain, { revoked: 1 })).cookie,
            headers: h("dead-session"),
          }),
      ],
      [
        "csrf-403",
        403,
        () =>
          call("/auth/logout", {
            method: "POST",
            headers: { ...h("csrf-403"), Origin: "https://evil.example" },
          }),
      ],
      [
        "csrf-415",
        415,
        async () =>
          send(
            `${ORIGIN}/api/v1/auth/magic`,
            {
              method: "POST",
              headers: {
                Origin: ORIGIN,
                "Content-Type": "text/plain",
                "CF-Connecting-IP": nextIp(),
                ...h("csrf-415"),
              },
              body: "hello",
            },
            env,
          ),
      ],
      ["unknown", 404, () => call("/unknown", { headers: h("unknown") })],
      [
        "quota",
        429,
        () =>
          callerFor(cap.app)("/auth/magic", {
            body: { email: "acc-quota@example.test" },
            headers: h("quota"),
          }),
      ],
      [
        "blocked",
        429,
        () => call("/auth/magic/verify", { body: { token: "bad" }, ip: blockedIp, headers: h("blocked") }),
      ],
    ];
    for (const [name, status, run] of none) {
      const res = await run();
      expect(res.status, name).toBe(status);
      expect(await accessOf(rid(name)), name).toEqual([]);
    }
  });

  it("access_log can't be changed (UPDATE trigger) and carries no email or token column", async () => {
    await call("/me", { headers: h("immutable") }); // no row (anonymous), so make one
    const f = await fixtures();
    await call("/me", { cookie: (await sessionFor(f.a.plain)).cookie, headers: h("immutable2") });
    await expect(
      env.DB.prepare("UPDATE access_log SET status = 500 WHERE request_id = 'acc-immutable2'").run(),
    ).rejects.toThrow(/append-only/);
    const cols = (await rows<{ name: string }>("SELECT name FROM pragma_table_info('access_log')"))
      .map((c) => c.name)
      .sort();
    expect(cols).toEqual([
      "actor_id",
      "at",
      "id",
      "ip",
      "method",
      "realm",
      "request_id",
      "route",
      "status",
      "user_agent",
    ]);
  });
});

describe("header values are cut before they reach a log row (audit M2)", () => {
  it("a 10 KB User-Agent is stored as 512 characters, an oversized address and cf-ray as 64", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const res = await call("/me", {
      cookie: s.cookie,
      headers: { "cf-ray": "ray.".repeat(50), "User-Agent": "A".repeat(10_240) },
      ip: "9".repeat(200),
    });
    expect(res.status).toBe(200);
    const logged = await rows<{ ip: string; user_agent: string; request_id: string }>(
      "SELECT ip, user_agent, request_id FROM access_log WHERE actor_id = ?1 AND route = '/api/v1/me'",
      f.a.plain.id,
    );
    expect(logged.at(-1)?.user_agent).toBe("A".repeat(512));
    expect(logged.at(-1)?.ip).toBe("9".repeat(64));
    expect(logged.at(-1)?.request_id).toHaveLength(64);
    expect(logged.at(-1)?.request_id.startsWith("ray.ray.")).toBe(true);
  });
});

describe("the access-row write rides in the execution context (audit L5)", () => {
  const request = (cookie: string, e: Env = env) => {
    const ctx = createExecutionContext();
    const waited: Promise<unknown>[] = [];
    const orig = ctx.waitUntil.bind(ctx);
    ctx.waitUntil = (p: Promise<unknown>) => {
      waited.push(p);
      orig(p);
    };
    const res = app.request(
      `${ORIGIN}/api/v1/me`,
      { headers: { Origin: ORIGIN, Cookie: cookie, "CF-Connecting-IP": nextIp() } },
      e,
      ctx,
    );
    return { res, ctx, waited };
  };

  it("hands the write to waitUntil exactly once, and the row exists once the context has settled", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const before = await countOf("access_log", "actor_id = ?1", f.a.plain.id);
    const { res, ctx, waited } = request(s.cookie);
    expect((await res).status).toBe(200);
    expect(waited).toHaveLength(1);
    await waitOnExecutionContext(ctx);
    expect(await countOf("access_log", "actor_id = ?1", f.a.plain.id)).toBe(before + 1);
  });

  it("a failing write still answers 200 and logs only the route pattern, the request id and the error class", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    // Statements whose `run` (the access row, alone in its call) rejects; everything else reads the real database.
    const wrapStmt = (st: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(st, {
        get(t, k) {
          if (k === "run") return () => Promise.reject(new Error("disk full: secret-sql-detail"));
          if (k === "bind") return (...a: unknown[]) => wrapStmt(t.bind(...a));
          const v = Reflect.get(t, k) as unknown;
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    const failing = withDb({
      prepare: (q: string) => wrapStmt(env.DB.prepare(q)),
      batch: (b: D1PreparedStatement[]) => env.DB.batch(b),
    } as unknown as D1Database);
    const spy = spyConsole();
    let res: Response;
    try {
      const r = request(s.cookie, failing);
      res = await r.res;
      await waitOnExecutionContext(r.ctx);
    } finally {
      spy.stop();
    }
    expect(res.status).toBe(200);
    const errors = spy.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      route: "/api/v1/me",
      message: "access log write failed",
      cause: "Error",
    });
    expect(spy.lines.join(String.fromCharCode(10))).not.toContain("secret-sql-detail");
  });
});
