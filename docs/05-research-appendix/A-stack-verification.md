# 05-A: Stack verification for the Cloudflare Workers Free plan (as of 2026-10-06)

| | |
|---|---|
| **Purpose** | Re-check every technology fact the architecture (03-plan.md §3C) relies on before Phase 5 locks it in |
| **Fixed decision** | The whole platform runs on the **Cloudflare Workers Free plan, permanently**. This file shows how to make that work. It doesn't argue the decision. |
| **Checked** | 2026-10-06. Sources are official docs, changelogs, npm and GitHub unless marked "secondary". |
| **Legend** | **[S]** sourced · **[M]** measured by me on 2026-10-06 (local Node 24.19 on a desktop CPU, not workerd; treat as order-of-magnitude only) · **[I]** my inference or recommendation · **[?]** uncertain, re-check |

---

## 0. TL;DR

| # | Fact | Plan assumption | Verified value (Oct 2026) | Status | Source |
|---|---|---|---|---|---|
| 1 | Workers CPU per HTTP request (Free) | 10 ms | **10 ms**, can't be raised on Free; Error 1102 when exceeded | OK | [S] workers/platform/limits |
| 2 | Requests/day (Free) | 100k | **100,000/day**, resets 00:00 UTC; Error 1027 after that. Static asset hits are free, unlimited and **not counted** | OK | [S] limits; static-assets/billing |
| 3 | Subrequests/request (Free) | — | **50** (Paid 10,000) | OK (design for it) | [S] limits |
| 4 | Worker size | — | **64 MiB uncompressed on both plans; no compressed limit**; 1 s startup limit | OK | [S] limits |
| 5 | Workers per account / Cron Triggers per account (Free) | — | **100 Workers / 5 Cron Triggers** | OK (use ≤ 2 crons) | [S] limits |
| 6 | Static assets (Free) | "free, unlimited" | **20,000 files per version, 25 MiB per file**; requests free and unlimited | OK | [S] limits |
| 7 | D1 Free | 5M reads/day; 500 MB/DB; 7-day Time Travel | **10 DBs, 500 MB per DB, 5 GB per account, 5M rows read/day, 100k rows written/day, 50 queries per invocation, 7-day Time Travel**. **Hard-enforced since 2026-09-01**: queries fail until midnight UTC | OK, **new risk** | [S] d1/platform/limits; changelog 2026-09-01 |
| 8 | D1 transactions | use `batch()` | `batch()` is a SQL transaction (all-or-nothing); no interactive transactions | OK | [S] d1/worker-api |
| 9 | R2 Free | 10 GB | **10 GB-month, 1M Class A, 10M Class B per month, free egress** | OK | [S] workers/platform/pricing |
| 10 | Queues on Free | 10k ops/day | **Available on Free: 10,000 ops/day, 24 h retention (fixed)**. About 3 ops per message, so **≈ 3,300 messages/day**. Max 100 retries, `delaySeconds` up to 24 h, 128 KB per message | OK | [S] queues/platform/pricing, limits |
| 11 | Queue consumer / Cron CPU on Free | "long work goes to queues" | Cron: **10 ms**. Queue consumers "share the same per-invocation CPU limits as any Worker", so assume **10 ms on Free** [?] | **CHANGE NEEDED**: queues give retries and pacing, **not more CPU** | [S] queues/platform/limits; workers limits |
| 12 | Rate Limiting binding | Free | GA since 2025-09-19; the docs show no paid-only restriction; 10 s or 60 s periods; per-location, eventually consistent | OK [?] (plan availability from secondary sources) | [S] changelog 2025-09-19; bindings/rate-limit |
| 13 | Workers Logs | Free, 3-day retention | Until 2026-11-30: 200k events/day, 3 days. **From 2026-12-01 (Observability pricing): Free = 0.5 GB ingestion/day, 7-day retention, ingestion stops at the cap** (no overage) | **CHANGE (better)**: update the doc | [S] observability/pricing (updated 2026-10-05) |
| 14 | Browser Run Free | 10 min/day; 1 PDF per 10 s | **10 min/day, 3 concurrent browsers, Quick Actions 1 per 10 s, new browser 1 per 20 s, 60 s timeout**. Binding works on Free (`env.BROWSER.quickAction("pdf", …)`, no API token) | OK | [S] browser-run/limits (updated 2026-09-26), pricing |
| 15 | Turnstile | Free | Free, unlimited challenges, 20 widgets, 10 hostnames per widget | OK | [S] turnstile/plans |
| 16 | Cloudflare Access | Free ≤ 50 users | Zero Trust Free: 50 users (secondary). Access can protect `workers.dev`, preview and version URLs | OK [?] | [S, secondary] costbench; [S] workers.dev docs |
| 17 | Email Routing (inbound) | — | Free, unlimited. Cloudflare **sending** to arbitrary recipients is paid-only, so keep SES | OK | [S] email-service/pricing (03-B §1) |
| 18 | Public site framework | **Astro 6** | **Astro 7.3.5** (7.0 on 2026-06-22: Vite 8, Rust compiler). `@astrojs/cloudflare` **14.3.3** needs astro ^7.2 | **CHANGE NEEDED** | [S] npm; astro.build/blog/astro-7 |
| 19 | Admin SPA router | React Router **v7** SPA | **React Router 8.4.0** (v8 on 2026-06-17; v7 gets security fixes only; Node ≥ 22.22, React ≥ 19.2.7, Vite ≥ 7) | **CHANGE (minor)** | [S] npm; remix.run/blog/react-router-v8 |
| 20 | Drizzle | 1.0 still RC; pin | **Stable `drizzle-orm` 0.45.3 (2026-09-21)**. 1.0 is still RC (rc.4, 2026-06-27; no RC since) | OK: pin 0.45.3 | [S] npm, GitHub releases |
| 21 | Zod | — | **4.6.5** | OK | [S] npm |
| 22 | Better Auth | Better Auth + custom hasher | **1.7.7**. Custom `password.hash/verify` **is supported**, plus native D1, `twoFactor` (TOTP + backup codes) and `magicLink`. Two realms and per-request CPU are the weak spots | OK but **in-house recommended** [I] | [S] better-auth docs (Context7), blog/1-7; [M] |
| 23 | Browser Argon2id | WASM Argon2id | **hash-wasm 4.12.0**: argon2 module ≈ 29 KB min / ≈ 12 KB gzip [M]. noble's own docs say Argon2 "can't be fast in JS" | OK | [S] npm; noble README; [M] |
| 24 | Server CPU (HMAC, TOTP, Stripe verify) | < 1–2 ms | HMAC ≈ 0.03–0.06 ms, TOTP verify ≈ 0.015 ms, Stripe `constructEventAsync` ≈ 0.08 ms, SigV4 sign ≈ 0.24 ms (small) to 0.95 ms (300 KB) [M]. No official Cloudflare numbers | OK | [M]; [S] CF says the average Worker uses ≈ 2.2 ms |
| 25 | Base64 of PDF attachments | — | A naive `btoa` of 150 KB took **≈ 8 ms** [M]; `Buffer` (nodejs_compat) took 0.3 ms [M] | **New risk** | [M] |
| 26 | SES ap-south-1 | SESv2 + SigV4 | SESv2 SendEmail, configuration-set event destinations, EventBridge API destinations and SNS Subscribe are **all available in ap-south-1**; v2 max message size 40 MB | OK | [S] AWS regional availability API; SES FAQ |
| 27 | Stripe SDK on Workers | fetch client + SubtleCrypto | **stripe 23.0.0** (pinned API `2026-09-30.endive`) has a `workerd` export condition and no dependencies | OK | [S] npm; CHANGELOG |
| 28 | Razorpay / PayPal SDKs | plain fetch | Both official Node SDKs depend on **axios** (PayPal via an APIMatic axios adapter). Use plain `fetch` + Web Crypto | OK | [S] npm deps |
| 29 | Sentry free | "Sentry free" | Developer plan: **1 user**, 5k errors/month, 1 uptime monitor, 1 cron monitor, 30-day lookback | **CHANGE (note)**: only one seat | [S] sentry.io/pricing |
| 30 | GitHub manual prod approval | "manual, approved step" | On **GitHub Free private repos: no required reviewers, no wait timers, no environment secrets or variables, no deployment-branch rules**, and branch protection is limited [?] | **CHANGE NEEDED** | [S] docs.github.com (deployments-and-environments) |
| 31 | Vitest + Workers pool | Vitest | `@cloudflare/vitest-pool-workers` 0.22.0 peers **vitest ^4.1.0**. Vitest 5.0.3 is out but **not supported** by the pool | **CHANGE (pin)** | [S] npm peerDependencies |
| 32 | Node LTS | — | **Node 24 (Krypton) is Active LTS until 2026-10-20, then Maintenance. Node 26 becomes LTS on 2026-10-28** | OK: 24 now, 26 from Nov | [S] nodejs/Release schedule.json |
| 33 | TypeScript | — | **TS 7.0.2 (Go-native) is GA but ships no compiler API**; tools that need the API stay on **TS 6.0.x** | Pin 6.0.3 | [S] npm; TS 7 announcement |

