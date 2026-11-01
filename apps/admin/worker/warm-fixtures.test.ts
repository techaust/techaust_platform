// The warm-up fixtures' credential-shaped values (CPU warm-up fix round, lead decision 6, 2026-11-02). apps/admin/worker/warm-fixtures/ is the one path
// .gitleaks.toml allows, so this test is what keeps that allow-list honest: every credential-shaped value in the fixtures is a made-up one that verifies under
// the admin tests' fixed TEST_KEY values (vitest.config.ts) and under no other key. A value a real key made, or a new kind of credential nobody checks here,
// fails it.
import { hmacSha256, openTotpSecret, passwordHmac, verifyChallenge } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { API_WARM } from "./warm-fixtures/api.ts";
import { FINANCE_WARM } from "./warm-fixtures/finance.ts";
import { FRONT_WARM } from "./warm-fixtures/front.ts";
import { FRONT_WARM_SECRETS } from "./warm-front.ts";

/** The admin tests' made-up 32-byte keys (vitest.config.ts TEST_KEY): 1 password pepper, 2 salt pepper, 3 TOTP key, 4 session key. */
const TEST_KEY = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
/** Every other key a value must NOT verify under: the other test keys, the all-zero and all-0xff keys, and fresh random ones. */
function otherKeys(own: number): string[] {
  const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return [0, 1, 2, 3, 4, 5, 255]
    .filter((n) => n !== own)
    .map(TEST_KEY)
    .concat([random(), random(), random()]);
}

/** Keys whose values are credential-shaped (the sign-in columns and request fields, and anything a secret scanner keys on). */
const CREDENTIAL_KEY = /secret|hmac|hash|token|challenge|password|passwd|api[_-]?key|private/i;

type Found = { key: string; value: string; holder: Record<string, unknown> };
/** Every string under a credential-shaped key, anywhere in a fixture. */
function credentialValues(v: unknown, out: Found[] = []): Found[] {
  if (Array.isArray(v)) for (const x of v) credentialValues(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && CREDENTIAL_KEY.test(k) && x.length >= 10)
        out.push({ key: k, value: x, holder: v as Record<string, unknown> });
      else credentialValues(x, out);
    }
  return out;
}

const front = credentialValues(FRONT_WARM);
const loginBody = FRONT_WARM.calls.find((c) => c.path === "/auth/login")?.body as
  | { clientHash?: string }
  | undefined;

const verifies = async (check: () => Promise<unknown>) => {
  try {
    return Boolean(await check());
  } catch {
    return false;
  }
};

describe("the warm-up fixtures' made-up credentials [CPU warm-up fix round, decision 6]", () => {
  it("the front's dry run uses exactly the admin tests' TEST_KEY values", () => {
    expect(FRONT_WARM_SECRETS.PASSWORD_PEPPER).toBe(TEST_KEY(1));
    expect(FRONT_WARM_SECRETS.SALT_PEPPER).toBe(TEST_KEY(2));
    expect(FRONT_WARM_SECRETS.TOTP_ENC_KEY).toBe(TEST_KEY(3));
    expect(FRONT_WARM_SECRETS.SESSION_HMAC_KEY).toBe(TEST_KEY(4));
  });

  it("the API and finance fixtures hold no credential-shaped value", () => {
    expect(credentialValues(API_WARM).map((f) => f.key)).toEqual([]);
    expect(credentialValues(FINANCE_WARM).map((f) => f.key)).toEqual([]);
  });

  it("every credential-shaped value of the front fixture is one this test checks", () => {
    expect(front.length).toBeGreaterThan(0);
    const checked = new Set(["clientHash", "pw_hmac", "totp_secret_enc", "challenge"]);
    expect(front.filter((f) => !checked.has(f.key)).map((f) => f.key)).toEqual([]);
  });

  it("each stored password HMAC verifies only under the test password pepper", async () => {
    const hmacs = front.filter((f) => f.key === "pw_hmac");
    expect(hmacs.length).toBeGreaterThan(0);
    const clientHash = loginBody?.clientHash;
    expect(typeof clientHash).toBe("string");
    for (const h of hmacs) {
      const salt = h.holder.pw_salt as string;
      expect(await passwordHmac(TEST_KEY(1), salt, clientHash as string)).toBe(h.value);
      for (const k of otherKeys(1))
        expect(await passwordHmac(k, salt, clientHash as string)).not.toBe(h.value);
    }
  });

  it("the login's client hash is the one the stored HMAC was made from (no other value of that shape)", async () => {
    const hashes = front.filter((f) => f.key === "clientHash");
    expect(hashes.map((f) => f.value)).toEqual([loginBody?.clientHash]);
  });

  it("each sealed TOTP secret opens only under the test TOTP key", async () => {
    for (const s of front.filter((f) => f.key === "totp_secret_enc")) {
      const id = s.holder.id as string;
      expect(await verifies(() => openTotpSecret(TEST_KEY(3), id, s.value))).toBe(true);
      for (const k of otherKeys(3)) expect(await verifies(() => openTotpSecret(k, id, s.value))).toBe(false);
    }
  });

  it("each signed challenge verifies only under the test session key", async () => {
    for (const c of front.filter((f) => f.key === "challenge")) {
      expect(await verifies(() => verifyChallenge(TEST_KEY(4), c.value, "login_totp", 0))).toBe(true);
      for (const k of otherKeys(4))
        expect(await verifies(() => verifyChallenge(k, c.value, "login_totp", 0))).toBe(false);
    }
  });

  it("the check itself tells keys apart (a sanity check of the HMAC helper)", async () => {
    const data = new TextEncoder().encode("warm-up");
    expect(await hmacSha256(TEST_KEY(1), data)).not.toEqual(await hmacSha256(TEST_KEY(2), data));
  });
});
