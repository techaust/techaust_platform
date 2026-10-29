# 14: Models and usage

Which Claude model and effort level each task runs on, how the project is held to that, the budget gate the lead checks before starting any agent, and how usage is measured. First approved on 2026-10-08; replaced on 2026-10-12 (Opus, Sonnet and Haiku 5.5); **replaced again on 2026-10-29 by the owner: Opus 5.5 at high effort for every task, permanently, and the budget gate at 95 %** ([13-decisions.md](13-decisions.md)).

The plan is **Claude Team** (from 2026-10-26, owner): a 5-hour window, and a weekly limit only for Fable, which the project never uses. There is no weekly allowance for Opus.

## 1. Principles
- **One model, one effort: Opus 5.5 (`claude-opus-5-5`) at high**, for the lead and every agent, every tier and every step: briefs, builds, screens, reviews, fixes, re-checks, searches, test runs and doc edits (owner, 2026-10-29). The project settings and a hook enforce it (§6).
- **Quality is never cut to save usage.** The model and effort never change with usage; when usage runs high, the work slows down instead (§5).
- **Never used:**
  - Sonnet and Haiku (their aliases point at Opus 5.5);
  - Fable (any version, or the `fable` and `best` aliases);
  - effort `low`, `medium`, `xhigh` or `max`;
  - the built-in Explore, Plan, general-purpose and catch-all (`claude`) agents.

## 2. Tiers
The lead sets the tier when it writes the brief; the run file's `Tier:` line records it. A milestone's tier comes from its riskiest part. The tier decides **only which checks a task gets** (owner, 2026-10-29), never the model or the effort, which are the same for every tier:
- **Tiers A and B:** the analyst's early check of the build, before the designer starts.
- **Every tier:** a second review (the re-check) after any critical or high finding.

A designer step comes in whenever there are screens.

