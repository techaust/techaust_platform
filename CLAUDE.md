# TecHaust Platform: project rules for Claude

Rebuild of techaust.com: a public website, admin and client portal for **TecHaust Technologies** (sole proprietorship, GST-registered, Balurghat, West Bengal). Owner: Rupak Sarkar.

## Current status (update at every phase or milestone)
- Phases 1–4 approved. **Phase 5 (setup) complete, awaiting the owner's "approved".**
- **Next:** Phase 6 milestone **M1.1**, design tokens + refined logo variants (`docs/09-roadmap.md`).
- Live site: the old Worker **`techaust-web`** (rollback target). New staging Workers: `https://techaust-platform-{web,admin,portal,jobs}-staging.techaust-technologies-153.workers.dev`.

## Read first
- Status, decisions and the build order: `docs/09-roadmap.md`, `docs/04-prd.md` §0, `docs/10-tooling.md` §6
- Requirements: `docs/04-prd.md` (IDs like `ADM-INV-03` are referenced in tests and commits)
- Architecture: `docs/05-architecture.md` · Design: `docs/06-design-system.md` · Copy: `docs/07-content.md` · Security and compliance: `docs/08-security-compliance.md` · ADRs: `docs/adr/`
- Environments and Cloudflare resources: `docs/runbooks/environments.md`
- Background (approved): `docs/01-audit.md`, `docs/02-services-strategy.md`, `docs/03-plan.md` (where 03 differs from 05, **05 wins**)

## Hard rules (owner's ground rules)
1. **Never guess.** If information is missing or a decision is the owner's, stop and ask with AskUserQuestion: up to 4 questions per batch, the recommended option first and marked "(Recommended)". Explain anything technical in plain English when asked.
2. **Phases and milestones need an explicit "approved".** Each milestone: explain → build + tests → verify locally → PR → CI green → show → wait.
3. **Old site is READ-ONLY:** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`. Never modify it, build in it, or run git-writing commands there. **Never read the sibling `CREDENTIALS` folder.**
4. **Never deploy to, rename or delete the Worker `techaust-web`.** Don't touch production, DNS, or Cloudflare/AWS/GitHub settings without the owner's approval for that specific action. Phase 6 deploys go to **staging only** (automatically, on merge to `main`).
5. **Secrets:** never hardcode, commit, or ask for them in chat. Names only in `.env.example` / `.dev.vars.example`. Give the owner the exact `wrangler secret put …` / `gh secret set …` command to run.
6. **The repo `techaust/techaust_platform` is PUBLIC** (owner decision, 2026-10-06; may go private later). Treat everything committed as published: no secrets, no personal data, no client data. Ask before committing new business-sensitive material. Workflows must stay fork-safe (no secrets reachable from fork PRs).
7. **Payments:** sandbox/test keys only until the owner's explicit go-live (`PAYMENTS_LIVE_ALLOWED=false`). Never collect or store card or bank credentials.
8. **Compliance:** tag GST, invoicing law, payments regulation and DPDP items **"VERIFY WITH CA/LEGAL"**, and never present them as settled advice. Tax/legal rules are **settings** with researched defaults (`docs/08-research-appendix/`).
9. **Cost:** everything must fit the **Cloudflare Workers Free plan** (10 ms CPU per invocation, including cron and queue consumers) and ₹500–1,000/month. Propose any paid upgrade separately.
10. **Honesty:** no fabricated metrics, testimonials, team members, clients or "live" data. Respect the banned-phrase list in `docs/07-content.md` §1.3.
11. **Tools:** approved tools are listed in `docs/10-tooling.md`. Ask before using anything new. The Cloudflare MCP server is used **read-only**.
12. Keep `docs/`, this file and memory notes updated so work can resume across sessions.

## Git workflow
- `main` is **protected**: PR required, the CI `checks` job must pass, linear history, no force-push, admins included.
- Work on a branch → push → `gh pr create` → CI green → **squash-merge** → staging auto-deploys.
- Commit identity (repo-local): `TecHaust Technologies <admin@techaust.com>`. Conventional commits referencing PRD IDs, e.g. `feat(invoices): gap-free numbering [ADM-INV-03]`.

## Stack (pinned exactly; see `docs/05-architecture.md` §2)
pnpm 12.9.1 workspace · Node 24 (→ 26 LTS) · TypeScript 6.0.3 · Biome 2.5 · Astro 7.3 static site (`apps/web`, no adapter, hand-written `/api/*` Worker) · React 19.3 + React Router 8.4 (data mode) + Vite 8 SPAs with Hono APIs via `@cloudflare/vite-plugin` (`apps/admin`, `apps/portal`) · Hono jobs Worker (`apps/jobs`) · D1 + Drizzle 0.45 · Queues · R2 · Browser Run (PDF) · SES ap-south-1 via aws4fetch · in-house auth (`packages/auth`) · **Vitest 4.1 + `@cloudflare/vitest-plugin`** (tests run in workerd) · Playwright + axe · Worker types come from **`wrangler types`** (generated, git-ignored).

## Commands
```bash
pnpm install            # plain `pnpm` auto-switches to the pinned 12.9.1
pnpm dev                # all apps locally (web :4321, admin :5173, portal :5174, jobs :8787)
pnpm lint               # biome check
pnpm typecheck          # wrangler types + tsc / astro check in every package
pnpm check              # lint + typecheck + public-Worker binding guard
pnpm test               # vitest (unit + Workers runtime)
pnpm build              # build all apps (web also dry-runs its Worker bundle)
pnpm format             # biome format --write
```
Coming with M1.3: `pnpm db:generate` (drizzle-kit) and `pnpm db:migrate:local` (wrangler d1 migrations apply).

## Conventions
- **Money:** integer minor units (paise/cents) + currency. Never floats. Rates in basis points; quantities in milli-units; FX as micros.
- **Time:** store UTC ms; display IST; FY = 1 April – 31 March.
- **Documents:** numbers are assigned only at issue, inside one `db.batch()` (gap-free, ≤ 16 characters). Issued documents are frozen (DB triggers); corrections only via credit/debit notes.
- **Security:** permission declared on every route (deny by default); portal client ID from the session only; webhooks verified on the raw body and idempotent; nothing is marked paid on a redirect; no personal data in logs.
- **Free plan:** one unit of work per queue message; cron only enqueues; keyset pagination ≤ 50 rows; index every filter; no base64 of big blobs; target p99 CPU ≤ 7 ms.
- **Packages:** `core` is pure (no I/O) and must keep ≥ 90 % coverage. Apps import packages, never the reverse. `apps/web` has **no D1/R2/KV bindings** (CI guard `scripts/check-web-bindings.mjs`).
- **Workers:** names are `techaust-platform-<app>` (+ `-staging`). Don't hand-write `Env` interfaces; use the generated global `Env` from `wrangler types`.
- **Supply chain:** exact version pins; pnpm `minimumReleaseAge` (1 day) blocks just-published packages (pick the previous release, don't bypass it); install scripts only via `allowBuilds` in `pnpm-workspace.yaml`; GitHub Actions pinned by commit SHA.
- **UI:** tokens from `packages/ui/tokens` only; WCAG 2.2 AA; 44 px targets; text ≥ 12 px (body ≥ 16 px); reduced motion respected.
- **Content:** Markdown in `apps/web/src/content`; prices only from the catalogue snapshot (`{{price:Sx}}`); English (India/UK spelling).
