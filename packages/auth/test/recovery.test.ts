import { describe, expect, it } from "vitest";
import { DEVICE_COOKIE, DEVICE_MAX_AGE_S, deviceCookie, deviceFor } from "../src/device.ts";
import { isClientHash } from "../src/password.ts";
import {
  formatRecoveryCode,
  isRecoveryCode,
  newRecoveryCodes,
  normaliseRecoveryCode,
  RECOVERY_CODE_COUNT,
  recoveryCodeHash,
} from "../src/recovery.ts";
import {
  inviteFinishRequest,
  loginRequest,
  recoveryRequest,
  saltRequest,
  sessionIdParam,
  stepUpRequest,
} from "../src/schemas.ts";
import { INVITE_TTL_MS, STEP_UP_MS, stepUpActive } from "../src/session.ts";
import { newToken } from "../src/tokens.ts";

describe("recovery codes [ADM-AUTH-04]", () => {
  it("ten distinct codes of 16 base32 characters", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z2-7]{16}$/);
      expect(isRecoveryCode(c)).toBe(true);
    }
    expect(new Set([...newRecoveryCodes(), ...newRecoveryCodes(), ...newRecoveryCodes()]).size).toBe(30);
  });

  it("normalises case, spaces and hyphens, and nothing else", () => {
    expect(normaliseRecoveryCode(" abcd-efgh ijkl\tmnop\n")).toBe("ABCDEFGHIJKLMNOP");
    expect(normaliseRecoveryCode("ABCD-EFGH-IJKL-MNOP")).toBe("ABCDEFGHIJKLMNOP");
    expect(isRecoveryCode("ABCDEFGHIJKLMNO")).toBe(false); // 15
    expect(isRecoveryCode("ABCDEFGHIJKLMNO1")).toBe(false); // '1' isn't base32
    expect(isRecoveryCode("abcdefghijklmnop")).toBe(false); // only after normalising
  });

  it("formats in four groups, and every spelling hashes the same", async () => {
    const c = newRecoveryCodes()[0] as string;
    const shown = formatRecoveryCode(c);
    expect(shown).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    const h = await recoveryCodeHash(c);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await recoveryCodeHash(shown)).toBe(h);
    expect(await recoveryCodeHash(shown.toLowerCase().replaceAll("-", " "))).toBe(h);
    expect(await recoveryCodeHash(newRecoveryCodes()[1] as string)).not.toBe(h);
  });
});

describe("known devices [ADM-AUTH-09]", () => {
  it("keeps a well-formed token the browser sent, and makes a new one for nothing or garbage", async () => {
    const token = newToken();
    const kept = await deviceFor(token);
    expect(kept.token).toBe(token);
    expect(kept.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await deviceFor(token)).hash).toBe(kept.hash);
    for (const bad of [null, "", "short", `${token}x`, "!".repeat(43)]) {
      const fresh = await deviceFor(bad);
      expect(fresh.token).not.toBe(bad);
      expect(fresh.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect((await deviceFor(null)).hash).not.toBe((await deviceFor(null)).hash);
  });

  it("the cookie is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/ for 400 days", () => {
    expect(DEVICE_COOKIE).toBe("__Host-ta_device");
    expect(DEVICE_MAX_AGE_S).toBe(34_560_000);
    expect(deviceCookie("tok")).toBe(
      "__Host-ta_device=tok; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=34560000",
    );
  });
});

describe("step-up and invite timing [ADM-AUTH-08, ADM-AUTH-07]", () => {
  it("ten minutes of step-up, 48 hours of invite", () => {
    expect(STEP_UP_MS).toBe(10 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  it("stepUpActive: strictly before the end, never for null or undefined", () => {
    expect(stepUpActive(1000, 999)).toBe(true);
    expect(stepUpActive(1000, 1000)).toBe(false);
    expect(stepUpActive(null, 0)).toBe(false);
    expect(stepUpActive(undefined, 0)).toBe(false);
  });
});

describe("request shapes", () => {
  const hash = "A".repeat(43); // decodes to 32 zero bytes
  it("isClientHash needs 43 URL-safe characters that decode to exactly 32 bytes", () => {
    expect(isClientHash(hash)).toBe(true);
    expect(isClientHash("x".repeat(43))).toBe(false); // stray trailing bits
    expect(isClientHash("A".repeat(42))).toBe(false);
    expect(isClientHash(`${"A".repeat(42)}=`)).toBe(false);
    expect(isClientHash(`${"A".repeat(42)}B`)).toBe(false);
  });

  it("login and invite-finish take only a canonical hash; invite-finish needs a name", () => {
    expect(loginRequest.safeParse({ email: "A@B.co", clientHash: hash }).success).toBe(true);
    expect(loginRequest.safeParse({ email: "a@b.co", clientHash: "x".repeat(43) }).success).toBe(false);
    const base = { token: hash, clientHash: hash };
    expect(inviteFinishRequest.safeParse({ ...base, name: "  Asha  " })).toMatchObject({
      success: true,
      data: { name: "Asha" },
    });
    for (const name of [undefined, "", "   ", "x".repeat(101)])
      expect(inviteFinishRequest.safeParse({ ...base, name }).success).toBe(false);
    expect(saltRequest.safeParse({ email: " Mixed@Case.IN " })).toMatchObject({
      success: true,
      data: { email: "mixed@case.in" },
    });
  });

  it("recovery, step-up and session id shapes", () => {
    expect(recoveryRequest.safeParse({ challenge: "c", code: "abcd efgh" }).success).toBe(true);
    expect(recoveryRequest.safeParse({ challenge: "c", code: "x".repeat(41) }).success).toBe(false);
    expect(stepUpRequest.safeParse({ code: "123456" }).success).toBe(true);
    for (const code of ["12345", "1234567", "12345a", " 123456"])
      expect(stepUpRequest.safeParse({ code }).success).toBe(false);
    expect(sessionIdParam.safeParse({ id: "a".repeat(64) }).success).toBe(true);
    for (const id of ["a".repeat(63), "A".repeat(64), "g".repeat(64)])
      expect(sessionIdParam.safeParse({ id }).success).toBe(false);
  });
});