| Tier | What puts a task in it | Milestones ([09](09-roadmap.md)) |
|---|---|---|
| **A** | Code that computes or moves money (totals, tax, credit, ledgers, payments); client scoping (one client never sees another's data); staff login, sessions and step-up; deleting or anonymising data; any future AI feature that acts on data | M1.5, M1.6, M3.3, M3.5, M4.2, M4.3, M5.1–M5.5, M6.1–M6.5, M7.1, M7.4, M7.5 |
| **B** | State machines, permissions, queues and Workers, uploads, notifications | M2.4, M3.1, M3.2, M3.4, M4.1, M4.4, M4.5, M7.2, M7.3 |
| **C** | Screens and pages built from existing parts | M2.1, M2.2, M2.3, M2.5 |
| None (the lead, directly) | Documents, one-file fixes, merges, gate checks, Phase 7 launch steps (each approved by the owner) | — |

## 3. Who runs what
Every role below runs **Opus 5.5 at high**. The agent files name the model and effort. The lead may also pass `model: "opus"` and `effort: "high"` when it starts an agent, and nothing else.

| Role | Job |
|---|---|
| **Lead** (the main conversation) | Starting and ending the day, briefs, integration, merges, PRs, checking staging, talking to the owner. The owner picks **Opus 5.5, high** once in the app's picker; the project's `effortLevel` is `high`. A hook tells the lead its effort level on its first command (§6). If it isn't high, or the model isn't Opus 5.5, the lead says so in one line and does no other work until it is fixed. |
| `analyst` (read-only) | Tier A briefs, the early check of a Tier A or B build, merges whose migrations change a table, trigger, constraint or foreign key, failures nobody can explain, phase plans, legal and tax research drafts |
| `builder` | Data, schema, logic, API routes, jobs, and their fixes |
| `designer` | Designs and builds every screen, page, component, PDF layout, email template and social image, checks its own screenshots, and fixes screen findings |
| `reviewer` (changes no code) | Every review and every re-check: the code, plus a live visual review whenever there are screens |
| `code-finder` (read-only) | "Where is X", in place of the built-in Explore, Plan and general-purpose agents |
| `test-runner` | Runs one suite or check through `tools/heavy.sh --log` and reports only the failures |
| `doc-clerk` | Drafts CHANGELOG lines, the status page's tables and link fixes; the lead checks the diff before it is committed |

`code-finder`, `test-runner` and `doc-clerk` skip CLAUDE.md (`omitClaudeMd: true`), so each agent file repeats the hard rules that still apply to it. They never touch migrations, triggers, permissions, API routes, money, tax or payment logic, website copy, screens or reviews.

**Built-in agents:**
- `claude-code-guide`: only for questions about Claude Code itself.
- `statusline-setup`: only if the owner asks for a status line.
- Both run on Opus 5.5 through the aliases.
- Explore, Plan, general-purpose and `claude`: never. The hook refuses them.

A subagent can't start another subagent, so only the lead starts agents.

## 4. Getting it right the first time
- **A tight brief:** the exact files, contracts and tests; which layer is the builder's and which the designer's; what another task owns; when the task is done. The analyst drafts every Tier A brief; the lead checks it and writes the final one.
- **Design previews before the build** of the four surfaces everything else copies: the website shell (M2.1), the home page (M2.2), the admin shell (M3.1) and the client portal (M4.5; the full portal in M7.1 follows it). The designer builds them in Preview mode with labelled sample data on the local dev server and takes screenshots; the lead sends the screenshots to the owner, and the build starts only after the owner approves. Each approval is a [13-decisions.md](13-decisions.md) row.
- **The order inside a task:**
  1. `builder`: schema, migrations, logic, API routes, with tests
  2. Tiers A and B: `analyst` checks that diff (**GO** or **CHANGE**); on CHANGE the lead resumes the builder
  3. `designer`: the screens on top, with its own visual check
  4. `reviewer`: the code and the visual review
  5. fixes: logic findings to the builder, screen findings to the designer; then the re-check

  A task with only screens (most of Tier C) skips steps 1 and 2. A task with no screens skips step 3.
- **Handing a branch from the builder to the designer:** git won't check out one branch in two worktrees. Once the builder has finished, remove its worktree (`git worktree remove`; the branch and its commits stay), then start the designer (`isolation: "worktree"`), which checks out the task branch. Restarting a stopped agent works the same way, or resume it with SendMessage if it is still reachable.
- **Browser agents:** the designer and the reviewer use the Playwright browser and the dev-server ports. On this PC, only one runs at a time. A cloud session may run two (§5) only once each one has its own dev-server ports and its own browser server; for now it runs one (below).
  - **Ports (built, CLOUD-1):** the first browser agent runs its dev servers with `TECHAUST_PORT_OFFSET=0` (the default), the second with `TECHAUST_PORT_OFFSET=100` (`scripts/dev-ports.mjs`: every dev, browser-test and inspector port moves by 100, with a dev registry of its own). The brief names the offset.
  - **One browser per server:** the cloud browser is the one `playwright` server in `.mcp.json`, and one server is one browser with one tab, shared by every agent of the session; cookies ignore ports, so two agents on different ports would still share each other's sign-ins. A second browser agent needs a server of its own (a `playwright-2` entry, or `mcpServers` in that agent's frontmatter, each with its own `--output-dir`). Until a task builds that, a cloud session runs **one browser agent** (`tools/agent-slots.mjs` holds the cloud browser limit at 1).
  - **Own worktree:** each browser agent works in its own git worktree, which also gives it its own local database (the `--persist-to` state lives in the worktree's `.wrangler/state`; it isn't tied to the port offset).
- **Commits as it goes:** at least every 20 minutes and at each finished layer or screen, so a stopped agent loses nothing.
- **Severity triage:** critical and high findings are fixed before the merge. Medium and low findings are fixed in the same task too (lead practice since M2.2), unless they belong to a later milestone (then a listed follow-up in [12-status.md](12-status.md)) or the lead keeps one with a reason in the run file.
- **`main` taken early:** if `main` has moved since the task branched, the lead merges it into the task before the review, not after. If the task's migrations change a table, trigger, constraint or foreign key, the analyst plans that merge first. **Analyst gate for migrations:** the analyst also confirms that no migration rebuilds (drops, or copies through `__new_…`) a table other tables reference; `scripts/check-migrations.mjs` fails CI for any such migration after 0006, and the only way past it is the analyst's written check plus an entry (with the reason) in `scripts/migration-rebuild-allowlist.json`.

