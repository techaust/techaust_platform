// Only the owner (techaust) may start the catalogue publish or the backup by hand, or re-run them (owner, 2026-10-29): each job's
// first step is the actor check, as in deploy-prod.yml. A scheduled run's first attempt passes. Runs in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe.each(["publish-catalogue.yml", "backup.yml"])("%s", (name) => {
  const text = read(name);
  it("starts its job with the actor check", () => {
    const steps = text.slice(text.indexOf("    steps:\n")).split("\n      - ");
    expect(steps[1]).toMatch(/^name: Who started this run\n/);
  });
  it("needs techaust for a run by hand and for any re-run; a scheduled first attempt passes", () => {
    expect(text).toContain('*) [ "$ACTOR" = "techaust" ] && [ "$TRIGGERING_ACTOR" = "techaust" ] ;;');
    expect(text).toContain('schedule) [ "$ATTEMPT" = "1" ] || [ "$TRIGGERING_ACTOR" = "techaust" ] ;;');
    const expr = (name: string) => ["$", "{{ github.", name, " }}"].join("");
    expect(text).toContain(`TRIGGERING_ACTOR: ${expr("triggering_actor")}`);
    expect(text).toContain(`ATTEMPT: ${expr("run_attempt")}`);
  });
});
