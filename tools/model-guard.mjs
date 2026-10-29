// Claude Code hook (PreToolUse, matcher "Agent|Bash"), wired in .claude/settings.json.
// Enforces docs/14-models-and-usage.md §6:
// - Agent: refuses a model other than Opus 5.5, an effort other than high (owner, 2026-10-29: Opus 5.5 at high for every task),
//   and the built-in
//   Explore, Plan, general-purpose and catch-all agents (they run on the lead's Opus), named in any case, and a call with
//   no subagent_type at all (that starts general-purpose). Tested by apps/web/test/model-guard.test.ts.
// - Bash in the lead's own conversation: tells the lead its effort level the first time and whenever
//   it changes, so the start-of-day check can confirm "high".
// - Bash in a Claude Code cloud session only (CLAUDE_CODE_REMOTE === "true", which Claude Code sets there and never on this PC;
//   CLOUD-1): refuses merging, deploying, force-pushing or deleting branches, pushing to main, and changing GitHub or Cloudflare
//   settings (gh pr merge|ready, gh workflow run, gh run rerun|cancel, gh secret|variable, gh api other than GET or opening or
//   commenting on a PR, git push --force/--delete/":" refspecs/main, wrangler deploy|secret|versions|rollback|login|… and
//   --remote, the deploy:* scripts). The patterns live in tools/cloud-guard.mjs, loaded only then. Best effort: a script can get
//   round a pattern; CLAUDE.md "In a cloud session" stays the rule.
// Prints nothing when there is nothing to say. On this PC it never blocks Bash and starts nothing new.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODELS = ["opus", "claude-opus-5-5"];
const EFFORTS = ["high"];
const BANNED = ["Explore", "Plan", "general-purpose", "claude"];
const RULE = "Allowed: Opus 5.5 at high effort, for every task (docs/14-models-and-usage.md).";

const out = (o) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...o } }));
const deny = (why) => out({ permissionDecision: "deny", permissionDecisionReason: `${why}. ${RULE}` });

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (input.tool_name === "Agent") {
  const { model, effort, subagent_type: raw } = input.tool_input ?? {};
  const type = typeof raw === "string" ? raw.trim() : "";
  let why = "";
  if (model !== undefined && !MODELS.includes(model)) why = `Model "${model}" is not allowed`;
  else if (effort !== undefined && !EFFORTS.includes(effort)) why = `Effort "${effort}" is not allowed`;
  // No subagent_type means the built-in general-purpose agent (audit A1 finding 7): refused like naming it.
  else if (!type)
    why =
      "An Agent call without a subagent_type starts the built-in general-purpose agent, which is not used here; name a project agent (builder, designer, reviewer, analyst, code-finder, test-runner, doc-clerk)";
  else if (BANNED.some((b) => b.toLowerCase() === type.toLowerCase()))
    why = `The built-in "${type}" agent is not used here; use code-finder`;
  if (why) deny(why);
} else if (input.tool_name === "Bash") {
  let refused = "";
  if (process.env.CLAUDE_CODE_REMOTE === "true") {
    const { cloudRefusal } = await import("./cloud-guard.mjs");
    refused = cloudRefusal(String(input.tool_input?.command ?? ""));
    if (refused)
      out({
        permissionDecision: "deny",
        permissionDecisionReason: `${refused}. Not in a cloud session: merging, deploying, force-pushing and GitHub or Cloudflare settings are the local lead's (CLAUDE.md "In a cloud session"). This check is best effort; CLAUDE.md stays the rule.`,
      });
  }
  if (!refused && !input.agent_id && input.effort?.level) reportEffort(input);
}

/** Tells the lead its effort level the first time and whenever it changes. */
function reportEffort(input) {
  const level = input.effort.level;
  const dir = join(tmpdir(), "techaust-model-guard");
  const file = join(dir, `${String(input.session_id).replace(/[^\w-]/g, "")}.txt`);
  let last = "";
  try {
    last = readFileSync(file, "utf8");
  } catch {
    // first command of this session
  }
  if (last !== level) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, level);
    } catch {
      // reporting still works without the marker; it just repeats next time
    }
    const note = level === "high" ? "as the plan says" : "the plan says high: tell the owner";
    out({ additionalContext: `Lead effort level: ${level} (${note}).` });
  }
}
