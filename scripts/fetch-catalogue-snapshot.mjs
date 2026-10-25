// Fetches the newest published catalogue snapshot from the STAGING D1 and writes it to apps/web/catalogue-snapshot.json, which the web
// build reads (ADM-CAT-05, WEB-G-07, WEB-SVC-05). Shared by deploy-staging.yml (before the Workers are built) and publish-catalogue.yml
// (the 30-minute check). It uses the credentials already in the job's environment (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID) and
// only READS: `wrangler d1 execute DB --remote --env staging --json --command "SELECT ..."`.
//
//   node scripts/fetch-catalogue-snapshot.mjs [--out <file>] [--github-output <file>]
//
// - No snapshot row: writes nothing and says so (the web build then uses the seed). A snapshot exists but the fetch fails: the script
//   FAILS, so a job never falls back to the seed silently while a published snapshot exists (the M2.2 follow-up).
// - The row's SHA-256 must match the SHA-256 of its text (the stored text is canonical JSON), or the script fails.
// - `--github-output <file>` appends `found=true|false`, `id=<row id>` and `sha=<sha256>` for the next workflow step. The workflow's "already deployed" cache is keyed on the
//   row `id`, not the SHA: publishing an earlier list again (A, B, A) makes a new row with an old SHA, and staging must go back to it.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The newest snapshot. (`created_at` is the publish time: the column behind `publishedAt` in the Drizzle schema.) */
export const SNAPSHOT_SQL =
  "SELECT id, json, sha256 FROM site_snapshots ORDER BY created_at DESC, id DESC LIMIT 1";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OUT = resolve(ROOT, "apps/web/catalogue-snapshot.json");

/** The JSON in wrangler's output (a banner or log line may come first). Throws when there is none. */
export function parseWranglerJson(text) {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const at = t.search(/^[[{]/m);
    if (at < 0) throw new Error("wrangler printed no JSON");
    try {
      return JSON.parse(t.slice(at));
    } catch {
      throw new Error("wrangler printed JSON that cannot be read");
    }
  }
}

/**
 * The newest snapshot in wrangler's `--json` output, or null when the table has no row. Output shape: an array with one element per
 * statement, each `{ results: [...], success: boolean, meta: {...} }`.
 */
export function snapshotFromOutput(text) {
  const out = parseWranglerJson(text);
  if (!Array.isArray(out) || out.length === 0)
    throw new Error("unexpected wrangler output (no statement result)");
  const first = out[0];
  if (!first || first.success === false || !Array.isArray(first.results))
    throw new Error("the snapshot query did not succeed");
  const row = first.results[0];
  if (row === undefined) return null;
  if (
    typeof row.id !== "string" ||
    row.id === "" ||
    typeof row.json !== "string" ||
    typeof row.sha256 !== "string"
  )
    throw new Error("the snapshot row has no id, json or sha256");
  const actual = createHash("sha256").update(row.json).digest("hex");
  if (actual !== row.sha256) throw new Error("the snapshot text does not match its SHA-256: not using it");
  try {
    JSON.parse(row.json);
  } catch {
    throw new Error("the snapshot text is not JSON");
  }
  return { id: row.id, json: row.json, sha256: row.sha256 };
}

/** Runs wrangler through the jobs package (its config holds the `DB` binding for `--env staging`). */
export function runWrangler() {
  const r = spawnSync(
    "pnpm",
    [
      "--filter",
      "@techaust/jobs",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--env",
      "staging",
      "--json",
      "--command",
      SNAPSHOT_SQL,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, shell: process.platform === "win32" },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

/** The newest snapshot, or null. Throws when the command failed or its output is not a snapshot. */
export function fetchSnapshot(run = runWrangler) {
  const r = run();
  if (r.error || r.status !== 0) {
    const tail = String(r.stderr ?? "")
      .split("\n")
      .slice(-15)
      .join("\n");
    throw new Error(`wrangler d1 execute failed (exit ${r.status ?? "none"}):\n${tail}`);
  }
  return snapshotFromOutput(r.stdout);
}

/** Fetches, writes the file when there is a snapshot, and reports through the optional GitHub output file. */
export function main({ out = DEFAULT_OUT, githubOutput, run = runWrangler, log = console.log } = {}) {
  const snap = fetchSnapshot(run);
  if (snap === null) {
    log("catalogue: no published snapshot; the web build uses the seed");
    if (githubOutput) appendFileSync(githubOutput, "found=false\nid=\nsha=\n");
    return { found: false };
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, snap.json);
  log(`catalogue: snapshot ${snap.id} (${snap.sha256.slice(0, 12)}) written to ${out}`);
  if (githubOutput) appendFileSync(githubOutput, `found=true\nid=${snap.id}\nsha=${snap.sha256}\n`);
  return { found: true, id: snap.id, sha256: snap.sha256 };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main({ out: arg("--out") ? resolve(arg("--out")) : DEFAULT_OUT, githubOutput: arg("--github-output") });
  } catch (e) {
    console.error(`catalogue: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
