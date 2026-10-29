// Claude Code hook (PreToolUse, matcher "Agent|Bash|Monitor"), wired in .claude/settings.json.
// Enforces docs/14-models-and-usage.md §6:
// - Agent: refuses a model other than Opus 5.5, an effort other than high (owner, 2026-10-29: Opus 5.5 at high for every task),
//   and the built-in
//   Explore, Plan, general-purpose and catch-all agents (they run on the lead's Opus), named in any case, and a call with
//   no subagent_type at all (that starts general-purpose). Tested by apps/web/test/model-guard.test.ts.
// - Bash in the lead's own conversation: tells the lead its effort level the first time and whenever
//   it changes, so the start-of-day check can confirm "high".
// - Bash and Monitor commands in a Claude Code cloud session only (CLAUDE_CODE_REMOTE === "true", which Claude Code sets there
//   and never on this PC; CLOUD-1): refuses merging, deploying, force-pushing or deleting branches, pushing to main, and changing
//   GitHub or Cloudflare settings (gh other than its reads, gh api other than GET or opening or commenting on a PR, git push
//   --force/--delete/":" refspecs/main, or of the current branch while it is main, wrangler other than its local commands and a
//   dry-run deploy, the deploy:* scripts). The patterns live in tools/cloud-guard.mjs, loaded only then; only then it reads the
//   current branch (git rev-parse) for a push. If the check itself fails, or the hook input isn't a JSON object, the call is
//   refused there (fails closed). Best effort: a
//   script can get round a pattern; CLAUDE.md "In a cloud session" stays the rule.
// Prints nothing when there is nothing to say. On this PC it never blocks Bash or Monitor and starts nothing new.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MODELS = ["opus", "claude-opus-5-5"];
const EFFORTS = ["high"];
const BANNED = ["Explore", "Plan", "general-purpose", "claude"];
const RULE = "Allowed: Opus 5.5 at high effort, for every task (docs/14-models-and-usage.md).";

const out = (o) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...o } }));
const deny = (why) => out({ permissionDecision: "deny", permissionDecisionReason: `${why}. ${RULE}` });

const CLOUD = process.env.CLAUDE_CODE_REMOTE === "true";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  input = undefined;
}

if (input === null || typeof input !== "object" || Array.isArray(input)) {
  // Input that isn't a JSON object (unreadable, null, a list, a bare value): on this PC the hook says nothing, as before; in a
  // cloud session the call is refused, because a hook that exits quietly or crashes lets it through (CLOUD-1 second re-check,
  // finding 6).
  if (CLOUD)
    out({
      permissionDecision: "deny",
      permissionDecisionReason:
        'The hook input could not be read, so the call can\'t be checked in a cloud session. This check is best effort; CLAUDE.md "In a cloud session" stays the rule.',
    });
} else if (input.tool_name === "Agent") {
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
} else if (input.tool_name === "Bash" || input.tool_name === "Monitor") {
  let refused = "";
  if (CLOUD) {
    try {
      const { cloudRefusal } = await import("./cloud-guard.mjs");
      // Both tools hold their shell command in tool_input.command (Monitor: { command, description, timeout_ms }).
      refused = cloudRefusal(String(input.tool_input?.command ?? ""), {
        currentBranch: (dir) => currentBranch(dir, input.cwd),
      });
    } catch (e) {
      // a hook that crashes lets the command through, so a failed check refuses (CLOUD-1 re-check, finding 7)
      refused = `the cloud command check failed (${e instanceof Error ? e.message : String(e)})`;
    }
    if (refused)
      out({
        permissionDecision: "deny",
        permissionDecisionReason: `${refused}. Not in a cloud session: merging, deploying, force-pushing and GitHub or Cloudflare settings are the local lead's (CLAUDE.md "In a cloud session"). This check is best effort; CLAUDE.md stays the rule.`,
      });
  }
  if (!refused && input.tool_name === "Bash" && !input.agent_id && input.effort?.level) reportEffort(input);
}

/**
 * The current git branch, read only (`git rev-parse --abbrev-ref HEAD`), in `git -C <dir>`'s folder when the command names one,
 * from the hook's working folder. Cloud sessions only (CLOUD-1 review, finding 4); any failure gives null, which refuses the push.
 */
function currentBranch(dir, cwd) {
  try {
    const base = typeof cwd === "string" && cwd ? cwd : process.cwd();
    const out = execFileSync(
      "git",
      ["-C", dir ? resolve(base, dir) : base, "rev-parse", "--abbrev-ref", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      },
    );
    return out.trim() || null;
  } catch {
    return null;
  }
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
