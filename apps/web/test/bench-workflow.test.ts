// M7.5 (owner's Q1 A): the owner-only CPU benchmark workflow gains `suite: auth | routes | load`, staging only. Owner-only and manual, the secrets only on the
// step that runs the chosen bench (never on the install), the inputs reaching the scripts through the environment. Runs in Node (reads files).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(
  new URL("../../../.github/workflows/bench-auth.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const steps = text.slice(text.indexOf("    steps:\n")).split("\n      - ").slice(1);

describe("bench-auth.yml (M7.5, Q1 A)", () => {
  it("runs by hand only, for the owner in this repository", () => {
    expect(text).toMatch(/on:\n {2}workflow_dispatch:\n/);
    expect(text).not.toMatch(/\n {2}(push|pull_request|schedule|workflow_run):/);
    expect(text).toContain(
      "if: github.actor == 'techaust' && github.triggering_actor == 'techaust' && github.repository == 'techaust/techaust_platform'",
    );
  });

  it("offers exactly the three suites, auth by default", () => {
    expect(text).toContain("options: [auth, routes, load]");
    expect(text).toMatch(
      /suite:\n[^\n]*\n {8}type: choice\n {8}options: \[auth, routes, load\]\n {8}default: auth/,
    );
  });

  it("gives the secrets only to the two bench steps, each gated on its suite", () => {
    for (const s of steps.filter((x) => x.includes("secrets.")))
      expect(
        s.startsWith("name: Run the auth benchmark") || s.startsWith("name: Run the route or load benchmark"),
      ).toBe(true);
    const auth = steps.find((s) => s.startsWith("name: Run the auth benchmark")) ?? "";
    const routes = steps.find((s) => s.startsWith("name: Run the route or load benchmark")) ?? "";
    expect(auth).toContain("if: inputs.suite == 'auth'");
    expect(auth).toContain("run: node scripts/bench-auth.mjs");
    expect(routes).toContain("if: inputs.suite == 'routes' || inputs.suite == 'load'");
    expect(routes).toContain('run: node scripts/bench-routes.mjs --mode "$SUITE"');
    // The inputs reach the script through the environment, never pasted into the shell line.
    expect(routes).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(steps.find((s) => s.startsWith("run: pnpm install")) ?? "").not.toMatch(/secrets\./);
  });
});
