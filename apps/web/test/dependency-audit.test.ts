// The dependency audit in CI (docs/08 §3.5; full audit A1 3, owner's yes 2026-10-30): high and critical advisories fail the `checks`
// job unless a reviewed, dated allow-list entry lets them through; expired, stale and malformed entries fail too, and an unreadable
// registry answer fails closed. Runs in Node (it reads files); nothing here asks the registry.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type AllowEntry,
  advisoriesOf,
  allowListProblems,
  report,
  verdict,
} from "../../../scripts/dependency-audit.mjs";

const advisory = (id: string, pkg: string, severity: string, n = 1) => ({
  [String(n)]: {
    id: n,
    github_advisory_id: id,
    module_name: pkg,
    severity,
    title: `${pkg} issue`,
    patched_versions: ">=9.9.9",
    findings: [{ version: "1.0.0", paths: [`apps__web>${pkg}`], dev: true }],
  },
});
const audit = (...parts: Record<string, unknown>[]) =>
  JSON.stringify({ advisories: Object.assign({}, ...parts), metadata: {} });

const entry = (over: Partial<AllowEntry> = {}): AllowEntry => ({
  advisory: "GHSA-2222-3333-4444",
  package: "left-pad",
  reason: "Dev tools only; fixed upstream, waiting for the parent package",
  added: "2026-10-30",
  addedBy: "test",
  expires: "2026-11-13",
  ...over,
});

const run = (text: string, entries: AllowEntry[], today = "2026-11-01") => {
  const list = advisoriesOf(text);
  return report(verdict(list, entries, today), list);
};

describe("dependency audit verdict [A1-3]", () => {
  it("passes with no advisories", () => {
    expect(run(audit(), []).ok).toBe(true);
  });

  it.each(["high", "critical"])("blocks an unlisted %s advisory", (severity) => {
    const r = run(audit(advisory("GHSA-2222-3333-4444", "left-pad", severity)), []);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain(`BLOCKED ${severity} GHSA-2222-3333-4444 left-pad`);
  });

  it.each(["moderate", "low", "info"])("lets an unlisted %s advisory through", (severity) => {
    expect(run(audit(advisory("GHSA-2222-3333-4444", "left-pad", severity)), []).ok).toBe(true);
  });

  it("lets a listed advisory through until its expiry day, inclusive", () => {
    const text = audit(advisory("GHSA-2222-3333-4444", "left-pad", "high"));
    expect(run(text, [entry()], "2026-11-13").ok).toBe(true);
    const after = run(text, [entry()], "2026-11-14");
    expect(after.ok).toBe(false);
    expect(after.lines.join("\n")).toContain("EXPIRED allow-list entry GHSA-2222-3333-4444 left-pad");
  });

  it("matches the advisory AND the package", () => {
    const r = run(audit(advisory("GHSA-2222-3333-4444", "other-pkg", "high")), [entry()]);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("BLOCKED high GHSA-2222-3333-4444 other-pkg");
  });

  it("one advisory reported twice for one package (two version ranges) needs one entry", () => {
    const text = audit(
      advisory("GHSA-2222-3333-4444", "left-pad", "high", 1),
      advisory("GHSA-2222-3333-4444", "left-pad", "high", 2),
    );
    expect(run(text, [entry()]).ok).toBe(true);
  });

  it("fails on a stale entry (no longer reported at high or critical)", () => {
    for (const text of [audit(), audit(advisory("GHSA-2222-3333-4444", "left-pad", "moderate"))]) {
      const r = run(text, [entry()]);
      expect(r.ok).toBe(false);
      expect(r.lines.join("\n")).toContain("STALE allow-list entry GHSA-2222-3333-4444 left-pad");
    }
  });

  it("fails closed when pnpm's answer is not an audit report", () => {
    expect(() => advisoriesOf("")).toThrow(/fails closed/);
    expect(() => advisoriesOf("ERR_PNPM_AUDIT_BAD_RESPONSE")).toThrow(/fails closed/);
    expect(() => advisoriesOf(JSON.stringify({ error: { code: "ERR" } }))).toThrow(/fails closed/);
  });
});

describe("allow-list entries [A1-3]", () => {
  it("accept a complete entry", () => {
    expect(allowListProblems([entry()])).toEqual([]);
  });

  it.each([
    ["no GHSA id", { advisory: "CVE-2026-1" }, /GHSA id/],
    ["no package", { package: "" }, /"package"/],
    ["a short reason", { reason: "ok" }, /"reason"/],
    ["no addedBy", { addedBy: " " }, /"addedBy"/],
    ["a bad date", { expires: "13/11/2026" }, /YYYY-MM-DD/],
    ["expiry before added", { expires: "2026-10-29" }, /after "added"/],
    ["expiry over 90 days", { expires: "2027-02-01" }, /more than 90 days/],
  ])("refuse %s", (_name, over, re) => {
    expect(allowListProblems([entry(over as Partial<AllowEntry>)]).join("\n")).toMatch(re);
  });

  it("refuse a duplicate and a non-array", () => {
    expect(allowListProblems([entry(), entry()]).join("\n")).toMatch(/listed twice/);
    expect(allowListProblems({})).toEqual(["the allow-list must be a JSON array"]);
  });

  it("an entry problem fails the audit even when every advisory is listed", () => {
    const text = audit(advisory("GHSA-2222-3333-4444", "left-pad", "high"));
    expect(run(text, [entry({ addedBy: "" })]).ok).toBe(false);
  });

  it("the committed allow-list is well formed, and every entry expires within 90 days", () => {
    const list = JSON.parse(
      readFileSync(new URL("../../../scripts/dependency-audit-allow.json", import.meta.url), "utf8"),
    );
    expect(allowListProblems(list)).toEqual([]);
  });
});

describe("CI runs the audit [A1-3]", () => {
  const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const steps = ci.slice(ci.indexOf("    steps:\n")).split("\n      - ");

  it("in the `checks` job (the required check), right after the install, with no secrets", () => {
    const install = steps.findIndex((s) => s.startsWith("run: pnpm install --frozen-lockfile"));
    const auditStep = steps.findIndex((s) => s.includes("node scripts/dependency-audit.mjs"));
    expect(install).toBeGreaterThan(0);
    expect(auditStep).toBe(install + 1);
    expect(steps[auditStep]).not.toMatch(/secrets\.|env:/);
    expect(steps[auditStep]).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/secrets\./);
  });
});
