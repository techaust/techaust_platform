# Run: parallel cloud sessions, <YYYY-MM-DD>

Status: open
Tier: mixed (<tiers by task>)
Usage: <5-hour readings with IST times: start, each heartbeat, the peak, the reset>; main session claude-opus-5-5/high (`node tools/model-audit.mjs`); the cloud sessions' agents are recorded in their own run files.

<Who asked, when, in one paragraph: the owner's words, which tasks qualified (SKILL.md step 1), which stayed on the PC and why. Sessions start only from a message typed in the desktop app's Code tab, not over Remote Control.>

## Plan
| # | Session name | Task | Tier | Branch | Run file | Copy file | Migrations | Merges |
|---|---|---|---|---|---|---|---|---|
| 1 | `<name>` | <task> | <A/B/C> | `<branch>` | `docs/runs/<name>.md` | <07-… or none> | <none / after main's newest> | <1st> |

**Not started, and why:** <task: the eligibility test it fails (skips a milestone, migration clash, hosted change, runs on the PC by owner decision)>.

**Started:** <time IST>, environment `techaust_platform`, from `main` <short sha>; session ids <name: id, …>; first reading `USAGE <pct> at <ISO time>`.

## Shared rules (each prompt began with these)
<the filled-in block from .claude/skills/orchestrate/templates/shared-rules.md>

## Tasks
### Task 1: `<name>` (Tier <X>)
<the task block exactly as sent>

## Orchestrator log (main session)
| Time (IST) | Session | Event | Action | Basis |
|---|---|---|---|---|
| <HH:MM> | all | started from the desktop app | watcher armed (`node tools/watch-cloud.mjs`, newest copy only), heartbeat every 30 minutes | SKILL.md step 4 |

## PR reviews (main session)
| PR | Session | Verdicts in the run file | CI | Migrations | Workflows | Worker bytes | OPEN tags | Copy approved | Result |
|---|---|---|---|---|---|---|---|---|---|

## Lessons
- <what went wrong or right, and the rule it suggests; the main session moves accepted ones into the skill, CLAUDE.md and 13>

## Handover (main session)
<where the run stands and the next step; "continue" or `/orchestrate resume` starts here>
