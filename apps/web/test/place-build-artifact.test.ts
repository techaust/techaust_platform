// M7.5 L57 (re-check of review 1, finding 1): scripts/place-build-artifact.mjs places the build job's artifact into the deploy job's checkout only when
// every entry is a file or folder of the build outputs, none is a `.env*` or `.dev.vars*`, none is a symlink and no destination exists yet; otherwise it
// places nothing. Runs in Node (made-up artifacts and checkouts in the temp folder).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PLACEMENTS, placeArtifact, placementProblems } from "../../../scripts/place-build-artifact.mjs";

const scratchDirs: string[] = [];
const scratch = (tag: string) => {
  const dir = mkdtempSync(join(tmpdir(), `place-${tag}-`));
  scratchDirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

const put = (root: string, rel: string, text = rel) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A made-up staging artifact laid out as the build job's upload step lays it out (paths relative to the repository root). */
const STAGING_FILES = [
  ".deploy/seed.sql",
  "apps/admin/dist/client/index.html",
  "apps/admin/dist/client/_headers",
  "apps/admin/dist/client/.assetsignore",
  "apps/admin/dist/techaust_platform_admin/wrangler.json",
  "apps/admin/dist/techaust_platform_admin_api/wrangler.json",
  "apps/admin/.wrangler/deploy/config.json",
  "apps/portal/dist/client/index.html",
  "apps/portal/dist/techaust_platform_portal/wrangler.json",
  "apps/portal/.wrangler/deploy/config.json",
  "apps/web/dist/index.html",
  "apps/web/dist/.well-known/security.txt",
  "apps/web/.wrangler/dist-staging/worker.js",
  "apps/jobs/dist-staging/index.js",
  "apps/jobs/dist-staging/index.js.map",
];
const stagingArtifact = (extra: string[] = []) => {
  const dir = scratch("artifact");
  for (const f of [...STAGING_FILES, ...extra]) put(dir, f);
  return dir;
};
/** A made-up checkout: tracked files the artifact must never reach. */
const checkout = () => {
  const root = scratch("checkout");
  for (const f of ["scripts/deploy-worker.mjs", "apps/jobs/wrangler.jsonc", "apps/admin/wrangler.jsonc"])
    put(root, f, "trusted");
  return root;
};
/** Every file under `dir`, relative, forward slashes. */
const filesOf = (dir: string, prefix = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? filesOf(join(dir, e.name), rel) : [rel];
  });

describe("place-build-artifact: a clean artifact (L57)", () => {
  it("places every staging file at the same path in the checkout, and nothing else", () => {
    const root = checkout();
    const before = filesOf(root);
    const result = placeArtifact("staging", stagingArtifact(), root);
    expect(result).toEqual({ problems: [], copied: STAGING_FILES.length });
    expect(filesOf(root).sort()).toEqual([...before, ...STAGING_FILES].sort());
    expect(readFileSync(join(root, "apps/jobs/dist-staging/index.js"), "utf8")).toBe(
      "apps/jobs/dist-staging/index.js",
    );
    expect(readFileSync(join(root, "scripts/deploy-worker.mjs"), "utf8")).toBe("trusted");
  });

  it("places a production artifact (apps/web/dist's contents at its root) into apps/web/dist", () => {
    const root = checkout();
    const art = scratch("prod");
    for (const f of ["index.html", "about/index.html", ".well-known/security.txt", "_headers"]) put(art, f);
    expect(placeArtifact("production", art, root)).toEqual({ problems: [], copied: 4 });
    expect(existsSync(join(root, "apps/web/dist/about/index.html"))).toBe(true);
    expect(existsSync(join(root, "apps/web/dist/.well-known/security.txt"))).toBe(true);
  });
});

