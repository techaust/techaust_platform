import { argon2Sync } from "node:crypto";
import { generateHOTP } from "@oslojs/otp";
import { describe, expect, it } from "vitest";
import { clientHash } from "../src/client.ts";
import { b64url, decrypt, encrypt, fromB64url, randomBytes } from "../src/crypto.ts";
import { isLocked, LOCK_AFTER, LOCK_MS, needsTurnstile, recordFailure, WINDOW_MS } from "../src/lockout.ts";
import {
  DEFAULT_PARAMS,
  fakeSalt,
  isClientHash,
  newSalt,
  passwordHmac,
  verifyPassword,
} from "../src/password.ts";
import {
  checkSession,
  IDLE_MS,
  newSession,
  readCookie,
  sessionCookie,
  TOUCH_EVERY_MS,
} from "../src/session.ts";
import { newToken, signChallenge, tokenHash, verifyChallenge } from "../src/tokens.ts";
import { currentStep, openTotpSecret, sealTotpSecret, totpUri, verifyTotp } from "../src/totp.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("browser Argon2id (hash-wasm) matches Node's own Argon2id", () => {
  it("produces the same 32-byte hash for the same inputs", async () => {
    const salt = b64url(new TextEncoder().encode("somesaltsomesalt"));
    const ours = await clientHash("password", salt, DEFAULT_PARAMS);
    const node = argon2Sync("argon2id", {
      message: "password",
      nonce: Buffer.from("somesaltsomesalt"),
      parallelism: 1,
      tagLength: 32,
      memory: DEFAULT_PARAMS.m,
      passes: DEFAULT_PARAMS.t,
    });
    expect(Buffer.from(fromB64url(ours)).toString("hex")).toBe(node.toString("hex"));
    expect(isClientHash(ours)).toBe(true);
  });
});

describe("password HMAC [ADM-AUTH-02]", () => {
  it("verifies the right client hash only", async () => {
    const salt = newSalt();
    const hash = b64url(randomBytes(32));
    const stored = await passwordHmac(KEY, salt, hash);
    expect(await verifyPassword(KEY, salt, hash, stored)).toBe(true);
    expect(await verifyPassword(KEY, salt, b64url(randomBytes(32)), stored)).toBe(false);
    expect(await verifyPassword(KEY2, salt, hash, stored)).toBe(false); // a DB leak without the pepper is useless
    expect(await verifyPassword(KEY, salt, hash, null)).toBe(false); // unknown user: same work, always false
  });

  it("fake salts are stable per email, look real, and differ between emails", async () => {
    const a = await fakeSalt(KEY, "Nobody@Example.com ");
    expect(a).toBe(await fakeSalt(KEY, "nobody@example.com"));
    expect(a).not.toBe(await fakeSalt(KEY, "other@example.com"));
    expect(a.length).toBe(newSalt().length);
  });

  it("refuses short keys", async () => {
    await expect(passwordHmac(btoa("short"), newSalt(), b64url(randomBytes(32)))).rejects.toThrow(/32 bytes/);
  });
});

describe("TOTP [ADM-AUTH-01]", () => {
  // RFC 6238 Appendix B (SHA-1): secret "12345678901234567890", T = 59 s → 94287082 (8 digits).
  const rfcSecret = new TextEncoder().encode("12345678901234567890");

  it("matches the RFC 6238 test vector", () => {
    expect(generateHOTP(rfcSecret, BigInt(currentStep(59_000)), 8)).toBe("94287082");
    expect(verifyTotp(rfcSecret, "287082", 59_000, null)).toEqual({ ok: true, step: 1 });
  });

  it("accepts one step of drift either way, and never the same step twice", () => {
    const now = 1_790_000_000_000;
    const step = currentStep(now);
    const code = (s: number) => generateHOTP(rfcSecret, BigInt(s), 6);
    expect(verifyTotp(rfcSecret, code(step - 1), now, null)).toEqual({ ok: true, step: step - 1 });
    expect(verifyTotp(rfcSecret, code(step + 1), now, null)).toEqual({ ok: true, step: step + 1 });
    expect(verifyTotp(rfcSecret, code(step - 2), now, null)).toEqual({ ok: false });
    expect(verifyTotp(rfcSecret, code(step), now, step)).toEqual({ ok: false }); // replay
    expect(verifyTotp(rfcSecret, code(step), now, step - 1)).toEqual({ ok: true, step });
    expect(verifyTotp(rfcSecret, "12345", now, null)).toEqual({ ok: false });
    expect(verifyTotp(rfcSecret, "abcdef", now, null)).toEqual({ ok: false });
  });

  it("stores the secret encrypted and bound to its user", async () => {
    const secret = randomBytes(20);
    const sealed = await sealTotpSecret(KEY, "user-1", secret);
    expect(await openTotpSecret(KEY, "user-1", sealed)).toEqual(secret);
    await expect(openTotpSecret(KEY, "user-2", sealed)).rejects.toThrow();
    await expect(openTotpSecret(KEY2, "user-1", sealed)).rejects.toThrow();
    expect(sealed).not.toBe(await sealTotpSecret(KEY, "user-1", secret)); // fresh IV each time
    expect(totpUri("owner@techaust.com", secret)).toMatch(
      /^otpauth:\/\/totp\/TecHaust:owner%40techaust\.com\?/,
    );
  });

  it("AES-GCM rejects tampering", async () => {
    const sealed = await encrypt(KEY, new Uint8Array([1, 2, 3]), "x");
    const raw = fromB64url(sealed);
    raw[raw.length - 1] = (raw[raw.length - 1] as number) ^ 1;
    await expect(decrypt(KEY, b64url(raw), "x")).rejects.toThrow();
  });
});

