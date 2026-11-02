# Run: parallel cloud sessions, 2026-11-02

Status: done (#163 merged)
Tier: B (planning only)
Usage: 5-h 4 % at about 23:05 IST (reset 22:30 UTC = 04:00 IST); main session claude-opus-5-5/high (`node tools/model-audit.mjs`); the cloud session's agents are recorded in its own run file.

The owner asked on 2026-11-02 (evening) to start the remaining items in cloud sessions (fourth admin Worker, M6.5, M7.1–M7.5, the M6–M7 audit). Each M6.5/M7.x brief builds on the previous milestone's code and hard rule 2 builds one milestone at a time, approved on staging; the owner chose (AskUserQuestion, recommended option) **one planning session for the fourth admin Worker**. M6.4 runs on the PC (builder fix round B3 and the admin-screens designer).

## Plan
| # | Session name | Task | Tier | Branch | Run file | Copy file | Migrations | Merges |
|---|---|---|---|---|---|---|---|---|
| 1 | `admin-split-plan` | Build brief for the fourth admin Worker (split finance), planning only | B | `docs/admin-split-plan` | `docs/runs/admin-split-plan.md` | none | none | 1st (docs only) |

**Not started, and why:** M6.5 (skips a milestone: M6.4 not approved; same payment files as M6.4's fix round); M7.1–M7.5 (each skips a milestone; each brief builds on the previous one's code); audit M6–M7 (after M7.5); the fourth Worker's build (after M6.4 merges: finance file overlap).

**Started:** requested about 23:10 IST (its run file: 23:12), environment `techaust_platform`, from `main` e765e2f3; task id task_ba760a1b; first reading `USAGE 5 at 2026-11-02T23:40+05:30`.

## Task 1: `admin-split-plan` (Tier B), the prompt exactly as sent
```text
You are the TASK LEAD for ONE task of the TecHaust rebuild, running as a cloud session. A MAIN SESSION on the owner's PC controls 1 parallel cloud session (and runs M6.4 PayPal on the PC itself: a builder fix round and the admin screens): it relays the owner's answers, posts usage readings, turns on auto-merge and Auto-fix, and alone keeps the record. You do the whole task inside this session with your own agents.

START
1. The SessionStart hook's note must not say "MODEL IS …, NOT Opus 5.5". If it does, stop and say so in one line.
2. Run `bash scripts/cloud-check.sh`. Any FAIL: stop and report the whole output.
3. Read CLAUDE.md (all rules apply, including "In a cloud session"), docs/12-status.md, docs/13-decisions.md (never re-ask a decided question), docs/14-models-and-usage.md §2–§5 and §9, docs/runs/README.md, docs/runbooks/cloud-sessions.md ("What runs where" and Part 4), and the files named in YOUR TASK below.
4. Load every skill that fits (docs/14 §9). Every agent you start loads its own fitting skills too.
5. Create your branch (named in YOUR TASK) from origin/main and push it. Create your run file docs/runs/<name>.md (docs/runs/README.md format) with a "Status:" line at the top that you keep current (e.g. "Status: builder running", "Status: WAITING ON OWNER (Q1, Q2)", "Status: BLOCKED (<why>)", "Status: PR READY <url>"). Commit and push it now. The main session's watcher reads only that line, from your pushed branch: push every change to it, and start it with the keyword when one applies (PR READY, WAITING ON OWNER, BLOCKED, FAILING, SENT BACK, merged, abandoned): a keyword later in the line is not seen.

AGENTS AND USAGE
- Order inside the task (CLAUDE.md): Tier A: analyst drafts the brief, you write the final brief in the run file; builder (Tier A: stops after schema, migrations, core logic and API for the analyst's early check) → Tiers A and B: analyst early check (GO/CHANGE) → designer (screens, its own screenshots) → reviewer (code + visual) → fixes → re-check (a second review after any critical or high finding).
- At most 2 agents at once in this session, at most 1 using a browser (TECHAUST_PORT_OFFSET=0). Every agent on Opus 5.5 at high; never Sonnet, Haiku, Fable, Explore, Plan, general-purpose or claude agents.
- Before EVERY agent start run `node tools/agent-slots.mjs --cloud --running <n> --browsers <n> [--browser] --reading <pct> --reading-at <ISO time>` with the newest "USAGE <pct> at <ISO time>" message from the main session (first reading: USAGE 5 at 2026-11-02T23:40+05:30). Start no new agent while the latest reading is over 85 %, whatever agent-slots says (the lead's pacing rule, 2026-11-01). Never edit or commit docs/runs/usage-reading.md. "start: no" means wait; running agents keep going and commit as they go.
- Each builder or designer works in its own worktree on a sub-branch named `fix/<session name>-<step>` (e.g. fix/<name>-r1), made from origin/<your branch>, and pushes only that; you merge it into your branch. The watcher counts pushes to `fix/<session name>-*` as activity, so other names look like silence.
- Record each agent's model and effort from `node tools/model-audit.mjs` in the run file's "Usage:" line; check it before every review.
- Heavy commands only through `bash tools/heavy.sh --log <name> <command>`.

LIMITS
- Never deploy, never touch staging, production, Cloudflare, AWS, DNS, GitHub settings or secrets. Never push to main, never merge a PR, never turn on auto-merge.
- Never edit docs/12-status.md, docs/13-decisions.md, CHANGELOG.md, CLAUDE.md, `.claude/settings.json`, `.claude/agents/*` or memory. Put your decisions in the run file under "Lead decisions (for 13)", the CLAUDE.md lines you propose under "Proposed CLAUDE.md text", and leftovers under "Follow-ups (for 12)"; the main session copies them.
- Workflow files (.github/workflows/*) need the owner's yes: ask, don't change.
- No database migrations in this run. If your task turns out to need one, stop that item, record it under "Follow-ups (for 12)" and carry on with the rest.
- Worker budgets on main (#160): admin front 110,696 of 150,000; admin API 489,310 of 800,000; admin finance 646,479 of 800,000 (plan line 650,000); portal 119,256 of 120,000; jobs about 712,374 of 1,000,000. On the unmerged M6.4 branch `origin/feat/m6.4-paypal`: finance 701,805; portal 122,724 with its ceiling raised to 150,000; jobs 727,573. Write your branch's numbers in the run file. If your task would cross a ceiling or a plan line, stop that item and ask.
- Commit identity: TecHaust Technologies <admin@techaust.com> (repo-local). Conventional commits with PRD IDs. End every commit message with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>. Commit and push at least every 20 minutes and at each finished layer.

QUESTIONS FOR THE OWNER
- Do NOT use AskUserQuestion here. Write each question in the run file under "Questions for the owner" as multiple choice, the recommended option first and marked "(Recommended)", with plain-English context. New user-facing wording goes word for word into the copy file named in YOUR TASK as numbered lines with your recommendation; it counts as a question. Until approved, a new line shows "[Placeholder]" in code.
- Set "Status: WAITING ON OWNER (…)", commit, push, and KEEP WORKING on everything the question doesn't block. Only when nothing else can move, end your turn with the first line "WAITING ON OWNER: <session name>".
- The owner's answers arrive as messages from the main session; record each answer in the run file with the date.

FINISH
- Done = review APPROVE, every critical/high/medium/low finding fixed or kept with a reason, re-check passed, then `bash tools/heavy.sh --log check pnpm check` and `bash tools/heavy.sh --log test pnpm test` green on your branch tip (state the exact numbers). (A docs-only task: the reviewer's APPROVE and `pnpm check` are enough.)
- Before opening the PR, merge origin/main into your branch and re-run the checks.
- Open the PR: `bash tools/cloud-pr.sh --title "<conventional title with PRD IDs>" --body-file <file>`; the body says what changed, what ran and passed, what wasn't verified, the migrations and the Worker bytes, and ends with: 🤖 Generated with [Claude Code](https://claude.com/claude-code)
- Set "Status: PR READY <url>", push, and end your turn with the first line "PR READY: <url>" and a five-line summary. Stay open: the main session may send merge, renumbering or CI fixes, which you do on the same branch (set the Status line back to what you are doing, and to PR READY again when done).
- Stop every dev server you started before you end a turn.

YOUR TASK: write the reviewed build brief for the **fourth admin Worker**: split the admin finance Worker before M6.5 adds refunds and receipts to it (lead decision L32 of 2026-11-02 in `docs/runs/m6.4-paypal.md` on `origin/feat/m6.4-paypal`, not yet in docs/13; the owner chose this planning run on 2026-11-02: finance is at 701,805 of 800,000 bytes on the M6.4 branch, past the 650,000 plan line; CLAUDE.md "Worker budget": "a fourth admin Worker is planned when finance passes the 650,000 planBytes line"). **Planning only: a brief in your run file, no code, no configs, no migrations.**
- Session name: admin-split-plan. Branch: docs/admin-split-plan. Run file: docs/runs/admin-split-plan.md. Copy file: none (no user-facing wording; if the plan needs any, list it as a question).
- The owner's decisions that bind this task (never re-ask): one milestone at a time, approved on staging (CLAUDE.md hard rule 2); Free plan only, 10 ms CPU per invocation (hard rule 9; the $5 Workers Paid decision is still open with the owner, docs/12 "Next"); staging deploys build first then deploy one Worker per step in a fixed order (owner, 2026-10-30, CLAUDE.md "Staging deploys build first, then deploy"; the admin finance Worker was added to that order by the owner on 2026-10-31); the admin API is three Workers since M5.0/M6.1 (CLAUDE.md "The admin API is three Workers"); gateway keys live only on the finance Worker, jobs holds only webhook secrets (M6.2 L1, M6.4 Step 0); payments sandbox only (`PAYMENTS_LIVE_ALLOWED="false"`).
- Read first: CLAUDE.md "How the code fits together" (the admin API three-Worker paragraph, Worker budget, Staging deploys, Razorpay M6.2) and "Free plan"; `apps/admin/worker/{index,api,finance,app,forward,guard,routes-api,routes-finance}.ts`, `apps/admin/worker/split.test.ts`, `apps/admin/worker/warm-routes.ts`, `apps/admin/worker/gateway/**`, `apps/admin/wrangler*.jsonc`, `apps/jobs/wrangler.jsonc` and `apps/portal/wrangler.jsonc` (the `ADMIN_GATEWAY`, `ADMIN_JOBS`, `ADMIN_PAY` bindings), `scripts/worker-budget.mjs`, `scripts/check-worker-config.mjs`, `scripts/check-staging-build.mjs`, `scripts/staging-health.mjs`, `scripts/cpu-probe.mjs`, `.github/workflows/deploy-staging.yml`, `tools/set-gateway-keys.ps1`, `docs/runbooks/{environments,cpu-baseline,payment-gateways}.md`, `docs/runs/cpu-warmup.md`, `docs/runs/m6.1-ledger-payments.md` (how the third Worker was planned and built), and the briefs `docs/runs/m6.5-receipts-refunds.md`, `docs/runs/m7.1-portal.md`, `docs/runs/m7.3-reports.md` (what they will add to finance). Also read the **unmerged** M6.4 work, read-only: `git show origin/feat/m6.4-paypal:<path>` for `apps/admin/worker/gateway/paypal*.ts`, `apps/admin/worker/advices.ts`, `apps/admin/worker/finance.ts`, `apps/admin/worker/routes-finance.ts` and the end of `docs/runs/m6.4-paypal.md` (its bytes, L28, L31, the start-up dry run of the RPC entrypoints). The split is built **after M6.4 merges**, so plan against that state.
- Do:
  1. Measure: which modules make up finance's bytes (build admin on origin/main and on origin/feat/m6.4-paypal in your worktree, read the build metafile; through heavy.sh). Name the biggest groups.
  2. Choose the cut. Candidates: (a) a "gateway" Worker holding the Razorpay/Stripe/PayPal clients, settlement and the RPC entrypoints `GatewayEvents` and `PortalPayments`, with finance keeping invoices, ledger, reports; (b) invoices and notes in one Worker, payments and gateways in another; (c) another cut you find better. For each: bytes of each Worker after M6.4 and after M6.5 and M7.3 (estimate), start-up time, which routes and RPC methods move, which bindings change (jobs `ADMIN_GATEWAY`/`ADMIN_JOBS`, portal `ADMIN_PAY`, front forwarding), which secrets move (owner re-runs `set-gateway-keys.ps1` on the new Worker: a hosted step before the merge, PR held), D1/R2/queue bindings, the CPU first-call cost of an extra Worker hop, the warm-up dry run, and risks (a transaction or `mutate` batch that would have to span two Workers is a blocker). Recommend one.
  3. Write the brief for the builder in the run file in the shape of the existing milestone briefs (Tier, order and agents, Step 0 checks against the code as merged, data/core/API/config/scripts sections, tests, Free plan and bytes, done means, out of scope, risks, lead decisions, follow-ups). It must cover: new `wrangler.<name>.jsonc` with `env.staging` (no public URL in any scope, `workers_dev` off, preview URLs off), `scripts/check-worker-config.mjs` rules, `split.test.ts` ownership and parity, `worker-budget.mjs` entries and plan lines, `check-staging-build.mjs`, `staging-health.mjs`, `cpu-probe.mjs`, warm fixtures, `.env.example`/`.dev.vars.example`, `pnpm dev` and local Vite auxiliary Workers, the deploy order, `set-gateway-keys.ps1` targets, the runbooks.
  4. Questions for the owner: the `.github/workflows/deploy-staging.yml` change (a new deploy step in the fixed order) needs the owner's yes; any secret move (exact owner steps, click by click, with the `set-gateway-keys.ps1` lines); anything else only the owner can decide. Recommended option first.
- Tier B (Workers). Agents: one analyst drafts the measurements and the options; you write the final brief; then one reviewer checks the brief against the code (APPROVE or SEND BACK). No builder, no designer.
- Other work nearby: the PC is editing M6.4 on `feat/m6.4-paypal` (finance gateway files, portal and jobs Workers, admin SPA payments screens). Change no code at all; your only file is your run file.
- Merge order: docs only, merges first whenever ready; take origin/main in before the PR.
- Done means: the final brief in the run file with the reviewer's APPROVE, `pnpm check` green, the PR open with "Status: PR READY <url>".
```

## Orchestrator log (main session)
| Time (IST) | Session | Event | Action | Basis |
|---|---|---|---|---|
| 23:10 | admin-split-plan | requested from the desktop app | run.json written | SKILL.md step 4 |
| 23:45 | admin-split-plan | branch and run file pushed (Opus 5.5 high; review round 1 SEND BACK fixed by its lead); WAITING ON OWNER Q1 (deploy-staging.yml order) | asked the owner | SKILL.md step 7 |
| 23:47 | admin-split-plan | owner: Q1 A "New step, reordered (Recommended)" | sent word for word with `USAGE 24 at 2026-11-02T23:47+05:30` (sent stamped 00:20 by mistake; the clock was 23:47); cloud watcher armed | SKILL.md steps 4, 6, 7 |
| 23:52 | admin-split-plan | WAITING Q2 (staging rollback of the split) | owner: A "Yes, roll back, tell me after (Recommended)" (as M5.0's 2026-10-27 rule); sent word for word with `USAGE 25 at 2026-11-02T23:52+05:30` | SKILL.md step 7 |
| 23:56 | admin-split-plan | Q3 (deploy order after the split, for M6.5) | owner: A "Yes, move it in M6.5 (Recommended)"; sent word for word with `USAGE 26 at 2026-11-02T23:56+05:30` | SKILL.md step 7 |
| 23:58 | admin-split-plan | PR READY #163 | reviewed (below); auto-merge on; bound to this session; Auto-fix refused by the app (a PR the cloud session opened): the owner can turn it on from the PR bar | SKILL.md step 8 |
| 00:45 | admin-split-plan | #163 merged | the owner may archive the cloud session; watcher stopped | SKILL.md step 10 |

## PR reviews (main session)
| PR | Session | Verdicts in the run file | CI | Migrations | Workflows | Worker bytes | OPEN tags | Copy approved | Result |
|---|---|---|---|---|---|---|---|---|---|
| [#163](https://github.com/techaust/techaust_platform/pull/163) | admin-split-plan | review round 1 SEND BACK fixed; round 2 re-check APPROVE (0 critical/high; medium and lows fixed); Q1–Q3 answered | running at review (docs only) | none | none (the workflow change is M6.5's/the split's, approved Q1/Q3) | n/a (planning) | n/a | none | auto-merge on; **merged** (CI green) |

## Lessons

## Handover (main session)
One planning session requested; M6.4 continues on the PC.
