import { env, exports } from "cloudflare:workers";
import {
  b64url,
  currentStep,
  newToken,
  randomBytes,
  secretFromBase32,
  tokenHash,
  totpCode,
} from "@techaust/auth";
import { describe, expect, it } from "vitest";

const BASE = "https://admin.example/api/v1/auth";
const post = (path: string, body: unknown, cookie?: string) =>
  exports.default.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.example",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const hash = () => b64url(randomBytes(32));

async function invite(email: string, role = "owner") {
  const token = newToken();
  await env.DB.prepare("INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await tokenHash(token), email, role, Date.now() + 60_000)
    .run();
  return token;
}

/** Walk an invite through enrolment; returns the client hash, TOTP secret and the step used. */
async function enrol(email: string) {
  const token = await invite(email);
  const start = (await (await post("/invite/start", { token })).json()) as { email: string; salt: string };
  expect(start.email).toBe(email);
  const clientHash = hash();
  const finish = (await (await post("/invite/finish", { token, clientHash })).json()) as {
    secret: string;
    challenge: string;
    totpUri: string;
  };
  expect(finish.totpUri).toMatch(/^otpauth:\/\/totp\/TecHaust:/);
  const secret = secretFromBase32(finish.secret);
  const step = currentStep(Date.now());
  const res = await post("/invite/totp", { challenge: finish.challenge, code: totpCode(secret, step) });
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toMatch(
    /^__Host-ta_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/,
  );
  return { clientHash, secret, step, token };
}

async function login(email: string, clientHash: string, secret: Uint8Array, step: number) {
  const salt = await post("/salt", { email });
  expect(salt.status).toBe(200);
  const l = await post("/login", { email, clientHash });
  if (l.status !== 200) return { status: l.status, cookie: null };
  const { challenge } = (await l.json()) as { challenge: string };
  const t = await post("/totp", { challenge, code: totpCode(secret, step) });
  return { status: t.status, cookie: t.headers.get("Set-Cookie")?.split(";")[0] ?? null };
}

describe("staff login (docs/05 §6.1) [ADM-AUTH-01, -02, -05, -07]", () => {
  it("invite → password → TOTP → active owner with a session; the invite is single-use", async () => {
    const { token } = await enrol("owner@example.com");
    const user = await env.DB.prepare("SELECT status, role, totp_enabled_at FROM staff_users WHERE email = ?")
      .bind("owner@example.com")
      .first();
    expect(user).toMatchObject({ status: "active", role: "owner" });
    expect((await post("/invite/start", { token })).status).toBe(400);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'auth.login'").first(),
    ).toEqual({ n: 1 });
  });

  it("logs in with the right hash and code, then /me and logout work", async () => {
    const { clientHash, secret, step } = await enrol("staff1@example.com");
    const ok = await login("staff1@example.com", clientHash, secret, step + 1);
    expect(ok.status).toBe(200);
    const me = await exports.default.fetch(`${BASE}/me`, { headers: { Cookie: ok.cookie as string } });
    expect(await me.json()).toEqual({
      user: { name: "staff1@example.com", email: "staff1@example.com", role: "owner" },
    });
    await post("/logout", {}, ok.cookie as string);
    const after = await exports.default.fetch(`${BASE}/me`, { headers: { Cookie: ok.cookie as string } });
    expect(after.status).toBe(401);
  });

  it("refuses a replayed TOTP code", async () => {
    const { clientHash, secret, step } = await enrol("staff2@example.com");
    expect((await login("staff2@example.com", clientHash, secret, step)).status).toBe(401); // used at enrolment
  });

  it("gives identical answers for unknown emails and wrong passwords (no enumeration)", async () => {
    const { secret, step } = await enrol("staff3@example.com");
    const unknown = await post("/salt", { email: "nobody@example.com" });
    const again = await post("/salt", { email: "nobody@example.com" });
    const a = (await unknown.json()) as { salt: string };
    expect(a).toEqual(await again.json());
    expect(a.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const wrong = await login("staff3@example.com", hash(), secret, step + 1);
    const none = await login("nobody@example.com", hash(), secret, step + 1);
    expect([wrong.status, none.status]).toEqual([401, 401]);
  });

  it("locks an account after 10 failures in an hour", async () => {
    const { clientHash, secret, step } = await enrol("staff4@example.com");
    for (let i = 0; i < 10; i++)
      expect((await post("/login", { email: "staff4@example.com", clientHash: hash() })).status).toBe(401);
    expect((await post("/login", { email: "staff4@example.com", clientHash })).status).toBe(429);
    expect((await login("staff4@example.com", clientHash, secret, step + 1)).status).toBe(429);
  });

  it("rejects malformed, oversized and cross-site requests", async () => {
    expect((await post("/login", { email: "x" })).status).toBe(400);
    expect((await post("/login", { email: "a@b.co", clientHash: "x".repeat(20_000) })).status).toBe(413);
    const form = await exports.default.fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
      body: "email=a@b.co",
    });
    expect(form.status).toBe(403);
    const res = await post("/totp", { challenge: "forged.challenge", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
