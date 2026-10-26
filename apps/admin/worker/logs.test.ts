// What the Worker writes to Workers Logs [NFR-6]: one line per /api request with exactly ev, r, s, rid, iso, n, and
// no personal data anywhere on the console.

import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { currentStep, totpCode } from "@techaust/auth";
import { describe, expect, it, vi } from "vitest";
import app from "./test-app.ts";
import {
  call,
  enrol,
  extraSession,
  hash,
  invite,
  nextCode,
  ORIGIN,
  rows,
  sessionFor,
  userId,
  withDb,
} from "./test-helpers.ts";

type Spy = { lines: string[]; stop: () => void };

/** Collects everything written through console.log/info/warn/error/debug. */
function spyConsole(): Spy {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    }),
  );
  return {
    lines,
    stop: () => {
      for (const s of spies) s.mockRestore();
    },
  };
}

const reqLines = (lines: string[]) =>
  lines.flatMap((l) => {
    try {
      const o = JSON.parse(l) as Record<string, unknown>;
      return o.ev === "req" ? [o] : [];
    } catch {
      return [];
    }
  });

describe("the request log line [NFR-6]", () => {
  it("has exactly ev, r, s, rid, iso and n; r is the route PATTERN (or 'other')", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const t = await sessionFor("staff");
    const spy = spyConsole();
    try {
      await call("/auth/login", {
        body: { email: "someone@example.com", clientHash: hash() },
        headers: { "cf-ray": "ray-1" },
      });
      await call("/auth/me", { cookie: o.cookie, headers: { "cf-ray": "ray-2" } });
      await call(`/users/${t.id}/deactivate`, {
        method: "POST",
        cookie: o.cookie,
        headers: { "cf-ray": "ray-3" },
      });
      await call("/nope/at/all", { headers: { "cf-ray": "ray-4" } });
      await call("/health", { headers: { "cf-ray": "ray-5" } });
    } finally {
      spy.stop();
    }
    const logged = reqLines(spy.lines);
    expect(logged).toHaveLength(5);
    for (const l of logged) expect(Object.keys(l).sort()).toEqual(["ev", "iso", "n", "r", "rid", "s"]);
    expect(logged.map((l) => [l.r, l.s, l.rid])).toEqual([
      ["/api/v1/auth/login", 401, "ray-1"],
      ["/api/v1/auth/me", 200, "ray-2"],
      ["/api/v1/users/:id/deactivate", 200, "ray-3"],
      ["other", 404, "ray-4"],
      ["/api/v1/health", 200, "ray-5"],
    ]);
    expect(new Set(logged.map((l) => l.iso)).size).toBe(1);
    expect(logged[0]?.iso).toMatch(/^[0-9a-f]{6}$/);
    const ns = logged.map((l) => l.n as number);
    for (let i = 1; i < ns.length; i++) expect(ns[i]).toBe((ns[i - 1] as number) + 1);
    expect(spy.lines.join("\n")).not.toContain(t.id); // the raw path never appears
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
  const IP = "203.0.113.99";
  const UA = "Mozilla/5.0 (LogTest; unique-agent-marker-7731)";
  const headers = { "CF-Connecting-IP": IP, "User-Agent": UA, "cf-ray": "ray-pii" };

  it("a whole day's flows (sign-up, sign-in, refusals, mutations, a crash) leave no email, IP, agent, token or cookie", async () => {
    const spy = spyConsole();
    const secrets: string[] = [];
    try {
      // Enrol and sign in, wrongly and rightly, by password, code and recovery code.
      const e = await enrol("pii-owner@example.com", "owner", "Pii Person");
      secrets.push(
        e.email,
        e.clientHash,
        e.inviteToken,
        e.cookie.split("=")[1] as string,
        e.recoveryCodes[0] as string,
      );
      const bad = await call("/auth/login", { body: { email: e.email, clientHash: hash() }, headers });
      expect(bad.status).toBe(401);
      const good = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash }, headers });
      const { challenge } = (await good.json()) as { challenge: string };
      secrets.push(challenge);
      await call("/auth/totp", { body: { challenge, code: "000000" }, headers });
      await call("/auth/recovery", { body: { challenge, code: e.recoveryCodes[0] }, headers });
      await call("/auth/totp", {
        body: { challenge, code: totpCode(e.secret, currentStep(Date.now()) + 1) },
        headers,
      });

      // The signed-in side: step-up, sessions, invites, reset, deactivate.
      const o = await sessionFor("owner", { stepUp: true, email: "pii-admin@example.com" });
      secrets.push(o.email, o.cookie.split("=")[1] as string, o.sessionId);
      const target = await sessionFor("staff", { email: "pii-target@example.com" });
      secrets.push(target.email, target.cookie.split("=")[1] as string);
      const other = await extraSession(o);
      await call("/auth/sessions", { cookie: o.cookie, headers });
      await call(`/auth/sessions/${other.sessionId}`, { method: "DELETE", cookie: o.cookie, headers });
      const made = await call("/users/invites", {
        body: { email: "pii-invitee@example.com", role: "staff" },
        cookie: o.cookie,
        headers,
      });
      const { link } = (await made.json()) as { link: string };
      secrets.push("pii-invitee@example.com", link, new URL(link).hash.slice(3));
      await call(`/users/${target.id}/reset-2fa`, { method: "POST", cookie: o.cookie, headers });
      await call(`/users/${target.id}/deactivate`, { method: "POST", cookie: o.cookie, headers });
      const s2 = await sessionFor("sales", { stepUp: false });
      const { code } = await nextCode(s2);
      await call("/auth/step-up", { body: { code }, cookie: s2.cookie, headers });
      await call("/auth/step-up", { body: { code }, cookie: s2.cookie, headers }); // refused: a replay
      await invite("pii-unused@example.com", "staff");
      await call("/auth/salt", { body: { email: "pii-salt@example.com" }, headers });
      secrets.push("pii-salt@example.com", "pii-unused@example.com");

      // A crash: the database goes away mid-request, on a route whose path carries an id.
      const down = withDb({
        prepare: () => {
          throw new Error("database is down");
        },
        batch: () => {
          throw new Error("database is down");
        },
      } as unknown as D1Database);
      const crash = await call(
        `/users/${await userId(e.email)}/deactivate`,
        { method: "POST", cookie: o.cookie, headers },
        down,
      );
      expect(crash.status).toBe(500);
      secrets.push(await userId(e.email));
    } finally {
      spy.stop();
    }
    const out = spy.lines.join("\n");
    expect(out.length).toBeGreaterThan(0);
    for (const s of [...secrets, IP, UA, "unique-agent-marker-7731", "@example.com", "Pii Person"])
      expect(out, s).not.toContain(s);
    // And every line is one of ours: a request line, or an error line with only the route pattern and a message.
    for (const l of spy.lines) {
      const o = JSON.parse(l) as Record<string, unknown>;
      expect(o.ev === "req" || o.level === "error", l).toBe(true);
    }
  });

  it("a crash logs the route PATTERN, not the raw path, and answers 500 with the request id", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const t = await sessionFor("staff");
    const down = withDb({
      prepare: () => {
        throw new Error("boom");
      },
      batch: () => {
        throw new Error("boom");
      },
    } as unknown as D1Database);
    const spy = spyConsole();
    let res: Response;
    try {
      res = await call(
        `/users/${t.id}/reset-2fa`,
        { method: "POST", cookie: o.cookie, headers: { "cf-ray": "ray-crash" } },
        down,
      );
    } finally {
      spy.stop();
    }
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Something went wrong" },
      request_id: "ray-crash",
    });
    const errors = spy.lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.level === "error");
    // The error's class name, never its message (a driver error can echo SQL or values).
    expect(errors).toContainEqual({
      level: "error",
      route: "/api/v1/users/:id/reset-2fa",
      message: "unhandled error",
      cause: "Error",
    });
    expect(spy.lines.join("\n")).not.toContain("boom");
    expect(spy.lines.join("\n")).not.toContain(t.id);
  });
});

