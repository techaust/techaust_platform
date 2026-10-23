// Turnstile on the link request and the link email [POR-01]: the token is checked FIRST (before any quota or read), so a
// script without one cannot use up a victim's `p:mail:` quota; a failed check is a 400 with nothing written; and the link
// reaches the person through the email queue, never later for a known email than for an unknown one. siteverify and the
// queue are stubs.
import { env } from "cloudflare:workers";
import { MAGIC_MAIL_LIMIT, portalMailKey, portalReqKey, tokenHash } from "@techaust/auth";
import { emailMessage } from "@techaust/core";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  callerFor,
  captureQueue,
  counting,
  countOf,
  extraContact,
  ORIGIN,
  one,
  rows,
  siteverify as sv,
  token,
  tokenOfLink,
  withEnv,
  writes,
} from "./test-helpers.ts";

const FAILED = { error: { code: "turnstile_failed", message: "Verification failed. Try again." } };
const EXPIRES_IN = 15 * 60_000;

/** Everything a refused request must leave alone. */
const untouched = async () => ({
  ...(await writes()),
  attempts: await countOf("auth_attempts"),
  emailLog: await countOf("email_log"),
});

const ask = (email: string, extra: Record<string, unknown> = {}, e: Env = env, ip?: string) =>
  call("/auth/magic", { body: { email, ...extra }, bare: true, ...(ip ? { ip } : {}) }, e);

describe("the check comes first, and a failed one writes nothing [POR-01]", () => {
  it("a missing, empty or over-long token is a 400 before anything runs (no siteverify call for them)", async () => {
    const f = await fixtures();
    const before = await untouched();
    for (const turnstile of [undefined, "", "t".repeat(2049), 5, null]) {
      const res = await ask(f.a.plain.email, turnstile === undefined ? {} : { turnstile });
      expect(res.status).toBe(400);
    }
    expect(sv.calls).toHaveLength(0);
    expect(await untouched()).toEqual(before);
  });

  it("a token Cloudflare refuses (bad, used twice, success:false) is 400 turnstile_failed: no token, no counter, no access row", async () => {
    const f = await fixtures();
    const before = await untouched();
    const once = token();
    expect((await ask(f.a.plain.email, { turnstile: once })).status).toBe(200);
    const afterOk = await untouched();
    for (const turnstile of ["bad-token", once]) {
      const res = await ask(f.a.plain.email, { turnstile });
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual(FAILED);
    }
    sv.answer = { success: false, "error-codes": ["invalid-input-response"] };
    expect((await ask(f.a.plain.email, { turnstile: token() })).status).toBe(400);
    expect(await untouched()).toEqual(afterOk); // the refusals changed nothing...
    expect(afterOk.tokens).toBe(before.tokens + 1); // ...and only the one real request did
  });

  it("a token made for another surface or host is refused outside local development", async () => {
    const f = await fixtures();
    const staging = withEnv(env, { ENVIRONMENT: "staging", TURNSTILE_HOSTNAMES: "portal.example" });
    const before = await untouched();
    sv.answer = { success: true, action: "contact", hostname: "portal.example" }; // a web form's token
    expect((await ask(f.a.plain.email, { turnstile: token() }, staging)).status).toBe(400);
    sv.answer = { success: true, action: "admin_login", hostname: "portal.example" }; // an admin sign-in token
    expect((await ask(f.a.plain.email, { turnstile: token() }, staging)).status).toBe(400);
    sv.answer = { success: true, action: "portal_link", hostname: "admin.example" };
    expect((await ask(f.a.plain.email, { turnstile: token() }, staging)).status).toBe(400);
    expect(await untouched()).toEqual(before);
    sv.answer = { success: true, action: "portal_link", hostname: "portal.example" };
    expect((await ask(f.a.plain.email, { turnstile: token() }, staging)).status).toBe(200);
  });

  it("fails closed when siteverify is down: a network error, a 500 and a body that is not JSON", async () => {
    const f = await fixtures();
    const before = await untouched();
    for (const answer of ["network-error", { httpStatus: 500 }, "not-json"] as const) {
      sv.answer = answer;
      const res = await ask(f.a.plain.email, { turnstile: token() });
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual(FAILED);
    }
    expect(await untouched()).toEqual(before);
  });

  it("sends siteverify the secret, the token and the RAW address (an IPv6 address is not cut to its /64)", async () => {
    const f = await fixtures();
    const t = token();
    await ask(f.a.plain.email, { turnstile: t }, env, "2001:db8:0:1:abcd:ef01:2345:6789");
    expect(sv.calls).toHaveLength(1);
    expect(sv.calls[0]?.get("secret")).toBe("test-turnstile-secret");
    expect(sv.calls[0]?.get("response")).toBe(t);
    expect(sv.calls[0]?.get("remoteip")).toBe("2001:db8:0:1:abcd:ef01:2345:6789");
  });

  it("a failure logs one code-only line: no address, email or token", async () => {
    const f = await fixtures();
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    try {
      await ask(f.a.plain.email, { turnstile: "bad-secret-token" }, env, "203.0.113.77");
    } finally {
      spy.mockRestore();
    }
    const ours = lines.filter((l) => l.includes("turnstile_failed"));
    expect(ours).toHaveLength(1);
    expect(JSON.parse(ours[0] as string)).toEqual({ ev: "magic.turnstile_failed", rid: expect.any(String) });
    const all = lines.join("\n");
    for (const forbidden of [f.a.plain.email, "203.0.113.77", "bad-secret-token", "test-turnstile-secret"])
      expect(all).not.toContain(forbidden);
  });

  it("L8b: 100 token-less requests for one email leave both quotas untouched, and a real request then succeeds", async () => {
    const f = await fixtures();
    const email = (await extraContact(f.a.id)).email;
    const mailKey = await portalMailKey(env.PORTAL_KEY_PEPPER, email);
    const ip = "198.51.100.200";
    const reqKey = await portalReqKey(env.PORTAL_KEY_PEPPER, ip);
    const before = await untouched();
    for (let i = 0; i < 100; i++) {
      const res = await ask(email, i % 2 ? {} : { turnstile: "bad-script-token" }, env, ip);
      if (res.status !== 400) throw new Error(`unexpected ${res.status}`);
    }
    expect(await attemptsRow(mailKey)).toBeNull();
    expect(await attemptsRow(reqKey)).toBeNull();
    expect(await untouched()).toEqual(before);
    const real = await ask(email, { turnstile: token() }, env, ip);
    expect(real.status).toBe(200);
    expect((await attemptsRow(mailKey))?.failures).toBe(1);
    expect((await attemptsRow(reqKey))?.failures).toBe(1);
  });

  it("the check is the same for every email: unknown and known get the same 400", async () => {
    const f = await fixtures();
    const a = await ask(f.a.plain.email, { turnstile: "bad-1" });
    const b = await ask("nobody-at-all@example.test", { turnstile: "bad-2" });
    expect([b.status, await bodyOf(b)]).toEqual([a.status, await bodyOf(a)]);
    expect(Object.fromEntries(b.headers)).toEqual(Object.fromEntries(a.headers));
  });
});