---

## 1. Pinned versions (checked against npm and GitHub on 2026-10-06)

| Package / tool | Pin | Note |
|---|---|---|
| Node.js | **24.21.0** → switch to **26.x** after 2026-10-28 | Astro 7 needs ≥ 22.12, React Router 8 needs ≥ 22.22, Wrangler needs ≥ 22 |
| pnpm | **12.9.1** | pnpm 12 now reports unknown `pnpm-workspace.yaml` keys. Set `minimumReleaseAge` (supply-chain delay) |
| TypeScript | **6.0.3** | TS 7.0.2 (`tsgo`) can be added later as a fast CI type-check. Keep 6.x as `typescript` for tools that need the API |
| wrangler | **4.147.0** | Generate binding types with `wrangler types` |
| @cloudflare/vite-plugin | **1.62.5** | Peers vite 6–8 and wrangler ^4.147 |
| @cloudflare/workers-types | 5.20261006.1 | Only if not using `wrangler types` |
| astro | **7.3.5** | 7.4 is in beta |
| @astrojs/cloudflare | 14.3.3 | **Optional**: not needed if the site is static + a hand-written Worker (§3) |
| hono | **4.13.13** | |
| @hono/zod-validator / @hono/standard-validator | 0.9.1 / 0.4.0 | Pick one. Standard Schema keeps the validator swappable |
| react, react-dom | **19.3.0** | |
| react-router | **8.4.0** | v7.18.4 gets security fixes only |
| vite | **8.3.2** | Rolldown bundler |
| @tanstack/react-query | **5.104.1** | |
| react-hook-form + @hookform/resolvers | **7.89.0 + 5.9.1** | Resolvers support zod ^3.25 and ^4 |
| zod | **4.6.5** | Use `zod/mini` in the SPA if bundle size matters |
| drizzle-orm / drizzle-kit / drizzle-zod | **0.45.3 / 0.31.11 / 0.8.3** | Don't use 1.0.0-rc.x in production |
| better-auth (only if chosen) | 1.7.7 | Peers drizzle-orm ^0.45.2 or 1.0 RC |
| @oslojs/otp, @oslojs/crypto, @oslojs/encoding | **1.1.0, 1.0.1, 1.1.0** | Updated 2026-07-29. For the in-house auth option |
| hash-wasm | **4.12.0** | Last published 2024-11, but stable and widely used [I] |
| aws4fetch | **1.0.20** | Tiny SigV4 signer; last release 2024-08 (stable) |
| stripe | **23.0.0** | API version `2026-09-30.endive`. v23 drops Node 18 and changes the `verifyHeader` tolerance default |
| Razorpay, PayPal | **no SDK** | Plain `fetch` (both SDKs use axios) |
| @sentry/cloudflare, @sentry/react | **11.4.0** | v11.0 released 2026-09-23 |
| vitest | **4.1.11** | **Not 5.x**: the Workers pool peers ^4.1.0 |
| @cloudflare/vitest-pool-workers | **0.22.0** | |
| @playwright/test / @axe-core/playwright | **1.63.0 / 4.13.0** | |
| @biomejs/biome | **2.5.15** | Lint + format; no TS-API dependency |
| PDF fallback | @cantoo/pdf-lib **2.11.1** (+ @pdf-lib/fontkit 1.1.1) | Original `pdf-lib` 1.17.1 hasn't been published since 2022; the @cantoo fork is maintained |
| GitHub Actions | `cloudflare/wrangler-action@v4.1.3`, `aws-actions/configure-aws-credentials@v6.3.0`, `actions/checkout@v7.0.1`, `actions/setup-node@v7.0.0`, `pnpm/action-setup@v6.1.0` | Pin each to its **commit SHA** in workflows |
| age (CLI) | **v1.3.2** | Encrypts backups; `age-encryption` (JS) 0.3.1 exists but the CLI is simpler in CI |

---

## 2. Cloudflare Free plan: details and gotchas

