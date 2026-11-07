# Phase 7: preparing the first production deployment

Status: plan written (lead, 2026-11-07, from the analyst's draft); the owner accepted Q1–Q11 as recommended (2026-11-07). Wave 1 (P7-A, P7-N8) starts once #190 is on `main`.

## The owner's decisions this plan follows (13, 2026-11-07)
1. techaust.com switches at the first production deploy, with no workers.dev-only period. `techaust-web` is deleted at that moment, only on the owner's explicit "go" given at the time.
2. The owner then tests everything end to end on production. Payments stay on test keys (`PAYMENTS_LIVE_ALLOWED=false`) until L9.
3. The lead creates the production resources (D1, R2, queues) through the Cloudflare connector. Secrets and API tokens are always the owner's, set with hidden-input scripts.
4. DNS: the lead shows the owner the exact record list once, then adds the records through the connector on the owner's yes.
5. Every earlier pending item is approved. AU45 is built before launch.

## What the analyst found that shapes the work
Marked [V] where verified in code or config, [I] where inferred. The analyst's full draft is in this session's transcript, summarised here.

1. **Production config is still the "until Phase 7" shell** [V]. `scripts/check-worker-config.mjs` refuses production bindings, crons, service bindings, gateway secrets and the `FILES` buckets, and `apps/web/test/worker-config.test.ts` pins those messages. The guards flip to "production mirrors staging" in the same change that fills every `env.production` block.
2. **`deploy-prod.yml` deploys nothing yet** [V]. It builds only the website and its deploy step is an `echo`. `deploy-worker.mjs` refuses production, and `staging-health.mjs` knows only staging.
3. **A `routes` or custom-domain entry in a production config would take techaust.com from `techaust-web` without asking** [V: wrangler 4.156.2 overrides an existing origin in CI]. So no production config gets `routes`, and a guard enforces that. The lead attaches domains through the connector, at the moment the owner says "go".
4. **The backup gate and the go-live path deadlock** [V]. `checkBackupVerified` needs a verified production backup before the deploy, but production D1 doesn't exist yet. The way out: run the database step first (`stage=database`), then backup and restore drill, then commit `backup-verified.json` and run the full launch.
5. **Test payments would cross between staging and production** [V]. Razorpay and PayPal turn an event for an unknown checkout into a "Needs review" item, and both environments would receive every sandbox event. Razorpay links and PayPal orders get an environment mark, and events from the other environment are ignored quietly, as Stripe's already are (Tier A).
6. **Four old URLs would answer 404 after the switch** [V, live sitemap]: `/services/knowledge-systems`, `/services/workforce-automation`, `/services/security-guard`, `/calculator`. They get redirects (Q3).
7. **Jobs emails still print "[Placeholder] postal address"** [V], and the readiness check never scans the jobs bundle.
8. **The web Worker has no fallback once `techaust-web` is deleted**: a first deploy has no previous version to roll back to. Q1 offers a 30-minute check on a temporary hostname before the "go".
9. **Production secrets can be set before the first deploy** [V, wrangler source]. A `secret put` creates a draft Worker. Rehearse on one harmless secret first.

## A. Code, config and workflow work

### A1. Before the first production deploy

| # | Work | Tier | Wave |
|---|---|---|---|
| 1 | Every `env.production` block mirrors staging: D1 `techaust-prod`; R2 `techaust-prod-docs` and `-files`; the queues `techaust-prod-{leads,pdf,email}` with their `-dlq`; service bindings (`ADMIN_ADVANCE`, `ADMIN_PAY`, `ADMIN_JOBS`, `ADMIN_GATEWAY`); `browser`; crons; vars (production URLs, `GATEWAY_TRANSPORT=api`, SES and PDF vars); `secrets.required`; web `RL_FORMS` 4301 and the Turnstile keys. `PAYMENTS_LIVE_ALLOWED` stays "false" and production keeps no traces or invocation logs. | B | 1 (P7-A) |
| 2 | `check-worker-config.mjs`: production equals staging's binding names, entrypoints, crons, secrets and vars keys. No staging name or id in production. No production `routes`. | B | 1 |
| 3 | `check-prod-readiness.mjs`: scan the jobs bundle for placeholders; compare staging and production for D1, R2, browser, rate limits, crons, secrets and vars; read noindex from the built `dist/_headers`; `site.launchDate` must equal the run's IST day. | B | 1 |
| 4 | `deploy-prod.yml` rebuilt on the staging shape:<br>- `stage: database \| full` and `check_web`;<br>- the tag must be on `main` and staging must have deployed that SHA;<br>- build with no token, then readiness;<br>- the D1 Time Travel bookmark, then migrations;<br>- 7 deploys in order (admin API, invoices, finance, front, portal, jobs, web), each followed by a health check.<br>Also: `deploy-worker.mjs`, a production twin of `check-staging-build.mjs`, `place-build-artifact.mjs`, and the `build:production` / `deploy:production:*` scripts. | B | 1 |
| 5 | `scripts/prod-health.mjs`: the staging health checks, pointed at the production hosts. | B | 1 |
| 6 | `noindex` only off production (it is in the shared `_headers` today). | C | 1 |
| 7 | The Turnstile build guards refuse an empty production key. | B | 1 |
| 8 | Launch-day content (the lead, in the launch tag's PR): `site.launchDate` and every legal `effective` set to the launch day; `aliasesConfirmed`; `founderBio`. | C | lead |
| 9 | Old-URL redirects (`_redirects`, Q3). | C | lead |
| 10 | Jobs gets the postal address from one source shared with the website (a core constant), so `RULE9_BLOCK` is complete. | B | 2 (P7-M) |
| 11 | N8 backups:<br>- `backup.yml` runs nightly at 21:30 UTC: a D1 export, encrypted with `age`, sent to S3 through AWS OIDC. On the 1st of each month it also makes a finance-only copy, built on the runner from `backup-scope.ts` (T7 F1: no offers in the 10-year copy).<br>- `restore-drill.yml`;<br>- `backup-monthly.mjs`;<br>- restore runbook §3;<br>- an optional weekly R2 to S3 copy (Q8). | A | 1 (P7-N8) |
| 12 | "Rebuild PDF": Owner only, with step-up, for a missing or damaged stored PDF. It re-renders from the sealed envelope, checks against `pdf_sha256`, and writes a `pdf_repairs` append-only row plus an audit row. | A | 3 (P7-R) |
| 13 | AU45, the statement's "refund returned" line: core `statement.ts`, the statements union keyset, PDF layout `statement-5`, the portal view, the copy (the lead drafts it under the owner's approval). | A | 2 (P7-S) |
| 14 | rt1 (1): the legacy `tax.lut` folded into `luts` by a data migration; the settings screen stops saving it; the legacy branches removed. | A | 2 (P7-M) |
| 15 | Gateway environment marks (finding 5). | A | 2 (P7-M) |
| 16 | `create-invite.mjs` and `reset-2fa.mjs` gain `--production` (the owner's own `wrangler login`, a typed confirmation); the portal sample and link tools keep refusing production. | A | 1 (P7-A) |
| 17 | The secret scripts take `-Environment production`, and `prod-secrets-status.mjs` lists names only. | B | 1 (P7-A) |
| 18 | RA-34: the GSTIN check tested against real GSTINs, locally only. | lead | — |
| 19 | The production paragraph in `environments.md` and CLAUDE.md. Sentry and the AWS connection come back on only on the owner's yes (Q11; rule 11). | lead | — |

### A2. Before live payments (L9), not before the first deploy
- PayPal: the cert hosts and the checkout host follow the Settings mode.
- Stripe: `livemode` follows the Settings mode.
- A live gateway reverts when the flag turns off.
- `PAYMENTS_LIVE_ALLOWED` set to "true" in every config and guard.
- The "Before going live" text.
- RA-41: Table 11A/11B and the refund voucher.
- RB-42, RB-06 and the payment descriptors.
- Live keys and webhooks, then a ₹1 live payment and refund.

### A3. After launch
- L10: TLS 1.2, the WAF rate limit, CAA, DMARC to quarantine after 2–4 weeks, the HSTS review.
- Trusted Types.
- The Sentry SDK, if deferred.
- The polish follow-ups.
- Renewals: T7 F5 by 13 May 2027, `security.txt` by 2027-10-22, the dependency allow-list by 2026-12-13.
- Delete the unused staging `events` queue.
- The production CPU reading from Workers analytics.

## B. Hosted steps (in order)
1. **Resources** (lead, connector): D1 `techaust-prod` (APAC); R2 `techaust-prod-docs` and `techaust-prod-files` (private); queues `techaust-prod-leads`, `-pdf` and `-email`, each with its `-dlq`. The Workers are created by the first secret put or the first deploy.
2. **Secrets** (owner, hidden-input scripts; names only here):

   | Worker | Secrets |
   |---|---|
   | web | `TURNSTILE_SECRET`, `FORMS_IP_PEPPER` |
   | admin front | the four sign-in keys, `TURNSTILE_SECRET` |
   | admin API and jobs | `ERASURE_HASH_KEY`, the same value on both, run once |
   | finance | the gateway TEST keys |
   | portal | `PORTAL_KEY_PEPPER`, `TURNSTILE_SECRET` |
   | jobs | `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` (a new IAM user `techaust-ses-sender-prod`), `SES_EVENTS_TOKEN`, `UNSUBSCRIBE_KEY`, the three webhook secrets, `CF_ANALYTICS_TOKEN` |
   | GitHub | `CF_API_TOKEN_PROD` in environment `production`; `CF_API_TOKEN_BACKUP` in environment `backup` |

   The three webhook secrets start as random placeholders so the deploy passes; the real values are set on launch day.
3. **Tokens** (owner): `CF_API_TOKEN_PROD` as staging's, with **no zone or DNS permission**, so a deploy can never touch techaust.com. `CF_API_TOKEN_BACKUP` for D1 export.
4. **DNS** (lead, after the owner's yes to this list):

   | Record | When |
   |---|---|
   | Custom Domains `admin.`, `portal.` and `hooks.techaust.com` | before the launch run |
   | `techaust.com`, attached to `techaust-platform-web` | after the deletion |
   | `www` | read first whether today's 301 is a zone rule (it stays) or the old Worker (then a proxied record and a redirect) |

   The SES DKIM and MAIL FROM records already exist and are verified; they are re-checked only. Attachments use `override_existing_dns_record: false`, so a conflict fails instead of replacing anything. Before showing the list, the lead reads the zone and `techaust-web`'s routes and domains (read-only).
5. **GitHub**:
   - environment `production` (reviewer `techaust`, `v*` tags only);
   - environment `backup` (`main` only);
   - `PRODUCTION_ENABLED=true` on launch day;
   - `AWS_BACKUP_ROLE_ARN`, `BACKUP_BUCKET` and `AGE_RECIPIENT`.
6. **Access**: none on the portal, hooks or web. The admin is Q2.
7. **SES**:
   - production access requested now (owner; AWS takes time);
   - the IAM user `techaust-ses-sender-prod`;
   - an EventBridge connection, API destination and rule for `https://hooks.techaust.com/ses`, filtered by the environment tag, with the matching filter added to the staging rule.
8. **Turnstile** (owner): widgets `techaust-prod-forms` (techaust.com) and `techaust-prod-signin` (admin and portal). The lead puts the public keys in the configs.
9. **Gateway webhooks**, in test mode, to `hooks.techaust.com/{razorpay,stripe,paypal}` with staging's events (after A1.15 has merged).
10. **The old Worker**: on the owner's "go" only, the lead deletes `techaust-web` with its routes and domains, then attaches the apex.
11. **First database and first Owner**: `stage=database` (migrations and seed, no sample data); later `pnpm invite --production`, once `admin.` and the sign-in widget are live.

## C. The owner's inputs that block production
Already in the config: the postal address, the LinkedIn link, the headshot. Still needed:
1. the founder bio;
2. the Zoho aliases delivering (billing@, hello@, no-reply@, privacy@, security@);
3. the launch day and hour (Q4);
4. the AWS backup bucket, the OIDC role and the `age` key pair (the private key stays offline with the owner);
5. SES production access and the production IAM key;
6. the two Turnstile widgets;
7. the two Cloudflare tokens and the GitHub settings;
8. every secret in B2;
9. J, the $5 or Free choice: the owner runs the benchmark after #189 (`suite=routes` three times, then `load`);
10. production Settings after the first sign-in: GSTIN, Udyam, bank, LUT list FY 2026-27, signature, "Email on documents", payment terms, gateway modes = test, and the next number of each series if any FY 2026-27 document was issued outside the system (Q5).

## D. Launch-day run order (rollback per 08 §6.3)

**T-3 to T-1**
1. B1, B2, B5, B7 and B8.
   - Check: `prod-secrets-status.mjs` lists every name.
   - Rollback: delete the empty resources.
2. Attach `admin.`, `portal.` and `hooks.`.
   - Check: each answers on HTTPS.
   - Rollback: detach.
3. `deploy-prod.yml stage=database`.
   - Check: the migration list matches and the seed counts are right.
   - Rollback: drop and recreate the new, empty database.
4. `backup.yml` by hand, then the restore drill into a scratch D1 and `drill:verify`. Commit `backup-verified.json` together with the launch content (A1.8), giving the launch tag.

**Launch day**

5. `PRODUCTION_ENABLED=true`; `deploy-prod.yml stage=full check_web=false`.
   - Check: the health checks for admin, portal and jobs.
   - Rollback: each Worker back to its previous version, in reverse order.
6. (Q1) Attach `launch-check.techaust.com` to web for 30 minutes or less, check web, then detach.
7. The first Owner invite. The owner enrols, fills in Settings and publishes the catalogue.
8. **The owner's explicit "go"**: delete `techaust-web`, then attach `techaust.com` (and `www`).
   - Checks: home 200; `/api/health`; no noindex; `robots.txt`, `sitemap.xml` and `security.txt`; the four old URLs answer 301; contact form → lead → email with logos; `www` 301.
   - Rollback: fix forward, or redeploy the last good tag. There is no old site to go back to (owner, 2026-11-03).
9. Gateway webhooks, then the real webhook secrets; the SES production rule's target.
   - Check: one test event per gateway shows "processed".
10. The owner's end-to-end test on production (Q5 covers test documents in the GST record).
11. `backup.yml`'s schedule on; uptime monitors (Q7); the sitemap in Search Console (owner).
12. L10, then L11 (the two-week watch); L9 when the owner says so.

## E. Questions for the owner (recommendation first)
- **Q1.** A 30-minute website check on a temporary hostname before the "go"? **Yes.** It's the only pre-check of the web Worker, since there's no fallback.
- **Q2.** Cloudflare Access in front of `admin.techaust.com`? **Yes.** It's free, adds a second lock for staff, and costs one emailed code per Access session.
- **Q3.** The redirects:
  - `/services/knowledge-systems` → `/services/ai-knowledge-assistants`
  - `/services/workforce-automation` → `/services/workflow-automation`
  - `/services/security-guard` → `/services`
  - `/calculator` → `/pricing`
- **Q4.** Launch day: a Tuesday to Thursday, 10:00 IST, after SES production access arrives. Not within 3 days of the 11th, 13th or 20th, or of month end (filing days).
- **Q5.** Production test documents: test with proformas and estimates where possible. Every tax invoice or note made in production is a real GST document, so it must be voided or credited. Tell the lead if any FY 2026-27 invoice was issued outside the system (its series continues).
- **Q6.** Lead alerts in production go to `admin@techaust.com`, as on staging.
- **Q7.** Monitoring: a free uptime monitor at launch; the Sentry SDK after launch (jobs is at 871 K of 1,000,000 bytes).
- **Q8.** A weekly R2 to S3 copy of the stored PDFs and files in the backup pipeline? **Yes.** They exist only in R2. It needs an R2 read-only key.
- **Q9.** Staging keeps running after launch, with no load tests on launch day (staging and production share the account's Free limits).
- **Q10.** One yes for the workflow changes (`deploy-prod.yml`, `backup.yml`, `restore-drill.yml`): **yes**.
- **Q11.** Turn the Sentry plugin and the AWS connection back on now (13 2026-11-04)? **Yes**, once the owner has signed the AWS connection in to the TecHaust account.

## F. Size and split (at most 2 agents at once on this PC, at most 1 with a browser)
- **Wave 1, in parallel:**
  - P7-A, production wiring (A1.1–7, 16, 17; analyst early check for the staff-auth CLIs);
  - P7-N8, backups (A1.11, Tier A).
- **Wave 2:**
  - P7-M, money fixes (A1.10, 14, 15);
  - P7-S, the AU45 data layer (A1.13).
- **Wave 3:**
  - P7-R, Rebuild PDF (A1.12);
  - then one designer for the AU45 PDF and portal view, the Rebuild PDF dialog and the LUT settings screen.
- **Lead:** A1.8, 9, 18 and 19, all of B and D.
- **Effort:** about 8–11 working days of build and review, plus 1–2 days of hosted steps and launch. The owner's waits (SES access, the AWS bucket, the inputs) run alongside.
- **Merge order:** P7-A first; the others take `main` after it (shared guards). The migrations in P7-M and P7-R are numbered at merge.

Usage: analyst agent-af9679148e0271bf5, claude-opus-5-5/high; skills `cloudflare:workers-best-practices`, `cloudflare:wrangler`, `cloudflare:cloudflare`, `cloudflare:turnstile-spin`, `aws-core:aws-messaging-and-streaming`, `aws-core:aws-iam`, `cloudflare:workers-profiling`.
