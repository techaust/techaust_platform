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

/** The credential-shaped keys this file checks cryptographically (below): only their values may hold a long base64 run. */
const CHECKED_KEYS = new Set(["clientHash", "pw_hmac", "totp_secret_enc", "challenge"]);

// Review finding 1: .gitleaks.toml turns every rule off for warm-fixtures/, and the key-name check above sees only credential-shaped KEYS, so a secret of
// another shape (inside a settings JSON value, a live payment key id, a PEM block) would pass both. So every string of every fixture (keys and values,
// calls and rows) is also scanned for known secret shapes. The patterns and the planted samples are put together from pieces at run time: no secret-looking
// literal is written outside warm-fixtures/ (CI's secret scan reads every commit).
const j = (...parts: string[]) => parts.join("");
const SECRET_SHAPES: readonly (readonly [string, RegExp])[] = [
  ["a Razorpay key", new RegExp(`${j("rz", "p")}_(?:${j("li", "ve")}|test)_[A-Za-z0-9]{6,}`)],
  ["a Stripe key", new RegExp(`\\b[sr]${j("k_")}(?:${j("li", "ve")}|test)_[A-Za-z0-9]{6,}`)],
  ["a Stripe webhook secret", new RegExp(`${j("wh", "sec")}_[A-Za-z0-9+/]{6,}`)],
  ["an AWS access key id", new RegExp(`\\b(?:${j("AK", "IA")}|${j("AS", "IA")})[A-Z0-9]{16}\\b`)],
  ["a PEM block", new RegExp(`-{5}${j("BEG", "IN")}[ A-Z0-9]*-{5}`)],
  [
    "a GitHub token",
    new RegExp(`\\b(?:${j("gh", "p")}_[A-Za-z0-9]{20,}|${j("github", "_pat")}_[A-Za-z0-9_]{20,})`),
  ],
  ["a JSON web token", new RegExp(`${j("ey", "J")}[A-Za-z0-9_-]{8,}\\.${j("ey", "J")}`)],
];
/** A long base64 (or base64url) run: 32 or more characters with an upper-case letter, a lower-case letter and a digit (hex hashes and UUIDs have no capitals). */
const LONG_BASE64 = /[A-Za-z0-9+/_=-]{32,}/g;
const looksBase64 = (run: string) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run);

type Hit = { at: string; shape: string };
/** Every secret shape in every string of `v` (object keys too). A long base64 run counts only outside CHECKED_KEYS, whose values are verified below. */
function secretShapesIn(v: unknown, at = "", out: Hit[] = []): Hit[] {
  const scan = (text: string, where: string, checked: boolean) => {
    for (const [shape, re] of SECRET_SHAPES) if (re.test(text)) out.push({ at: where, shape });
    if (!checked)
      for (const m of text.matchAll(LONG_BASE64))
        if (looksBase64(m[0])) out.push({ at: where, shape: "a long base64 run" });
  };
  if (Array.isArray(v)) for (const [i, x] of v.entries()) secretShapesIn(x, `${at}[${i}]`, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      scan(k, `${at}.${k} (key)`, false);
      if (typeof x === "string") scan(x, `${at}.${k}`, CHECKED_KEYS.has(k));
      else secretShapesIn(x, `${at}.${k}`, out);
    }
  else if (typeof v === "string") scan(v, at, false);
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
    expect(front.filter((f) => !CHECKED_KEYS.has(f.key)).map((f) => f.key)).toEqual([]);
  });

  it("no fixture string, key or value, has a known secret shape (review finding 1)", () => {
    expect(secretShapesIn(FRONT_WARM, "front")).toEqual([]);
    expect(secretShapesIn(API_WARM, "api")).toEqual([]);
    expect(secretShapesIn(FINANCE_WARM, "finance")).toEqual([]);
  });

  it("the secret-shape scan catches a planted sample of every shape, anywhere in a fixture (review finding 1)", () => {
    // Each sample is put together at run time (never a literal in the source) and planted inside a settings JSON value, a row value and a key.
    const samples: [string, string][] = [
      ["a Razorpay key", j("rz", "p_", "li", "ve_", "Ab3dE".repeat(3))],
      ["a Stripe key", j("s", "k_", "li", "ve_", "Ab3dE".repeat(5))],
      ["a Stripe key", j("r", "k_", "li", "ve_", "Ab3dE".repeat(5))],
      ["a Stripe webhook secret", j("wh", "sec_", "Ab3dE".repeat(5))],
      ["an AWS access key id", j("AK", "IA", "Z7".repeat(8))],
      ["a PEM block", j("-----", "BEG", "IN ", "PRIVATE ", "KEY", "-----")],
      ["a GitHub token", j("gh", "p_", "Ab3dE".repeat(6))],
      ["a JSON web token", j("ey", "J", "hbGciOiJ", ".", "ey", "J", "zdWIi")],
      ["a long base64 run", "Ab1".repeat(12)],
    ];
    for (const [shape, sample] of samples) {
      const planted = {
        calls: [{ method: "POST", path: "/settings", body: { note: "x" } }],
        rows: {
          aaaaaaaa: [
            { r: [{ key: "tax", value: JSON.stringify({ lut: { ref: `see ${sample} here` } }) }], c: 0 },
          ],
        },
      };
      expect(
        secretShapesIn(planted).map((h) => h.shape),
        sample.slice(0, 6),
      ).toContain(shape);
      expect(secretShapesIn({ rows: { [sample]: [] } }).map((h) => h.shape)).toContain(shape);
      expect(secretShapesIn({ calls: [{ body: { email: sample } }] }).map((h) => h.shape)).toContain(shape);
    }
  });

  it("a long base64 run is allowed only as the whole value of a checked key; the other shapes are caught there too (review finding 1)", () => {
    const run = "Ab1".repeat(12);
    expect(secretShapesIn({ pw_hmac: run, clientHash: run })).toEqual([]);
    expect(secretShapesIn({ pw_salt: run }).map((h) => h.shape)).toEqual(["a long base64 run"]);
    const aws = j("AK", "IA", "Z7".repeat(8));
    expect(secretShapesIn({ pw_hmac: aws }).map((h) => h.shape)).toEqual(["an AWS access key id"]);
    // What the fixtures do hold is not mistaken for one: ids, content hashes, paths, camelCase names.
    expect(
      secretShapesIn({
        id: "01a19927-3d6b-70e1-9882-fb1eee978da5",
        sha: "3e0dedd2dade6cf503a95e0dc8c633cbb738b4db4f43570ff5960b69fe58e0e7",
        path: "/invoices/01a19927-3e49-70f2-a84d-ee74f6c6cdfb/issue",
        name: "b2cDetailsThresholdInrMinor",
      }),
    ).toEqual([]);
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
