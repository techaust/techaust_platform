# 14: Models and usage

Which Claude model and effort level each task runs on, how the project is held to those models, the budget gate the lead checks before starting any agent, and how usage is measured. First approved on 2026-10-08; **replaced on 2026-10-12** by the owner's plan: only Opus 5.5, Sonnet 5.5 and Haiku 5.5, with Opus designing and building every screen ([13-decisions.md](13-decisions.md)).

The plan is **Claude Team** (from 2026-10-26, owner): a 5-hour window, and a weekly limit only for Fable, which the project never uses. There is no weekly allowance for Opus, Sonnet or Haiku. (Until 2026-10-26 the plan was Claude Max 5x, with one weekly allowance shared by every model.)

## 1. Principles
- **Three models only:** Opus 5.5, Sonnet 5.5 and Haiku 5.5. The project settings and a hook enforce it (§6).
- **Opus wherever judgement or taste decides the result:** the lead, the hard analysis, every screen (designed and built), every review. **Sonnet** builds data, logic, API routes and jobs. **Haiku** does the mechanical work.
- **Quality is never cut to save usage.** The effort levels in §3 don't change with usage; when usage runs high, the work slows down instead (§5).
- **The lead stays on Opus 5.5 at medium, all day.** The owner never switches the picker. Thinking that needs high effort goes to the `analyst` agent, so only that part runs at high.
- **Never used:** Fable (any version, or the `fable` and `best` aliases), effort `xhigh` or `max`, Opus building data or logic, and the built-in Explore, Plan, general-purpose and catch-all (`claude`) agents.

## 2. Tiers
The lead sets the tier when it writes the brief; the run file's `Tier:` line records it. A milestone's tier comes from its riskiest part.

