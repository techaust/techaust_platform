// Owner break-glass (docs/08 §3.2): clears a member's password and authenticator, ends their sessions and prints a
// fresh single-use 48-hour invite link. For when recovery codes are all lost. Run it yourself, locally:
//   pnpm admin:reset-2fa --email you@example.com                # local dev database
//   pnpm admin:reset-2fa --email you@example.com --staging      # staging, with your own `wrangler login` (OAuth)
// Never with a production API token. The link carries the token in the URL fragment (#t=…), so it never reaches
// server logs; share it only with the person it is for. The reset is audit-logged (`user.reset_2fa`, actor "system").
// The database refuses to reset the ONLY active owner (the last-owner trigger): invite a second owner first.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { resetStatements } from "./reset-2fa-sql.mjs";

const ORIGINS = {
  local: "http://localhost:5173",
  staging: "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
};

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    staging: { type: "boolean", default: false },
    hours: { type: "string", default: "48" },
  },
});
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required");
const hours = Number(values.hours);
if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new Error("--hours must be 1–48");

const jobs = fileURLToPath(new URL("../apps/jobs/", import.meta.url));
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
const target = values.staging
  ? ["--remote", "--env", "staging"]
  : ["--local", "--persist-to", "../../.wrangler/state"];

function d1(args) {
  return execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, ...args], {
    cwd: jobs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
const rows = (sql) => {
  const out = JSON.parse(d1(["--command", sql, "--json"]));
  return out[0]?.results ?? [];
};
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const [user] = rows(`SELECT id, role, status FROM staff_users WHERE email = ${q(email)}`);
if (!user) throw new Error(`No staff member with the email ${email}.`);
if (user.status !== "active") throw new Error(`${email} is "${user.status}", not active: nothing to reset.`);
if (user.role === "owner") {
  const [{ n }] = rows("SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'");
  if (n < 2)
    throw new Error(
      "This is the only active owner, and the database refuses to reset the last owner. Invite a second owner first.",
    );
}

const token = randomBytes(32).toString("base64url");
const now = Date.now();
const sql = `${resetStatements({
  email,
  tokenHash: createHash("sha256").update(token).digest("hex"),
  now,
  expiresAt: now + hours * 3_600_000,
  auditId: randomUUID(),
  alertId: randomUUID(),
}).join("\n")}\n`;

const dir = mkdtempSync(join(tmpdir(), "reset2fa-"));
try {
  const file = join(dir, "reset.sql");
  writeFileSync(file, sql);
  d1(["--file", file]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const [after] = rows(`SELECT status FROM staff_users WHERE email = ${q(email)}`);
if (after?.status !== "invited") throw new Error("The reset did not apply; nothing was changed.");
const origin = values.staging ? ORIGINS.staging : ORIGINS.local;
console.log(
  `Reset done for ${email}: password, authenticator and recovery codes cleared, sessions ended.\nOne-time link, valid ${hours} h:\n${origin}/invite#t=${token}`,
);
