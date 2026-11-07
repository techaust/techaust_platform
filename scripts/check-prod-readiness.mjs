// Pre-production check (M2.3): run by .github/workflows/deploy-prod.yml before a production deploy, NEVER by CI or the
// staging deploy. It fails while a pending owner input is still a placeholder, so production can't ship with one.
// Each failure line says what the owner must supply. Pure functions for the tests; the CLI is at the bottom.
// Since the full audit (A1 finding 6) it also reads the admin's and the portal's built bundles for "[Placeholder" copy, and the
// Worker configs for an empty production Turnstile site key and for queues staging has and production lacks.
// P7 (docs/runs/p7-launch.md P7-B): deploy-prod.yml's build job builds every app for production first, so this check now also finds and reads
// jobs' and the website's pre-bundled production Workers (`dist-production`), compares staging and production per Worker (D1, R2, browser, rate
// limits, crons, the secrets.required set and the vars key set: only values may differ), and reads noindex from the BUILT dist/_headers.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./check-worker-config.mjs";
import { POSTAL_PLACEHOLDER_TEXT, readSiteBool, readSiteString, walk } from "./web-shared.mjs";

export { POSTAL_PLACEHOLDER_TEXT, readSiteBool, readSiteString };

/** The marker the `Placeholder` component writes (apps/web/src/components/Placeholder.astro). */
export const PLACEHOLDER_MARKER = "placeholder__tag";
/** Config the owner must have filled in: [{ key, what }]. */
const REQUIRED_TEXT = [
  [
    "postalAddress",
    "the postal address for the legal pages (site.postalAddress in apps/web/src/config/site.ts)",
  ],
  ["linkedinFounder", "the founder's LinkedIn URL (site.linkedinFounder)"],
  ["founderPhoto", "the founder's headshot (site.founderPhoto)"],
  ["founderBio", "the founder's bio (site.founderBio)"],
];

/** Config problems from the text of site.ts. */
export function checkSiteConfig(siteTs) {
  const problems = [];
  for (const [key, what] of REQUIRED_TEXT)
    if (!readSiteString(siteTs, key).trim()) problems.push(`The owner must supply ${what}: it is empty.`);
  if (!readSiteBool(siteTs, "aliasesConfirmed"))
    problems.push(
      "The owner must confirm that the security@ and privacy@ aliases deliver (U-5), then set site.aliasesConfirmed to true.",
    );
  return problems;
}

/**
 * The launch day (site.launchDate) must be set, and every legal page's `effective` in content/legal.ts must equal it
 * (owner, 2026-10-22: the effective date is the launch day). `legalTs` is the text of apps/web/src/content/legal.ts.
 */
export function checkLaunchDate(siteTs, legalTs) {
  const launch = readSiteString(siteTs, "launchDate").trim();
  if (!launch)
    return [
      "The launch date is not set: the lead sets site.launchDate and every legal page's `effective` date (apps/web/src/content/legal.ts) to the launch day, together, before production.",
    ];
  const dates = [...legalTs.matchAll(/\beffective:\s*"([^"]*)"/g)].map((m) => m[1]);
  if (dates.length === 0)
    return [
      "No `effective` dates found in apps/web/src/content/legal.ts (the readiness check cannot read them).",
    ];
  const wrong = [...new Set(dates.filter((d) => d !== launch))];
  return wrong.length
    ? [
        `Legal page effective date(s) ${wrong.join(", ")} differ from site.launchDate ${launch}: the lead sets both to the launch day before production.`,
      ]
    : [];
}

/** Problems in one built page: a Placeholder component or the postal-address placeholder is still on it. */
export function checkBuiltPage(name, html) {
  const problems = [];
  if (html.includes(PLACEHOLDER_MARKER))
    problems.push(`${name}: still shows a Placeholder (an owner input is missing); supply it, then rebuild.`);
  if (html.includes(POSTAL_PLACEHOLDER_TEXT))
    problems.push(`${name}: still shows the postal-address placeholder; the owner must supply the address.`);
  return problems;
}

