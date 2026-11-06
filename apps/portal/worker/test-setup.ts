import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeEach } from "vitest";
import { budgetHooks } from "../../../packages/testing/src/budget.ts";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// M7.5 L18: the shared counting env (packages/testing/src/budget.ts). Each request a test sends through `sendTo` (test-helpers.ts) is one invocation:
// a batch over 45 statements, or more than 45 D1 calls plus subrequests in one invocation, fails the test; after each file the SQL its requests ran
// gets the EXPLAIN sweep (a bare SCAN fails unless allowed with a reason).
budgetHooks({ env, afterEach, afterAll });

// NFR-6, suite-wide: whatever ANY test makes the Worker write to the console must carry no personal data. Every test
// of every file runs under this watch, so a new route that logs an email, an address, a token or a cookie fails the
// first test that reaches it, not only the one test that looks for it. The watch replaces the console methods with a
// recorder (a test that spies on the console itself, like logs.test.ts, sits on top of it and sees its own lines).
// Forbidden: an `@` (an email), the test addresses (198.51., 192.0.2., 203.0.113.), a run of 43 base64url characters
// (a token or a session id's cookie value) and the cookie name prefix `__Host-`.
const METHODS = ["log", "info", "warn", "error", "debug"] as const;
const FORBIDDEN = /@|198\.51\.|192\.0\.2\.|203\.0\.113\.|[A-Za-z0-9_-]{43}|__Host-/;
const originals = new Map<string, (...a: unknown[]) => void>();
let seen: string[] = [];

beforeEach(() => {
  seen = [];
  for (const m of METHODS) {
    originals.set(m, console[m]);
    console[m] = (...a: unknown[]) => {
      seen.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
  }
});

afterEach(() => {
  for (const m of METHODS) console[m] = originals.get(m) as (typeof console)[typeof m];
  const bad = seen.filter((l) => FORBIDDEN.test(l));
  if (bad.length)
    throw new Error(`The Worker wrote personal data to the console (NFR-6): ${bad.slice(0, 3).join(" | ")}`);
});
