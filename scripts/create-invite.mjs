// Creates a single-use staff invite (48 h) and prints its link [ADM-AUTH-07]. This is how the first Owner
// account is created (no inviter yet), and how the CPU benchmark makes throwaway users.
//   pnpm invite --email owner@example.com --role owner            # local dev database
//   pnpm invite --email owner@example.com --role owner --staging  # staging (uses your wrangler login)
// The link carries the token in the URL fragment (#t=…), so it never reaches server logs. Share it only
// with the person it's for; it works once.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROLES = ["owner", "staff", "sales", "accountant"];
const ORIGINS = {
  local: "http://localhost:5173",
  staging: "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
};

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string", default: "staff" },
    staging: { type: "boolean", default: false },
    hours: { type: "string", default: "48" },
  },
});
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required");
if (!ROLES.includes(values.role)) throw new Error(`--role must be one of ${ROLES.join(", ")}`);
const hours = Number(values.hours);
if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new Error("--hours must be 1–48");

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const sql = `INSERT INTO staff_invites (token_hash, email, role, expires_at) VALUES (${q(hash)}, ${q(email)}, ${q(values.role)}, ${Date.now() + hours * 3_600_000});\n`;

const dir = mkdtempSync(join(tmpdir(), "invite-"));
try {
  const file = join(dir, "invite.sql");
  writeFileSync(file, sql);
  const target = values.staging
    ? ["--remote", "--env", "staging"]
    : ["--local", "--persist-to", "../../.wrangler/state"];
  // Run the jobs app's wrangler directly with Node (no shell), using its D1 binding and config.
  const jobs = fileURLToPath(new URL("../apps/jobs/", import.meta.url));
  const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, "--file", file], {
    cwd: jobs,
    stdio: ["ignore", "ignore", "inherit"],
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const origin = values.staging ? ORIGINS.staging : ORIGINS.local;
console.log(
  `Invite for ${email} (${values.role}), valid ${hours} h, single use:\n${origin}/invite#t=${token}`,
);
