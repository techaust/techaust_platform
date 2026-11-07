# P7 launch: production wiring for the launch on 2026-11-08

Status: briefs written (lead, 2026-11-07 evening). Tasks P7-A (configs and guards), P7-B (deploy workflow and checks) and P7-C (jobs address, production CLIs) run in parallel.

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

## The lead's own items (not for agents)
- the redirects (`apps/web/public/_redirects`, Q3);
- the secret scripts' `-Environment production`;
- the launch content (`site.launchDate` and every legal `effective` set to 2026-11-08, `founderBio`, `aliasesConfirmed`);
- the production Turnstile keys in the configs;
- the integration, the reviewer, the merge, then the hosted steps and the launch-day order in [phase7-production](phase7-production.md) D.
