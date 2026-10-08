# 10: Tooling: skills, plugins and MCP servers (Phase 5, step P5.1)

| | |
|---|---|
| **Phase** | 5, Setup and tooling (**T1–T12 APPROVED** 2026-10-06; Phase 5 complete, see §6) |
| **Date** | 2026-10-06 (last updated 2026-10-07) |
| **Rule** | CLAUDE.md hard rule 11: each tool is explained here and **used only after your approval**. Using a tool never bypasses the other rules. Anything that **changes** Cloudflare, AWS, GitHub, DNS or production still needs your approval **for that specific action**. |

## 1. Your machine (checked 2026-10-06)

| Tool | Found | Needed | Action |
|---|---|---|---|
| Node.js | 24.19.0 | 24.x (→ 26 LTS after 28 Oct) | OK. The engines field allows ≥ 24.19 |
| pnpm | 12.6.0 | 12.9.1 (pinned via `packageManager`) | pnpm switches to the pinned version itself (`packageManager`) |
| git | 2.55.0 | — | OK. **No global name or email set yet** (asked at scaffold time) |
| GitHub CLI | 2.101.0, signed in as `techaust` | — | OK |
| wrangler | (not global) | 4.147.0 | Installed per project as a dev dependency |
| age | not installed | Only for restoring backups (Phase 7) | Install later, on your machine only |

## 2. Recommended: use now (Phases 5–6)

| # | Tool | Type | What it does | Why we need it | Access and limits |
|---|---|---|---|---|---|
| T1 | **Cloudflare plugin** (by Cloudflare: skills `cloudflare`, `workers-best-practices`, `wrangler`, `turnstile-spin`, `web-perf` + the Cloudflare MCP server) | Plugin (to install) | Current, official guidance for Workers, D1, R2, Queues, Browser Run and Turnstile. The MCP server can read your account (list Workers, D1, logs) | Our hardest constraint is the 10 ms free-plan CPU limit. Official best practices and **reading Workers Logs (CPU per request)** make the M1.4 CPU gate and the debugging reliable | Connects to your Cloudflare account through Cloudflare's own sign-in. **I use it read-only** (docs, listing, logs). Creating or changing anything waits for your approval per action, as always |
| T2 | **Context7** | MCP (already installed) | Fetches up-to-date documentation for the libraries we pin (Astro 7, Hono, Drizzle, React Router 8, Vitest) | Several of these released major versions in 2026. Writing code against old docs causes subtle bugs | Read-only public docs; no account access |
| T3 | **GitHub** (plugin MCP + `gh` CLI, already signed in as `techaust`) | MCP + CLI (already installed) | Creates and reviews PRs, reads CI results, checks repo settings | CI checks on every PR and staging deploys from `main` are part of the plan | **The first push and every repo-settings change need your approval.** No auto-deploy connections |
| T4 | **Playwright** plugin + the **built-in browser** pane | MCP (already installed) + built-in | Drives a real browser: E2E checks, keyboard tests, screenshots at 375/768/1280/1920 | Each milestone needs "responsive, accessible, no console errors" verified. Screenshots let you review without running anything | Local dev servers and staging only. I never sign in to your accounts with it |
| T5 | **frontend-design** skill | Skill (built in) | Guidance for distinctive, intentional visual design | The website must look "calm, editorial, premium", not like a template (doc 06) | No external access |
| T6 | **code-review** and **security-review** skills | Skills (built in) | Structured review of each milestone's changes for bugs and security problems (OWASP) | The milestone gates in doc 09 and [08 §3.5](08-security-compliance.md) ask for a security review before each sign-off | Local code only |
| T7 | **simplify** skill | Skill (built in) | A clean-up pass on finished code (duplication, needless complexity) | Keeps the codebase small, which matters for the 10 ms CPU and 50 KB JS budgets | Local code only |
| T8 | **pdf** and **xlsx** skills | Skills (built in) | Read and inspect generated PDFs (text, fonts, ₹ glyph, page count) and Excel files | Checks that invoices and proposals render correctly (M4.4) and that GSTR-1 Excel exports have the right columns (M5.5) | Local files only |
| T9 | **dataviz** skill | Skill (built in) | Rules for clear, accessible charts and KPI tiles | The admin dashboard and reports (M3.5, M7.3) | No external access |
| T10 | **run** skill | Skill (built in) | Starts the project's dev servers and checks a change in the real app | Day-to-day verification during each milestone | Local only |

