// Dependency audit (docs/08 §3.5; full audit A1 3, owner's yes 2026-10-30). Run by CI's `checks` job right after the install, so it
// gates every merge. It runs the pinned pnpm's `pnpm audit --json` (pnpm asks the npm registry the install already uses for the
// advisories of every package in pnpm-lock.yaml, dev tools included: they run in CI and on the build machine) and FAILS on any
// advisory of severity high or critical that is not on the reviewed allow-list `scripts/dependency-audit-allow.json`.
//
// The allow-list is the only way through: never turn the step off. An entry names one advisory for one package, says why it is
// accepted (a false positive, an advisory without a fix, or a fix that is waiting for an update of its parent package), when it was
// added and by whom, and an expiry date at most 90 days after it was added. The step also fails when:
//   - an entry has expired (review it again: renew it with a new reason, or update the package);
//   - an entry is stale (that advisory is no longer reported at high or critical for that package: delete the entry);
//   - an entry is malformed;
//   - pnpm's answer cannot be read (a registry error fails closed; re-run the job).
// Moderate and low advisories are printed as a count only.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const ALLOW_FILE = resolve(ROOT, "scripts/dependency-audit-allow.json");
export const GATED = ["high", "critical"];
export const MAX_ALLOW_DAYS = 90;
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

/** `pnpm audit --json` output to its advisories, or throws when the output is not an audit report (a registry error, say). */
export function advisoriesOf(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("pnpm audit printed no readable JSON (a registry error?); the audit fails closed");
  }
  if (!report || typeof report !== "object" || typeof report.advisories !== "object" || !report.advisories)
    throw new Error("pnpm audit's JSON has no `advisories` (a registry error?); the audit fails closed");
  return Object.values(report.advisories).map((a) => ({
    id: String(a.github_advisory_id ?? a.id),
    pkg: String(a.module_name),
    severity: String(a.severity),
    title: String(a.title ?? ""),
    patched: a.patched_versions ?? null,
    paths: (a.findings ?? []).flatMap((f) => f.paths ?? []),
  }));
}

/** Problems with the allow-list entries themselves (shape, dates, the 90-day cap, duplicates). */
export function allowListProblems(entries) {
  if (!Array.isArray(entries)) return ["the allow-list must be a JSON array"];
  const problems = [];
  const seen = new Set();
  for (const [i, e] of entries.entries()) {
    const at = `entry ${i + 1}${e?.advisory ? ` (${e.advisory} ${e.package ?? "?"})` : ""}`;
    if (!e || typeof e !== "object") {
      problems.push(`${at}: not an object`);
      continue;
    }
    if (typeof e.advisory !== "string" || !GHSA.test(e.advisory))
      problems.push(`${at}: "advisory" must be a GHSA id`);
    if (typeof e.package !== "string" || e.package.length === 0)
      problems.push(`${at}: "package" is required`);
    if (typeof e.reason !== "string" || e.reason.trim().length < 20)
      problems.push(`${at}: "reason" must say why it is accepted (at least 20 characters)`);
    if (typeof e.addedBy !== "string" || e.addedBy.trim().length === 0)
      problems.push(`${at}: "addedBy" is required`);
    const dated = [e.added, e.expires].every((d) => typeof d === "string" && ISO_DATE.test(d));
    if (!dated) problems.push(`${at}: "added" and "expires" must be YYYY-MM-DD dates`);
    else {
      const span = (Date.parse(e.expires) - Date.parse(e.added)) / DAY_MS;
      if (!(span > 0)) problems.push(`${at}: "expires" must be after "added"`);
      if (span > MAX_ALLOW_DAYS)
        problems.push(`${at}: "expires" is more than ${MAX_ALLOW_DAYS} days after "added"`);
    }
    const key = `${e.advisory}|${e.package}`;
    if (seen.has(key)) problems.push(`${at}: listed twice`);
    seen.add(key);
  }
  return problems;
}

/**
 * The verdict for one audit against the allow-list on a given day (`today`, YYYY-MM-DD, UTC). `blocked`: gated advisories with no
 * live entry; `expired` and `stale`: entries to act on; `allowed`: gated advisories let through. Passes when all three are empty and
 * the list itself has no problems.
 */
