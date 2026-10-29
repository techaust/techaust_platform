# Runbook: environments and Cloudflare resources

Cloudflare account: **Techaust Technologies** (`153cd8b23edd2bc9dec570ffaf467c2f`), owner `admin@techaust.com`. _Last updated 2026-10-29 (FX-1: R2, Browser Run, the jobs crons, `ADMIN_JOBS`, five Workers; taken from the committed `wrangler*.jsonc` files and the record, not read from the dashboard)._
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
| Service binding | `ADMIN_JOBS` on `techaust-platform-jobs-staging` → `techaust-platform-admin-api-staging`, entrypoint `BillingJobs` | The care-plan drafting and automatic issue run in the admin API Worker; jobs calls them over RPC. **Deploy the admin API before jobs** (`deploy:staging` runs the apps in workspace order: admin before jobs); not in production until Phase 7 | M5.4 |
| Turnstile widget | `techaust-staging-forms` (managed, hostname: the staging web host only) | **Created 2026-10-23** by the owner; site key in `apps/web/wrangler.jsonc` (staging vars), secret `TURNSTILE_SECRET` on the web Worker ([ses-and-turnstile.md](ses-and-turnstile.md)) | M2.4 |
| Access app | `web-staging public logos`: path `brand/*` on the staging web host, one **Bypass / Everyone** policy | **Created 2026-10-23** (owner decision) so email clients can load the logos; every other staging path stays behind Access | M2.4 |
| Amazon SES (AWS, ap-south-1) | domain `techaust.com` (Easy DKIM, MAIL FROM `noreply.techaust.com`), configuration set `techaust-transactional`, verified recipient `admin@techaust.com`, IAM user `techaust-ses-sender-staging`; sandbox | Owner, 2026-10-23 ([ses-and-turnstile.md](ses-and-turnstile.md)); keys are jobs secrets | M2.4 |
| Access app | the staging `*.workers.dev` hosts | **On since 2026-10-17** ([access-staging.md](access-staging.md)): one Access app per staging Worker, all traffic, the "Cloudflare account" policy (the owner is the only member), Preview URLs off, Zero Trust Free; after Part 2, a Service Auth policy for the benchmark token on the admin app only | M1.4 |
| Workers | five: `techaust-platform-{web,admin,portal,jobs}-staging` with URLs, and `techaust-platform-admin-api-staging` without one (next row) | The four with URLs **deployed 2026-10-06** (PR #1); health routes return 200 | — |
| Worker (no URL) | `techaust-platform-admin-api-staging` | Created by the staging deploy with the M5.0 PR (owner's yes, 2026-10-27). No workers.dev URL, no routes, no Access app needed: only the admin Worker reaches it, through its `ADMIN_API` service binding. Same D1, buckets and queues as admin; no secrets. Deployed before the admin Worker by `deploy:staging` | M5.0 |

**Staging URLs** (workers.dev subdomain `techaust-technologies-153`; noindex placeholders, no personal data; each answers 302 to the Cloudflare Access login, see [access-staging.md](access-staging.md)):
- Web: https://techaust-platform-web-staging.techaust-technologies-153.workers.dev (`/api/geo`)
- Admin: https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev (`/api/v1/health`; the front Worker answers it alone, so also check that `GET /api/v1/dashboard` without a session is 401, not 502, which proves the API Worker answers through the binding)
- Portal: https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev (`/api/v1/health`)
- Jobs: https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev (`/healthz`)

Deploys happen automatically when a PR is merged to `main` (`.github/workflows/deploy-staging.yml`): first `wrangler d1 migrations apply DB --remote --env staging` and the seed, then the five Workers, one app at a time (`pnpm -r --workspace-concurrency=1 run deploy:staging`; admin's script deploys the admin API Worker before the admin front Worker, and admin comes before jobs, which binds the API's `BillingJobs`). Making that order explicit in the workflow, with a `/healthz` check after each, waits for the owner's yes (full audit A6 8).

**Legal hold (M3.3; no screen or route until M7.4, VERIFY WITH CA/LEGAL):** a client, a contact or a lead is held by setting its `legal_hold` column to 1 in the staging database, for example `wrangler d1 execute DB --remote --env staging --command "UPDATE contacts SET legal_hold = 1 WHERE id = '<contact id>'"` (the owner or the lead runs it; erase and anonymise then answer 409 `legal_hold` until it is set back to 0).

## Production
Nothing is created until Phase 7 (L3), with owner approval per resource. The production blocks of the `wrangler*.jsonc` files hold no D1, queues, R2, Browser Run, service bindings or secrets, and the jobs Worker states an empty cron list (`triggers` would otherwise be inherited from the top level).

## Access methods
- Local: `wrangler login` (OAuth, the owner's machine). Scopes include Workers/D1/Queues write and zone **read** only.
- CI: `CF_API_TOKEN_STAGING` (repo secret, created by the owner with the scoped permissions in [05 §12.3](../05-architecture.md)), plus `CLOUDFLARE_ACCOUNT_ID`.
- Cloudflare MCP (plugin, authorised): read-only use (logs, listing).

## GitHub
- Repo `techaust/techaust_platform`: **public** (owner decision, 2026-10-06). `main` is protected (PR + CI `checks` required, conversation resolution required, linear history, no force-push, admins included). **Auto-merge is on** (owner, 2026-10-07): PRs merge themselves when CI passes, except held PRs.
- Repo secrets: `CF_API_TOKEN_STAGING`, `CLOUDFLARE_ACCOUNT_ID`; after Access Part 2, `CF_ACCESS_BENCH_CLIENT_ID`, `CF_ACCESS_BENCH_CLIENT_SECRET` (used only by the owner-only benchmark workflow). Repo variable `PRODUCTION_ENABLED`: **unset** (production deploys disabled until Phase 7).