/**
 * The X-Robots-Tag: noindex line in the BUILT dist/_headers (P7: the website's build writes it into dist/_headers on every build except
 * `CLOUDFLARE_ENV=production`, so a production build has none; `headersText` null means dist/_headers is missing).
 */
export function checkNoindex(headersText) {
  if (headersText === null)
    return [
      "apps/web/dist/_headers is missing: build the website for production (CLOUDFLARE_ENV=production) first.",
    ];
  const set = headersText
    .split(/\r?\n/)
    .some((l) => /^\s+x-robots-tag\s*:\s*[^#\n]*noindex/i.test(l) && !l.trim().startsWith("#"));
  return set
    ? [
        "dist/_headers sets X-Robots-Tag: noindex: the website was not built for production; build it with CLOUDFLARE_ENV=production (deploy-prod.yml's build:production).",
      ]
    : [];
}

/** Where the Phase 7 L7 runbook records that a backup was taken and restored (the one file this gate reads; a repo file, dates and a flag only, no data). */
export const BACKUP_RECORD_FILE = join(dirname(fileURLToPath(import.meta.url)), "backup-verified.json");

/**
 * The "encrypted, off-site backups" claim of the privacy notice and /security is true only once the off-site backup runs (Phase 7 L7: Cloudflare D1 and R2 encrypt at rest, but the copy
 * outside Cloudflare is L7's `backup.yml`). So production is blocked until `scripts/backup-verified.json` says a backup was taken AND restored: `{"verifiedOn": "YYYY-MM-DD",
 * "restoreDrill": true}` (the owner or the lead sets it, in the commit that closes L7). Researched 2026-10-28, Cloudflare D1/R2 data-security pages (08-C RB-30).
 * `text` is the file's text, or null when it is missing; `today` is an ISO day (the verified day may not be in the future).
 */
export function checkBackupVerified(text, today = new Date().toISOString().slice(0, 10)) {
  const how =
    'Set scripts/backup-verified.json to {"verifiedOn": "YYYY-MM-DD", "restoreDrill": true} in the commit that closes Phase 7 L7 (backups on, first backup restored on the production data).';
  if (text === null)
    return [
      `No verified backup is recorded (scripts/backup-verified.json is missing): the "encrypted, off-site backups" claim on the privacy notice and /security is not true yet. ${how}`,
    ];
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return [`scripts/backup-verified.json is not valid JSON. ${how}`];
  }
  const on = v && typeof v === "object" ? v.verifiedOn : null;
  const real =
    typeof on === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(on) &&
    !Number.isNaN(Date.parse(`${on}T00:00:00Z`)) &&
    new Date(`${on}T00:00:00Z`).toISOString().slice(0, 10) === on;
  if (!real)
    return [
      `No verified backup is recorded (verifiedOn is empty or not a real date): the "encrypted, off-site backups" claim is not true yet. ${how}`,
    ];
  if (on > today) return [`The backup's verifiedOn (${on}) is in the future. ${how}`];
  if (v.restoreDrill !== true)
    return [
      `A backup is recorded (${on}) but its restore drill is not: a backup that was never restored is not verified. ${how}`,
    ];
  return [];
}

// ---- the admin and the portal (audit A1 finding 6) ----------------------------------------------------------------------------

/** The two SPAs whose built bundles (the browser files and their Workers, all under `dist/`) are read. */
export const SPA_APPS = ["admin", "portal"];

/**
 * Copy the owner has not approved yet is shown with a "[Placeholder]" mark (07-W, 07-X: `X(line)` until `APPROVED_07X`), so a
 * built bundle that still holds the mark would show it to clients and staff. The issue guard that REFUSES such a line looks for
 * the bare prefix and stays in the bundle on purpose: `"[Placeholder"` in core (`issueBlockers`) and `'%[Placeholder%'` in the
 * freeze SQL. So a match counts only when the prefix is not followed by a closing quote or "%".
 */
const PENDING_COPY = /\[Placeholder(?![%"'`])/g;
const BUNDLE_TEXT = /\.(?:js|mjs|cjs|html|css|json|txt)$/i;

/** Problems in one built file of `app`: each pending-copy mark, with a little of the text around it (never more). */
export function checkBundleText(app, name, text) {
  const problems = [];
  for (const m of text.matchAll(PENDING_COPY)) {
    const around = text
      .slice(m.index, m.index + 70)
      .replace(/\s+/g, " ")
      .trim();
    problems.push(
      `${app} ${name}: still shows copy marked "[Placeholder" ("${around}…"): the owner approves the page (07-W/07-X), then the lead sets APPROVED_07X and rebuilds.`,
    );
  }
  return problems;
}

/**
 * P7: the pre-bundled production Workers deploy-prod.yml's build job makes (`wrangler deploy --dry-run --env production --outdir <dir>`), read
 * like the SPAs' bundles. Jobs renders the emails, the PDFs and the bells, so pending copy there would reach clients.
 */
export const PREBUNDLED_WORKERS = [
  {
    app: "jobs",
    dir: "dist-production",
    entry: "index.js",
    how: "pnpm --filter @techaust/jobs exec wrangler deploy --dry-run --env production --outdir dist-production",
  },
  {
    app: "web",
    dir: ".wrangler/dist-production",
    entry: "worker.js",
    how: "pnpm --filter @techaust/web exec wrangler deploy --dry-run --env production --outdir .wrangler/dist-production",
  },
];

/** Every built file of the admin and the portal, and the pre-bundled jobs and website Workers, under `appsDir` (apps/); a missing build is a problem in itself. */
export function checkBundles(appsDir) {
  const problems = [];
  for (const { app, dir, entry, how } of PREBUNDLED_WORKERS) {
    const out = join(appsDir, app, ...dir.split("/"));
    if (!existsSync(join(out, entry))) {
      problems.push(
        `apps/${app}/${dir}/${entry} is not built: bundle it for production (${how}) before this check.`,
      );
      continue;
    }
    for (const file of walk(out))
      if (/\.(?:js|mjs|cjs)$/i.test(file))
        problems.push(
          ...checkBundleText(
            app,
            `${dir}/${relative(out, file).split(sep).join("/")}`,
            readFileSync(file, "utf8"),
          ),
        );
  }
  for (const app of SPA_APPS) {
    const dist = join(appsDir, app, "dist");
    if (!existsSync(join(dist, "client", "index.html"))) {
      problems.push(
        `apps/${app}/dist is not built: build the ${app} for production (CLOUDFLARE_ENV=production vite build) before this check, so its bundles can be read for "[Placeholder" copy.`,
      );
      continue;
    }
    for (const file of walk(dist))
      if (BUNDLE_TEXT.test(file))
        problems.push(
          ...checkBundleText(app, relative(dist, file).split(sep).join("/"), readFileSync(file, "utf8")),
        );
  }
  return problems;
}

/** The Worker configs production reads: the app, its file, and whether its sign-in or forms page carries a Turnstile widget. */
export const PROD_CONFIGS = [
  { app: "web", file: "wrangler.jsonc", turnstile: true },
  { app: "admin", file: "wrangler.jsonc", turnstile: true },
  { app: "admin", file: "wrangler.api.jsonc", turnstile: false },
  // M6.1 stage A: the admin finance Worker (same queues as the front, no widget).
  { app: "admin", file: "wrangler.finance.jsonc", turnstile: false },
  // The fourth admin Worker (2026-11-03, ADM-G-02): the admin invoices Worker, the same checks as finance.
  { app: "admin", file: "wrangler.invoices.jsonc", turnstile: false },
  { app: "portal", file: "wrangler.jsonc", turnstile: true },
  { app: "jobs", file: "wrangler.jsonc", turnstile: false },
];

/** A queue's name without its environment word, so `techaust-staging-pdf` and `techaust-pdf` are the same queue. */
const queueStem = (name) =>
  String(name)
    .split("-")
    .filter((w) => !["staging", "production", "prod"].includes(w))
    .join("-");

/** A Worker name without its environment word, so `techaust-platform-admin-invoices-staging` and `techaust-platform-admin-invoices` are the same Worker. */
const workerStem = (name) => String(name).replace(/-(staging|production|prod)$/, "");

/**
 * One parsed config's production gaps: an empty `TURNSTILE_SITE_KEY` where the page has a widget (the sign-in or the forms would ship
 * without bot protection), every queue producer binding or consumer that staging has and production lacks (the sends would fail,
 * or nothing would read them), and (the fourth admin Worker, 2026-11-03, L7; review finding 4) every service binding staging has without a
 * production twin of the same binding name and entrypoint naming the production Worker (a production finance without ADMIN_ADVANCE, or a
 * jobs without ADMIN_JOBS, ADMIN_ADVANCE or ADMIN_GATEWAY, would fail its calls). `where` names the file in the message.
 */
export function checkProductionConfig(where, config, { turnstile }) {
  const problems = [];
  const prod = config.env?.production;
  const staging = config.env?.staging ?? {};
  if (!prod) return [`${where}: has no env.production (Phase 7 adds it).`];
  if (turnstile && !String(prod.vars?.TURNSTILE_SITE_KEY ?? "").trim())
    problems.push(
      `${where}: env.production.vars.TURNSTILE_SITE_KEY is empty: the owner creates the production Turnstile widget (docs/runbooks/ses-and-turnstile.md) and the lead sets its public site key and TURNSTILE_SECRET (Phase 7).`,
    );
  const prodProducers = new Set((prod.queues?.producers ?? []).map((p) => p.binding));
  for (const p of staging.queues?.producers ?? [])
    if (!prodProducers.has(p.binding))
      problems.push(
        `${where}: staging sends on the queue binding ${p.binding} but env.production has none: create the production queue and bind it (Phase 7, owner approval).`,
      );
  const prodConsumers = new Set((prod.queues?.consumers ?? []).map((c) => queueStem(c.queue)));
  for (const c of staging.queues?.consumers ?? [])
    if (!prodConsumers.has(queueStem(c.queue)))
      problems.push(
        `${where}: staging consumes ${c.queue} but env.production consumes no ${queueStem(c.queue)} queue: add the production consumer (Phase 7, owner approval).`,
      );
  const prodServices = prod.services ?? [];
  for (const s of staging.services ?? []) {
    const want = workerStem(s.service);
    const twin = prodServices.find((p) => p.binding === s.binding);
    const ep = s.entrypoint === undefined ? "" : ` (entrypoint ${s.entrypoint})`;
    if (!twin)
      problems.push(
        `${where}: staging binds the service ${s.binding}${ep} but env.production has none: bind it to ${want} (Phase 7, owner approval).`,
      );
    else if (twin.entrypoint !== s.entrypoint || twin.service !== want)
      problems.push(
        `${where}: env.production's ${s.binding} must name ${want}${ep}, as staging's names ${s.service}: it names ${String(twin.service)}${twin.entrypoint === undefined ? "" : ` (entrypoint ${twin.entrypoint})`}.`,
      );
  }
  return problems;
}

/**
 * Vars staging has and production must not (P7 brief, P7-A): the email allow-list applies only on staging (production emails every recipient).
 */
export const STAGING_ONLY_VARS = Object.freeze(["EMAIL_ALLOWED_RECIPIENTS"]);

/** A staging host, a staging resource name, a workers.dev host or localhost in a production value. */
const NON_PRODUCTION_VALUE = /techaust-staging|-staging\.|workers\.dev|localhost|127\.0\.0\.1/i;

const sorted = (xs) => [...xs].map(String).sort();
const sameSet = (a, b) => JSON.stringify([...new Set(sorted(a))]) === JSON.stringify([...new Set(sorted(b))]);
const listed = (xs) => (xs.length === 0 ? "none" : sorted(xs).join(", "));

/**
 * P7: staging and production of one parsed config must differ only in values (docs/runs/p7-launch.md P7-B 4): the same D1 bindings (each its
 * own database, never staging's, with the same migrations folder), the same R2 bindings (production buckets), the same browser binding, the same
 * rate limits (name and limits; production's own namespace ids), the same crons (`triggers` is inherited, so a scope without its own takes the
 * top level's), the same `secrets.required` set and the same vars keys (STAGING_ONLY_VARS aside). No production value names a staging resource,
 * a workers.dev host or localhost. Queues and service bindings are checkProductionConfig's.
 */
export function checkEnvParity(where, config) {
  const prod = config.env?.production;
  const staging = config.env?.staging;
  if (!prod || !staging) return [];
  const problems = [];
  const differ = (what, s, p) =>
    problems.push(
      `${where}: ${what} differ between staging (${listed(s)}) and production (${listed(p)}); only values may differ.`,
    );

  const d1s = staging.d1_databases ?? [];
  const d1p = prod.d1_databases ?? [];
  if (
    !sameSet(
      d1s.map((d) => d.binding),
      d1p.map((d) => d.binding),
    )
  )
    differ(
      "the D1 bindings",
      d1s.map((d) => d.binding),
      d1p.map((d) => d.binding),
    );
  for (const p of d1p) {
    const s = d1s.find((d) => d.binding === p.binding);
    if (!s) continue;
    if (p.database_id === s.database_id || p.database_name === s.database_name)
      problems.push(
        `${where}: env.production's D1 ${p.binding} is staging's database (${String(p.database_name)}): name the production database.`,
      );
    if ((p.migrations_dir ?? null) !== (s.migrations_dir ?? null))
      problems.push(
        `${where}: env.production's D1 ${p.binding} has migrations_dir ${String(p.migrations_dir)}, staging's ${String(s.migrations_dir)}.`,
      );
  }

  const r2s = (staging.r2_buckets ?? []).map((b) => b.binding);
  const r2p = (prod.r2_buckets ?? []).map((b) => b.binding);
  if (!sameSet(r2s, r2p)) differ("the R2 bindings", r2s, r2p);

  const bs = staging.browser?.binding;
  const bp = prod.browser?.binding;
  if (bs !== bp) differ("the browser bindings", bs ? [bs] : [], bp ? [bp] : []);

  const rls = staging.ratelimits ?? [];
  const rlp = prod.ratelimits ?? [];
  if (
    !sameSet(
      rls.map((r) => r.name),
      rlp.map((r) => r.name),
    )
  )
    differ(
      "the rate limits",
      rls.map((r) => r.name),
      rlp.map((r) => r.name),
    );
  for (const p of rlp) {
    const s = rls.find((r) => r.name === p.name);
    if (!s) continue;
    if (JSON.stringify(p.simple ?? null) !== JSON.stringify(s.simple ?? null))
      problems.push(
        `${where}: env.production's rate limit ${p.name} is ${JSON.stringify(p.simple)}, staging's ${JSON.stringify(s.simple)}.`,
      );
    if (String(p.namespace_id) === String(s.namespace_id))
      problems.push(
        `${where}: env.production's rate limit ${p.name} shares staging's namespace_id ${String(s.namespace_id)} (their counters would be shared).`,
      );
  }

  const crons = (scope) => scope.triggers?.crons ?? config.triggers?.crons ?? [];
  if (JSON.stringify(sorted(crons(staging))) !== JSON.stringify(sorted(crons(prod))))
    differ("the crons", crons(staging), crons(prod));

  const ss = staging.secrets?.required ?? [];
  const sp = prod.secrets?.required ?? [];
  if (!sameSet(ss, sp)) differ("the secrets.required sets", ss, sp);

  const vs = Object.keys(staging.vars ?? {}).filter((k) => !STAGING_ONLY_VARS.includes(k));
  const vp = Object.keys(prod.vars ?? {});
  for (const k of STAGING_ONLY_VARS)
    if (vp.includes(k))
      problems.push(`${where}: env.production sets ${k}, which applies only on staging: leave it out.`);
  const vpKept = vp.filter((k) => !STAGING_ONLY_VARS.includes(k));
  if (!sameSet(vs, vpKept)) differ("the vars keys", vs, vpKept);

  for (const [k, v] of Object.entries(prod.vars ?? {}))
    if (NON_PRODUCTION_VALUE.test(String(v)))
      problems.push(
        `${where}: env.production.vars.${k} names a staging, workers.dev or local host or resource: give it its production value.`,
      );
  const resources = [
    ...d1p.map((d) => d.database_name),
    ...(prod.r2_buckets ?? []).map((b) => b.bucket_name),
    ...(prod.queues?.producers ?? []).map((q) => q.queue),
    ...(prod.queues?.consumers ?? []).flatMap((q) => [q.queue, q.dead_letter_queue]),
  ].filter((n) => n !== undefined);
  for (const n of resources)
    if (NON_PRODUCTION_VALUE.test(String(n)))
      problems.push(`${where}: env.production names ${String(n)}: bind the production resource.`);
  return problems;
}

/** checkProductionConfig and checkEnvParity over every config in PROD_CONFIGS under `appsDir`. */
export function checkProductionConfigs(appsDir) {
  const problems = [];
  for (const c of PROD_CONFIGS) {
    const path = join(appsDir, c.app, c.file);
    const where = `apps/${c.app}/${c.file}`;
    if (!existsSync(path)) {
      problems.push(`${where} is missing.`);
      continue;
    }
    const config = parseJsonc(readFileSync(path, "utf8"));
    problems.push(...checkProductionConfig(where, config, c), ...checkEnvParity(where, config));
  }
  return problems;
}

/**
 * Everything for `webDir` (apps/web); needs the site built, and the admin and the portal built (their bundles are read).
 * `appsDir` is apps/ (the parent of `webDir` unless given). Returns the problems (empty = ready).
 */
export function checkProdReadiness(webDir, backupFile = BACKUP_RECORD_FILE, appsDir = join(webDir, "..")) {
  const dist = join(webDir, "dist");
  const problems = [];
  if (!existsSync(dist)) problems.push(`${dist} does not exist: build the site first.`);
  else {
    const siteTs = readFileSync(join(webDir, "src", "config", "site.ts"), "utf8");
    problems.push(...checkSiteConfig(siteTs));
    problems.push(
      ...checkLaunchDate(siteTs, readFileSync(join(webDir, "src", "content", "legal.ts"), "utf8")),
    );
    for (const file of walk(dist))
      if (file.endsWith(".html"))
        problems.push(
          ...checkBuiltPage(relative(dist, file).split(sep).join("/"), readFileSync(file, "utf8")),
        );
    const headers = join(dist, "_headers");
    problems.push(...checkNoindex(existsSync(headers) ? readFileSync(headers, "utf8") : null));
    problems.push(...checkBackupVerified(existsSync(backupFile) ? readFileSync(backupFile, "utf8") : null));
  }
  problems.push(...checkBundles(appsDir));
  problems.push(...checkProductionConfigs(appsDir));
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
  const problems = checkProdReadiness(webDir);
  if (problems.length > 0) {
    console.error(`check-prod-readiness: ${problems.length} problem(s), production is blocked:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("check-prod-readiness: ok");
}
