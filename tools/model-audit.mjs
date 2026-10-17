// Lists every Claude Code run in this project since a date, with the model and effort its own log
// recorded, and flags anything outside docs/14-models-and-usage.md: a model other than Opus, Sonnet
// or Haiku 5.5, effort xhigh/max, or the lead on an effort other than medium.
// Usage: node tools/model-audit.mjs [YYYY-MM-DD]   (default: today). Exit code 1 if anything is flagged.
// Reads only the local logs in ~/.claude/projects/<this repo>/; prints no message content.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
const EFFORTS = new Set(["low", "medium", "high"]);

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(homedir(), ".claude", "projects", repo.replace(/[^A-Za-z0-9]/g, "-"));
const since = process.argv[2] ?? new Date().toLocaleDateString("en-CA");
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error("Usage: node tools/model-audit.mjs [YYYY-MM-DD]");
  process.exit(2);
}
if (!existsSync(root)) {
  console.log(`No logs found in ${root}`);
  process.exit(0);
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".jsonl")) files.push(path);
  }
};
walk(root);

const runs = [];
for (const file of files) {
  const isAgent = basename(dirname(file)) === "subagents";
  let agent = "lead";
  if (isAgent) {
    try {
      agent = JSON.parse(readFileSync(file.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType ?? "agent";
    } catch {
      agent = "agent";
    }
  }
  const models = new Set();
  const efforts = new Set();
  let first = "";
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"type":"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant" || !entry.timestamp || entry.timestamp.slice(0, 10) < since) continue;
    const model = entry.message?.model;
    if (!model || model === "<synthetic>") continue;
    models.add(model);
    if (entry.effort) efforts.add(entry.effort);
    if (!first) first = entry.timestamp;
  }
  if (!models.size) continue;
  const problems = [];
  for (const m of models) if (!MODELS.has(m)) problems.push(`model ${m} not allowed`);
  for (const e of efforts) if (!EFFORTS.has(e)) problems.push(`effort ${e} not allowed`);
  if (!isAgent && [...efforts].some((e) => e !== "medium")) problems.push("lead not on medium");
  const id = basename(file, ".jsonl");
  runs.push({ first, agent, id, models: [...models], efforts: [...efforts], problems });
}

runs.sort((a, b) => a.first.localeCompare(b.first));
console.log(`Runs since ${since}: ${runs.length}`);
for (const r of runs) {
  const used = `${r.models.join(",")} / ${r.efforts.join(",") || "?"}`;
  const flag = r.problems.length ? `  FLAG: ${r.problems.join("; ")}` : "";
  console.log(`${r.first.slice(0, 16)}  ${r.agent.padEnd(12)} ${used}  (${r.id})${flag}`);
}
const flagged = runs.filter((r) => r.problems.length).length;
console.log(flagged ? `${flagged} run(s) flagged.` : "All runs within the plan.");
process.exit(flagged ? 1 : 0);
