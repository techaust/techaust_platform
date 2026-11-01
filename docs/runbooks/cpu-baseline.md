# Runbook: auth CPU baseline (M1.4 gate)

**Gate (docs/09 M1.4):** login p99 ≤ **5 ms** CPU, and every route ≤ **7 ms** p99, on the Workers **Free** plan (10 ms per invocation). If it doesn't fit, I stop and ask: tune, use Cloudflare Access with simpler auth, or move to the $5 plan.

**Status:** re-measured 2026-10-21 after the tuning (PR #24): totp, salt and me pass; login p99 6 ms vs 5 (one request over the line). **Owner accepted M1.4 as passed with this exception** (2026-10-21); cold starts move to M1.5. See Results. Setup: [access-staging.md](access-staging.md) (all three parts done 2026-10-17).

**Two admin Workers (M5.0, docs/13 2026-10-27):** sign-in, account and staff routes stay in `techaust-platform-admin-staging`, so this benchmark is unchanged. Every other admin route is forwarded to `techaust-platform-admin-api-staging` through a service binding. For a forwarded request, read `cpuTimeMs` in **both** Workers' logs, joined by the request id (`rid` = `cf-ray`: the front's `ev:"fwd"` line and the API's `ev:"req"` line), and gate on the **sum**: front + API ≤ 7 ms p99, none over 10 (the Cloudflare docs don't say whether a bound Worker gets its own 10 ms).

## What is measured
The staff login routes of the staging admin Worker (`techaust-platform-admin-staging`), as designed in [05 §6.1](../05-architecture.md):

| Route | Server work |
|---|---|
| `POST /api/v1/auth/salt` | 1 D1 read; 1 HMAC (fake salt) for unknown emails |
| `POST /api/v1/auth/login` | 2 D1 reads, 1 SHA-256, 1–2 HMACs, constant-time compare; 1 D1 write on failure |
| `POST /api/v1/auth/totp` | 2 D1 reads, HMAC challenge check, AES-GCM decrypt, TOTP (3 HOTPs max), 1 D1 batch (replay guard + session + audit) |
| `GET /api/v1/auth/me` | 1 D1 read (session ⋈ user); a write at most every 15 min |
| `POST /api/v1/auth/invite/*` | Enrolment only (rare): measured, but not part of the login gate |

## How to run it (owner)
1. Right after the staging deploy of PR #7 finishes (so the first requests hit cold isolates): GitHub → **Actions → Auth CPU benchmark (staging) → Run workflow** (defaults: 12 users, 5 minutes). Only the `techaust` account can run it.
2. When it finishes, the run page shows the time window and wall-clock timings. Tell me "benchmark done".
3. The same day (log retention is short), I read **Workers Logs** for `techaust-platform-admin-staging` (Cloudflare MCP, read-only), within the run's `windowUtc`, for paths under `/api/v1/auth/`:
   - first I list the available fields (the CPU-time field name is checked, not assumed)
   - per route (`salt`, `login`, `totp`, `me`; `invite/*` separately): count, CPU p50/p99/max, wall time, outcome and status (about 1 in 10 logins is a 401 by design)
   - the first requests after the deploy (cold isolates) and the max are reported separately
   - the gate: login p99 ≤ 5 ms and every route p99 ≤ 7 ms; on a fail I stop and ask

The benchmark creates throwaway users (`@bench.invalid`) and deletes them at the end. The append-only audit log keeps their `auth.login` rows, as designed.

## Results

### Run 4 (M1.5, PR #27): 2026-10-21 IST, 15 minutes, 12 users
Run `mvhpa77n3920`, window 05:57:33–06:13:03 UTC, version `f2da33e6` only (the M1.5 Worker: minified, `zod/mini`, `hono/tiny`, 79 KB); 198 logins, 0 unexpected failures; every outcome "ok" (1,088 × 200, 19 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole ms), matched by request ID to the `ev:"req"` line (`n = 1` = first request of an isolate; 4 of 1,107 requests had no log line). Each cycle now also calls `/sessions` and `/step-up`, so there are fewer logins than in run 3. Read 2026-10-21 by the lead.