## 5. The budget gate and how many agents run
Before starting **any** agent, the lead runs `node tools/agent-slots.mjs --running <n> --browsers <n> [--browser] --usage <pct>` (owner, 2026-10-29). It prints "start: yes" or "start: no" with the reason, and a test pins its rules (`apps/web/test/agent-slots.test.ts`). **Every agent counts**, the helpers (`code-finder`, `test-runner`, `doc-clerk`) too.

### The budget gate (on the Team plan, only the 5-hour window counts; there is no weekly pace)
| Reading | What happens |
|---|---|
| The 5-hour bar **at or under 95 %** | New agents may start, within the limits below |
| **Over 95 %** | Nothing new starts until the window resets. Running agents keep going and save their work as they go (commits at least every 20 minutes) |
| **This PC can't read the bar** | One agent at a time, and the lead says so |

**A cloud session** reads the bar itself when it can. When it can't, it uses the reading posted in [runs/usage-reading.md](runs/usage-reading.md) on its branch:
- **No reading posted for today (IST):** nothing new starts.
- **A reading over 2 hours old:** one agent at a time.
- **A reading over 95 %:** nothing new starts.

The local lead (or the owner) posts the reading: the percentage and the time, as the file shows.

### How many agents at once
| Where | Agents at once | Browser agents | Before each start |
|---|---|---|---|
| **This PC** (8 GB, 4 processors) | at most **2** | at most **1** | free memory at least **300 MB** |
| **A cloud session** (its virtual machine) | at most **5** | at most **2** (§4: each with its own ports and browser server); **1** until a second browser server exists | at least **3 GB** free memory, and the 1-minute load average under **80 %** of its processors |

**Heavy commands** (the full lint, typecheck, builds, the database and end-to-end suites) still take turns, one at a time per machine, through `tools/heavy.sh`, both here and in a cloud session.

The gate and the limits change **how much runs at once, never the model or the effort.** If a weekly limit for Opus ever appears in the reading, the lead tells the owner before relying on this section.

**The day runs in up to three 5-hour windows**, with the expensive work at a window's start:
1. starting the day, the brief or the review triage, and the builder or designer
2. the review and its fixes
3. integration, checking staging, and ending the day

## 6. Keeping to Opus 5.5 at high
Each lock covers the others' gaps. The locks were first tested on 2026-10-12 on Claude Code 2.1.295 (three models), and narrowed to Opus at high on 2026-10-29.

| Lock | What it does | Tested |
|---|---|---|
| `.claude/settings.json` → `env` | Points every alias at Opus 5.5 (`opus`, `sonnet` and `haiku` → `claude-opus-5-5`), including Claude Code's background tasks and built-in agents. A new Anthropic model changes nothing here. | (2026-10-12) an agent started with no model ran on the aliased model |
| `.claude/settings.json` → `availableModels`, `effortLevel` | Allows only `claude-opus-5-5` for the main conversation, agents and skills; the project's effort is `high` | (2026-10-12) a run asked for Fable ran on Opus 5.5 instead |
| Agent files | Each names `model: claude-opus-5-5` and `effort: high` | All seven agents |
| `tools/model-guard.mjs` (a `PreToolUse` hook on Agent and Bash) | Refuses an agent on any model but Opus 5.5, at any effort but high, of a built-in Explore, Plan, general-purpose or `claude` type, or with no `subagent_type`. Tells the lead its effort level on its first command and whenever it changes | `apps/web/test/model-guard.test.ts` |
| The lead's own check | The lead knows its model from the moment a conversation opens and its effort from the hook; if either is off it stops and tells the owner | — |
| `node tools/model-audit.mjs [date]` | Lists every run since the date with the model and effort from its own log, and flags anything but Opus 5.5 at high (runs before 2026-10-29 followed the older plan). The end-of-day routine runs it | Flagged the 2026-10-08 Haiku 4.5 test runs |

- **Claude Code 2.1.293 or later** is required. The app runs 2.1.295 or later.
- **`CLAUDE_CODE_EFFORT_LEVEL` stays unset on this PC:** the agent files and `effortLevel` already give high everywhere. **Cloud exception:** the claude.ai environment sets `CLAUDE_CODE_EFFORT_LEVEL=high` ([runbooks/cloud-sessions.md](runbooks/cloud-sessions.md) Part 2), the same level, as a second hold there besides the project's `effortLevel`.
- **A new model from Anthropic** is a question for the owner; nothing changes until the owner approves it and a [13-decisions.md](13-decisions.md) row records it.

