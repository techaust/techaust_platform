// Recovery codes and TOTP replay [ADM-AUTH-04]: ten single-use codes shown once, only their hashes stored.
import { env } from "cloudflare:workers";
import { recoveryCodeHash, totpCode } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import {
  barrierDb,
  bodyOf,
  call,
  challengeFor,
  cookieOf,
  counting,
  countOf,
  type Enrolled,
  enrol,
  one,
  rows,
  userId,
  withDb,
} from "./test-helpers.ts";

const CODE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/;
const INVALID = { error: { code: "invalid_credentials", message: "Invalid email, password or code" } };

async function recover(e: Enrolled, code: string, challenge?: string, env_: Env = env) {
  const c = challenge ?? (await challengeFor(e.email, e.clientHash, env_));
  return call("/auth/recovery", { body: { challenge: c, code } }, env_);
}

describe("recovery codes at enrolment [ADM-AUTH-04]", () => {
  it("ten codes of 16 base32 characters come back once and are never stored in plain", async () => {
    const e = await enrol("rc-enrol@example.com");
    expect(e.recoveryCodes).toHaveLength(10);
    expect(new Set(e.recoveryCodes).size).toBe(10);
    for (const code of e.recoveryCodes) expect(code).toMatch(CODE);
    const id = await userId(e.email);
    const stored = await rows<{ code_hash: string; used_at: number | null }>(
      "SELECT code_hash, used_at FROM staff_recovery_codes WHERE user_id = ?",
      id,
    );
    expect(stored).toHaveLength(10);
    const hashes = new Set(stored.map((s) => s.code_hash));
    for (const code of e.recoveryCodes) {
      expect(hashes.has(await recoveryCodeHash(code))).toBe(true);
      expect(JSON.stringify(stored)).not.toContain(code.replaceAll("-", ""));
    }
    for (const s of stored) expect(s.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("they are never returned again: sessions only count what is left", async () => {
    const e = await enrol("rc-once@example.com");
    const res = await call("/auth/sessions", { cookie: e.cookie });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.recovery_codes_remaining).toBe(10);
    expect(JSON.stringify(body)).not.toMatch(/[A-Z2-7]{16}/);
  });

  it("a replayed enrolment code does not give a second session", async () => {
    const e = await enrol("rc-replay@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    expect((await call("/auth/totp", { body: { challenge, code: totpCode(e.secret, e.step) } })).status).toBe(
      401,
    );
  });
});

describe("signing in with a recovery code [ADM-AUTH-04]", () => {
  it("works once; the code is then used up and refused", async () => {
    const e = await enrol("rc-use@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    const code = e.recoveryCodes[0] as string;
    const first = await recover(e, code, challenge);
    expect(first.status).toBe(200);
    expect(cookieOf(first)).toMatch(/^__Host-ta_admin=/);
    expect(await countOf("staff_recovery_codes", "user_id = ? AND used_at IS NOT NULL", id)).toBe(1);
    expect((await recover(e, code, challenge)).status).toBe(401);
    // the new session is a real one
    expect((await call("/auth/me", { cookie: cookieOf(first) as string })).status).toBe(200);
    const left = (await (await call("/auth/sessions", { cookie: cookieOf(first) as string })).json()) as {
      recovery_codes_remaining: number;
    };
    expect(left.recovery_codes_remaining).toBe(9);
  });

  it("accepts lower case, spaces and hyphens in any place", async () => {
    const e = await enrol("rc-forms@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const [a, b, c] = e.recoveryCodes as [string, string, string];
    const spelled = [
      a.toLowerCase(), // abcd-efgh-...
      b.replaceAll("-", " "), // ABCD EFGH ...
      ` ${c
        .replaceAll("-", "")
        .toLowerCase()
        .replace(/(.{4})/g, "$1 ")}`, // spaces, lower case, no hyphens
    ];
    for (const s of spelled) expect((await recover(e, s, challenge)).status, s).toBe(200);
  });

  it("refuses a wrong, a malformed and another member's code, all with the generic answer", async () => {
    const e = await enrol("rc-wrong@example.com");
    const other = await enrol("rc-other@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    for (const code of ["AAAA-BBBB-CCCC-DDDD", "x", "", "💥", other.recoveryCodes[0] as string]) {
      const res = await recover(e, code, challenge);
      expect(res.status, code).toBe(401);
      expect(await bodyOf(res)).toEqual(INVALID);
    }
    expect(
      await countOf("staff_recovery_codes", "used_at IS NOT NULL AND user_id = ?", await userId(other.email)),
    ).toBe(0);
  });

  it("two parallel uses of one code give exactly one session", async () => {
    const e = await enrol("rc-race@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    const before = await countOf("staff_sessions", "user_id = ?", id);
    const barrier = withDb(barrierDb(env.DB, 2));
    const code = e.recoveryCodes[1] as string;
    const rs = await Promise.all([
      recover(e, code, challenge, barrier),
      recover(e, code, challenge, barrier),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await countOf("staff_sessions", "user_id = ?", id)).toBe(before + 1);
    expect(await countOf("staff_recovery_codes", "user_id = ? AND used_at IS NOT NULL", id)).toBe(1);
    expect(await countOf("audit_log", "action = 'auth.login' AND actor_id = ?", id)).toBe(2); // enrolment + this
  });

  it("raises alert.2fa_change, writes one auth.login row (via recovery) and clears the counters", async () => {
    const e = await enrol("rc-alert@example.com");
    const id = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    await recover(e, "AAAA-BBBB-CCCC-DDDD", challenge); // one wrong attempt first
    expect((await one("SELECT failures FROM auth_attempts WHERE key = ?", `code:${id}`))?.failures).toBe(1);
    const res = await recover(e, e.recoveryCodes[2] as string, challenge);
    expect(res.status).toBe(200);
    expect(await one("SELECT 1 FROM auth_attempts WHERE key = ?", `code:${id}`)).toBeNull();
    expect(await countOf("audit_log", "action = 'alert.2fa_change' AND entity_id = ?", id)).toBe(1);
    const login = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'auth.login' AND actor_id = ? ORDER BY at DESC, id DESC LIMIT 1",
      id,
    );
    expect(JSON.parse(login?.summary as string)).toEqual({ via: "recovery" });
  });

  it("D1 calls: success 2, wrong 1+L, locked 1+L", async () => {
    const e = await enrol("rc-calls@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    const wrong = await counting("/auth/recovery", { body: { challenge, code: "AAAA-BBBB-CCCC-DDDD" } });
    expect([wrong.res.status, wrong.calls]).toEqual([401, 2]);
    const ok = await counting("/auth/recovery", { body: { challenge, code: e.recoveryCodes[3] as string } });
    expect([ok.res.status, ok.calls]).toEqual([200, 2]);
    // the sign-in above cleared the counter, so lock it by hand
    await env.DB.prepare(
      "INSERT OR REPLACE INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, 10, ?)",
    )
      .bind(`code:${await userId(e.email)}`, Date.now(), Date.now() + 60_000)
      .run();
    const locked = await counting("/auth/recovery", {
      body: { challenge, code: e.recoveryCodes[4] as string },
    });
    expect([locked.res.status, locked.calls]).toEqual([429, 2]);
  });
});

describe("regenerating recovery codes [ADM-AUTH-04, -08]", () => {
  it("needs a step-up first", async () => {
    const e = await enrol("rc-regen-needs@example.com");
    const res = await call("/auth/recovery/regenerate", { method: "POST", cookie: e.cookie });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("step_up_required");
  });

  it("with a step-up it makes ten new codes and the old ones stop working", async () => {
    const e = await enrol("rc-regen@example.com");
    const id = await userId(e.email);
    const step = await call("/auth/step-up", {
      body: { code: totpCode(e.secret, e.step + 1) },
      cookie: e.cookie,
    });
    expect(step.status).toBe(200);
    const [calls0, access0] = [
      await countOf("audit_log", "action = 'alert.2fa_change'"),
      await countOf("access_log"),
    ];
    const res = await call("/auth/recovery/regenerate", { method: "POST", cookie: e.cookie });
    expect(res.status).toBe(200);
    const fresh = ((await res.json()) as { recoveryCodes: string[] }).recoveryCodes;
    expect(fresh).toHaveLength(10);
    for (const c of fresh) expect(c).toMatch(CODE);
    expect(fresh.some((c) => e.recoveryCodes.includes(c))).toBe(false);
    expect(await countOf("staff_recovery_codes", "user_id = ?", id)).toBe(10); // not 20: the old ones are gone
    expect(await countOf("audit_log", "action = 'auth.recovery_regenerate' AND actor_id = ?", id)).toBe(1);
    expect(await countOf("audit_log", "action = 'alert.2fa_change'")).toBe(calls0 + 1);
    expect(await countOf("access_log")).toBe(access0 + 1);

    const challenge = await challengeFor(e.email, e.clientHash);
    expect((await recover(e, e.recoveryCodes[0] as string, challenge)).status).toBe(401);
    expect((await recover(e, fresh[0] as string, challenge)).status).toBe(200);
  });

  it("also kills used codes' history: the count restarts at ten", async () => {
    const e = await enrol("rc-regen-used@example.com");
    const challenge = await challengeFor(e.email, e.clientHash);
    expect((await recover(e, e.recoveryCodes[0] as string, challenge)).status).toBe(200);
    await call("/auth/step-up", { body: { code: totpCode(e.secret, e.step + 1) }, cookie: e.cookie });
    await call("/auth/recovery/regenerate", { method: "POST", cookie: e.cookie });
    const left = (await (await call("/auth/sessions", { cookie: e.cookie })).json()) as {
      recovery_codes_remaining: number;
    };
    expect(left.recovery_codes_remaining).toBe(10);
  });
});
