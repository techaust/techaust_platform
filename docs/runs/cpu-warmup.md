Status: builder started 2026-11-01 (branch `feat/cpu-warmup`)
Tier: B (Workers; docs/14 §2)
Usage:

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
