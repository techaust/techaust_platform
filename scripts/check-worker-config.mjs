// Guard: Version/Preview URLs skip Cloudflare Access, so every Worker config must switch them off at the top level
// and in `env.staging` and `env.production` (audit 2026-10-22, M1; docs/runbooks/access-staging.md). Also the admin API Worker's
// config against the front's (M5.0; the finance Worker's too since M6.1 stage A, the invoices Worker's since the fourth admin Worker, with the entrypoint
// bindings of jobs, finance and the portal), the jobs crons and binding (M5.4, FX-1), and Workers
// Traces on staging only (full audit A6 9), and the jobs Worker minified with source maps (L9).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const APPS = ["admin", "portal", "web", "jobs"];

/**
 * The admin Workers behind the front (no public URL, the front's resources): the API (M5.0), finance (M6.1 stage A) and invoices (the fourth admin Worker,
 * 2026-11-03) configs in apps/admin.
 */
export const ADMIN_AUX_CONFIGS = ["wrangler.api.jsonc", "wrangler.finance.jsonc", "wrangler.invoices.jsonc"];

/** wrangler.jsonc to a value: drops comments and trailing commas, leaving string contents alone. */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated /* comment");
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The scopes of one parsed config that do not set `preview_urls: false`. */
export function missingPreviewOff(config) {
  const scopes = [
    ["(top level)", config],
    ["env.staging", config.env?.staging],
    ["env.production", config.env?.production],
  ];
  return scopes.filter(([, c]) => c?.preview_urls !== false).map(([name]) => name);
}

const SCOPES = (config) => [
  ["(top level)", config],
  ["env.staging", config.env?.staging],
  ["env.production", config.env?.production],
];
const bindingKey = {
  d1_databases: (b) => `${b.binding}:${b.database_name}:${b.database_id}`,
  r2_buckets: (b) => `${b.binding}:${b.bucket_name}`,
};
const queueKeys = (c) => (c?.queues?.producers ?? []).map((b) => `${b.binding}:${b.queue}`).sort();

/**
 * The admin API Worker's config (M5.0, docs/13 2026-10-27; apps/admin/wrangler.api.jsonc) against the front's: no public URL at any
 * level (no workers.dev, no routes, no preview URLs), no assets, no previews block, no secrets, and the same D1, R2 and queue
 * resources as the front in each scope. Empty = passes.
 */