describe("the link email goes through the queue [POR-01, ADM-MAIL-01]", () => {
  it("queues one portal.magic_link email per organisation: the link, the organisation, the expiry and the token's hash as identity", async () => {
    const f = await fixtures();
    const email = "queue-two-orgs@example.test";
    await extraContact(f.a.id, { email });
    await extraContact(f.b.id, { email });
    const q = captureQueue();
    const t0 = Date.now();
    expect((await ask(email, { turnstile: token() }, q.env)).status).toBe(200);
    expect(q.sent).toHaveLength(2);
    const parsed = q.sent.map((m) => emailMessage.parse(m)); // the consumer's own schema accepts them
    expect(parsed.map((m) => m.template)).toEqual(["portal.magic_link", "portal.magic_link"]);
    expect(parsed.map((m) => m.to)).toEqual([email, email]);
    expect(parsed.map((m) => m.data.org_name).sort()).toEqual([f.a.name, f.b.name].sort());
    for (const m of parsed) {
      expect(Object.keys(m.data).sort()).toEqual(["expires_at", "org_name", "url"]);
      const url = new URL(m.data.url as string);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/auth/callback");
      expect(url.search).toBe("");
      expect(m.entity).toEqual({
        type: "magic_link",
        id: await tokenHash(tokenOfLink(m.data.url as string)),
      });
      const stored = await one<{ expires_at: number }>(
        "SELECT expires_at FROM magic_link_tokens WHERE token_hash = ?",
        m.entity.id,
      );
      expect(Number(m.data.expires_at)).toBe(stored?.expires_at);
      expect(Number(m.data.expires_at) - t0).toBeGreaterThanOrEqual(EXPIRES_IN);
    }
    expect(new Set(parsed.map((m) => m.entity.id)).size).toBe(2);
  });

  it("two real requests within 15 minutes are two emails (different token hashes), not one", async () => {
    const f = await fixtures();
    const email = (await extraContact(f.a.id)).email;
    const q = captureQueue();
    expect((await ask(email, { turnstile: token() }, q.env)).status).toBe(200);
    expect((await ask(email, { turnstile: token() }, q.env)).status).toBe(200);
    const ids = q.sent.map((m) => (m as { entity: { id: string } }).entity.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(MAGIC_MAIL_LIMIT).toBeGreaterThanOrEqual(2);
  });

  it("an unknown, no-access or anonymised email queues nothing", async () => {
    const f = await fixtures();
    const q = captureQueue();
    for (const email of ["stranger-queue@example.test", f.a.noAccess.email, f.a.anonymised.email])
      expect((await ask(email, { turnstile: token() }, q.env)).status).toBe(200);
    expect(q.sent).toEqual([]);
  });

  it("is identical for known and unknown emails: status, body, headers and D1 calls", async () => {
    const f = await fixtures();
    const q = captureQueue();
    const known = await counting("/auth/magic", {
      body: { email: f.a.finance.email, turnstile: token() },
      bare: true,
    });
    const unknown = await counting("/auth/magic", {
      body: { email: "unknown-same@example.test", turnstile: token() },
      bare: true,
    });
    expect([unknown.res.status, unknown.calls]).toEqual([known.res.status, known.calls]);
    expect(await bodyOf(unknown.res)).toEqual(await bodyOf(known.res));
    expect(Object.fromEntries(unknown.res.headers)).toEqual(Object.fromEntries(known.res.headers));
    expect(q.sent).toEqual([]);
  });

  it("a sender that never resolves still lets the response go: delivery rides ctx.waitUntil", async () => {
    const f = await fixtures();
    let sends = 0;
    const hung = createApp({
      sender: {
        send: () => {
          sends++;
          return new Promise<void>(() => {});
        },
      },
    });
    const waiting: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const post = (email: string) =>
      hung.request(
        `${ORIGIN}/api/v1/auth/magic`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "198.51.100.9" },
          body: JSON.stringify({ email, turnstile: token() }),
        },
        env,
        ctx,
      );
    const known = await post(f.a.finance.email);
    expect(known.status).toBe(200);
    expect(sends).toBe(1);
    const waitingAfterKnown = waiting.length;
    const unknown = await post("hung-unknown@example.test");
    expect(unknown.status).toBe(200);
    expect(await bodyOf(unknown)).toEqual(await bodyOf(known));
    expect(sends).toBe(1); // nothing to send for an unknown email
    expect(waitingAfterKnown).toBeGreaterThanOrEqual(1);
  });

  it("a queue that fails changes nothing for the caller: still 200 {ok:true}, one class-name-only log line, no URL", async () => {
    const f = await fixtures();
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    try {
      const q = captureQueue(env, () => new Error("queue down for secret@example.test #t=abc"));
      const res = await ask(f.a.finance.email, { turnstile: token() }, q.env);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    } finally {
      spy.mockRestore();
    }
    const ours = lines.filter((l) => l.includes("link delivery failed"));
    expect(ours).toHaveLength(1);
    expect(JSON.parse(ours[0] as string)).toMatchObject({ message: "link delivery failed", cause: "Error" });
    expect(lines.join("\n")).not.toMatch(/secret@example|#t=|auth\/callback/);
    // the token row still exists (the link works once it is somehow delivered; the person simply asks again)
    expect(await rows("SELECT 1 FROM magic_link_tokens")).not.toHaveLength(0);
  });

  it("the default entry point needs no injected sender: it uses the EMAIL_QUEUE binding", async () => {
    const f = await fixtures();
    const q = captureQueue();
    const send = callerFor((await import("./index.ts")).default);
    const res = await send(
      "/auth/magic",
      { body: { email: f.b.finance.email, turnstile: token() }, bare: true },
      q.env,
    );
    expect(res.status).toBe(200);
    expect(q.sent).toHaveLength(1);
  });
});
