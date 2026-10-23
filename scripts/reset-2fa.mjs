// Owner break-glass (docs/08 §3.2): clears a member's password and authenticator, ends their sessions and prints a
// fresh single-use 48-hour invite link. For when recovery codes are all lost. Run it yourself, locally:
//   pnpm admin:reset-2fa --email you@example.com                # local dev database
//   pnpm admin:reset-2fa --email you@example.com --staging      # staging, with your own `wrangler login` (OAuth)
// Never with a production API token. The link carries the token in the URL fragment (#t=…), so it never reaches
// server logs; share it only with the person it is for. The reset is audit-logged (`user.reset_2fa`, actor "system").
//
// The ONLY active owner cannot be reset: the database's last-owner trigger refuses it, and it stays strict (no bypass).
// For that case the script issues a one-time OWNER invite for a second address you control instead:
//   pnpm admin:reset-2fa --email you@example.com --new-email another@example.com [--staging]
// Open the link, enrol that account, then reset or deactivate the lost one from Staff and invites (allowed once two
// owners exist). The lost owner's row, sessions and recovery codes are not touched. Audit: `user.invite`, actor "system",
// reason break-glass. Keep a sealed second owner account so you rarely need this.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  breakGlassStatements,
  checkBreakGlass,
  normaliseEmail,
  reinviteStatements,
  resetStatements,
} from "./reset-2fa-sql.mjs";

const ORIGINS = {
  local: "http://localhost:5173",
  staging: "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
};

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "new-email": { type: "string" },
    staging: { type: "boolean", default: false },
    hours: { type: "string", default: "48" },
  },
});
const email = normaliseEmail(values.email);
if (!email) throw new Error("--email is required");
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
if (user.status !== "active" && user.status !== "invited")
  throw new Error(`${email} is "${user.status}": nothing to reset.`);
let onlyOwner = false;
if (user.status === "active" && user.role === "owner") {
  const [{ n }] = rows("SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'");
  onlyOwner = n < 2;
}
const newEmailArg = values["new-email"];
if (!onlyOwner && newEmailArg !== undefined)
  throw new Error(
    "--new-email is only for the only active owner (break-glass). This member can be reset without it; nothing was changed.",
  );

const token = randomBytes(32).toString("base64url");
const now = Date.now();
const common = {
  tokenHash: createHash("sha256").update(token).digest("hex"),
  now,
  expiresAt: now + hours * 3_600_000,
  auditId: randomUUID(),
};
function runFile(statements) {
  const dir = mkdtempSync(join(tmpdir(), "reset2fa-"));
  try {
    const file = join(dir, "reset.sql");
    writeFileSync(file, `${statements.join("\n")}\n`);
    d1(["--file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const origin = values.staging ? ORIGINS.staging : ORIGINS.local;

if (onlyOwner) {
  // Break-glass for the only owner: the trigger stays strict, so a second owner is invited instead (one atomic run).
  const probe = q(normaliseEmail(newEmailArg) ?? "");
  const newEmail = checkBreakGlass({
    email,
    newEmail: newEmailArg,
    staging: values.staging,
    existing: rows(`SELECT 1 AS x FROM staff_users WHERE email = ${probe}`).length,
    liveInvites: rows(
      `SELECT 1 AS x FROM staff_invites WHERE email = ${probe} AND used_at IS NULL AND expires_at > ${now}`,
    ).length,
  });
  runFile(breakGlassStatements({ ...common, newEmail, lostOwnerId: user.id }));
  const [made] = rows(
    `SELECT 1 AS x FROM staff_invites WHERE token_hash = ${q(common.tokenHash)} AND role = 'owner' AND used_at IS NULL`,
  );
  if (!made)
    throw new Error("The invite was not created (the checks changed while running); nothing was changed.");
  console.log(
    `Break-glass: ${email} is the only active owner, so it was left untouched. A one-time OWNER invite was issued for ${newEmail}.\nNext: open the link, enrol that account (password and authenticator), then in Staff and invites reset or deactivate ${email}.\nOne-time link, valid ${hours} h:\n${origin}/invite#t=${token}`,
  );
  process.exit(0);
}

// Already "invited" (an earlier reset whose link was lost): only a fresh invite; staff_users is not touched.
runFile(
  user.status === "invited"
    ? reinviteStatements({ ...common, email })
    : resetStatements({ ...common, email, alertId: randomUUID() }),
);

const [after] = rows(`SELECT status FROM staff_users WHERE email = ${q(email)}`);
if (after?.status !== "invited") throw new Error("The reset did not apply; nothing was changed.");
console.log(
  `${user.status === "invited" ? "New link issued" : "Reset done"} for ${email}: password, authenticator and recovery codes cleared, sessions ended.\nNo email is sent about this reset: tell the member yourself.\nOne-time link, valid ${hours} h:\n${origin}/invite#t=${token}`,
);