describe("header values are cut before they reach a log row (audit M2)", () => {
  it("a 10 KB User-Agent is stored as 512 characters, an oversized address and cf-ray as 64", async () => {
    const s = await sessionFor("accountant");
    const res = await call("/auth/me", {
      cookie: s.cookie,
      headers: {
        "cf-ray": `ray-${"r".repeat(200)}`,
        "CF-Connecting-IP": "9".repeat(200),
        "User-Agent": "A".repeat(10_240),
      },
    });
    expect(res.status).toBe(200);
    const id = ((await res.json()) as { request_id?: string }).request_id;
    const logged = await rows<{ ip: string; user_agent: string; request_id: string }>(
      "SELECT ip, user_agent, request_id FROM access_log WHERE actor_id = ?",
      s.id,
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.user_agent).toBe("A".repeat(512));
    expect(logged[0]?.ip).toBe("9".repeat(64));
    expect(logged[0]?.request_id).toHaveLength(64);
    expect(logged[0]?.request_id.startsWith("ray-rrr")).toBe(true);
    expect(id === undefined || id.length <= 64).toBe(true);
  });

  it("a normal User-Agent and address are stored untouched", async () => {
    const s = await sessionFor("accountant");
    await call("/auth/me", {
      cookie: s.cookie,
      headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "Mozilla/5.0 (Normal)" },
    });
    expect(await rows("SELECT ip, user_agent FROM access_log WHERE actor_id = ?", s.id)).toEqual([
      { ip: "203.0.113.7", user_agent: "Mozilla/5.0 (Normal)" },
    ]);
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
      `${ORIGIN}/api/v1/auth/me`,
      { headers: { Origin: ORIGIN, Cookie: cookie } },
      e,
      ctx,
    );
    return { res, ctx, waited };
  };

  it("hands the write to waitUntil exactly once, and the row exists once the context has settled", async () => {
    const s = await sessionFor("accountant");
    const before = (await rows("SELECT id FROM access_log WHERE actor_id = ?", s.id)).length;
    const { res, ctx, waited } = request(s.cookie);
    expect((await res).status).toBe(200);
    expect(waited).toHaveLength(1);
    await waitOnExecutionContext(ctx);
    expect((await rows("SELECT id FROM access_log WHERE actor_id = ?", s.id)).length).toBe(before + 1);
  });

  it("a failing write still answers 200 and logs only the route pattern, the request id and the error class", async () => {
    const s = await sessionFor("accountant");
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
      route: "/api/v1/auth/me",
      message: "access log write failed",
      cause: "Error",
    });
    expect(spy.lines.join("\n")).not.toContain("secret-sql-detail");
  });
});