export function apiConfigProblems(api, front, opts = {}) {
  const problems = [];
  const ownVars = new Set(opts.ownVars ?? []);
  if (api.compatibility_date !== front.compatibility_date)
    problems.push("(top level): compatibility_date differs from the front's");
  if (JSON.stringify(api.compatibility_flags ?? []) !== JSON.stringify(front.compatibility_flags ?? []))
    problems.push("(top level): compatibility_flags differ from the front's");
  for (const [scope, c] of SCOPES(api)) {
    if (!c) {
      problems.push(`${scope}: missing`);
      continue;
    }
    if (c.workers_dev !== false) problems.push(`${scope}: workers_dev must be false`);
    if (c.preview_urls !== false) problems.push(`${scope}: preview_urls must be false`);
    for (const key of [
      "routes",
      "route",
      "assets",
      "previews",
      ...(opts.secrets ? [] : ["secrets"]),
      ...(opts.services ? [] : ["services"]),
    ]) {
      if (c[key] !== undefined) problems.push(`${scope}: ${key} is not allowed on the API Worker`);
    }
    // The fourth admin Worker (2026-11-03): the finance Worker binds the invoices Worker's `GatewayAdvance` (ADMIN_ADVANCE). Exactly these binding names, and
    // none in production until Phase 7; where each points is entrypointBindingProblems' check.
    if (opts.services) {
      const want = scope === "env.production" ? [] : [...opts.services].sort();
      const got = (c.services ?? []).map((s) => s.binding).sort();
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(`${scope}: services must be exactly ${JSON.stringify(want)}`);
    }
    // M6.2 (L1): the finance Worker holds the Razorpay key pair (no public URL: the safest home). Exactly these names, and none in production until Phase 7.
    if (opts.secrets) {
      const want = scope === "env.production" ? [] : [...opts.secrets].sort();
      const got = [...(c.secrets?.required ?? [])].sort();
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(`${scope}: secrets.required must be exactly ${JSON.stringify(want)}`);
    }
    const f = SCOPES(front).find(([n]) => n === scope)?.[1];
    // A name equal to the front's would deploy the API bundle over the front and point the binding at itself.
    if (!c.name || c.name === f?.name) problems.push(`${scope}: name must differ from the front's`);
    for (const [k, v] of Object.entries(c.vars ?? {})) {
      if (ownVars.has(k)) continue;
      if (f?.vars?.[k] !== v) problems.push(`${scope}: var ${k} differs from the front's`);
    }
    for (const [key, fn] of Object.entries(bindingKey)) {
      const a = (c[key] ?? []).map(fn).sort().join(",");
      const b = (f?.[key] ?? []).map(fn).sort().join(",");
      if (a !== b) problems.push(`${scope}: ${key} differ from the front's`);
    }
    // M6.2 (early check 2, finding 2): the finance Worker's own producers (`ownQueues`, the leads queue) are left out of the comparison; gatewayConfigProblems
    // checks where they point.
    const ownQueues = new Set(opts.ownQueues ?? []);
    const shared = queueKeys(c).filter((k) => !ownQueues.has(k.split(":")[0]));
    if (shared.join(",") !== queueKeys(f).join(","))
      problems.push(`${scope}: queues differ from the front's`);
    // A6 9: the two admin Workers are read together in the CPU baseline, so they log and trace alike.
    if (canonical(c.observability) !== canonical(f?.observability))
      problems.push(`${scope}: observability differs from the front's`);
  }
  return problems;
}

/**
 * The front must bind each auxiliary admin Worker in all three scopes, to that config's Worker name for the scope: ADMIN_API to the API
 * config (M5.0), when `finance` is given ADMIN_FINANCE to the finance config (M6.1 stage A), and when `invoices` is given ADMIN_INVOICES to the
 * invoices config (the fourth admin Worker, 2026-11-03). Their names must differ, and no binding names an entrypoint (the front calls the default
 * `fetch`; `BillingJobs`, `GatewayAdvance`, `GatewayEvents` and `PortalPayments` are for the jobs, finance and portal Workers only).
 */
export function frontServiceProblems(front, api, finance, invoices) {
  const problems = [];
  const targets = [
    ["ADMIN_API", api, "API"],
    ...(finance ? [["ADMIN_FINANCE", finance, "finance"]] : []),
    ...(invoices ? [["ADMIN_INVOICES", invoices, "invoices"]] : []),
  ];
  for (const [scope, c] of SCOPES(front)) {
    for (const [binding, config] of targets) {
      const want = SCOPES(config).find(([n]) => n === scope)?.[1]?.name;
      const got = (c?.services ?? []).find((x) => x.binding === binding);
      if (!got) problems.push(`${scope}: the ${binding} service binding is missing`);
      else {
        if (got.service !== want)
          problems.push(`${scope}: ${binding} points at ${got.service}, expected ${want}`);
        if (got.entrypoint !== undefined) problems.push(`${scope}: ${binding} must not name an entrypoint`);
      }
    }
    for (let i = 0; i < targets.length; i++)
      for (let k = i + 1; k < targets.length; k++) {
        const a = SCOPES(targets[i][1]).find(([n]) => n === scope)?.[1]?.name;
        const b = SCOPES(targets[k][1]).find(([n]) => n === scope)?.[1]?.name;
        if (a && a === b)
          problems.push(
            `${scope}: the ${targets[i][2]} and ${targets[k][2]} Workers must have different names`,
          );
      }
  }
  return problems;
}

