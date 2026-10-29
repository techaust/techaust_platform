// tools/model-guard.mjs, the PreToolUse hook that enforces docs/14 section 6 on Agent calls (audit A1 finding 7): it is run as
// Claude Code runs it, with the hook input on stdin, and its JSON answer is read back. Runs in Node.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const guard = fileURLToPath(new URL("../../../tools/model-guard.mjs", import.meta.url));

type Answer = { decision: string | null; reason: string };

function hook(toolInput: Record<string, unknown>, toolName = "Agent") {
  return new Promise<Answer>((resolve, reject) => {
    const child = execFile(process.execPath, [guard], (err, stdout) => {
      if (err) return reject(err);
      const out = stdout.trim();
      if (!out) return resolve({ decision: null, reason: "" });
      const o = JSON.parse(out).hookSpecificOutput;
      resolve({ decision: o.permissionDecision ?? null, reason: o.permissionDecisionReason ?? "" });
    });
    child.stdin?.end(JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_id: "test" }));
  });
}

// Each test starts the hook as a node process, up to 10 one after another: 30 s, not the default 5 s, so a loaded machine does not
// fail it (FX-2 review, finding 3).
describe("model-guard: Agent calls [docs/14 section 6]", { timeout: 30_000 }, () => {
  it("refuses an Agent call with no subagent_type (it would start general-purpose)", async () => {
    for (const input of [
      { prompt: "x" },
      { prompt: "x", subagent_type: "" },
      { prompt: "x", subagent_type: "  " },
    ]) {
      const a = await hook(input);
      expect(a.decision).toBe("deny");
      expect(a.reason).toContain("without a subagent_type");
    }
  });

  it("refuses the banned built-ins however they are written", async () => {
    for (const type of [
      "Explore",
      "Plan",
      "general-purpose",
      "claude",
      "explore",
      "GENERAL-PURPOSE",
      " Plan ",
    ]) {
      const a = await hook({ prompt: "x", subagent_type: type });
      expect(a.decision, type).toBe("deny");
      expect(a.reason).toContain("is not used here");
    }
  });

  it("refuses a model or an effort outside the plan", async () => {
    expect((await hook({ subagent_type: "builder", model: "fable" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", model: "best" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", effort: "xhigh" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", effort: "max" })).decision).toBe("deny");
  });

  it("lets a project agent through, with or without a model and effort from the plan", async () => {
    for (const type of [
      "builder",
      "designer",
      "reviewer",
      "analyst",
      "code-finder",
      "test-runner",
      "doc-clerk",
    ])
      expect((await hook({ subagent_type: type })).decision, type).toBeNull();
    expect((await hook({ subagent_type: "builder", model: "sonnet", effort: "high" })).decision).toBeNull();
    expect(
      (await hook({ subagent_type: "reviewer", model: "claude-opus-5-5", effort: "medium" })).decision,
    ).toBeNull();
  });

  it("never blocks another tool", async () => {
    expect((await hook({ command: "ls" }, "Read")).decision).toBeNull();
  });
});