## 3. Recommended: use later (when the milestone needs it)

| # | Tool | When | What it does / why | Access and limits |
|---|---|---|---|---|
| T11 | **AWS MCP + AWS skills** (`aws-iam`, `aws-storage`, `aws-messaging-and-streaming` → SES, `signing-in-to-aws`) (already installed) | M2.4 (SES email), Phase 7 (S3 backups, GitHub OIDC role) | Exact, least-privilege IAM policies and SES/S3 setup steps; checks that services exist in Mumbai (ap-south-1) | Needs AWS sign-in on your machine (`aws login`). **Every AWS change (identity, IAM user, bucket, role) needs your approval per action.** Read-only checks otherwise |
| T12 | **Sentry** plugin (already installed) | Phase 7 | Set up error tracking for the Workers and SPAs, then read and triage errors | Needs your Sentry account (free plan, 1 seat). Setup in Phase 7 only |

## 4. Not recommended for this project

| Tool | Why not |
|---|---|
| Supabase (two connected instances), Upstash, Expo | Not part of our stack (Cloudflare D1/Queues; no mobile app in this project). Leaving them unused avoids accidental access. Consider disconnecting them from this project's session if you prefer. |
| Claude in Chrome | Uses your real, logged-in Chrome. Not needed; the built-in browser is isolated and safer. |
| Axe Accessibility (Deque) MCP | Good, but its MCP workflow is tied to Deque's axe platform, which may be a paid product. We already run the free, open-source **axe-core** in CI via Playwright. Revisit only if needed. |
| "Ship A Cloudflare Worker", "devrunway", "securitymaxxing" (community plugins) | They overlap with the official Cloudflare plugin and the built-in review skills. Several install broad ("privileged") hooks, which is an unnecessary risk. |
| Stark accessibility | A paid platform; not needed at our scale |

## 5. After approval: what happens next (P5.2–P5.8, see [09](09-roadmap.md)): done 2026-10-06, see §6
1. Install the Cloudflare plugin (T1) if approved, and connect it through Cloudflare's sign-in.
2. Scaffold the monorepo and `git init`. I'll ask for your git author name/email.
3. Ask your approval for the **first push** to `techaust/techaust_platform`.
4. Propose the GitHub settings, Cloudflare staging resources and CI workflows, each with its own approval.

## 6. Phase 5 status (2026-10-06)

| Step | Status |
|---|---|
| P5.1 Tools | ✅ T1–T12 approved; Cloudflare plugin installed via `claude plugin install cloudflare@cloudflare` (marketplace `cloudflare/skills`) and its MCP server authorised (read-only use). Cloudflare's agent-setup page reviewed: the beta `cf` CLI and the other-agent steps were skipped as unnecessary. |
| P5.2–P5.3 Scaffold + git | ✅ Monorepo builds, lints, type-checks; 7 tests pass (4 in workerd) |
| P5.4 First push | ✅ Approved; repo `techaust/techaust_platform` (owner made it **public**, see the risk note in [08 §0 U-6](08-security-compliance.md)) |
| P5.5 GitHub settings | ✅ Branch protection on `main`: PR + `checks` required, admins included, linear history, no force-push or deletion |
| P5.6 Staging resources | ✅ D1 `techaust-staging` + 8 queues ([runbooks/environments.md](runbooks/environments.md)); R2, Turnstile and Access deferred |
| P5.7 CI token | ✅ Owner created `CF_API_TOKEN_STAGING` (Workers/D1/Queues/Account read; no zone/DNS) + `CLOUDFLARE_ACCOUNT_ID` |
| P5.8 CI/CD | ✅ CI green; staging deploy runs on merge to `main`; production workflow owner-only and disabled until Phase 7 |

## 7. Phase 6 additions (M1.1, 2026-10-06)

| What | Kind | Why | Notes |
|---|---|---|---|
| **frontend-design** skill (T5, approved) | Skill | Three identity concepts and the brand refinement | Used as planned |
| Web search / fetch (built in) | Tool | Checked LinkedIn's official image sizes in its help centre | Read-only |
| Built-in browser pane (T4) | Tool | Rendered and screenshot-checked every concept, logo, social image and print PDF | Local pages only |
| Design build libraries (dev-only, `packages/ui`) | npm | Font subsetting and outlines (subset-font, harfbuzzjs, fontverter, fontkitten), rasters (sharp), print PDFs (`@cantoo/pdf-lib`, already in the approved stack), Tailwind theme test (tailwindcss), fonts (Fontsource Archivo, IBM Plex Mono) | Exact pins, `minimumReleaseAge` respected; none run install scripts or reach a Worker bundle. Versions in [05 §2](05-architecture.md) |
| LittleCMS via Pillow + Windows `RSWOP.icm` | Local, one-off | ICC-accurate print CMYK (`packages/ui/scripts/measure-cmyk.py`) | Results committed in `tokens/print-cmyk.json`, so CI never needs it |

