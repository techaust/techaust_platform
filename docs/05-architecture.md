# 05: Architecture

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Inputs** | [03 §3C](03-plan.md) (approved) · [04 PRD](04-prd.md) · stack verification [05-A](05-research-appendix/A-stack-verification.md) · GST research [08-A](08-research-appendix/A-gst-invoicing.md) · legal research [08-B](08-research-appendix/B-dpdp-legal.md) |
| **Hard constraint** | **Cloudflare Workers Free plan, permanently**: 10 ms CPU per invocation (HTTP, cron **and queue consumers**), 100k requests/day, D1 5M reads / 100k writes per day (**hard-enforced since 2026-09-01**), Browser Run 10 min/day |

> **Changes from the approved plan** (owner-approved 2026-10-06 or version-only):
> 1. **Astro 6 → Astro 7.3** (released June 2026; version only).
> 2. **React Router v7 → v8.4**, data mode (v7 now gets security fixes only).
> 3. **Better Auth → a small in-house auth package** (owner-approved: two clean realms; Better Auth's ≈ 9 ms cold start is too close to the 10 ms limit).
> 4. **Queues provide retries and pacing, not extra CPU**: every job unit must fit in 10 ms.
> 5. **Production deploys use an owner-only manual workflow** (owner-approved), because GitHub Free private repos can't enforce reviewers. (Update 2026-10-07: the repo is now public, so this premise changed; the decision stands, see [ADR 0009](adr/0009-owner-only-prod-deploy.md).)
> 6. Worker logs: 7-day retention and a 0.5 GB/day cap from 2026-12-01. Security logs are kept in D1 for 13 months.
>
> **Changes made during Phase 5 (setup, 2026-10-06):**
> 7. **Worker names are `techaust-platform-<app>`** (+ `-staging`), so no deploy can ever overwrite the live Worker `techaust-web` (ADR 0011).
> 8. **Tests use `@cloudflare/vitest-plugin`** 1.3.6 (the renamed Workers test pool, `cloudflareTest()`), and Worker types come from **`wrangler types`** instead of `@cloudflare/workers-types`.
> 9. **pnpm 12** uses `allowBuilds` (not `onlyBuiltDependencies`) and a 1-day `minimumReleaseAge`.
> 10. **The repo is public** (owner decision). That makes branch protection free, so `main` is now protected (PR + green CI required). Workflows are hardened for public repos (ADR 0012).
>
> **Changes made during Phase 6 M1.1 (2026-10-06):**
> 11. **New brand identity "Patina"** replaces the supplied logo (owner request; ADR 0013, docs/06 §1–3, docs/11). Fonts are now **Archivo + IBM Plex Mono** (Newsreader and IBM Plex Sans dropped).
> 12. **The brand is generated from code:**
>     - `packages/ui/src/brand/geometry.ts` → master SVG → every logo, icon, social image and print PDF
>     - tests guard geometry, contrast, fonts and print colours
>     - the build scripts live in `packages/ui/scripts/` (not the root `scripts/`)
> 13. **Generated design outputs are committed** (`packages/ui/generated/`, `fonts/`, `brand/`), since packages stay source-only. Drift tests fail if they don't match their sources.
>
> **Changes made during Phase 6 M1.3 (2026-10-06):**
> 14. **Issue guard (fixes a gap in §5.4).** An `UPDATE … WHERE status = 'draft'` that matches no row doesn't fail, so the original batch could consume a number for a document that wasn't a draft. Every issue batch now starts with `INSERT INTO issue_guard (document_id) VALUES (?)`, a view whose trigger aborts the whole batch unless the document is an unfrozen draft. **Owner decision 2026-10-07:** only drafts can be issued; a document waiting for approval must be approved first. The guard in code (`packages/db/src/triggers.ts`) still also accepts `pending_approval`; a new migration narrows it to `draft` before issuing is built (M3/M5, see [12-status](12-status.md)).
> 15. **Triggers are generated from the schema** (`packages/db/src/triggers.ts`), so every content column of `documents` is covered. A test reads the installed trigger and fails if a column is missing. Migrations are never edited after they are applied; a new document column needs a new migration that recreates the trigger.
> 16. **Staging D1 is migrated and seeded on every merge** (owner decision), before the Workers deploy. The seed is insert-only (`ON CONFLICT DO NOTHING`), so it never overwrites edits made in the admin.
> 17. **Tables arrive with their milestones.** M1.3 creates identity, settings, CRM, catalogue, documents and the audit/access logs (36 tables). Payments, checkout sessions, webhook events, credits and settlements come with M6; email log and suppressions with M2.4; notifications, review items, DSR requests, idempotency keys and stats with the features that use them.

---

## 1. System overview

```text
                         ┌────────────────────────── Cloudflare (Free plan) ──────────────────────────┐
 Visitors ─────────────▶ │ techaust.com        Worker "web"     Astro 7 static assets (no CPU)       │
                         │                     run_worker_first: /api/*  → forms (Turnstile, zod,     │
                         │                     rate limit) → Queue "leads"   · /api/geo (country)     │
                         │                     NO D1 / R2 bindings                                     │
 Staff ────────────────▶ │ admin.techaust.com  Worker "admin"   React SPA assets + Hono /api/*       │
                         │                     staff auth (password+TOTP), RBAC, audit ──┐            │
 Clients ──────────────▶ │ portal.techaust.com Worker "portal"  React SPA assets + Hono /api/*   │    │
                         │                     magic-link auth, client-scoped ──────────────┤          │
                         │                                                                  ▼          │
 Gateways, SES ────────▶ │ hooks.techaust.com  Worker "jobs"    webhooks · queue consumers · crons     │
                         │                     ──▶ D1 (prod)  ──▶ R2 (files, PDFs, snapshots)         │
                         │                     ──▶ Browser Run (HTML → PDF, Quick Action)             │
                         └────────┬──────────────────────────────┬─────────────────────────────────────┘
                                  │ SESv2 HTTPS (aws4fetch)      │ GitHub Actions nightly (OIDC)
                                  ▼                              ▼
                         Amazon SES ap-south-1          D1 export → age-encrypt → S3 ap-south-1
                         (events → EventBridge →
                          API destination → hooks /ses)
```

### 1.1 Security boundaries
1. **The public site cannot read data.** The `web` Worker has only a Queue producer, a rate limiter and the Turnstile secret. A CI check fails if a D1/R2 binding appears in `apps/web/wrangler.jsonc`.
2. **Two auth realms.** Staff (admin) and clients (portal) are separate Workers on separate hosts, with separate cookie names, session tables and code paths. A portal session can never authorise an admin route, and vice versa.
3. **Jobs are headless.** The `jobs` Worker has no UI. Webhook routes authenticate by signature; everything else is internal (queues, cron).
4. **Client scoping.** In the portal, the client ID always comes from the session, never from the request.

### 1.2 Free-plan engineering rules (supersede [03 §3C.4](03-plan.md))
1. **Nothing heavy per invocation.** HTTP, cron and queue handlers all have 10 ms of CPU. I/O wait doesn't count. Target p99 ≤ 7 ms (the Phase 6 gate).
2. **Password hashing in the browser** (Argon2id); the server does one HMAC. TOTP, sessions and webhook checks are microseconds.
3. **Static or cached first.** The website is static. The SPAs are static assets. `run_worker_first` lists only `/api/*` (after the daily cap those routes return 429, but static pages keep working).
4. **One unit of work per queue message.** `max_batch_size` 1–5; `max_concurrency: 1` for PDFs; retries with backoff; dead-letter queues.
5. **Cron only enqueues** (≤ 5 ms).
6. **Render once.** PDFs are rendered on issue/send/accept, stored in R2 with a SHA-256 hash, and never re-rendered.
7. **D1 thrift.** Index every filter column; keyset pagination (≤ 50 rows); select only needed columns; aggregate in SQL; session "last seen" written at most every 15 minutes; dashboard figures served from a `stats_daily` table refreshed by cron. Alert at 50 % of the daily read/write budget.
8. **No base64 of big blobs** in Workers. Email links, not attachments. Fonts are pre-encoded as data URIs at build time.
9. **Lazy init per isolate.** Module-level singletons; no heavy SDKs. Stripe's SDK is optional; Razorpay and PayPal use plain `fetch`.
10. **Upgrade triggers** ([03 §3C.4](03-plan.md)): if any one trips, I'll propose Workers Paid ($5) for your approval.
    - CPU-limit errors above 0.1 %
    - the PDF quota hit more than twice a month
    - D1 limits hit
    - sustained traffic above 50k requests/day

---

## 2. Stack and pinned versions

All versions are pinned exactly (no `^`). Renovate will open grouped PRs after a **7-day release-age delay** once the owner installs the app (pending, see [12-status](12-status.md)). Details and sources: [05-A §1](05-research-appendix/A-stack-verification.md).

| Layer | Choice | Pin |
|---|---|---|
| Runtime / tooling | Node.js (→ 26 LTS after 2026-10-28) · pnpm · TypeScript · wrangler · `@cloudflare/vite-plugin` | 24.x (`.nvmrc` `24`; engines ≥ 24.19.0) · 12.9.1 · 6.0.3 · 4.147.0 · 1.62.5 |
| Public site | Astro (static output, **no adapter**), build-time images (Sharp) | astro 7.3.5 |
| APIs | Hono (+ `@hono/standard-validator`) on all four Workers | 4.13.13 (+ 0.4.0) |
| SPAs | React · React Router (data mode, `createBrowserRouter`) · Vite (Rolldown) · TanStack Query · react-hook-form + resolvers · Radix UI primitives | 19.3.0 · 8.4.0 · 8.3.2 · 5.104.1 · 7.89.0 + 5.9.1 · latest-pinned |
| Validation | Zod (shared schemas; `zod/mini` in the SPAs where it helps bundle size) | 4.6.5 |
| Database | Cloudflare D1 + Drizzle ORM / drizzle-kit / drizzle-zod (**not** 1.0 RC) | 0.45.3 / 0.31.11 / 0.8.3 |
| Auth | In-house `packages/auth`: `@oslojs/otp`, `@oslojs/crypto`, `@oslojs/encoding`, Web Crypto; browser Argon2id via **hash-wasm** | 1.1.0 / 1.0.1 / 1.1.0; hash-wasm 4.12.0 |
| Files | Cloudflare R2 (private buckets) | — |
| PDF | Browser Run **Quick Action `pdf`** via the `BROWSER` binding; fallback `@cantoo/pdf-lib` + `@pdf-lib/fontkit` (receipts only) | 2.11.1 + 1.1.1 |
| Email | Amazon SES v2 (ap-south-1) via **aws4fetch** | 1.0.20 |
| Payments | Razorpay (fetch), Stripe (`stripe` SDK or fetch), PayPal Orders v2 (fetch) | stripe 23.0.0 (API `2026-09-30.endive`) |
| Errors | `@sentry/cloudflare`, `@sentry/react` (errors only, PII scrubbed) | 11.4.0 |
| Tests | Vitest + **`@cloudflare/vitest-plugin`** (`cloudflareTest()`; tests run inside workerd; **Vitest 5 not supported yet**) · fast-check (property tests) + `@vitest/coverage-v8` (core ≥ 90 % gate) · Playwright + `@axe-core/playwright` · Lighthouse CI | 4.1.11 + 1.3.6 · 4.10.2 + 4.1.11 · 1.63.0 + 4.13.0 |
| Worker types | Generated per app by **`wrangler types`** → `worker-configuration.d.ts` (git-ignored; runs inside `pnpm typecheck`) | wrangler 4.147.0 |
| Lint / format | Biome (+ `astro check` for `.astro`) | 2.5.15 |
| CI | GitHub Actions; actions pinned by commit SHA (`wrangler-action@v4.1.3`, `configure-aws-credentials@v6.3.0` …) | — |
| Backups | `age` CLI | 1.3.2 |
| Design system build (dev-only, `packages/ui`) | Tailwind v4 (theme compile test) · fonts from Fontsource (Archivo, IBM Plex Mono) · subsetting/outlines: subset-font + harfbuzzjs + fontverter, metrics: fontkitten · rasters: sharp · print PDFs: `@cantoo/pdf-lib` · print CMYK: LittleCMS via Pillow (one-off Windows script) | 4.3.3 · 5.3.0 / 5.3.0 · 2.9.0 + 1.6.2 + 2.0.0, 1.0.3 · 0.35.5 · 2.11.1 |

---

## 3. Monorepo layout (pnpm workspaces)

```text
techaust_platform/
├─ apps/
│  ├─ web/                    # techaust.com: Astro 7 static site + tiny Worker
│  │  ├─ src/pages/ …         # routes (04 §3)
│  │  ├─ src/content/         # Markdown: services, industries, blog, work, legal (content.config.ts)
│  │  ├─ src/components/      # Astro components (06 §5.2)
│  │  ├─ src/data/            # catalogue-snapshot.json (fetched in CI; seed fallback committed)
│  │  ├─ src/worker.ts        # Hono: /api/forms/quote, /api/forms/contact, /api/geo
│  │  ├─ public/_headers      # security headers for static assets
│  │  └─ wrangler.jsonc
│  ├─ admin/                  # admin.techaust.com
│  │  ├─ src/                 # React SPA (routes, screens)
│  │  ├─ worker/              # Hono API (/api/v1/*), auth, RBAC middleware
│  │  └─ wrangler.jsonc
│  ├─ portal/                 # portal.techaust.com (same shape as admin)
│  └─ jobs/                   # hooks.techaust.com: webhooks, queue consumers, crons (Hono)
├─ packages/
│  ├─ core/                   # PURE, no I/O: money, tax engine, numbering format, FY/dates,
│  │                          #   payment schedules, permissions matrix, GSTIN/state codes,
│  │                          #   amount-in-words, zod schemas (forms + API), document state machines
│  ├─ db/                     # Drizzle schema, migrations (SQL), repositories, seed (catalogue S1–S18)
│  ├─ auth/                   # sessions, password HMAC, TOTP, recovery codes, magic links,
│  │                          #   step-up, lockout counters, browser Argon2id worker (client export)
│  ├─ payments/               # PaymentProvider interface + razorpay, stripe, paypal, manual
│  ├─ pdf/                    # document templates (HTML strings), print CSS, embedded fonts, render client
│  ├─ email/                  # templates (HTML + text), SES client, header sanitising
│  ├─ ui/                     # tokens/tokens.json → generated/ (CSS, Tailwind theme, email, print);
│  │                          #   fonts/ (subset WOFF2); brand/ (all logo files + print/ PDFs, generated
│  │                          #   from src/brand/geometry.ts); scripts/ (draw:master, build:*); React components later
│  ├─ config/                 # tsconfig bases (biome.json is at the repo root)
│  └─ testing/                # fixtures, factories, fake clock, recorded gateway payloads
├─ scripts/                   # check-web-bindings.mjs (CI guard); later: catalogue snapshot, content lint
│                             #   (font, brand and contrast tooling lives in packages/ui)
├─ docs/                      # 01–11 + appendices + runbooks + ADRs (docs/adr/NNNN-*.md)
├─ brand-incoming/            # owner-supplied originals (git-ignored; the old logo is retired, ADR 0013)
├─ .github/workflows/         # ci.yml, deploy-staging.yml, deploy-prod.yml, backup.yml (restore-drill.yml planned for Phase 7)
├─ .env.example               # documents every variable/secret name (no values)
├─ CLAUDE.md
├─ package.json  pnpm-workspace.yaml  renovate.json  biome.json
```

**Dependency rules** (enforced by review today; a lint check is planned):
- `core` depends on nothing internal.
- `db` → `core`.
- `auth`, `payments`, `pdf`, `email` → `core` (+ `db` where needed).
- Apps → packages; **packages never import apps**.
- `apps/web` may import only `core` (schemas) and `ui` (tokens).

---

## 4. Workers, bindings and configuration

> **Worker names** (ADR 0011): `techaust-platform-{web,admin,portal,jobs}` (+ `-staging`). The live site is the old Worker **`techaust-web`**, so the new names deliberately differ and no deploy can overwrite it.

| Worker | Hosts (prod / staging) | Bindings | Secrets (Wrangler) |
|---|---|---|---|
| `web` | `techaust.com` (+ `www` 301) / `techaust-platform-web-staging.<acct>.workers.dev` | `ASSETS`, `LEADS_QUEUE` (producer), `RL_FORMS` (rate limit) | `TURNSTILE_SECRET` |
| `admin` | `admin.techaust.com` / `techaust-platform-admin-staging…` | `ASSETS`, `DB`, `FILES` (R2), `DOCS` (R2), `PDF_QUEUE`, `EMAIL_QUEUE`, `EVENTS_QUEUE`, `RL_AUTH`, `RL_API` | `PASSWORD_PEPPER`, `SALT_PEPPER`, `TOTP_ENC_KEY`, `SESSION_HMAC_KEY`, `TURNSTILE_SECRET`, gateway keys (create checkout/refund), `BUILD_SNAPSHOT_TOKEN` |
| `portal` | `portal.techaust.com` / `techaust-platform-portal-staging…` | `ASSETS`, `DB`, `FILES`, `DOCS`, `EMAIL_QUEUE`, `EVENTS_QUEUE`, `RL_AUTH`, `RL_API` | `SESSION_HMAC_KEY`, `MAGIC_LINK_KEY`, `DOC_TOKEN_KEY`, `TURNSTILE_SECRET`, gateway keys (create checkout) |
| `jobs` | `hooks.techaust.com` / `techaust-platform-jobs-staging…` | `DB`, `FILES`, `DOCS`, `BROWSER`, consumers of `leads` / `pdf` / `email` / `events` (+ DLQs), cron triggers | `RAZORPAY_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_*`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_EVENTS_TOKEN`, gateway API keys (status checks, refunds), `SENTRY_DSN` |

**Plain (non-secret) vars:** `ENVIRONMENT` (`local|staging|production`), `APP_ORIGIN`, `PAYMENTS_LIVE_ALLOWED` (`false` until the Phase 7 approval), `SES_REGION=ap-south-1`, `SES_CONFIG_SET`, sender addresses.

**Cron triggers:** 5 per account in total. Each environment uses **two**: a `*/15 * * * *` dispatcher (reminders in the 09:00–19:00 IST window, care-plan billing at 06:00 IST, digests) and a daily `0 22 * * *` UTC (03:30 IST) maintenance run (overdue marking, expiry, retention, stats). That's 4 of 5 in total.

**Package manager:** pnpm 12.9.1 (pinned via `packageManager`; plain `pnpm` auto-switches). `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (a package must be ≥ 1 day old; if a pin is too new, choose the previous release rather than bypassing the rule) and `allowBuilds` (only `esbuild` and `workerd` may run install scripts).

**Local development:** `pnpm dev` runs all four Workers (`@cloudflare/vite-plugin` for the SPAs; `wrangler dev` for web/jobs) with local D1/R2/Queues (Miniflare), Turnstile **test keys**, gateway **test keys** in `.dev.vars` (git-ignored; `.dev.vars.example` committed per app from M1.4) and a **mocked Browser Run** (the Quick Action is remote-only). A `pnpm dev:pdf-remote` script (planned, M4.4) will use real Browser Run against staging when needed.

---

## 5. Data model (D1 / SQLite, Drizzle)

### 5.1 Conventions
- **IDs:** UUIDv7 text (time-ordered, index-friendly). Human references are separate columns (`ref`, `code`, `number_display`).
- **Time:** `INTEGER` ms since epoch, UTC. FY and IST are computed in `core`.
- **Money:** `INTEGER` minor units (paise/cents) with a `currency` column (`INR`/`USD`). **Rates** in basis points (`1800` = 18 %). **Quantities** in milli-units (`1500` = 1.5). **FX** as INR micros per USD (`88_420_000` = ₹88.42).
- **JSON** columns (`TEXT` with a zod-validated shape) only for snapshots, addresses and small config. Anything that is filtered on gets its own column.
- **Soft rules in triggers:** append-only tables and frozen documents are enforced by SQLite triggers (`RAISE(ABORT, …)`), not just by app code.
- Every table has `created_at` and `updated_at` (where mutable).

### 5.2 Tables

**Identity and auth**

| Table | Key columns |
|---|---|
| `staff_users` | id, email (unique, lower), name, role (`owner`/`staff`/`sales`/`accountant`), status (`invited`/`active`/`deactivated`), pw_salt, pw_hmac, pw_params (`{v,m,t,p}`), totp_secret_enc, totp_last_step, totp_enabled_at, last_login_at |
| `staff_recovery_codes` | id, user_id, code_hash, used_at |
| `staff_sessions` | id (= SHA-256 of the token), user_id, created_at, last_seen_at, idle_expires_at, abs_expires_at, step_up_until, ip, user_agent, revoked_at · idx(user_id) |
| `staff_invites` | token_hash, email, role, invited_by, expires_at, used_at |
| `auth_attempts` | key (`acct:<id>` / `ip:<ip>`), window_start, failures, locked_until (exact lockout counter) |
| `client_sessions` | id (hash), contact_id, client_id, created_at, last_seen_at, idle/abs expiry, ip, user_agent, revoked_at |
| `magic_link_tokens` | token_hash, contact_id, expires_at (15 min), used_at, request_ip |
| `doc_access_tokens` | token_hash, document_id, purpose (`view_pay`), expires_at, revoked_at (POR-06) |

**Settings and reference data**

| Table | Key columns |
|---|---|
| `settings` | key (`company`, `tax`, `numbering`, `payment_terms`, `email`, `retention`, `flags`, `gateways`), value (JSON, zod-validated), version, updated_by, updated_at. Each change is audit-logged with a before/after. |
| `bank_accounts` | id, kind (`INR`/`USD_SWIFT`), account_name, account_no, ifsc, swift, bank_name, branch, bank_address, intermediary, active |
| `doc_counters` | series, fy (`2627`), next_no · PK(series, fy) |
| `terms_versions` | id, kind (`proposal`/`invoice`/`website`), version, body_md, sha256, created_at |
| `fx_rates` | date, pair (`USDINR`), rate_micros, source (`FBIL/RBI`/manual), entered_by |

**CRM and delivery**

| Table | Key columns |
|---|---|
| `leads` | id, ref (`L-7K3Q9`, unique), stage, lost_reason, source, form_version, service_code, budget_band, timeline, currency, message, tools (JSON), contact name/email/phone/company/country, call_window, utm (JSON), source_page, referrer_host, **consent** (JSON: notice_version, purposes, at, ip_hash, marketing, withdrawn_at), owner_id, next_action_at, next_action_note, client_id, last_activity_at, delete_after, legal_hold · idx(stage), idx(owner_id, next_action_at), idx(email) |
| `lead_activities` | id, lead_id, kind, body, actor_id, created_at |
| `clients` | id, code, legal_name, display_name, type, country, gst_status (`registered`/`unregistered`/`overseas`), gstin, state_code, billing_address (JSON), service_address (JSON), currency, payment_terms_days, reminder_policy (JSON), care_auto_issue, attach_pdf, tags (JSON), notes, legal_hold · idx(display_name), unique(gstin) where not null |
| `contacts` | id, client_id, name, email, phone, title, is_primary, is_billing, portal_access, can_see_finance, marketing_consent (JSON), bounced_at, anonymised_at · unique(client_id, email), idx(email) |
| `projects` | id, code, client_id, source_document_id, name, status, start_date, target_date, owner_id, currency, budget_minor |
| `milestones` | id, project_id, position, title, amount_minor, pct_bp, due_date, status, delivered_at, document_id |
| `notes` | id, client_id, project_id, visibility (`internal`/`shared`), body_md, author_id |
| `files` | id, client_id, project_id, r2_key, filename, mime, size, sha256, shared, uploaded_by |
| `care_plans` | id, client_id, tier, currency, price_minor, included_minutes, ai_ops_minor, start_date, billing_day (1–28), status, rollover, overage_rate_minor, auto_issue, paused_at, cancelled_at, last_billed_period |
| `time_logs` | id, user_id, work_date, minutes, project_id, care_plan_id, note, billable, locked_at · idx(project_id, work_date), idx(care_plan_id, work_date) |

**Catalogue and templates**

| Table | Key columns |
|---|---|
| `catalogue_items` | id, code (`S1`…`S18`), name, category, short, long_md, unit, price_inr_minor, price_usd_minor, sac, gst_rate_bp, deliverables_md, assumptions_md, exclusions_md, schedule (JSON: instalments as bp), slug, show_on_site, active |
| `catalogue_price_history` | id, item_id, field, old_minor, new_minor, changed_by, changed_at |
| `templates` | id, category, kind (`proposal`/`estimate`/`care_block`/`terms_block`), version, body (JSON sections with placeholders) |
| `site_snapshots` | id, sha256, json (public fields only), published_by, published_at |

**Documents (one table for all commercial documents)**

| Table | Key columns |
|---|---|
| `documents` | id, **type** (`proposal`, `estimate`, `proforma`, `tax_invoice`, `export_invoice`, `credit_note`, `debit_note`, `receipt`, `receipt_voucher`, `refund_voucher`), status, client_id, project_id, care_plan_id, **parent_id** (credit/debit note → invoice; tax invoice → proforma; receipt → payment), **version_group_id + version** (proposals/estimates), series, fy, number, number_display (unique per series+fy), currency, issue_date, due_date, valid_until, supply_type (`intra`/`inter`/`export_lut`/`export_igst`), place_of_supply_code, recipient snapshot (JSON), fx_rate_micros, fx_date, fx_source, subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor, total_inr_minor, **paid_minor, credited_minor, balance_minor** (derived, maintained by the ledger), terms_version_id, **snapshot_r2_key, snapshot_sha256, pdf_r2_key, pdf_sha256, frozen_at**, issued_by, voided_at, void_reason, realisation_due_at (exports), irn, ack_no, ack_date, signed_qr, einv_status · unique(series, fy, number) · idx(client_id, type, status), idx(status, due_date) |
| `document_lines` | id, document_id, position, catalogue_item_id, description, sac, qty_milli, unit, rate_minor, discount_kind, discount_value, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor |
| `document_sections` | id, document_id, kind, position, hidden, title, body_md (proposals) |
| `payment_schedules` | id, document_id, position, label, trigger (`on_accept`/`milestone`/`delivery`/`monthly`), pct_bp, amount_minor, milestone_id |
| `acceptances` | id, document_id, contact_id, session_id, typed_name, email, accepted_at, ip, user_agent, country, pdf_sha256, terms_version_id, certificate_r2_key · unique(document_id) |
| `approvals` | id, kind (`discount`/`issue`/`payment_verify`/`refund`), document_id, payment_id, requested_by, reason, content_sha256 (invalidated if the document changes), status, decided_by, decided_at, note |
| `reminders` | id, document_id, offset_days, due_at, sent_at, email_log_id, skipped_reason · unique(document_id, offset_days) |

**Money**

| Table | Key columns |
|---|---|
| `payments` | id, document_id, client_id, provider (`razorpay`/`stripe`/`paypal`/`manual`), kind (`payment`/`refund`/`tds`/`credit_applied`), status (`pending`/`pending_verification`/`confirmed`/`failed`/`reversed`), amount_minor, currency, amount_inr_minor, fee_minor, provider_payment_id, provider_order_id, utr, mode, paid_at, recorded_by, verified_by, verified_at, proof_file_id, **fira_ref, fira_file_id**, receipt_document_id, tds_section, notes · unique(provider, provider_payment_id) |
| `checkout_sessions` | id, document_id, provider, provider_ref, amount_minor, currency, status, url, expires_at, created_by (staff/contact/token) |
| `webhook_events` | id, provider, event_id, type, received_at, processed_at, status (`received`/`processed`/`ignored`/`needs_review`/`failed`), error, payload_r2_key · **unique(provider, event_id)** |
| `client_credits` | id, client_id, currency, amount_minor, source_payment_id, applied_document_id, status |
| `settlements` | id, provider, settlement_id, amount_minor, fees_minor, settled_at, matched (Razorpay recon, ADM-PAY-10) |

**Email, ops and compliance**

| Table | Key columns |
|---|---|
| `email_log` | id, to_email, template, entity_type, entity_id, ses_message_id, status (`queued`/`sent`/`delivered`/`bounced`/`complained`/`failed`), error, created_at, updated_at · idx(entity_type, entity_id) |
| `email_suppressions` | email, reason, at |
| `audit_log` | id, at, actor_type (`staff`/`contact`/`system`/`webhook`), actor_id, role, action, entity_type, entity_id, summary (JSON diff, sensitive fields masked), ip, user_agent, request_id · **triggers block UPDATE/DELETE** |
| `access_log` | id, at, realm, actor_id, method, route, status, ip, user_agent, request_id (security log, 13-month retention) |
| `notifications` | id, user_id, kind, entity_type, entity_id, title, read_at |
| `review_items` | id, source (`webhook`/`dlq`/`recon`), ref, summary, payload_r2_key, status, resolved_by |
| `dsr_requests` | id, contact_id or email, kind (`access`/`correction`/`erasure`/`withdraw`/`nominate`), status, received_at, due_at (30 days), closed_at, notes |
| `idempotency_keys` | key, realm, route, request_sha256, response_status, response_body (small), created_at (24 h TTL) |
| `stats_daily` | date, metric, dimension, value (dashboard and report caches) |

### 5.3 Integrity rules enforced in the database
- **Frozen documents:** a `BEFORE UPDATE` trigger on `documents` aborts if `OLD.frozen_at IS NOT NULL` and any content column changes. Only the ledger columns (`paid_minor`, `credited_minor`, `balance_minor`, `status`), `voided_at`/`void_reason` and e-invoice fields may change. A matching trigger blocks `document_lines` changes for frozen parents.
- **Append-only:** `audit_log`, `acceptances` and `catalogue_price_history` refuse UPDATE/DELETE (M1.3); `webhook_events.payload` follows in M6. The retention job's trigger-guarded deletion path is added with the retention milestone; until then nothing can delete these rows.
- **Counters:** `doc_counters` rows can only move forward and can't be deleted (gap-free, never reused).
- **Uniqueness:** `(series, fy, number)`, `(provider, event_id)`, `(provider, provider_payment_id)`, `(document_id)` on acceptances.

### 5.4 Gap-free numbering (ADM-INV-03)

Issue happens in **one `db.batch()`**. D1 runs a batch as a single transaction: if any statement fails, everything rolls back and no number is consumed.

```sql
-- guard: abort the whole batch unless ?3 is an unfrozen draft (M1.3, change 14)
INSERT INTO issue_guard(document_id) VALUES (?3);
-- 0. ensure counter row exists for this FY
INSERT INTO doc_counters(series, fy, next_no) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING;
-- 1. take the number
UPDATE doc_counters SET next_no = next_no + 1 WHERE series = ?1 AND fy = ?2;
-- 2. freeze the draft with that number (fails if not a draft → whole batch rolls back)
UPDATE documents
   SET number = (SELECT next_no - 1 FROM doc_counters WHERE series = ?1 AND fy = ?2),
       number_display = ?formatted_by_sql_or_app,   -- format applied from core
       status = 'issued', frozen_at = ?now, issued_by = ?user, snapshot_sha256 = ?hash
 WHERE id = ?3 AND status = 'draft' AND frozen_at IS NULL;
-- 3. audit
INSERT INTO audit_log(...) VALUES (...);
```

The formatted number is computed in SQL from the counter value (`printf('TH/INV/%s/%04d', ?fy, next_no - 1)`) using the format from settings. `core/numbering` validates the format (≤ 16 characters; A–Z 0–9 `/` `-`) and has property tests. After the batch, a `pdf` job is enqueued. D1 is single-writer, so concurrent issues serialise. The test suite issues 20 in parallel and expects 20 consecutive numbers.

### 5.5 Migrations
- `drizzle-kit generate` writes SQL into `packages/db/migrations/`. It is reviewed in the PR and applied with `wrangler d1 migrations apply <db> --remote` by the deploy workflows (**staging first; production only in the approved prod workflow**). `drizzle-kit push` is banned.
- Triggers and views live in a custom migration generated from `packages/db/src/triggers.ts` by `scripts/write-triggers.ts`, alongside the drizzle-kit ones.
- Tests apply all migrations to a fresh D1 via `applyD1Migrations()`.
- CI fails if `src/schema` changed without a generated migration (`pnpm db:generate` must produce nothing).
- Local: `pnpm db:migrate:local` and `pnpm db:seed:local` (one shared local database in `.wrangler/state` for admin, portal and jobs). Staging: applied by `deploy-staging.yml` on merge.
- **Backward-compatible migrations only** (expand → migrate → contract across two releases), so a rollback of Worker code doesn't need a DB rollback.

---

## 6. Authentication design (`packages/auth`)

### 6.1 Staff login (admin): browser Argon2id + server HMAC + TOTP

```text
Browser (admin SPA)                       admin Worker (Hono)                         D1
───────────────────                       ───────────────────                         ──
1. POST /api/v1/auth/salt {email}  ─────▶ rate-limit (ip+route); Turnstile if flagged
                                          salt = user ? user.pw_salt
                                                      : HMAC(SALT_PEPPER, lower(email))[:16]
                                   ◀───── {salt, params:{v,m,t,p}}  (same shape and timing)
2. Web Worker: clientHash = Argon2id(password, salt, m=19MiB, t=2, p=1, 32 bytes)
3. POST /api/v1/auth/login {email, clientHash, turnstile?}
                                   ─────▶ check lockout (auth_attempts)
                                          expected = HMAC-SHA256(PASSWORD_PEPPER, salt‖clientHash)
                                          constant-time compare with user.pw_hmac   ─────▶ read user
                                          on failure: increment counters, generic error
                                   ◀───── {next: "totp", challenge}  (a short-lived, signed,
                                          single-use pre-auth token; no session yet)
4. POST /api/v1/auth/totp {challenge, code}
                                   ─────▶ verify TOTP (±1 step) and step > totp_last_step
                                          (replay guard); create session ─────────────▶ insert session
                                   ◀───── Set-Cookie: __Host-ta_admin=<32-byte token>;
                                          HttpOnly; Secure; SameSite=Strict; Path=/
```

| Topic | Design |
|---|---|
| Argon2id params | Start **m = 19 MiB, t = 2, p = 1** (OWASP minimum). Stored per user (`pw_params`) so they can be raised; re-hash on the next login when the params change. Calibrated on a ₹15–25k Android phone in M1 (target ≤ 800 ms). |
| Why safe | The client hash is a password-equivalent, so it never appears in logs (body logging is disabled on auth routes), it is TLS-only, and the server stores only an HMAC with a **pepper** held in Wrangler secrets. A DB leak without the pepper is useless; with the pepper, the attacker still pays Argon2id per guess. |
| No enumeration | Unknown emails get a deterministic fake salt; responses and timing are uniform; "invalid email or password" for everything. |
| Password strength | Checked **in the browser**: length ≥ 12, zxcvbn-ts score ≥ 3, and an optional HIBP k-anonymity range check (the browser calls `api.pwnedpasswords.com/range/<5 hex>`; CSP allows it on the password pages only). The server never sees the plain password. |
| TOTP | `@oslojs/otp`; the secret is encrypted with AES-GCM (`TOTP_ENC_KEY`). Enrolment shows a QR (otpauth URI) + secret; verified before it is enabled. 10 recovery codes (16 chars, base32), stored as SHA-256 hashes. |
| Sessions | 32 random bytes → cookie; DB stores SHA-256(token). Idle 12 h, absolute 7 days; `last_seen_at` written at most every 15 min; rotated on login and privilege change; "sign out everywhere". |
| Step-up | Sensitive actions (ADM-AUTH-08) need `step_up_until > now` (10 min), set by re-entering TOTP. |
| Lockout | Exact counters in D1 (`auth_attempts`): Turnstile after 3 failures; 15-min lock after 10 failures per hour per account; per-IP limits via the Rate Limiting binding (approximate) + D1 (exact). Emails on lockout. |
| Invites | Single-use invite link (48 h) → set password (browser Argon2id) → enrol TOTP → active. |
| Password reset | Owner-initiated only (no self-service email reset for staff, which removes a whole attack class). The Owner's own recovery: recovery codes, or a break-glass procedure documented in [08 §6](08-security-compliance.md). |
| CPU | Login ≈ 1 HMAC + 1 TOTP + 2–3 D1 queries: well under 1 ms of CPU (local measurement); **verified on Workers in M1**. |

### 6.2 Client login (portal): magic links
1. `POST /api/v1/auth/magic {email, turnstile}` → the same response every time. If the email belongs to a contact with `portal_access`: create a 32-byte token, store its SHA-256 (expires in 15 min), and send an email from `no-reply@`.
2. The link opens `portal…/auth/callback#t=<token>`. The **fragment** keeps the token out of server logs and referrers. The SPA POSTs it to `/api/v1/auth/magic/verify`, which marks it used (single use) and creates the session cookie `__Host-ta_portal` (SameSite=Lax; 30 days idle / 90 days absolute).
3. Email security scanners that pre-fetch links don't consume the token, because consumption requires the POST from the SPA.

### 6.3 Single-document access tokens (POR-06)
- "View & pay" links contain an unguessable token (≥ 128 bits). Its hash is stored in `doc_access_tokens`, bound to one document, valid until paid + 30 days and revocable.
- It grants read access to that document plus starting a checkout for it, nothing else. Its use is audit-logged.

### 6.4 Authorisation
- `core/permissions` holds the matrix ([04 §9](04-prd.md)) as data: `can(role, action, resource, context)`.
- Every Hono route declares its required permission, and a middleware enforces it. A test enumerates all routes and fails if any route lacks a declaration.
- Context rules: Sales can't see finance fields (the response mapper strips them, and the routes deny); Staff discount ≤ 10 % → send allowed, otherwise `approval_required`; issue invoice → Owner only; manual payments by Staff → `pending_verification`.

---

## 7. API design

### 7.1 Conventions
- **Base:** `/api/v1/…` on each realm host (admin, portal); `/api/forms/*` and `/api/geo` on web; `/razorpay`, `/stripe`, `/paypal`, `/ses`, `/healthz` on hooks.
- **JSON only.** Unsafe methods require `Content-Type: application/json` and `Origin` = the app origin (our CSRF middleware; Hono's built-in `csrf()` doesn't cover JSON). There is no CORS at all (same-origin SPA ↔ API).
- **Typed client:** Hono RPC (`hc<AppType>`) per module, imported by the SPA (no codegen).
- **Validation:** shared zod schemas from `core` via `@hono/standard-validator`; request body limit 64 KB (uploads go to R2 via a separate route with a size cap).
- **Errors:** `{"error": {"code": "approval_required", "message": "…", "fields": {"lines.2.rate": "…"}}}` with the correct HTTP status. No stack traces or internals (fixes audit M-1). Each error carries a `request_id`.
- **Pagination:** keyset: `?limit=25&cursor=<opaque>` → `{items, next_cursor}`; max 50.
- **Idempotency:** money and document state transitions accept an `Idempotency-Key` header (stored for 24 h). The SPA always sends one for issue, record payment, refund, accept and checkout.
- **Concurrency:** documents carry an `updated_at` version. Updates send `If-Match`, and a mismatch returns 409.
- **Security headers:** `secureHeaders()` on all API responses; static assets get them via `_headers`.

### 7.2 Admin API (summary)

| Module | Routes (all under `/api/v1`) |
|---|---|
| Auth | `POST auth/salt`, `auth/login`, `auth/totp`, `auth/step-up`, `auth/logout`, `GET auth/sessions`, `DELETE auth/sessions/:id`, `POST auth/totp/enrol`, `auth/totp/confirm`, `auth/recovery/regenerate`, `POST invites`, `POST invites/:token/accept` |
| Users & settings | `GET/POST/PATCH users`, `GET/PUT settings/:key`, `GET/PUT bank-accounts`, `GET/PUT numbering`, `POST settings/test-email` |
| Dashboard | `GET dashboard` |
| Leads | `GET/POST leads`, `GET/PATCH leads/:id`, `POST leads/:id/activities`, `POST leads/:id/convert`, `POST leads/:id/email` |
| Clients | `GET/POST clients`, `GET/PATCH clients/:id`, `GET/POST clients/:id/contacts`, `PATCH contacts/:id`, `GET clients/:id/statement?from&to`, `POST contacts/:id/export`, `POST contacts/:id/erase` |
| Projects | `GET/POST projects`, `GET/PATCH projects/:id`, `…/milestones`, `…/notes`, `POST files/upload-url`, `POST files` (finalise), `GET files/:id/download` (signed) |
| Care & time | `GET/POST care-plans`, `PATCH care-plans/:id`, `GET/POST time-logs`, `PATCH time-logs/:id` |
| Catalogue | `GET/POST/PATCH catalogue`, `GET templates`, `POST catalogue/publish` (creates `site_snapshots`), `GET public/catalogue-snapshot` (**build token only**, for CI) |
| Documents | `GET/POST documents?type=`, `GET/PATCH documents/:id` (drafts only), `POST documents/:id/lines`, `POST documents/:id/preview` (HTML), `POST documents/:id/send`, `POST documents/:id/request-approval`, `POST documents/:id/issue` (Owner + step-up), `POST documents/:id/void`, `POST documents/:id/revise` (new version), `POST documents/:id/credit-note`, `POST documents/:id/debit-note`, `POST documents/:id/start-project`, `GET documents/:id/pdf` |
| Payments | `GET payments`, `POST payments/manual`, `POST payments/:id/verify` (Owner), `POST payments/:id/refund` (Owner + step-up), `POST documents/:id/checkout` (staff-generated link), `GET review-items`, `POST review-items/:id/resolve`, `GET settlements` |
| Approvals | `GET approvals`, `POST approvals/:id/decide` |
| Reports | `GET reports/revenue`, `reports/ageing`, `reports/pipeline`, `reports/gst?fy&period`, `reports/registers`, `reports/edf?month`, `reports/realisation`, `reports/care-hours` (JSON; CSV/XLSX are built in the browser) |
| Audit | `GET audit?actor&entity&action&from&to` |
| DSR | `GET/POST dsr`, `PATCH dsr/:id` |

### 7.3 Portal API (summary)
`POST auth/magic`, `auth/magic/verify`, `auth/logout`; `GET me`; `GET home`; `GET documents?type=`; `GET documents/:id`; `GET documents/:id/pdf`; `POST documents/:id/accept`; `POST documents/:id/decline`; `POST documents/:id/checkout {provider, amount?}`; `POST documents/:id/bank-transfer-notice`; `GET projects`, `GET projects/:id`; `GET files/:id/download`; `POST requests` (contact change, data request). **Token routes:** `GET t/:token` (a single document) and `POST t/:token/checkout`.

### 7.4 Public endpoints (web)
- `POST /api/forms/quote`
- `POST /api/forms/contact`

Both run: Origin check → body ≤ 16 KB → rate limit → honeypot / minimum time → Turnstile siteverify → zod → `LEADS_QUEUE.send()` → `{ok:true, ref}`. A no-JS form POST redirects (303) to `/thanks?ref=…`.

`GET /api/geo` → `{country}` from `request.cf.country`, with `Cache-Control: private, max-age=86400`.

---

## 8. PDF pipeline

```text
admin: issue/send/accept ──▶ D1 batch (freeze snapshot) ──▶ PDF_QUEUE.send({documentId})
jobs consumer (max_batch_size 1, max_concurrency 1):
  1. load snapshot JSON from R2 (frozen) + settings snapshot embedded in it
  2. html = packages/pdf.render(type, snapshot)        // pure string templates, < 3 ms
  3. res = env.BROWSER.quickAction("pdf", { html, pdfOptions: { format: "a4",
           printBackground: true, displayHeaderFooter: true, footerTemplate, margin } })
     · on 429 / quota: msg.retry({ delaySeconds: 15 → backoff }) ; after 5 tries → DLQ + alert
  4. bytes = await res.arrayBuffer(); sha = SHA-256(bytes)   // native digest, cheap
  5. R2.put(`docs/<type>/<fy>/<number>.pdf`, bytes, { sha256 })
  6. UPDATE documents SET pdf_r2_key, pdf_sha256 WHERE id = ? AND pdf_sha256 IS NULL
  7. enqueue EMAIL_QUEUE if this render was for a send
```

- **Fonts:** subset WOFF2 files (Latin + ₹) are base64-encoded **at build time** into a generated TS module (`packages/pdf/fonts.generated.ts`), so there's no runtime encoding. A ₹ glyph check runs in CI.
- **Templates:** `DocumentLayout` + a body per type ([06 §7](06-design-system.md)); all numbers pre-computed by `core`.
- **Visual regression:** CI renders the fixtures with local Playwright Chromium (not Browser Run) and diffs against the approved PNGs.
- **Quota:** the expected render time is 1–3 s per document. 10 min/day therefore allows roughly 200–600 renders/day; we expect fewer than 20. Usage (`X-Browser-Ms-Used`) is logged in `stats_daily` and alerts at 50 %.
- **Fallback:** receipts can be produced with `@cantoo/pdf-lib` (pre-subset TTF) if Browser Run is exhausted; other documents wait in the queue.
- **Accepted proposals:** an "acceptance certificate" page (name, email, timestamp IST/UTC, IP, user agent, the SHA-256 of the accepted PDF) is rendered as a separate PDF and linked from the acceptance record (evidence pack, [08-B §15](08-research-appendix/B-dpdp-legal.md)).

---

## 9. Payment flows

### 9.1 Online payment (Razorpay shown; Stripe and PayPal are equivalent)

```text
Client (portal or token page)        portal Worker                     Razorpay               jobs Worker
1. Pay ₹X (≤ balance) ───────────▶  check balance, min partial
                                     create checkout_sessions row
                                     POST /v1/payment_links ────────▶  {id, short_url}
                                     ◀──────────────────────────────
   ◀── redirect to short_url
2. pays on Razorpay hosted page ─────────────────────────────────▶
3. returns to portal /pay/return ── shows "Processing…"; polls GET status (from D1 only)
                                                                      webhook payment_link.paid
                                                                      ─────────────────────▶ verify HMAC(raw body)
                                                                                              insert webhook_events
                                                                                              (unique event id)
                                                                                              → EVENTS_QUEUE
                                                                                   consumer: fetchStatus() server-side
                                                                                   (double check amount + reference)
                                                                                   D1 batch: insert payment (confirmed),
                                                                                   update ledger columns, audit
                                                                                   → if proforma: issue Tax Invoice (numbered)
                                                                                   → receipt document → PDF_QUEUE
                                                                                   → EMAIL_QUEUE (receipt + thanks)
```

| Provider | Create | Confirm | Notes |
|---|---|---|---|
| Razorpay (INR) | Payment Link (`accept_partial`, `first_min_partial_amount`, `expire_by` = +7 days, `reference_id` = document ID, `callback_method: get`) | Webhook `payment_link.paid` / `payment.captured` + `GET /payments/:id` | Plain `fetch` + Basic auth. HMAC-SHA256 hex on the raw body; dedupe on `x-razorpay-event-id`; accept the old secret during rotation |
| Stripe (USD) | Checkout Session (`mode: payment`, metadata = document ID, `client_reference_id`) | Webhook `checkout.session.completed` (+ `payment_intent.succeeded`) | `constructEventAsync` with the SubtleCrypto provider on the raw body, 300 s tolerance. **No FIRA from Stripe**: the FIRC comes from your bank, and staff attach it (ADM-INV-17) |
| PayPal (USD) | Orders v2 `create` → approve → **server capture** on return | Capture response (server-to-server) + webhook `PAYMENT.CAPTURE.COMPLETED` | OAuth token cached per isolate. Webhook verified via the verify-signature **postback** (self-verification later). Weekly PayPal e-FIRAs are downloaded and archived (PayPal keeps them only 12 months) |
| Manual | Staff/Owner form | Owner verification (Staff entries are `pending_verification`) | Proof file in R2 |

**Rules:**
- **Nothing is marked paid on a browser redirect.**
- Amounts are compared to the expected session amount; any mismatch goes to "Needs review".
- Overpayments → `client_credits`.
- Refunds (Owner only): provider refund API → `payments(kind=refund)` → a credit-note draft for the Owner to issue.
- `PAYMENTS_LIVE_ALLOWED=false` forces test keys/modes in every environment until the Phase 7 approval.

### 9.2 Ledger maths (`core/ledger`, property-tested)
- `balance = total − Σ confirmed payments + Σ refunds − Σ issued credit notes + Σ issued debit notes − Σ TDS adjustments`
- Status is derived: `issued` (balance = total) → `partially_paid` → `paid` (balance = 0); `overdue` = balance > 0 and today > due_date (IST).
- `paid_minor`, `credited_minor` and `balance_minor` on `documents` are recomputed inside every ledger batch (never incrementally patched from the client).

---

## 10. Tax engine (`core/tax`)

Pure and deterministic. Inputs: lines, supplier state, recipient (GST status, state, country), settings (rates, rounding, export mode). Outputs: line taxes, totals, round-off, amount in words, the `supply_type`. **Defaults come from [08-A](08-research-appendix/A-gst-invoicing.md); every one is a setting (VERIFY WITH CA).**

```text
supply_type =
  recipient.country != IN                         → export_lut | export_igst (per settings + LUT ARN present)
  recipient.state_code == 19 (WB)                 → intra  (CGST rate/2 + SGST rate/2)
  else                                            → inter  (IGST rate)
  unregistered with no state                      → intra (WB)  [08-A §7]

per line:  taxable = qty × rate − discount           (integer maths; qty in milli-units → round half-up to paise)
           cgst = round_half_up(taxable × rate_bp/2 / 10000), sgst = same  (computed separately)
           igst = round_half_up(taxable × rate_bp / 10000)
document:  tax totals = Σ line taxes;  grand = taxable + taxes
           INR: round_off = nearest ₹1 (±50 paise) shown as a line;  USD: no round-off
```

- Document discounts are allocated across lines proportionally (largest-remainder method), so the line taxable values sum exactly.
- Payment schedules: instalments = round(total × pct); the remainder goes to the last instalment (exact sum).
- Amount in words: Indian system for INR ("Rupees One Lakh Twenty-Three Thousand … and Paise Fifty Only"); international for USD.
- Golden test table: ≥ 40 cases ([04 ADM-INV-05](04-prd.md)) plus property tests (sum invariants, no negatives, idempotence).

---

## 11. Email and background jobs

### 11.1 Email (`packages/email`)
- **Send:** an `EMAIL_QUEUE` message `{template, to, data, entity}` → the consumer renders HTML + text (string templates, tokens inlined at build) → SESv2 `SendEmail` (aws4fetch SigV4, ≈ 0.25 ms CPU) with configuration set `techaust-transactional` → `email_log`.
- **Senders:** `hello@` (leads, proposals), `billing@` (invoices, reminders, receipts), `no-reply@` (magic links, security). Reply-To goes to the matching Zoho mailbox.
- **Events:** SES configuration set → **EventBridge → API destination** `https://hooks.techaust.com/ses` with a secret header (`SES_EVENTS_TOKEN`, constant-time compare) → updates `email_log`. Hard bounces/complaints → `email_suppressions` + the contact is flagged. The SES account-level suppression list is enabled too.
- **DNS** (with your approval, at the time): Easy DKIM CNAMEs, a custom MAIL FROM `mail.techaust.com` (MX + SPF), DMARC staying `p=none` while monitoring, then `quarantine`. **SES production access** is requested by you in the AWS console.
- **IAM:** a dedicated IAM user restricted to `ses:SendEmail` on the `techaust.com` identity and the configuration set (Workers can't use OIDC roles). Keys go in Wrangler secrets, rotated every 90 days ([08](08-security-compliance.md)).
- **Marketing** (digest, newsletters later) uses a separate configuration set with `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058), and only goes to contacts with marketing consent.

### 11.2 Queues

| Queue | Producer → consumer | Batch / concurrency | Retries → DLQ |
|---|---|---|---|
| `leads` | web → jobs (create lead, alert + acknowledgement emails) | 5 / 1 | 5 → `leads-dlq` |
| `pdf` | admin, jobs → jobs | 1 / 1 | 5 (15 s backoff) → `pdf-dlq` |
| `email` | admin, portal, jobs → jobs | 5 / 2 | 5 → `email-dlq` |
| `events` | jobs (webhooks), admin → jobs (payment processing, issue-on-payment, receipts) | 1 / 1 | 5 → `events-dlq` |

Budget: about 3 operations per message, with 10k ops/day (≈ 3.3k messages). Expected volume is under 300/day. DLQ consumers write `review_items` and notify the Owner.

### 11.3 Scheduled work (dispatcher pattern)
- `*/15 * * * *`: due reminders (09:00–19:00 IST only); care-plan billing at the 06:00 IST tick; the Monday 09:00 digest. Each enqueues one message per unit.
- `0 22 * * *` UTC (03:30 IST):
  - mark overdue invoices; expire proposals and estimates
  - check realisation thresholds (9 months / 12 months + 15 days)
  - remind about unbilled delivered milestones (day 25)
  - EDF reminder on the 5th of each month; LUT reminder from 1 March
  - retention clean-up (leads, sessions, tokens, access logs over 13 months), respecting legal holds
  - refresh `stats_daily`; D1 usage check

---

## 12. Environments and deployment pipeline

### 12.1 Environments

| | Local | Staging | Production |
|---|---|---|---|
| URLs | `localhost` ports (web 4321, admin 5173, portal 5174, jobs 8787) | `https://techaust-platform-{web,admin,portal,jobs}-staging.techaust-technologies-153.workers.dev` (live since 2026-10-06) | `techaust.com`, `admin.`, `portal.`, `hooks.techaust.com` (Workers Custom Domains, **added only in Phase 7 with your approval**) |
| Access control | — | **Cloudflare Access** (your email) on web/admin/portal staging (**to be added before any real data, M1.4**; until then the staging Workers are noindex placeholders with no data); the `jobs` staging Worker has an Access **bypass** for webhook paths (they are signature-verified) | Public site open; admin optionally behind Access (ADM-AUTH-10) |
| Data | Local D1/R2, seed fixtures | `techaust-staging` D1 + `techaust-staging-*` R2 buckets (anonymised seed) | `techaust-prod` D1 + `techaust-prod-*` R2 |
| Payments | Test keys | Test/sandbox keys | **Test keys until the Phase 7 go-live approval** (`PAYMENTS_LIVE_ALLOWED=false`) |
| Email | Logged to the console (no send) | SES sandbox → verified test inboxes only | SES production (after the AWS production-access request) |
| Turnstile | Test keys | Real widget (staging hostnames) | Real widget |
| Robots | — | `X-Robots-Tag: noindex` on everything | Normal |

### 12.2 Git workflow
- Trunk-based: short-lived branches → PR → `main`. Conventional commits. Version tags `vYYYY.MM.DD-N` for production releases.
- **Branch protection on `main` is ON** (enabled 2026-10-06; free because the repo is public): PR required (0 approvals), the CI `checks` job must pass and be up to date, linear history (squash-merge), conversation resolution, no force-push or deletion, and the rules apply to admins too.
- If the repo is made **private** again on GitHub Free, branch protection stops being enforced and Actions minutes count against the account (which then had a billing block). Revisit both at that point.

### 12.3 GitHub Actions workflows

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | Every PR + push to `main` | **Today:** full-history checkout → gitleaks 8.30.1 (git history) → `pnpm install --frozen-lockfile` → Biome → typecheck (`wrangler types` + tsc / `astro check`) → public-Worker binding guard → tests (Vitest + workerd, D1 migrations applied) → migrations match the Drizzle schema (drift check) → build all apps (web and jobs also dry-run their Workers). **Added in later milestones:** web checks: link checker, SEO/schema test, content lint (banned phrases, prices from snapshot, GSTIN absent), bundle-size budget → Playwright E2E against `wrangler dev` builds + axe → Lighthouse CI (web templates) → PDF visual regression → dependency audit |
| `deploy-staging.yml` | `workflow_run` after CI succeeds, **only for push events on this repository's `main`** (never fork PRs) | **Today:** skips cleanly if the secrets are missing → migrate staging D1 (`wrangler d1 migrations apply`) → seed (insert-only) → `pnpm -r --workspace-concurrency=1 run deploy:staging` (4 Workers). **Added later:** fetch the published catalogue snapshot (build token) → smoke tests (health, login page, form submit with the Turnstile test key) |
| `deploy-prod.yml` | **`workflow_dispatch` only**. Inputs: `tag` and `confirm` (must equal `deploy techaust.com <tag>`) | Guards: actor = `techaust`, repo variable **`PRODUCTION_ENABLED == 'true'`** (unset until Phase 7), typed confirmation. **Today the deploy job is a placeholder.** Phase 7 adds: and the ref is a tag on `main` that passed staging → build → D1 export (pre-deploy backup) → migrations `--remote` on prod → deploy 4 Workers `--env production` using **`CF_API_TOKEN_PROD`** (scoped to prod Workers/D1/R2 only) → smoke tests → summary. **Rollback:** `wrangler rollback` per Worker (documented in [08 §6](08-security-compliance.md)) |
| `backup.yml` | Nightly 21:30 UTC (03:00 IST) + manual (**schedule commented out until Phase 7**) | `wrangler d1 export techaust-prod --remote` → `age -r <owner public key>` → AWS OIDC role (`s3:PutObject` on the backup prefix only) → upload to S3 Mumbai (versioning + Object Lock) → verify the object exists and the size is > 0 → Sentry cron check-in |
| `restore-drill.yml` | Manual (quarterly) | Download the latest backup → *(the owner decrypts locally; CI never holds the private key)* → documented steps in [08 §6](08-security-compliance.md) |

**Tokens:** `CF_API_TOKEN_STAGING` (**exists**: account-level Workers Scripts/D1/Queues edit + Account Settings read, no zone/DNS permissions) and `CLOUDFLARE_ACCOUNT_ID` (exists); `CF_API_TOKEN_PROD` (Phase 7; used solely by `deploy-prod.yml`); `CF_API_TOKEN_BACKUP` (Phase 7; D1 read/export only). Cloudflare can't scope a token to particular Workers, so the staging token could technically touch any Worker; the naming rule and approvals protect `techaust-web`. These are repo secrets, and **write access is limited to the Owner**; other collaborators work through PRs from forks or with Triage access ([05-A §14](05-research-appendix/A-stack-verification.md)).

### 12.4 Release and rollback
1. Merge to `main` → staging auto-deploys.
2. Test on staging.
3. You run `deploy-prod.yml` with the tag and the confirmation text.
4. If something is wrong: `wrangler rollback` per Worker. Migrations are always backward-compatible, so code rollback is safe. Data issues are handled with D1 Time Travel (7 days) or the S3 backup.

---

## 13. Observability
- **Logs:** structured JSON (`request_id`, realm, route, status, `cpu_ms`, `rows_read`, `rows_written`), with no bodies on auth/payment routes and no personal data. Info logs are sampled at 20 %; errors always. Workers Logs keep 7 days (0.5 GB/day cap from 2026-12-01).
- **Security log:** `access_log` in D1 (13 months).
- **Errors:** Sentry (errors only, `sendDefaultPii: false`, a `beforeSend` scrubber). One free seat (Owner); alerts are emailed.
- **Uptime:** Sentry's free uptime monitor on `techaust.com`, plus one more free monitor (UptimeRobot or Better Stack; check the terms in Phase 7) on `admin.`/`portal.`/`hooks.` `/healthz` (no D1 query).
- **Budgets:** a daily job records Workers requests, D1 rows read/written and Browser Run ms in `stats_daily`. A dashboard tile shows usage against the free limits, with email alerts at 50 % and 80 %.

---

## 14. Architecture decision records (`docs/adr/`, written in Phase 5)

| ADR | Decision |
|---|---|
| 0001 | All-Cloudflare Free plan; upgrade only via the triggers in §1.2 |
| 0002 | Static Astro site + a hand-written `/api` Worker (no adapter); no DB on the public Worker |
| 0003 | React SPA (RR8 data mode) + Hono per realm; no SSR |
| 0004 | In-house auth (browser Argon2id + HMAC pepper, TOTP, magic links) instead of Better Auth |
| 0005 | D1 + Drizzle 0.45; money as integers; triggers for immutability; numbering via a batch transaction |
| 0006 | Browser Run Quick Action for PDFs; render once; pdf-lib fallback |
| 0007 | SES via aws4fetch; events via EventBridge API destination |
| 0008 | Payment provider interface; webhooks verified on the raw body; nothing is paid on a redirect |
| 0009 | Owner-only manual production workflow (actor guard + typed confirmation + `PRODUCTION_ENABLED`) |
| 0010 | Tax/legal rules as settings with researched defaults (VERIFY WITH CA/LEGAL) |
| 0011 | New Worker names (`techaust-platform-*`) never collide with the live `techaust-web` |
| 0012 | Public repository: branch protection on `main`, fork-safe workflows, nothing sensitive committed |
| 0013 | New brand identity "Patina" replaces the supplied logo; the brand is generated from code |