### 2.1 Workers core
- **CPU 10 ms per HTTP request and per Cron invocation.** I/O wait (fetch, D1, R2, Queues) doesn't count. Cloudflare: "The average Worker uses approximately 2.2 ms per request. Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10–20 ms." [S] https://developers.cloudflare.com/workers/platform/limits/
- Real-world warning: a Hono + Drizzle + JWT CRUD app on Free saw `exceededCpu` at **10–52 ms** on list and summary routes; its profiling blamed "JWT verification, JSON handling, Drizzle result transformation, aggregation, and serialization". [S, secondary] https://github.com/abdullahnettoor/pumpos/issues/113
- Other limits: 100k requests/day (Error 1027 after that), 50 subrequests/request, 128 MB memory, 64 MiB script (uncompressed), 1 s startup, 64 env vars per Worker, 6 simultaneous connections waiting for headers. [S] limits page
- **`run_worker_first` gotcha (Free):** routes listed in `run_worker_first` always invoke the Worker. Once the daily limit is hit they return **429** instead of falling back to static assets. Keep the list to `/api/*`. [S] https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- **`_headers` covers static assets only.** Responses produced by Worker code must set their own headers (use Hono `secureHeaders`). [S] https://developers.cloudflare.com/workers/static-assets/headers/
- Account budget: 4 Workers × 2 environments = 8 of 100. D1: prod + staging = 2 of 10. Crons: **5 per account in total** (each schedule expression counts [I]). Use **one** schedule (for example every 15 minutes) and dispatch in code, plus at most one daily schedule.

### 2.2 D1
- Free: 10 databases, 500 MB per database, 5 GB per account, 5M rows read/day, 100k rows written/day, **50 queries per invocation**, 100 bound parameters per query, 100 KB per SQL statement, 2 MB per row, 30 s max query, 7-day Time Travel. [S] https://developers.cloudflare.com/d1/platform/limits/
- **Since 2026-09-01 the daily read/write limits are enforced.** Queries fail with "Your account has exceeded D1's free tier daily row read limit…" until midnight UTC. [S] https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/ → [I] Index every filter column. Never full-scan in list endpoints. Paginate with keysets. Read `meta.rows_read` in tests and alert at 50% of the daily budget.
- **Batch = transaction:** "Batched statements are SQL transactions… If a statement in the sequence fails… it aborts or rolls back the entire sequence." D1 runs in auto-commit and has no interactive `BEGIN…COMMIT` from Workers. [S] https://developers.cloudflare.com/d1/worker-api/d1-database/
- Each database is single-threaded (one query at a time). That's fine at our scale, and it helps with counters. [S] limits page
- Drizzle batch API: `db.batch([...])` with typed results. [S] Context7 /drizzle-team/drizzle-orm-docs (sqlite/batch-api)

### 2.3 R2, Queues, Cron
- R2 Free: 10 GB-month, 1M Class A and 10M Class B operations a month, free egress. [S] https://developers.cloudflare.com/workers/platform/pricing/
- **Queues on Free: yes.** 10,000 ops/day. "In most cases, it takes 3 operations to deliver a message", and each retry adds a read. Retention is a fixed 24 h. Both plans: 128 KB per message, 100 retries, batch ≤ 100, `delaySeconds` ≤ 24 h, 15 min consumer wall time, 250 concurrent consumers. [S] https://developers.cloudflare.com/queues/platform/pricing/ , https://developers.cloudflare.com/queues/platform/limits/
- **Consumer CPU:** the page says consumers "share the same per invocation CPU limits as any Workers do", and only Paid can raise `limits.cpu_ms`. **Assume 10 ms on Free [?].** So rule 4 in §3C.4 must read "**queues add retries and pacing, not CPU**":
  - every unit of work (one email, one PDF, one reminder) must fit in < 10 ms CPU
  - set `max_batch_size` small (1–5)
  - set `max_concurrency: 1` for PDF jobs
- Cron handler: 10 ms CPU, 15 min wall. Only enqueue work there.
- Workflows (not in the plan) are also 10 ms CPU on Free, with 3,000 steps/day. [S] pricing page

