# TecHaust Platform: project rules for Claude

Rebuild of techaust.com: a public website, admin and client portal for **TecHaust Technologies** (sole proprietorship, GST-registered, Balurghat, West Bengal). Owner: Rupak Sarkar.

## Read first
- Status and decisions: `docs/04-prd.md` §0, `docs/09-roadmap.md` (current phase/milestone)
- Requirements: `docs/04-prd.md` (IDs like `ADM-INV-03` are referenced in tests and commits)
- Architecture: `docs/05-architecture.md` · Design: `docs/06-design-system.md` · Copy: `docs/07-content.md` · Security and compliance: `docs/08-security-compliance.md`
- Background (approved): `docs/01-audit.md`, `docs/02-services-strategy.md`, `docs/03-plan.md`

## Hard rules (owner's ground rules)
1. **Never guess.** If information is missing or a decision is the owner's, stop and ask with AskUserQuestion: up to 4 questions per batch, the recommended option first and marked "(Recommended)".
2. **Phases and milestones need an explicit "approved"** from the owner before moving on. Each milestone: explain → build + tests → verify locally → commit → show → wait.
3. **Old site is READ-ONLY:** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`. Never modify it, build in it, or run git-writing commands there. **Never read the sibling `CREDENTIALS` folder.**
4. **Don't touch production, DNS, or Cloudflare/AWS/GitHub settings** without the owner's approval for that specific action. Phase 6 deploys go to **staging only**.
5. **Secrets:** never hardcode or commit them. Use Wrangler secrets / GitHub secrets; names only in `.env.example` / `.dev.vars.example`. Give the owner the `wrangler secret put …` command; never ask for values in chat.
6. **Payments:** sandbox/test keys only until the owner's explicit go-live (`PAYMENTS_LIVE_ALLOWED=false`). Never collect or store card or bank credentials.
7. **Compliance:** tag anything about GST, invoicing law, payments regulation or DPDP **"VERIFY WITH CA/LEGAL"**. Never present it as settled advice. Tax/legal rules are **settings** with researched defaults (`docs/08-research-appendix/`).
8. **Cost:** everything must fit the **Cloudflare Workers Free plan** (10 ms CPU per invocation, including cron and queue consumers) and ₹500–1,000/month. Propose any paid upgrade separately.
9. **Honesty:** no fabricated metrics, testimonials, team members, clients or "live" data. Respect the banned-phrase list in `docs/07-content.md` §1.3.
10. **Skills, plugins and MCP servers:** recommend them with an explanation, and use them only after the owner approves.
11. Keep `docs/` and memory notes updated so work can resume across sessions.

## Stack (pinned exactly; see `docs/05-architecture.md` §2)
pnpm 12 monorepo · Node 24 (→ 26 LTS) · TypeScript 6.0.3 · Astro 7 static (`apps/web`, no adapter, hand-written `/api/*` Worker) · React 19 + React Router 8 (data mode) + Vite 8 SPAs with a Hono API (`apps/admin`, `apps/portal`) · Hono jobs Worker (`apps/jobs`: webhooks, queues, crons) · D1 + Drizzle 0.45 · R2 · Queues · Browser Run Quick Action (PDF) · SES ap-south-1 via aws4fetch · in-house auth (`packages/auth`) · Vitest 4.1 + workers pool · Playwright + axe · Biome.

## Commands (available after the Phase 5 scaffold)
```bash
pnpm install            # install (frozen lockfile in CI)
pnpm dev                # all Workers locally (web :4321, admin :5173, portal :5174, jobs :8787)
pnpm check              # biome + tsc -b + astro check
pnpm test               # vitest (unit + workers integration)
pnpm test:e2e           # playwright + axe
pnpm build              # build all apps
pnpm db:generate        # drizzle-kit generate → packages/db/migrations
pnpm db:migrate:local   # wrangler d1 migrations apply (local)
```
Deploys: push to `main` → staging (CI). **Production only via `deploy-prod.yml`, run by the owner** (typed confirmation).

## Conventions
- **Money:** integer minor units (paise/cents) + currency. Never floats. Rates in basis points; quantities in milli-units; FX as micros.
- **Time:** store UTC ms; display IST; FY = 1 April – 31 March.
- **Documents:** numbers are assigned only at issue, inside one `db.batch()` (gap-free, ≤ 16 chars). Issued documents are frozen (DB triggers); corrections only via credit/debit notes.
- **Security:** permission declared on every route (deny by default); portal client ID from the session only; webhooks verified on the raw body and idempotent; nothing is marked paid on a redirect; no personal data in logs.
- **Free plan:** one unit of work per queue message; cron only enqueues; keyset pagination ≤ 50 rows; index every filter; no base64 of big blobs; target p99 CPU ≤ 7 ms.
- **Packages:** `core` is pure (no I/O) and must keep ≥ 90 % coverage. Apps import packages, never the reverse. `apps/web` has **no D1/R2 bindings**.
- **UI:** tokens from `packages/ui/tokens` only; WCAG 2.2 AA; 44 px targets; text ≥ 12 px (body ≥ 16 px); reduced motion respected.
- **Commits:** conventional commits referencing PRD IDs (e.g. `feat(invoices): gap-free numbering [ADM-INV-03]`). Commit only when asked or at a milestone.
- **Content:** Markdown in `apps/web/src/content`; prices only from the catalogue snapshot (`{{price:Sx}}`); English (India/UK spelling).
