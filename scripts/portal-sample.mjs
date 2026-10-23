// Loads the owner's sample portal data (M1.6, Q2 = yes): "Sample Client A (sample)" and "Sample Client B (sample)",
// each with three contacts at @example.test (finance, no finance, no portal access). Fake names only; local and staging,
// never production (there is no production option). Insert-only with stable IDs: safe to run again.
//   pnpm portal:sample              # local dev database
//   pnpm portal:sample --staging    # staging, with the lead's own `wrangler login`
//   pnpm portal:sample --staging --email you@example.com   # also one sample contact on a real inbox (M2.4b staging test)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inboxContact, normaliseEmail, SAMPLE, sampleStatements } from "./portal-sql.mjs";

const { values } = parseArgs({
  options: { staging: { type: "boolean", default: false }, email: { type: "string" } },
});
const inbox = values.email === undefined ? null : normaliseEmail(values.email);
if (values.email !== undefined && !inbox) {
  console.error("--email needs an email address, for example --email you@example.com");
  process.exit(1);
}
const jobs = fileURLToPath(new URL("../apps/jobs/", import.meta.url));
const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
const target = values.staging
  ? ["--remote", "--env", "staging"]
  : ["--local", "--persist-to", "../../.wrangler/state"];

const dir = mkdtempSync(join(tmpdir(), "portal-sample-"));
try {
  const file = join(dir, "sample.sql");
  writeFileSync(file, `${sampleStatements(inbox ?? undefined).join("\n")}\n`);
  execFileSync(process.execPath, [wrangler, "d1", "execute", "DB", ...target, "--file", file], {
    cwd: jobs,
    stdio: ["ignore", "ignore", "inherit"],
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`Sample portal data is in the ${values.staging ? "staging" : "local"} database:`);
for (const c of SAMPLE) {
  console.log(`- ${c.name} (${c.code})`);
  for (const p of c.contacts)
    console.log(
      `    ${p.email}: ${p.portal ? "portal access" : "NO portal access"}${p.portal && p.finance ? ", sees finance" : ""}`,
    );
}
if (inbox) {
  const c = inboxContact(inbox);
  console.log(`- ${SAMPLE[0]?.name}`);
  console.log(`    ${c.email}: portal access, sees finance (your own inbox: the sign-in email goes here)`);
}
console.log(
  "Make a sign-in link with: pnpm portal:link --email <one of the addresses above>" +
    (values.staging ? " --staging" : ""),
);
