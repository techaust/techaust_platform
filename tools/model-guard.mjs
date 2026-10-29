// Claude Code hook (PreToolUse, matcher "Agent|Bash"), wired in .claude/settings.json.
// Enforces docs/14-models-and-usage.md §6:
// - Agent: refuses a model other than Opus 5.5, an effort other than high (owner, 2026-10-29: Opus 5.5 at high for every task),
//   and the built-in
//   Explore, Plan, general-purpose and catch-all agents (they run on the lead's Opus), named in any case, and a call with
//   no subagent_type at all (that starts general-purpose). Tested by apps/web/test/model-guard.test.ts.
// - Bash in the lead's own conversation: tells the lead its effort level the first time and whenever
//   it changes, so the start-of-day check can confirm "high".
// Prints nothing when there is nothing to say; never blocks Bash.
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
} else if (input.tool_name === "Bash" && !input.agent_id && input.effort?.level) {
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