## 7. Habits that save usage without touching quality
- **Each agent's tools are a fixed list:**
  - builder: the file tools, Bash and PowerShell, Skill, tool search and Context7
  - designer: the same, plus the Playwright browser tools
  - reviewer: read-only tools, Bash, and the Playwright browser tools
  - analyst: read-only tools and Bash
  - none of them get other connectors (AWS, Supabase, Cloudflare, GitHub)
- **Long output goes to a log file:** `bash tools/heavy.sh --log <name> <command>` writes `.logs/<name>.log` (git-ignored) and prints only the exit code and the last 40 lines. Agents grep the log for more; they never read the whole log. Screenshots go to `.logs/shots/` (git-ignored).
- **The reviewer reads the diff** and opens a whole file only where the diff points to it.
- **One lead conversation per step of a task** (the brief, the review triage, the integration), closed with a handover in the run file. The owner opens the next one with "continue". The prompt cache lasts an hour, so a conversation left idle longer pays to read its whole context again.
- **No progress check-ins** while agents run.

## 8. Measuring
- Each agent run records its model, effort and the 5-hour percentage at its start and end in the run file's `Usage:` line. The model and effort are copied from `node tools/model-audit.mjs`, not from what was intended.
- **Every evening** the end-of-day routine runs `node tools/model-audit.mjs` for the day. Anything flagged goes to the owner in the day's summary.
- **Usage reports:** the lead reports the 5-hour readings per kind of run in the end-of-day summary, and whenever the owner asks. The model and effort never change for usage; only how much runs at once changes (§5). Earlier report: [2026-10-23](14-models-and-usage-appendix/cost-report-2026-10-23.md).

## 9. Skills (mandatory, owner rule 2026-10-22)
Every run, the lead's and every agent's, loads **every skill that fits its task** before it starts work, and its report lists them. The owner never has to ask. `node tools/model-audit.mjs` lists the skills each run loaded and flags a builder, designer, analyst or reviewer run that loaded none; the lead checks it before every review and records the skills in the run file's `Usage:` line. A skill that doesn't apply is skipped and the report says why; a skill that can't run inside an agent is reported, not silently dropped.

| Task | Skills to load |
|---|---|
| Any screen, page, component, email template, PDF layout, social or brand image (designer) | `frontend-design:frontend-design`; `dataviz` for any chart, stat tile or dashboard |
| Worker code, Hono routes, D1/Drizzle, queues, cron, bindings, `wrangler.jsonc` (builder; analyst for Tier A) | `cloudflare:workers-best-practices`, `cloudflare:wrangler` |
| CPU budgets, cold starts, benchmarks (builder, analyst, lead) | `cloudflare:workers-profiling` |
| Website performance, headers, caching, Lighthouse, SEO (M2.x) | `cloudflare:web-perf` |
| Cloudflare platform features: Access, Workers Logs, Rate Limiting, WAF, Turnstile, Browser Run, R2, Queues (any role) | `cloudflare:cloudflare`; Turnstile also `cloudflare:turnstile-spin` |
| SES email, IAM users and policies (M2.4, M7.2) | `aws-messaging-and-streaming` (routes to SES), `aws-iam` (named `aws-core:…` before the Team plan) |
| Every review (reviewer) | `code-review` (as the review recipe, findings verified by the reviewer); also `security-review` for Tier A, auth, payments, webhooks and anything public-facing |
| Starting and ending a day (lead) | `start-session`, `end-session` |
| A page or report for the owner to view or share (lead) | `artifact-design` |

Analyst and reviewer agents have the Skill tool for this. If a new skill appears that fits a task better, the lead adds it here (a Lead row in 13).

**Skill-spawned helpers (owner decision 2026-10-22: allowed):** when an agent loads `code-review` or `security-review`, the skill may start its own helper run of the built-in `general-purpose` type. These helpers are allowed as an exception to §3's "built-in agents are never used", on two conditions: they only read (no edits, commits, pushes, PR comments or hosted actions; the agent that loaded the skill discards anything else), and they run on Opus 5.5 (the aliases point every model there). `tools/model-audit.mjs` lists them as `general-purpose` rows; the lead checks their models like any other run. The lead and agents still never start a built-in agent themselves.