describe("tokens and challenges", () => {
  it("token hashes are stable SHA-256 hex", async () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await tokenHash(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(await tokenHash(t)).toBe(await tokenHash(t));
  });

  it("challenges verify only when untampered, unexpired and for the right purpose", async () => {
    const c = { purpose: "login_totp" as const, sub: "u1", exp: 2_000 };
    const token = await signChallenge(KEY, c);
    expect(await verifyChallenge(KEY, token, "login_totp", 1_000)).toEqual(c);
    expect(await verifyChallenge(KEY, token, "login_totp", 2_000)).toBeNull();
    expect(await verifyChallenge(KEY, token, "enrol_totp", 1_000)).toBeNull();
    expect(await verifyChallenge(KEY2, token, "login_totp", 1_000)).toBeNull();
    const [body, mac] = token.split(".") as [string, string];
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...c, sub: "owner" })));
    expect(await verifyChallenge(KEY, `${forged}.${mac}`, "login_totp", 1_000)).toBeNull();
    expect(await verifyChallenge(KEY, body, "login_totp", 1_000)).toBeNull();
    expect(await verifyChallenge(KEY, `${token}.x`, "login_totp", 1_000)).toBeNull();
    expect(await verifyChallenge(KEY, `${body}.!!!`, "login_totp", 1_000)).toBeNull();
  });
});

describe("sessions [ADM-AUTH-05]", () => {
  it("expire on idle and absolute limits, and touch at most every 15 minutes", async () => {
    const s = await newSession(0);
    expect(s.id).toBe(await tokenHash(s.token));
    const row = { ...s, revokedAt: null };
    expect(checkSession(row, 1)).toEqual({ valid: true, touch: false });
    expect(checkSession(row, TOUCH_EVERY_MS)).toEqual({ valid: true, touch: true });
    expect(checkSession(row, IDLE_MS).valid).toBe(false);
    expect(checkSession({ ...row, idleExpiresAt: Number.MAX_SAFE_INTEGER }, s.absExpiresAt).valid).toBe(
      false,
    );
    expect(checkSession({ ...row, revokedAt: 1 }, 1).valid).toBe(false);
  });

  it("uses a __Host- cookie that scripts and other sites can't read", () => {
    const c = sessionCookie("abc", 60);
    expect(c).toMatch(/^__Host-ta_admin=abc; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=60$/);
    expect(readCookie("a=1; __Host-ta_admin=tok=en; b=2")).toBe("tok=en");
    expect(readCookie("a=1")).toBeNull();
    expect(readCookie(null)).toBeNull();
  });
});

describe("lockout", () => {
  it("asks for Turnstile after 3 failures and locks for 15 minutes after 10 in an hour", () => {
    let a = null as ReturnType<typeof recordFailure> | null;
    for (let i = 1; i <= LOCK_AFTER; i++) {
      a = recordFailure(a, 1_000 * i);
      expect(needsTurnstile(a, 1_000 * i)).toBe(i >= 3);
      expect(isLocked(a, 1_000 * i)).toBe(i >= LOCK_AFTER);
    }
    expect(isLocked(a, 10_000 + LOCK_MS)).toBe(false);
    expect(recordFailure(a, WINDOW_MS + 5_000).failures).toBe(1); // a new window
    expect(isLocked(null, 0)).toBe(false);
    expect(needsTurnstile(null, 0)).toBe(false);
  });
});
