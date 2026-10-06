# 10: Tooling: skills, plugins and MCP servers (Phase 5, step P5.1)

| | |
|---|---|
| **Phase** | 5, Setup and tooling (**T1–T12 APPROVED** by owner 2026-10-06) |
| **Date** | 2026-10-06 |
| **Rule** | Owner ground rule 6: each tool is explained here and **used only after your approval**. Using a tool never bypasses the other rules. Anything that **changes** Cloudflare, AWS, GitHub, DNS or production still needs your approval **for that specific action**. |

## 1. Your machine (checked 2026-10-06)

| Tool | Found | Needed | Action |
|---|---|---|---|
| Node.js | 24.19.0 | 24.x (→ 26 LTS after 28 Oct) | OK. The engines field allows ≥ 24.19 |
| pnpm | 12.6.0 | 12.9.1 (pinned via `packageManager`) | Corepack fetches the pinned version automatically |
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

## 5. After approval: what happens next (P5.2–P5.8, see [09](09-roadmap.md))
1. Install the Cloudflare plugin (T1) if approved, and connect it through Cloudflare's sign-in.
2. Scaffold the monorepo and `git init`. I'll ask for your git author name/email.
3. Ask your approval for the **first push** to `techaust/techaust_platform`.
4. Propose the GitHub settings, Cloudflare staging resources and CI workflows, each with its own approval.

## 6. Phase 5 status (2026-10-06)

| Step | Status |
|---|---|
| P5.1 Tools | ✅ T1–T12 approved; Cloudflare plugin installed (MCP sign-in pending, read-only use) |
| P5.2–P5.3 Scaffold + git | ✅ Monorepo builds, lints, type-checks; 7 tests pass (4 in workerd) |
| P5.4 First push | ✅ Approved; repo `techaust/techaust_platform` (owner made it **public**, see the risk note in memory/08) |
| P5.5 GitHub settings | ✅ Branch protection on `main`: PR + `checks` required, admins included, linear history, no force-push or deletion |
| P5.6 Staging resources | ✅ D1 `techaust-staging` + 8 queues ([runbooks/environments.md](runbooks/environments.md)); R2, Turnstile and Access deferred |
| P5.7 CI token | ✅ Owner created `CF_API_TOKEN_STAGING` (Workers/D1/Queues/Account read; no zone/DNS) + `CLOUDFLARE_ACCOUNT_ID` |
| P5.8 CI/CD | ✅ CI green; staging deploy runs on merge to `main`; production workflow owner-only and disabled until Phase 7 |
