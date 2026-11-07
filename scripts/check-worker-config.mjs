// Guard: Version/Preview URLs skip Cloudflare Access, so every Worker config must switch them off at the top level
// and in `env.staging` and `env.production` (audit 2026-10-22, M1; docs/runbooks/access-staging.md). Also the admin API Worker's
// config against the front's (M5.0; the finance Worker's too since M6.1 stage A, the invoices Worker's since the fourth admin Worker, with the entrypoint
// bindings of jobs, finance and the portal), the jobs crons and binding (M5.4, FX-1), and Workers
// Traces on staging only (full audit A6 9), and the jobs Worker minified with source maps (L9).
// P7-A (launch 2026-11-08, docs/runs/p7-launch.md): every `env.production` mirrors `env.staging` binding for binding (D1, R2, queues and consumers,
// services and entrypoints, Browser Run, crons, rate limits, `secrets.required`, vars keys), naming the production resources and hosts; no staging
// name, staging database id, workers.dev or localhost in production; and no `routes`/`route` in any scope of any config (the lead attaches the
// custom domains by hand, so a deploy never takes techaust.com from the old Worker).
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
    // The fourth admin Worker (2026-11-03): the finance Worker binds the invoices Worker's `GatewayAdvance` (ADMIN_ADVANCE). Exactly these binding names, in
    // every scope (production too since P7-A); where each points is entrypointBindingProblems' check.
    if (opts.services) {
      const want = [...opts.services].sort();
      const got = (c.services ?? []).map((s) => s.binding).sort();
      if (JSON.stringify(got) !== JSON.stringify(want))
        problems.push(`${scope}: services must be exactly ${JSON.stringify(want)}`);
    }
    // M6.2 (L1): the finance Worker holds the Razorpay key pair (no public URL: the safest home). M7.4 (L23): the API Worker holds exactly
    // `ERASURE_HASH_KEY`. Exactly these names, in every scope (production too since P7-A).
    if (opts.secrets) {
      const want = [...opts.secrets].sort();
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
 * Worker's `PortalPayments`. `env.production` the same, naming the production Workers (P7-A). Empty = passes.
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
/** M7.4 (L23): the admin API Worker's only secret, the key of the erased-address hash (the same value as the jobs Worker's). */
export const API_SECRETS = ["ERASURE_HASH_KEY"];
export const AUX_OPTS = {
  "wrangler.api.jsonc": { secrets: API_SECRETS },
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
 * accepted there), with its `PORTAL_URL` and a `LEADS_QUEUE` producer onto the jobs Worker's leads queue. `env.production` the same as staging (P7-A):
 * transport "api", payments on test keys.
 * `PAYMENTS_LIVE_ALLOWED`, wherever a config sets it, is exactly "false" (CLAUDE.md rule 7); the finance config and the admin invoices config (the two Workers
 * that write payments or issue on them; the fourth admin Worker's early check, finding 5) must set it, as "false", in every scope. Empty = passes.
 */
export function gatewayConfigProblems(jobs, portal, finance, others = []) {
  const problems = [];
  const bindingOf = (c, b) => (c?.services ?? []).find((x) => x.binding === b);
  for (const [scope, j] of SCOPES(jobs)) {
    const p = SCOPES(portal).find(([n]) => n === scope)?.[1];
    const f = SCOPES(finance).find(([n]) => n === scope)?.[1];
    for (const [who, c, binding, entrypoint] of [
      ["jobs", j, "ADMIN_GATEWAY", "GatewayEvents"],
      ["portal", p, "ADMIN_PAY", "PortalPayments"],
    ]) {
      const got = bindingOf(c, binding);
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
      if (!jobsSecrets.includes(name)) problems.push(`${scope}: jobs must require the secret ${name}`);
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
    // M6.3: staging's transport is "api" (every gateway's own API; M6.2 named it "razorpay"); production's too (P7-A).
    const wantTransport = scope === "(top level)" ? "stub" : "api";
    if (transport !== wantTransport)
      problems.push(`${scope}: finance GATEWAY_TRANSPORT must be ${wantTransport}`);
    if (!f?.vars?.PORTAL_URL) problems.push(`${scope}: finance needs PORTAL_URL (Razorpay's return page)`);
    // Early check 2, finding 2: finance queues `gateway.advance` on the jobs Worker's own leads queue (every scope).
    const producer = (c, b) => (c?.queues?.producers ?? []).find((x) => x.binding === b)?.queue;
    const financeLeads = producer(f, "LEADS_QUEUE");
    if (!financeLeads || financeLeads !== producer(j, "LEADS_QUEUE"))
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
 * The jobs Worker's M5.4 wiring (LD57, LD61): in every scope (production too since P7-A) both crons and the ADMIN_JOBS service binding to the `BillingJobs`
 * entrypoint of `target`, the admin Worker that exports it (the invoices config since the fourth admin Worker; that config's Worker name for the scope).
 * Empty = passes. FX-1 (A6 3): `triggers` IS inherited by an environment that omits it (wrangler's `EnvironmentInheritable`), so each environment states its
 * own `triggers` (a change at the top level must never reach staging or production unseen).
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
    if (scope !== "(top level)" && !Array.isArray(c.triggers?.crons))
      problems.push(
        `${scope}: needs its own "triggers": { "crons": [...] } (an environment without its own triggers inherits the top level's)`,
      );
    else if (crons !== JSON.stringify(JOBS_CRONS))
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

/** M7.2 (run file F): the jobs Worker's SES-events and one-click names. */
export const NOTIFY_SECRETS = ["SES_EVENTS_TOKEN", "UNSUBSCRIBE_KEY"];
export const MARKETING_CONFIGURATION_SET = "techaust-marketing";
/** P7-A: the jobs Worker's production origin (the one-click unsubscribe URL starts with it). */
export const PRODUCTION_HOOKS_URL = "https://hooks.techaust.com/";

/**
 * M7.2 (run file F, C.3, C.5): per scope of the jobs config. Every scope (production too since P7-A) requires `SES_EVENTS_TOKEN` and `UNSUBSCRIBE_KEY` (a missing
 * one aborts the deploy), sets `PUBLIC_HOOKS_URL` (ending in "/"; local `http://localhost:8787/`; staging the jobs Worker's own https workers.dev origin, which the
 * one-click URL must start with; production `https://hooks.techaust.com/`) and `SES_MARKETING_CONFIGURATION_SET` (`techaust-marketing`). Staging and production
 * also redact the query string in Workers Logs (the one-click token rides in `/u?t=`; the observability guard holds the same key for every config). No other
 * app requires either secret. Empty = passes.
 */
export function notificationConfigProblems(jobs, others = []) {
  const problems = [];
  for (const [scope, c] of SCOPES(jobs)) {
    if (!c) {
      problems.push(`${scope}: missing`);
      continue;
    }
    const required = c.secrets?.required ?? [];
    const vars = c.vars ?? {};
    for (const name of NOTIFY_SECRETS)
      if (!required.includes(name)) problems.push(`${scope}: jobs must require the secret ${name}`);
    const url = vars.PUBLIC_HOOKS_URL;
    if (typeof url !== "string" || !url.endsWith("/"))
      problems.push(`${scope}: PUBLIC_HOOKS_URL must be set and end with "/"`);
    else if (scope === "(top level)" && url !== "http://localhost:8787/")
      problems.push(`${scope}: PUBLIC_HOOKS_URL must be http://localhost:8787/`);
    else if (scope === "env.staging" && !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/$/.test(url))
      problems.push(`${scope}: PUBLIC_HOOKS_URL must be the jobs Worker's https workers.dev origin`);
    else if (scope === "env.staging" && !url.startsWith(`https://${c.name}.`))
      problems.push(`${scope}: PUBLIC_HOOKS_URL must be this Worker's own origin (${c.name})`);
    else if (scope === "env.production" && url !== PRODUCTION_HOOKS_URL)
      problems.push(`${scope}: PUBLIC_HOOKS_URL must be ${PRODUCTION_HOOKS_URL}`);
    if (vars.SES_MARKETING_CONFIGURATION_SET !== MARKETING_CONFIGURATION_SET)
      problems.push(`${scope}: SES_MARKETING_CONFIGURATION_SET must be "${MARKETING_CONFIGURATION_SET}"`);
    if (scope !== "(top level)" && c.observability?.redact_query_string !== true)
      problems.push(`${scope}: redact_query_string must be true (the one-click token is in /u?t=)`);
  }
  for (const [file, cfg] of others)
    for (const [scope, c] of SCOPES(cfg))
      for (const name of NOTIFY_SECRETS)
        if ((c?.secrets?.required ?? []).includes(name))
          problems.push(`${file} ${scope}: ${name} is the jobs Worker's only`);
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

/** Key-order-independent JSON (at every depth, array order kept), to compare two parsed blocks. */
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
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

/** M7.1 (Q2 A, owner 2026-11-01): the file vault the portal reads (shared files), per scope; production's since P7-A. */
export const PORTAL_FILES_BUCKETS = {
  "(top level)": "techaust-local-files",
  "env.staging": "techaust-staging-files",
  "env.production": "techaust-prod-files",
};

/**
 * M7.4 (L7, L8; run file F): the jobs Worker binds the same `FILES` buckets as the portal (every scope), for the clean-up's outbox drain and weekly sweep; and
 * requires `ERASURE_HASH_KEY` in every scope. Empty = passes.
 */
export function jobsDataProtectionProblems(jobs) {
  const problems = [];
  for (const [scope, c] of SCOPES(jobs)) {
    const files = (c?.r2_buckets ?? []).filter((b) => b.binding === "FILES");
    const want = PORTAL_FILES_BUCKETS[scope];
    if (files.length !== 1 || files[0].bucket_name !== want)
      problems.push(`${scope}: jobs binds FILES to ${want}`);
    if (!(c?.secrets?.required ?? []).includes("ERASURE_HASH_KEY"))
      problems.push(`${scope}: jobs must require the secret ERASURE_HASH_KEY`);
  }
  return problems;
}

/** M7.4 (review fix 17, L4): `LEAD_PURGE_MODE` is gone (the real-deletion switch replaced it); it must not reappear in any scope of any config. */
export function leadPurgeModeProblems(configs) {
  const problems = [];
  for (const [file, cfg] of configs)
    for (const [scope, c] of SCOPES(cfg))
      if (c?.vars && "LEAD_PURGE_MODE" in c.vars)
        problems.push(
          `${file} ${scope}: LEAD_PURGE_MODE is gone (Settings › Data retention holds the switch)`,
        );
  return problems;
}

/**
 * M7.1 (run file F): the portal binds `FILES` to the file vault of each scope (local, staging and, since P7-A, production; not inherited, so each scope lists
 * its own). Empty = passes.
 */
export function portalFilesProblems(portal) {
  const problems = [];
  const filesOf = (c) => (c?.r2_buckets ?? []).filter((b) => b.binding === "FILES");
  for (const [scope, c] of SCOPES(portal)) {
    const files = filesOf(c);
    const want = PORTAL_FILES_BUCKETS[scope];
    if (files.length !== 1 || files[0].bucket_name !== want)
      problems.push(`${scope}: the portal binds FILES to ${want}`);
  }
  return problems;
}

/**
 * M7.5 (C2, L2, L5, L22): the In-Worker Rate Limiting bindings each Worker must have, by name with its limit per 60 seconds. Bindings are not inherited by
 * environments, so every scope (top level, `env.staging`, `env.production`) lists them. Only the admin FRONT has them (the API, finance and invoices Workers
 * are reached through it and must not hold the limiter or its keys).
 */
export const RATE_LIMITS = {
  admin: { RL_SESSION: 240, RL_SIGNIN: 20, RL_INVITE: 10 },
  // Full audit AU60: RL_SIGNOUT per address on the portal's sign-out (generous: a 429 still clears the cookie).
  portal: { RL_SESSION: 120, RL_SIGNIN: 10, RL_LINKS: 30, RL_SIGNOUT: 60 },
  // P7-A: the website's form limiter (M2.4: 2 a minute per address), in every scope with its own namespace id (local 4101, staging 4201, production 4301).
  web: { RL_FORMS: 2 },
};

/**
 * M7.5 (L22): each config of `required` ([label, config, {name: limit}]) has exactly those bindings in every scope, each with `simple` `{limit, period: 60}` and
 * a `namespace_id` that is a positive integer string; every namespace id is used once across every scope and purpose of `required` (two bindings sharing one
 * share their counters, Cloudflare docs read 2026-11-07), and none collides with a namespace id of `others` ([label, config], e.g. web's RL_FORMS); `none`
 * ([label, config]) has no `ratelimits` in any scope. Empty = passes.
 */
export function rateLimitProblems(required, others = [], none = []) {
  const problems = [];
  const owners = new Map();
  const claim = (id, who) => {
    const was = owners.get(id);
    if (was) problems.push(`${who}: namespace_id ${id} is already used by ${was}`);
    else owners.set(id, who);
  };
  for (const [label, cfg, want] of required) {
    for (const [scope, c] of SCOPES(cfg)) {
      const list = c?.ratelimits ?? [];
      const names = list.map((r) => r?.name).sort();
      const wantNames = Object.keys(want).sort();
      if (JSON.stringify(names) !== JSON.stringify(wantNames))
        problems.push(
          `${label} ${scope}: ratelimits must be exactly ${JSON.stringify(wantNames)} (not inherited: list them in every scope)`,
        );
      for (const r of list) {
        const who = `${label} ${scope} ${r?.name}`;
        if (typeof r?.namespace_id !== "string" || !/^[1-9][0-9]*$/.test(r.namespace_id))
          problems.push(`${who}: namespace_id must be a positive integer, as a string`);
        else claim(r.namespace_id, who);
        if (r?.simple?.period !== 60) problems.push(`${who}: simple.period must be 60`);
        if (want[r?.name] !== undefined && r?.simple?.limit !== want[r.name])
          problems.push(`${who}: simple.limit must be ${want[r.name]}`);
      }
    }
  }
  for (const [label, cfg] of others)
    for (const [scope, c] of SCOPES(cfg))
      for (const r of c?.ratelimits ?? [])
        if (owners.has(r?.namespace_id))
          problems.push(
            `${label} ${scope} ${r?.name}: namespace_id ${r.namespace_id} is already used by ${owners.get(r.namespace_id)}`,
          );
  for (const [label, cfg] of none)
    for (const [scope, c] of SCOPES(cfg))
      if (c?.ratelimits !== undefined)
        problems.push(`${label} ${scope}: no ratelimits (the front counts every request it forwards)`);
  return problems;
}

/** P7-A (docs/runs/p7-launch.md): the production D1 database every production `DB` binding names (created by the lead, 2026-11-07). */
export const PRODUCTION_D1 = {
  database_name: "techaust-prod",
  database_id: "d16029d2-373e-4b66-beb0-d77158d6dfc2",
};

/** A staging R2 bucket or queue name to its production twin: `techaust-staging-pdf-dlq` → `techaust-prod-pdf-dlq`. */
export const productionResourceOf = (name) => String(name).replace(/^techaust-staging-/, "techaust-prod-");

/** A staging Worker name to its production twin: `techaust-platform-admin-finance-staging` → `techaust-platform-admin-finance`. */
export const productionWorkerOf = (name) => String(name).replace(/-staging$/, "");

/** Vars that only staging has: the SES-sandbox allow-list (src/email.ts applies it on staging only). Production must not set them. */
export const STAGING_ONLY_VARS = ["EMAIL_ALLOWED_RECIPIENTS"];

/** Vars whose production value is staging's (P7-A brief: the SES region and configuration sets, the PDF renderer and pacing, the transports, the live flag). */
export const SAME_AS_STAGING_VARS = [
  "PAYMENTS_LIVE_ALLOWED",
  "EMAIL_TRANSPORT",
  "SES_REGION",
  "SES_CONFIGURATION_SET",
  "SES_MARKETING_CONFIGURATION_SET",
  "PDF_RENDERER",
  "PDF_MIN_SPACING_MS",
  "GATEWAY_TRANSPORT",
  "CF_ACCOUNT_TAG",
];

/** The production hosts (P7-A brief): web, admin (behind Access), portal and the jobs hooks. */
export const PRODUCTION_ORIGINS = {
  web: "https://techaust.com",
  admin: "https://admin.techaust.com",
  portal: "https://portal.techaust.com",
  jobs: "https://hooks.techaust.com",
};

/** Each config's production vars that name a host or the environment, by config label (the labels of `WORKER_CONFIGS`). */
const O = PRODUCTION_ORIGINS;
export const PRODUCTION_VARS = {
  web: {
    ENVIRONMENT: "production",
    TURNSTILE_HOSTNAMES: "techaust.com",
    FORMS_ALLOWED_ORIGINS: O.web,
  },
  admin: {
    ENVIRONMENT: "production",
    TURNSTILE_HOSTNAMES: "admin.techaust.com",
    PORTAL_ORIGIN: O.portal,
  },
  "admin api": { ENVIRONMENT: "production" },
  "admin finance": { ENVIRONMENT: "production", PORTAL_URL: `${O.portal}/` },
  "admin invoices": { ENVIRONMENT: "production" },
  portal: {
    ENVIRONMENT: "production",
    TURNSTILE_HOSTNAMES: "portal.techaust.com",
    WEBSITE_ORIGIN: O.web,
  },
  jobs: {
    ENVIRONMENT: "production",
    LEAD_ALERT_TO: "admin@techaust.com",
    ADMIN_URL: `${O.admin}/`,
    EMAIL_ASSET_BASE: `${O.web}/brand/`,
    PORTAL_URL: `${O.portal}/`,
    PUBLIC_HOOKS_URL: `${O.jobs}/`,
  },
};

/** Every Worker config: its label (as in PRODUCTION_VARS) and its path under apps/. */
export const WORKER_CONFIGS = [
  ["web", "web/wrangler.jsonc"],
  ["admin", "admin/wrangler.jsonc"],
  ["admin api", "admin/wrangler.api.jsonc"],
  ["admin finance", "admin/wrangler.finance.jsonc"],
  ["admin invoices", "admin/wrangler.invoices.jsonc"],
  ["portal", "portal/wrangler.jsonc"],
  ["jobs", "jobs/wrangler.jsonc"],
];

/** Cloudflare's Turnstile test site keys (always pass, always fail, …): `1x`, `2x` or `3x` and twenty zeros. Never a production key. */
const TURNSTILE_TEST_KEY = /^[123]x0{20}/;

/**
 * P7-A: `env.production` mirrors `env.staging` binding for binding, naming the production resources. Compared: the Worker name (staging's without
 * `-staging`, equal to the top level's), `workers_dev` false; D1 (`PRODUCTION_D1`, staging's `migrations_dir`), R2 buckets and queue producers (staging's
 * names with `techaust-staging-` → `techaust-prod-`), queue consumers with staging's settings and dead-letter queues, service bindings with staging's
 * entrypoints pointing at the production Workers, Browser Run, the crons, the rate limits' names and limits (their ids: rateLimitProblems), the
 * `secrets.required` set and the vars key set (minus STAGING_ONLY_VARS); SAME_AS_STAGING_VARS keep staging's value and `wantVars` holds the production
 * hosts. Nothing in production may name staging (a `techaust-staging*` resource, a `-staging` Worker, staging's database id), workers.dev, localhost or
 * an `http://` URL. The Turnstile site key is empty (the lead fills it in; the readiness check refuses an empty one) or a real key that is neither
 * staging's nor a test key, and its hostnames are techaust.com hosts. Empty = passes.
 */
export function productionMirrorProblems(config, wantVars = {}) {
  const P = "env.production";
  const s = config.env?.staging;
  const prod = config.env?.production;
  if (!s || !prod) return ["env.staging and env.production are both required"];
  const problems = [];
  if (prod.name !== productionWorkerOf(s.name) || prod.name === s.name || prod.name !== config.name)
    problems.push(`${P}: name must be ${config.name}, staging's without "-staging"`);
  if (prod.workers_dev !== false) problems.push(`${P}: workers_dev must be false`);

  const pairs = (key, list, twinOf) => {
    const got = new Map((prod[key] ?? []).map((b) => [b.binding, b]));
    const want = s[key] ?? [];
    for (const b of want) {
      const twin = got.get(b.binding);
      if (!twin) problems.push(`${P}: ${list} binding ${b.binding} is missing (staging has it)`);
      else {
        const expected = twinOf(b);
        if (canonical(twin) !== canonical(expected))
          problems.push(`${P}: ${list} binding ${b.binding} must be ${JSON.stringify(expected)}`);
      }
    }
    for (const name of got.keys())
      if (!want.some((b) => b.binding === name))
        problems.push(`${P}: ${list} binding ${name} is not on staging`);
  };
  pairs("d1_databases", "D1", (b) => ({
    binding: b.binding,
    ...PRODUCTION_D1,
    ...(b.migrations_dir === undefined ? {} : { migrations_dir: b.migrations_dir }),
  }));
  pairs("r2_buckets", "R2", (b) => ({ ...b, bucket_name: productionResourceOf(b.bucket_name) }));
  pairs("services", "service", (b) => ({ ...b, service: productionWorkerOf(b.service) }));
  {
    const sq = s.queues?.producers ?? [];
    const pq = prod.queues?.producers ?? [];
    const want = sq.map((b) => ({ ...b, queue: productionResourceOf(b.queue) }));
    if (canonical(sortBy(pq, "binding")) !== canonical(sortBy(want, "binding")))
      problems.push(`${P}: queue producers must be ${JSON.stringify(sortBy(want, "binding"))}`);
    const consumerOf = (c) => ({
      ...c,
      queue: productionResourceOf(c.queue),
      ...(c.dead_letter_queue === undefined
        ? {}
        : { dead_letter_queue: productionResourceOf(c.dead_letter_queue) }),
    });
    const wantC = sortBy((s.queues?.consumers ?? []).map(consumerOf), "queue");
    if (canonical(sortBy(prod.queues?.consumers ?? [], "queue")) !== canonical(wantC))
      problems.push(
        `${P}: queue consumers must be staging's with the production queues: ${JSON.stringify(wantC)}`,
      );
  }
  if (canonical(prod.browser) !== canonical(s.browser)) problems.push(`${P}: browser must be staging's`);
  if (canonical(prod.triggers) !== canonical(s.triggers)) problems.push(`${P}: triggers must be staging's`);
  const limits = (c) =>
    sortBy(
      (c.ratelimits ?? []).map((r) => ({ name: r.name, simple: r.simple })),
      "name",
    );
  if (canonical(limits(prod)) !== canonical(limits(s)))
    problems.push(`${P}: ratelimits must have staging's names and limits (each its own namespace_id)`);
  const set = (a) => JSON.stringify([...(a ?? [])].sort());
  if (set(prod.secrets?.required) !== set(s.secrets?.required))
    problems.push(`${P}: secrets.required must be staging's: ${set(s.secrets?.required)}`);

  const sv = s.vars ?? {};
  const pv = prod.vars ?? {};
  const wantKeys = Object.keys(sv).filter((k) => !STAGING_ONLY_VARS.includes(k));
  if (set(Object.keys(pv)) !== set(wantKeys))
    problems.push(
      `${P}: vars keys must be staging's without ${STAGING_ONLY_VARS.join(", ")}: ${set(wantKeys)}`,
    );
  for (const k of SAME_AS_STAGING_VARS)
    if (k in sv && pv[k] !== sv[k])
      problems.push(`${P}: var ${k} must be staging's (${JSON.stringify(sv[k])})`);
  for (const [k, v] of Object.entries(wantVars))
    if (pv[k] !== v) problems.push(`${P}: var ${k} must be ${JSON.stringify(v)}`);
  if ("TURNSTILE_SITE_KEY" in pv) {
    const key = pv.TURNSTILE_SITE_KEY;
    if (
      typeof key !== "string" ||
      (key !== "" && (key === sv.TURNSTILE_SITE_KEY || TURNSTILE_TEST_KEY.test(key)))
    )
      problems.push(
        `${P}: TURNSTILE_SITE_KEY must be empty or the production widget's key (never staging's or a test key)`,
      );
  }
  if ("TURNSTILE_HOSTNAMES" in pv)
    for (const h of String(pv.TURNSTILE_HOSTNAMES).split(","))
      if (!/^([a-z0-9-]+\.)?techaust\.com$/.test(h.trim()))
        problems.push(`${P}: TURNSTILE_HOSTNAMES may name only techaust.com hosts (${h.trim()})`);

  const text = JSON.stringify(prod);
  const stagingIds = (s.d1_databases ?? []).map((d) => d.database_id).filter(Boolean);
  for (const [bad, why] of [
    ["staging", "a staging name"],
    ["workers.dev", "a workers.dev host"],
    ["localhost", "localhost"],
    ["http://", "an http:// URL"],
    ...stagingIds.map((id) => [id, "staging's database id"]),
  ])
    if (text.includes(bad)) problems.push(`${P}: must not name ${why} (${bad})`);
  return problems;
}

/** A copy of `list` sorted by `key` (bindings compare as sets). */
const sortBy = (list, key) => [...list].sort((a, b) => String(a?.[key]).localeCompare(String(b?.[key])));

/**
 * P7-A: no `routes` or `route` (custom domains included) in any scope of any config. `routes` is inherited by environments, so the top level counts too.
 * The lead attaches techaust.com, admin., portal. and hooks. by hand: a deploy from CI must never take a hostname from the old Worker. Empty = passes.
 */
export function routesProblems(configs) {
  const problems = [];
  for (const [label, cfg] of configs) {
    const scopes = [["(top level)", cfg], ...Object.entries(cfg.env ?? {}).map(([n, c]) => [`env.${n}`, c])];
    for (const [scope, c] of scopes)
      for (const key of ["routes", "route"])
        if (c?.[key] !== undefined)
          problems.push(
            `${label} ${scope}: no ${key} (custom domains are attached by hand, never by a deploy)`,
          );
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
  for (const p of jobsDataProtectionProblems(read("jobs/wrangler.jsonc"))) {
    console.error(`apps/jobs/wrangler.jsonc: ${p}`);
    failed = true;
  }
  for (const p of leadPurgeModeProblems([
    ...APPS.map((a) => [`apps/${a}/wrangler.jsonc`, read(`${a}/wrangler.jsonc`)]),
    ...ADMIN_AUX_CONFIGS.map((f) => [`apps/admin/${f}`, read(`admin/${f}`)]),
  ])) {
    console.error(p);
    failed = true;
  }
  for (const p of rateLimitProblems(
    [
      ["apps/admin/wrangler.jsonc", front, RATE_LIMITS.admin],
      ["apps/portal/wrangler.jsonc", read("portal/wrangler.jsonc"), RATE_LIMITS.portal],
      ["apps/web/wrangler.jsonc", read("web/wrangler.jsonc"), RATE_LIMITS.web],
    ],
    [],
    ADMIN_AUX_CONFIGS.map((f) => [`apps/admin/${f}`, aux[f]]),
  )) {
    console.error(p);
    failed = true;
  }
  // P7-A: production mirrors staging in every config, and no config carries routes or custom domains.
  for (const [label, file] of WORKER_CONFIGS) {
    for (const p of productionMirrorProblems(read(file), PRODUCTION_VARS[label])) {
      console.error(`apps/${file}: ${p}`);
      failed = true;
    }
  }
  for (const p of routesProblems(WORKER_CONFIGS.map(([, file]) => [`apps/${file}`, read(file)]))) {
    console.error(p);
    failed = true;
  }
  for (const p of jobsBuildProblems(read("jobs/wrangler.jsonc"))) {
    console.error(`apps/jobs: ${p}`);
    failed = true;
  }
  for (const p of notificationConfigProblems(read("jobs/wrangler.jsonc"), [
    ["admin", front],
    ["admin api", api],
    ["admin finance", finance],
    ["admin invoices", invoices],
    ["portal", read("portal/wrangler.jsonc")],
    ["web", read("web/wrangler.jsonc")],
  ])) {
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
    "worker config guard: ok (preview_urls is false everywhere; the admin API, finance and invoices Workers have no public URL; the entrypoint bindings point at their Workers; production mirrors staging with the production resources; no routes or custom domains; traces on staging only; jobs minified with source maps; the front's, the portal's and the website's rate limits in every scope)",
  );
}
