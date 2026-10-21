import { describe, expect, it, vi } from "vitest";
import {
  breachCheck,
  evaluatePassword,
  lengthProblem,
  passwordLength,
  personalWords,
  type Strength,
  zxcvbnStrength,
} from "./password-policy.ts";

// SHA-1("password") = 5BAA6 1E4C9B93F3F0682250B6CF8331B7EE68FD8 (prefix | suffix).
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const strong = async (): Promise<Strength> => ({ score: 4, warning: null });
const scored =
  (score: Strength["score"], warning: string | null = null) =>
  async (): Promise<Strength> => ({ score, warning });
const clearFetch = async () => new Response("0018A45C4D1DEF81644B54AB7F969B88D65:1", { status: 200 });

describe("ADM-AUTH-03: at least 12 characters", () => {
  it("refuses 11 characters and accepts 12", async () => {
    expect(lengthProblem("a".repeat(11))).toBe("Use at least 12 characters.");
    expect(lengthProblem("a".repeat(12))).toBeNull();
    const short = await evaluatePassword("abcdefghijk", [], { strength: strong, fetchFn: clearFetch });
    expect(short).toEqual({ ok: false, problems: ["Use at least 12 characters."] });
    const ok = await evaluatePassword("abcdefghijkl", [], { strength: strong, fetchFn: clearFetch });
    expect(ok).toEqual({ ok: true, breachCheck: "clear" });
  });

  it("counts characters as people see them (an emoji is one character)", () => {
    expect(passwordLength("ab😀")).toBe(3);
    expect(lengthProblem(`${"😀".repeat(11)}`)).not.toBeNull();
  });

  it("checks nothing else for a short password (no dictionaries, no breach lookup)", async () => {
    const strength = vi.fn(strong);
    const fetchFn = vi.fn(clearFetch);
    await evaluatePassword("short", [], { strength, fetchFn });
    expect(strength).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// The zxcvbn dictionaries load on first use (about 3 s alone, longer when every package tests at once): a 30 s limit.
describe("ADM-AUTH-03: strength score of 3 or more", { timeout: 30_000 }, () => {
  it("refuses a score of 2 with a helpful message, and accepts 3", async () => {
    const weak = await evaluatePassword("abcdefghijkl", [], {
      strength: scored(2, "This is similar to a commonly used password."),
      fetchFn: clearFetch,
    });
    expect(weak.ok).toBe(false);
    if (!weak.ok) {
      expect(weak.problems[0]).toContain("This is similar to a commonly used password.");
      expect(weak.problems[0]).toContain("Too easy to guess");
    }
    const fair = await evaluatePassword("abcdefghijkl", [], { strength: scored(3), fetchFn: clearFetch });
    expect(fair.ok).toBe(true);
  });

  it("does not look up breaches for a weak password", async () => {
    const fetchFn = vi.fn(clearFetch);
    await evaluatePassword("abcdefghijkl", [], { strength: scored(1), fetchFn });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("the real zxcvbn dictionaries refuse common passwords and accept a long passphrase", async () => {
    expect((await zxcvbnStrength("password1234", [])).score).toBeLessThan(3);
    expect((await zxcvbnStrength("qwertyuiop12", [])).score).toBeLessThan(3);
    expect((await zxcvbnStrength("lantern orbit pickle monsoon", [])).score).toBeGreaterThanOrEqual(3);
  });

  it("the person's own name and email count against them", async () => {
    const words = personalWords("Asha Verma", "asha.verma@example.test");
    expect(words).toEqual(expect.arrayContaining(["asha", "verma", "techaust"]));
    // Names and the company's name aren't weak on their own; as the person's own words they are.
    for (const pw of ["asha.verma1997", "TecHaust2026!"]) {
      expect((await zxcvbnStrength(pw, [])).score).toBeGreaterThanOrEqual(3);
      expect((await zxcvbnStrength(pw, words)).score).toBeLessThan(3);
    }
  });
});

describe("ADM-AUTH-03: breached-password lookup (HIBP range, k-anonymity)", () => {
  it("sends only the first 5 hex characters of the SHA-1, with padding, and no credentials", async () => {
    const fetchFn = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response("", { status: 200 }),
    );
    await breachCheck("password", fetchFn as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(String(url)).not.toContain(SUFFIX);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["Add-Padding"]).toBe("true");
    expect(init?.credentials).toBe("omit");
  });

  it("a hit refuses the password and says how often it was seen", async () => {
    const fetchFn = vi.fn(async () => new Response(`ABCDEF:2\r\n${SUFFIX}:3861493\r\n`, { status: 200 }));
    // "password" is 8 characters, so test the lookup itself, then the full rules with a long password whose
    // SHA-1 is faked by the same response.
    expect(await breachCheck("password", fetchFn)).toEqual({ status: "breached", count: 3861493 });
    const verdict = await evaluatePassword("password", [], { strength: strong, fetchFn });
    expect(verdict.ok).toBe(false); // too short first
    const long = "correct horse battery";
    const longHit = vi.fn(async () => {
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(long));
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      return new Response(`${hex.slice(5)}:42\n`, { status: 200 });
    });
    const hit = await evaluatePassword(long, [], { strength: strong, fetchFn: longHit });
    expect(hit).toEqual({
      ok: false,
      problems: ["This password has appeared in known data breaches (42 times). Choose a different one."],
    });
  });

  it("padding rows (count 0) are not hits", async () => {
    const fetchFn = vi.fn(async () => new Response(`${SUFFIX}:0\r\n`, { status: 200 }));
    expect(await breachCheck("password", fetchFn)).toEqual({ status: "clear" });
  });

  it("a failed lookup never blocks: network error, server error or timeout", async () => {
    const failures = [
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      vi.fn(async () => new Response("busy", { status: 503 })),
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    ];
    for (const fetchFn of failures) {
      expect(await breachCheck("abcdefghijkl", fetchFn)).toEqual({ status: "unavailable" });
      const verdict = await evaluatePassword("lantern orbit pickle monsoon", [], {
        strength: strong,
        fetchFn,
      });
      expect(verdict).toEqual({ ok: true, breachCheck: "unavailable" });
    }
  });
});