/**
 * The fourth admin Worker (2026-11-03, brief D.2): the entrypoint bindings in every scope. The top level and `env.staging`: the finance Worker binds
 * `ADMIN_ADVANCE` to the invoices Worker's `GatewayAdvance` (the Owner's "Try again"); jobs binds `ADMIN_JOBS` to the invoices Worker's `BillingJobs`,
 * `ADMIN_ADVANCE` to its `GatewayAdvance` and `ADMIN_GATEWAY` to the finance Worker's `GatewayEvents`; the portal binds `ADMIN_PAY` to the finance
 * Worker's `PortalPayments`. `env.production`: none of them until Phase 7 (check-prod-readiness.mjs then requires the twins). Empty = passes.
 */
export function entrypointBindingProblems(jobs, portal, finance, invoices) {
  const problems = [];
  const bindingOf = (c, b) => (c?.services ?? []).find((x) => x.binding === b);
  const nameIn = (config, scope) => SCOPES(config).find(([n]) => n === scope)?.[1]?.name;
  const wiring = [
    ["finance", finance, "ADMIN_ADVANCE", invoices, "GatewayAdvance"],
    ["jobs", jobs, "ADMIN_JOBS", invoices, "BillingJobs"],
    ["jobs", jobs, "ADMIN_ADVANCE", invoices, "GatewayAdvance"],
    ["jobs", jobs, "ADMIN_GATEWAY", finance, "GatewayEvents"],
    ["portal", portal, "ADMIN_PAY", finance, "PortalPayments"],
  ];
  for (const [scope] of SCOPES(jobs)) {
    for (const [who, config, binding, target, entrypoint] of wiring) {
      const c = SCOPES(config).find(([n]) => n === scope)?.[1];
      const got = bindingOf(c, binding);
      if (scope === "env.production") {
        if (got) problems.push(`${scope}: ${who} has no ${binding} until Phase 7`);
        continue;
      }
      const want = nameIn(target, scope);
      if (!got) problems.push(`${scope}: ${who}'s ${binding} service binding is missing`);
      else {
        if (got.service !== want)
          problems.push(`${scope}: ${who}'s ${binding} points at ${got.service}, expected ${want}`);
        if (got.entrypoint !== entrypoint)
          problems.push(`${scope}: ${who}'s ${binding} must name the entrypoint ${entrypoint}`);
      }
    }
  }
  return problems;
}

/** M6.2: the finance Worker's own vars and secrets (L1, L16; apiConfigProblems' options for wrangler.finance.jsonc). */
export const FINANCE_OPTS = {
  ownVars: ["PORTAL_URL", "GATEWAY_TRANSPORT"],
  ownQueues: ["LEADS_QUEUE"],
  // The fourth admin Worker (2026-11-03): its one service binding, the invoices Worker's `GatewayAdvance`.
  services: ["ADMIN_ADVANCE"],
  // M6.3 (L3): the Stripe restricted key, finance only. M6.4 (L1): PayPal's client id and secret, finance only.
  secrets: [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "STRIPE_SECRET_KEY",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
  ],
};

/**
 * The invoices Worker's options for apiConfigProblems (the fourth admin Worker, 2026-11-03): none. Like the API Worker it holds no secret, no service binding
 * and no own var or queue (no LEADS_QUEUE): the front's D1, R2, EMAIL_QUEUE and PDF_QUEUE only.
 */
export const INVOICES_OPTS = {};

/** Each auxiliary admin config's options for apiConfigProblems. */
export const AUX_OPTS = {
  "wrangler.api.jsonc": {},
  "wrangler.finance.jsonc": FINANCE_OPTS,
  "wrangler.invoices.jsonc": INVOICES_OPTS,
};

/** The configs (by their `gatewayConfigProblems` label) that must state `PAYMENTS_LIVE_ALLOWED: "false"` in every scope, not only where they set it. */
// M6.5 (run file F): all six configs (jobs, portal, the four admin Workers) state it, as "false", in every scope (the split's finding 5 made it required for
// finance and invoices; M6.5 widens it to all six).
export const LIVE_FLAG_REQUIRED = ["jobs", "portal", "finance", "admin", "admin api", "admin invoices"];

