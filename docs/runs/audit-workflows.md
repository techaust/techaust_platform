# Run: audit workflow changes (A1 3, A1 5, A6 8, A6 9)

Owner's yes, 2026-10-30 ("The four workflow changes: Yes"; docs/13 row of that date). From the full audit M1–M5 (`docs/runs/full-audit-m1-m5.md`, areas A1 and A6). Tier B (workflows, Worker config). Staging only; production stays untouched.

## Brief (lead, 2026-10-30)
Builder, Opus 5.5 high. Branch `fix/audit-workflows-b` from `origin/chore/audit-workflows`; push only that branch.

1. **A1 3, a dependency audit in CI** (docs/08 §3.5): a CI step (in the `checks` job or a job it needs, so it gates merges) that fails on known high or critical advisories in the pnpm lockfile (`pnpm audit --audit-level high` or equivalent, pinned tool versions, no network beyond the registry the job already uses). Decide and document how a false positive or an advisory without a fix is allowed through (a reviewed allow-list file with a reason and an expiry date, like the other allow-lists), never by turning the step off. Fork-safe: no secrets.
2. **A1 5, the build apart from the deploy step**: in `deploy-staging.yml` and `publish-catalogue.yml`, `vite build` / `astro build` (and anything else that runs package code) run in steps that do NOT have `CLOUDFLARE_API_TOKEN` in their environment; only the `wrangler deploy` / migrate steps get it (step-level `env`, not job-level). The SPA builds still bake `CLOUDFLARE_ENV=staging` (see CLAUDE.md "Staging deploys differ per app": the Vite plugin writes a redirected deploy config at build time; `wrangler deploy` then uses it). Also `renovate.json`: don't automerge devDependency updates (audit A1 5, latent).
3. **A6 8, explicit deploy order plus health checks**: the staging deploy runs admin API → admin front → portal → jobs → web as explicit steps (the admin API before jobs, which binds `ADMIN_JOBS`; today it rests on workspace order), and after each Worker's deploy a `/healthz` (or the app's health route) check against its staging URL with a short retry, failing the job if it doesn't answer 200. Staging Workers sit behind Cloudflare Access: find out how the health check gets through (a route that Access bypasses, the service token already used by the workflow if any, or `workers.dev` rules in `docs/runbooks/environments.md`); if no existing path exists, stop and report: the lead asks the owner before any Access or Cloudflare setting changes. Update `docs/runbooks/environments.md` (the audit noted it's stale: R2, Browser Run, crons, `ADMIN_JOBS`, five Workers) and the deploy-order follow-up in docs/12 is then closed.
4. **A6 9, Workers Traces on staging**: turn on `observability.traces` (and keep logs as they are) in each Worker's `env.staging` only, with a head sampling rate that keeps the Free plan inside its included limits (read the current Cloudflare docs for the Free plan's traces/observability event limits, cite them in a comment and in `docs/runbooks/cpu-baseline.md`, and pick a rate with headroom). Production config unchanged. `scripts/check-worker-config.mjs` must still pass (admin front and API kept in step). Add how to read a trace for the CPU baseline to `cpu-baseline.md`, including queue consumers (audit A6 9: no consumer readings yet).

