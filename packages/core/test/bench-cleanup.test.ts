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

  it("deletes the probes' counters along with the bench users'", () => {
    expect(cleanup).toContain("...probeEmails");
    expect(source).toContain("probeEmails.push(email)");
  });
});