/**
 * M6.2 (run file F): the gateway wiring in every scope. The top level and `env.staging`: jobs binds `ADMIN_GATEWAY` to the finance Worker's `GatewayEvents` and
 * requires `RAZORPAY_WEBHOOK_SECRET` (M6.3: and `STRIPE_WEBHOOK_SECRET`); the portal binds `ADMIN_PAY` to its `PortalPayments` and holds no gateway secret; the
 * finance Worker's `GATEWAY_TRANSPORT` is "stub" at the top level (local) and "api" on staging (M6.3: each gateway's own API; M6.2's "razorpay" is no longer
 * accepted there), with its `PORTAL_URL` and a `LEADS_QUEUE` producer onto the jobs Worker's leads queue. `env.production`: none of it until Phase 7.
 * `PAYMENTS_LIVE_ALLOWED`, wherever a config sets it, is exactly "false" (CLAUDE.md rule 7); the finance config and the admin invoices config (the two Workers
 * that write payments or issue on them; the fourth admin Worker's early check, finding 5) must set it, as "false", in every scope. Empty = passes.
 */
export function gatewayConfigProblems(jobs, portal, finance, others = []) {
  const problems = [];
  const bindingOf = (c, b) => (c?.services ?? []).find((x) => x.binding === b);
  for (const [scope, j] of SCOPES(jobs)) {
    const p = SCOPES(portal).find(([n]) => n === scope)?.[1];
    const f = SCOPES(finance).find(([n]) => n === scope)?.[1];
    const prod = scope === "env.production";
    for (const [who, c, binding, entrypoint] of [
      ["jobs", j, "ADMIN_GATEWAY", "GatewayEvents"],
      ["portal", p, "ADMIN_PAY", "PortalPayments"],
    ]) {
      const got = bindingOf(c, binding);
      if (prod) {
        if (got) problems.push(`${scope}: ${who} has no ${binding} until Phase 7`);
        continue;
      }
      if (!got) problems.push(`${scope}: ${who}'s ${binding} service binding is missing`);
      else {
        if (got.service !== f?.name)
          problems.push(`${scope}: ${who}'s ${binding} points at ${got.service}, expected ${f?.name}`);
        if (got.entrypoint !== entrypoint)
          problems.push(`${scope}: ${who}'s ${binding} must name the entrypoint ${entrypoint}`);
      }
    }
    const jobsSecrets = j?.secrets?.required ?? [];
    // M6.3: and the Stripe webhook signing secret; the restricted key stays on the finance Worker. M6.4 (L1): and the PayPal webhook's id (its signature is
    // checked offline in jobs); PayPal's client id and secret stay on the finance Worker.
    for (const name of ["RAZORPAY_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET", "PAYPAL_WEBHOOK_ID"])
      if (!prod && !jobsSecrets.includes(name))
        problems.push(`${scope}: jobs must require the secret ${name}`);
    if (
      jobsSecrets.some(
        (n) => n.startsWith("RAZORPAY_KEY") || n === "STRIPE_SECRET_KEY" || n.startsWith("PAYPAL_CLIENT"),
      )
    )
      problems.push(`${scope}: jobs must not hold a gateway's API key (finance only, L1, L3)`);
    if (
      (p?.secrets?.required ?? []).some(
        (n) => n.startsWith("RAZORPAY") || n.startsWith("STRIPE") || n.startsWith("PAYPAL"),
      )
    )
      problems.push(`${scope}: the portal holds no gateway secret`);
    if ((f?.secrets?.required ?? []).some((n) => n.startsWith("STRIPE_WEBHOOK")))
      problems.push(`${scope}: the Stripe webhook secret is the jobs Worker's, never finance's`);
    if ((f?.secrets?.required ?? []).some((n) => n.startsWith("PAYPAL_WEBHOOK")))
      problems.push(`${scope}: the PayPal webhook id is the jobs Worker's, never finance's`);
    // M6.4 (run file D "Local only"): the hook accepts the local simulator's certificate URL only while ENVIRONMENT is "local"; no deployed scope may say so.
    if (scope !== "(top level)" && j?.vars?.ENVIRONMENT === "local")
      problems.push(
        `${scope}: jobs ENVIRONMENT must not be "local" (the PayPal hook would take the local certificate)`,
      );
    const transport = f?.vars?.GATEWAY_TRANSPORT;
    // M6.3: staging's transport is "api" (every gateway's own API; M6.2 named it "razorpay").
    const wantTransport = scope === "(top level)" ? "stub" : scope === "env.staging" ? "api" : undefined;
    if (transport !== wantTransport)
      problems.push(`${scope}: finance GATEWAY_TRANSPORT must be ${wantTransport ?? "unset"}`);
    if (!prod && !f?.vars?.PORTAL_URL)
      problems.push(`${scope}: finance needs PORTAL_URL (Razorpay's return page)`);
    // Early check 2, finding 2: finance queues `gateway.advance` on the jobs Worker's own leads queue (top level and staging; none in production until Phase 7).
    const producer = (c, b) => (c?.queues?.producers ?? []).find((x) => x.binding === b)?.queue;
    const financeLeads = producer(f, "LEADS_QUEUE");
    if (prod) {
      if (financeLeads) problems.push(`${scope}: finance has no LEADS_QUEUE until Phase 7`);
    } else if (!financeLeads || financeLeads !== producer(j, "LEADS_QUEUE"))
      problems.push(
        `${scope}: finance's LEADS_QUEUE must be the jobs Worker's leads queue (${producer(j, "LEADS_QUEUE")})`,
      );
  }
  for (const [file, c] of [["jobs", jobs], ["portal", portal], ["finance", finance], ...others]) {
    const required = LIVE_FLAG_REQUIRED.includes(file);
    for (const [scope, x] of SCOPES(c)) {
      const v = x?.vars?.PAYMENTS_LIVE_ALLOWED;
      if (v === undefined ? required : v !== "false")
        problems.push(`${file} ${scope}: PAYMENTS_LIVE_ALLOWED must be "false"`);
    }
  }
  return problems;
}