Rules: every Action pinned by commit SHA; no new secrets (if one is needed, stop and report the exact `gh secret set …` the owner would run); fork-safe; `deploy-prod.yml` untouched; nothing hosted is changed by you (the merge deploys to staging). Checks: `actionlint` if available offline (else a careful read), `pnpm check`, the web tests that pin workflow behaviour (`apps/web/test/workflow-actor.test.ts` and any like it), and add tests that pin the new rules (no `CLOUDFLARE_API_TOKEN` in a build step's env; the deploy order; health checks present; traces only under `env.staging`). Whole-repository `pnpm lint` last. Append "## Builder report".

## Builder report (builder, Opus 5.5 high, 2026-10-30, branch `fix/audit-workflows-b`)
**Skills loaded:**
- `cloudflare:wrangler`: config edits checked against the installed wrangler 4.147.0 `config-schema.json` (`observability.traces.{enabled,head_sampling_rate}`, `logs.invocation_logs`), and the staging dry-run and Vite staging builds checked the result.
- `cloudflare:workers-best-practices`: traces enabled per its observability rule, while logs stay unsampled.
- `cloudflare:cloudflare`: the Observability and Traces docs (Free plan limits, spans and attributes) read through Context7.
- `cloudflare:workers-profiling`: applied to the `cpu-baseline.md` reading steps (CPU on the root span, wall time in the child spans). No profile was captured, since that needs the deployed Worker.

Not loaded: `cloudflare:turnstile-spin` (Turnstile is unchanged; only its site key is read by the new guard), `code-review` and `security-review` (these belong to the reviewer).

### 1. A1 3, dependency audit in CI (commit `89c6c293`)
- **What changed:**
  - `scripts/dependency-audit.mjs` (+ `.d.mts`) is a new step in the `checks` job, straight after `pnpm install`. It uses no secret.
  - The step runs the pinned pnpm's `pnpm audit --json`, which asks the same npm registry the install already uses.
  - It fails on any **high or critical** advisory, dev tools included, that has no live entry in `scripts/dependency-audit-allow.json`.
- **How an advisory is let through:** a reviewed entry in the allow-list. Each entry holds the GHSA id, the package, a reason (at least 20 characters), `added`, `addedBy`, and an `expires` date no more than 90 days after `added`.
- **The step also fails when:**
  - an entry has expired;
  - an entry is stale (that advisory is no longer reported at high or critical);
  - an entry is malformed or listed twice;
  - pnpm's answer can't be read (a registry error fails closed, so re-run the job).
- **Docs:** documented in docs/08 §3.5, which is now ticked.
- **What the audit found today:** 12 high advisories (0 critical, 14 moderate, 4 low). All 12 are on the allow-list, so CI stays green.
  - **zod GHSA-mrhx-c7xc-m3w5** is in **production** code: zod 4.6.5 in the Workers ("can exhaust memory while validating oversized constrained collections"). It is fixed in 4.6.6. Its entry expires **2026-11-06**.
  - The other 11 are dev and build tools only: undici ×4, vite, sharp (under miniflare), tmp, extract-zip ×2, basic-ftp and body-parser. These come through @lhci/cli, vitest, miniflare and astro's unifont. Their entries expire **2026-11-13**.
- **Not done:** I changed no versions (the brief says no version change). Every entry is marked "for the lead to confirm".

### 2. A1 5, the build apart from the deploy step (commit `0508dbdf`)
- **The split:**
  - New `build:staging` scripts in admin, portal and web (`CLOUDFLARE_ENV=staging vite build` or `astro build`, plus the header and dist checks).
  - The deploy scripts now only run wrangler: admin `deploy:staging:api` and `deploy:staging:front`, portal `deploy:staging`, web `deploy:staging`. Admin no longer has a combined `deploy:staging`.
- **What gets the token:**
  - In both `deploy-staging.yml` and `publish-catalogue.yml`, the install, the seed SQL (`seed:sql`, now its own step) and every build run **without** `CLOUDFLARE_API_TOKEN`.
  - Only the credentials check, the migrate and seed step, the snapshot read and the deploy steps get it, always as step-level `env`.
- **New guard, `scripts/check-staging-build.mjs`:** it runs first in every SPA and web deploy script.
  - **Why it is needed:** a plain `vite build` flattens the top level of `wrangler.jsonc`, whose `name` is the **production** Worker's. With the build and the deploy split, a `deploy:staging` run after a plain build would have uploaded to `techaust-platform-admin` or `techaust-platform-portal`. I confirmed this locally: after a plain build the flattened config is named `techaust-platform-admin`.
  - For admin and portal it refuses any build that isn't the staging Worker's.
  - For web it checks that the pages carry env.staging's Turnstile key and not the test key.
- **Renovate:** `renovate.json` automerges nothing. The devDependency rule is now `automerge: false`, and a top-level `automerge: false` is added.
- **Limit (stated in the workflow comment and in environments.md):** steps share one runner. A malicious package in a build step can't read the token, but it could still leave files or `GITHUB_ENV` entries behind for a later step. The stronger form, a separate deploy job that installs only wrangler, is not built and is a possible follow-up.

### 3. A6 8, explicit deploy order and health checks (commit `0508dbdf`)
- **Deploy order:** one Worker per step, in this order: admin API, admin front, portal, jobs, website. The migrate, the seed, the snapshot read and all three builds run before the first deploy. A failed step stops the job, so nothing is deployed after a failed Worker.
- **Health check, `scripts/staging-health.mjs`:**
  - It asks each health route through Access with `CF-Access-Client-Id` and `-Secret`, with redirects off.
  - It retries for about 34 seconds (5 tries).
  - It needs the Worker's own JSON: `ok: true`, its own `service` name and `env: "staging"`. A redirect to the Access sign-in page, or a non-JSON 401/403 from Access, fails the check.
  - For admin it also needs a signed-out `GET /api/v1/dashboard` to come back as the API Worker's JSON 401, which proves the `ADMIN_API` binding; a 502 fails.
- **How the health check gets through Access:**
  - **Admin: the check is on.** It uses the existing benchmark service token (`CF_ACCESS_BENCH_CLIENT_ID` and `_SECRET`). Admin is the only Access app that accepts a token: the Service Auth policy from Part 2 of access-staging.md, done 2026-10-17.
  - **Portal, jobs and website: STOPPED, as the brief says.** Their Access apps accept no service token, and there is no bypass on their health paths, so no existing path gets through. The script already knows all four apps, so wiring them is three workflow steps once Access allows it.
- **Docs:**
  - `docs/runbooks/environments.md` is updated: the deploy steps, the limit of the step split, the "Health checks after a deploy" section, the Access row, the secrets line, and a Logs and Traces row.
  - The `docs/05` deploy-staging row is updated too.
  - docs/12 has no deploy-order follow-up on this branch, so there was nothing there to close.

### 4. A6 9, Workers Traces on staging (commit `68758f7d`)
- **Config:**
  - Each of the five configs (web, admin, admin API, portal, jobs) gets its own `env.staging.observability`: `enabled`, `redact_query_string`, `logs: {enabled, invocation_logs: true}` (unchanged, still unsampled) and `traces: {enabled: true, head_sampling_rate: 0.1}`.
  - Production's block and the top level are unchanged. The Vite staging build's flattened configs carry the traces block, and a plain build's do not (checked).
- **Guard:** `scripts/check-worker-config.mjs` now has `observabilityProblems`. It refuses:
  - traces at the top level or in production;
  - any production block other than the current one;
  - a staging rate other than 0.1;
  - sampled staging logs, or invocation logs turned off on staging;
  - admin front and admin API observability that differ.
- **Free plan limits** (Cloudflare docs through Context7, read 2026-10-30, cited in each config comment and in `cpu-baseline.md`):
  - traces are kept 7 days;
  - Workers Logs Free allows 200,000 events a day until 2026-11-30;
  - from 2026-12-01, logs and traces share the account's **0.5 GB ingested a day**, with no paid extra, and ingestion stops for the rest of the day once it is used up.
- **Why 0.1:** the headroom estimate is ≤ 10,000 staging invocations a day × 10 % × an assumed 50 KB per trace ≈ 50 MB a day, which is 10 % of the allowance.
- **`cpu-baseline.md` "Traces" now covers:** how to read a trace (the root span's `cloudflare.cpu_time_ms`, `wall_time_ms` and `outcome`; the child spans; adding front and API CPU by `ray_id`), and queue consumers (filter on `cloudflare.handler_type = queue`, the message kinds to read, the pass line).

### Commands and results
- `node scripts/dependency-audit.mjs`, against the live registry and a saved report: exit 0, 12 high advisories allowed.
- Staging builds, run through `tools/heavy.sh` with `CLOUDFLARE_ENV=staging` set by bash, because pnpm on Windows runs scripts through cmd and `VAR=x` fails there (CI runs on Linux):
  - admin, portal and web staging builds: exit 0, and `check-staging-build` passed for admin, admin-api, portal and web;
  - after plain builds, `check-staging-build` refused admin, admin-api and web (exit 1), as intended.
- `wrangler deploy --dry-run --env staging` for jobs: exit 0, no config warnings.
- Web Node tests, the whole project: 681 passed, 1 skipped. The first run had 1 failure in `dist-checks` because my partial `astro build` had left a dist without the share images; after a full `pnpm --filter @techaust/web build` it passed (38/38).
- New and updated tests:
  - `dependency-audit.test.ts`: 23 passed;
  - `deploy-workflow.test.ts`, `staging-checks.test.ts` and `deploy-scripts.test.ts`: 43 passed;
  - `observability-config.test.ts` with `worker-config`, `signin-config` and `portal-website-origin`: 82 passed;
  - `workflow-actor.test.ts`: passed.
- Other packages: core `fetch-catalogue-snapshot.test.ts` 23/23, jobs `health.test.ts` 2/2, admin `split.test.ts` 295/295, portal `health.test.ts` 3/3.
- `actionlint` is not installed on this PC. Instead the three workflows were parsed with the `yaml` package (no errors), each step's `env` keys were listed and checked, and the files were read carefully.
- The final check, `pnpm check`, which includes the whole-repository `pnpm lint`: exit 0. Biome reported 10 warnings, all in files this task didn't touch.

### Not verified
- **None of this has run on GitHub or Cloudflare.** That includes:
  - the CI audit step on the runner;
  - the split deploy;
  - whether `wrangler deploy` after a separate-step Vite build behaves on the runner exactly as it does locally;
  - the admin health check through Access, which needs the bench token's secrets to be present and the Service Auth policy to still be live;
  - whether traces appear in the dashboard.

  The first merge to `main` is the real test.
- **The size of a span or trace is assumed, not measured.** Check it after a week, as `cpu-baseline.md` says.
- **What traces record has not been checked against our data:**
  - `db.query.text` (the SQL text) and any request attributes. Our queries bind their values, but no query was audited for literal personal data.
  - Staging traces probably hold the same IP and user agent as the invocation logs that staging already keeps (docs/13 2026-10-21).
- **The zod advisory's real exposure** behind the 16 and 32 KB body caps was not assessed.

### For the lead and the owner
1. **The zod update (production dependency).** Its allow-list entry expires 2026-11-06, after which every PR fails CI. Someone needs to bump `zod` to 4.6.6 (or later, once older than the 1-day `minimumReleaseAge`) across the workspace, or decide to renew the entry with a reason. The dev-tool entries expire 2026-11-13, and the updates they wait for are @lhci/cli, vitest/vite, the Cloudflare tooling (miniflare's sharp and undici) and astro (unifont's undici).
2. **The benchmark token in the deploy workflow.** The admin health check reuses `CF_ACCESS_BENCH_CLIENT_ID` and `_SECRET`. These existed for the owner-only benchmark (docs/13 2026-10-06 and 2026-10-17). The deploy workflow runs only for pushes to this repository's `main`, so no fork can reach them, but this is a new use of the token. Please confirm it, or have the step removed.
   - The token was created for 1 year on 2026-10-17. If it lapses, or the policy is removed, the deploy fails at this step after the admin is already deployed.
3. **Health checks for the portal, jobs and website need an Access change: an owner decision.** Recommended first:
   - **(a), recommended:** add a Service Auth policy to the portal, jobs and web staging Access apps for a new token `staging-deploy-check`, stored as two new repo secrets, and switch the admin check to that token too. That keeps the benchmark token separate.
   - **(b):** add the existing benchmark token's Service Auth policy to those three apps.
   - **(c):** a Bypass policy on the three health paths only. This makes those paths public.

   The owner's steps for (a) or (b) are in Part 2 of `docs/runbooks/access-staging.md` (Create Service Token; then, on each app, Policies → Add a policy → Service Auth → Include: Service Token). For (a) the secrets would be set with `gh secret set CF_ACCESS_DEPLOY_CLIENT_ID` and `gh secret set CF_ACCESS_DEPLOY_CLIENT_SECRET`, through a hidden-input script. After that, the lead adds three `node scripts/staging-health.mjs <app>` steps.
4. **CLAUDE.md "Staging deploys differ per app"** still says the SPAs use `CLOUDFLARE_ENV=staging vite build && wrangler deploy` in one `deploy:staging`. I didn't change it because it's the lead's file. Suggested wording: "`build:staging` (no token) then `deploy:staging` (`deploy:staging:api` and `deploy:staging:front` for admin), each deploy first runs `scripts/check-staging-build.mjs`; the workflow deploys admin API, admin front, portal, jobs, web".
5. **A possible follow-up** (not in this brief): a separate deploy job that takes the built `dist/` as an artifact and installs only wrangler. It closes the shared-runner limit described in item 2.

### Lead, after the builder (2026-10-30)
- Merged `fix/audit-workflows-b` (8eec7e2a); CLAUDE.md's staging-deploy line rewritten for build-then-deploy, the dependency audit and staging traces.
- Owner's answers: **zod 4.6.6 yes** (done by the lead: the four package.json pins and the lockfile; astro 7.3.5 still pulls 4.6.5 at build time, and older zod in dev tools, so the GHSA-mrhx-c7xc-m3w5 entry stays, narrowed to build and dev tools, expiring 2026-11-13); **a new service token `staging-deploy-check`** on all four staging Access apps (owner creates it; `.logs/owner/set-deploy-token.ps1` stores `CF_ACCESS_DEPLOY_CLIENT_ID` and `CF_ACCESS_DEPLOY_CLIENT_SECRET`). The benchmark token stays for the benchmark only.
- Checks on the zod update: `pnpm check` exit 0; `pnpm test`: auth, ui 471, core 1824, email 130, db 487, pdf 351, web 709 passed; one timeout each in jobs (`stats.test.ts`), portal (`session.test.ts`) and admin (`invoice-notes.test.ts`) while a browser sweep shared the PC, each file then passed alone (25, 25, 37). The `[mf:error] ZodError` in jobs is miniflare's own log, present in the passing run too.
- Next: switch the admin check to the deploy token and wire the portal, jobs and web checks (after the owner's `RESULT: OK`); review (no screens); PR.
