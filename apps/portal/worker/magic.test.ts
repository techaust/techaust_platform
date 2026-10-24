// POST /api/v1/auth/magic: asking for a sign-in link [POR-01, NFR-9]. The same answer for every email, tokens only for
// eligible contacts (one per organisation), the quotas, and nothing written for a refused request.
import { env } from "cloudflare:workers";
import {
  MAGIC_IP_LIMIT,
  MAGIC_MAIL_LIMIT,
  MAGIC_TTL_MS,
  PORTAL_FAIL_LIMIT,
  portalMailKey,
  portalReqKey,
  tokenHash,
} from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import {
  attemptsRow,
  bodyOf,
  call,
  callerFor,
  capture,
  counted,
  counting,
  countOf,
  extraContact,
  one,
  rows,
  tokenOfLink,
  withDb,
  writes,
} from "./test-helpers.ts";

const ask = (target: ReturnType<typeof capture>, email: string, ip?: string | null) =>
  counting("/auth/magic", { body: { email }, ...(ip === undefined ? {} : { ip }) }, target.app);

/** Every table, with every row, as one string: where a raw token must never appear. */
async function wholeDatabase() {
  const tables = await rows<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
  );
  let all = "";
  for (const t of tables) all += JSON.stringify(await rows(`SELECT * FROM "${t.name}"`));
  return all;
}

describe("a link request answers the same for everyone [POR-01]", () => {
  it("known, unknown, no-access, anonymised and shared emails: same status, body (ignoring request_id) and 2 D1 calls", async () => {
    const f = await fixtures();
    const cap = capture();
    const asked = [
      ["finance A", f.a.finance.email],
      ["unknown", "nobody-at-all@example.test"],
      ["no portal access", f.a.noAccess.email],
      ["anonymised", f.a.anonymised.email],
      ["at two organisations", f.shared.email],
    ] as const;
    const results = [];
    for (const [name, email] of asked) {
      const { res, calls } = await ask(cap, email);
      results.push({ name, status: res.status, body: await bodyOf(res), calls });
    }
    for (const r of results) {
      expect(r.status, r.name).toBe(200);
      expect(r.body, r.name).toEqual({ ok: true });
      expect(r.calls, r.name).toBe(2);
    }
  });

  it("tokens (and sends) only for eligible contacts: one per organisation, none for the rest", async () => {
    const f = await fixtures();
    const cap = capture();
    const before = await countOf("magic_link_tokens");
    for (const email of [f.a.noAccess.email, f.a.anonymised.email, "stranger@example.test"])
      await ask(cap, email);
    expect(await countOf("magic_link_tokens")).toBe(before);
    expect(cap.sent).toEqual([]);

    const mine = await extraContact(f.a.id);
    await ask(cap, mine.email);
    expect(await countOf("magic_link_tokens")).toBe(before + 1);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0]).toMatchObject({ to: mine.email, orgName: f.a.name });
    const token = tokenOfLink(cap.sent[0]?.url as string);
    const stored = await one<{ contact_id: string; used_at: number | null; request_ip: string | null }>(
      "SELECT contact_id, used_at, request_ip FROM magic_link_tokens WHERE token_hash = ?",
      await tokenHash(token),
    );
    expect(stored).toEqual({ contact_id: mine.id, used_at: null, request_ip: null }); // LD15: no address kept
  });

  it("one email at two organisations gets one link per organisation, with different tokens (Q3)", async () => {
    const f = await fixtures();
    const cap = capture();
    const email = "twice-over@example.test";
    const inA = await extraContact(f.a.id, { email });
    const inB = await extraContact(f.b.id, { email });
    await ask(cap, email);
    expect(cap.sent.map((l) => l.orgName).sort()).toEqual([f.a.name, f.b.name].sort());
    const tokens = cap.sent.map((l) => tokenOfLink(l.url));
    expect(new Set(tokens).size).toBe(2);
    const owners = await Promise.all(
      tokens.map(
        async (t) =>
          (
            await one<{ contact_id: string }>(
              "SELECT contact_id FROM magic_link_tokens WHERE token_hash = ?",
              await tokenHash(t),
            )
          )?.contact_id,
      ),
    );
    expect(new Set(owners)).toEqual(new Set([inA.id, inB.id]));
  });

  it("the link is origin + /auth/callback#t=<43 characters>, expiring in 15 minutes; the token is in no path or query", async () => {
    const f = await fixtures();
    const cap = capture();
    const t0 = Date.now();
    await ask(cap, f.a.plain.email);
    const url = new URL(cap.sent[0]?.url as string);
    expect(url.origin).toBe("https://portal.example");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.search).toBe("");
    expect(url.hash).toMatch(/^#t=[A-Za-z0-9_-]{43}$/);
    const row = await one<{ expires_at: number }>(
      "SELECT expires_at FROM magic_link_tokens WHERE token_hash = ?",
      await tokenHash(tokenOfLink(url.href)),
    );
    expect(MAGIC_TTL_MS).toBe(15 * 60_000);
    expect((row?.expires_at as number) - t0).toBeGreaterThanOrEqual(MAGIC_TTL_MS);
    expect((row?.expires_at as number) - t0).toBeLessThan(MAGIC_TTL_MS + 5_000);
  });

  it("the email is matched trimmed and case-insensitively", async () => {
    const f = await fixtures();
    const cap = capture();
    const who = await extraContact(f.a.id, { email: "mixed-case-person@example.test" });
    const { res } = await ask(cap, `  ${who.email.toUpperCase()}  `);
    expect(res.status).toBe(200);
    expect(cap.sent).toHaveLength(1);
    expect(cap.sent[0]?.to).toBe(who.email);
  });

  it("the raw token appears in no table; only its SHA-256 is stored", async () => {
    const f = await fixtures();
    const cap = capture();
    const one_ = await extraContact(f.a.id);
    const two = await extraContact(f.b.id);
    await ask(cap, one_.email);
    await ask(cap, two.email);
    const everything = await wholeDatabase();
    for (const l of cap.sent) {
      const token = tokenOfLink(l.url);
      expect(everything).not.toContain(token);
      expect(everything).toContain(await tokenHash(token));
    }
  });

  it("a sender that fails changes nothing for the caller (still 200 {ok:true})", async () => {
    const f = await fixtures();
    const { createApp } = await import("./index.ts");
    const broken = createApp({
      sender: {
        async send() {
          throw new Error("smtp is down for a@example.test");
        },
      },
    });
    const who = await extraContact(f.a.id);
    const res = await callerFor(broken)("/auth/magic", { body: { email: who.email } });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true });
  });

  it("a bad body is a 400 with no D1 call; the route accepts nothing but JSON email", async () => {
    const cap = capture();
    for (const body of [{}, { email: "not-an-email" }, { email: 5 }, { email: "" }]) {
      const { res, calls } = await counting("/auth/magic", { body }, cap.app);
      expect(res.status).toBe(400);
      expect(calls).toBe(0);
    }
  });

  it("is declared public in the route table", () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/auth/magic")).toMatchObject({
      method: "POST",
      access: "public",
    });
  });
});