/** The two cron expressions of the jobs Worker since M5.4 (LD61): the daily run at 22:00 UTC and the hourly tick at :30 UTC (the top of every IST hour). */
export const JOBS_CRONS = ["0 22 * * *", "30 * * * *"];

/**
 * The jobs Worker's M5.4 wiring (LD57, LD61): in the top level and in `env.staging` both crons and the ADMIN_JOBS service binding to the `BillingJobs` entrypoint of
 * `target`, the admin Worker that exports it (the finance config since M6.1 stage A, the API config before; that config's Worker name for the scope); in `env.production` NEITHER (production has no D1, queues or admin API until Phase 7, and a production binding to a Worker that
 * does not exist would fail the deploy). Empty = passes. FX-1 (A6 3): `triggers` IS inherited by an environment that omits it (wrangler's `EnvironmentInheritable`),
 * so production must state `"triggers": { "crons": [] }`, present and empty; with no `triggers` there it would run the top level's crons.
 */
export function jobsConfigProblems(jobs, target) {
  const problems = [];
  for (const [scope, c] of SCOPES(jobs)) {
    if (!c) {
      problems.push(`${scope}: missing`);
      continue;
    }
    const crons = JSON.stringify(c.triggers?.crons ?? []);
    const bound = (c.services ?? []).find((x) => x.binding === "ADMIN_JOBS");
    if (scope === "env.production") {
      if (!Array.isArray(c.triggers?.crons))
        problems.push(
          `${scope}: needs "triggers": { "crons": [] } (an environment without its own triggers inherits the top level's)`,
        );
      else if (c.triggers.crons.length > 0) problems.push(`${scope}: no cron triggers until Phase 7`);
      if (bound) problems.push(`${scope}: no ADMIN_JOBS service binding until Phase 7`);
      continue;
    }
    if (crons !== JSON.stringify(JOBS_CRONS))
      problems.push(`${scope}: crons must be exactly ${JSON.stringify(JOBS_CRONS)}`);
    const want = SCOPES(target).find(([n]) => n === scope)?.[1]?.name;
    if (!bound) problems.push(`${scope}: the ADMIN_JOBS service binding is missing`);
    else {
      if (bound.service !== want)
        problems.push(`${scope}: ADMIN_JOBS points at ${bound.service}, expected ${want}`);
      if (bound.entrypoint !== "BillingJobs")
        problems.push(`${scope}: ADMIN_JOBS must name the entrypoint BillingJobs`);
    }
  }
  return problems;
}

