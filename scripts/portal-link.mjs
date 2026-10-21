// Makes a portal sign-in link by hand (M1.6, LD1: until M2.4 sends the emails, this is how a person gets in). Run by the
// lead, locally or on staging with the lead's own `wrangler login`:
//   pnpm portal:link --email finance.a@example.test                       # local dev database
//   pnpm portal:link --email finance.a@example.test --staging             # staging
//   pnpm portal:link --email shared@example.test --client SAMPLE-A        # one organisation only
// One 15-minute, single-use link per organisation the email belongs to, as the Worker makes them. The link carries the
// token after `#t=`, so it never reaches a server log; send it only to the person it is for. Every link is audit-logged
// (`portal.link_minted`, actor "system"). It refuses an email with no eligible contact (portal access on, not
// anonymised). There is NO production option: production gets no hand-made links.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { eligibleSql, linkStatements, linkUrl, normaliseEmail, ORIGINS } from "./portal-sql.mjs";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    client: { type: "string" },
    staging: { type: "boolean", default: false },
  },
});
const email = normaliseEmail(values.email);
if (!email) throw new Error("--email is required");

const jobs = fileURLToPath(new URL("../apps/jobs/", import.meta.url));
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
const target = values.staging
  ? ["--remote", "--env", "staging"]
  : ["--local", "--persist-to", "../../.wrangler/state"];
const d1 = (args) =>
  execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, ...args], {
    cwd: jobs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
const rows = (sql) => JSON.parse(d1(["--command", sql, "--json"]))[0]?.results ?? [];

const contacts = rows(eligibleSql(email, values.client));
if (!contacts.length)
  throw new Error(
    `No contact with the email ${email}${values.client ? ` at ${values.client}` : ""} has portal access (or it is anonymised): no link made.`,
  );

const now = Date.now();
const made = contacts.map((c) => {
  const token = randomBytes(32).toString("base64url");
  return { ...c, token, tokenHash: createHash("sha256").update(token).digest("hex") };
});
const statements = made.flatMap((m) =>
  linkStatements({ contactId: m.id, tokenHash: m.tokenHash, now, auditId: randomUUID() }),
);

const dir = mkdtempSync(join(tmpdir(), "portal-link-"));
try {
  const file = join(dir, "link.sql");
  writeFileSync(file, `${statements.join("\n")}\n`);
  d1(["--file", file]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Confirm the rows are there before printing anything.
const stored = rows(
  `SELECT token_hash FROM magic_link_tokens WHERE token_hash IN (${made.map((m) => `'${m.tokenHash}'`).join(", ")})`,
).length;
if (stored !== made.length) throw new Error("The links were not all stored; do not use any printed link.");

const origin = values.staging ? ORIGINS.staging : ORIGINS.local;
console.log(
  `${made.length === 1 ? "Link" : `${made.length} links (one per organisation)`} for ${email}, single use, valid 15 minutes:`,
);
for (const m of made) console.log(`${m.display_name} (${m.code}):\n${linkUrl(origin, m.token)}`);
