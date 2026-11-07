// The portal's warm-up fixture holds no credential (M7.5 L39). apps/portal/worker/warm-fixtures/ is one of the two paths .gitleaks.toml allows, so this test
// keeps that allow-list honest, as apps/admin/worker/warm-fixtures.test.ts does for the admin's: the only credential-shaped value is the sign-in call's
// made-up token of words, and no string (key or value, calls and rows alike) has a known secret shape or a long base64 run. The patterns are put together
// from pieces at run time: no secret-looking literal is written outside warm-fixtures/ (CI's secret scan reads every commit).
import { describe, expect, it } from "vitest";
import { PORTAL_WARM } from "./warm-fixtures/portal.ts";

/** Keys whose values are credential-shaped (anything a secret scanner keys on). */
const CREDENTIAL_KEY = /secret|hmac|hash|token|challenge|password|passwd|api[_-]?key|private|pepper|cookie/i;
const j = (...parts: string[]) => parts.join("");
const SECRET_SHAPES: readonly (readonly [string, RegExp])[] = [
  ["a Razorpay key", new RegExp(`${j("rz", "p")}_(?:${j("li", "ve")}|test)_[A-Za-z0-9]{6,}`)],
  ["a Stripe key", new RegExp(`\\b[sr]${j("k_")}(?:${j("li", "ve")}|test)_[A-Za-z0-9]{6,}`)],
  ["an AWS access key id", new RegExp(`\\b(?:${j("AK", "IA")}|${j("AS", "IA")})[A-Z0-9]{16}\\b`)],
  ["a PEM block", new RegExp(`-{5}${j("BEG", "IN")}[ A-Z0-9]*-{5}`)],
  ["a JSON web token", new RegExp(`${j("ey", "J")}[A-Za-z0-9_-]{8,}\\.${j("ey", "J")}`)],
];
/** A long base64 (or base64url) run: 32 or more characters with an upper-case letter, a lower-case letter and a digit (hex hashes and UUIDs have no capitals). */
const LONG_BASE64 = /[A-Za-z0-9+/_=-]{32,}/g;
const looksBase64 = (run: string) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run);

type Found = { at: string; value: string };
/** Every string under a credential-shaped key, anywhere in the fixture. */
function credentialValues(v: unknown, at = "", out: Found[] = []): Found[] {
  if (Array.isArray(v)) for (const [i, x] of v.entries()) credentialValues(x, `${at}[${i}]`, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && CREDENTIAL_KEY.test(k)) out.push({ at: `${at}.${k}`, value: x });
      else credentialValues(x, `${at}.${k}`, out);
    }
  return out;
}

/** Every secret shape in every string of `v` (object keys too). */
function secretShapesIn(v: unknown, at = "", out: string[] = []): string[] {
  const scan = (text: string, where: string) => {
    for (const [shape, re] of SECRET_SHAPES) if (re.test(text)) out.push(`${where}: ${shape}`);
    for (const m of text.matchAll(LONG_BASE64))
      if (looksBase64(m[0])) out.push(`${where}: a long base64 run`);
  };
  if (Array.isArray(v)) for (const [i, x] of v.entries()) secretShapesIn(x, `${at}[${i}]`, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      scan(k, `${at}.${k} (key)`);
      if (typeof x === "string") scan(x, `${at}.${k}`);
      else secretShapesIn(x, `${at}.${k}`, out);
    }
  else if (typeof v === "string") scan(v, at);
  return out;
}

describe("the portal's warm-up fixture holds no credential [M7.5 L39]", () => {
  it("the only credential-shaped value is the sign-in call's made-up token of words", () => {
    expect(credentialValues(PORTAL_WARM)).toEqual([
      { at: ".calls[1].body.token", value: "warm-up-link-token-not-a-real-one".padEnd(43, "0") },
    ]);
  });

  it("no string, key or value, has a known secret shape or a long base64 run", () => {
    expect(secretShapesIn(PORTAL_WARM, "portal")).toEqual([]);
  });

  it("the scan finds what it looks for (planted samples, put together at run time)", () => {
    const planted = {
      a: j("rz", "p_", "te", "st_", "Abc123XYZ"),
      b: j("Abcdefghij", "KLMNOPQRST", "uvwxyz0123", "456789"),
      token: "x",
    };
    expect(secretShapesIn(planted, "planted")).toHaveLength(2);
    expect(credentialValues(planted).map((f) => f.at)).toEqual([".token"]);
  });

  it("names only made-up people and addresses (the probe's sample set)", () => {
    const text = JSON.stringify(PORTAL_WARM);
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email).toMatch(/@example\.test$/);
    for (const name of text.match(/"(?:name|display_name)":"[^"]*"/g) ?? [])
      expect(name).toMatch(/\(sample\)/);
  });
});
