// The deploy scripts run the same checks as the builds before anything is uploaded (audit A2 finding 2, A1 finding 1): the website's
// staging deploy (also run by publish-catalogue.yml with the admin-published snapshot) runs the dist checks, and the SPAs' staging
// deploys run the header guard. Runs in Node (it reads package.json files).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scripts = (app: string): Record<string, string> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../${app}/package.json`, import.meta.url)), "utf8"))
    .scripts;

/** The steps of an `a && b && c` script, in order. */
const steps = (s: string | undefined): string[] => (s ?? "").split("&&").map((x) => x.trim());

/** Index of the first step that contains `part` (-1 when none does). */
const at = (s: string | undefined, part: string): number => steps(s).findIndex((x) => x.includes(part));

describe("the website's deploy:staging [A2-2, WEB-G-07, WEB-G-12]", () => {
  const s = scripts("web");

  it("runs the dist checks after the build and the share images, before wrangler deploy", () => {
    const deploy = s["deploy:staging"];
    expect(at(deploy, "astro build")).toBe(0);
    expect(at(deploy, "check-web-dist.mjs")).toBeGreaterThan(at(deploy, "build-og.mjs"));
    expect(at(deploy, "wrangler deploy")).toBeGreaterThan(at(deploy, "check-web-dist.mjs"));
  });

  it("runs the same checks as `build`", () => {
    for (const part of ["build-og.mjs", "check-web-dist.mjs"]) {
      expect(at(s.build, part), `build: ${part}`).toBeGreaterThan(0);
      expect(at(s["deploy:staging"], part), `deploy:staging: ${part}`).toBeGreaterThan(0);
    }
  });
});

describe("the SPAs' build and deploy:staging [A1-1]", () => {
  it.each(["admin", "portal"])(
    "%s checks dist/client/_headers right after vite build, before any deploy",
    (app) => {
      const s = scripts(app);
      for (const name of ["build", "deploy:staging"]) {
        const script = s[name];
        const guard = at(script, `check-spa-headers.mjs ${app}`);
        expect(guard, `${app} ${name}`).toBe(at(script, "vite build") + 1);
        const deploy = at(script, "wrangler deploy");
        if (name === "deploy:staging") expect(deploy).toBeGreaterThan(guard);
      }
    },
  );

  it("pnpm check runs the guard on both apps' public/_headers", () => {
    const root = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
    );
    expect(root.scripts.check).toContain("node scripts/check-spa-headers.mjs --source");
  });
});
