// Claude Code hook (PreToolUse, matcher "Agent|Bash"), wired in .claude/settings.json.
// Enforces docs/14-models-and-usage.md §6:
// - Agent: refuses a model other than Opus, Sonnet or Haiku 5.5, effort xhigh/max, and the built-in
//   Explore, Plan, general-purpose and catch-all agents (they run on the lead's Opus).
// - Bash in the lead's own conversation: tells the lead its effort level the first time and whenever
//   it changes, so the start-of-day check can confirm "medium".
// Prints nothing when there is nothing to say; never blocks Bash.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODELS = ["opus", "sonnet", "haiku", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const EFFORTS = ["low", "medium", "high"];
const BANNED = ["Explore", "Plan", "general-purpose", "claude"];
const RULE = "Allowed: Opus, Sonnet and Haiku 5.5, effort low to high (docs/14-models-and-usage.md).";

const out = (o) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...o } }));
const deny = (why) => out({ permissionDecision: "deny", permissionDecisionReason: `${why}. ${RULE}` });

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (input.tool_name === "Agent") {
  const { model, effort, subagent_type: type } = input.tool_input ?? {};
  let why = "";
  if (model !== undefined && !MODELS.includes(model)) why = `Model "${model}" is not allowed`;
  else if (effort !== undefined && !EFFORTS.includes(effort)) why = `Effort "${effort}" is not allowed`;
  else if (BANNED.includes(type)) why = `The built-in "${type}" agent is not used here; use code-finder`;
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
    const note = level === "medium" ? "as the plan says" : "the plan says medium: tell the owner";
    out({ additionalContext: `Lead effort level: ${level} (${note}).` });
  }
}
