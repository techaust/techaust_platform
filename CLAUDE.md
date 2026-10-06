# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project
Rebuild of techaust.com: a public website, admin and client portal for **TecHaust Technologies** (sole proprietorship, GST-registered, Balurghat, West Bengal). Owner: Rupak Sarkar.
- **Live site:** the old Worker **`techaust-web`**, which is also the rollback target.
- **Staging Workers:** `https://techaust-platform-{web,admin,portal,jobs}-staging.techaust-technologies-153.workers.dev`.

**This file holds rules only, never status or history.** The owner starts each day in a new conversation with **"start the day"** and ends it with **"end the day"**. A fresh conversation each day costs far less per turn than one very long one. The skills `.claude/skills/start-session` and `end-session` run these.

## The record (read at the start, update at the end)
- **`docs/12-status.md`:** the single place for where things stand: done, in progress, next, waits on the owner, open follow-ups. Replace it at the end of each session; never append to it.
- **`docs/13-decisions.md`:** one row per decision (date, decision, who, where it's applied). **Never ask the owner again about a question that's decided there.**
- **`CHANGELOG.md`:** one line per merged PR, newest first.
- **Naming:** top-level docs are numbered `docs/NN-name.md`; supporting material goes in `docs/NN-name-appendix/`; ADRs are `docs/adr/NNNN-name.md`; procedures go in `docs/runbooks/`. Only `README.md`, `CLAUDE.md` and `CHANGELOG.md` sit in the repo root (tools expect them there).
- **`docs/runs/<task>.md`:** one file per task given to a builder: the brief, the builder's report, the review, the integration notes ([docs/runs/README.md](docs/runs/README.md)).

## Read first
- The plan and build order: `docs/09-roadmap.md`. Product decisions: `docs/04-prd.md` §0. Tools: `docs/10-tooling.md`
- Requirements: `docs/04-prd.md` (IDs like `ADM-INV-03` are referenced in tests and commits)
- Other docs:
  - architecture: `docs/05-architecture.md`
  - design and brand rules: `docs/06-design-system.md`
  - brand audit: `docs/11-brand-audit.md`
  - copy: `docs/07-content.md`
  - security and compliance: `docs/08-security-compliance.md`
  - ADRs: `docs/adr/`
- Environments and Cloudflare resources: `docs/runbooks/environments.md`
- Background (approved): `docs/01-audit.md`, `docs/02-services-strategy.md`, `docs/03-plan.md` (where 03 differs from 05, **05 wins**)

## Hard rules (owner's ground rules)
1. **Never guess.** If information is missing or a decision is the owner's, stop and ask with AskUserQuestion: up to 4 questions per batch, the recommended option first and marked "(Recommended)". Explain anything technical in plain English when asked.
2. **Milestones are approved on staging.** Each milestone: explain → build + tests → verify locally → review → PR → CI green → it merges itself and deploys to staging → show the owner → **wait for "approved" before starting the next milestone.** A PR that the record marks as held (for example "not before Access is on") gets no auto-merge.
3. **Old site is READ-ONLY:** `D:\BUSINESS\1. PARENT PROJECT\TECHAUST TECHNOLOGIES\ASSETS\WEBSITE`. Never modify it, build in it, or run git-writing commands there. **Never read the sibling `CREDENTIALS` folder.**
4. **Never deploy to, rename or delete the Worker `techaust-web`.** Don't touch production, DNS, or Cloudflare/AWS/GitHub settings without the owner's approval for that specific action. Phase 6 deploys go to **staging only** (automatically, on merge to `main`).
5. **Secrets:** never hardcode, commit, or ask for them in chat. Names only in `.env.example` / `.dev.vars.example`. Give the owner the exact `wrangler secret put …` / `gh secret set …` command to run.
6. **The repo `techaust/techaust_platform` is PUBLIC** (owner decision, 2026-10-06; may go private later). Treat everything committed as published: no secrets, no personal data, no client data. Ask before committing new business-sensitive material. Workflows must stay fork-safe (no secrets reachable from fork PRs).
7. **Payments:** sandbox/test keys only until the owner's explicit go-live (`PAYMENTS_LIVE_ALLOWED=false`). Never collect or store card or bank credentials.
8. **Compliance:** tag GST, invoicing law, payments regulation and DPDP items **"VERIFY WITH CA/LEGAL"**, and never present them as settled advice. Tax/legal rules are **settings** with researched defaults (`docs/08-research-appendix/`).
9. **Cost:** everything must fit the **Cloudflare Workers Free plan** (10 ms CPU per invocation, including cron and queue consumers) and ₹500–1,000/month. Propose any paid upgrade separately.
10. **Honesty:** no fabricated metrics, testimonials, team members, clients or "live" data. Respect the banned-phrase list in `docs/07-content.md` §1.3. Never invent client data; a missing client input becomes a clearly named, flagged default only when the owner says so.
11. **Tools:** approved tools are listed in `docs/10-tooling.md`. **Never install plugins, MCP servers or packages without the owner's go-ahead.** The Cloudflare MCP server is used **read-only**.
12. Keep the record (above), this file and memory notes updated so work can resume across sessions.

## Working with the owner
- **The owner isn't a shell user.** Give click-by-click steps, one command per code block, with full paths.
- **Decisions:** ask only the ones that are the owner's, as multiple-choice questions with the recommendation first. Take routine engineering decisions yourself, state them, and record them in `docs/13-decisions.md` (who: Lead).
- **Reporting:** say honestly what ran, what passed, and what wasn't verified.
- **Plans:** for anything that touches more than one file, present a numbered plan first, unless the owner has already approved it.
- **When the owner must handle a secret:**
  - write a small PowerShell script that prompts with hidden input (`Read-Host -AsSecureString`), checks the value, and stores it (`wrangler secret put` / `gh secret set`) or puts it on the clipboard
  - the owner runs it and copies back **only its result line**
  - anything pasted into chat counts as exposed and gets rotated

## How work is split (models, effort, builders)
| Work | Model and effort | How it's set |
|---|---|---|
| Lead (this conversation: plans, briefs, integration, talks to the owner) | Opus 5.5, medium | **The owner picks it in the app's model picker.** It's not pinned in settings. If a session starts on anything else, say so once. |
| Builders | Sonnet 5.5 | `.claude/agents/builder.md` |
| Reviewer (changes no code) | Opus 5.5, high effort | `.claude/agents/reviewer.md` |

- **Builders:** at most **two at once** (this PC has 8 GB of RAM). Each one gets its own git worktree (`isolation: "worktree"`) and a run file with a brief that stands on its own.
- **Builders' own rules:**
  - commit at least every 20 minutes
  - stop and report when blocked
  - never touch hosted services; any hosted change needs the owner's yes first
- **Heavy commands go through the queue, one at a time:** full lint, typecheck, build, database tests and end-to-end tests run via `bash tools/heavy.sh <command>`.
  - the lock is `~/.techaust-heavy.lock`, and a lock older than 90 minutes is stale
  - commands wait while free memory is under 512 MB
  - the whole-repository lint runs only once, as a builder's final check
- **Every task is reviewed before it merges.** The reviewer can send it back. The lead integrates the tasks, runs `pnpm check` + `pnpm test`, and fills in the run file.
- **Check-ins happen only on events:**
  - a builder finishes
  - a builder stalls for 20 minutes with the lock free, or free memory falls under 512 MB (watched with the Monitor tool running `bash tools/watch.sh <worktrees>`)
  - a review result arrives
  - a decision belongs to the owner

  No progress messages in between.
- **Small or tightly coupled work** (doc edits, one-file fixes, merges, gate checks) is done by the lead directly, without agents.

## Git workflow
- `main` is **protected**: PR required, the CI `checks` job must pass, linear history, no force-push, admins included.
- **Never push to `main` or force-push.** The flow: work on a branch → push → `gh pr create` → `gh pr merge --auto --squash` → it merges itself once CI is green (owner rule, 2026-10-07) → staging auto-deploys. Held PRs (see `docs/12-status.md`) get no auto-merge.
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
pnpm build              # build all apps (web and jobs also dry-run their Worker bundles)
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

# Database (packages/db)
pnpm db:generate          # drizzle-kit: src/schema → a new migrations/NNNN_*.sql (CI fails if you forget)
pnpm db:migrate:local     # apply migrations to the shared local D1 (.wrangler/state, used by admin/portal/jobs dev)
pnpm db:seed:local        # load the seed (catalogue S1–S18 + settings defaults); safe to re-run
```

## How the code fits together
- **Four Workers, one per host**, each configured by its own `apps/<app>/wrangler.jsonc`. The top level is the local config; `env.staging` / `env.production` override the name, `workers_dev`, `vars` and bindings (bindings such as `d1_databases` are **not inherited**: staging binds `techaust-staging`; production has no D1 until Phase 7).
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
- **`packages/db` is the D1 schema** (Drizzle, `src/schema/*`, snake_case names written out). `drizzle-kit generate` writes migrations; **never edit an applied migration** (add a new one). Integrity triggers (frozen documents, append-only logs, counters, the issue guard) are generated by `src/triggers.ts` into a custom migration with `scripts/write-triggers.ts`; tests read the installed triggers to prove every document column is covered. The seed (`src/seed/`) is pure SQL text, insert-only, with stable IDs (`stableId`). Tests run in workerd with all migrations applied (`test/setup.ts`); tests within one file share a database. Use `createDb(env.DB)` for a typed client.
- **Guards worth knowing:** `scripts/check-web-bindings.mjs` fails CI if `apps/web/wrangler.jsonc` gains D1/R2/KV/Durable Object/Hyperdrive bindings. `deploy-prod.yml` refuses to run unless the actor is `techaust`, the repo variable `PRODUCTION_ENABLED` is `true`, and the typed confirmation matches.

## Conventions
- **Money:** integer minor units (paise/cents) + currency. Never floats. Rates in basis points; quantities in milli-units; FX as micros.
- **Time:** store UTC ms; display IST; FY = 1 April – 31 March.
- **Documents:** numbers are assigned only at issue, inside one `db.batch()` (gap-free, ≤ 16 characters). Issued documents are frozen (DB triggers); corrections only via credit/debit notes.
- **Security:** permission declared on every route (deny by default); portal client ID from the session only; webhooks verified on the raw body and idempotent; nothing is marked paid on a redirect; no personal data in logs.
- **Free plan:** one unit of work per queue message; cron only enqueues; keyset pagination ≤ 50 rows; index every filter; no base64 of big blobs; target p99 CPU ≤ 7 ms.
- **Packages:** `core` is pure (no I/O) and must keep ≥ 90 % coverage. Apps import packages, never the reverse. `apps/web` has **no D1/R2/KV/Durable Object/Hyperdrive bindings** (CI guard `scripts/check-web-bindings.mjs`).
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
