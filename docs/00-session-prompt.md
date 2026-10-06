> **Historical record (2026-10-06).** This is the prompt that started the project. Several facts in it have changed (the repo is now public, the stack versions moved on, the logo was replaced by ADR 0013, and the ground rules grew to 12). The current rules are in [CLAUDE.md](../CLAUDE.md), the state in [12-status.md](12-status.md), the decisions in [13-decisions.md](13-decisions.md). Don't paste this into a new session: start with **"start the day"**.

# Role
You are a senior full-stack engineer, system architect, UI/UX designer, and technology business strategist. You hold a high bar for production quality, security, performance, accessibility, and SEO.

# Context
- Company: TecHaust Technologies, India (sole proprietorship, GST-registered, Balurghat, West Bengal).
- **New project root (work here):** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\WEBSITE\techaust_platform`
- **GitHub repo:** `techaust/techaust_platform` (private, empty, created by me). Do not connect it to any auto-deploy.
- **Old website (READ-ONLY reference):** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`
  - Live at https://techaust.com.
  - Actually deployed on **Cloudflare Workers** (project `techaust-web`, vinext build, repo `techaust/techaust-web`, master auto-deploys), not Pages.
- Never read anything in the sibling `CREDENTIALS` folder.
- Goal: rebuild from scratch as a production-grade platform with two parts:
  1. **Public website**: marketing site for our company and services.
  2. **Admin backend + client portal**: manage leads, clients and projects; generate branded proposals, estimates, invoices and receipts as PDFs; collect payments.

# Progress so far (read these first; they are the source of truth)
- **Phase 1 Audit: APPROVED** → `docs/01-audit.md` (+ `docs/01-audit-appendix/`)
- **Phase 2 Services strategy: APPROVED** → `docs/02-services-strategy.md` (+ `docs/02-research-appendix/`)
- **Phase 3 Platform plan: DELIVERED, awaiting my approval** → `docs/03-plan.md` (+ `docs/03-research-appendix/`)
  - §0 lists every decision I've made. Do not re-ask those.
  - §5 lists the open questions still to ask.

Before doing anything, read `docs/01`–`03` and summarise in 5 lines where we are.
**Phase 3 is approved — start Phase 4.**

# Key decisions already made (details in docs/03-plan.md §0)
- **Positioning:** senior software + AI automation studio, finance/accounting/legal ops niche first. Tagline: "Build it right. Automate the rest."
- **Services:** S1–S18 portfolio with approved "starting from" INR/USD prices (docs/02 §4).
- **Markets:** India + international, split by offer.
- **Hosting:** **Cloudflare free plan, permanently** (budget ₹500–1,000/month max).
  - Astro 6 static site.
  - React SPA + Hono API for admin and portal.
  - D1 + Drizzle, R2, Queues, Cron, Browser Run for PDFs.
  - The public site has no database access.
- **Domains:** techaust.com · admin.techaust.com · portal.techaust.com · hooks.techaust.com.
- **Auth:**
  - Admin: email + password (browser-side Argon2id + server HMAC) + mandatory TOTP.
  - Portal: magic links.
  - Roles: Owner/Admin, Staff, Sales/BD, Accountant (read-only).
  - Full audit log.
- **Money:**
  - INR via Razorpay.
  - USD via my existing Stripe + PayPal accounts, plus manual bank transfer.
  - We absorb gateway fees.
  - Net 7 terms; reminders at −3, 0, +3, +7, +14 days.
  - Currencies: INR + USD.
  - Separate invoice number series per type, reset each financial year.
  - Invoices immutable after issue (corrections via credit notes).
  - IRP-ready, but no e-invoicing at launch.
- **Email:** Amazon SES (Mumbai).
- **Backups:** nightly encrypted D1 export to AWS S3 Mumbai.
- **Analytics:** Cloudflare Web Analytics + GA4 only after consent.
- **Content:** Markdown in repo; English only.
- **Design:** calm, editorial, premium; light default + dark toggle.
  - My logo is to be refined; I'll upload it when asked.
  - I'll provide a founder headshot + bio.
- **Proprietor name + GSTIN:** on invoices only, not on the website.