export function verdict(advisories, entries, today) {
  const gated = advisories.filter((a) => GATED.includes(a.severity));
  const live = new Map();
  const expired = [];
  for (const e of entries) {
    if (e.expires < today) expired.push(e);
    else live.set(`${e.advisory}|${e.package}`, e);
  }
  const reported = new Set(gated.map((a) => `${a.id}|${a.pkg}`));
  const blocked = gated.filter((a) => !live.has(`${a.id}|${a.pkg}`));
  const allowed = gated.filter((a) => live.has(`${a.id}|${a.pkg}`));
  const stale = entries.filter((e) => !reported.has(`${e.advisory}|${e.package}`));
  return { blocked, expired, stale, allowed, problems: allowListProblems(entries) };
}

const unique = (list, key) => [...new Map(list.map((x) => [key(x), x])).values()];

/** The lines to print, and whether the audit passes. */
export function report(v, advisories) {
  const lines = [];
  const counts = Object.fromEntries(
    ["critical", "high", "moderate", "low", "info"].map((s) => [
      s,
      unique(
        advisories.filter((a) => a.severity === s),
        (a) => `${a.id}|${a.pkg}`,
      ).length,
    ]),
  );
  lines.push(
    `advisories: ${Object.entries(counts)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ")}`,
  );
  for (const p of v.problems) lines.push(`allow-list problem: ${p}`);
  for (const a of unique(v.blocked, (x) => `${x.id}|${x.pkg}`))
    lines.push(
      `BLOCKED ${a.severity} ${a.id} ${a.pkg} (${a.title}); fixed in ${a.patched ?? "no release yet"}; via ${a.paths[0] ?? "?"}`,
    );
  for (const e of v.expired)
    lines.push(
      `EXPIRED allow-list entry ${e.advisory} ${e.package} (expired ${e.expires}): review it again or update the package`,
    );
  for (const e of v.stale)
    lines.push(
      `STALE allow-list entry ${e.advisory} ${e.package}: no longer reported at high or critical; delete it`,
    );
  for (const a of unique(v.allowed, (x) => `${x.id}|${x.pkg}`))
    lines.push(`allowed ${a.severity} ${a.id} ${a.pkg} (reviewed allow-list entry)`);
  const ok = v.problems.length + v.blocked.length + v.expired.length + v.stale.length === 0;
  return { ok, lines };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // `--input <file>` reads a saved `pnpm audit --json` report instead of asking the registry (for a dry run).
  const at = process.argv.indexOf("--input");
  let text;
  if (at > 0) text = readFileSync(process.argv[at + 1], "utf8");
  else {
    // One fixed command string: Windows needs a shell to find pnpm's .cmd shim; no argument comes from outside.
    const win = process.platform === "win32";
    const r = win
      ? spawnSync("pnpm audit --json", {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          shell: true,
        })
      : spawnSync("pnpm", ["audit", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // pnpm exits 1 when it finds any advisory; the JSON decides. Its stderr is shown only when the JSON can't be read.
    text = r.stdout ?? "";
    if (r.error) {
      console.error(`could not run pnpm audit: ${r.error.message}`);
      process.exit(1);
    }
    try {
      advisoriesOf(text);
    } catch {
      console.error((r.stderr ?? "").split("\n").slice(-20).join("\n"));
    }
  }
  let advisories;
  try {
    advisories = advisoriesOf(text);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(ALLOW_FILE, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const { ok, lines } = report(verdict(advisories, Array.isArray(entries) ? entries : [], today), advisories);
  if (!Array.isArray(entries)) lines.unshift("allow-list problem: the allow-list must be a JSON array");
  for (const line of lines) (ok ? console.log : console.error)(line);
  if (!ok || !Array.isArray(entries)) {
    console.error(
      "dependency audit: FAILED. Update the package, or add a reviewed entry to scripts/dependency-audit-allow.json (docs/08 §3.5).",
    );
    process.exit(1);
  }
  console.log("dependency audit: ok (no high or critical advisory outside the reviewed allow-list)");
}