| Route | Requests | CPU p50 | CPU p99 (run 3 → 4) | CPU max | Over 10 ms | Target |
|---|---|---|---|---|---|---|
| salt | 190 | 1 ms | 7 → **4 ms** | 7 ms | 0 | ≤ 7 ms ✅ |
| login | 191 | 2 ms | 6 → **5 ms** | 13 ms | 1 (warm) | ≤ 6 ms ✅ (also the original 5 ms) |
| totp | 172 | 3 ms | 7 → **7 ms** | 13 ms | 1 (warm) | ≤ 7 ms ✅ |
| me | 176 | 1 ms | 3 → **3 ms** | 8 ms | 0 | ≤ 7 ms ✅ |
| sessions (new) | 173 | 2 ms | **7 ms** | 8 ms | 0 | ≤ 7 ms ✅ |
| step-up (new) | 171 | 3 ms | **6 ms** | 7 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 1–5 ms | 4–13 ms | 13 ms (invite/totp) | 1 | — |

- **Histograms** (ms: count). login: 1:43, 2:119, 3:22, 4:4, 5:2, 13:1. totp: 1:9, 2:66, 3:55, 4:24, 5:15, 6:1, 7:1, 13:1. sessions: 1:23, 2:99, 3:36, 4:10, 5:3, 7:1, 8:1. step-up: 1:1, 2:60, 3:76, 4:25, 5:5, 6:3, 7:1.
- **Cold starts:** 5 isolates; their first requests cost 4, 4, 4, 3 and 7 ms (4 on salt, 1 on me). Run 3: 6–14 ms with 2 of 8 over 10. **Every `n = 1` request ≤ 10 ms ✅.**
- **Over 10 ms:** 3 of 1,107 requests, all warm, scattered (login 13, totp 13, invite/totp 13); Cloudflare lets these finish but doesn't promise to.
- **Wall clock** (GitHub runner in the US, not gated): login p50 508 / p99 682 ms, totp 523 / 740, step-up 725 / 885.

### Verdict (run 4): M1.5 targets met (lead, 2026-10-21)
Every gated route's p99 is within target, login p99 is 5 ms, and the cold-start fix worked (first requests 3–7 ms, was up to 14). Three warm requests in 1,107 reached 13 ms; worth watching in M7.5's budget audit, not a blocker. The $5 plan question (before real staff use) stands as recorded.


### Run 3 (after the tuning, PR #24): 2026-10-21 IST (2026-10-20 UTC), 15 minutes, 12 users
Run `mvh4cyuc5298`, window ≈ 20:11:51–20:27:20 UTC, version `392f8376` only; 375 logins, 0 unexpected failures; every outcome "ok" (1,415 × 200, 36 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole ms), each request matched by request ID to its `ev:"auth"` line (`n = 1` = first request of an isolate; 25 of 1,451 requests had no log line). Read 2026-10-21.

| Route | Requests | CPU p50 | CPU p99 (run 2 → 3) | CPU max | Over 10 ms | Gate |
|---|---|---|---|---|---|---|
| salt | 374 | 1 ms | 5 → **7 ms** | 14 ms | 2 (both cold) | ≤ 7 ms ✅ |
| login | 380 | 1 ms | 6 → **6 ms** | 10 ms | 0 | ≤ 5 ms ❌ (by one request) |
| totp | 339 | 2 ms | 12 → **7 ms** | 9 ms | **0** (was 4) | ≤ 7 ms ✅ |
| me | 324 | 1 ms | 3 → **3 ms** | 3 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 2 ms | 8 ms | 8 ms | 0 | — |

