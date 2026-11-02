Status: PR open (auto-merge); staging reading after deploy
Tier: B (Workers; docs/14 §2)
Usage: builder claude-opus-5-5/high (workers-profiling, workers-best-practices, wrangler; 5-h 19 % at start); analyst early check claude-opus-5-5/high (workers-profiling, workers-best-practices, wrangler; 5-h 10 % at start); builder fix round claude-opus-5-5/high (workers-profiling, workers-best-practices, wrangler); reviewer claude-opus-5-5/high (code-review high, security-review, workers-best-practices, workers-profiling; 5-h 55 % at start); builder review fixes claude-opus-5-5/high (workers-best-practices, workers-profiling; 5-h 71 % at start)

# CPU warm-up of the hot request paths (2026-11-01)

## Why
The Free plan stops an invocation at **10 ms CPU**; our gate is **≤ 7 ms on a first request, none above 10** ([cpu-baseline](../runbooks/cpu-baseline.md)). After M6.2 the staging reading (cpu-baseline "M6.2 reading", 2026-11-01) is still over on the **first request each route gets in a fresh isolate**: admin finance `POST /invoices/:id/issue` 17, `GET /invoices/:id` 16, `GET /invoices/:id/payments` 14, `PATCH /invoices/:id` 12, `POST …/advance-invoice` 11; front `POST /auth/totp` 11; admin API `/notifications` 10, `/leads` 10. Warm requests are 0–6 ms. Every outcome was `ok`, but Cloudflare doesn't promise to let a request over 10 ms finish.

The analyst's diagnosis ([m6.2 run file](m6.2-razorpay.md) "CPU diagnosis", 2026-11-01): the cost is **not module start-up but the first run of each route's own code in an isolate** (V8 lazy compilation, cold inline caches, route regexes), all inside the metered request. Running a path once beforehand removed ~85 % locally (first invoice detail 8.0 → 1.3 ms, dashboard 6.9 → 1.0 ms). Staging reads about ×2.3–3.4 the local figure, so a hot route needs **≤ ~2.5 ms local first-request** to land ≤ 7 ms on staging. Already on main from M6.2: `warmRouter` in all three admin Workers, schema and gateway warm-ups (`warm-finance.ts`, `warm-api.ts`, `warm-front.ts`, `invoice-warm.ts`, `document-warm.ts`), the per-isolate settings cache, the `f:1` first-run marker on `ev:"req"`/`ev:"fwd"`/RPC log lines.

This task is the analyst's separate items (b)1–(b)4. After it deploys, the owner runs a short staging session, the lead reads the figures, and the owner decides the $5 Workers Paid plan before launch (12 "Next" 2).

## Brief (builder, then the analyst's early check, then the reviewer)
**Branch:** create `feat/cpu-warmup-build` from `origin/feat/cpu-warmup` in your worktree; push only that.

**Load first:** `cloudflare:workers-profiling`, `cloudflare:workers-best-practices`, `cloudflare:wrangler`.

1. **(b)4 first, the measuring tool:** a local first-request probe (`scripts/cpu-probe.mjs` or a test helper, advisory, not in CI's pass/fail) that builds the real minified bundles of the three admin Workers (and jobs' webhook path), loads each in a fresh process with D1 stood in (the analyst used `node:sqlite` with all migrations applied and a sample data set) and times the **first** and a later call of each hot route: the eight routes above plus `GET /dashboard`, `GET /invoices`, `GET /payments/review`, `GET /auth/me`, the `GatewayEvents` RPC and jobs `POST /razorpay`. Record the baseline table in this file before changing anything.
2. **(b)1 the fixture warm-up** (the biggest lever): at module top level, run each hot route's **own pure code** once on made-up fixtures, so V8 compiles it and its inline caches warm before the first request. What can run at top level is limited (local workerd allows `new Request` for a bodiless GET, `Headers`, `Intl`, `crypto.subtle`; refuses `Response`, bodies, `getRandomValues`, `randomUUID`; no `env`, no D1, no I/O). So split where needed: the row-to-view mapping, the model and totals building, the tax engine call, the serialiser, the step-up and permission decisions, the TOTP check on a made-up secret, the notifications and leads list shaping. Refactor a handler only to separate its pure part, never to change what it returns. Each warm-up returns a count that a test pins, never throws (a failure returns 0 and the Worker still starts), stores nothing, logs nothing. Made-up data only (`@example.test`, "Sample client"), never real or personal data.
3. **(b)2 the front's router:** the front holds ~184 rows, 155 of them forwarder rows run through `hono/tiny`'s PatternRouter regexes. Use Hono's `TrieRouter` (or `RegExpRouter` if it measures better) and a **single forwarder catch-all per target** in place of the 155 rows, keeping exactly today's behaviour: the same rows forwarded to the same Worker, deny by default, CSRF and the guard as now, `split.test.ts` and the parity tests green (extend them if the catch-all needs it). Measure before and after with the probe.
4. **(b)3 trim the invoice detail:** `GET /invoices/:id` runs a 21-statement batch plus a second 3-statement batch; fold the second (the note reads) into the first if the result is identical, with a test that the response is byte-for-byte the same on the sample set.
5. **Budget:** the byte ceilings and startup ≤ 200 ms (`scripts/worker-budget.mjs`) still pass; report each Worker's new bytes and startup (front 102,708 / API 478,770 / finance 580,664 before M6.3). Startup isn't metered by the Free plan's 10 ms, but keep each warm-up small (aim ≤ 20 ms added startup per Worker locally).
6. **Target:** the probe shows every hot route's first request ≤ 2.5 ms locally (or the best reached, with the reason for any that can't).

