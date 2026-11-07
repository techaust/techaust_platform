// Health check after a production deploy (P7, docs/runs/p7-launch.md P7-B). `.github/workflows/deploy-prod.yml` runs
// `node scripts/prod-health.mjs <app>` right after that app's Workers are deployed; a failure fails the job, so the Workers after it in the
// deploy order are not deployed on top of a broken one. The judging and the retry loop are scripts/staging-health.mjs's, pointed at the
// production hosts and wanting `env: "production"`.
//
// Production hosts (the lead attaches them as Custom Domains by hand; no config holds a route): web https://techaust.com, admin
// https://admin.techaust.com, portal https://portal.techaust.com, jobs https://hooks.techaust.com. Only the admin is behind Cloudflare
// Access, with a bypass for its health path alone, so every check here goes out WITHOUT an Access token and the admin is read only through
// its health route (the signed-out 401s staging reads through the front's bindings would meet Access here). The portal, the hooks and the
// website are public. No secret is read or printed.
// A Custom Domain attached minutes before the run may take a while to answer everywhere, so each check retries for about two minutes.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkApp, CHECKS as STAGING_CHECKS } from "./staging-health.mjs";

/** The production origin of each app with a health check. */
export const PRODUCTION_HOSTS = Object.freeze({
  web: "https://techaust.com",
  admin: "https://admin.techaust.com",
  portal: "https://portal.techaust.com",
  jobs: "https://hooks.techaust.com",
});

/**
 * What "healthy" means in production. The paths are the Workers' own (read from the code: the admin front's `/api/v1/health` in
 * apps/admin/worker/routes-front.ts, the portal's `/api/v1/health` in apps/portal/worker/index.ts, jobs' `/healthz` in apps/jobs/src/index.ts,
 * the website's `/api/health` in apps/web/src/worker.ts). Jobs keeps staging's webhook checks: the hooks are public in production too, and a
 * signed-out POST gets the Worker's own JSON 400/401 (counted nowhere, nothing written). Every check goes without an Access token.
 */
export const CHECKS = Object.freeze({
  admin: [{ path: "/api/v1/health", status: 200, service: "admin", access: false }],
  portal: [{ path: "/api/v1/health", status: 200, service: "portal", access: false }],
  jobs: STAGING_CHECKS.jobs.map((c) => ({ ...c, access: false })),
  web: [{ path: "/api/health", status: 200, service: "web", access: false }],
});

/** About two minutes in all (a new Custom Domain's certificate and routing can take a minute). */
export const DELAYS_MS = [0, 5_000, 10_000, 15_000, 20_000, 30_000, 30_000];

/** Runs every production check of one app (the options are staging-health's `checkApp` ones, for tests). */
export const checkProductionApp = (app, options = {}) =>
  checkApp(app, {
    delays: DELAYS_MS,
    ...options,
    checks: CHECKS,
    base: PRODUCTION_HOSTS[app],
    env: "production",
    headers: undefined,
  });

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = process.argv[2] ?? "";
  if (!CHECKS[app]) {
    console.error(`usage: node scripts/prod-health.mjs ${Object.keys(CHECKS).join("|")}`);
    process.exit(2);
  }
  const failures = await checkProductionApp(app);
  if (failures.length > 0) {
    for (const f of failures) console.error(`health check FAILED: ${f}`);
    console.error(
      "(Production: no Access token is sent. An Access answer on the admin means the Access bypass for /api/v1/health is missing; on the portal, hooks or website it means Access was put in front of a public host. A failed request on a new host: check its Custom Domain is attached.)",
    );
    process.exit(1);
  }
  console.log(`health check: ${app} production ok`);
}
