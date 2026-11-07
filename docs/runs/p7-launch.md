# P7 launch: production wiring for the launch on 2026-11-08

Status: briefs written (lead, 2026-11-07 evening). Tasks P7-A (configs and guards), P7-B (deploy workflow and checks) and P7-C (jobs address, production CLIs) run in parallel. **P7-C: done, report below** (cloud session, 2026-11-07; branch `fix/p7-c-address-cli`, not merged); one item for the lead: the readiness check must read the address from core (P7-C report, "For the lead" 1).

## Why and what (read first)
- **The owner's decision (13, 2026-11-07):** production launches on Sunday 2026-11-08. techaust.com switches at the first production deploy, and the old Worker `techaust-web` is deleted at that moment, on the owner's explicit go (the lead does it, not code). The owner then tests everything on production. Payments stay on test keys (`PAYMENTS_LIVE_ALLOWED` stays `"false"` everywhere).
- **The full plan** is [phase7-production](phase7-production.md) (on PR #192 until it merges; its content is summarised here). For tomorrow only the "before the first deploy" items below are built. The nightly backup automation (N8), AU45, Rebuild PDF, the gateway environment marks and the LUT tidy follow after launch.
- **The task branch** is `feat/p7-production`, cut from `origin/fix/audit-m6-m7` (fbb5d41a, which holds main plus M7.4, M7.5 and the audit; #190 is merging). Each agent works in its own worktree on its own branch from `origin/feat/p7-production` and pushes only that branch. The lead merges.
- **Hosted changes are the lead's.** No agent touches Cloudflare, AWS, GitHub settings, secrets or DNS. Never deploy.

## Production resources (created by the lead, 2026-11-07, through the Cloudflare connector)
| Kind | Name | Id |
|---|---|---|
| D1 | `techaust-prod` (APAC) | `d16029d2-373e-4b66-beb0-d77158d6dfc2` |
| R2 | `techaust-prod-docs`, `techaust-prod-files` (private) | — |
| Queues | `techaust-prod-leads`, `techaust-prod-pdf`, `techaust-prod-email`, each with its `-dlq` | — |

Workers: `techaust-platform-{web,admin,admin-api,admin-invoices,admin-finance,portal,jobs}`. Rate-limit ids: web `RL_FORMS` 4301; admin 5301–5303 and portal 6301–6304 (already in config).

Production hosts:
- web `https://techaust.com/`
- admin `https://admin.techaust.com/`
- portal `https://portal.techaust.com/`
- jobs `https://hooks.techaust.com/`

Email assets come from `https://techaust.com/brand/…` (as staging's web host).

Turnstile production site keys come from the owner today. Until the lead fills them in, leave the value as the empty string. The readiness check must fail on an empty production key, which already happens.

**Access:** production admin is behind Cloudflare Access, with a bypass for `admin.techaust.com/api/health` only. Portal, hooks and web stay public. So the production health check reads admin only through `/api/health`, not the bound 401 routes.

## Rules for every agent
- Load every skill that fits first (docs/14 §9; at least `cloudflare:workers-best-practices` and `cloudflare:wrangler`). If you run a skill that has an effort level, set it to high.
- Tests and checks go through `bash tools/heavy.sh --log <name> …`, one package suite at a time.
- Commit at least every 20 minutes and at each finished layer; push your branch.
- Stop every dev server you started.
- Append your report to this file (what changed, the tests run with their counts, anything not done).
- Never guess: stop and report if blocked.
- Use workerd-accepted `fetch` options only.
- The repo is public: no secret values anywhere.

## P7-A: production configs and their guards (builder, Tier B, local)
Files:
- the seven `apps/*/wrangler*.jsonc`;
- `scripts/check-worker-config.mjs`;
- `apps/web/test/worker-config.test.ts`, `apps/web/test/signin-config.test.ts` and any test pinned to the "until Phase 7" production shape.

1. **Fill every `env.production` block so it mirrors `env.staging`** binding for binding, naming the production resources above:
   - D1 `DB` (`techaust-prod` and its id, with `migrations_dir` where staging has it);
   - R2 `DOCS` and `FILES`;
   - every queue producer and consumer, with staging's settings and dead-letter queues;
   - the service bindings and entrypoints (`ADMIN_API`, `ADMIN_INVOICES`, `ADMIN_FINANCE`, `ADMIN_JOBS`, `ADMIN_GATEWAY`, `ADMIN_ADVANCE`, `ADMIN_PAY`, … exactly as staging, pointing at the production Worker names);
   - `browser`; the crons (`0 22 * * *`, `30 * * * *`); `ratelimits` (web `RL_FORMS` 4301);
   - `secrets.required` (staging's names);
   - vars, with production values: `ENVIRONMENT=production`, the production URLs above, `GATEWAY_TRANSPORT=api`, `EMAIL_TRANSPORT=ses`, the SES region and configuration sets as staging, `LEAD_ALERT_TO=admin@techaust.com`, `PDF_RENDERER`/`PDF_MIN_SPACING_MS` as staging, `PORTAL_ORIGIN`/`WEBSITE_ORIGIN`, `TURNSTILE_HOSTNAMES` (production hosts only, never localhost), `TURNSTILE_SITE_KEY` `""`, `PAYMENTS_LIVE_ALLOWED` `"false"`.
   - Leave out `EMAIL_ALLOWED_RECIPIENTS`: the allow-list applies only on staging.
   - Production keeps **no traces and no invocation logs** (the existing production observability rule). `workers_dev: false` and `preview_urls: false`.
2. **No `routes` and no `custom_domain` entry in any production config.** The lead attaches domains by hand: a wrangler deploy in CI would take techaust.com from the old Worker without asking.
3. **`check-worker-config.mjs`:**
   - every "until Phase 7" production rule becomes "production equals staging's binding names, entrypoints, crons, `secrets.required` and vars keys, naming production resources";
   - add: no `techaust-staging*` name or staging `database_id` in production; no production `routes` or custom domains; `RL_FORMS` id unique; `PAYMENTS_LIVE_ALLOWED` `"false"` in every scope (already there).
   - Update the pinned tests.
4. **Generated types** stay `--env staging`; check that `pnpm typecheck` still passes.
5. **Done when:** `pnpm check`, plus the web, jobs, admin and portal tests that cover configs, are green; and a `wrangler deploy --dry-run --env production` of jobs and web succeeds (it needs no token).

## P7-B: the production deploy workflow and its checks (builder, Tier B, local)
Files:
- `.github/workflows/deploy-prod.yml`;
- `scripts/deploy-worker.mjs`, `scripts/place-build-artifact.mjs`;
- a production twin of `scripts/check-staging-build.mjs`;
- `scripts/prod-health.mjs` (new);
- `scripts/check-prod-readiness.mjs` and its tests;
- `apps/{admin,portal,web,jobs}/package.json` (`build:production`, `deploy:production*` mirroring the staging scripts);
- `apps/web/public/_headers` and the web build/dist checks;
- `scripts/turnstile-site-key.mjs`, `apps/web/src/lib/turnstile.ts`.

Do not edit any `wrangler*.jsonc` or `check-worker-config.mjs` (P7-A's).

1. **`deploy-prod.yml`, rebuilt on the shape of `deploy-staging.yml`:**
   - Keep the guard: actor `techaust`, `vars.PRODUCTION_ENABLED == 'true'`, the typed confirmation. Add an input `stage: database | full` (default `full`) and `check_web: true|false` (default `true`).
   - **build** job, with no Cloudflare token: install; build web (`CLOUDFLARE_ENV=production`), admin and portal (`CLOUDFLARE_ENV=production vite build`, plus the existing SPA header and worker-budget checks), and jobs; dry-run the web and jobs bundles; then run `check-prod-readiness.mjs`, which must now find every bundle. Upload the outputs.
   - **deploy** job, with `CF_API_TOKEN_PROD` from the GitHub environment `production`:
     1. Record the D1 Time Travel bookmark in the job summary (`wrangler d1 time-travel info DB --env production`).
     2. `wrangler d1 migrations apply DB --remote --env production`.
     3. On the first run, load the seed (`packages/db` seed SQL: catalogue and settings defaults, no sample data); it is insert-only and safe to re-run.
     4. With `stage: database`, stop here.
     5. Deploy in order: admin API → admin invoices → admin finance → admin front → portal → jobs → web, one step each.
     6. After each deploy, run `scripts/prod-health.mjs <app>`; web's only when `check_web` is true.
   - Actions are pinned by SHA (reuse the staging workflow's pins). The workflow stays fork-safe.
2. **`prod-health.mjs`:**
   - admin: `https://admin.techaust.com/api/health` (an Access bypass on that path);
   - portal: `https://portal.techaust.com/api/health`;
   - jobs: `https://hooks.techaust.com/healthz` (read the real health paths from the code);
   - web: `https://techaust.com/api/health`.
   - Each answer must be `200` JSON with `ok`, its own service and `env: "production"`. Retry briefly, because a new custom domain may take a minute.
3. **`deploy-worker.mjs`** allows the production deploys. The production twin of `check-staging-build` checks that a production bundle names the production Worker and carries no staging host or staging Turnstile key. `place-build-artifact.mjs` places the production outputs.
4. **`check-prod-readiness.mjs`:**
   - also scan the jobs production bundle for `[Placeholder`;
   - compare staging and production per Worker for D1, R2, browser, rate limits, crons, the `secrets.required` set and the vars key set (refuse a difference other than values);
   - read noindex from the built `dist/_headers`, not `public/_headers`.
   - Keep every existing check: founder bio, aliases, launch and effective dates, backup record, Turnstile keys.
5. **`noindex` only off production:** the `X-Robots-Tag: noindex` line goes into `dist/_headers` only when `CLOUDFLARE_ENV !== "production"`. The dist check asserts it is there on staging and absent on production.
6. **The Turnstile build guards** refuse an empty site key for production as they do for staging.
7. **Done when:** `pnpm check`, the web tests and the readiness tests are green; `actionlint` (if present) or a YAML parse passes; and a local production build of web, admin and portal plus the readiness script runs. Readiness may fail only on the owner's inputs and the backup record. Paste that list in your report.

## P7-C: the jobs postal address and the production CLIs (cloud session or builder, Tier A for the CLIs)
Files:
- `packages/core` (a new constant module);
- `apps/web/src/config/site.ts` (re-export only);
- `apps/jobs/src/portal-alerts.ts`;
- `packages/email/src/fixtures.ts` and snapshots;
- `scripts/create-invite.mjs`, `scripts/reset-2fa.mjs`, `scripts/portal-sample.mjs`, `scripts/portal-link.mjs`, and their tests.

1. **The postal address from one source:** move the value of `site.postalAddress` into `@techaust/core` (e.g. `src/company.ts`, `POSTAL_ADDRESS`), re-export it in `site.ts` so the website reads it unchanged, and pass it to `RULE9_BLOCK` in `apps/jobs/src/portal-alerts.ts` (line ~210, today `RULE9_BLOCK(null)`). Update the email fixture and snapshots (the `[Placeholder] postal address` text goes away). The words come from 07-A §8, unchanged.
2. **`--production` for `create-invite.mjs` and `reset-2fa.mjs`:**
   - it uses the operator's own `wrangler login` and `--env production` (never CI);
   - it needs a typed confirmation `PRODUCTION`;
   - the invite origin is `https://admin.techaust.com`.
   - `portal-sample.mjs` and `portal-link.mjs` keep refusing production (add a test).
3. **Done when:** the core, email, jobs and scripts tests are green and `pnpm check` passes.

## P7-A report
Builder P7-A (Opus 5.5, high), branch `fix/p7-a-config` from `origin/feat/p7-production` (78188975). Commits: 3802dfac (configs), 846bc5f1 (guard and tests), cc8248b7 (production Turnstile site keys), plus this report.

**Skills loaded:** `cloudflare:workers-best-practices` (kept production observability as the existing rule: logs on, no invocation logs, no traces; generated types untouched); `cloudflare:wrangler` (checked inheritance: `vars`, bindings and `secrets` are not inherited, `triggers` and `routes` are, so every production scope lists its own and the guard refuses `routes`/`route` at the top level too; validated with `wrangler deploy --dry-run --env production`).

**What changed, per file**
- `apps/jobs/wrangler.jsonc` env.production: D1 `DB` = `techaust-prod` / `d16029d2-…` with `migrations_dir`; R2 `DOCS`/`FILES` = `techaust-prod-docs`/`-files`; producers `EMAIL_QUEUE`/`LEADS_QUEUE`/`PDF_QUEUE` and the six consumers (pdf, leads, email and their `-dlq`) with staging's batch, concurrency, retries and dead-letter queues; `ADMIN_JOBS` (invoices `BillingJobs`), `ADMIN_GATEWAY` (finance `GatewayEvents`), `ADMIN_ADVANCE` (invoices `GatewayAdvance`) on the production Worker names; `browser`; crons `0 22 * * *`, `30 * * * *`; staging's nine `secrets.required` (incl. `CF_ANALYTICS_TOKEN`); vars `ENVIRONMENT=production`, `PAYMENTS_LIVE_ALLOWED="false"`, `EMAIL_TRANSPORT=ses`, `LEAD_ALERT_TO=admin@techaust.com`, SES region and both configuration sets, `ADMIN_URL`/`PORTAL_URL`/`PUBLIC_HOOKS_URL`/`EMAIL_ASSET_BASE` on the production hosts, `PDF_RENDERER=browser`, `PDF_MIN_SPACING_MS=10000`, `CF_ACCOUNT_TAG` (staging's account tag). No `EMAIL_ALLOWED_RECIPIENTS` (src/email.ts applies the list only when `ENVIRONMENT` is staging; wrangler's dry run prints a warning that this top-level var is missing in production: expected).
- `apps/admin/wrangler.jsonc` (front): production queues, R2, D1 added (services, rate limits 5301–5303 and secrets were already there); `TURNSTILE_SITE_KEY` = `0x4AAAAAAF3fIdhlCqOre8yu` (lead's message).
- `apps/admin/wrangler.api.jsonc`, `wrangler.invoices.jsonc`: production queues, R2, D1 (the front's).
- `apps/admin/wrangler.finance.jsonc`: production vars `PORTAL_URL=https://portal.techaust.com/`, `GATEWAY_TRANSPORT=api`; the five gateway secret names; queues incl. `LEADS_QUEUE` → `techaust-prod-leads`; `ADMIN_ADVANCE` → `techaust-platform-admin-invoices#GatewayAdvance`; R2; D1.
- `apps/portal/wrangler.jsonc`: production `ADMIN_PAY` → `techaust-platform-admin-finance#PortalPayments`, queues, R2 `DOCS`/`FILES`, D1; `TURNSTILE_SITE_KEY` = `0x4AAAAAAF3fIdhlCqOre8yu`.
- `apps/web/wrangler.jsonc`: production `LEADS_QUEUE` → `techaust-prod-leads`, `RL_FORMS` 4301, secrets `TURNSTILE_SECRET`, `FORMS_IP_PEPPER`; `TURNSTILE_SITE_KEY` = `0x4AAAAAAF3fDpktArFGL6Mv`. Web has no `PAYMENTS_LIVE_ALLOWED` in any scope (never had; no payment code), so none was added.
- Every config: `workers_dev: false`, `preview_urls: false`, no `routes`/`route`; `TURNSTILE_HOSTNAMES` only `techaust.com`, `admin.techaust.com`, `portal.techaust.com`; the stale "until Phase 7" comments rewritten.
- `scripts/check-worker-config.mjs`:
  - new `productionMirrorProblems(config, wantVars)` for all seven configs (`WORKER_CONFIGS`): production name = staging's without `-staging`; D1 (`PRODUCTION_D1`), R2 and producers (`techaust-staging-` → `techaust-prod-`), consumers with staging's settings, services with staging's entrypoints on the production Workers, `browser`, `triggers`, rate-limit names and limits, `secrets.required` set, vars key set minus `STAGING_ONLY_VARS` (`EMAIL_ALLOWED_RECIPIENTS`), `SAME_AS_STAGING_VARS` values, the production hosts per config (`PRODUCTION_VARS`, `PRODUCTION_ORIGINS`); refuses `staging`, staging's database id, `workers.dev`, `localhost` and `http://` anywhere in production; Turnstile key never empty, staging's or a test key; hostnames only techaust.com hosts;
  - new `routesProblems`: no `routes`/`route` in any scope of any config;
  - every "until Phase 7" rule now requires the production twin (`apiConfigProblems` services/secrets, `entrypointBindingProblems`, `gatewayConfigProblems` incl. `GATEWAY_TRANSPORT=api`, `PORTAL_URL` and finance's `LEADS_QUEUE`, `jobsConfigProblems` crons and `ADMIN_JOBS` (each environment must state its own `triggers`), `notificationConfigProblems` (`PUBLIC_HOOKS_URL` = `https://hooks.techaust.com/`, query string redacted), `jobsDataProtectionProblems`/`portalFilesProblems` (`techaust-prod-files`));
  - `RATE_LIMITS.web = { RL_FORMS: 2 }`: web's ids checked like admin's and portal's (unique across every scope and config);
  - `canonical` now compares nested arrays key-order-free.
- `scripts/check-worker-config.d.mts`: `RATE_LIMITS.web`.
- Tests: `apps/web/test/worker-config.test.ts` (pinned production cases rewritten; new block "P7-A" with 10 tests: all seven real configs pass, no staging resource, the jobs production shape, missing/extra bindings, staging Worker or other entrypoint, staging/workers.dev/localhost/http values and staging-equal vars, Turnstile key and hosts, name and workers_dev, RL_FORMS 4301 and id uniqueness, routes in any scope); `apps/web/test/signin-config.test.ts` (production key and host, production email queue and consumer, `siteKeyForApp(…, "production")` = the production sign-in key); `packages/core/test/rate-limit-config.test.ts` (web in the required set).

**Commands and results**
- `node scripts/check-worker-config.mjs`: ok.
- `pnpm --filter @techaust/web exec vitest run` on worker-config, signin-config, observability-config, admin-portal-origin, portal-website-origin, forms-m24, staging-checks, prod-readiness-apps: 203 passed, 3 skipped, **3 failed, all in `apps/web/test/prod-readiness-apps.test.ts` (P7-B's file, not edited)**: "today's configs: production is blocked on the three site keys and on the queues (before Phase 7)", "today's configs: … blocked on their service bindings (before Phase 7)", and "checkProdReadiness includes the apps' problems" (expects "TURNSTILE_SITE_KEY is empty"). They pin the pre-launch gaps this task closes; `checkProductionConfigs` now reports **nothing** for the configs (before the keys: only the three empty keys). P7-B or the lead updates those three tests at integration.
- web: staging-checks, place-build-artifact, deploy-workflow: 95 passed, 1 skipped.
- core: rate-limit-config, verify-tags: all passed (5 + 3).
- jobs: `test/route-inventory.test.ts` (heavy queue): 4 passed.
- `wrangler deploy --dry-run --env production` (heavy queue, no token): **jobs** exit 0, 850.69 KiB / gzip 317.08 KiB, bindings listed as above (3 queues, D1 techaust-prod, 2 R2, 3 entrypoint services, Browser Run, 14 vars); one expected warning (`EMAIL_ALLOWED_RECIPIENTS` not in production). **web** (after `CLOUDFLARE_ENV=production astro build`; dist removed afterwards) exit 0, 295.64 KiB / gzip 66.26 KiB: `LEADS_QUEUE (techaust-prod-leads)`, `RL_FORMS`, 4 vars.
- `pnpm check` (heavy queue, the one whole-repo lint): exit 0 (lint, typecheck with types still `--env staging`, web bindings guard, content lint, worker config guard, SPA headers, migration guard, CSS collisions).

**Not done or not verified**
- No admin or portal production dry run or production SPA build (P7-B's builds).
- Hosted resources were not checked: the queue names, bucket names and D1 id are taken from this brief's table. Before the first deploy the lead sets every production secret (`wrangler secret put … --env production`): jobs nine (incl. `CF_ANALYTICS_TOKEN`; a missing required secret aborts the deploy), admin front five, admin API `ERASURE_HASH_KEY` (same value as jobs'), finance five gateway keys (test keys), portal two, web two.
- SES: production has no allow-list, so real clients get email from the first deploy; if the SES account is still in the sandbox, sends to unverified addresses fail (not checkable from here).

**Open questions:** none.

## The lead's own items (not for agents)
- the redirects (`apps/web/public/_redirects`, Q3);
- the secret scripts' `-Environment production`;
- the launch content (`site.launchDate` and every legal `effective` set to 2026-11-08, `founderBio`, `aliasesConfirmed`);
- the production Turnstile keys in the configs;
- the integration, the reviewer, the merge, then the hosted steps and the launch-day order in [phase7-production](phase7-production.md) D.

## Hosted log (lead, 2026-11-07 evening; owner's decisions in chat)
- **Production resources** created through the connector: D1 `techaust-prod` (`d16029d2-373e-4b66-beb0-d77158d6dfc2`, APAC); R2 `techaust-prod-docs` and `techaust-prod-files` (private); queues `techaust-prod-{leads,pdf,email}` and their `-dlq`.
- **The old site deleted now** (owner, "Now": a fresh start before the new deployment; techaust.com is offline until launch):
  - the custom domains techaust.com and www.techaust.com detached from `techaust-web`;
  - the route `*.techaust.com/*` deleted;
  - the Worker `techaust-web` deleted (with its assets, its `RESEND_API_KEY` secret and its workers.dev address).

  Its custom-domain records (the apex and www `AAAA 100::`) went with the domains. The old repository `techaust/techaust-web` is untouched (rule 3).
- **The zone's redirect rules** deleted and recreated as the same two (owner, "Delete and recreate"): www → apex, http → https, both 301. A proxied `AAAA www.techaust.com 100::` was recreated for the www redirect.
- **Left for the owner:** delete the unused user API token "Workers Builds - 2026-09-04 12:28" (the connector can't manage user tokens). Optional: revoke the old site's Resend API key in Resend.
- **Kept:** the email DNS (Zoho, the SES DKIM and MAIL FROM records), Web Analytics for techaust.com (the new CSP allows its script, and the privacy notice names Cloudflare's cookieless analytics), and the Turnstile widgets of the owner's other domains (GPLFamily, PluginWay).
- **GitHub environment `production`** (lead, through `gh api`): required reviewer `techaust`; deployment refs branch `main` and tags `v*`.
- **Access for production admin** (connector, Q2):
  - the app `techaust-platform-admin (production)` on `admin.techaust.com` uses the reusable "Cloudflare account members" policy;
  - the app `admin production health` uses "Bypass everyone", on `admin.techaust.com/api/v1/health`. The path was corrected from `/api/health` after P7-B found the admin's health route; it was checked in Cloudflare.

  Portal, hooks and web stay public.
- **DNS list:** the owner said yes (2026-11-07); the records are added at the step each belongs to.
- **Production secrets** (owner, `scripts/set-prod-secrets.ps1`, two runs, 2026-11-07): all 24 stored. Names checked by the lead: web 2, admin front 5, admin API 1, finance 5, portal 2, jobs 9; the three webhook secrets are random placeholders until launch day. `CF_API_TOKEN_PROD` is stored in the GitHub environment `production`.

## P7-B report
Builder P7-B, branch `fix/p7-b-deploy` (from `origin/feat/p7-production`, with P7-A's 14910a09 merged in). Commits e5b0f742, 22e8e8a5, e7534db1, a3643d2b (merge), 15291b69, plus this report. Pushed. No deploy, no hosted change, no secret value.

**Skills:**
- `cloudflare:workers-best-practices`: kept the health check's `fetch` options workerd-safe (`redirect: "manual"`). Production observability is left to P7-A's configs.
- `cloudflare:wrangler`: checked `wrangler d1 time-travel info <db> --env` against the wrangler 4.156.2 help. Checked which keys are non-inheritable (bindings, vars, secrets) in the Cloudflare docs through Context7. `triggers` is inherited, so the crons comparison falls back to the top level when a scope has none.
- No other docs/14 §9 skill fits: no screens, no review.

**Act on this first (lead, hosted): the admin's health path is `/api/v1/health`, not `/api/health`.**
- In the code, the admin front (`apps/admin/worker/routes-front.ts`) and the portal (`apps/portal/worker/index.ts`) answer only `GET /api/v1/health`. `/api/health` belongs to the website (`apps/web/src/worker.ts`), and `/healthz` to jobs.
- The Access app "admin production health" covers `admin.techaust.com/api/health` (Hosted log). That path does not include `/api/v1/health`, so the admin health check after deploy 4 would hit Access and stop the run.
- Fix: change that app's path to `admin.techaust.com/api/v1/health`. The brief said to read the real paths from the code. I did not touch Access.

### What changed, per file
- **`.github/workflows/deploy-prod.yml`**, rebuilt on the shape of deploy-staging:
  - **Inputs:** `tag` (default `main`), `confirm`, `stage: full|database` (default full), `check_web` (default true). The guard accepts only `main` or a `v*` tag, the same refs the `production` environment allows.
  - **`guard`:** owner only, `PRODUCTION_ENABLED`, the typed confirmation, the ref check.
  - **`build`** (no environment, no secret, no cache):
    - writes the seed SQL;
    - runs `build:production` for admin, portal and web;
    - dry-runs the jobs and web bundles into `dist-production` / `.wrangler/dist-production`;
    - runs `check-prod-build.mjs dev-vars`;
    - runs the readiness check on stage full only;
    - uploads the artifact `production-build`.
  - **`deploy`** (`environment: production`, installs only wrangler):
    - downloads the artifact to `$RUNNER_TEMP` and runs `place-build-artifact.mjs production`;
    - runs `deploy-worker.mjs production --check`, with no secret;
    - checks the credentials;
    - writes the Time Travel bookmark into the job summary;
    - applies the migrations (`d1 migrations apply`);
    - loads the seed (`d1 execute --file`, insert-only, on every run);
    - on stage full only: the 7 deploys in order (admin API, invoices, finance, front, portal, jobs, web), with a `prod-health.mjs` step after the front, the portal, jobs and the website (the website's only when `check_web` is true).
  - **Safety:** the token is `secrets.CF_API_TOKEN_PROD` and appears only in the deploy job. Actions are pinned by the same SHAs as the staging workflow. The trigger is workflow_dispatch only, so it stays fork-safe. The YAML parses strictly with the `yaml` package; actionlint is not installed here.
- **`scripts/check-prod-build.mjs`** (new), the production twin of `check-staging-build.mjs`:
  - a flattened config must name `env.production.name` **and** say `targetEnvironment: "production"` and `ENVIRONMENT: "production"`. A plain `vite build` also names the production Worker, so the name alone proves nothing;
  - no built text file may carry a staging host, a `techaust-staging*` name or a staging Turnstile key (source maps are skipped);
  - the pages and the SPA sign-in bundles must carry `env.production`'s key, not the top-level test key;
  - `dev-vars` also covers the `dist-production` bundles;
  - the trace pattern is bounded (`{1,63}`). Unbounded, it took minutes on the admin's browser files.
- **`scripts/prod-health.mjs`** (new):
  - hosts `https://techaust.com`, `admin.`, `portal.` and `hooks.techaust.com`;
  - checks: admin `/api/v1/health` only; portal `/api/v1/health`; jobs `/healthz` plus staging's public webhook checks (`/razorpay`, `/stripe`, `/paypal` → 400 `signature_missing`, `/ses` → 401 `token_missing`); web `/api/health`;
  - each answer must be `200` JSON with `ok`, its own service and `env: "production"`;
  - sends no Access token; retries for about 110 s (`0, 5, 10, 15, 20, 30, 30` s).
- **`scripts/staging-health.mjs`:** `judge` takes the expected `env`; `checkApp` takes `checks`, `base` and `env`. The defaults are unchanged, so staging behaves as before.
- **`scripts/deploy-worker.mjs`:**
  - `PRODUCTION_DEPLOYS`: the SPAs as on staging; jobs and web with `--env production --no-bundle` from `dist-production`;
  - `SCOPES` and `DEPLOY_ORDER`; `configProblems` and `preDeployProblems` take the scope (the L51 checks are unchanged);
  - CLI: `staging|production <target>`, and `production --check`.
- **`scripts/place-build-artifact.mjs`:** the production placements are staging's set with the `dist-production` bundles, each at its own path.
- **`scripts/check-prod-readiness.mjs`:**
  - scans jobs' `dist-production` and the website's pre-bundled Worker; a missing bundle is a problem;
  - `checkEnvParity` per Worker. It compares:
    - D1: same bindings, never staging's database, same `migrations_dir`;
    - R2 and browser bindings;
    - rate limits: same names and limits, each with its own namespace id;
    - crons, with inheritance;
    - the `secrets.required` set;
    - the vars key set. `EMAIL_ALLOWED_RECIPIENTS` is staging-only and refused in production;
    - no staging, workers.dev or localhost value or resource name in production;
  - reads noindex from `dist/_headers`;
  - no longer counts a copy gate's own body (`[Placeholder] ${`): jobs' bundler keeps the unreachable branch of the approved 07-ZJ email gate. In its place, `checkApprovalFlags` fails any `export const APPROVED_… = false` in the packages and apps sources. All 18 flags are true today;
  - every existing check is kept.
- **noindex:**
  - `apps/web/public/_headers` no longer has an X-Robots-Tag line;
  - `scripts/web-noindex.mjs` (new) and the `techaust:noindex-off-production` integration in `apps/web/astro.config.mjs` add it to `dist/_headers` on every build except `CLOUDFLARE_ENV=production`;
  - `checkBuiltHeaders` in `scripts/web-dist-checks.mjs` wants it on staging and local builds and absent on production. The build scripts now pass `CLOUDFLARE_ENV` to `check-web-dist.mjs`;
  - comments in `src/lib/search-files.ts` and `src/pages/index.astro` updated.
- **Turnstile:** `scripts/turnstile-site-key.mjs` and `apps/web/src/lib/turnstile.ts` refuse an empty production key, as they already did for staging.
- **Package scripts:**
  - admin: `build:production` (with the SPA header check and the four budget checks) and `deploy:production:{api,finance,invoices,front}`;
  - portal: `build:production` and `deploy:production`;
  - web: `build:production` and `deploy:production`;
  - jobs: `deploy:production`;
  - `.gitignore`: `dist-production/`.
- **Tests:**
  - new: `apps/web/test/prod-deploy.test.ts`;
  - `deploy-workflow.test.ts`, `place-build-artifact.test.ts`, `forms-m24.test.ts`: updated for the production workflow, placements and key guard;
  - `prod-readiness-apps.test.ts`: the "before Phase 7" pins are replaced. Today's configs give no problem and differ from staging only in values, and a hand-mirrored staging scope passes;
  - `dist-checks.test.ts`: the real-build test takes its environment from the built robots.txt;
  - `signin-config.test.ts`: merge conflict with P7-A resolved, keeping P7-A's production key line and my empty-key case;
  - `research-guards.test.ts`: 20 s timeout, because readiness now reads every source file for the flags.

### Commands and results
- **`pnpm --filter @techaust/web test`** (heavy): 45 files, 1077 passed, 20 skipped, 0 failed (`.logs/p7b-web-test4.log`). An earlier run failed only on a stale local production `dist` (the robots test) and on the 5 s timeout fixed above.
- **`pnpm check`** (heavy): exit 0. That covers lint, typecheck, and the binding, content, worker-config, SPA header, migration and CSS guards.
- **Local production build** (heavy, `.logs/p7b-prod-build2.log`), on the merged P7-A configs with their real production keys:
  - every `build:production` step passed for admin, portal and web;
  - Worker budgets in bytes: admin 121,871, admin API 560,633, finance 435,938, invoices 567,389, portal 163,583;
  - `check-web-dist: ok`, with no noindex and the production robots.txt;
  - jobs and web dry runs: 850.69 KiB and 295.64 KiB;
  - `check-prod-build.mjs` ok for dev-vars and all 7 targets;
  - `node scripts/deploy-worker.mjs production --check` ok;
  - `checkProductionConfigs`: 0 problems.
- **Readiness** (`node scripts/check-prod-readiness.mjs`). The 7 remaining failures, verbatim:
  - The owner must supply the founder's bio (site.founderBio): it is empty.
  - The owner must confirm that the security@ and privacy@ aliases deliver (U-5), then set site.aliasesConfirmed to true.
  - The launch date is not set: the lead sets site.launchDate and every legal page's `effective` date (apps/web/src/content/legal.ts) to the launch day, together, before production.
  - about.html: still shows a Placeholder (an owner input is missing); supply it, then rebuild.
  - No verified backup is recorded (verifiedOn is empty or not a real date): the "encrypted, off-site backups" claim is not true yet. Set scripts/backup-verified.json to {"verifiedOn": "YYYY-MM-DD", "restoreDrill": true} in the commit that closes Phase 7 L7 (backups on, first backup restored on the production data).
  - jobs dist-production/index.js: still shows copy marked "[Placeholder" ("[Placeholder] postal address"}.`),"RULE9_BLOCK"),IT={consent_withdrawa…"): the owner approves the page (07-W/07-X), then the lead sets APPROVED_07X and rebuilds.
  - admin techaust_platform_admin_api/index.js: still shows copy marked "[Placeholder" ("[Placeholder] postal address.`}}}var PA={code:`annual_return_future`,m…"): the owner approves the page (07-W/07-X), then the lead sets APPROVED_07X and rebuilds.

  The first five are the owner's inputs, the lead's launch content and the backup record. The about.html Placeholder is the founder bio. The last two belong to P7-C: `RULE9_BLOCK(null)` in `apps/jobs/src/portal-alerts.ts`, and the `request.received` sample in `packages/email/src/fixtures.ts`, which is bundled into the admin API. Both go away once the postal address comes from `@techaust/core`.
- **Clean-up:** the local builds were removed afterwards. No dev server was started.

### Not verified
- The workflow has not run (no deploy, by rule). actionlint is not available, so only a YAML parse was done.
- `wrangler d1 time-travel info`, the migrations and the seed against the real production D1 (they need the token).
- The production health checks against the live hosts.

### Notes and open questions
- **Website domain:** the old site is already deleted (owner, tonight), so the website deploy has no domain conflict. Still, no config holds `routes` or a custom domain (P7-A's guard enforces this); the lead attaches `techaust.com` by hand. Run the launch with `check_web=false` until it is attached, then run `prod-health.mjs web` or re-run the workflow.
- **Stage database:** it runs the build, so it needs the production Turnstile keys (now set), but it skips the readiness check. It deploys no Worker and no page, and it comes before the backup that the check waits for (phase7-production finding 4).
- **Left out because the brief leaves them out** (they are in phase7-production A1.3 and A1.4): "the run's IST day equals `site.launchDate`" and "staging has deployed that SHA". The guard does enforce running from `main` or a `v*` tag.
- **Catalogue on production (not in the brief):** the production website is built from the seed catalogue. Once the owner publishes the catalogue on production, a later production deploy would still build from the seed. Fixing that needs a production version of the published-snapshot fetch (it needs the token, so a token job before the build, like staging's `prepare`) and a production twin of `publish-catalogue.yml`. The launch run is unaffected, because nothing is published yet. This is the owner's or the lead's decision.
- **Runbook:** `docs/runbooks/environments.md` does not describe the production workflow yet; it was not in my file list.
## P7-C report (cloud session lead, 2026-11-07)
Branch `fix/p7-c-address-cli` from `origin/feat/p7-production` (2 commits plus this report; pushed; no PR, the PC lead merges). No agent was started: `docs/runs/usage-reading.md` has no reading today, so nothing new starts (docs/14 §5); the session lead did the work. Skills: the `cloudflare:*` skills aren't available in a cloud session (no plugins load there); none of the session's skills fits a builder's task (`code-review` and `security-review` are the reviewer's), so none was loaded. Usage: lead only, Opus 5.5 at high; no agent runs.

**1. One postal address** (commit dab5c41)
- `packages/core/src/company.ts` (new, export map `@techaust/core/company`): `POSTAL_ADDRESS`, the exact value that was in `site.ts`. No imports, so Node can load it from `site.ts` (the web build proves it).
- `apps/web/src/config/site.ts`: `postalAddress: POSTAL_ADDRESS` (re-export; every reader of `site.postalAddress` is unchanged; the built contact, privacy, terms and refund pages print the address).
- `packages/core/src/copy-zr.ts`: `RULE9_BLOCK(postalAddress: string)`, the address now required. The `"[Placeholder] postal address"` fallback is gone, so it can't reach the jobs bundle. 07-A §8's words are unchanged, and a test pins them to the appendix line.
- `apps/jobs/src/portal-alerts.ts`: `RULE9_BLOCK(POSTAL_ADDRESS)` (was `RULE9_BLOCK(null)`).
- `packages/email/src/fixtures.ts`: `rule9: RULE9_BLOCK(POSTAL_ADDRESS)`. The snapshots `request-received.{txt,html}` are updated.
- Tests:
  - `packages/core/test/company.test.ts` (new, 4): the value's shape, 07-A §8 word for word, site.ts and jobs read the one source, no marked gap left;
  - `m74-b2.test.ts`: exact Rule 9 text;
  - `apps/jobs/test/m74-dp.test.ts`: the queued `request.received` carries the address and no `[Placeholder`.

**2. `--production` for the staff CLIs; the portal CLIs refuse it** (commit after dab5c41)
- `scripts/cli-target.mjs` (new, with `.d.mts`): one scope rule for `pnpm invite` and `pnpm admin:reset-2fa`.
  - `--staging` and `--production` together are refused.
  - Production runs only with the operator's own `wrangler login`. It is refused when `CI`, `GITHUB_ACTIONS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY` or `CF_API_TOKEN` is set: wrangler would use the token instead of the login.
  - It then asks for the typed word `PRODUCTION`, exact and in capitals. Any other answer, or stdin closing, prints "Stopped: you did not type PRODUCTION. Nothing was changed." and exits 1.
  - All of this happens **before any remote read or write**.
  - It targets `--remote --env production` (jobs' production `DB`, from P7-A) and prints links on `https://admin.techaust.com`. The local origin still follows `TECHAUST_PORT_OFFSET`.
- `create-invite.mjs`, `reset-2fa.mjs`: use the module. Every existing safety check is unchanged: the existing-account refusal, the only-owner break-glass, the audit read-back and the cut-short clean-up. `checkBreakGlass` suggests the rerun with the same flag (`--production` too).
- `portal-sample.mjs`, `portal-link.mjs`: `refuseProductionArgs` runs before option parsing. It refuses `--production`/`--prod` (any case, `=value`), `--env production`, `--env=production`, `-e prod` and `--remote`, with the reason "has no production mode". Before this, an unknown `--production` was only refused by `parseArgs` with no reason given.
- `tools/cloud-guard.mjs`: `--production` on these four scripts is refused in a cloud session, as `--staging` already was (`model-guard.test.ts`: 5 probes and 1 message check).
- Tests: `apps/web/test/staff-cli.test.ts` (new, 25):
  - the pure rules: scope, D1 target, origin, the refusal by environment, the exact word;
  - the prompt over in-memory streams;
  - the gate's order in both scripts (before the first `rows(`, `runFile(` or `d1([...--file`);
  - real child processes of all four scripts, in an environment with no login, home or token, so even a broken gate couldn't reach a remote database. Covered: CI refused before asking, a token refused, a wrong word or no answer stops, both flags refused, and the portal scripts refuse `--production`, `--env production` and `--remote` with empty stdout.
- Run by hand on the local database: `create-invite.mjs` (local) printed its link on `http://localhost:5173`; `reset-2fa.mjs` behaves the same before and after the change.

**3. Checks** (one at a time through `tools/heavy.sh`, logs in `.logs/p7c-*.log`)
| Run | Result |
|---|---|
| `pnpm --filter @techaust/core test` | 133 files, 2,717 tests passed; coverage statements 98.11 %, lines 98.5 % |
| `pnpm --filter @techaust/email test` | 17 files, 205 passed |
| `pnpm --filter @techaust/jobs test` | 52 files, 780 passed |
| `pnpm --filter @techaust/web build` | ok (astro, check-web-dist, wrangler dry run) |
| `pnpm --filter @techaust/web test` (after the build) | 45 files, 1,045 passed, 2 skipped |
| admin `worker/users.test.ts`, portal `worker/cli.test.ts` (they import the changed script modules) | 61 and 10 passed |
| `pnpm --filter @techaust/jobs build` | ok: 871,142 bytes, start-up 73.2 ms |
| `pnpm check` | ok (lint, typecheck, every guard) |

Session note: the cloud set-up installed before the branch switch, so `packages/auth` lacked its link to core and the first web build failed on `@techaust/core/body`. `pnpm install --frozen-lockfile --offline` fixed it, with no lockfile change.

**For the lead (not done: the files are P7-B's)**
1. **The readiness check now reports the postal address as missing.** `checkSiteConfig` in `scripts/check-prod-readiness.mjs` reads `postalAddress: "…"` from the text of site.ts (`readSiteString`), and site.ts now says `postalAddress: POSTAL_ADDRESS`. Proven: on this branch it returns "The owner must supply the postal address … it is empty." The fix, for whoever integrates P7-B:
   - read the value from `packages/core/src/company.ts` when site.ts re-exports it. In `checkProdReadiness`, pass `readFileSync(join(webDir, "..", "..", "packages", "core", "src", "company.ts"), "utf8")` to `checkSiteConfig(siteTs, companyTs)`.
   - in `checkSiteConfig`, for `postalAddress`, when `/\bpostalAddress:\s*POSTAL_ADDRESS\b/` matches site.ts, read `/\bPOSTAL_ADDRESS(?::\s*string)?\s*=\s*"([^"]*)"/` from that text. Otherwise keep `readSiteString`.
   - update the message to name `POSTAL_ADDRESS` in `packages/core/src/company.ts`;
   - add a test with both shapes, plus the real files (expect no postal problem).
2. **The jobs bundle still holds one `[Placeholder] ${e}`.** It is the 07-ZJ deed-email gate's template (`packages/email/src/deeds.ts`, `ZJ`, `APPROVED_07ZJ_EMAIL` true). esbuild keeps the dead branch (the bundle reads `_T=!0,cs=…_T?e:\`[Placeholder] ${e}\``). P7-B's new jobs-bundle scan for `[Placeholder` will flag it. The other gates (zo, zq, zr, zt) are tree-shaken from jobs today. Either the scan skips this gate template (`[Placeholder] ${` followed by an identifier), or the gate gets folded at build time. Your call when you integrate P7-B. The postal fallback is gone from the bundle (checked: `Pirozpur` once, no `[Placeholder] postal`).
3. Docs only the main session edits: CLAUDE.md's Commands block (`pnpm invite … --production`, `pnpm admin:reset-2fa … --production`) and docs/08 §3.2 (break-glass on production). On launch day the first production Owner is `pnpm invite --email <owner> --role owner --production`, run from the PC's own PowerShell after `wrangler login` and P7-A's production `DB` binding. It needs no `CLOUDFLARE_API_TOKEN` in that window.

## Review (reviewer, Opus 5.5 high, 2026-11-07): APPROVE
No critical or high finding.
- **M1:** the deploy job re-checked-out `inputs.tag`, so it could mix two commits. Fixed: the build records the commit it built, and the deploy checks out exactly that commit.
- **M2:** the Time Travel bookmark step could pass after a failed read. Fixed: `set -o pipefail`.
- **L3:** a `v*` branch, or a commit off main, passed the guard. Fixed: the build refuses a commit that isn't on main.
- **L5:** the Access path in the hosted log was wrong. Corrected above.
- **L6:** checked: 4 crons in the account (staging 2 plus production 2), within the Free plan's 5.
- **L8:** the secrets script took a failed list as "nothing set" on any "not found" message. Fixed: it now matches only `10007` or "If this is a new Worker".
- **Kept:**
  - **L4:** check the trailing-slash forms of the four redirects on launch day.
  - **L7:** the plan's D3 needs `PRODUCTION_ENABLED=true` already for `stage=database`. Applied on the day.
  - **L9:** the admin's bound Workers are proved by the owner's first sign-in and dashboard visit, not by the health check.

`deploy-workflow` and `prod-deploy` tests: 110 passed.
- Usage: reviewer agent-a382bb1a19b7a1935, claude-opus-5-5/high, skills `cloudflare:workers-best-practices`, `cloudflare:wrangler` (`code-review` and `security-review` were not run: they start helpers, and the 2-agent limit was full).
- Usage: builders P7-A agent-ae9750c8eb5cfc8ab and P7-B agent-ae5ba8ba1fa6812ce, claude-opus-5-5/high; P7-C was a cloud session.

## P7-N: nightly encrypted backups before launch (builder, Tier B; owner, 2026-11-07: "Nightly backups before launch")
Why: the privacy notice and /security promise "encrypted, off-site backups" kept on a rolling basis for up to 90 days, and `check-prod-readiness.mjs` blocks production until `scripts/backup-verified.json` records a restored backup.

**Lead's decisions (recorded in 13 at the end of the day):**
- **Encryption** is an OpenSSL envelope, not `age`: OpenSSL is on the runner and in Git for Windows, so the owner installs nothing.
  - A random 32-byte key encrypts the dump with `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt`.
  - The key is wrapped with the owner's RSA-4096 public key (`openssl pkeyutl -encrypt -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256`).
  - The public key is the repo variable `BACKUP_PUBLIC_KEY_PEM`. The private key never leaves the owner's offline folder.
- Tier B: no money, tax or deletion logic; a scheduled export and an upload.

**Files:**
- `.github/workflows/backup.yml`: rewrite or create it; keep any existing owner-only guard.
- `scripts/backup-encrypt.sh`: the envelope.
- `scripts/backup-decrypt.ps1`: the owner's local decrypt, prompting for the private key path; no secret is printed.
- `docs/runbooks/restore.md`: the backup and restore section.
- tests in `apps/web/test` (workflow shape, like `deploy-workflow.test.ts`).

1. **`backup.yml`**:
   - Triggers: `schedule` at 21:30 UTC (03:00 IST; jobs' 22:00 UTC cron runs after, and a remote export blocks D1), and `workflow_dispatch`, owner-only (actor `techaust`).
   - `permissions: { contents: read, id-token: write }`; `environment: backup`, which holds the secret `CF_API_TOKEN_BACKUP` (D1 only).
   - Steps:
     - check out; install wrangler only (as `deploy-prod.yml`'s deploy job does);
     - `wrangler d1 export DB --remote --env production --output "$RUNNER_TEMP/techaust-prod-<UTC date-time>.sql"`, from `apps/jobs`, with `CLOUDFLARE_API_TOKEN` from the secret;
     - fail if the file is empty;
     - encrypt with `scripts/backup-encrypt.sh`, giving one `.tar` holding `dump.sql.enc`, `key.bin.enc` and a `manifest.json` (UTC time, byte sizes, SHA-256 of the plaintext dump, the format version);
     - delete the plaintext at once;
     - `aws-actions/configure-aws-credentials`, pinned by SHA (pick the latest release at least a day old; pnpm's 1-day age rule applies in spirit), with `role-to-assume: ${{ vars.AWS_BACKUP_ROLE_ARN }}` and region `ap-south-1`;
     - `aws s3 cp` to `s3://${{ vars.BACKUP_BUCKET }}/daily/`;
     - confirm the object exists and its size matches, using `aws s3api list-objects-v2 --prefix` (the role has ListBucket on `daily/` only and no GetObject).
   - No plaintext and no key ever goes in an artifact or a log.
   - It fails clearly when a variable or secret is missing.
2. **`backup-decrypt.ps1`**: the owner runs it on their PC with the downloaded `.tar` and the path of `backup-private.pem`. It unwraps the key with `openssl pkeyutl -decrypt` (the OpenSSL from Git for Windows, found automatically), decrypts the dump, checks the SHA-256 against the manifest, and writes the `.sql` next to the archive. The output says "keep this file private, delete it after the drill".
3. **`docs/runbooks/restore.md`**:
   - **Backups**: where they are, 90-day expiry by the bucket's lifecycle rule, how to download one in the AWS console, how to decrypt it.
   - **Restore drill**:
     - create a scratch D1 `techaust-restore-<date>` (lead, connector);
     - `wrangler d1 execute techaust-restore-<date> --remote --file <sql>`;
     - `pnpm drill:verify` (read `scripts/drill-verify.mjs` and make the runbook match what it actually needs);
     - delete the scratch D1;
     - set `scripts/backup-verified.json`.
4. **Tests**:
   - the workflow shape: guard, permissions, the environment, SHA pins, no plaintext upload, the order (export → encrypt → delete plaintext → upload → verify);
   - a test of `backup-encrypt.sh` round-tripping a small file with a throwaway key pair generated in the test (it runs only where `openssl` exists; skip with a message otherwise).

**Done when:** the web tests and `pnpm check` are green. Append "## P7-N report" here and push `fix/p7-n-backup`.

## P7-N report (builder, Opus 5.5 high, 2026-11-07)
Branch `fix/p7-n-backup` (from `origin/feat/p7-production` at 8258b60c), pushed. Commits: 195de8ce (workflow and scripts), ccc469c2 (tests, decrypt hardening), a15b90a9 (runbook), and this report.

**Skills loaded:**
- `cloudflare:wrangler`: led me to read the installed wrangler 4.156.2 (`d1 export --help` and its source) rather than memory. That turned up `--skip-confirmation` (non-interactive runs fall back to "yes"; I made it explicit), the printed signed URL (finding 1) and that `d1 execute <name> --remote` finds a database not in the config by name (runbook §3.4).
- `cloudflare:workers-best-practices`: required by the run file. No Worker code changed, so it only confirmed that secrets reach steps as `env` and never sit in config.
- `aws-core:aws-iam`: shaped the role in the runbook: OIDC trust with `sub` exactly `repo:techaust/techaust_platform:environment:backup`, `s3:PutObject` on `daily/*`, `s3:ListBucket` with the `s3:prefix` condition, no Get or Delete.
- `aws-core:aws-storage`: shaped the bucket notes (Block Public Access, default encryption, the 90-day lifecycle on `daily/`) and the upload (no explicit SSE header, so the bucket default applies).

**Files changed:**
- `.github/workflows/backup.yml`, rewritten. What it does:
  - runs at 21:30 UTC and on `workflow_dispatch`; the owner-only guard is kept word for word;
  - `permissions: contents: read, id-token: write`; `environment: backup`; concurrency `backup-production`;
  - checks out (`persist-credentials: false`) and installs only `@techaust/deploy-tools`;
  - a settings check names every missing secret and variable, checks the PEM form, and writes the public key to `$RUNNER_TEMP`;
  - the export runs from `apps/jobs` with `--remote --env production --skip-confirmation`, and an empty file fails;
  - then: `scripts/backup-encrypt.sh`; the plaintext deleted (`if: always()`); `aws-actions/configure-aws-credentials` (role from `vars.AWS_BACKUP_ROLE_ARN`, `ap-south-1`, account id masked); `aws s3 cp` to `daily/techaust-prod-<UTC>.tar`; the size checked with `list-objects-v2 --prefix`; the manifest written to the job summary; the archive and key file removed (`if: always()`).
- `scripts/backup-encrypt.sh` (new, executable):
  - a random key (`openssl rand -hex 32`, kept as 64 hex characters plus LF, because the `enc` passphrase is one line) encrypts with `aes-256-cbc -pbkdf2 -iter 200000 -salt -md sha256`, the key fed on stdin;
  - the key is wrapped with `pkeyutl -encrypt`, OAEP, SHA-256 for both OAEP and MGF1;
  - one tar holds exactly `manifest.json`, `dump.sql.enc` and `key.bin.enc`. The manifest: format `techaust-d1-backup/1`, `createdAt`, byte sizes, the plaintext SHA-256, the public key's DER SHA-256;
  - it refuses: an empty or missing dump, a missing key, a key that is not RSA, a key under 4096 bits, an existing output, an output not ending in `.tar`, an unsafe file name;
  - the plain key lives only in a scratch folder that is removed on every exit.
- `scripts/backup-decrypt.ps1` (new; Windows PowerShell 5.1, also pwsh):
  - asks for the archive and `backup-private.pem` (or takes `-Archive`/`-PrivateKey`), and strips quotes from "Copy as path";
  - finds Git for Windows' OpenSSL (next to `git.exe`, then the usual folders, then the PATH; 1.1.1 or later) and System32 `tar`;
  - requires exactly the three parts and checks the manifest's algorithms;
  - unwraps the key (OpenSSL asks for a passphrase itself) and decrypts next to the archive, never over an existing file;
  - checks size and SHA-256 and deletes the output on a mismatch; the scratch key folder is removed in `finally`;
  - native calls run under `Continue` (the PS 5.1 redirected-stderr trap that `make-backup-key.ps1` also handles);
  - the last line is `RESULT: …` and says "keep this file private, delete it after the drill".
- `docs/runbooks/restore.md`: §1's row and a new §3:
  - 3.1 what runs and where, the 90-day lifecycle, the names the workflow needs, and the role and bucket shape;
  - 3.2 download in the AWS console;
  - 3.3 decrypt (the script and a by-hand fallback);
  - 3.4 the restore drill, matched to what `drill-verify.mjs` really does: it is **local only**, so the drill is `drill:verify -- --import <sql> --persist-to .wrangler\drill-<date>`, then the remote load into the scratch D1 `techaust-restore-<date>`, checked by counts, then clean-up and `backup-verified.json`;
  - 3.5 a real restore;
  - 3.6 known points and what isn't built.
- `apps/web/test/backup-workflow.test.ts` (new): 31 tests (18 workflow-shape, 10 envelope, 3 decrypt-script) plus one placeholder that runs only when bash or openssl is missing and warns that the round trip didn't run.
  - **Workflow shape:** the triggers, the permissions, one job in `backup`, only the two secrets and three variables, the token only in the settings check and the export, one install (wrangler only), SHA pins (checkout, pnpm and setup-node equal to `deploy-prod.yml`'s), OIDC with no AWS keys, `persist-credentials: false`;
  - **order and plaintext:** guard → check → export → encrypt → delete → creds → upload → verify; every name in the check; wrangler output only to a file, printed through the link-stripping `sed`, then deleted; deletion straight after the encryption with `always()`; upload of `$ARCHIVE` only; size check by listing, no get or head; no artifact or cache; secrets only as `env`/`with:` values;
  - **envelope round trip** (bash and openssl): exactly three parts and no plaintext bytes in the tar; the manifest; the runbook's two openssl commands give back the dump byte for byte; two runs differ; six refusals write nothing; a 2048-bit key is refused;
  - **decrypt script** (Windows PowerShell or pwsh): opens into a spaced folder, never overwrites, a wrong key fails with no `.sql`, a tar with other parts is refused.

**Action pins:** checkout `3d3c42e5…` v7.0.1, pnpm/action-setup `ea17c68d…` v6.1.0 and setup-node `82076278…` v7.0.0 (the same as `deploy-prod.yml`). **`aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd` = v6.3.0**, the latest release, published 2026-09-15 (`gh api …/releases`; the SHA is `refs/tags/v6.3.0` from `git ls-remote`, the same commit `v6` points to); runs on `node24`.

**Commands and results:**
- `pnpm --filter @techaust/web exec vitest run --project node test/backup-workflow.test.ts test/workflow-actor.test.ts` (heavy, log `p7n-backup-test`): 35 passed (31 of mine, 4 of `workflow-actor.test.ts`), 1 skipped (the placeholder), including the PowerShell 5.1 round trips on this PC.
- `pnpm --filter @techaust/web test` (heavy, `p7n-web-test`): **47 files, 1135 passed, 21 skipped**.
- `pnpm check`, run as its parts:
  - `pnpm lint` (heavy, `p7n-check`): 1 error, only in my **uncommitted** local patch of `site.ts` (finding 2); my files are clean (`biome check` on the test).
  - `pnpm typecheck` (heavy, `p7n-typecheck`): 0 errors.
  - the six guards (web bindings, content lint, worker config, SPA headers, migrations, CSS collisions): all ok.

**Findings for the lead:**
1. **Fixed in the design: wrangler prints a one-hour signed link to the plaintext export.** wrangler 4.156.2's remote `d1 export` prints "You can also download your export from the following URL manually…" with the signed URL (`exportRemotely` in `wrangler-dist/cli.js`). This repository is public, so its Actions logs are public: anyone could have downloaded the production database within the hour. The workflow sends wrangler's output to a private file, prints it only on failure with links removed, and deletes it. A test pins this. The staging drill (drill-log.md step 1) prints the link only in the owner's own terminal, which is fine.
2. **The task branch doesn't build: `apps/web/src/config/site.ts` (6267065f, the founder bio).** The `founderBio` string holds two raw line breaks inside a `"…"` literal (line 55 → 57), so Vite/rolldown stops with "Unterminated string" and **every web test and the web typecheck fail to load** on `feat/p7-production`. Not my file, so not committed. To run the checks I escaped the breaks as `\n\n` in the working tree only, then restored it. The fix is the lead's: `\n\n` in the string (about.astro splits on the blank line), formatted by biome as `founderBio:` with the string on the next line.
3. **Merging enables the nightly schedule.** Until the `backup` environment, `CF_API_TOKEN_BACKUP`, `AWS_BACKUP_ROLE_ARN`, `BACKUP_BUCKET`, the OIDC role and the bucket exist, each nightly run fails at "Check the backup settings" and names what is missing. `BACKUP_PUBLIC_KEY_PEM` comes from `make-backup-key.ps1`.
4. **Visible in the public logs:** the role ARN (with the AWS account id) shows in the `with:` header of the credentials step, and the bucket name may show in an `aws` error. Neither is secret, but both are visible in public logs. To hide them, make them secrets; the tests then need the two names moved.
5. **The token permission:** Cloudflare's `d1 export` API needs D1 edit permission on the account (export is a POST). "D1 only" fits, but read-only won't do. Not verified against the hosted token.

**Not done or not verified:**
- No hosted run: the workflow has never run on GitHub, so the OIDC trust, the bucket policy and the remote export format are unverified. Its first real run is the proof.
- The remote export's statement order (triggers after rows, no `BEGIN`/`COMMIT`) is still unverified. Runbook §3.4 step 4.2 stops the drill if it is wrong.
- Not built (outside the brief): PRD JOB-BKP-01's monthly finance-only copy kept 10 years (`BACKUP_SCOPE`), now listed in runbook §3.6. Object Lock and versioning are left to the lead's hosted setup.
- A passphrase-protected private key wasn't tested (no interactive console in tests). `make-backup-key.ps1` makes one without a passphrase, which works with the decrypt script.
- `pnpm check` didn't run as one command, because the lint had to be read past the `site.ts` patch. Each part was run and passed.

## Launch log (lead, night of 2026-11-07 to 2026-11-08; each hosted step on the owner's yes in chat)
- **#199 (LUT fold)** renumbered after #197 by the lead (0089 regenerated on top of 0088, SQL identical; run file p7-lut-fold) and merged.
- **Custom Domains** `admin.`, `portal.`, `hooks.techaust.com` attached (connector) to `techaust-platform-{admin,portal,jobs}`, each with its certificate.
- **`deploy-prod.yml` run 42403321307** (`tag=main stage=full check_web=false`), approved by the owner:
  - attempt 1: migrations (0089) and seed, Workers 1–6 deployed; the jobs health check failed on `/paypal` (503 `hook_unconfigured`): `set-prod-secrets.ps1` had made `PAYPAL_WEBHOOK_ID` = `placeholder-<64 hex>`, which core `isPayPalWebhookId` refuses. The owner stored a 32-hex placeholder (`tools/set-random-secret.ps1 -Bytes 16 -Environment production`); the script is fixed in #200.
  - attempt 2: all seven Workers deployed, every health check passed (admin, portal, jobs `env: production`; `/paypal` 400).
- **Website check (Q1):** a temporary hostname attached to web, checked (pages 200, the four old paths 301, 404 page, `/api/health`, HSTS and CSP, no noindex, home page in a browser with no console errors), then detached, within 30 minutes.
- **The owner's "go" (2026-11-08):** `techaust.com` attached to `techaust-platform-web`. Checked through Cloudflare's resolver: every page 200, `http://` and `www` 301 to `https://techaust.com/`, the old paths 301, no `X-Robots-Tag` or noindex, security.txt (Contact `security@`, Expires 2027-10-22), `/api/health` production. **Found:** the old paths with a trailing slash answered 404 (fixed in #200, live at the next production deploy).
- **robots.txt:** Cloudflare's managed block (the zone setting, on before launch) comes first: search engines allowed, AI-training crawlers disallowed; our sitemap line follows. Kept.
- **Left (launch steps 6–10):** the first Owner invite (`pnpm.cmd invite --email … --role owner --production`) and Settings; the contact-form test on techaust.com; the gateway test webhooks to `hooks.techaust.com` and their real secrets (check staging's open checkouts first); the Access login logo URL; L10 (TLS 1.2, a WAF rate-limit rule, CAA) on the owner's yes; Search Console, an uptime monitor, Sentry and the AWS connection.
- **Access removed from production admin (owner, 2026-11-08, in chat: "I want admin panel without cloudflare's access"; reverses Q2):** the Access apps `techaust-platform-admin (production)` and `admin production health` deleted (connector). No Worker reads the Access JWT, so nothing else changes; `admin.techaust.com` now answers with our own sign-in (password + TOTP 2FA, rate limits, Turnstile after 3 failures). Staging admin keeps Access. To record in 13 and docs/08 §3 / runbooks/environments.md with the end-of-day record.
- **Cloudflare clean-up (2026-11-08):** the unused queues `techaust-staging-events` and `-dlq` deleted (owner's yes); the user API token "Workers Builds - 2026-09-04 12:28" deleted by the owner. Everything else in the account is in use (inventory: 14 Workers, 2 D1, 4 R2, 12 queues, 4 project Turnstile widgets, 9 staging Access apps, 21 DNS records).

## Cloudflare zone settings (L10 and the owner's "10/10" audit, 2026-11-08)
Read-only audit of the techaust.com zone first, then the owner approved each change in chat:
- **TLS and SSL:** minimum TLS 1.0 → **1.2** (checked: 1.0 and 1.1 refused, 1.2 and 1.3 served); SSL mode Full → **Full (strict)** (no origin servers, so nothing to break); **Always Use HTTPS on** (the zone redirect rule already sent http to https on every host; checked on all four).
- **DNSSEC on** (Cloudflare Registrar publishes the DS record; status `pending` until the .com registry shows it). Re-check that it reads `active`.
- **CAA:** `issue` and `issuewild` for `letsencrypt.org`, `pki.goog`, `ssl.com`, `sectigo.com` (Cloudflare's four CAs, docs SSL FAQ) and `iodef mailto:security@techaust.com`.
- **Rate-limit rule** (the free plan's one rule, `http_ratelimit` entrypoint): `http.host in {techaust.com admin. portal.} and starts_with(path, "/api/")`, 60 requests per 10 s per address and colo, then a 10 s block. Hooks excluded (the gateways and SES). The Workers' own limits stay the first line.
- **Tidy:** Email Obfuscation off; Browser Cache TTL "respect existing headers" (neither touched Worker responses; checked live: our own Cache-Control is served).
- **Web Analytics:** the zone's automatic setup reached no page (Workers serve them) though the privacy notice names it; automatic setup turned **off** (it would cover admin and portal too) and the beacon added by `BaseLayout.astro` on production builds only (`site.cfAnalyticsSite`; CSP already allowed it). Live at the next production deploy.
- **Kept, with the reason:** Bot Fight Mode off (it would block the payment and SES webhooks, and the free plan can't exempt paths); AI-training crawlers blocked and the managed robots.txt (existing choice); Browser Integrity Check on (to watch at the gateway test events, step 7); security level medium; 0-RTT off; Rocket Loader off (would break the CSP); Always Online off (no origin); Early Hints off (no `Link` headers); HTTP/3, TLS 1.3, ECH, post-quantum key exchange, Brotli on; the free managed WAF ruleset and DDoS rules on; HSTS sent by every Worker (1 year, includeSubDomains; zone HSTS off, no preload, docs/08); Polish, Mirage and tiered caching are paid or don't apply to Workers.
- **Later (dated):** DMARC `p=none` → `quarantine` after 2–4 weeks of clean reports (from about 22 November); the HSTS preload review after that.