| Tier | What puts a task in it | Milestones ([09](09-roadmap.md)) |
|---|---|---|
| **A** | Code that computes or moves money (totals, tax, credit, ledgers, payments); client scoping (one client never sees another's data); staff login, sessions and step-up; deleting or anonymising data; any future AI feature that acts on data | M1.5, M1.6, M3.3, M3.5, M4.2, M4.3, M5.1–M5.5, M6.1–M6.5, M7.1, M7.4, M7.5 |
| **B** | State machines, permissions, queues and Workers, uploads, notifications | M2.4, M3.1, M3.2, M3.4, M4.1, M4.4, M4.5, M7.2, M7.3 |
| **C** | Screens and pages built from existing parts | M2.1, M2.2, M2.3, M2.5 |
| None (the lead, directly) | Finishing M1.4 (built; waits on "Access is on"), documents, one-file fixes, merges, gate checks, Phase 7 launch steps (each approved by the owner) | — |

## 3. Who runs what

### The lead
**Opus 5.5 at medium for every step:** starting the day, briefs, integration, PRs, checking staging, talking to the owner, ending the day. The owner picks it once in the app's picker; the project's `effortLevel` is `medium`. A hook tells the lead its effort level on its first command (§6); if it isn't medium, or the model isn't Opus 5.5, the lead says so in one line and does no other work until the owner fixes it.

### Agents
The lead passes the model and effort for the task when it starts the agent (the Agent tool's `model` and `effort`). The agent files hold the defaults and name the exact model.

| Work | Agent and model | Tier A | Tier B | Tier C |
|---|---|---|---|---|
| Hard thinking: a Tier A brief, the early check of a Tier A build, a merge whose migrations change a table, trigger, constraint or foreign key, a failure nobody can explain, a phase plan | `analyst`, Opus 5.5 | high | high | high |
| Data, schema, logic, API routes, jobs | `builder`, Sonnet 5.5 | high | medium | medium |
| Screens, pages, components, PDF layouts, email templates, social images (designed and built) | `designer`, Opus 5.5 | high | high | high |
| Finish the checks after a stop | the same agent | medium | medium | medium |
| Fix findings in data or logic | `builder`, Sonnet 5.5 | medium (high if any finding is critical) | medium | low |
| Fix findings in screens | `designer`, Opus 5.5 | medium | medium | medium |
| Review: code, plus a visual review whenever there are screens | `reviewer`, Opus 5.5 | high | high | high |
| Re-check the fix diff only | `reviewer`, Opus 5.5 | medium | medium | medium |

### Haiku agents
They run **Haiku 5.5** (`claude-haiku-5-5`) and skip CLAUDE.md (`omitClaudeMd: true`), so each agent file repeats the hard rules that still apply to it. They **never** touch migrations, triggers, permissions, API routes, money, tax or payment logic, website copy (`apps/web/src/content`, [07](07-content.md)), screens or reviews.

| Agent | Effort | Job |
|---|---|---|
| `code-finder` | low | Answers "where is X" (read-only), in place of the built-in Explore, Plan and general-purpose agents |
| `test-runner` | low | Runs one suite or check through `tools/heavy.sh --log` and reports only the failures |
| `doc-clerk` | medium | Drafts CHANGELOG lines, the status page's tables and link fixes. The lead checks the diff before it is committed |

### Built-in agents
- `claude-code-guide` (Haiku 5.5): only for questions about Claude Code itself.
- `statusline-setup` (Sonnet 5.5): only if the owner asks for a status line.
- Explore, Plan, general-purpose and `claude`: never. The hook refuses them.

A subagent can't start another subagent, so builders and designers read their own logs (§7) and only the lead starts agents.

## 4. Getting it right the first time
- **A tight brief:** the exact files, contracts and tests; which layer is the builder's and which the designer's; what another task owns; when the task is done. The analyst drafts every Tier A brief; the lead checks it and writes the final one.
- **Design previews before the build** of the four surfaces everything else copies: the website shell (M2.1), the home page (M2.2), the admin shell (M3.1) and the client portal (M4.5; the full portal in M7.1 follows it). The designer builds them in Preview mode with labelled sample data on the local dev server and takes screenshots; the lead sends the screenshots to the owner, and the build starts only after the owner approves. Each approval is a [13-decisions.md](13-decisions.md) row.
- **The order inside a task:**
  1. `builder`: schema, migrations, logic, API routes, with tests
  2. Tier A: `analyst` checks that diff (**GO** or **CHANGE**); on CHANGE the lead resumes the builder
  3. `designer`: the screens on top, with its own visual check
  4. `reviewer`: the code and the visual review
  5. fixes: logic findings to the builder, screen findings to the designer; then the re-check

  A task with only screens (most of Tier C) skips steps 1 and 2. A task with no screens skips step 3.
- **Handing a branch from the builder to the designer:** git won't check out one branch in two worktrees. Once the builder has finished, remove its worktree (`git worktree remove`; the branch and its commits stay), then start the designer (`isolation: "worktree"`), which checks out the task branch. Restarting a stopped agent works the same way, or resume it with SendMessage if it is still reachable.
- **One browser user at a time:** the designer and the reviewer share the Playwright browser and the dev-server ports, so the lead never runs two of them at once.
- **Commits as it goes:** at least every 20 minutes and at each finished layer or screen, so a stopped agent loses nothing.
- **Severity triage:** critical and high findings are fixed before the merge. Medium and low ones become follow-ups in [12-status.md](12-status.md), unless they are a one-line fix.
- **`main` taken early:** if `main` has moved since the task branched, the lead merges it into the task before the review, not after. If the task's migrations change a table, trigger, constraint or foreign key, the analyst plans that merge first. **Analyst gate for migrations:** the analyst also confirms that no migration rebuilds (drops, or copies through `__new_…`) a table other tables reference; `scripts/check-migrations.mjs` fails CI for any such migration after 0006, and the only way past it is the analyst's written check plus an entry (with the reason) in `scripts/migration-rebuild-allowlist.json`.

## 5. The budget gate
Before starting any agent, the lead reads the usage (the `get_usage` session tool: "5-hour limit"). On the Team plan only the 5-hour window gates the work (owner, 2026-10-26); there is no weekly pace. If a weekly limit for the models we use ever appears in the reading, the lead tells the owner before relying on this table.

| Reading | What runs |
|---|---|
| The 5-hour window at or under 50 % | Up to two agents at once (the 8 GB RAM limit), never two browser users (owner exception 2026-10-26: three until the M3.4–M4.5 batch ends; docs/13) |
| The 5-hour window over 50 % | No new builder or designer; a review, an analyst or a running agent may continue |
| The 5-hour window at 75 % or more | Nothing new starts until it resets |
| The usage can't be read | One agent at a time, and say so |

The gate changes **how much runs at once, never the model or the effort.**

**The day runs in up to three 5-hour windows**, with the expensive work at a window's start:
1. starting the day, the brief or the review triage, and the builder or designer
2. the review and its fixes
3. integration, checking staging, and ending the day

## 6. Keeping to the three models
Each lock covers the others' gaps. All were tested on 2026-10-12 on Claude Code 2.1.295.

| Lock | What it does | Tested |
|---|---|---|
| `.claude/settings.json` → `env` | Pins the aliases: `opus` → `claude-opus-5-5`, `sonnet` → `claude-sonnet-5-5`, `haiku` → `claude-haiku-5-5`, including Claude Code's background tasks. A new Anthropic model changes nothing here. | An agent started with no model ran on `claude-haiku-5-5` |
| `.claude/settings.json` → `availableModels` | Allows only the three model IDs for the main conversation, agents and skills | A run asked for Fable ran on Opus 5.5 instead; without the list, the same request ran on Fable 5.1 |
| Agent files | Each names its exact model ID | All six agents |
| `tools/model-guard.mjs` (a `PreToolUse` hook on Agent and Bash) | Refuses an agent on any other model, at effort `xhigh` or `max`, or of a built-in Explore, Plan, general-purpose or `claude` type; tells the lead its effort level on its first command and whenever it changes | A Fable agent and a `max`-effort agent were refused; the lead was told its effort level |
| The lead's own check | The lead knows its model from the moment a conversation opens and its effort from the hook; if either is off it stops and tells the owner | — |
| `node tools/model-audit.mjs [date]` | Lists every run since the date with the model and effort from its own log, and flags anything outside this plan. The end-of-day routine runs it | Flagged the 2026-10-08 Haiku 4.5 test runs |

- **Claude Code 2.1.293 or later** is required (Haiku 5.5). The app runs 2.1.295; the stand-alone command-line copy was updated to 2.1.295 on 2026-10-12.
- **`CLAUDE_CODE_EFFORT_LEVEL` stays unset:** it would override every agent's effort.
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
- In the first full week (from Monday 12 Oct 2026) only one agent runs at a time, so each reading belongs to one run.
- **Quality guard:** if a Tier B or C task gets a critical finding, or is sent back twice, that tier's builder or designer fix effort goes up one step for the next task, at most to high. The lead records it as a [13-decisions.md](13-decisions.md) row and tells the owner.
- **The cost report:** after the first Tier A build, the first designer task and the first two Tier B reviews, the lead reports the cost of each kind of run (against the 5-hour window since the Team plan). Effort levels change only with the owner's approval, and never downwards for Tier A work, screens or reviews. Reports: [2026-10-23](14-models-and-usage-appendix/cost-report-2026-10-23.md) (no change recommended; next after M3.1).

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

**Skill-spawned helpers (owner decision 2026-10-22: allowed):** when an agent loads `code-review` or `security-review`, the skill may start its own helper run of the built-in `general-purpose` type. These helpers are allowed as an exception to §3's "built-in agents are never used", on two conditions: they only read (no edits, commits, pushes, PR comments or hosted actions; the agent that loaded the skill discards anything else), and they run on an allowed model (Opus or Sonnet 5.5, never Fable, effort low–high). `tools/model-audit.mjs` lists them as `general-purpose` rows; the lead checks their models like any other run. The lead and agents still never start a built-in agent themselves.
