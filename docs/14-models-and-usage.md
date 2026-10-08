# 14: Models and usage

Which Claude model and effort level each task runs on, the budget gate the lead checks before starting any agent, and how usage is measured. Approved by the owner on **2026-10-08** ([13-decisions.md](13-decisions.md)); adapted to this project's milestones and agents.

The plan is **Claude Max** (5x, per the owner): one weekly allowance shared by every model, reset each **Monday at 10:00 UTC (15:30 IST)**, plus a 5-hour window.

## 1. Principles
- **Sonnet builds, Opus checks, Haiku does the mechanical work.** Rework costs more than any model choice, so Opus reasoning goes where a defect is expensive, and cheap checks come early.
- **The lead runs all day, so its setting matters most:** Opus at medium, raised to high for one named task at a time, never as the day's setting.
- **Not used routinely:** Opus at xhigh or max, and Opus as a builder.

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
The owner sets the lead's model and effort in the app's picker. The lead says when a switch is worth it, and asks to switch back after the task.

| Task | Model and effort |
|---|---|
| Starting the day, each new conversation, starting agents, PRs, routine integration, checking staging after a merge, ending the day | **Opus 5.5, medium** |
| A Tier A brief; merging `main` into a task whose migrations change a table, trigger, constraint or foreign key; a failure nobody can explain; planning a phase | Opus 5.5, **high**, for that task only |

### Agents per task
The lead passes the model and effort for the task's tier when it starts the agent (the Agent tool's `model` and `effort`). The agent files hold the defaults: `builder` Sonnet at medium, `reviewer` Opus at high.

| Work | Tier A | Tier B | Tier C |
|---|---|---|---|
| Build (`builder`) | Sonnet, high | Sonnet, medium | Sonnet, medium |
| Finish the checks after a stop (`builder`) | Sonnet, medium | Sonnet, medium | Sonnet, medium |
| Review (`reviewer`) | Opus, high | Opus, high (medium while over the pace, §5) | Opus, medium |
| Fix the findings (`builder`) | Sonnet, medium | Sonnet, medium | Sonnet, low |
| Re-check the fix diff only (`reviewer`) | Opus, medium | Opus, medium | the lead reads it |

### Haiku agents
They skip CLAUDE.md (`omitClaudeMd: true`), so each agent file repeats the hard rules that still apply to it. Their files use the `haiku` alias, which on Claude Code 2.1.288 runs **Haiku 4.5** (`sonnet` and `opus` run the 5.5 models; checked 2026-10-08). Haiku 5.5 answers when named in full, but this Claude Code version flags it as an unrecognised model, so the alias stays until it is recognised. They **never** touch migrations, triggers, permissions, API routes, money, tax or payment logic, website copy (`apps/web/src/content`, [07](07-content.md)) or reviews.

| Agent | Effort | Job |
|---|---|---|
| `code-finder` | low | Answers "where is X" (read-only). The lead uses it instead of the built-in Explore, Plan and general-purpose agents, which run on Opus on this plan. `claude-code-guide` is used only for questions about Claude Code itself. |
| `test-runner` | low | Runs one suite or check through `tools/heavy.sh --log` and reports only the failures |
| `doc-clerk` | medium | Drafts CHANGELOG lines, the status page's tables and link fixes. The lead checks the diff before it is committed |

A subagent can't start another subagent, so builders read their own logs (§6) and only the lead uses the Haiku agents.

## 4. Getting it right the first time
- **A tight brief:** the exact files, contracts and tests, what another task owns, and when the task is done.
- **An early check on Tier A:** when the builder has the schema, migrations, core logic and API routes, it commits, reports and stops. The lead reads that diff (Opus, medium), then resumes the same builder (SendMessage) for the screens.
- **Commits as it goes:** at least every 20 minutes and at each finished layer, so a stopped builder loses nothing.
- **Severity triage:** critical and high findings are fixed before the merge. Medium and low ones become follow-ups in [12-status.md](12-status.md), unless they are a one-line fix.
- **`main` taken early:** if `main` has moved since the task branched, the lead merges it into the task before the review, not after.
- **Restarting a stopped builder:** resume it with SendMessage if it is still reachable. Otherwise remove its worktree (`git worktree remove`; the branch and its commits stay), then start a new builder that checks out that branch. Git won't check out one branch in two worktrees.

## 5. The budget gate
Before starting any agent, the lead reads the usage (the `get_usage` session tool: "Weekly · all models" and "5-hour limit").

**The pace** = 14 % × days since the last reset (fractional). Example: Thursday 14:45 IST is about 2.97 days after Monday 15:30 IST, so the pace is about 42 %.

| Reading | What runs |
|---|---|
| Weekly at or under the pace, and the 5-hour window at or under 50 % | Up to two agents at once (the 8 GB RAM limit) |
| Weekly over the pace | One agent at a time; Tier B reviews at medium |
| Weekly at 85 % or more | No new build; only finishing, reviewing and merging what is in flight |
| The 5-hour window over 50 % | No new builder; a review or a running agent may continue |
| The 5-hour window at 75 % or more | Nothing new starts until it resets |
| The usage can't be read | Treat it as "over the pace" and say so |

**The day runs in up to three 5-hour windows**, with the expensive work at a window's start:
1. starting the day, the brief or the review triage, and the builder
2. the review and its fixes
3. integration, checking staging, and ending the day

## 6. Habits that save usage on any model
- **The builder's tools are a fixed list:** the file tools, Bash and PowerShell, Skill, tool search and Context7. No other connectors (no AWS, Supabase, Cloudflare, GitHub or browser tools).
- **Long output goes to a log file:** `bash tools/heavy.sh --log <name> <command>` writes `.logs/<name>.log` (git-ignored) and prints only the exit code and the last 40 lines. Agents grep the log for more; they never read the whole log.
- **The reviewer reads the diff** and opens a whole file only where the diff points to it.
- **One lead conversation per step of a task** (the brief, the review triage, the integration), closed with a handover in the run file. The owner opens the next one with "continue". The prompt cache lasts an hour, so a conversation left idle longer pays to read its whole context again.
- **No progress check-ins** while agents run.

## 7. Measuring
- Each agent run records its model, effort and the weekly and 5-hour percentages at its start and end in the run file's `Usage:` line.
- In the first full week (from Monday 12 Oct 2026) only one agent runs at a time, so each reading belongs to one run.
- After the first Tier A build and the first two Tier B reviews, the lead compares each tier's cost with the pace and proposes at most two adjustments; the owner's choice becomes a [13-decisions.md](13-decisions.md) row.
- If the measured pace is still over 14 % a day, the next lever is the lead on Sonnet at medium on days of pure operations (merging, checking staging, documents).