**Rules:** Tier B; commit at each finished item and at least every 20 minutes; heavy commands only through `bash tools/heavy.sh --log <name> …` (a Stripe builder runs in parallel and shares the queue; it works in `packages/db`, `packages/core` and later the finance gateway, so **don't touch `apps/admin/worker/gateway/`, `packages/db/src/gateway.ts`, migrations or the Razorpay code** beyond warming it); no hosted change, nothing deployed; no change to any response, permission, audit row or log key except as stated. Stop after items 1–5 for the analyst's early check, with the probe tables before and after.

**Report** (append "Builder report" here, committed and pushed): the probe tables, what each item changed (files), tests and checks (`pnpm check`, admin and jobs tests), bytes and startup, what wasn't verified, open questions, the `Usage:` line.

## After the build
Analyst's early check → reviewer (code; no screens) → fixes → PR (auto-merge) → staging → the owner's short session (sign in, dashboard, three invoices, a payments panel, the list, approvals, settings, clients, notifications; again after 3 minutes) → the lead reads first runs by `f:1` (pass ≤ 7 ms first, none above 10) → the owner's Workers Paid plan decision.

## Probe baseline (builder, 2026-11-02, before any change; code `112b5c34`)
`bash tools/heavy.sh --log warm-probe-base2 node scripts/cpu-probe.mjs --runs 7 --later 4` on this PC (Node 24.19.0, Windows), local builds (`vite build`, jobs `wrangler deploy --dry-run`). Milliseconds of wall time minus SQLite time, `waitUntil` included; "first" = the first call of that route in a fresh process after start-up, median of 7 processes; "later" = the median of the next 4 calls. Forwarded rows: `fwd …` is the front's share with a target that answers at once; the answering Worker's own row is listed separately (the staging gate adds them). The floor (`GET /health`, no session) is the middleware chain's own first run.

| Case | Worker | First (median of 7) | First min-max | Later (median) | Status | D1 statements (first) |
|---|---|---|---|---|---|---|
| GET /health | front | 3.1 | 2.0-3.7 | 0.2 | 200 | 0 |
| GET /auth/me | front | 4.6 | 3.8-4.9 | 0.9 | 200 | 2 |
| POST /auth/totp | front | 8.1 | 6.7-15.8 | 2.3 | 200 | 10 |
| fwd GET /invoices/:id | front | 1.3 | 1.0-1.9 | 0.1 | 200 | 0 |
| fwd POST /invoices/:id/issue | front | 1.3 | 1.2-1.8 | 0.2 | 200 | 0 |
| fwd GET /notifications | front | 1.5 | 1.1-1.6 | 0.1 | 200 | 0 |
| fwd GET /leads | front | 1.4 | 1.2-1.8 | 0.2 | 200 | 0 |
| fwd GET /dashboard | front | 1.5 | 1.1-1.7 | 0.2 | 200 | 0 |
| POST /invoices/:id/issue | finance | 10.9 | 9.4-12.6 | 2.2 | 200 | 33 |
| GET /invoices/:id | finance | 8.9 | 8.0-11.3 | 1.8 | 200 | 26 |
| GET /invoices/:id/payments | finance | 4.6 | 3.9-5.4 | 1.2 | 200 | 12 |
| PATCH /invoices/:id | finance | 12.7 | 10.0-19.7 | 2.5 | 200 | 24 |
| POST /invoices/:id/advance-invoice | finance | 13.7 | 10.2-15.9 | 2.6 | 201 | 40 |
| GET /dashboard | finance | 7.1 | 5.3-8.8 | 1.6 | 200 | 25 |
| GET /invoices | finance | 4.3 | 4.0-5.2 | 1.2 | 200 | 7 |
| GET /payments/review | finance | 3.3 | 3.1-4.5 | 1.0 | 200 | 4 |
| GET /notifications | api | 3.9 | 3.8-4.4 | 1.1 | 200 | 4 |
| GET /leads | api | 4.4 | 3.8-8.2 | 1.2 | 200 | 3 |
| rpc GatewayEvents.processEvent | finance | 6.5 | 4.7-13.1 | 1.4 | 200 | 21 |
| jobs POST /razorpay | jobs | 3.5 | 3.4-4.5 | 0.9 | 200 | 2 |

Reading: the analyst's harness read the invoice detail at 8.0 ms first, this one 8.9; staging read 16 (×1.8), the issue 17 vs 10.9 (×1.6), the PATCH 12 vs 12.7 (×1.0). Against this probe the staging factor looks nearer ×1–1.8 than ×2.3–3.4, so ≤ 2.5 ms local is a conservative target.

## Builder report: Early check (builder, 2026-11-02)
Branch `feat/cpu-warmup-build` (from `origin/feat/cpu-warmup` `112b5c34`, pushed; head `4fdb4aff` plus this report). Items 1–5 done; stopped for the analyst's early check. No screens, no hosted change, nothing deployed, no dev server started.

**Skills loaded:** `cloudflare:workers-profiling` (shaped the probe: first-call timing, V8 CPU profiles of the first call mapped through source maps, `--profile`); `cloudflare:workers-best-practices` (no module-level request state: the warm app is a second instance with closure-constant `warm`; no `ctx` destructuring; generated `Env` kept; the made-up env is the only cast); `cloudflare:wrangler` (builds only, `wrangler deploy --dry-run` for jobs; no remote command). Library docs: none needed beyond the installed Hono 4.13.13 sources (TrieRouter, PatternRouter, HonoRequest body cache) read locally.

### Probe after (same command and machine, `--runs 7 --later 4`, `.logs/cpu-probe-after.json`)
| Case | Worker | First before | First after (min-max) | Later after | D1 statements (first) |
|---|---|---|---|---|---|
| GET /health | front | 3.1 | **0.7** (0.6-1.1) | 0.2 | 0 |
| GET /auth/me | front | 4.6 | **1.6** (1.5-2.0) | 0.9 | 2 |
| POST /auth/salt (new case) | front | – | **1.4** (1.1-2.7) | 0.5 | 1 |
| POST /auth/login (new case) | front | – | **2.6** (2.5-3.3) | 1.5 | 5 |
| POST /auth/totp | front | 8.1 | **3.9** (3.7-6.4) | 1.9 | 10 |
| fwd GET /invoices/:id | front | 1.3 | **0.7** (0.5-1.5) | 0.2 | 0 |
| fwd POST /invoices/:id/issue | front | 1.3 | **0.6** (0.6-1.0) | 0.2 | 0 |
| fwd GET /notifications | front | 1.5 | **0.6** (0.5-1.4) | 0.1 | 0 |
| fwd GET /leads | front | 1.4 | **0.6** (0.5-1.0) | 0.1 | 0 |
| fwd GET /dashboard | front | 1.5 | **0.6** (0.6-0.6) | 0.1 | 0 |
| POST /invoices/:id/issue | finance | 10.9 | **4.0** (3.8-6.7) | 2.0 | 33 |
| GET /invoices/:id | finance | 8.9 | **3.2** (2.9-5.2) | 1.6 | 32 (one batch) |
| GET /invoices/:id/payments | finance | 4.6 | **2.0** (1.8-3.0) | 1.0 | 12 |
| PATCH /invoices/:id | finance | 12.7 | **6.9** (4.1-11.1) | 2.5 | 24 |
| POST /invoices/:id/advance-invoice | finance | 13.7 | **5.0** (4.6-7.1) | 2.1 | 40 |
| GET /dashboard | finance | 7.1 | **3.2** (2.5-8.6) | 1.6 | 25 |
| GET /invoices | finance | 4.3 | **2.0** (1.9-11.0) | 1.1 | 7 |
| GET /payments/review | finance | 3.3 | **1.8** (1.7-3.5) | 1.0 | 4 |
| GET /approvals (new case) | finance | – | **2.0** (1.7-2.7) | 1.0 | 3 |
| GET /notifications | api | 3.9 | **1.8** (1.7-1.8) | 1.0 | 4 |
| GET /settings (new case) | api | – | **2.2** (2.0-7.8) | 1.4 | 4 |
| GET /clients (new case) | api | – | **1.7** (1.6-2.0) | 1.1 | 3 |
| GET /clients/:id (new case) | api | – | **1.9** (1.7-3.0) | 1.2 | 7 |
| GET /leads | api | 4.4 | **1.9** (1.7-2.3) | 1.1 | 3 |
| rpc GatewayEvents.processEvent | finance | 6.5 | 4.6 (4.0-6.9) | 1.2 | 21 |
| jobs POST /razorpay | jobs | 3.5 | 3.6 (3.6-5.0) | 0.8 | 2 |

**Target (≤ 2.5 ms first, local):** met by every GET and forward, salt and the payments panel; the invoice detail and dashboard are 3.2 (from 8.9 and 7.1). Not met: TOTP 3.9, issue 4.0, advance 5.0, PATCH 6.9 (noisy: 4.1–11.1), the RPC 4.6 and the jobs hook 3.6. **Why:** global scope refuses random values, and every write (issue, PATCH, advance, the TOTP session) makes its first new id (`uuidv7` in `mutate`, the session token) before its batch, so the dry run stops there (a probe experiment with random values allowed brought the three writes only to 4.8/4.8/5.7, so the rest is the real data's branches, the settings parse of real rows and `Date.now()` reading 0 at start-up). The RPC and the hook were not dry-run: the RPC's Razorpay re-fetch (the stub answers with a body) and the hook's raw body stream both need what global scope refuses; they keep M6.2's `warmGateway`/`warmRazorpayHook`. The machine was shared with another project's builds all session; the figures move ±1 ms between runs.

### What changed, per item
1. **(b)4 the probe** (`scripts/cpu-probe.mjs`, `scripts/cpu-probe-runtime.mjs` + `.d.mts`, test `packages/core/test/cpu-probe.test.ts`): a seed process loads the real built bundles (front, API, finance, jobs) into one Node process over a `node:sqlite` D1 (every migration + the seed), enrols a made-up Owner through the API (invite, Argon2id, TOTP) and makes the e2e sample set (`apps/admin/e2e/sample-data.ts`) plus drafts, proformas, payment links and signed webhook events; then each case runs in fresh processes on a copy of that database: Node's own fetch/WebCrypto start-up is paid first (a throwaway Hono app from node_modules), the bundle is imported **under workerd's global-scope rules** (checked in local workerd 1.20261001.1 with Miniflare: a Response or Request with a body, `Response.json`, random values, timers and fetch refused; `Date.now()` reads 0; bodiless Response/Request, Headers, `crypto.subtle` and microtasks allowed), and the first and later calls are timed as wall time minus SQLite time, `waitUntil` included. Extras: `--profile <dir>` (V8 profile of the first call), `--capture <dir>` (the first call's D1 statements), `--write-fixtures` (item 2). Advisory, not in CI.
2. **(b)1 the start-up dry run** (`apps/admin/worker/warm-routes.ts`, `warm-fixtures/{front,api,finance}.ts` generated, `app.ts`, `forward.ts`, `index.ts`, `api.ts`, `finance.ts`, `warm-front.ts`, test `warm-routes.test.ts`). **Departure from the brief's method, for the analyst:** instead of splitting each handler's pure part, each Worker sends its hot routes through a **second instance of its own app** (`createApp(..., { warm: true })`: the same middleware, guard, validators, handlers, models, views and serialiser) on a made-up env whose D1 is an in-memory answer book (`warmDb`, keyed by FNV-1a of the SQL, rows captured by `--write-fixtures` from the made-up sample set; a write answers "1 row changed" and is dropped; queues, R2 and service bindings drop everything). Reason: the floor (`GET /health`, 3.1 ms) and every route's guard, CSRF, validators and serialiser are Hono pipeline code no pure call reaches; the dry run took the floor to 0.7. The warm instance differs only where it must: no request number, no `f: 1` mark, no log line, no access row, a fixed request id, the JSON body handed to Hono's body cache (global scope refuses a Request with a body), `c.json` answering without a body (it still runs `JSON.stringify`), errors answered silently. No handler was changed. Real apps are built without `warm`, so no response, permission, audit row or log key changes (`logs.test.ts`, `split.test.ts`, `rbac.test.ts` green). The test runs the three dry runs under emulated global-scope rules and pins each call's status (finance 6 of 9 answer, the three writes stop at their first new id; API 5 of 5; front 9 of 10, TOTP stops at the session token), and proves no log line, no request counted, no first-run mark, never throws. Fixture writes are pruned to the reads before a write's first statement (`stopsAtNewId`) and a draft's unread `computed` is left out. The front's made-up sign-in keys live in `warm-front.ts` (front only; `split.test.ts`'s secret-name scan allows that one file and checks the API and finance entries never import it).
3. **(b)2 the front's router** (`forward.ts`, `index.ts`, tests in `split.test.ts`, `warm-router.test.ts`): one `/api/v1/*` catch-all looks the request up in a **TrieRouter** table of the 155 forwarded rows and forwards for the first match in table order, else `next()` to the front's own rows (undeclared → the front's 404 as before). One trailing slash is allowed as PatternRouter allowed it (found by the new test). `split.test.ts` compares the table with the old per-row PatternRouter on every row's sample path plus `/`, `/x`, `/defaults`, `/new` variants and odd paths, all six methods (> 1,000 comparisons); the fidelity, parity, undeclared-path and 502 tests are unchanged and green. The front's own 24 rows stay on `hono/tiny`'s PatternRouter: switching the main app to TrieRouter dropped the trailing-slash match of the front's own rows (a behaviour change), so I kept it.
4. **(b)3 the invoice detail** (`invoices.ts`, test `invoices-detail-batch.test.ts`): the note reads (an issued invoice's notes, a note's invoice) join the first batch (21 + 9 statements, one D1 call; for other types they find no row); the handler is split into `readInvoiceDetail` + `invoiceDetailView` without changing what it returns. The test compares the route's body byte for byte with the old two-batch read at the same instant for an issued invoice with an issued credit note and a debit draft, the credit note, the debit draft, an export invoice, a draft, a proforma and a void invoice, and checks one `batch` call.
5. **Budget** (`pnpm --filter @techaust/admin build`, `pnpm --filter @techaust/jobs build`, `.logs/warm-build-final.log`): all ok.

| Worker | Bytes before | Bytes after | Startup (fastest of 7, local) before → after |
|---|---|---|---|
| admin front | 102,708 | 111,522 (+8.8 K) | 39.9 → 37.7 ms |
| admin API | 478,776 | 488,187 (+9.4 K) | 105.8 → 122.5 ms |
| admin finance | 585,831 | 622,420 (+36.6 K; plan line 650,000) | 86.2 → 133.5 ms |
| jobs | 703,282 | 703,282 (unchanged) | 67.3 → 54.3 ms |

Startup readings swung with the shared machine's load (the same finance bundle read 62.8–70.8 ms in two other builds today); all stay under 200 ms. The `node:vm` probe times only the synchronous part, not the dry run's microtask chain, so the dry run's own start-up cost is **not measured** precisely.

### Secret scan (lead's notes)
`9c13e9f9` tripped CI's gitleaks at `apps/admin/worker/warm-fixtures/front.ts:95` (`totp_secret_enc`); the lead allow-listed that fingerprint on main (#155). Other secret-looking literals in pushed commits, not verified with gitleaks (not installed here), possibly flagged by its generic rule: `3549804a` `scripts/cpu-probe.mjs` (the made-up `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SES_SECRET_ACCESS_KEY`, `TURNSTILE_SECRET` values, lines 65–70 at that commit); `9c13e9f9` `apps/admin/worker/warm-fixtures/front.ts` (`clientHash`, `pw_salt`, `pw_hmac`, the TOTP `challenge`), `warm-routes.ts` (`RAZORPAY_KEY_SECRET`), `warm-front.ts` (`TURNSTILE_SECRET`). Fixed from `991d45ac`: made-up keys are built from words at run time, and the fixture writer stores any value under a secret-looking key in 6-character pieces (`{ $j: [...] }`, joined by `unpack` at start-up); a grep of the current tree finds none.

### Commands and results
- `bash tools/heavy.sh --log warm-check pnpm check`: exit 0 (lint, typecheck of every package, guards). This was the one whole-repository lint.
- `pnpm --filter @techaust/admin test` (heavy, `warm-test-admin`): 4,118 passed, 2 timed out at 5 s under load (`figures.test.ts` 200 documents, `offer-erasure.test.ts` legal hold; modules I did not touch); both files pass on a rerun (41/41).
- `pnpm --filter @techaust/jobs test`: 607 passed. `pnpm --filter @techaust/core test`: 2,141 passed (coverage gate included).
- Builds and probes: `warm-build-*`, `warm-probe-base2` (before), `warm-probe-final` (after) in `.logs/`.

### Not verified
- No staging reading (the gate is the lead's `f:1` reading after deploy). Node is not workerd; the global-scope rules are emulated from a local workerd check, not read from documentation.
- The dry run in real workerd at start-up: tested only under emulated rules (in workerd's request context and in Node); no local `wrangler dev` session was run.
- gitleaks itself was not run locally.

### Open questions for the early check
1. Is the dry-run method (a second warm app over generated fixtures) acceptable in place of per-handler pure splits? The fixtures must be regenerated (`node scripts/cpu-probe.mjs --write-fixtures` after a build) when a hot route's SQL or columns change; the pinned statuses in `warm-routes.test.ts` fail when a fixture stops matching.
2. The writes (issue, PATCH, advance) and TOTP stay at 4–7 ms local because global scope refuses random values. A way past it (for example a warm-only id source passed through the context to `mutate`) would touch money paths; I did not do it. Worth a follow-up?
3. Finance is at 622,420 bytes, 27,580 under its 650,000 plan line, mostly fixture rows.

Usage: builder claude-opus-5-5/high (workers-profiling, workers-best-practices, wrangler).

## Early check (analyst claude-opus-5-5/high, 2026-11-02; copied by the lead)
**Verdict: CHANGE (small).** The method (a second `createApp(..., { warm: true })` dry run over generated fixtures) is **sound and accepted**: in real local workerd 1.20261001.1 the three dry runs gave exactly the pinned statuses (finance 6/9, API 5/5, front 9/10), the whole async chain finished during start-up (`Date.now()` still 0, zero `console` calls), and under `wrangler dev` the first real requests logged `n:1, f:1` (no counter or first-run mark moved); forwarding, 401, 404 and trailing slash correct. No shared mutable state reaches a real request (every cache keyed by its full input); fixtures hold made-up data only; the sign-in keys stay in the front bundle. Front catch-all sound (same target per row, first match in table order, forwarders before CSRF and the guard, 404 for undeclared paths). Invoice detail: one batch of 32 statements (1 query instead of 2). Bytes as the builder's.
1. **Medium:** the dry run adds 50–130 ms of start-up (`wrangler check startup`, local: front 25–27 → 68–80, API 71–84 → 54–101, finance 55–67 → 110–191, once 239), and `scripts/worker-budget.mjs:161` times only the synchronous part, so the ≤ 200 ms gate can't see it. The refused `getRandomValues` calls (TOTP, the three writes) cost 30–55 ms each Worker and warm nothing beyond the code before the id draw. The hard limit is 1 s (a deploy over it is refused, error 10021). Fix: (a) the budget times the microtask drain too; (b) record Cloudflare's `startup_time_ms` from the staging deploy log before and after, in `cpu-baseline.md`; (c) if it's expensive there too, stop those calls.
2. **Medium:** a stale fixture doesn't always fail loudly (`warm-routes.ts:61`: a statement missing from the answer book gets `[]`, so a list or the dashboard still answers 200 cold). Fix: `warmDb` records misses; the test asserts zero misses for every read (the writes' cut-off statements excepted) and ≥ 1 row per list call; document `node scripts/cpu-probe.mjs --write-fixtures` in `cpu-baseline.md` (CLAUDE.md "Worker budget": the lead).
3. **Low:** HEAD on a forwarded GET row now gets the front's 404 (`forward.ts:74`; Hono dispatches HEAD through GET but `c.req.method` stays `"HEAD"`). Fix: map HEAD to GET in `forwardRowOf`, and a HEAD case through `front.fetch` in `split.test.ts`.
4. **Low:** start-up failure handling: the no-op `waitUntil` drops promises uncaught; `warmStart` has no outer catch; `createApp(..., {warm:true})` and `forwardTable(ROUTES)` run synchronously at top level (a sync throw stops start-up). Fix: `waitUntil: (p) => { Promise.resolve(p).catch(() => {}); }`, `warmStart(...).catch(() => 0)` at each site, build the warm app inside a `try` helper.
5. **Low:** `warm-routes.ts:129` says the gateway transport is "the local stub"; with `ENVIRONMENT: "warm"` it is `"unset"` (any gateway path answers 503). Correct the comment.
6. **Low:** the fixture writer splits secret-looking values into 6-character pieces (`scripts/cpu-probe.mjs:809–821`), which hides them from gitleaks and from review.
7. **Low:** `warm-routes.test.ts:47` fakes `Date.now` but not `new Date()`: use `vi.useFakeTimers({ toFake: ["Date"] })` with `setSystemTime(0)`.
8. **Nit:** `index.ts:22` warms a second `TrieRouter`, not the one `forwardRoutes` builds; warm the real one.
**Open questions:** (1) the warm app over fixtures: yes, with 1, 2 and 4 fixed; (2) a warm-only id source near money paths: **no** (random values allowed brought the writes only to 4.8/4.8/5.7 ms); if writes still read above 7 ms on staging, warm the pure statement builders after the id directly with fixed made-up ids; (3) finance at 622,420 of the 650,000 plan line: acceptable; set the merge order with M6.3.
**Not verified:** `startup_time_ms` on Cloudflare; whether start-up CPU is billed to the first request (UNCONFIRMED; the record argues against it); HEAD on main (code reading); gitleaks itself.

## Lead decisions on the early check (2026-11-02)
- **Method accepted** (open question 1: yes). **No warm-only id source** (question 2: no).
- **Fix round (builder), all eight findings:**
  1. (a) `scripts/worker-budget.mjs` times the evaluation **plus the microtask drain** (or awaits a promise the entry exposes to the probe only), with a test; (c) **stop the four refused-random-value calls** (front TOTP; finance issue, PATCH, advance) before the id draw only if a cheap, money-path-free way exists (e.g. warm those handlers' pure parts or the statement builders after the id with fixed made-up ids, never through `mutate`); otherwise **drop those four calls** from the dry run. Report start-up per Worker from `wrangler check startup` (3 runs each) before and after. (b) is the lead's after deploy.
  2. As the finding: misses recorded, zero misses asserted for reads, ≥ 1 row per list call; `--write-fixtures` documented in `docs/runbooks/cpu-baseline.md`.
  3. HEAD → GET in `forwardRowOf`, with a HEAD case through `front.fetch`.
  4. As the finding.
  5. Correct the comment.
  6. **Remove the 6-character splitting.** Fixture values under secret-looking keys are written as plain literals, and a reviewed gitleaks **path** allow-list covers `apps/admin/worker/warm-fixtures/` only: a `.gitleaks.toml` that extends the default rules (`[extend] useDefault = true`) and allow-lists that one path, with a comment giving the reason; plus a test that every credential-shaped fixture value verifies only under the test keys (`TEST_KEY` values) and never under any other. CI keeps `./gitleaks git .`; check it picks up `.gitleaks.toml` at the repo root (gitleaks reads it by default) and say so.
  7. and 8. As the findings.
  9. **Finance headroom for M6.3:** keep **one row per statement** in the finance fixture where more rows warm nothing new, and report the new finance bytes. Merge order: **this task merges before M6.3**; M6.3 takes `main` in afterwards and reports finance bytes against the 650,000 plan line.
- The lead adds `--write-fixtures` to CLAUDE.md's "Worker budget" paragraph at the end of the day.

## Fix round report (builder claude-opus-5-5/high, 2026-11-02)
Branch `fix/cpu-warmup-ec` (from `origin/feat/cpu-warmup` `25e6a78d`, pushed). Lead decision items 1–9 done in order, one or more commits each (`6df7154b`…`4d65a124`). No screens, no hosted change, nothing deployed, no dev server started. Nothing in `apps/admin/worker/gateway/`, `packages/db/src/gateway.ts`, migrations or the Stripe/Razorpay code was changed. No response, permission, audit row or log key changed (only the warm app).

**Skills loaded:** `cloudflare:workers-profiling` (start-up CPU profiles from `wrangler check startup`, read for hotspots: the refused `getRandomValues` calls were 35.8 ms self time in a finance start-up profile); `cloudflare:workers-best-practices` (no module-level request state; no `waitUntil` promise left with an unhandled rejection; generated `Env` kept); `cloudflare:wrangler` (local `wrangler deploy --dry-run --outfile` and `wrangler check startup --worker` only, no remote command). Context7: gitleaks v8.30.1 (`[extend] useDefault`, `[[allowlists]] paths`, config lookup order).

### Each item, with its files
1. **Start-up timing and the refused calls** (`6df7154b`): `scripts/worker-budget.mjs` (+ `.d.mts` in `4d65a124`) times compile + evaluation **plus the start-up work an entry hands to the probe** (`exposeToStartupProbe` in `apps/admin/worker/warm-routes.ts`; the probe puts `__techaustStartupProbe` in its sandbox, workerd has no such global), in a `node:vm` sandbox under workerd's global-scope rules (Response/Request with a body, `Response.json`, random values, timers and fetch refused; `Date` reads 0); a start-up that never settles fails after 5 s. Tests in `packages/core/test/worker-budget.test.ts` (the drain is counted, nothing is waited for without the hook, a rejection counts as settled, a hang fails, each refused operation fails, the clock reads 0). Entries `index.ts`, `api.ts`, `finance.ts`, `warm-front.ts` (the M3.1 step-up warm-up is handed over too). **(c):** I found no cheap money-path-free way past the id draw for PATCH and the advance invoice (their first exit after the model is `mutate`'s id) or for TOTP (a wrong code still draws the access row's id), so those three are **dropped** from the dry run. The issue call stays, with a content hash that is not the draft's: it reads, recomputes through the tax engine and answers 409 `content_changed` **before** any id (a fixture-only change, no code change; `scripts/cpu-probe.mjs` `warm: false` / `warmBody` / `readsOnly`). `warm-routes.test.ts` counts refusals (0 for all three Workers) and pins the issue call's code `content_changed`. I regenerated the fixtures **once here**, with the writer's changes for items 1c, 2, 6 and 9, so `.gitleaks.toml` landed in this commit too (no commit holds an unallowed plain literal).
2. **Stale fixtures fail loudly** (`e6aff911`): `warmDb(book, observe)` reports every statement (read or write, held or a miss, rows). `warm-routes.test.ts` asserts zero missed reads for every call of the three Workers, checks every finance and API call reads, and checks each list (`/invoices`, `/payments/review`, `/approvals`, `/notifications`, `/clients`, `/leads`) answers ≥ 1 row. The probe seed adds two made-up bells for the made-up Owner and one made-up pending discount request (the approvals and notifications lists were empty). `docs/runbooks/cpu-baseline.md` documents `node scripts/cpu-probe.mjs --write-fixtures` (build, write, test, commit).
3. **HEAD** (`c2253060`): `forwardRowOf` looks HEAD up as GET (`forward.ts`). `split.test.ts` sends a HEAD through `front.fetch` for every forwarded GET row (forwarded once, as HEAD, to the right Worker, empty body) and checks a HEAD with no GET row gets the front's 404. The test fails without the fix (checked).
4. **Start-up can't fail** (`c7e3f93d`): `warmAtStartup(build, fixture, extra)` builds the warm app inside a `try`, turns a rejection into 0 and hands the settled promise to the probe; every entry uses it. The warm `waitUntil` is `Promise.resolve(p).catch(() => {})`. Tests: a build that throws, a fixture that throws, a rejected `waitUntil`. The top-level `forwardTable(ROUTES)` is gone in item 8.
5. **Comment** (`10d6f16f`): `warmEnv`'s transport is "unset" (503 on any gateway path), not the stub; a test pins `transportOf(warmEnv({}))`.
6. **Secrets** (`86348da4`; `.gitleaks.toml` in `6df7154b`): the 6-character splitting and `unpack` are removed, and the fixtures hold plain made-up values. `.gitleaks.toml` at the repo root has `[extend] useDefault = true` plus one `[[allowlists]]` with `paths = ['''^apps/admin/worker/warm-fixtures/''']` and a comment giving the reason. CI's `./gitleaks git . --no-banner --redact --verbose` passes no `--config` and sets no `GITLEAKS_CONFIG`, so gitleaks 8.30.1 reads `(target path)/.gitleaks.toml`, which is the repo root's file (its README "Load Configuration", order 4). The new `apps/admin/worker/warm-fixtures.test.ts` checks that:
   - every credential-shaped fixture value (`pw_hmac`, `clientHash`; `totp_secret_enc` and `challenge` are checked when present, and none is present since TOTP left the dry run) verifies under the `TEST_KEY` values and under no other key (the other test keys, all-zero, all-0xff and three random keys);
   - the front's dry-run keys equal `TEST_KEY(1..4)`;
   - the API and finance fixtures hold no credential-shaped value;
   - no unchecked kind of credential appears.
   Made-up keys elsewhere are still built at run time.
7. **`new Date()`** (`1d01e4c1`): `atGlobalScope` uses `vi.useFakeTimers({ toFake: ["Date"] })` + `setSystemTime(0)`; a test checks both forms read 0 and the real clock is back afterwards.
8. **The real table** (`c2fd642a`): `index.ts` warms the table `forwardRoutes` builds and returns (no second TrieRouter); a test proves the returned table is the one the catch-all looks requests up in.
9. **Finance headroom** (`6cc8559a`): one row per finance answer (`ROWS_KEPT`, regenerated in item 1), pinned by a test. Entries recorded for different parameters stay (the issue call must read its own draft, not the detail's invoice). Finance **622,420 → 609,527 bytes** (40,473 under the 650,000 plan line).
- Also `8faecdf2`: the `warm-routes.ts` header now says no dry-run call reaches a new id.

### Start-up (`wrangler check startup`, local workerd, "Active" ms, 3 runs each)
I made the bundles with `wrangler deploy --dry-run -c dist/<worker>/wrangler.json --outfile …`, then ran `wrangler check startup --worker <bundle>` (without `--worker` the command profiles the Vite redirect config, which is the front, for every Worker). During the later runs the PC was shared with another agent's `db` tests and another project's `pytest`. So the interleaved A/B column (before and after bundles alternated in one session) is the fair comparison.

| Worker | Before (alone) | After item 1 (alone) | Final (machine loaded) | Interleaved A/B: before → after |
|---|---|---|---|---|
| admin front | 62.6 / 71.5 / 96.8 | 34.6 / 49.9 / 35.7 | 62.3 / 66.2 / 56.0 | 106 / 85.5 / 84.9 → **36.6 / 45.7 / 51.9** |
| admin API | 84.4 / 81.1 / 82.8 | 87.7 / 106.1 / 81.2 | 111 / 136.6 / 101.1 | 73.8 / 85.0 / 96.3 → 107.7 / 80.5 / 91.4 (no refusals before or after; the same within noise) |
| admin finance | 210.8 / 155.9 / 142.9 | 121.2 / 83.6 / 81.5 | 137.7 / 120.8 / 127.1 | 200.2 / 141.8 / 198.3 → **105.0 / 74.5 / 91.1** |

No `getRandomValues` frame in the after profiles (before: 35.8 ms self time in finance). Profiles are in `.logs/startup-{before,item1,final,ab}/`.

### Bytes and the budget's start-up (`pnpm --filter @techaust/admin build`)
| Worker | Bytes before | Bytes after | Budget start-up before (synchronous only) | After (start-up work included) |
|---|---|---|---|---|
| admin front | 111,522 | 110,707 | 32.8 ms | 30.2 (item-1 build) / 50.2 (final build, loaded) |
| admin API | 488,187 | 488,788 | 60.3 ms | 72.3 / 71.1 |
| admin finance | 622,420 | **609,527** | 53.6 ms | 84.0 / 77.3 |
| jobs | 703,282 | 703,282 (unchanged) | – | 61.9 (no start-up work handed over) |

All are under the 200 ms limit. A sanity check on the item-1 build, at the same moment, with and without the probe hook: front 30.9 vs 22.9, API 70.1 vs 56.6, finance 85.8 vs 57.2 ms. So the budget now sees the 8–29 ms the old reading missed.

### Probe after (`bash tools/heavy.sh --log ec-probe-final node scripts/cpu-probe.mjs --runs 7 --later 4 --json .logs/cpu-probe-ec.json`)
| Case | Worker | Baseline first | Early-check build first | **Fix round first** (min-max) | Later | D1 statements |
|---|---|---|---|---|---|---|
| GET /health | front | 3.1 | 0.7 | **0.6** (0.6-1.0) | 0.2 | 0 |
| GET /auth/me | front | 4.6 | 1.6 | **2.5** (1.7-3.1) | 1.1 | 2 |
| POST /auth/salt | front | – | 1.4 | **1.3** (1.1-1.6) | 0.4 | 1 |
| POST /auth/login | front | – | 2.6 | **3.8** (2.8-8.5) | 1.7 | 5 |
| POST /auth/totp | front | 8.1 | 3.9 | **4.7** (3.9-6.2) | 2.3 | 10 |
| fwd GET /invoices/:id | front | 1.3 | 0.7 | **0.5** (0.5-0.7) | 0.1 | 0 |
| fwd POST /invoices/:id/issue | front | 1.3 | 0.6 | **0.6** (0.6-1.3) | 0.2 | 0 |
| fwd GET /notifications | front | 1.5 | 0.6 | **0.6** (0.5-2.4) | 0.1 | 0 |
| fwd GET /leads | front | 1.4 | 0.6 | **0.7** (0.5-1.0) | 0.2 | 0 |
| fwd GET /dashboard | front | 1.5 | 0.6 | **0.5** (0.5-0.5) | 0.1 | 0 |
| POST /invoices/:id/issue | finance | 10.9 | 4.0 | **6.6** (5.1-12.5) | 2.4 | 33 |
| GET /invoices/:id | finance | 8.9 | 3.2 | **3.5** (3.1-5.7) | 1.7 | 32 |
| GET /invoices/:id/payments | finance | 4.6 | 2.0 | **2.0** (1.8-2.9) | 1.1 | 12 |
| PATCH /invoices/:id | finance | 12.7 | 6.9 | **5.9** (5.3-10.8) | 2.2 | 24 |
| POST /invoices/:id/advance-invoice | finance | 13.7 | 5.0 | **7.5** (7.1-20.9) | 2.4 | 40 |
| GET /dashboard | finance | 7.1 | 3.2 | **3.8** (3.0-6.1) | 1.8 | 25 |
| GET /invoices | finance | 4.3 | 2.0 | **2.7** (2.5-4.0) | 1.5 | 7 |
| GET /payments/review | finance | 3.3 | 1.8 | **2.4** (1.8-3.7) | 1.2 | 4 |
| GET /approvals | finance | – | 2.0 | **3.6** (1.7-8.2) | 1.3 | 3 |
| GET /notifications | api | 3.9 | 1.8 | **1.8** (1.6-2.8) | 1.1 | 4 |
| GET /settings | api | – | 2.2 | **3.0** (2.1-6.9) | 1.7 | 4 |
| GET /clients | api | – | 1.7 | **1.8** (1.7-4.4) | 1.1 | 3 |
| GET /clients/:id | api | – | 1.9 | **1.9** (1.8-3.9) | 1.3 | 7 |
| GET /leads | api | 4.4 | 1.9 | **1.8** (1.7-3.3) | 1.1 | 3 |
| rpc GatewayEvents.processEvent | finance | 6.5 | 4.6 | **5.8** (4.1-7.0) | 1.4 | 21 |
| jobs POST /razorpay | jobs | 3.5 | 3.6 | **4.0** (3.7-7.2) | 0.8 | 2 |

**Reading:**
- **What item 1(c) cost:** the advance invoice went 5.0 → 7.5 (it is no longer dry-run). The issue went 4.0 → 6.6: it now stops at `content_changed`, so its blockers, seal and statement building are no longer warmed. TOTP went 3.9 → 4.7.
- **PATCH** reads 5.9, against 6.9 before (that row was noisy then too).
- **Lists:** the approval queue and notifications now shape a real row. Approvals went 2.0 → 3.6, but its minimum is 1.7, so that is mostly noise plus the list's own work.
- **Against the targets:** every first request is still well under the baseline, but none of the writes meets the 2.5 ms local target.
- **What it bought:** about 25 ms less start-up on the front and 60–100 ms less on finance, and a budget that sees the dry run.
- **`POST /auth/login`:** its later calls answered 401 in this run (the first answered 200, as before). I did not dig into it: it is probe-only, and the case's later sign-ins share one lockout counter.

### Tests and checks
- `bash tools/heavy.sh --log ec-test-core pnpm --filter @techaust/core test`: 2,153 passed (102 files, coverage gate included).
- `bash tools/heavy.sh --log ec-test-jobs pnpm --filter @techaust/jobs test`: 607 passed.
- `bash tools/heavy.sh --log ec-test-admin pnpm --filter @techaust/admin test`: 4,137 passed (143 files).
- `bash tools/heavy.sh --log ec-check pnpm check`: **failed** at the core typecheck (`scripts/worker-budget.d.mts` lacked the new exports). Fixed in `4d65a124`; then `bash tools/heavy.sh --log ec-check2 pnpm check` exited 0 (lint, typecheck of every package, every guard). So the whole-repository lint ran twice: the first run's lint stage passed, and the rerun was needed for the typecheck fix.
- Builds: `ec-build-before`, `ec-build-item1`, `ec-build-final` (admin) and `ec-jobs-build`. Fixtures: `ec-fixtures`, `ec-fixtures2`. Probe: `ec-probe-final`. All logs are in `.logs/`.
- While working I ran single files only: `worker/warm-routes.test.ts`, `worker/warm-fixtures.test.ts`, `worker/split.test.ts -t …` and `test/worker-budget.test.ts`, plus `pnpm exec biome check` on each changed file.

### Not verified
- **gitleaks itself was not run** (not installed here, and installing needs the owner's yes). The `.gitleaks.toml` syntax and lookup order come from the v8.30.1 README via Context7; CI's next run is the proof. As the early-check report said, `3549804a` (`scripts/cpu-probe.mjs` made-up secrets) and other earlier commits outside the allowed folder may still be flagged by the full-history scan. Nothing in this round adds one.
- Cloudflare's `startup_time_ms` from a staging deploy (decision 1b, the lead's job after deploy). I have local workerd profiles only, and the PC was shared, so single readings swing ±30 %.
- Whether the issue call's shorter warm path (it stops at `content_changed`) is enough on staging. The analyst's alternative (warm the pure statement builders after the id with fixed made-up ids) was not tried.
- The probe's `POST /auth/login` 401 on later calls (see above).

### Open questions
1. The writes now read 5.9–7.5 ms on their first request locally (issue 6.6, advance 7.5). If staging's `f:1` reading puts them over 7 ms, do you want a follow-up that warms their pure statement builders (no `mutate`, fixed made-up ids), or does that go into the Workers Paid plan decision?

Usage: builder claude-opus-5-5/high (workers-profiling, workers-best-practices, wrangler; the builder can't read the 5-hour bar).

## Review (reviewer claude-opus-5-5/high, 2026-11-02; copied by the lead, the reviewer changes no files)
**APPROVE** (`origin/feat/cpu-warmup` @ `38b522df`): no critical, high or medium; ten lows. Skills: code-review (high), security-review (by hand), workers-best-practices, workers-profiling.
1. `.gitleaks.toml:16`: the path allow-list turns off every rule for `warm-fixtures/`, while `warm-fixtures.test.ts:24` checks only credential-shaped keys: a key of another shape in a fixture (inside a settings JSON value, an `rzp_live_` id, a PEM block) would pass both. Fix: the test also scans every fixture string for known secret shapes (`rzp_live_`, `rk_live_`, `sk_live_`, `AKIA`, `-----BEGIN`, a long base64 run outside the checked keys).
2. `warm-fixtures/front.ts` (session row, ≈41): expiries are generation time plus offsets, so the dry run relies on workerd's clock reading 0; otherwise every signed-in warm call answers 401 (CPU only). Fix: the writer writes far-future expiries.
3. `invoices.ts:589–590`: every detail batches all 9 note reads (a draft 21 → 30 statements, issued 32). Follow-up only if query counts start to matter.
4. `warm-routes.ts:159`: `GATEWAY_TRANSPORT: "stub"` set while the comment says "unset" (unset only because `ENVIRONMENT` is "warm"). Fix: drop the key.
5. `scripts/worker-budget.mjs:169`: `FROZEN_CLOCK` replaces `Date` with a class, so `Date()` without `new` throws in the sandbox (workerd returns a string). Fix: a function wrapper.
6. `scripts/cpu-probe-runtime.mjs:328`: `underGlobalScopeRules` fakes only `Date.now`, not `new Date()`.
7. `warm-routes.test.ts:180–196`: the "leaves no trace" test covers finance and front, not API; a handler's own `console.error` would still print. Fix: add the API dry run.
8. `forward.ts:78–80`: the warm request facts repeat app.ts's private `WARM_REQUEST`: one exported helper.
9. Budget headroom under load: finance start-up read 172.8 ms fastest of 7 in a loaded build (84.6 alone). Watch CI's reading on the PR.
10. `scripts/cpu-probe.mjs` restores the real `fetch` after loading a bundle; nothing reaches a hosted service today. Fix: refuse `fetch` in the child processes for the whole run.
**Verified:** the warm app is unreachable and traceless; refusals pinned at 0; caches keyed by exact value; the front's TEST_KEY values stay in the front bundle; the catch-all (before every middleware, first match in table order, HEAD as GET, one trailing slash, undeclared → the front's 404); the invoice-detail slices and the byte-for-byte test (which proves the merged read; the handler split read line by line); fixtures made-up only; tests 404 + 41 passed; admin build ok (front 110,707 / API 488,788 / finance 609,527 bytes), portal build ok (115,860). **Not verified:** gitleaks locally (not installed), real workerd start-up and `startup_time_ms`, the probe, `pnpm check`, full suites, D1's batch query counting.

## Review triage (lead, 2026-11-02)
- **Fix in this task (builder, one short round):** 1, 2 (regenerate the fixtures once), 4, 5, 6, 7, 8, 10.
- **Kept:** 3 (follow-up only if D1 query counts start to matter: D1 counts a batch as one query against the Free plan's 50 per invocation, per the analyst's reading of the D1 limits page); 9 (watch CI's reading on the PR; if finance passes 150 ms in CI, trim the dry run).
- **The builder's open question** (writes over 7 ms on staging): decided after the staging `f:1` reading; the owner's Workers Paid decision takes it into account.

## Review fix report (builder claude-opus-5-5/high, 2026-11-02; branch `fix/cpu-warmup-review` from `origin/feat/cpu-warmup` @ `53ca93fa`)
Skills loaded: **cloudflare:workers-best-practices** (no new I/O or module-level request state; the warm env's bindings and the one request-facts helper keep `ctx` and env passed explicitly), **cloudflare:workers-profiling** (no deployed profiling: this round changes no hot path; start-up read from the budget's probe, below).

### Each finding, with its files
1. **Secret shapes in the fixtures** (`apps/admin/worker/warm-fixtures.test.ts`): every string of every fixture, keys and values, calls and rows, is scanned for Razorpay live/test keys, Stripe `sk`/`rk` live/test keys, Stripe webhook secrets, AWS access key ids, PEM blocks, GitHub tokens, JWTs, and a long base64 run (32+ characters with a capital, a small letter and a digit) anywhere except as the whole value of the four cryptographically checked keys. A test plants a sample of each shape inside a settings JSON value, as a row key and as a call body value, and proves each is caught; another proves a long run passes only under a checked key, that the other shapes are caught there too, and that ids, content hashes, paths and camelCase names are not flagged. Patterns and samples are put together from pieces at run time (`j(...)`, `.repeat`); no secret-looking literal sits in the source.
2. **Far-future expiries** (`scripts/cpu-probe.mjs` `WARM_FAR_FUTURE_MS`, `farFutureExpiries`; `apps/admin/worker/warm-fixtures/{front,api,finance}.ts` regenerated; `warm-routes.test.ts`): the writer writes 2100-01-01T00:00:00Z for every `*_expires_at` and `step_up_until` number (a null stays null). Fixtures regenerated once with `node scripts/cpu-probe.mjs --write-fixtures` after an admin and jobs build: the same 21 cases and statuses as before, new made-up ids. A test checks that all 9 expiries are that instant and runs every Worker's dry run with the clock a day before it: still 6 / 5 / 9 answered, no refusal.
4. **No gateway transport in the warm env** (`apps/admin/worker/warm-routes.ts`): `GATEWAY_TRANSPORT` is dropped, and the comment says so; the test also proves the key is absent and that the transport stays "unset" even with `ENVIRONMENT: "local"`.
5. **The budget sandbox's `Date()`** (`scripts/worker-budget.mjs` `startupDate`, `FROZEN_CLOCK`; `.d.mts`): a function wrapper in place of the class. `Date.now()` and `new Date()` read 0, `Date()` without `new` returns the string of 0 (workerd's behaviour), `new Date(x)`, `instanceof`, the statics and subclassing are unchanged. The sandbox runs the function's own source, so there is one definition. Tests in `packages/core/test/worker-budget.test.ts`, inside the sandbox and directly.
6. **`new Date()` in the probe** (`scripts/cpu-probe-runtime.mjs` `underGlobalScopeRules`): it swaps in the same `startupDate` (imported from worker-budget.mjs, which has no heavy imports) and restores the real `Date`. Test: `new Date()` reads 0 inside and the real clock is back afterwards.
7. **No-trace test covers the API** (`warm-routes.test.ts`): the API dry run joins finance and front, `console.warn` is watched too, and the API's `GET /api/v1/clients/:id` is checked to be still a first run.
8. **One request-facts helper** (`apps/admin/worker/app.ts` `requestFacts(warm, cfRay)`, `forward.ts`): the app's outermost middleware and the forwarder both call it; `WARM_REQUEST` stays private. Same log keys and values; a test pins the warm (`iso: "warm"`, `n: 0`, `rid: "warm"` or the clipped `cf-ray`) and real behaviour.
10. **`fetch` refused for the whole child run** (`scripts/cpu-probe-runtime.mjs` `refuseNetwork`, `NO_NETWORK`; `scripts/cpu-probe.mjs` entry; `.d.mts`): every `--seed`, `--case` and `--challenge` child calls it first; `underGlobalScopeRules` then saves and restores the refusal, never the real `fetch`. Test: `fetch` rejects with `NO_NETWORK` before and after the rules. The `--write-fixtures` run above (a seed and 21 case children) ran with it on, with nothing refused that the probe needed.

### Tests and checks
- `pnpm check` (through the queue, `.logs/rf-check.log`): exit 0, biome 1,546 files, all typechecks and guards ok.
- `pnpm --filter @techaust/admin test`: 143 files, 4,142 tests passed. `pnpm --filter @techaust/core test`: 102 files, 2,159 passed (coverage gate included). `pnpm --filter @techaust/jobs test`: 36 files, 607 passed.
- `pnpm --filter @techaust/admin build`: ok (below). `pnpm --filter @techaust/jobs build`: ok, 703,282 bytes, start-up 56.4 ms.
- `pnpm exec biome check` on each changed file while working.

### Bytes and start-up (`pnpm --filter @techaust/admin build`, budget probe, fastest of 7, start-up work included)
| Worker | Bytes (review) | Bytes now | Start-up now |
|---|---|---|---|
| admin front | 110,707 | 110,696 | 29.2 ms |
| admin API | 488,788 | 488,824 | 73.6 ms |
| admin finance | 609,527 | 609,567 | 82.7 ms |

One earlier build, while another project's `pytest` ran and free memory was about 220 MB, read finance at **332.4 ms and failed the 200 ms limit** (`.logs/rf-build1.log`). Run alone straight afterwards on the same bundle, the new budget script read 78.7 ms and the old one (`53ca93fa`) 82.6 ms, so the reading was the machine's load, not the new `Date`. This is the review's finding 9 again (kept by the lead): CI's reading on the PR is the one to watch.

### Not verified
- gitleaks over the new commits (not installed here); the test file builds every pattern and sample from pieces, so no contiguous secret shape is in it.
- Real workerd start-up (`wrangler check startup`) and staging `startup_time_ms`; the probe's timing run (`--runs 7`) was not repeated, only `--write-fixtures`.
- That the far-future value is right for any expiry column a later fixture may add: the rule covers `*_expires_at` and `step_up_until` numbers only.

### Open questions
None.

Usage: builder claude-opus-5-5/high (workers-best-practices, workers-profiling; the builder can't read the 5-hour bar).

## Integration notes (lead, 2026-11-02)
- `fix/cpu-warmup-review` fast-forwarded into `feat/cpu-warmup`; `main` (#154, #155) merged in cleanly (only `cpu-baseline.md` auto-merged). No re-check: the review found no critical or high, and every listed low is fixed (`pnpm check`, admin 4,142, core 2,159, jobs 607, builds ok; finance 609,567 bytes, start-up 82.7 ms).
- **Merge order:** this PR merges before M6.3; M6.3 then takes `main` in.
- **After deploy (lead):** Cloudflare's `startup_time_ms` from the staging deploy log, and the `f:1` first-request reading at the owner's next staging session, into `cpu-baseline.md`; then the owner's Workers Paid decision.
