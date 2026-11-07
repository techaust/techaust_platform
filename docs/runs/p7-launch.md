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

## The lead's own items (not for agents)
- the redirects (`apps/web/public/_redirects`, Q3);
- the secret scripts' `-Environment production`;
- the launch content (`site.launchDate` and every legal `effective` set to 2026-11-08, `founderBio`, `aliasesConfirmed`);
- the production Turnstile keys in the configs;
- the integration, the reviewer, the merge, then the hosted steps and the launch-day order in [phase7-production](phase7-production.md) D.

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