/**
 * L9 (owner, 2026-10-31; PR #138): the jobs Worker is minified with its source maps uploaded. Both keys must be `true` at the top
 * level (wrangler inherits them into every environment), and no environment may set either to anything but `true` (a `false`
 * there would quietly ship the unminified bundle, about a third bigger, or drop the readable stack traces). Empty = passes.
 */
export function jobsBuildProblems(jobs) {
  const problems = [];
  for (const key of ["minify", "upload_source_maps"]) {
    if (jobs[key] !== true) problems.push(`(top level): ${key} must be true (L9)`);
    for (const [name, env] of Object.entries(jobs.env ?? {})) {
      if (env && key in env && env[key] !== true)
        problems.push(`env.${name}: ${key} must not be switched off (L9)`);
    }
  }
  return problems;
}

/** The head sampling rate of Workers Traces on staging (full audit A6 9, owner's yes 2026-10-30; headroom in docs/runbooks/cpu-baseline.md). */
export const STAGING_TRACE_RATE = 0.1;

/** Production's observability block, unchanged by A6 9: console logs on, NO invocation logs, no traces. */
export const PRODUCTION_OBSERVABILITY = {
  enabled: true,
  redact_query_string: true,
  logs: { enabled: true, invocation_logs: false },
};

/** Key-order-independent JSON, to compare two parsed blocks. */
const canonical = (v) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
        .join(",")}}`
    : JSON.stringify(v);

/**
 * Workers Traces only in `env.staging` (A6 9): there, logs as before (on, invocation logs on, no log sampling), the query string
 * redacted, and traces on at exactly STAGING_TRACE_RATE; at the top level (local, and inherited by any environment without its own
 * block) traces must stay off, and production's block must be exactly PRODUCTION_OBSERVABILITY. Empty = passes.
 */
export function observabilityProblems(config) {
  const problems = [];
  const top = config.observability;
  if (top?.traces?.enabled) problems.push("(top level): traces must stay off (staging only)");
  const prod = config.env?.production?.observability;
  if (canonical(prod) !== canonical(PRODUCTION_OBSERVABILITY))
    problems.push(`env.production: observability must stay ${JSON.stringify(PRODUCTION_OBSERVABILITY)}`);
  const s = config.env?.staging?.observability;
  if (!s) return [...problems, "env.staging: needs its own observability block with traces"];
  if (s.enabled !== true) problems.push("env.staging: observability.enabled must be true");
  if (s.redact_query_string !== true) problems.push("env.staging: redact_query_string must be true");
  if (s.head_sampling_rate !== undefined) problems.push("env.staging: no top-level head_sampling_rate");
  if (s.logs?.enabled !== true || s.logs?.invocation_logs !== true)
    problems.push("env.staging: logs and invocation logs stay on");
  if (s.logs?.head_sampling_rate !== undefined) problems.push("env.staging: logs are not sampled");
  if (s.traces?.enabled !== true) problems.push("env.staging: traces.enabled must be true");
  if (s.traces?.head_sampling_rate !== STAGING_TRACE_RATE)
    problems.push(`env.staging: traces.head_sampling_rate must be ${STAGING_TRACE_RATE}`);
  return problems;
}

/** M7.1 (Q2 A, owner 2026-11-01): the file vault the portal reads (shared files), per scope; production has no R2 bucket until Phase 7. */
export const PORTAL_FILES_BUCKETS = {
  "(top level)": "techaust-local-files",
  "env.staging": "techaust-staging-files",
};

/**
 * M7.1 (run file F): the portal binds `FILES` to the local file vault at the top level and to the staging one in `env.staging`, and NOT in `env.production`
 * (no R2 there until Phase 7, and a binding there would be inherited by nothing: each scope lists its own). Empty = passes.
 */
export function portalFilesProblems(portal) {
  const problems = [];
  const filesOf = (c) => (c?.r2_buckets ?? []).filter((b) => b.binding === "FILES");
  for (const [scope, c] of SCOPES(portal)) {
    const files = filesOf(c);
    const want = PORTAL_FILES_BUCKETS[scope];
    if (want === undefined) {
      if (files.length > 0) problems.push(`${scope}: the portal binds no FILES bucket until Phase 7`);
    } else if (files.length !== 1 || files[0].bucket_name !== want)
      problems.push(`${scope}: the portal binds FILES to ${want}`);
  }
  return problems;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let failed = false;
  for (const app of APPS) {
    const config = parseJsonc(
      readFileSync(new URL(`../apps/${app}/wrangler.jsonc`, import.meta.url), "utf8"),
    );
    const missing = missingPreviewOff(config);
    if (missing.length > 0) {
      console.error(`apps/${app}/wrangler.jsonc: "preview_urls": false is missing at ${missing.join(", ")}`);
      failed = true;
    }
  }
  const read = (p) => parseJsonc(readFileSync(new URL(`../apps/${p}`, import.meta.url), "utf8"));
  const front = read("admin/wrangler.jsonc");
  const aux = Object.fromEntries(ADMIN_AUX_CONFIGS.map((f) => [f, read(`admin/${f}`)]));
  for (const [file, config] of Object.entries(aux)) {
    const missing = missingPreviewOff(config);
    if (missing.length > 0) {
      console.error(`apps/admin/${file}: "preview_urls": false is missing at ${missing.join(", ")}`);
      failed = true;
    }
    for (const p of apiConfigProblems(config, front, AUX_OPTS[file])) {
      console.error(`apps/admin/${file}: ${p}`);
      failed = true;
    }
  }
  const api = aux["wrangler.api.jsonc"];
  const finance = aux["wrangler.finance.jsonc"];
  const invoices = aux["wrangler.invoices.jsonc"];
  for (const p of frontServiceProblems(front, api, finance, invoices)) {
    console.error(`apps/admin: ${p}`);
    failed = true;
  }
  // M6.1 stage A: `BillingJobs` was exported by the finance Worker; the fourth admin Worker (2026-11-03): by the invoices Worker.
  for (const p of jobsConfigProblems(read("jobs/wrangler.jsonc"), invoices)) {
    console.error(`apps/jobs: ${p}`);
    failed = true;
  }
  for (const p of entrypointBindingProblems(
    read("jobs/wrangler.jsonc"),
    read("portal/wrangler.jsonc"),
    finance,
    invoices,
  )) {
    console.error(`apps: ${p}`);
    failed = true;
  }
  for (const p of gatewayConfigProblems(read("jobs/wrangler.jsonc"), read("portal/wrangler.jsonc"), finance, [
    ["admin", front],
    ["admin api", api],
    ["admin invoices", invoices],
  ])) {
    console.error(`apps: ${p}`);
    failed = true;
  }
  for (const p of portalFilesProblems(read("portal/wrangler.jsonc"))) {
    console.error(`apps/portal/wrangler.jsonc: ${p}`);
    failed = true;
  }
  for (const p of jobsBuildProblems(read("jobs/wrangler.jsonc"))) {
    console.error(`apps/jobs: ${p}`);
    failed = true;
  }
  for (const file of [
    ...APPS.map((a) => `${a}/wrangler.jsonc`),
    ...ADMIN_AUX_CONFIGS.map((f) => `admin/${f}`),
  ]) {
    for (const p of observabilityProblems(read(file))) {
      console.error(`apps/${file}: ${p}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
  console.log(
    "worker config guard: ok (preview_urls is false everywhere; the admin API, finance and invoices Workers have no public URL; the entrypoint bindings point at their Workers; the portal's FILES on local and staging only; traces on staging only; jobs minified with source maps)",
  );
}
