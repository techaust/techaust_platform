# Runbook: environments and Cloudflare resources

Cloudflare account: **Techaust Technologies** (`153cd8b23edd2bc9dec570ffaf467c2f`), owner `admin@techaust.com`. _Last updated 2026-10-30 (audit workflow changes: the explicit deploy order, the build apart from the token, the health checks, Workers Traces on staging; before that FX-1, 2026-10-29: R2, Browser Run, the jobs crons, `ADMIN_JOBS`, five Workers). Taken from the committed `wrangler*.jsonc` files, the workflows and the record, not read from the dashboard._
The live site is the old Worker **`techaust-web`**. **Never deploy to, rename or delete it** (rollback target until Phase 7 + 2 weeks).

## Staging (created 2026-10-06, P5.6, approved by the owner)

| Resource | Name | ID / note | Used from |
|---|---|---|---|
| D1 | `techaust-staging` | `879c63dd-fedd-4710-9b13-21d8804879a9` (location hint apac); bound to admin, portal and jobs; **migrated and seeded on every merge** (seed is insert-only, no personal data) | M1.3 |
| Queue | `techaust-staging-leads` (+ `-dlq`) | web produces the form leads; jobs produces its own work onto it (the lead clean-up, the nightly statistics, the expiry, the care-plan, alerts, reminder, report and LUT messages) and consumes both | M2.4, M3.2, M5.4, M5.5 |
| Queue | `techaust-staging-pdf` (+ `-dlq`) | admin, portal and jobs produce (snapshot, render, certificate, supplier copy, statement, sweep); jobs consumes both, one message at a time (`max_concurrency` 1, Browser Run's 10 s pacing) | M4.4 |
| Queue | `techaust-staging-email` (+ `-dlq`) | admin, portal and jobs produce; jobs consumes both. Since FX-1 the email consumer has `max_retries` 10 with a 60 s to 1 h backoff | M2.4 |
| Queue | `techaust-staging-events` (+ `-dlq`) | Created at setup, not bound yet (payment webhooks) | M6 |
| R2 | `techaust-staging-files` | Private. **Created by the owner for M3.4** (2026-10-25 decision). The admin file vault (`FILES`, bound to the admin front and admin API Workers); uploads and downloads only through the Worker, no public access, no signed URLs | M3.4 |
| R2 | `techaust-staging-docs` | Private. **Created by the owner for M3.4/M4.4**. The write-once document envelopes and PDFs, certificates, supplier copies, statement PDFs and the signature image (`DOCS`, bound to admin, admin API, portal and jobs) | M4.4 |
| Browser Run | the `BROWSER` binding of `techaust-platform-jobs-staging` | Available on the account (owner, 2026-10-26, H2); staging jobs only (it does not run locally: `PDF_RENDERER=stub` there). Free plan: about 10 minutes of browser time a day, one request every 10 s (paced in `apps/jobs/src/browser.ts`); half the allowance rings the owners' bell | M4.4 |
| Cron triggers | on `techaust-platform-jobs-staging`: `0 22 * * *` (03:30 IST daily) and `30 * * * *` (the top of every IST hour) | Both only enqueue, never read D1 (FX-1). Daily: the lead clean-up scan, the PDF and offer sweeps, the nightly statistics, the expiry, the statement PDF clean-up. Hourly: the reminder scan; 06:00 IST the care-plan scan (again 07:00 and 08:00); 09:00 IST the owners' alerts (again 10:00 and 11:00), the export realisation scan and, on IST days 5 to 7, the EDF reminder. Production states `"crons": []` until Phase 7 (`scripts/check-worker-config.mjs`) | M3.2, M5.4 |
| Service binding | `ADMIN_JOBS` on `techaust-platform-jobs-staging` → `techaust-platform-admin-api-staging`, entrypoint `BillingJobs` | The care-plan drafting and automatic issue run in the admin API Worker; jobs calls them over RPC. **Deploy the admin API before jobs**: the staging deploy does it as explicit steps (full audit A6 8, below); not in production until Phase 7 | M5.4 |
| Workers Logs and Traces | every staging Worker's `env.staging.observability` | Logs on with invocation logs, not sampled (the CPU benchmarks need every request). **Traces on since the audit workflow PR (owner's yes 2026-10-30, full audit A6 9)** at a head sampling rate of 0.1, staging only; production has neither traces nor invocation logs. Free plan limits, headroom and how to read a trace: [cpu-baseline.md](cpu-baseline.md) "Traces" | A6 9 |
| Turnstile widget | `techaust-staging-forms` (managed, hostname: the staging web host only) | **Created 2026-10-23** by the owner; site key in `apps/web/wrangler.jsonc` (staging vars), secret `TURNSTILE_SECRET` on the web Worker ([ses-and-turnstile.md](ses-and-turnstile.md)) | M2.4 |
| Access app | `web-staging public logos`: path `brand/*` on the staging web host, one **Bypass / Everyone** policy | **Created 2026-10-23** (owner decision) so email clients can load the logos; every other staging path stays behind Access | M2.4 |
| Amazon SES (AWS, ap-south-1) | domain `techaust.com` (Easy DKIM, MAIL FROM `noreply.techaust.com`), configuration set `techaust-transactional`, verified recipient `admin@techaust.com`, IAM user `techaust-ses-sender-staging`; sandbox | Owner, 2026-10-23 ([ses-and-turnstile.md](ses-and-turnstile.md)); keys are jobs secrets | M2.4 |
| Access app | the staging `*.workers.dev` hosts | **On since 2026-10-17** ([access-staging.md](access-staging.md)): one Access app per staging Worker, all traffic, the "Cloudflare account" policy (the owner is the only member), Preview URLs off, Zero Trust Free; after Part 2, a Service Auth policy for the benchmark token on the admin app only (since 2026-10-30 the staging deploy's admin health check uses it too) | M1.4 |
| Workers | five: `techaust-platform-{web,admin,portal,jobs}-staging` with URLs, and `techaust-platform-admin-api-staging` without one (next row) | The four with URLs **deployed 2026-10-06** (PR #1); health routes return 200 | — |
| Worker (no URL) | `techaust-platform-admin-api-staging` | Created by the staging deploy with the M5.0 PR (owner's yes, 2026-10-27). No workers.dev URL, no routes, no Access app needed: only the admin Worker reaches it, through its `ADMIN_API` service binding. Same D1, buckets and queues as admin; no secrets. Deployed first, before the admin front Worker (`deploy:staging:api`) | M5.0 |

**Staging URLs** (workers.dev subdomain `techaust-technologies-153`; noindex placeholders, no personal data; each answers 302 to the Cloudflare Access login, see [access-staging.md](access-staging.md)):
- Web: https://techaust-platform-web-staging.techaust-technologies-153.workers.dev (`/api/geo`)
- Admin: https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev (`/api/v1/health`; the front Worker answers it alone, so also check that `GET /api/v1/dashboard` without a session is 401, not 502, which proves the API Worker answers through the binding)
- Portal: https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev (`/api/v1/health`)
- Jobs: https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev (`/healthz`)

Deploys happen automatically when a PR is merged to `main` (`.github/workflows/deploy-staging.yml`, owner's yes 2026-10-30 for full audit A1 5 and A6 8):
1. `pnpm install`, then the seed SQL is written (`pnpm --filter @techaust/db seed:sql`), **without** the Cloudflare token.
2. With the token: `wrangler d1 migrations apply DB --remote --env staging`, the seed (`wrangler d1 execute`), and the published catalogue snapshot read.
3. **Without** the token: the staging builds, `build:staging` in admin, portal and web (`CLOUDFLARE_ENV=staging vite build` or `astro build`, with the header and dist checks). Every step that runs package code runs without `CLOUDFLARE_API_TOKEN`; only the credentials check and the wrangler steps get it (step-level `env`). `publish-catalogue.yml` builds the website the same way.
4. With the token, one Worker per step, in this order: **the admin API** (`deploy:staging:api`), **the admin front** (`deploy:staging:front`), **the portal**, **jobs** (`wrangler deploy --env staging`; it bundles its own code) and **the website**. A failed step stops the job, so nothing deploys after a failed Worker. Each deploy script first runs `scripts/check-staging-build.mjs`: a plain `vite build` names the **production** Worker (the top level of `wrangler.jsonc`), so a non-staging build is refused before `wrangler deploy` runs; for the website it checks that the pages carry env.staging's Turnstile key.
5. After the admin's two Workers: the health check (below).

Limit of the step split (A1 5): a step without the token can't read it, but steps share the runner, so a malicious package in a build step could still leave files or `GITHUB_ENV` entries behind for a later step. The stronger form (a separate deploy job that receives the built files and installs only wrangler) is a possible follow-up, not built.

### Health checks after a deploy (A6 8)
`node scripts/staging-health.mjs <app>` asks the Worker's health route through Cloudflare Access with a service token (`CF-Access-Client-Id` and `-Secret` headers), retries for about 30 seconds, and fails the job unless the Worker itself answers: its JSON with `ok: true`, its own `service` name and `env: "staging"`. A redirect to the Access sign-in page or a non-JSON 401/403 from Access counts as a failure. The checks per app: admin `GET /api/v1/health` = 200 and a signed-out `GET /api/v1/dashboard` = the API Worker's JSON 401 (proves the `ADMIN_API` binding; a 502 fails), portal `GET /api/v1/health`, jobs `GET /healthz`, web `GET /api/geo`.
- **All four apps: on**, with the deploy-check service token `staging-deploy-check` (`CF_ACCESS_DEPLOY_CLIENT_ID`, `CF_ACCESS_DEPLOY_CLIENT_SECRET`; a Service Auth policy on each of the four staging Access apps; owner, 2026-10-30; Part 4 of [access-staging.md](access-staging.md)). Made for 1 year: renew it before it lapses or the deploy fails at the first check. The benchmark token stays for the benchmark only.

**Legal hold (M3.3; no screen or route until M7.4, VERIFY WITH CA/LEGAL):** a client, a contact or a lead is held by setting its `legal_hold` column to 1 in the staging database, for example `wrangler d1 execute DB --remote --env staging --command "UPDATE contacts SET legal_hold = 1 WHERE id = '<contact id>'"` (the owner or the lead runs it; erase and anonymise then answer 409 `legal_hold` until it is set back to 0).

## Production
Nothing is created until Phase 7 (L3), with owner approval per resource. The production blocks of the `wrangler*.jsonc` files hold no D1, queues, R2, Browser Run, service bindings or secrets, and the jobs Worker states an empty cron list (`triggers` would otherwise be inherited from the top level).

## Access methods
- Local: `wrangler login` (OAuth, the owner's machine). Scopes include Workers/D1/Queues write and zone **read** only.
- CI: `CF_API_TOKEN_STAGING` (repo secret, created by the owner with the scoped permissions in [05 §12.3](../05-architecture.md)), plus `CLOUDFLARE_ACCOUNT_ID`.
- Cloudflare MCP (plugin, authorised): read-only use (logs, listing).

## GitHub
- Repo `techaust/techaust_platform`: **public** (owner decision, 2026-10-06). `main` is protected (PR + CI `checks` required, conversation resolution required, linear history, no force-push, admins included). **Auto-merge is on** (owner, 2026-10-07): PRs merge themselves when CI passes, except held PRs.
- Repo secrets: `CF_API_TOKEN_STAGING`, `CLOUDFLARE_ACCOUNT_ID`; after Access Part 2, `CF_ACCESS_BENCH_CLIENT_ID`, `CF_ACCESS_BENCH_CLIENT_SECRET` (the owner-only benchmark workflow, and since 2026-10-30 the admin health check of the staging deploy, which runs only for pushes to this repository's `main`). Repo variable `PRODUCTION_ENABLED`: **unset** (production deploys disabled until Phase 7).