## 8. Phase 6 additions (M1.2, 2026-10-06, owner-approved)

| What | Kind | Why | Notes |
|---|---|---|---|
| **fast-check** 4.10.2 | npm (dev-only, `packages/core`) | Property tests: generates thousands of random amounts, dates and formats to prove the rules (format → parse returns the same paise; instalments add up to the total; every document number fits 16 characters; any single-character GSTIN typo is caught) | Exact pin; never reaches a Worker bundle |
| **@vitest/coverage-v8** 4.1.11 | npm (dev-only, `packages/core`) | Enforces the ≥ 90 % coverage rule for `core` on every `pnpm test` (locally and in CI) | Matches Vitest 4.1.11 exactly |
| Web fetch (built in) | Tool | Checked the GST state-code list against the official e-way bill master, and GSTIN check-character vectors | Read-only |

## 9. Working-rules additions (2026-10-07, owner-approved)
Approved in the 2026-10-07 interview ([13-decisions.md](13-decisions.md)). No new packages, plugins or MCP servers: all of these are built-in Claude Code features or small scripts in this repo.

| Tool | Type | What it does | Access and limits |
|---|---|---|---|
| **builder** agent (`.claude/agents/builder.md`) | Claude Code subagent (Sonnet) | Writes code and tests for one task from a brief in `docs/runs/` | Its own git worktree; never touches hosted services, never pushes |
| **reviewer** agent (`.claude/agents/reviewer.md`) | Claude Code subagent (Opus, high effort) | Reviews each task before it merges | Read-only |
| Git worktrees | Built in (`isolation: "worktree"`) | A separate copy of the repo per builder, in `.claude/worktrees/` (git-ignored) | Local disk only |
| Monitor tool | Built in | Runs `tools/watch.sh` and wakes the lead only on an event | Local only |
| `tools/heavy.sh` | Repo script (Git Bash) | Runs heavy commands one at a time per PC; pauses under 512 MB free memory | Local only |
| `tools/watch.sh` | Repo script (Git Bash) | Reports a builder stall (20 min, lock free) or low memory | Local only |
| `start-session` / `end-session` skills | Repo skills (`.claude/skills/`) | "start the day" / "end the day" routines | Local; the end-session PR uses `gh` |

## 10. Models-and-usage additions (2026-10-08, owner-approved)
Approved with the models and usage plan ([14-models-and-usage.md](14-models-and-usage.md)). No new packages, plugins or MCP servers: these are Claude Code agent files and a script option in this repo.

| Tool | Type | What it does | Access and limits |
|---|---|---|---|
| **code-finder** agent (`.claude/agents/code-finder.md`) | Claude Code subagent (Haiku, low effort, skips CLAUDE.md) | Answers "where is X"; replaces the built-in Explore, Plan and general-purpose agents (Opus) | Read-only (Read, Glob, Grep) |
| **test-runner** agent (`.claude/agents/test-runner.md`) | Claude Code subagent (Haiku, low effort, skips CLAUDE.md) | Runs one suite through `tools/heavy.sh --log` and reports only the failures | Runs commands; changes no files; never staging or production |
| **doc-clerk** agent (`.claude/agents/doc-clerk.md`) | Claude Code subagent (Haiku, medium effort, skips CLAUDE.md) | Drafts CHANGELOG lines, status tables and link fixes | Edits only `CHANGELOG.md`, `docs/12-status.md` and relative links; the lead checks the diff |
| `tools/heavy.sh --log <name>` | Repo script option | Writes the full output to `.logs/<name>.log` and prints only the exit code and last 40 lines | Local only; `*.log` is git-ignored |
| Usage tool (`get_usage`) | Built in (desktop app) | Reads the plan's weekly and 5-hour usage for the budget gate | Read-only |

The **builder** and **reviewer** rows in §9 still apply; their model and effort now follow the task's tier ([14 §3](14-models-and-usage.md)), and the builder's tools are a fixed list.
