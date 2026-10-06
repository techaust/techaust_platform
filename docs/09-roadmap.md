# 09: Roadmap (Phases 5–7, build order and milestones)

| | |
|---|---|
| **Phase** | 4, Project documentation (**APPROVED** 2026-10-06) |
| **Date** | 2026-10-06 |
| **Builds** | [04 PRD](04-prd.md) per [05 Architecture](05-architecture.md), [06 Design system](06-design-system.md), [07 Content](07-content.md), [08 Security & compliance](08-security-compliance.md) |

## How milestones work
- Each milestone is **small and demonstrable**. For each one I:
  1. explain what I'm about to build
  2. build it, with tests for the critical logic
  3. run it locally and verify: build, tests, no console errors, responsive (375/768/1280/1920), axe clean, free-plan CPU budget
  4. commit (conventional commits)
  5. show you the result: screenshots/preview, a test summary, open questions
  6. **wait for your "approved"**
- **Size:** S ≈ 1–2 working sessions · M ≈ 3–5 · L ≈ 6+. These are relative effort, not calendar promises.
- **Gates (🚦)** are points where I stop and ask if the result doesn't fit the plan, e.g. the free-plan CPU measurement.
- **Owner inputs (🟧)** are listed per milestone so nothing blocks unexpectedly.
- **Production stays untouched** until Phase 7. Every Phase 6 deploy goes to **staging** automatically on merge to `main` (workers.dev; Cloudflare Access added before any real data, at M1.4).
- **Delivery flow:** branch → PR → CI green → squash-merge → staging deploy (`main` is protected).

---

## Phase 5: Setup and tooling ✅ approved 2026-10-06

| # | Step | Output | Approval needed / status |
|---|---|---|---|
| P5.1 | **Recommend skills, plugins and MCP servers** (what each does, why we need it) | A short list in `docs/10-tooling.md` | ✅ **Done**: T1–T12 approved |
| P5.2 | Scaffold the pnpm monorepo per [05 §3](05-architecture.md); `CLAUDE.md` refresh; ADRs 0001–0010 | Repo skeleton builds, lints, tests (empty) | ✅ **Done**: ADRs 0001–0012 |
| P5.3 | `git init`, `.gitignore` (`.dev.vars`, `.env*`, `node_modules`, `dist`, `brand-incoming/` originals stay git-ignored), gitleaks in CI | Local repo | ✅ **Done** (originals stay git-ignored in `brand-incoming/` until M1.1) |
| P5.4 | Connect to `techaust/techaust_platform` and **push the first commit** | Remote `main` | ✅ **Done**: approved and pushed; the owner then made the repo **public** |
| P5.5 | GitHub settings: branch protection on `main`, Renovate app, repo secrets list | Settings | ✅ **Done**: branch protection ON (PR + CI); Renovate app **not installed yet** (needs your approval) |
| P5.6 | Cloudflare **staging** resources: D1 `techaust-staging`, R2 buckets, 4 queues + DLQs, Turnstile widget, Access application on workers.dev | Staging infrastructure (no DNS changes) | ✅ **Done**: D1 + 8 queues. R2, Turnstile and Access deferred to M3.4 / M2.4 / M1.4 ([runbook](runbooks/environments.md)) |
| P5.7 | Scoped API tokens (`CF_API_TOKEN_STAGING` now; prod and backup tokens in Phase 7). **You create them** using my exact permission list and paste them into GitHub secrets. | Tokens in GitHub | ✅ **Done** by you: `CF_API_TOKEN_STAGING` + `CLOUDFLARE_ACCOUNT_ID` |
| P5.8 | CI workflows: `ci.yml` (all checks), `deploy-staging.yml` (auto on `main`), `deploy-prod.yml` (owner-only dispatch with a typed confirmation; **not run until Phase 7**), `backup.yml` (disabled until Phase 7) | Green CI on a PR; staging deploy of the "hello" Workers | ✅ **Done**: CI green; PR #1 merged; 4 staging Workers live and healthy |

🚦 **STOP:** Phase 5 summary → wait for "approved".

---

## Phase 6: Build

### M1 Foundation

