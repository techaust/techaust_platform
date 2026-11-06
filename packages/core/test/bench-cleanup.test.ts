// scripts/bench-auth.mjs runs against the STAGING admin, where real accounts may exist. Its cleanup may delete only
// the counters the run itself created (the throwaway users' and the unknown-email probes' `acct:` keys): never a
// pattern that could match a real account's counter. The script talks to a live Worker, so this reads its source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "..", "..", "..", "scripts", "bench-auth.mjs"), "utf8");
const cleanup = source.slice(
  source.indexOf("// ---------- 4. cleanup"),
  source.indexOf("// ---------- report"),
);

describe("bench-auth cleanup", () => {
  it("has a cleanup section", () => {
    expect(cleanup).toContain("DELETE FROM auth_attempts");
  });

  it("never deletes auth_attempts by a pattern or a time window", () => {
    expect(cleanup).not.toMatch(/auth_attempts[^;]*\bLIKE\b/i);
    expect(cleanup).not.toMatch(/auth_attempts[^;]*window_start/i);
    expect(cleanup).not.toContain("acct:%");
  });

  it("deletes the rows that name a bench user by foreign key before the user (M7.5 L21)", () => {
    const at = (s: string) => cleanup.indexOf(s);
    const user = at("DELETE FROM staff_users");
    expect(user).toBeGreaterThan(0);
    for (const t of ["staff_signin_pending", "staff_notification_prefs", "notifications", "staff_sessions"]) {
      expect(at(`DELETE FROM ${t} WHERE user_id IN`), t).toBeGreaterThan(0);
      expect(at(`DELETE FROM ${t} WHERE user_id IN`), t).toBeLessThan(user);
    }
  });

  it("leaves the `acct:` counters it cannot name (HMAC under SALT_PEPPER since M7.5 B1 L8) and says why", () => {
    // No delete names an `acct:` key (the comment may name them).
    expect(cleanup).not.toMatch(/DELETE[^;]*acct/);
    expect(source).not.toMatch(/const acctKey/);
    expect(cleanup).toContain("HMAC(SALT_PEPPER, email)");
    // Only the `code:<user id>` counters of the bench users are deleted, by exact key.
    expect(cleanup).toMatch(
      /DELETE FROM auth_attempts WHERE key IN \(SELECT 'code:' \|\| id FROM staff_users WHERE email IN/,
    );
  });
});