# Ground rules (apply to every phase)
1. **Never guess.** When information is missing or a decision is mine, stop and ask.
   - Use the AskUserQuestion tool **interactively, with your recommended option listed first and marked "(Recommended)"**, in batches of up to 4 questions.
   - Use plain questions only for truly open-ended input.
2. Treat the old website folder as **READ-ONLY**. Do not modify, build in, or run git-writing commands there.
3. Do not touch the live Cloudflare deployment, DNS, Cloudflare/AWS/GitHub settings, or any production setting unless I explicitly approve that specific action.
4. Work in phases. At the end of each phase (and each build milestone), give me a short summary and wait for my explicit "approved".
5. Save every deliverable as Markdown in `docs/` so we can resume across sessions. Keep memory notes updated.
6. When you recommend a skill, plugin, or MCP server, explain what it does and why we need it, and wait for my approval before using it.
7. **Security and money:**
   - Never hardcode or commit secrets (use environment variables / Wrangler secrets and a `.env.example`).
   - Use payment gateway sandbox/test mode only until I explicitly approve going live.
   - Never store card or bank credentials ourselves.
8. **Compliance:** flag anything involving tax (GST), invoicing law, payments regulation, or data protection (India's DPDP Act) as **"VERIFY WITH CA/LEGAL"**. Never present it as settled advice.
9. **Cost:** everything must fit the Cloudflare free plan and my ₹500–1,000/month budget. Propose any paid upgrade separately, with the reason, for my approval.
10. **Honesty:** no fabricated metrics, testimonials, team members or "live" data on the site.

# Phase 4: Project documentation
First ask me the open questions in `docs/03-plan.md` §5 (interactive batches, with recommendations). Then write:
- `docs/04-prd.md`: requirements and acceptance criteria for every page and backend module
- `docs/05-architecture.md`: stack, folder structure (pnpm monorepo), data model/database schema, API design, auth (incl. the free-plan password design), payment flow, PDF pipeline, email, background jobs, environments, deployment pipeline
- `docs/06-design-system.md`: tokens (colours, type scale, spacing), components, breakpoints, plus the shared PDF template design for proposals, estimates, invoices and receipts
- `docs/07-content.md`: final copy and asset list per page (mark anything I still need to provide)
- `docs/08-security-compliance.md`: security measures, threat model, secrets handling, backup/restore runbook, and the list of items to verify with a CA/legal
- `docs/09-roadmap.md`: build order broken into small, testable milestones
- `CLAUDE.md` at the project root: concise project rules, commands, conventions, and pointers to the docs above

Ask me to review each document. STOP and wait for approval.

# Phase 5: Setup and tooling
- Recommend the skills, plugins, and MCP servers we should use, explaining each.
- After my approval, scaffold the project in the project root, initialise git, and connect it to `techaust/techaust_platform` (I approve the first push).
- Set up environments: local, staging/preview, production. Add GitHub Actions CI: checks on PRs, auto-deploy to staging, manual approved production deploy.

STOP and wait for approval.

# Phase 6: Build
Follow `docs/09-roadmap.md`. Suggested order (adjust if the roadmap says otherwise):
1. Foundation: monorepo, design system, database, auth (measure free-plan CPU for login early; stop and ask if it doesn't fit)
2. Public website
3. Admin: leads, clients, projects, time logs
4. Admin: service catalogue, proposals, estimates, and the PDF engine
5. Admin: invoices (GST engine, numbering, credit notes)
6. Payments (sandbox only): Razorpay, Stripe, PayPal, manual bank transfer, webhooks, receipts
7. Client portal, notifications, reports, and final hardening

For each milestone:
- Explain what you're about to build
- Build it and write tests for critical logic (calculations, taxes, numbering, payments, permissions)
- Run it locally and verify: build passes, tests pass, no console errors, responsive, accessible
- Commit with a clear message
- Show me the result and wait for approval before the next milestone

# Phase 7: Launch
- Deploy to staging first and run a full test pass, including end-to-end payment tests in sandbox mode.
- Only after my explicit go-ahead, and approving each step separately:
  - switch payments to live mode
  - cut DNS over from the old `techaust-web` Worker to the new Workers on techaust.com (keep the old one as a rollback)
  - set up monitoring, error tracking, uptime checks, and backups (with a restore drill)