### 2.4 Rate limiting, Turnstile, WAF, Access, Email Routing
- **Rate Limiting binding:** `ratelimits` in wrangler config, `env.X.limit({ key })`, period 10 or 60 s. Counters are **per Cloudflare location and eventually consistent**, so it's a brake, not an exact quota. Cloudflare advises against keying on IP alone, so key on `ip + route` and on `account + route` (login). GA 2025-09-19; the docs page shows no plan restriction. [S] https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ ; plan availability from secondary sources [?] → [I] Keep a D1-backed fail counter for **account lockout**, because that must be exact.
- **Turnstile:** free, unlimited challenges, 20 widgets, 10 hostnames per widget. [S] https://developers.cloudflare.com/turnstile/plans/
- **Cloudflare Access:** Zero Trust Free covers 50 users (secondary: https://costbench.com/software/business-vpn/cloudflare-zero-trust/free-plan/ ). Access can gate `workers.dev`, Preview and Version URLs, and `ctx.access` exposes the identity. [S] https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ → [I] **Use Access on staging and preview URLs from day 1** (it closes the "public staging" hole) as well as optionally on `admin.`. [?] Onboarding the Zero Trust org may ask for a payment method even on Free. Check in the dashboard.
- **Email Routing (inbound)** is free and unlimited. Outbound Cloudflare Email Service needs Workers Paid, so SES stays. [S] 03-B §1 (email-service/pricing)

### 2.5 Observability
- Workers Logs today (Free): 200k events/day, 3-day retention. [S] https://developers.cloudflare.com/workers/observability/logs/workers-logs/ (updated 2026-10-02)
- **From 2026-12-01** all logs and traces use **Cloudflare Observability pricing**. Free: **0.5 GB ingestion per day, seven-day retention**, "Additional ingestion: Not available". "On Free, Cloudflare stops ingesting new data when the account reaches its daily limit." [S] https://developers.cloudflare.com/observability/pricing/ (updated 2026-10-05)
- [I] It's free either way. Update §3C.3 from "3-day" to "7-day from Dec 2026". Log structured JSON, never personal data, and sample high-volume info logs so a spike can't use up the 0.5 GB cap.

### 2.6 Browser Run (HTML → PDF): see §9

### 2.7 Paid-only (or limited) items the plan treated as free
| Item | Reality | Mitigation |
|---|---|---|
| Queue consumers "for long work" | 10 ms CPU on Free [?] | Split work into small units; Browser Run does the heavy rendering off-Worker |
| GitHub required reviewers / environment secrets (private repo) | Not on GitHub Free | §14 |
| Sentry team access | 1 user on the free plan | Owner-only seat; alerts emailed to a shared inbox |
| Cloudflare Email **Sending** | Paid only | SES (already chosen) |
| Configurable log retention | Coming later; paid | 7 days is enough. Keep the audit log in D1 |
| D1 30-day Time Travel | Paid | 7-day + nightly S3 export (already planned) |

---

## 3. Astro (public site)

- **Astro 7.3.5** is current. 7.0 shipped on **2026-06-22** with Vite 8 (Rolldown), a Rust `.astro` compiler and a Rust Markdown pipeline (Sätteri). Breaking changes are small: no HTML auto-correction, JSX-style strictness for unclosed tags, JSX whitespace rules. Upgrade with `npx @astrojs/upgrade`. Needs Node ≥ 22.12. [S] https://astro.build/blog/astro-7/ ; npm engines
- **Adapter:** `@astrojs/cloudflare` 14.3.3 (peers astro ^7.2, wrangler ^4.125). Pages support was removed in v13; it targets Workers only. [S] npm; https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- **Content collections:** Content Layer API only. Use `src/content.config.ts`, `defineCollection({ loader: glob({ base, pattern }), schema })` and `z` from `astro/zod`. Legacy collections were removed in v6. [S] Context7 /withastro/docs (content-collections, upgrade-to/v6)
- **Images:** the adapter's default `imageService` is `'cloudflare-binding'` (Cloudflare Images at runtime). For a static site, use **build-time processing**. Without the adapter Astro uses Sharp at build time; with the adapter set `imageService: 'compile'` (runtime falls back to passthrough). That gives zero runtime image cost and no Images quota. [S] Context7 adapter docs (`imageService` options, since 14.2.0)

**Recommended deployment for `web` [I]:**
- `output: 'static'` with **no adapter**: `astro build` writes `dist/`.
- A **hand-written Worker** `src/worker.ts` (plain or Hono) handles `/api/forms` only.
- wrangler config: `"main": "src/worker.ts"`, `"assets": { "directory": "./dist", "not_found_handling": "404-page", "run_worker_first": ["/api/*"] }`.
- Static pages never invoke the Worker (free, unlimited, no CPU). The form endpoint carries no Astro runtime, so its CPU stays near Turnstile verify + zod + `queue.send()`.
- Security headers for pages go in `public/_headers`. The Worker sets its own headers for `/api/*`.

[S] static-assets binding docs (`run_worker_first` array, globs, `!` negation, ≤ 100 entries) · deploy guide (static `wrangler.jsonc` with `assets.directory`)

- Alternative: keep the adapter and mark one endpoint `export const prerender = false`. That works, but it ships Astro's server runtime for one route and adds CPU per request. Not recommended under 10 ms [I].
- Content-driven prices: if prices come from the admin catalogue, **bake them at build time** (a CI step fetches a signed JSON export) or fetch them client-side from a cached JSON. Don't use server islands, which would put the site on the CPU budget [I].

---

## 4. Hono API (admin, portal, jobs, forms)

- **hono 4.13.13** (2026-10-04). [S] npm
- **Middleware:**
  - `secureHeaders()` (HSTS, nosniff, COOP/CORP, Referrer-Policy and so on; CSP is configured separately, with nonce support). [S] https://hono.dev/docs/middleware/builtin/secure-headers
  - `csrf()` checks `Origin` and/or `Sec-Fetch-Site`. **Gotcha:** it only checks unsafe methods with *form* content types (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), not JSON. [S] https://hono.dev/docs/middleware/builtin/csrf → [I] Add our own middleware that rejects every unsafe method unless `Origin` equals the app origin **and** `Content-Type: application/json` (JSON from another origin forces a CORS preflight, which we never allow). Webhook routes are exempt and verify signatures instead.
  - `hono/cookie` (`setCookie` / `getSignedCookie` with `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`), `bodyLimit`, `timing` (dev only).
  - Validation: `@hono/zod-validator` 0.9.1 (zod ^3.25 or ^4) or `@hono/standard-validator` 0.4.0 (any Standard Schema validator). [S] npm
- **RPC:** `hc<AppType>()` from `hono/client` gives typed calls from the SPA with no codegen. [I] Export `AppType` from a `routes.ts` that chains `.route()`s; type-check performance degrades with very large apps, so split per module. Error responses need explicit typing.

---

## 5. Admin and portal SPA

- **React 19.3.0, React Router 8.4.0, Vite 8.3.2.** RR v8 (2026-06-17) has minimal breaking changes and is ESM-only. It **removed its own Cloudflare dev proxy in favour of `@cloudflare/vite-plugin`**. v7 gets security fixes only. [S] https://remix.run/blog/react-router-v8
- [I] Use **Data mode** (`createBrowserRouter`) in a plain Vite SPA. Framework mode isn't needed when there's no SSR. Use `@cloudflare/vite-plugin` 1.62.5 so `vite dev` runs the Hono API in workerd alongside the SPA. Deploy as one Worker per realm with `assets.not_found_handling: "single-page-application"` and `run_worker_first: ["/api/*"]`.
- **TanStack Query 5.104.1** for server state. **react-hook-form 7.89.0 + @hookform/resolvers 5.9.1 + zod 4.6.5** for forms. Share zod schemas from `packages/core` between client and API [I].
- **CSP for a static SPA:** nonces aren't possible on static HTML. Vite emits external scripts, so `script-src 'self'` works. Avoid inline scripts, and set it in `_headers` [I].

---

## 6. Database: Drizzle + D1 + Zod

- **Status:** `drizzle-orm` **0.45.3** is the stable `latest` (2026-09-21), with `drizzle-kit` 0.31.11. **1.0.0-rc.4 (2026-06-27) is the newest RC, with nothing since.** [S] npm, https://github.com/drizzle-team/drizzle-orm/releases → **Pin 0.45.3.** The 1.0 roadmap includes a new migrations folder format ("folder v3, remove journal"). [S] https://orm.drizzle.team/roadmap → plan one migration step when 1.0 goes GA.
- **Migrations:** `drizzle-kit generate` writes SQL into `migrations_dir` and **`wrangler d1 migrations apply <db> --remote`** applies it (tracked in `d1_migrations`). Don't use `drizzle-kit push` against production. [S] Context7 drizzle docs (d1 get-started: `migrations_dir = "drizzle"`)
- **Tests:** `readD1Migrations()` in vitest config plus `applyD1Migrations()` from `cloudflare:test` in a setup file. [S] Context7 /cloudflare/workers-sdk
- **Zod:** zod 4.6.5. `drizzle-zod` 0.8.3 peers `zod ^3.25 || ^4` and `drizzle-orm >=0.36`. Derive insert/select schemas, then tighten them by hand for API input (money as integer paise, enums) [I].

**Gap-free invoice numbering on D1 [I]** (D1 is single-writer, and a batch is one transaction):

```sql
-- statement 1 (in db.batch):
UPDATE doc_counters SET next_no = next_no + 1
 WHERE series = ?1 AND fy = ?2;
-- statement 2:
INSERT INTO invoices (id, series, fy, number, ...)
SELECT ?3, ?1, ?2, next_no - 1, ...
  FROM doc_counters WHERE series = ?1 AND fy = ?2;
-- statement 3: INSERT INTO audit_log (...)
```

- Run all three in **one `db.batch()`**. If any fails, all roll back, so no number is consumed. Don't read the counter in JS and write it back; there is no interactive transaction.
- Add `UNIQUE(series, fy, number)` as a safety net.
- Seed the counter row per FY on 1 April with a cron job, or with `INSERT … ON CONFLICT DO NOTHING` as statement 0.
- Numbers are only assigned at **issue** time (drafts have no number), so deleting a draft never leaves a gap.
- Better Auth itself notes that D1 lacks transactions for its SCIM feature. [S] https://better-auth.com/blog/1-7

---

## 7. Authentication

### 7.1 Better Auth (1.7.7, 2026-09-30)
- **Fits technically:**
  - native D1 (`database: env.DB`, since 1.5)
  - `twoFactor` plugin (TOTP + backup codes; 1.7 lets you choose OTP or TOTP explicitly)
  - `magicLink` plugin (1.7: "safer passwordless recovery")
  - **custom password hashing**: `emailAndPassword.password: { hash, verify }`, documented with examples

  [S] Context7 /better-auth/better-auth (email-password, security); https://better-auth.com/blog/1-7
- **Measured [M]** (Node, memory adapter, twoFactor + magicLink):
  - importing the library: ≈ 830 ms (Node, disk I/O included; on Workers this is startup, capped at 1 s, so check with `wrangler check startup`)
  - first `betterAuth()` construction: **≈ 9 ms**; warm: 0.36 ms
  - warm `get-session`: **≈ 1.1 ms** (plus D1 I/O)

  So a warm session check fits. The **first request in a fresh isolate is close to the 10 ms limit** [I].
- **Weak spots for this design [I]:**
  1. Two realms (staff on `admin.`, clients on `portal.`) need **two instances** with separate cookie prefixes, separate base paths and table mapping (or one user table with a realm column). It's doable but fights the library's single-user-model design.
  2. The browser-Argon2 flow needs a **pre-login salt endpoint** and a fixed "password" format (the client hash), so the stock sign-up and password-change flows have to be wrapped anyway.
  3. Passwordless clients and password + mandatory-TOTP staff are two very different flows.
  4. Big dependency surface and fast release cadence (1.7 had breaking changes to account identity).
- **Known Workers issue:** the default scrypt takes 73–170 ms of CPU. [S] https://github.com/better-auth/better-auth/issues/8860 → that's avoided by our custom hasher.

### 7.2 Recommended: a small in-house auth package (`packages/auth`) [I]
- **Libraries:**
  - `@oslojs/otp` 1.1.0: `createTOTPKeyURI`, `verifyTOTPWithGracePeriod`
  - `@oslojs/crypto` 1.0.1 / `@oslojs/encoding` 1.1.0: base32 and SHA helpers
  - Web Crypto for HMAC-SHA-256 and random values
  - Lucia's published guides (the project is now a learning resource) as the reference design
- **Tables:** `staff_users`, `staff_sessions`, `staff_totp` (encrypted secret + used-step marker to stop replay), `staff_recovery_codes` (hashed), `client_contacts`, `client_sessions`, `magic_link_tokens` (store the SHA-256 of the token, single use, 15-minute expiry), `auth_attempts` (exact lockout counter).
- **Session:**
  - 32-byte random token in a `__Host-` cookie; the D1 row stores **SHA-256(token)**
  - idle and absolute expiry
  - one indexed D1 read per request, refreshed at most every N minutes to save writes (D1 Free allows 100k writes/day)
- **Effort:** roughly 600–900 lines plus tests. CPU per request is about 1 HMAC/SHA plus 1 D1 read.

### 7.3 Browser-side Argon2id
- **Library: hash-wasm 4.12.0.** The `argon2` module is self-contained (includes BLAKE2b), **29.5 KB minified / 11.6 KB gzip** [M]. `@noble/hashes` 2.4.0 has `argon2id`, but its own README warns: "Argon2 can't be fast in JS… Being 5x slower than native code means brute-forcing attackers have bigger advantage" (and argon2 was outside its audit). `argon2-browser` 1.18.0 was last published in 2022. [S] npm; https://github.com/paulmillr/noble-hashes
- **Parameters (OWASP):** minimum **m = 19 MiB, t = 2, p = 1**; equivalent options: 46 MiB/t=1, 12 MiB/t=3, 9 MiB/t=4, 7 MiB/t=5. [S] https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **Measured [M]** (desktop, hash-wasm, single thread): m=19 MiB/t=2 ≈ **90 ms**; m=64 MiB/t=3 ≈ **318 ms**. A mid-range phone is typically several times slower [I, ?].
  - **Start with m = 19 MiB, t = 2, p = 1** (expect ≈ 300–600 ms on a mid-range phone [?]).
  - Store the parameters per user (`v`, `m`, `t`, `p`) so they can be raised later.
  - Calibrate on a real ₹15–25k Android phone in Phase 6.
  - p > 1 gives no speed-up in single-threaded WASM.
- **Run it in a Web Worker** (module worker, `postMessage` of the password bytes; wipe the buffer after use) so the UI doesn't freeze.
- **Security caveats [I]:**
  1. The client hash **is the password-equivalent**. Anyone who captures it in transit or logs can log in, so TLS is mandatory, never log the body, and keep the server-side **HMAC-SHA-256(pepper, salt ‖ clientHash)** so a DB leak alone is useless without the pepper (a Wrangler secret).
  2. **Salt lookup without enumeration:** `POST /auth/salt {email}` returns the real salt, or **HMAC(pepper2, lower(email))[:16]** for unknown emails, with the same latency and shape. Rate-limit it.
  3. Argon2 in the browser gives no protection against an attacker who already has the pepper **and** the DB. They still have to run Argon2 per guess, which is the intended property.
  4. Check password strength client-side (zxcvbn-ts or a length ≥ 12 rule) and check breached passwords with HIBP k-anonymity **from the browser**, since the server never sees the password.
  5. A password change re-derives everything client-side. Rotating the pepper forces password resets (OWASP).
  6. Constant-time compare on the server (`crypto.subtle.verify` with HMAC, or `timingSafeEqual` under nodejs_compat).

---

## 8. Server CPU per operation

| Operation | Measured [M] (Node 24, desktop) | Published numbers |
|---|---|---|
| Web Crypto HMAC-SHA-256, imported key, 48 B | **≈ 34 µs** | none found |
| `importKey` + HMAC (per request) | **≈ 56 µs** | none found |
| TOTP verify (`@oslojs/otp`, pure-JS SHA-1) | **≈ 15 µs** | none found |
| Stripe `constructEventAsync` (SubtleCrypto, 258 B) | **≈ 83 µs** | none found |
| aws4fetch SigV4 sign: 2 KB / 300 KB body | **≈ 0.24 ms / ≈ 0.95 ms** | none found |
| Base64 of 150 KB: naive `btoa(String.fromCharCode…)` / `Buffer` | **≈ 8.1 ms / ≈ 0.3 ms** | — |
| Better Auth warm `get-session` (memory DB) | **≈ 1.1 ms** | — |
| D1 query | I/O wait isn't CPU; only result mapping counts | CF: average Worker ≈ 2.2 ms/request [S] |

- [I] Each crypto primitive is far below 1 ms. **The 10 ms risk comes from framework init on cold isolates, JSON and serialisation of big lists, Drizzle mapping of large result sets, and base64 or large string work.**
- Measure in workerd: CPU time is in every Workers Logs invocation record and in `wrangler dev` DevTools CPU profiles. [S] limits page
- Phase 6 gate: p99 CPU < 7 ms on each route under realistic data.

---

## 9. PDF on Workers

- **Recommended: the Quick Action through the binding.**
  - Binding `{ "browser": { "binding": "BROWSER" } }`, then `env.BROWSER.quickAction("pdf", { html, addStyleTag, pdfOptions })`. No API token needed.
  - REST equivalent: `POST /accounts/{id}/browser-run/pdf`.
  - Supports `html` input, `pdfOptions.format: "a4"`, `displayHeaderFooter`, and `headerTemplate`/`footerTemplate` with `pageNumber`, `totalPages`, `date` and `title` placeholders. Request body up to 50 MB.
  - Billed in browser time only; the `X-Browser-Ms-Used` header reports usage; failed `waitForTimeout` calls aren't charged.

  [S] https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/ (updated 2026-09-26), /pricing
- **Gotcha:** `.quickAction()` **doesn't work in local mode**. Use `wrangler dev --remote` or `"remote": true` on the binding, which uses real quota. Mock the binding in Vitest. [S] browser-run/quick-actions
- **Puppeteer binding** (`@cloudflare/puppeteer` 1.4.0) vs Quick Action: on Free, new browsers are limited to 1 per 20 s, and the Worker drives CDP messages over a WebSocket, so **Worker CPU grows with page complexity** and puts the 10 ms limit at risk [I]. The Quick Action is one request, and the rendering CPU happens in Cloudflare's browser, not your Worker. **Use the Quick Action.**
- **Fonts and ₹:** Browser Run has a fixed set of pre-installed fonts. Inject a self-hosted `@font-face` through `addStyleTag` as a **Base64 data URI** (preferred, no network fetch) or a URL. [S] https://developers.cloudflare.com/browser-run/features/custom-fonts/ → [I] Subset the font (Latin + U+20B9 ₹), WOFF2, ≈ 20–40 KB per weight. Test that ₹ renders in the PDF in CI against staging.
- **Rate and quota (Free):** 10 browser-minutes a day, Quick Actions 1 per 10 s, 60 s timeout. [S] limits page
  - Queue consumer settings: `max_batch_size: 1`, `max_concurrency: 1`; on 429, `msg.retry({ delaySeconds: 15 })`.
  - Store the result in R2 with `sha256` and never re-render.
  - Typical render time for a 1–2 page invoice: **[?] not published.** Measure with `X-Browser-Ms-Used`; my estimate of 1–3 s means ≈ 200–600 renders/day fit in 10 minutes [I].
- **Worker CPU in the consumer:** pass the PDF `Response.body` stream straight into `env.R2.put()` so it isn't buffered or re-encoded [I].
- **Fallback: pdf-lib.** Pure JS, runs on Workers [S, 03-B §5]. Use the maintained **@cantoo/pdf-lib 2.11.1** with `@pdf-lib/fontkit`; embed a subset TTF that contains U+20B9. **CPU risk [?]:** font parsing and subsetting can take several ms. Pre-subset the font at build time, keep receipts to one page, and measure. Use it only for receipts, or when the Browser Run quota is exhausted.

---

## 10. Amazon SES (ap-south-1) from Workers

- **Availability in ap-south-1** (AWS regional-availability API, 2026-10-06): `SESv2:SendEmail`, `SESv2:CreateConfigurationSetEventDestination`, `EventBridge:CreateApiDestination` and `SNS:Subscribe` are all **available**. [S]
- **Send:** `POST https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails`, signed with **aws4fetch** (`new AwsClient({ accessKeyId, secretAccessKey, region: "ap-south-1", service: "ses" })`). It's ≈ 65 KB unpacked and has no dependencies. Signing cost: [M] §8. SESv2 accepts messages up to **40 MB** (over 10 MB may be throttled). [S] https://aws.amazon.com/ses/faqs/
- **Gotchas:**
  - **Don't attach PDFs by default.** Email a short-lived portal link instead: it keeps CPU low, keeps the message small, and gives better deliverability [I].
  - If an attachment is needed, base64 with `Buffer` (nodejs_compat) or `Uint8Array.prototype.toBase64` [?: check workerd support], never a `String.fromCharCode` loop (≈ 8 ms per 150 KB [M]).
  - Use an IAM user limited to `ses:SendEmail` on the one identity and configuration set (no other permissions); Workers can't use OIDC roles.
  - Request SES production access (leave the sandbox) early.
- **Bounces and complaints [I]:**
  - **EventBridge** destination on the configuration set → rule → **API destination** (HTTPS to `hooks.techaust.com/ses`, auth by API-key header).
  - The Worker only has to compare a secret header with a constant-time check.
  - The alternative, SNS HTTPS, needs SNS message-signature verification: fetch the X.509 cert from `SigningCertURL` (allow-list `sns.ap-south-1.amazonaws.com`), parse the cert, then RSA-SHA256 verify. That's more code.
  - Destination types (CloudWatch, Firehose, EventBridge, Pinpoint, SNS) [S] https://repost.aws/knowledge-center/ses-email-opens-clicks. EventBridge API-destination pricing [?] (pennies at our volume).
  - Also enable the SES **account-level suppression list**.

---

## 11. Payments on Workers

- **Stripe:**
  - `stripe` **23.0.0** (2026-09-30) pins API **`2026-09-30.endive`**. It has no dependencies and an explicit `workerd`/`worker` export condition (fetch HTTP client).
  - Use `stripe.webhooks.constructEventAsync(rawBody, sig, secret, undefined, Stripe.createSubtleCryptoProvider())` on the **raw** body (`await c.req.text()`).
  - v23 change: `verifyHeader(Async)` now applies `DEFAULT_TOLERANCE` when tolerance is omitted, and `constructEventWithoutVerification` was removed from the top level.

  [S] npm; https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md · [I] Optional: skip the SDK and call `fetch` for Checkout Sessions with a hand-rolled verifier (`t=…,v1=…`, HMAC-SHA-256 over `${t}.${body}`, 5-minute tolerance) to shrink the Worker.
- **Razorpay:**
  - The official `razorpay` 2.9.8 SDK depends on axios, so **use plain `fetch`** with Basic auth (`key_id:key_secret`).
  - **Payment Links:** `POST https://api.razorpay.com/v1/payment_links/`. `accept_partial` + `first_min_partial_amount` (required when partial is on). `expire_by` must be "at least 15 minutes in future" and **no more than 6 months** out. `reference_id` ≤ 40 chars. `upi_link: true` links are INR-only and **don't support partial payments**. `callback_method` must be `get`.

    [S] https://razorpay.com/docs/api/payments/payment-links/create-standard/
  - **Webhooks:** `X-Razorpay-Signature` = HMAC-SHA-256(webhook secret, **raw body**). Dedupe on `x-razorpay-event-id`. After a secret rotation, validate retries with the old secret. [S] https://razorpay.com/docs/webhooks/validate-test/
- **PayPal:**
  - `@paypal/paypal-server-sdk` 2.5.0 uses an APIMatic axios adapter, so **use `fetch`** against **Orders v2** (`/v2/checkout/orders`, capture) with OAuth client-credentials (cache the token in memory or D1).
  - Webhook verification options: (a) **postback** to `POST /v1/notifications/verify-webhook-signature`; (b) **self-verification**, which PayPal now calls "the preferred method": RSA-SHA256 over `transmissionId|timeStamp|webhookId|crc32(rawBody)` using the cert at `paypal-cert-url`. PayPal retries "up to 25 times over 3 days". [S] https://developer.paypal.com/api/rest/webhooks/rest/
  - [I] Start with **postback**: two subrequests, no X.509 parsing, fine at our volume. Move to self-verification later, with a host allow-list (`api.paypal.com` / `api.sandbox.paypal.com`), cert caching and a small DER parser.
- **All gateways:**
  - verify on the raw body
  - store the event id `UNIQUE` (idempotency)
  - acknowledge fast (2xx) after a `queue.send()`, and process in the consumer

---

## 12. Sentry and uptime

- **@sentry/cloudflare 11.4.0** (`withSentry(env => ({ dsn, tracesSampleRate: 0 }), handler)`) and `@sentry/react` 11.4.0. [S] npm
- **Free Developer plan: 1 user, 5,000 errors/month, 5M spans, 50 replays, 5 GB logs, 1 cron monitor, 1 uptime monitor, 1 GB attachments, 30-day lookback.** [S] https://sentry.io/pricing/ → only the owner gets a seat; send alerts to a shared inbox.
- [I] Errors only (no tracing) to save CPU and quota. Scrub PII (`sendDefaultPii: false`, a `beforeSend` that strips emails and amounts). Use the free **cron monitor** for the nightly backup job.
- **Uptime:**
  - Sentry's one free uptime monitor → `https://techaust.com/`.
  - **UptimeRobot** free (50 monitors, 5-minute interval). Its commercial-use terms have changed more than once (sources conflict on whether the Oct 2024 "non-commercial" rule still applies as of Aug 2026) **[?]**. Check the ToS before relying on it.
  - Alternative: Better Stack free tier [?] (limits not checked).
  - Add a `/healthz` route on each Worker that does **no** D1 query, to save reads.

---

## 13. Backups: D1 → age → S3 Mumbai

- `wrangler d1 export <db> --remote --output=db.sql` (options `--table`, `--no-data`, `--no-schema`). **Known limitations:**
  - "Export is not supported for virtual tables", so **don't use FTS5**, or drop and recreate it around the export
  - "**A running export will block other database requests**", so run it at about 21:30 UTC (03:00 IST)

  [S] https://developers.cloudflare.com/d1/best-practices/import-export-data/
- REST alternative: `POST /accounts/{account_id}/d1/database/{database_id}/export` with `output_format: "polling"`, poll with `current_bookmark`, then download from `result.signed_url`, which is valid for one hour. [S] Cloudflare API reference (d1 database export)
- [?] Export row reads probably count toward the 5M/day free read budget. That's fine at < 1 GB, but watch it.
- **Encrypt:** `age` v1.3.2 with the **recipient public key** only in CI (`age -r age1… -o db.sql.age db.sql`). The identity (private key) stays offline with the owner. [S] GitHub release
- **Upload:** `aws-actions/configure-aws-credentials@v6.3.0` with `role-to-assume` (GitHub OIDC; `permissions: id-token: write`). OIDC works on free private repos [I]. The IAM role trust policy is restricted to `token.actions.githubusercontent.com:sub = repo:techaust/techaust_platform:ref:refs/heads/main` (or the workflow's environment). Permissions are only `s3:PutObject` on the backup prefix. The bucket has versioning + Object Lock (governance) + a lifecycle rule (90 daily copies, monthly copies kept 6+ years; VERIFY WITH CA).
- The Cloudflare token for export needs **D1 Read only**. Note `wrangler d1 export` may need D1 Edit [?]. Test with a minimal token.
- Quarterly restore drill: `wrangler d1 execute <scratch-db> --remote --file=db.sql` on a scratch database (D1 has a 10-DB limit, so delete it afterwards).

---

## 14. GitHub Actions on a free private repo

> **Note (2026-10-07):** Repo public since [ADR 0012](../adr/0012-public-repository.md); see the [ADR 0009](../adr/0009-owner-only-prod-deploy.md) update (2026-10-07).

- `cloudflare/wrangler-action` **v4.1.3** (2026-09-24). [S] GitHub releases
- **Plan limits (GitHub Free, private repo):** [S] https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
  - "required reviewers are only available for public repositories" (Free, Pro and Team)
  - wait timers: public only
  - **"If you are using GitHub Free, environment secrets are only available in public repositories"**
  - environment variables and deployment branches/tags on private repos need Pro or Team
  - Branch protection and rulesets on private repos are also limited on Free [?] (rulesets are documented for Team and Enterprise). Check in repo settings.
- **So §3C.3's "production deploy is a manual, approved step" can't be enforced by GitHub on Free.** Options:

| Option | How | Cost | Strength |
|---|---|---|---|
| **A (recommended for now) [I]** | `deploy-prod.yml` is triggered **only by `workflow_dispatch`**, with a required input `confirm` that must equal `deploy techaust.com <short-sha>`, plus a job guard `if: github.actor == '<owner-login>' && github.ref == 'refs/heads/main'`. It uses a separate **repo secret** `CF_API_TOKEN_PROD` scoped to the production Workers + D1 only. Staging uses a different token | ₹0 | Stops accidents, **not** a malicious collaborator with write access (who could add a workflow that reads repo secrets). Acceptable with 2–5 trusted seniors. Others should get **Triage/Read**, or work via PRs |
| B | Upgrade the org to **GitHub Team** ($4/user/month) | ≈ ₹360/user/month | Real required reviewers, environment secrets and branch rules |
| C | Production deploys run from the owner's machine (`wrangler deploy` with a local token), and CI only builds and verifies | ₹0 | Strong secret isolation, but deploys aren't reproducible from CI |

- Pin all actions by SHA. Set `permissions: contents: read` by default and `id-token: write` only on the backup job. Use `concurrency` groups per environment.

---

## 15. Tooling

- **pnpm 12.9.1** (12.0 released 2026-08-26). Breaking: `--frozen-lockfile false` is gone (use `--no-frozen-lockfile`), unknown workspace settings are reported, `--resolution-only` was removed. [S] https://pnpm.io/blog/releases/12.0 (via search) → set `packageManager: "pnpm@12.9.1"` in the root `package.json`.
- **Node:** 24.x now; **26 LTS from 2026-10-28** (24 enters Maintenance on 2026-10-20 and reaches EOL on 2028-04-30). [S] https://github.com/nodejs/Release/blob/main/schedule.json
- **TypeScript:** 7.0 (Go-native) went GA on 2026-07-08, is "often about 10 times faster", and **ships without an API**. Microsoft provides `@typescript/typescript6` (6.0.2) for side-by-side use. [S] https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ (via search), npm → [I] Pin **typescript 6.0.3** (Astro check / Volar, typescript-eslint and the Hono RPC editor experience rely on the TS API). Optionally add `tsgo` as a fast CI-only `--noEmit` check. Revisit when TS 7.1 ships its API.
- **Biome 2.5.15 vs ESLint 10 + Prettier 3.9:** [I] **Biome.** One fast tool, no dependency on the TS API (so no TS 7 blocker), and enough rules for a small team. Use ESLint only if a specific plugin is needed (none planned). Keep `astro check` for `.astro` type checks.
- **Renovate vs Dependabot:** [I] **Renovate** (free Mend app; v44.x current). Use grouped monorepo updates, the `minimumReleaseAge: "7 days"` supply-chain delay, lockfile maintenance, and automerge for patch-level dev dependencies only. Dependabot is fine too (native; supports pnpm, groups and cooldown) if you want zero third-party apps. Pair either with pnpm's own `minimumReleaseAge` and `onlyBuiltDependencies` allow-list.

---

## 16. Blockers and risks for the free plan

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **Queue consumers and crons have 10 ms CPU on Free [?]**, not "long work" | Background jobs that batch many emails or PDFs fail with `exceededCpu` | One unit of work per message; `max_batch_size` 1–5; heavy rendering goes to Browser Run; measure every consumer; DLQ + alert |
| R2 | **D1 daily limits hard-enforced since 2026-09-01** | All DB-backed surfaces fail until 00:00 UTC (05:30 IST) | Indexes on every filter; keyset pagination; few session writes; dashboard counters precomputed by cron; alert on `rows_read` > 50% of the budget; the jobs Worker stops non-essential work near the cap |
| R3 | **Cold-isolate CPU** (framework init, Better Auth construction ≈ 9 ms [M]) | Sporadic 1102 errors on the first request | Lazy-init per isolate (module-level cache); in-house auth; avoid heavy SDKs (Stripe SDK optional); check `wrangler check startup` and Workers Logs CPU p99 |
| R4 | **Big JSON lists and Drizzle mapping** exceed 10 ms (seen in the wild) | Admin list pages fail | Page size ≤ 50; select only needed columns; aggregate in SQL; cached report tables built by cron |
| R5 | **Browser Run: 10 min/day, 1 Quick Action per 10 s** | PDF backlog on busy days | Queue pacing with retry delays; render once and store in R2; templates kept light (no remote assets; fonts as data URIs); pdf-lib fallback for receipts; upgrade trigger in §3C.4 |
| R6 | **Base64 / large-string work** (≈ 8 ms per 150 KB, naive) | Email-with-attachment jobs fail | Send portal links, not attachments; if needed, use `Buffer`/`toBase64` |
| R7 | **100k requests/day** shared by all Workers, with `run_worker_first` routes returning 429 after the cap | A bot flood on `/api/forms` or SPA API routes uses up the daily budget | WAF free custom rules + rate-limit rule in front; Turnstile; Rate Limiting binding; static assets don't count; keep `run_worker_first` minimal |
| R8 | **Queues: 10k ops/day ≈ 3.3k messages** | Retry storms consume the budget | `max_retries` 3–5 with backoff; DLQ; idempotent consumers |
| R9 | **GitHub Free private repo**: no reviewers or environment secrets | No enforced prod approval; prod token reachable by write collaborators | §14 option A (dispatch + typed confirm + actor guard + scoped token); limit write access; option B ($4/user) if the team grows |
| R10 | **Sentry free = 1 user** | The team can't see issues | Owner seat + shared alert inbox; Workers Logs for everyone |
| R11 | **Observability after 2026-12-01**: ingestion stops at 0.5 GB/day | Logs lost during an incident spike | Sample info logs, log errors always; audit log lives in D1, not in logs |
| R12 | **Cron Triggers: 5 per account** (staging + prod share them) | Can't add schedules freely | One 15-minute dispatcher + one daily schedule per environment (4 total) |
| R13 | **Browser Run Quick Action is remote-only in dev** | Uses the free quota during development | Mock in tests; render PDFs only in an explicit staging check |
| R14 | **Client-side hashing** makes the client hash a password-equivalent | Leak via logs or MITM | TLS-only, never log bodies, server HMAC with pepper, constant-time compare, rate limits, Turnstile after failures |
| R15 | **D1 export blocks the DB; FTS5 breaks export** | Short outage at backup time; failed backups | Run at a quiet hour (≈ 03:00 IST); no virtual tables; Sentry cron monitor on the backup job |
| R16 | **Version drift** (Astro 7, RR 8, Vitest 5 incompatible with the Workers pool, TS 7 without an API) | Broken toolchain mid-build | Pin per §1; Renovate with release-age delay; upgrade only through PRs with CI green |
| R17 | **D1 data residency**: no India region (unchanged) | Contractual blocker for some clients | Unchanged from 03-B §8 (VERIFY WITH CA/LEGAL) |

---

## 17. Changes to make in the Phase 5 architecture doc [I]

1. Astro 6 → **Astro 7.3**. Public site = static build + a hand-written `/api/*` Worker (no adapter), images processed at build time.
2. React Router v7 → **v8.4 (Data mode)** with `@cloudflare/vite-plugin`.
3. §3C.4 rule 4: queues give **retries and pacing, not CPU**. Every job unit must be < 10 ms.
4. Auth: **in-house `packages/auth`** (oslo + Web Crypto + D1 sessions), with Better Auth as a documented alternative. Confirm in the Phase 6 CPU spike.
5. Observability: 7-day retention and a 0.5 GB/day cap from 2026-12-01.
6. CI: GitHub Free can't enforce approvals or environment secrets → adopt §14 option A (or budget GitHub Team).
7. Pin Vitest 4.1.x, TypeScript 6.0.3 and Drizzle 0.45.3. Node 24 → 26 after 28 Oct 2026.
8. SES bounces via EventBridge API destination; PDFs linked, not attached.
9. Sentry: one seat, errors only; use its free uptime and cron monitors.
