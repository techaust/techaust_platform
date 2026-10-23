// Lighthouse CI for the public site (M2.5; WEB-G-13, NFR-1): mobile, one URL per template, 3 runs each, thresholds in
// apps/web/lighthouserc.json (performance >= 0.95; accessibility, best practices and SEO = 1). Run: `pnpm --filter
// @techaust/web lhci` after `pnpm --filter @techaust/web build` and `pnpm dev:secrets` (through tools/heavy.sh).
//
// How SEO is measured honestly: staging config blocks indexing on purpose (the static `_headers` sends
// `X-Robots-Tag: noindex` until Phase 7 and the non-production robots.txt disallows everything), which would make
// Lighthouse's "is crawlable" audit fail on every page. So the run serves a COPY of dist (apps/web/.lhci/site, git-ignored)
// with exactly those two things changed: the X-Robots-Tag line is removed from the copy's `_headers`, and the copy's
// robots.txt is the production one (allow all). Everything else, including the CSP and every other header, is served
// as built, by `wrangler dev` with the real Worker config. The real dist and public/_headers are never touched.
//
// Reports are written to apps/web/.lighthouseci (upload.target = filesystem): nothing leaves the machine. The browser
// is Playwright's Chromium (the same binary the e2e tests use), so CI needs no separate Chrome.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `_headers` without the X-Robots-Tag line (the only header removed for the run). */
export const withoutNoindex = (headers) =>
  headers
    .split(/\r?\n/)
    .filter((l) => !/^\s*x-robots-tag\s*:/i.test(l))
    .join("\n");

/** The production robots.txt: everything allowed (apps/web/src/lib/search-files.ts `buildRobots(true)` without the sitemap line). */
export const PRODUCTION_ROBOTS = "User-agent: *\nAllow: /\n";

/** wrangler.jsonc text with its static assets served from `directory` instead of ./dist. */
export function pointAssetsAt(wranglerJsonc, directory) {
  if (!wranglerJsonc.includes('"directory": "./dist"'))
    throw new Error('web-lhci: apps/web/wrangler.jsonc no longer has "directory": "./dist" under assets');
  return wranglerJsonc.replace('"directory": "./dist"', `"directory": "${directory}"`);
}

/**
 * Playwright's headless shell next to its full Chromium (same revision), which is the browser Lighthouse is run with.
 * Lighthouse 12.6.1 (the version @lhci/cli 0.15.1 pins) cannot read the page-load trace of Chrome for Testing 156's
 * full browser (error NO_NAVSTART on every run), but reads the headless shell's of the same version. Falls back to the
 * full browser when the shell is not installed.
 */
export function headlessShell(chromiumPath) {
  const m = /^(.*)[\\/]chromium-(\d+)[\\/]/.exec(chromiumPath);
  if (!m) return chromiumPath;
  const dir = join(m[1], `chromium_headless_shell-${m[2]}`);
  if (!existsSync(dir)) return chromiumPath;
  for (const sub of readdirSync(dir)) {
    for (const exe of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
      const file = join(dir, sub, exe);
      if (existsSync(file)) return file;
    }
  }
  return chromiumPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
  if (!existsSync(`${web}dist/index.html`))
    throw new Error("web-lhci: apps/web/dist is missing: build the site first");
  if (!existsSync(`${web}.dev.vars`))
    throw new Error("web-lhci: apps/web/.dev.vars is missing: run `pnpm dev:secrets`");

  rmSync(`${web}.lhci`, { recursive: true, force: true });
  rmSync(`${web}.lighthouseci`, { recursive: true, force: true });
  mkdirSync(`${web}.lhci`, { recursive: true });
  cpSync(`${web}dist`, `${web}.lhci/site`, { recursive: true });
  const headers = readFileSync(`${web}dist/_headers`, "utf8");
  writeFileSync(`${web}.lhci/site/_headers`, withoutNoindex(headers));
  writeFileSync(`${web}.lhci/site/robots.txt`, PRODUCTION_ROBOTS);
  writeFileSync(
    `${web}wrangler.lhci.jsonc`,
    pointAssetsAt(readFileSync(`${web}wrangler.jsonc`, "utf8"), "./.lhci/site"),
  );

  // @playwright/test is a devDependency of apps/web, so it is resolved from there, not from this folder.
  const { chromium } = createRequire(`${web}package.json`)("@playwright/test");
  const result = spawnSync("pnpm", ["exec", "lhci", "autorun", "--config=./lighthouserc.json"], {
    cwd: web,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, CHROME_PATH: headlessShell(chromium.executablePath()) },
  });
  process.exit(result.status ?? 1);
}