- **Histograms** (ms: count). login: 0:4, 1:256, 2:89, 3:16, 4:6, 5:5, 6:2, 8:1, 10:1 (376 of 380 ≤ 5 ms; the p99 is the 377th). totp: 1:61, 2:150, 3:63, 4:42, 5:12, 6:5, 7:3, 8:1, 9:2.
- **By status:** login 200 p50 1 / p99 6 / max 10 (344); login 401 p50 1 / p99 5 / max 5 (36).
- **Cold vs warm:** 8 isolates. Their first requests cost 6, 7, 7, 7, 8, 10, 13, 14 ms (7 on salt, 1 on invite). Warm salt p99 is 3 ms (max 4); warm login and totp match the totals above.
- **Wall clock** (GitHub runner in the US): login p50 262 / p99 564 ms, totp 523 / 627 ms (was ~980), not part of the gate.

### Verdict (run 3): accepted as passed with an exception (owner, 2026-10-21)
- The tuning worked where it mattered: totp p99 12 → 7 ms and nothing warm over 10 ms.
- Login p99 is 6 ms against the 5 ms margin, decided by one request of 380; its max is exactly 10 ms.
- Cold starts (module load on a fresh isolate) cost 6–14 ms; 2 of 8 went over 10 ms and Cloudflare let them finish, which it doesn't promise. Reducing cold-start cost is part of M1.5.
- The $5 plan is looked at again before staff use the admin for real work.

### Run 2 (decisive): 2026-10-17, 15 minutes, 12 users
Run `mvcbujlie045`, window 11:42:37–11:58:28 UTC, version `7361380c`; 382 logins, 0 unexpected failures; every request outcome "ok" (1,610 × 200, 37 × 401 by design). CPU from Workers Logs (`$workers.cpuTimeMs`, whole milliseconds; read 2026-10-17).

