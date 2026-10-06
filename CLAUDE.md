# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
Rebuild of techaust.com: a public website, admin and client portal for **TecHaust Technologies** (sole proprietorship, GST-registered, Balurghat, West Bengal). Owner: Rupak Sarkar.

## Current status (update at every phase or milestone)
- Phases 1–5 approved. **Phase 6 M1.1 done and approved** (2026-10-06, PR #3): design tokens, fonts, and the new **brand identity "Patina"** (docs/06 §1–3, docs/11 audit, ADR 0013). The assets are in `packages/ui/brand/`.
- **M1.2 built** (2026-10-06, awaiting approval): the core library in `packages/core` (money, FY/IST dates, GSTIN + state codes, amount in words, numbering formats, permissions matrix, shared zod form schemas). **Next: M1.3** (database). See `docs/09-roadmap.md`.
- Open owner actions (not blocking):
  - trademark search (VERIFY WITH LEGAL, 08 U-8)
  - a printed proof and Pantone match
  - the phone number for the business card
- Live site: the old Worker **`techaust-web`** (rollback target). New staging Workers: `https://techaust-platform-{web,admin,portal,jobs}-staging.techaust-technologies-153.workers.dev`.

## Read first
- Status, decisions and the build order: `docs/09-roadmap.md`, `docs/04-prd.md` §0, `docs/10-tooling.md` §6
- Requirements: `docs/04-prd.md` (IDs like `ADM-INV-03` are referenced in tests and commits)
- Architecture: `docs/05-architecture.md` · Design + brand rules: `docs/06-design-system.md` · Brand audit: `docs/11-brand-audit.md` · Copy: `docs/07-content.md` · Security and compliance: `docs/08-security-compliance.md` · ADRs: `docs/adr/`
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
pnpm 12.9.1 workspace · Node 24 (→ 26 LTS) · TypeScript 6.0.3 · Biome 2.5 · Astro 7.3 static site (`apps/web`, no adapter, hand-written `/api/*` Worker) · React 19.3 + React Router 8.4 (data mode) + Vite 8 SPAs with Hono APIs via `@cloudflare/vite-plugin` (`apps/admin`, `apps/portal`) · Hono jobs Worker (`apps/jobs`) · D1 + Drizzle 0.45 · Queues · R2 · Browser Run (PDF) · SES ap-south-1 via aws4fetch · in-house auth (`packages/auth`) · **Vitest 4.1 + `@cloudflare/vitest-plugin`** (tests run in workerd) · Playwright + axe · Worker types come from **`wrangler types`** (generated, git-ignored) · design system in `packages/ui`: Tailwind v4 theme, Archivo + IBM Plex Mono (self-hosted).

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

# One package / one test
pnpm --filter @techaust/core test                                   # one package
pnpm --filter @techaust/core exec vitest run test/money.test.ts    # one file (no coverage gate)
pnpm --filter @techaust/jobs exec vitest run test/health.test.ts -t "healthz"   # one test by name
pnpm --filter @techaust/admin dev                                   # one app (SPA + its /api Worker in workerd)
pnpm --filter @techaust/web dev:worker                              # web incl. its /api Worker (astro build + wrangler dev)
pnpm --filter @techaust/jobs types                                  # regenerate worker-configuration.d.ts after editing wrangler.jsonc

# Design system and brand (packages/ui); commit the outputs, the drift tests check them
pnpm --filter @techaust/ui build:tokens     # tokens/tokens.json → generated/{tokens,theme,print}.css + email.ts
pnpm --filter @techaust/ui build:fonts      # subset fonts → fonts/*.woff2, fonts/metrics.json, generated/fonts.css
pnpm --filter @techaust/ui draw:master      # src/brand/geometry.ts + Archivo → brand/source/techaust-master.svg
pnpm --filter @techaust/ui build:brand      # master → every logo, icon, social image + brand/print/*.pdf
python packages/ui/scripts/measure-cmyk.py  # Windows only: ICC print CMYK → tokens/print-cmyk.json (after palette changes)
```
Coming with M1.3: `pnpm db:generate` (drizzle-kit) and `pnpm db:migrate:local` (wrangler d1 migrations apply).

## How the code fits together
- **Four Workers, one per host**, each configured by its own `apps/<app>/wrangler.jsonc`. The top level is the local config; `env.staging` / `env.production` override the name, `workers_dev` and `vars`.
  - `apps/web`: Astro builds static pages into `dist/`, served as Workers static assets. `run_worker_first: ["/api/*"]` means **only `/api/*` invokes `src/worker.ts`** (Hono, `basePath("/api")`). `astro dev` serves pages only, so use `dev:worker` to exercise the API.
  - `apps/admin`, `apps/portal`: the React SPA (`src/`, React Router data mode) plus a Hono API (`worker/index.ts`, `basePath("/api")`) **in one Worker**. `@cloudflare/vite-plugin` runs the Worker inside Vite dev and fills in the assets directory at build time. `not_found_handling: single-page-application` serves `index.html` for every non-API path. Two tsconfigs: `tsconfig.json` (DOM, SPA) and `tsconfig.worker.json` (Workers runtime).
  - `apps/jobs`: headless Hono Worker (`fetch` for `/healthz` + webhooks, plus `scheduled` and later `queue` handlers).
- **Packages are source-only.** Each `packages/*` exports `./src/index.ts` directly (no build step). Wrangler/Vite bundle them into the apps. `@techaust/config` holds the shared tsconfigs (`tsconfig.base.json`, `tsconfig.workers.json`).
- **Types are generated, not installed.** `wrangler types` (run by each app's `typecheck`) writes the git-ignored `worker-configuration.d.ts`, which holds the runtime types, the global `Env` (from `vars` and bindings) and the `exports` typing. Use `Hono<{ Bindings: Env }>`; after changing bindings or vars, regenerate types.
- **Workers tests run in workerd** via `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })` in each app's `vitest.config.ts`. Integration tests call the Worker with `import { exports } from "cloudflare:workers"` → `exports.default.fetch(url)` (the older `SELF` from `cloudflare:test` is deprecated). Admin/portal include only `worker/**/*.test.ts`.
- **Staging deploys differ per app** (`deploy:staging` scripts, run by `.github/workflows/deploy-staging.yml`): web and jobs use `wrangler deploy --env staging`; the SPAs use `CLOUDFLARE_ENV=staging vite build && wrangler deploy`, because the Vite plugin bakes the environment in at build time and writes a redirected deploy config.
- **`packages/ui` is the design system and the brand.**
  - **Sources:** `tokens/tokens.json` (colours, type, spacing), `src/fonts/config.ts` (font files and subsets), and `src/brand/geometry.ts` (the mark, wordmark edits and lockup proportions, as numbers).
  - **Outputs:** everything in `generated/`, `fonts/` and `brand/` comes from the scripts above and is committed. Vitest drift tests regenerate the outputs and compare, so a hand edit or a forgotten rebuild fails CI.
  - **Pure vs Node-only:** `src/tokens/*` and `src/brand/compose.ts` are pure. `src/brand/outline.ts`, `master.ts`, `print.ts` and `src/fonts/disk.ts` are Node-only (HarfBuzz, pdf-lib, file reads), and are used only by scripts and tests, never by apps.
  - **How apps consume it:** CSS and assets by path: `@techaust/ui/theme.css`, `/fonts.css`, `/brand/<file>`.
- **`packages/core` is pure domain logic** (no I/O, runs anywhere): `money.ts` (minor units, bigint maths, en-IN/en-US format and parse), `words.ts`, `dates.ts` (IST, FY), `gstin.ts` (check character, state codes), `numbering.ts` (formats + the SQL printf pattern used at issue), `permissions.ts` (the docs/04 §9 matrix: allow / step-up / approval / deny), `schemas/` (zod: shared form and domain schemas). Tests run in Node with fast-check property tests; `test/no-floats.test.ts` scans money files for float operations, so add new money modules to its list.
- **Guards worth knowing:** `scripts/check-web-bindings.mjs` fails CI if `apps/web/wrangler.jsonc` gains D1/R2/KV bindings. `deploy-prod.yml` refuses to run unless the actor is `techaust`, the repo variable `PRODUCTION_ENABLED` is `true`, and the typed confirmation matches.

## Conventions
- **Money:** integer minor units (paise/cents) + currency. Never floats. Rates in basis points; quantities in milli-units; FX as micros.
- **Time:** store UTC ms; display IST; FY = 1 April – 31 March.
- **Documents:** numbers are assigned only at issue, inside one `db.batch()` (gap-free, ≤ 16 characters). Issued documents are frozen (DB triggers); corrections only via credit/debit notes.
- **Security:** permission declared on every route (deny by default); portal client ID from the session only; webhooks verified on the raw body and idempotent; nothing is marked paid on a redirect; no personal data in logs.
- **Free plan:** one unit of work per queue message; cron only enqueues; keyset pagination ≤ 50 rows; index every filter; no base64 of big blobs; target p99 CPU ≤ 7 ms.
- **Packages:** `core` is pure (no I/O) and must keep ≥ 90 % coverage. Apps import packages, never the reverse. `apps/web` has **no D1/R2/KV bindings** (CI guard `scripts/check-web-bindings.mjs`).
- **Workers:** names are `techaust-platform-<app>` (+ `-staging`). Don't hand-write `Env` interfaces; use the generated global `Env` from `wrangler types`.
- **Supply chain:** exact version pins; pnpm `minimumReleaseAge` (1 day) blocks just-published packages (pick the previous release, don't bypass it); install scripts only via `allowBuilds` in `pnpm-workspace.yaml`; GitHub Actions pinned by commit SHA.
- **UI:** tokens from `packages/ui/tokens` only (Tailwind utilities come only from our theme, and its defaults are reset); WCAG 2.2 AA (enforced by `tokens/contrast.test.ts`); 44 px targets; text ≥ 12 px (body ≥ 16 px); reduced motion respected.
- **Brand:**
  - Never hand-edit or hand-draw logo files: change `geometry.ts` or the tokens and rebuild.
  - Never set "TecHaust" in a live font in place of the wordmark.
  - The T and the shared stem are ink; the crossbar and the right stem are verdigris (never swapped).
  - Arrows are icons, not the → character (it isn't in the fonts).
  - Print CMYK comes only from `tokens/print-cmyk.json` (ICC-measured), never a formula.
- **Content:** Markdown in `apps/web/src/content`; prices only from the catalogue snapshot (`{{price:Sx}}`); English (India/UK spelling).