describe("quotas: 3 per email in 15 minutes, 10 per address in an hour [POR-01]", () => {
  const pepper = () => env.PORTAL_KEY_PEPPER;

  it("the 4th request for one email within 15 minutes is a 429, for an unknown email too; Retry-After is set", async () => {
    const f = await fixtures();
    const cap = capture();
    const known = await extraContact(f.a.id);
    for (const email of [known.email, "quota-unknown-1@example.test"]) {
      for (let i = 0; i < MAGIC_MAIL_LIMIT; i++) expect((await ask(cap, email)).res.status).toBe(200);
      const { res } = await ask(cap, email);
      expect(res.status).toBe(429);
      expect(await bodyOf(res)).toEqual({
        error: { code: "rate_limited", message: "Too many requests. Please try again later." },
      });
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(Number(res.headers.get("Retry-After"))).toBeLessThanOrEqual(900);
    }
  });

  it("known and unknown emails are refused identically (status, body, headers, calls)", async () => {
    const f = await fixtures();
    const cap = capture();
    const out = [];
    const known = await extraContact(f.a.id);
    for (const email of [known.email, "unknown-quota@example.test"]) {
      for (let i = 0; i < MAGIC_MAIL_LIMIT; i++) await ask(cap, email);
      const { res, calls } = await ask(cap, email);
      out.push({ status: res.status, body: await bodyOf(res), calls, retry: res.headers.has("Retry-After") });
    }
    expect(out[0]).toEqual(out[1]);
    expect(out[0]?.calls).toBe(1);
  });

  it("a refused request writes no token, session, audit or access row (only the counters move)", async () => {
    const f = await fixtures();
    const cap = capture();
    const email = (await extraContact(f.b.id)).email;
    for (let i = 0; i < MAGIC_MAIL_LIMIT; i++) await ask(cap, email);
    const before = await writes();
    const sentBefore = cap.sent.length;
    const { res } = await ask(cap, email);
    expect(res.status).toBe(429);
    expect(await writes()).toEqual(before);
    expect(cap.sent.length).toBe(sentBefore);
  });

  it("the 11th request from one address within an hour is a 429, and from then on that address writes NOTHING", async () => {
    const cap = capture();
    const ip = "192.0.2.77";
    for (let i = 1; i <= MAGIC_IP_LIMIT; i++) {
      const { res } = await ask(cap, `ip-quota-${i}@example.test`, ip);
      expect(res.status, `request ${i}`).toBe(200);
    }
    const dump = async () => JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key"));
    const before = { counters: await dump(), ...(await writes()) };
    const { res, calls } = await ask(cap, "ip-quota-11@example.test", ip);
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(900); // an hour's lock, not the email's 15 minutes
    expect({ counters: await dump(), ...(await writes()) }).toEqual(before); // not even a counter
    // a different address is unaffected
    expect((await ask(cap, "ip-quota-11@example.test", "192.0.2.78")).res.status).toBe(200);
  });

  it("the request that sets the address's lock (the 10th) is still counted for its email", async () => {
    const cap = capture();
    const ip = "192.0.2.90";
    for (let i = 1; i < MAGIC_IP_LIMIT; i++) await ask(cap, `ordering-${i}@example.test`, ip);
    const email = "ordering-10@example.test";
    expect((await ask(cap, email, ip)).res.status).toBe(200);
    expect((await attemptsRow(await portalMailKey(pepper(), email)))?.failures).toBe(1);
    expect((await attemptsRow(await portalReqKey(pepper(), ip)))?.locked_until).toBeGreaterThan(Date.now());
  });

  it("IPv6: addresses of one /64 share the address quota, another /64 does not", async () => {
    const cap = capture();
    for (let i = 1; i <= MAGIC_IP_LIMIT; i++) {
      // ten different addresses inside 2001:db8:77:1::/64
      const { res } = await ask(cap, `v6-quota-${i}@example.test`, `2001:db8:77:1:${i}:${i}:${i}:${i}`);
      expect(res.status, `request ${i}`).toBe(200);
    }
    expect((await ask(cap, "v6-quota-11@example.test", "2001:db8:77:1::beef")).res.status).toBe(429);
    expect((await ask(cap, "v6-quota-11@example.test", "2001:0db8:0077:0001:0:0:0:1")).res.status).toBe(429); // spelt out
    expect((await ask(cap, "v6-quota-11@example.test", "2001:db8:77:2::1")).res.status).toBe(200); // next /64
    const key = await portalReqKey(pepper(), "2001:db8:77:1::/64");
    expect((await attemptsRow(key))?.locked_until).toBeGreaterThan(Date.now());
  });

  it("IPv6: the failed-check counter (links and document links) is per /64 too", async () => {
    for (let i = 0; i < PORTAL_FAIL_LIMIT; i++)
      await call("/auth/magic/verify", { body: { token: `v6-fail-${i}` }, ip: `2001:db8:88:1::${i + 1}` });
    const blocked = await call("/t/document", { body: { token: "any" }, ip: "2001:db8:88:1:abcd::1" });
    expect(blocked.status).toBe(429);
    expect((await call("/t/document", { body: { token: "any" }, ip: "2001:db8:88:2::1" })).status).toBe(404);
  });

  it("counters are HMAC keys: no raw address or email in auth_attempts", async () => {
    const cap = capture();
    await ask(cap, "raw-check@example.test", "192.0.2.123");
    const keys = (await rows<{ key: string }>("SELECT key FROM auth_attempts")).map((r) => r.key);
    for (const k of keys) {
      expect(k).not.toContain("192.0.2.123");
      expect(k).not.toContain("raw-check");
    }
    expect(keys.some((k) => k.startsWith("p:req:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("p:mail:"))).toBe(true);
  });

  it("window rollover: an old window starts again, and an expired lock lets requests through", async () => {
    const cap = capture();
    const email = "rollover@example.test";
    for (let i = 0; i < MAGIC_MAIL_LIMIT; i++) await ask(cap, email);
    expect((await ask(cap, email)).res.status).toBe(429);
    const key = await portalMailKey(pepper(), email);
    // 16 minutes later: both the window (15 min) and the lock (15 min) are over
    await env.DB.prepare(
      "UPDATE auth_attempts SET window_start = window_start - ?2, locked_until = locked_until - ?2 WHERE key = ?1",
    )
      .bind(key, 16 * 60_000)
      .run();
    expect((await ask(cap, email)).res.status).toBe(200);
    expect((await attemptsRow(key))?.failures).toBe(1);
  });

  it("the quota is per email, not shared: another email from other addresses is unaffected", async () => {
    const cap = capture();
    for (let i = 0; i < MAGIC_MAIL_LIMIT; i++) await ask(cap, "busy@example.test");
    expect((await ask(cap, "busy@example.test")).res.status).toBe(429);
    expect((await ask(cap, "calm@example.test")).res.status).toBe(200);
  });

  it("a request with no address header shares one bucket (the strict side)", async () => {
    const cap = capture();
    for (let i = 0; i < MAGIC_IP_LIMIT; i++)
      expect((await ask(cap, `noip-${i}@example.test`, null)).res.status).toBe(200);
    expect((await ask(cap, "noip-x@example.test", null)).res.status).toBe(429);
  });
});

describe("D1 calls and the access row [NFR-2, NFR-9]", () => {
  it("success makes 2 calls and writes exactly one access row (actor null, status 200, route pattern, realm portal)", async () => {
    const f = await fixtures();
    const cap = capture();
    const c = counted();
    const t0 = Date.now();
    const who = await extraContact(f.a.id);
    const res = await callerFor(cap.app)(
      "/auth/magic",
      {
        body: { email: who.email },
        ip: "192.0.2.5",
        headers: { "User-Agent": "magic-test-agent", "cf-ray": "ray-magic-1" },
      },
      c.env,
    );
    expect(res.status).toBe(200);
    expect(c.calls()).toBe(2);
    const log = await rows<Record<string, unknown>>(
      "SELECT realm, actor_id, method, route, status, ip, user_agent, request_id FROM access_log WHERE request_id = 'ray-magic-1'",
    );
    expect(log).toEqual([
      {
        realm: "portal",
        actor_id: null,
        method: "POST",
        route: "/api/v1/auth/magic",
        status: 200,
        ip: "192.0.2.5",
        user_agent: "magic-test-agent",
        request_id: "ray-magic-1",
      },
    ]);
    expect(await countOf("audit_log", "request_id = 'ray-magic-1'")).toBe(0); // no audit row for a link request (LD11)
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("the access row of an unknown email is the same as a known one's", async () => {
    const cap = capture();
    await callerFor(cap.app)("/auth/magic", {
      body: { email: "who@example.test" },
      headers: { "cf-ray": "ray-magic-2" },
    });
    expect(
      await countOf("access_log", "request_id = 'ray-magic-2' AND status = 200 AND actor_id IS NULL"),
    ).toBe(1);
  });

  it("the contact read uses the email index", async () => {
    const plan = await rows<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT c.id, cl.display_name FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.email = ?1 AND c.portal_access = 1 AND c.anonymised_at IS NULL",
      "x@example.test",
    );
    const text = plan.map((p) => p.detail).join("\n");
    expect(text).toMatch(/USING INDEX contacts_email|contacts_email/);
    expect(text).not.toMatch(/SCAN c\b|SCAN contacts/);
  });

  it("a contact added later is found (no stale cache)", async () => {
    const f = await fixtures();
    const cap = capture();
    const late = await extraContact(f.b.id, { email: "late-joiner@example.test" });
    await ask(cap, late.email);
    expect(cap.sent).toHaveLength(1);
  });
});

describe("a link is not minted for a contact an admin changed after the read (M3.3 race)", () => {
  /** `env` whose second D1 batch (the token writes) waits for `hook`: a change that lands between the read and the write. */
  const hooked = (hook: () => Promise<void>): Env => {
    let batches = 0;
    return withDb({
      prepare: (q: string) => env.DB.prepare(q),
      batch: async (stmts: D1PreparedStatement[]) => {
        if (++batches === 2) await hook();
        return env.DB.batch(stmts);
      },
    } as unknown as D1Database);
  };
  const raced = async (change: (contactId: string) => string) => {
    const f = await fixtures();
    const cap = capture();
    const c = await extraContact(f.a.id);
    const before = await countOf("magic_link_tokens");
    const res = await callerFor(cap.app)(
      "/auth/magic",
      { body: { email: c.email } },
      hooked(async () => {
        await env.DB.prepare(change(c.id)).bind(c.id).run();
      }),
    );
    return { res, cap, c, minted: (await countOf("magic_link_tokens")) - before };
  };

  it("an email changed in between: no token, nothing sent, the same answer", async () => {
    const r = await raced(() => "UPDATE contacts SET email = 'moved.on@example.test' WHERE id = ?");
    expect(r.res.status).toBe(200);
    expect(await bodyOf(r.res)).toEqual({ ok: true });
    expect(r.minted).toBe(0);
    expect(r.cap.sent).toEqual([]);
  });

  it("portal access turned off in between, or the contact anonymised: no token, nothing sent", async () => {
    for (const change of [
      "UPDATE contacts SET portal_access = 0 WHERE id = ?",
      "UPDATE contacts SET anonymised_at = 1 WHERE id = ?",
    ]) {
      const r = await raced(() => change);
      expect(r.res.status, change).toBe(200);
      expect(await bodyOf(r.res), change).toEqual({ ok: true });
      expect(r.minted, change).toBe(0);
      expect(r.cap.sent, change).toEqual([]);
    }
  });

  it("with no change in between the link is minted and sent as before", async () => {
    const r = await raced(() => "UPDATE contacts SET name = name WHERE id = ?");
    expect(r.minted).toBe(1);
    expect(r.cap.sent).toHaveLength(1);
  });
});