| Route | Requests | CPU p50 | CPU p99 | CPU max | Over 10 ms | Gate |
|---|---|---|---|---|---|---|
| salt | 432 | 1 ms | 5 ms | 7 ms | 0 | ≤ 7 ms ✅ |
| login | 419 | 2 ms | **6 ms** | 8 ms | 0 | ≤ 5 ms ❌ |
| totp | 388 | 4 ms | **12 ms** | 16 ms | **4** | ≤ 7 ms ❌ |
| me | 373 | 1 ms | 3 ms | 6 ms | 0 | ≤ 7 ms ✅ |
| invite/* (not gated) | 34 | 2–4 ms | — | 15 ms (first request) | 2 | — |

CPU histograms (ms: count). login: 1:176, 2:159, 3:56, 4:13, 5:10, 6:3, 7:1, 8:1. totp: 2:129, 3:59, 4:81, 5:71, 6:22, 7:11, 8:8, 9:3, 12:1, 14:1, 16:2.

### Run 1: 2026-10-17, 5 minutes, 12 users
Run `mvcb9b836a40`, window 11:26:06–11:31:57 UTC; 143 logins, 0 unexpected failures. login p50 2 / p99 7 / max 7 ms (148 requests); totp 4 / 7 / 16 ms (157); salt 1 / 3 / 6 ms (163); me 1 / 3 / 6 ms (140). Too few requests for a stable p99, so run 2 was made (owner decision).

### Verdict (runs 1–2): gate failed (owner decision 2026-10-17: tune, then re-measure)
- The spikes are scattered through both runs, not cold starts; most requests are cheap.
- totp is the main problem: about 1 % of requests exceed the Free plan's 10 ms (Cloudflare let them finish, but it may cut them off).
- Next: the analyst diagnoses where login and totp spend CPU; a builder tunes (Tier A); the 15-minute run is repeated. If tuning can't meet the gate, the owner chooses between the $5 plan and Access + simpler auth.
- Wall-clock times (GitHub runner in the US → MSP colo): login ~240 ms, totp ~980 ms (D1 batch), not part of the gate.

**Browser Argon2id** (m = 19 MiB, t = 2, p = 1; the sign-in page shows the time):
- this PC (owner's Windows machine, local dev): **86–92 ms**
- mid-range Android phone: _optional; open the staging sign-in page on your phone and tell me the number shown_ (target ≤ 800 ms)

## Per-milestone cold reading (M3.4–M4.5 batch, lead 2026-10-25)
After each batch PR deploys to staging, read `$workers.cpuTimeMs` of the first (cold) requests in Workers Logs for `/auth/me`, `/auth/salt` and the milestone's heaviest GET and POST. Pass: each ≤ 7 ms, none above 10. The build-time guard (`scripts/worker-budget.mjs`) is only a local proxy.

**The three admin Workers (M6.1 stage A, ADM-PAY-01).** Since M6.1 the admin API is split again: the finance Worker (`techaust-platform-admin-finance-staging`, `apps/admin/wrangler.finance.jsonc`) answers the invoice, statement, report, approval and dashboard routes and the jobs Worker's `BillingJobs` calls. Its cold reading is its own row: read the first request after a deploy of `/api/v1/dashboard` and `/api/v1/invoices` (the front's forwarder and the finance Worker's root spans share `cloudflare.ray_id`; add their CPU), and the first `care.bill` RPC. A fourth Worker or another cut is planned when the finance bundle passes **650,000 bytes** (the budget's `planBytes`; the build prints a note) or its cold reading passes **7 ms**.

| Worker | Bundle (local build) | Startup (local probe, fastest of 7) | Cold reading on staging |
|---|---|---|---|
| admin front | 99,435 bytes (M6.1 stage A) | 13.7 ms | **10–14 ms** cold (2026-10-31: `/auth/me` 12, `/auth/salt` 10, `/auth/login` 14, `/auth/totp` 11); `/users` 11 warm |
| admin API | 420,289 bytes (M6.1 stage A; 618,422 on main before the split) | 54.6 ms | **15 ms** cold (`/notifications`), then 6–10 ms (`/settings` 9, `/notifications` 10, `/leads/assignees` 8) |
| admin finance (new) | 431,070 bytes (M6.1 stage A) | 48.0 ms | **16 ms** cold (`/dashboard`); `/invoices/:id` **18** and **17** (two isolates), 7 later; `POST /payments` 13; no `care.bill` RPC yet |
| jobs | 667,870 bytes (L9, PR #138: minified, source maps uploaded; 994,592 before, ceiling 1,000,000; the staging dry run the same, since `minify` is inherited) | 74.7 ms | no queue-consumer reading yet (see "Queue consumers" below) |

**The admin Workers' start-up dry run (CPU warm-up, 2026-11-02; [run file](../runs/cpu-warmup.md)).** While each admin Worker's module loads, it sends its hot routes through a second, warm instance of its own app over a made-up D1 (`apps/admin/worker/warm-routes.ts`), so V8 has compiled them before the first metered request. The made-up rows are generated, never hand-written, in `apps/admin/worker/warm-fixtures/{front,api,finance}.ts`. **When a hot route's SQL or columns change, regenerate them:**
1. Build the admin and jobs Workers: `bash tools/heavy.sh --log admin-build pnpm --filter @techaust/admin build`, then `bash tools/heavy.sh --log jobs-build pnpm --filter @techaust/jobs build`.
2. Write the fixtures from the local probe's made-up sample set: `bash tools/heavy.sh --log warm-fixtures node scripts/cpu-probe.mjs --write-fixtures`.
3. Run `pnpm --filter @techaust/admin exec vitest run worker/warm-routes.test.ts worker/warm-fixtures.test.ts`, rebuild the admin Workers and commit the three fixture files.

The front fixture holds a made-up Owner's sign-in rows (a password HMAC, a salt, a client hash), credential-shaped by design. `.gitleaks.toml` (it extends gitleaks' default rules) allows that one folder and nothing else, and `warm-fixtures.test.ts` proves every such value verifies only under the admin tests' `TEST_KEY` values. Never write a secret-looking literal anywhere else: build test values at run time.

`warm-routes.test.ts` fails a stale fixture: a read the answer book doesn't hold, a list call whose list answers no rows, a changed status or a refused operation (random values, timers, I/O) at start-up. The budget's start-up figure (`scripts/worker-budget.mjs`) includes the dry run's microtasks.

**Jobs minified (L9, owner 2026-10-31).** The jobs Worker is built with `"minify": true` and `"upload_source_maps": true` at the top level (inherited by `env.staging` and `env.production`); `scripts/check-worker-config.mjs` fails a config that drops either or switches one off in an environment. Source maps don't count toward the bundle size, CPU or cold start (Cloudflare's Source maps page and its 2026-10-20 changelog). Since minify drops the path comments and renames constants, `scripts/worker-budget.mjs` checks the jobs bundle's inputs from the build's metafile (`forbiddenInputs`), and the startup probe strips a `//# sourceMappingURL=` comment after the export list.

### M6.1 reading (lead, 2026-10-31, Workers Logs read-only, the owner's approval session 17:51–18:06 UTC): **gate not met**
147 admin requests in 3 hours, every outcome `ok` (none stopped for CPU), median 1 ms (front), 3 ms (API), 5 ms (finance). Over the "≤ 7 ms, none above 10" line: the first requests on each Worker (front auth 10–14, API 15, finance dashboard 16) and the finance invoice detail (18 and 17 on two isolates, 7 on a warm one), `POST /payments` 13. M1.5's fix had brought first requests to 3–7 ms on a 79 KB front; the front is now 100,839 bytes. Cloudflare let every one finish, which it doesn't promise. **Follow-up:** an analyst diagnosis (startup work that runs on the first request, the invoice detail's statements, `ledger_result_check`) before M6.2's API stage adds webhook processing to the finance Worker.

### M6.2 reading (lead, 2026-11-01, Workers Logs read-only, the owner's approval session 17:22–17:30 UTC): **gate not met (same pattern as M6.1)**
222 staging invocations in 3 hours, every outcome `ok` (none stopped for CPU); 19 above 7 ms, 8 above 10. Two sandbox payments: an invoice paid through a staff link, and a proforma paid through a link that went to Needs review (`gateway.advance` `blocked`) and was issued by the Owner from "Confirm by issuing" (`POST …/advance-invoice` 11 ms).
- **The webhook path is inside the gate:** jobs `POST /razorpay` 6, 3, 8, 6 ms (JOB-HOOK-03 asks ≤ 5 p99: two of four above it); the finance `GatewayEvents` RPC 9, 8, 7; the `gateway.event` consumer 1, 1; `POST …/payment-link` 8 and 6.
- **First requests per isolate are over:** finance `POST …/issue` 17 (then 6), `GET /invoices/:id` 16 (then 3–6), `PATCH /invoices/:id` 12 (then 8), `GET …/payments` 14 once; front `POST /auth/totp` 11; API `/notifications` 10, `/leads` 10. Warm requests are 0–6 ms.
- **PDF renders** (`pdf.rendered`, Browser Run): 22, 12 and 10 ms CPU (11–12 s wall); `pdf.snapshot` 10 and 6.
- **Follow-up:** the bigger warm-up task (12 "Next"), then a re-measure; the owner decides the Workers Paid plan before launch.

## Traces (staging only, full audit A6 9, owner's yes 2026-10-30)
**What is on.** Every staging Worker (web, admin front, admin API, admin finance since M6.1, portal, jobs) has Workers Traces on at a head sampling rate of **0.1** (about 1 invocation in 10 is traced, decided when it arrives), in `env.staging.observability` of its `wrangler*.jsonc`. Logs are unchanged: on, invocation logs on, not sampled, so the CPU readings above still come from every request. Production has no traces and no invocation logs. `scripts/check-worker-config.mjs` (in `pnpm check` and CI) keeps it that way: traces off at the top level and in production, the rate exactly 0.1 on staging, and the admin Workers alike (three since M6.1).

**Free plan limits** (Cloudflare docs read 2026-10-30 through Context7: "Workers traces, Limits and pricing", "Cloudflare Observability pricing", "Traces configuration, Head sampling", "Workers Logs pricing"):
- traces are kept **7 days** (Workers Logs on the Free plan: 3 days);
- until 2026-11-30, Workers Logs on the Free plan allow **200,000 log events a day**; the traces page names no separate traces allowance before 2026-12-01;
- from **2026-12-01**, logs and traces both move to Cloudflare Observability pricing: the Free plan includes **0.5 GB ingested a day** for the whole account and no paid extra; when it is used up, ingestion stops for the rest of that day (nothing is charged, but later logs and traces that day are lost).

**Why 0.1 (headroom).** Staging runs at most about 10,000 invocations a day across the five Workers (an estimate: the queue work is about 1,000 operations a day per full audit A6, and a 15-minute benchmark is about 1,100 requests). The docs give no size per span, so this assumes a generous **50 KB per traced invocation** (a D1 batch or a PDF render has many spans): 10 % of 10,000 is 1,000 traces, about **50 MB a day, 10 % of the 0.5 GB**, leaving the rest for the unsampled logs. After the first week, check the real volume in the dashboard (**Workers & Pages → Observability**) and record it here; if traces take more than a quarter of the allowance, lower the rate in all five configs and in the guard together. No paid plan is turned on for this (CLAUDE.md rule 9).

**How to read a trace for the CPU baseline** (the lead, read-only, within 7 days of the run):
1. Cloudflare dashboard → **Workers & Pages** → the staging Worker (for example `techaust-platform-jobs-staging`) → **Observability**, then its traces (or the account-wide **Workers & Pages → Observability**, filtered by the Worker). The Cloudflare MCP server (read-only) can query the same telemetry.
2. Filter the root spans by trigger: `cloudflare.handler_type` = `fetch`, `scheduled` or **`queue`** (or `faas.trigger` = `http`, `cron`, `queue`). The root span carries **`cloudflare.cpu_time_ms`**, `cloudflare.wall_time_ms` and **`cloudflare.outcome`** (`ok`, `exception`, `exceededCpu`, `exceededMemory`).
3. Open a trace: the child spans show where the wall time went (each D1 call with `db.query.text`, `cloudflare.d1.response.rows_read` and `sql_duration_ms`; R2; queue sends; outbound `fetch` such as SES; the RPC call from jobs to the admin finance Worker's `BillingJobs`, the admin API's before M6.1). CPU time is only on the root span, so a slow child span is waiting, not CPU.
4. For a forwarded admin request, the front's and the API (or finance) Worker's root spans share the request id (`cloudflare.ray_id`): add their CPU, as in the gate at the top.
5. Record per route or per message kind: count, CPU p50/p99/max from the root spans (or, for every invocation, from the invocation logs' `$workers.cpuTimeMs`, which are not sampled), and any `exceededCpu`.

**Queue consumers (no readings yet, full audit A6 9).** The jobs Worker's `queue` handler takes one message per invocation (`max_batch_size` 1) from the leads, email and PDF queues. The message kind is not a span attribute: take it from the invocation's own log lines (the dashboard shows a trace's logs with it). Read after a day of normal staging use and after a PDF burst: `pdf.snapshot`, `pdf.render`, `pdf.certificate` (Browser Run: mostly wall time), the email consumer (SES `fetch`), `lead.purge`, `care.bill`, `care.issue`, `reminder.send`, `offer.send` and the 09:00 IST batch (`alerts.daily`, `realisation.scan`). Pass: each kind's p99 ≤ 7 ms CPU and none over 10 (CLAUDE.md rule 9 counts queue consumers in the Free plan's 10 ms; full audit A6 left the real limit on staging "not verified"). Add the table under Results.
