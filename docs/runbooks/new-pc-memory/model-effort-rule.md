---
name: model-effort-rule
description: "Owner 2026-10-29, permanent: every task (lead + all agents, every tier/step) on Opus 5.5 at high; Sonnet/Haiku aliases point at Opus; budget gate 95 % of the 5-hour window; enforced by settings + model-guard hook + model-audit (PR #109)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0664937f-cda0-4895-9897-43b67a94c781
  modified: 2026-10-29T16:10:08.445Z
---

The full plan is `docs/14-models-and-usage.md`; CLAUDE.md "How work is split" holds the rules. On 2026-10-29 the owner made it permanent (PR #109): **Opus 5.5 (`claude-opus-5-5`) at high effort for every task**. This replaces the 2026-10-12 three-model plan (Sonnet builders, Haiku helpers, lead at medium). The owner insists on "10/10 on every aspect": prove claims with tests before presenting them, and be honest about anything unproven.

**Who runs what:** everyone runs Opus 5.5 at high.
- **The lead:** if the model or effort is off, say so in one line ("Please pick Opus 5.5, high in the model menu") and do no other work.
- **analyst** (read-only): briefs, Tier A early checks, risky merges, research drafts.
- **builder:** data, logic and API.
- **designer:** every screen.
- **reviewer:** every review and re-check, with a live visual review whenever there are screens.
- **code-finder, test-runner, doc-clerk:** search, test runs, doc edits.

Tiers decide the steps (an analyst check for Tier A, a designer step when there are screens), never the model or the effort.

**Never used:** Sonnet, Haiku, Fable, any effort but high, or the built-in Explore, Plan, general-purpose or `claude` agents. Exception: the read-only helper the code-review and security-review skills start themselves (owner, 2026-10-22). It starts through the Skill tool, so the guard never sees it.

**Order inside a task:** builder → analyst early check (Tier A) → designer → reviewer → fixes → re-check. Remove the builder's worktree before the designer starts. Never run two browser-using agents at once, and at most two agents in total (8 GB RAM).

**Enforcement:**
- `.claude/settings.json`: all aliases point at `claude-opus-5-5`, `availableModels` lists only it, and `effortLevel` is high.
- `tools/model-guard.mjs` (a hook on Agent and Bash): refuses any other model or effort, banned built-ins, and calls with no `subagent_type`; reports "Lead effort level: X".
- `node tools/model-audit.mjs [date]`: flags anything but Opus at high. Runs before 2026-10-29 followed the old plan.

**Budget gate** (owner, 2026-10-29, PR #111): only the 5-hour window counts.
- **At or under 95 %:** new agents start.
- **Over 95 %:** nothing new starts. Running agents keep going and save their work.
- **This PC can't read the bar:** one agent at a time.
- **A cloud session that can't read the bar:** use `docs/runs/usage-reading.md`. With no reading today (IST), nothing new starts. With a reading over 2 hours old, one at a time.

**Agents at once:** every agent counts, the helpers too.
- **This PC:** at most 2, at most 1 browser, and none while free memory is under 300 MB.
- **A cloud session:** up to 5, at most 2 browser (each with its own ports; until that's built, 1). Another starts while ≥ 3 GB is free and the 1-minute load is under 80 % of cores.
- Heavy commands take turns on both.
- `node tools/agent-slots.mjs --running N --browsers N [--browser] --usage PCT [--cloud]` decides each start.

**Tiers decide only the checks:** the analyst's early check for Tiers A and B, and a second review after any critical or high finding.

None of this ever changes the model or the effort.

**Why:** the owner wants the best quality everywhere and accepts the usage cost.

**How to apply:**
- Read `get_usage` before any agent.
- Pass `model: "opus"` and `effort: "high"` when starting agents. This is needed until a new conversation loads the updated agent files.
- Copy the model and effort into the `Usage:` lines from the audit, not from what was intended.
- A new Anthropic model is a question for the owner.

**Gotchas:**
- Agent files load only in new conversations; settings and hook changes hot-reload.
- Test headless with the app's binary or the npm CLI.
- The Playwright MCP blocks `file:` URLs.
- Windows Smart App Control was turned off on 2026-10-12. If pnpm or Biome fail with "Application Control policy has blocked this file", tell the owner; never change it yourself.

Related: [[record-and-daily-sessions]], [[working-with-owner]], [[full-audit-m1-m5]]