| # | Milestone | Scope (PRD IDs) | Critical tests | Size | Owner inputs |
|---|---|---|---|---|---|
| M1.1 | **Design tokens and brand** | `packages/ui/tokens` → CSS/Tailwind/email/print; contrast test ([06 §2.3](06-design-system.md)); self-hosted fonts + **₹ glyph check**. **New identity "Patina"** (owner request: a new logo replaces the supplied one; [ADR 0013](adr/0013-new-brand-identity.md)): master generated from code, every lockup and colour version, pixel-fitted favicons, social, email, print PDFs (CMYK via ICC), brand audit ([11](11-brand-audit.md)) | Contrast pairs; font glyph coverage; token/brand drift; geometry, pixel-fit and print-colour tests | M | ✅ **Done and approved** 2026-10-06 ([PR #3](https://github.com/techaust/techaust_platform/pull/3)) · open owner actions: trademark search (VERIFY WITH LEGAL), print proof, card phone number |
| M1.2 | **Core library** | `packages/core`: money (minor units, en-IN/en-US formatting, parsing), FY/IST dates, GSTIN validator + state codes, amount in words (Indian + international), numbering formatter (≤ 16 chars), permissions matrix, shared zod schemas (forms) | Property tests (money round-trip, no floats); FY boundary; GSTIN checksum vectors; words for 0 → 99,99,99,999 | M | ✅ **Built** 2026-10-06: 245 tests, coverage 100 % lines / 98 % branches. Owner decisions: amount-in-words style ("Rupees … and … Paise Only", "US Dollars … and … Cents Only"), negatives with a minus sign (−₹1,000.00), fast-check + coverage-v8 approved · awaiting the owner's "approved" |
| M1.3 | **Database** | Drizzle schema for identity, settings, CRM and documents ([05 §5](05-architecture.md)); hand-written triggers (frozen documents, append-only audit); seed (catalogue S1–S18, settings defaults from [08 §7.1](08-security-compliance.md)) | Migrations apply clean; trigger tests (update a frozen doc → abort; delete from audit → abort); seed idempotent | M | — |
| M1.4 | 🚦 **Auth CPU spike (gate)** | First: **Cloudflare Access on the staging URLs** (your dashboard checklist). Then a minimal admin Worker on **staging**: salt → login (HMAC) → TOTP → session; browser Argon2id in a Web Worker. **Measure** CPU p50/p99 per route from Workers Logs (100+ runs incl. cold isolates), and Argon2id time on a mid-range Android phone | CPU report in `docs/runbooks/cpu-baseline.md` | S | 🟧 Optional: time a login on your phone |
| | | **Gate:** login p99 ≤ 5 ms CPU and every route ≤ 7 ms. **If it doesn't fit, I stop and ask** (options: tune, Cloudflare Access + simpler auth, or the $5 plan). | | | |
| M1.5 | **Staff auth (complete)** | ADM-AUTH-01…09: invites, TOTP enrolment, recovery codes, sessions list, step-up, lockout, login alerts (email stubbed until M2.4), RBAC middleware + route-coverage test, audit-log writer, access log | Auth integration suite (enumeration, replay, lockout, expiry, rotation, step-up); permission tests per role | M | — |
| M1.6 | **Portal auth** | POR-01…03: magic links (fragment + POST), client sessions, organisation scoping helper, single-document tokens | Cross-tenant tests; token single-use/expiry | S | — |

🚦 **M1 review:** design tokens and logo, a CPU report, the auth demo on staging → "approved".

### M2 Public website

| # | Milestone | Scope | Critical tests | Size | Owner inputs |
|---|---|---|---|---|---|
| M2.1 | **Site shell** | Astro 7 static setup; header/nav (disclosure menus), footer, theme toggle (no flash), currency toggle + `/api/geo`, cookie banner (GA4 only after consent), `_headers` security headers, 404 | E2E: keyboard nav, no GA before consent, theme persistence, currency CLS; header test on static assets | M | 🟧 GA4 measurement ID (or skip GA4 at launch) |
| M2.2 | **Home + services** | Home, services hub, the service template + 14 live service pages (S3 flagged off), prices from the catalogue snapshot (seed fallback) | Content lint (banned phrases, no price literals, no GSTIN); FAQ JSON-LD = visible text; one h1 | L | 🟧 Claims-register confirmations ([07 §1.4](07-content.md)) |
| M2.3 | **Other pages** | Industries (hub + 3), pricing, how we work, how we build AI, about (headshot placeholder blocked from prod), work (+ "coming soon"), blog (3 drafted posts), legal pages (privacy, terms, refund, delivery, cookies), security + security.txt | Link checker; legal page versioning; RSS valid | L | 🟧 Headshot + bio, LinkedIn URLs, WhatsApp number, postal address, Cal.com URL, case-study briefs; review of the 3 blog drafts |
| M2.4 | **Forms → leads → email** | FRM-01…07: shared schemas, Turnstile, rate limit, Origin/body guards, `leads` queue → jobs consumer → `leads` table; `packages/email` + SES client; lead acknowledgement + internal alert (staging: SES sandbox to verified inboxes) | Abuse tests (oversize, foreign Origin, CRLF, honeypot, rate limit); E2E submit → lead row → emails logged; DLQ path | M | 🟧 AWS: create the SES identity in ap-south-1 + IAM user (I give exact steps); **DNS DKIM records need your approval**; verify test inboxes |
| M2.5 | **SEO, performance, a11y pass** | Structured data, sitemap (stable lastmod), robots, llms.txt, OG images, Lighthouse CI ≥ 95/100/100/100, JS budget ≤ 50 KB, manual keyboard + NVDA pass | Lighthouse CI thresholds; schema validator; axe 0 serious | M | — |

🚦 **M2 review:** the full site on staging (behind Access) → "approved".

### M3 Admin: leads, clients, projects, time

| # | Milestone | Scope | Critical tests | Size |
|---|---|---|---|---|
| M3.1 | **Admin shell, users and settings** | ADM-G-01…09, ADM-SET-01…10 (bank details entered by you), users | Settings validation (GSTIN, numbering ≤ 16 chars), step-up on sensitive settings, masked bank numbers, audit before/after | M |
| M3.2 | **Leads** | ADM-LEAD-01…06: list/kanban (with keyboard "Move to…"), timeline, convert → client + draft proposal shell, retention scheduling | Conversion atomicity; stage automation; retention dry-run | M |
| M3.3 | **Clients and contacts** | ADM-CLI-01…05: tabs, contacts (portal access, can-see-finance), statement (stub until M5), data-subject export/erase with legal hold | Sales can't see finance (API); erase blocked on issued docs; currency lock | M |
| M3.4 | **Projects, milestones, notes, files** | ADM-PRJ-01…05: R2 uploads (magic-byte allow-list, signed downloads) | File-type spoofing tests; shared vs internal notes | M |
| M3.5 | **Care plans, time logs, dashboard v1** | ADM-CARE-01, -03, ADM-TIME-01…03, ADM-DASH-01 (CRM tiles), `stats_daily` | Overage maths; 24 h/day validation; lock after 7 days | M |

🟧 Inputs: company profile, GSTIN, legal name and bank details typed into Settings by you (staging uses dummy values until then).
🚦 **M3 review** → "approved".

### M4 Catalogue, proposals, estimates and the PDF engine

| # | Milestone | Scope | Critical tests | Size |
|---|---|---|---|---|
| M4.1 | **Catalogue and publish to website** | ADM-CAT-01…05: editor, price history, templates per category, **site snapshot** → CI build uses it (WEB-G-07) | Snapshot schema (no internal fields); price change → staging site shows the new price | M |
| M4.2 | **Tax engine** | `core/tax`: supply type, per-line CGST/SGST/IGST, document discount allocation, round-off, schedules (exact sums), amount in words | **≥ 40 golden cases** + property tests; 100 % branch coverage | M |
| M4.3 | **Proposals and estimates** | ADM-PROP-01…10, ADM-EST-01…02: editor (line items, sections, schedule), the 10 % discount guard → approvals (ADM-APR), versioning and freezing | Versioning immutability; discount-guard API tests; approval invalidated by edits | L |
| M4.4 | **PDF engine** | `packages/pdf` layouts ([06 §7](06-design-system.md)), fonts as build-time data URIs, the `pdf` queue + Browser Run Quick Action, R2 storage + SHA-256, the pdf-lib receipt fallback | Fixture renders (short/long/USD/intra/inter/long names); visual regression; grayscale proof; ₹ renders; pacing on 429 | L |
| M4.5 | **Send and accept** | Proposal emails; **minimal portal**: view latest version, click-to-accept with the evidence pack + acceptance certificate PDF; start project (ADM-PROP-09) | E2E: send → portal view (Viewed status) → accept → locked → project + first instalment draft | M |

🟧 Inputs: review the proposal template wording, the terms block and the warranty length.
🚦 **M4 review** → "approved".

### M5 Invoices (GST engine, numbering, credit/debit notes)

| # | Milestone | Scope | Critical tests | Size |
|---|---|---|---|---|
| M5.1 | **Issue pipeline and numbering** | ADM-INV-01…04, -07: draft → issue (Owner + step-up) in one D1 batch, gap-free numbers per series/FY, void (keeps the number), immutability | **20 concurrent issues → 20 consecutive numbers**; FY rollover; void reporting; frozen-update abort | M |
| M5.2 | **Document types and templates** | Tax invoice, export invoice (LUT guard ADM-INV-18, endorsement text, INR value + FX), proforma → auto tax invoice on payment (ADM-INV-10), mandatory-field checklist (ADM-INV-06), USD FX capture (ADM-INV-08) | A missing-field block per field; LUT-without-ARN blocked; export wording exact; proforma conversion | L |
| M5.3 | **Credit and debit notes** | ADM-INV-11 (+ the 30-Nov hard block, IMS status), debit notes | Can't exceed the creditable amount; deadline guard with a fake clock | M |
| M5.4 | **Recurring invoices and reminders** | ADM-CARE-02, ADM-INV-12, -13, -19: billing-day job (draft or auto-issue), reminders (−3/0/+3/+7/+14 in the 09:00–19:00 IST window), unbilled-milestone alert | Fake-clock job tests: idempotence, month-end, FY boundary, stops after payment | M |
| M5.5 | **GST and CA exports, realisation and EDF** | ADM-REP-04 (sales register, GSTR-1 Offline-Tool CSV/XLSX built in the browser), ADM-INV-17 realisation tracker, ADM-REP-07 EDF report, statement of account (ADM-CLI-04) | Export totals = invoice totals; column-layout snapshots; 9-month / 12-month + 15-day alerts | M |

🟧 Inputs: LUT ARN for FY 2026-27 ([08 U-1](08-security-compliance.md)); your view on the tax defaults (and an optional CA review).
🚦 **M5 review** → "approved".

### M6 Payments (sandbox/test only)

| # | Milestone | Scope | Critical tests | Size |
|---|---|---|---|---|
| M6.1 | **Ledger and manual payments** | ADM-PAY-01, -05, -06: provider interface, ledger maths, manual entry, Staff → pending verification → Owner confirms, overpayment credits, TDS line (ADM-INV-16) | Ledger property tests; verification workflow per role | M |
| M6.2 | **Razorpay (test mode)** | Payment Links (partial, minimum, expiry), webhook (HMAC raw body, idempotency, status re-fetch), proforma → tax invoice on payment | Recorded-payload tests; duplicate delivery; amount mismatch → review | M |
| M6.3 | **Stripe (test mode)** | Checkout Session + webhook (`constructEventAsync`), FIRC attachment flow | As above + timestamp tolerance | S |
| M6.4 | **PayPal (sandbox)** | Orders v2 + server capture + webhook postback verification; FIRA archive upload | As above | M |
| M6.5 | **Receipts, refunds, reconciliation** | ADM-PAY-08…13: receipts (`TH/RCT`), Owner refunds (gateway API) + credit-note draft, Razorpay settlements matching, the ₹25 lakh warning, `PAYMENTS_LIVE_ALLOWED` guard | Refund ≤ paid; receipt idempotent; live-mode blocked while the flag is false | M |

🟧 Inputs: **you** set the gateway test keys as Wrangler secrets (I give the exact commands); create webhook endpoints in each gateway dashboard pointing to the staging hooks URL (I give the URLs and event lists).
🚦 **M6 review:** an end-to-end sandbox payment demo for each method → "approved".

### M7 Portal, notifications, reports and hardening

| # | Milestone | Scope | Critical tests | Size |
|---|---|---|---|---|
| M7.1 | **Full client portal** | POR-04…11: home, documents, pay (all methods), receipts, projects, shared files and notes, profile, data requests, "View & pay" token page | Cross-tenant suite on every route; can-see-finance rule; E2E payment from the portal (sandbox) | L |
| M7.2 | **Notifications and digest** | ADM-G-09, ADM-DASH-02, ADM-MAIL-01…03 (all templates), SES bounce/complaint events via EventBridge → hooks | Template snapshots (HTML + text); bounce → suppression | M |
| M7.3 | **Reports** | ADM-REP-01…03, -05, -06; dashboard v2 | Report figures = ledger (fixtures); Accountant read-only | M |
| M7.4 | **Data protection tooling** | DSR workflow (30-day clock), retention jobs (dry-run report first), consent receipts, legal holds | Retention never touches held or financial records | M |
| M7.5 | **Hardening** | Security review (OWASP ASVS L2 checklist, [08 §3](08-security-compliance.md)), CSP tightening, free-plan budget audit (CPU p99 per route, D1 reads/day, queue ops, Browser Run ms), incident and restore runbooks, a load sanity test, a dependency audit | No high/critical findings open; every route p99 ≤ 7 ms CPU | M |

🚦 **M7 review** → "approved" → Phase 7.

---

## Phase 7: Launch (each step separately approved by you)

| # | Step | Detail | Approval |
|---|---|---|---|
| L1 | **Staging full test pass** | A scripted checklist: every PRD "M" item; E2E payments for Razorpay/Stripe/PayPal (sandbox) + bank transfer; PDFs for every document type; emails; portal; a11y and Lighthouse; restore drill #1 on a staging backup | Review the report |
| L2 | **Owner inputs complete** | All 🟧 items ([04 §12](04-prd.md), [07 §9](07-content.md)); legal page text approved; tax defaults decided (optional CA/lawyer review) | ✅ |
| L3 | **Production resources** | Prod D1/R2/queues; `CF_API_TOKEN_PROD` and `CF_API_TOKEN_BACKUP` (you create them); prod secrets (you set them); AWS backup bucket + OIDC role (I give the exact policy) | ✅ each |
| L4 | **First production deploy (no public traffic)** | `deploy-prod.yml` (you run it) → Workers live on their workers.dev names only | ✅ |
| L5 | **Subdomains** | Attach `admin.`, `portal.` and `hooks.techaust.com` as Workers Custom Domains (DNS records, which don't affect the current site) | ✅ each DNS change |
| L6 | **Email DNS** | SES DKIM CNAMEs, MAIL FROM `mail.techaust.com`, keep DMARC `p=none` (monitoring) | ✅ each record |
| L7 | **Backups and monitoring on** | Enable `backup.yml`; first backup + **restore drill on the production backup**; Sentry, uptime monitors, budget alerts | ✅ |
| L8 | **Apex cut-over** | Move `techaust.com` (+ `www` redirect) from the old `techaust-web` Worker to the new `web` Worker. **The old Worker stays deployed as the rollback.** Post-cut-over checks: pages, forms, redirects, Search Console sitemap | ✅ **Explicit go-ahead at the time** |
| L9 | **Payments live** | Apply for and receive live keys (Razorpay needs the legal pages live), you set the live secrets, set `PAYMENTS_LIVE_ALLOWED=true`, a ₹1 live test transaction + refund | ✅ **Explicit go-live approval** |
| L10 | **Post-launch hardening** | Cloudflare minimum TLS 1.2, a WAF rate-limit rule, CAA records; DMARC → `quarantine` after 2–4 weeks of clean reports; HSTS review | ✅ each change |
| L11 | **Two-week watch** | Daily budget and error review; a fix-forward window; then a handover summary | — |

---

## Dependency view (critical path)

```text
P5 ─▶ M1.1 ─▶ M1.2 ─▶ M1.3 ─▶ M1.4 🚦 ─▶ M1.5 ─▶ M1.6
                                   │
            M2.1 ─▶ M2.2 ─▶ M2.3 ──┼─▶ M2.4 (needs M1.3 leads table + SES) ─▶ M2.5
                                   ▼
                     M3.1 ─▶ M3.2 ─▶ M3.3 ─▶ M3.4 ─▶ M3.5
                                   ▼
                     M4.1 ─▶ M4.2 ─▶ M4.3 ─▶ M4.4 ─▶ M4.5 (needs M1.6)
                                   ▼
                     M5.1 ─▶ M5.2 ─▶ M5.3 ─▶ M5.4 ─▶ M5.5
                                   ▼
                     M6.1 ─▶ M6.2 ─▶ M6.3 ─▶ M6.4 ─▶ M6.5
                                   ▼
                     M7.1 ─▶ M7.2 ─▶ M7.3 ─▶ M7.4 ─▶ M7.5 ─▶ Phase 7
```

The website (M2) can be reviewed and launched **before** the admin is finished, if you want an earlier cut-over. The lead form then writes to D1 and emails you, and leads are viewable from M3.2. This is an option to decide at the M2 review.