describe("place-build-artifact: refusals place nothing (L57)", () => {
  const refused = (extra: string[], expected: RegExp) => {
    const root = checkout();
    const before = filesOf(root);
    const art = stagingArtifact(extra);
    const problems = placementProblems("staging", art, root);
    expect(problems.join("\n")).toMatch(expected);
    expect(placeArtifact("staging", art, root).copied).toBe(0);
    expect(filesOf(root)).toEqual(before);
  };

  it.each([
    ["the deploy script", "scripts/deploy-worker.mjs"],
    ["the staging check", "scripts/check-staging-build.mjs"],
    ["the deploy-tools wrangler", "tools/deploy/node_modules/wrangler/bin/wrangler.js"],
    ["jobs' config, which the seed step runs wrangler with", "apps/jobs/wrangler.jsonc"],
    ["an app's own config", "apps/admin/wrangler.jsonc"],
    ["a file beside the outputs in the app", "apps/admin/package.json"],
    ["a file in another .wrangler folder", "apps/admin/.wrangler/state/v3/d1.sqlite"],
    ["a file in jobs' .wrangler", "apps/jobs/.wrangler/deploy/config.json"],
    ["the workflow", ".github/workflows/deploy-staging.yml"],
    ["another file in .deploy", ".deploy/other.sql"],
    ["a file at the artifact root", "README.md"],
  ])("a file outside the build outputs: %s", (_what, rel) => {
    refused([rel], new RegExp(`${rel.replaceAll(".", "\\.")} is outside the build outputs`));
  });

  it.each([
    "apps/admin/.env",
    "apps/jobs/.env.local",
    "apps/web/dist/.env",
    "apps/admin/dist/client/.ENV.production",
    "apps/portal/dist/.dev.vars",
    "apps/jobs/dist-staging/.dev.vars.staging",
    ".env",
  ])("a local secrets file anywhere: %s", (rel) => {
    refused([rel], /local secrets file/);
  });

  it("an empty folder outside the outputs", () => {
    const root = checkout();
    const art = stagingArtifact();
    mkdirSync(join(art, "scripts"));
    expect(placementProblems("staging", art, root)).toEqual([
      "scripts is outside the build outputs: refused",
    ]);
  });

  it("a folder where the seed file belongs", () => {
    const root = checkout();
    const art = scratch("artifact");
    for (const f of STAGING_FILES.filter((f) => f !== ".deploy/seed.sql")) put(art, f);
    put(art, ".deploy/seed.sql/x");
    expect(placementProblems("staging", art, root).join("\n")).toMatch(/\.deploy\/seed\.sql is outside/);
  });

  it("a symlink, to a folder or to a file", () => {
    const root = checkout();
    const art = stagingArtifact();
    // a junction needs no privilege on Windows and is a symlink to lstat
    symlinkSync(join(root, "scripts"), join(art, "apps/admin/dist/client/scripts"), "junction");
    const problems = placementProblems("staging", art, root);
    expect(problems).toContain("apps/admin/dist/client/scripts is a symlink: refused");
    expect(placeArtifact("staging", art, root).copied).toBe(0);
    let fileLink = true;
    try {
      symlinkSync(
        join(root, "apps/jobs/wrangler.jsonc"),
        join(art, "apps/jobs/dist-staging/link.js"),
        "file",
      );
    } catch {
      fileLink = false; // Windows without Developer Mode: file symlinks need a privilege (Linux runners always can)
    }
    if (fileLink)
      expect(placementProblems("staging", art, root)).toContain(
        "apps/jobs/dist-staging/link.js is a symlink: refused",
      );
  });

  it("a missing output, and a destination the checkout already has", () => {
    const root = checkout();
    const art = scratch("artifact");
    for (const f of STAGING_FILES.filter((f) => !f.startsWith("apps/jobs/"))) put(art, f);
    put(root, "apps/web/dist/index.html", "stale");
    const problems = placementProblems("staging", art, root);
    expect(problems).toContain("apps/jobs/dist-staging is missing from the artifact");
    expect(problems).toContain(
      "apps/web/dist already exists in the checkout: refused (the artifact never overwrites it)",
    );
    expect(placeArtifact("staging", art, root).copied).toBe(0);
    expect(readFileSync(join(root, "apps/web/dist/index.html"), "utf8")).toBe("stale");
  });

  it("an unknown scope, a missing folder, an empty production artifact", () => {
    const root = checkout();
    expect(placementProblems("production-ish", stagingArtifact(), root)[0]).toMatch(/unknown scope/);
    expect(placementProblems("staging", join(root, "nope"), root)[0]).toMatch(/is missing/);
    expect(placementProblems("production", scratch("empty"), root)).toEqual(["the artifact holds no file"]);
  });

  it("a production artifact holding a secrets file", () => {
    const root = checkout();
    const art = scratch("prod");
    put(art, "index.html");
    put(art, "assets/.dev.vars");
    expect(placementProblems("production", art, root)).toEqual([
      "assets/.dev.vars is a local secrets file (.env*, .dev.vars*): refused",
    ]);
  });
});

describe("PLACEMENTS", () => {
  it("staging places every output at its own path; production puts the artifact's root in apps/web/dist", () => {
    for (const p of PLACEMENTS.staging) expect(p.to).toBe(p.from);
    expect(PLACEMENTS.production).toEqual([{ from: "", to: "apps/web/dist", type: "dir" }]);
  });
});
