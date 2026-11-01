// Health check after a staging deploy (full audit A6 8, owner's yes 2026-10-30). `.github/workflows/deploy-staging.yml` runs
// `node scripts/staging-health.mjs <app>` right after that app's Workers are deployed; a failure fails the job, so the Workers after it
// in the deploy order are not deployed on top of a broken one.
//
// The staging hosts sit behind Cloudflare Access (docs/runbooks/access-staging.md), so every request carries an Access service token
// (CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment). A refused token (a redirect to the Access sign-in page, or a
// non-JSON 401/403 from Access itself under strict service-token authentication) fails the check: Access, not the Worker, answered.
// Each check retries a few times over about half a minute (a fresh deploy can take a few seconds to reach every location).
// Nothing secret is printed.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const HOST_SUFFIX = "techaust-technologies-153.workers.dev";
export const urlOf = (app) => `https://techaust-platform-${app}-staging.${HOST_SUFFIX}`;

/**
 * What "healthy" means per app. `service`: the health body names the Worker and `env` is "staging", which proves the request reached
 * the right staging Worker and not an Access page or another Worker. Admin's checks cover its three Workers (M6.1 stage A): the health
 * read is the front's own; a signed-out leads read is the API Worker's JSON 401 through the front's ADMIN_API binding, and a signed-out
 * dashboard read is the finance Worker's JSON 401 through ADMIN_FINANCE, never a 502 (docs/runbooks/environments.md).
 */
export const CHECKS = {
  admin: [
    { path: "/api/v1/health", status: 200, service: "admin" },
    { path: "/api/v1/leads", status: 401 },
    { path: "/api/v1/dashboard", status: 401 },
  ],
  portal: [{ path: "/api/v1/health", status: 200, service: "portal" }],
  // M6.2: the Razorpay webhook path is outside Access (owner's H1 bypass): a signed-out POST with no Access token and no signature must reach the Worker and
  // get its JSON 400 `signature_missing` (counted nowhere, nothing written). An Access page here means the bypass is missing.
  jobs: [
    { path: "/healthz", status: 200, service: "jobs" },
    { path: "/razorpay", status: 400, method: "POST", body: "{}", access: false, code: "signature_missing" },
    // M6.3: the same for the Stripe webhook (owner's H1 bypass for `/stripe`): a JSON POST with no `Stripe-Signature` is 400 `signature_missing`, not counted.
    { path: "/stripe", status: 400, method: "POST", body: "{}", access: false, code: "signature_missing" },
  ],
  web: [{ path: "/api/geo", status: 200 }],
};

export const DELAYS_MS = [0, 3_000, 6_000, 10_000, 15_000];
export const TIMEOUT_MS = 10_000;

/**
 * One answer judged against one check: null when it passes, else the reason. `body` is the parsed JSON body, or undefined when the
 * answer is not JSON.
 */
export function judge(check, { status, location, json, body }) {
  if (status >= 300 && status < 400)
    return /cloudflareaccess\.com/.test(location ?? "")
      ? `${status} to the Cloudflare Access sign-in page: Access did not accept the service token for this app`
      : `${status} redirect to ${location ?? "(no location)"}`;
  if ((status === 401 || status === 403) && !json)
    return `${status} from Cloudflare Access (not the Worker): the service token was refused`;
  if (!json) return `${status}, not a JSON answer from the Worker`;
  if (status !== check.status) return `${status}, expected ${check.status}`;
  // M6.2 (early check 2, finding 17): the webhook's 400 must be the Worker's own `signature_missing`, not any 400.
  if (check.code && body?.error?.code !== check.code)
    return `the error code is ${String(body?.error?.code)}, expected ${check.code}`;
  if (check.service) {
    if (body?.ok !== true) return "the health body does not say ok";
    if (body?.service !== check.service)
      return `the health body names ${String(body?.service)}, expected ${check.service}`;
    if (body?.env !== "staging") return `the health body says env ${String(body?.env)}, expected staging`;
  }
  return null;
}

/** Runs every check of one app with retries. `fetchImpl` and `sleep` are injectable for tests. Resolves to the failures (empty = ok). */
export async function checkApp(
  app,
  { headers, fetchImpl = fetch, sleep, log = console.log, delays = DELAYS_MS } = {},
) {
  const checks = CHECKS[app];
  if (!checks) return [`unknown app ${app}`];
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const failures = [];
  for (const check of checks) {
    const url = `${urlOf(app)}${check.path}`;
    let reason = "not tried";
    for (const [i, delay] of delays.entries()) {
      if (delay > 0) await wait(delay);
      try {
        const res = await fetchImpl(url, {
          ...(check.method ? { method: check.method, body: check.body } : {}),
          headers: check.access === false ? { "content-type": "application/json" } : headers,
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json = res.headers.get("content-type")?.includes("application/json") ?? false;
        const body = json ? await res.json().catch(() => undefined) : undefined;
        if (!json) await res.body?.cancel();
        reason =
          judge(check, { status: res.status, location: res.headers.get("location"), json, body }) ?? "";
      } catch (e) {
        reason = `request failed: ${e instanceof Error ? e.name : "error"}`;
      }
      log(`${app} ${check.path} attempt ${i + 1}: ${reason || "ok"}`);
      if (!reason) break;
    }
    if (reason) failures.push(`${app} ${check.path}: ${reason}`);
  }
  return failures;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = process.argv[2] ?? "";
  const id = process.env.CF_ACCESS_CLIENT_ID ?? "";
  const secret = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
  if (!CHECKS[app]) {
    console.error(`usage: node scripts/staging-health.mjs ${Object.keys(CHECKS).join("|")}`);
    process.exit(2);
  }
  if (!id || !secret) {
    console.error(
      "The Access service token (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET) is missing: the staging hosts are behind Access.",
    );
    process.exit(1);
  }
  const failures = await checkApp(app, {
    headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret },
  });
  if (failures.length > 0) {
    for (const f of failures) console.error(`health check FAILED: ${f}`);
    process.exit(1);
  }
  console.log(`health check: ${app} staging ok`);
}
