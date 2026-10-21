// Writes the git-ignored `.dev.vars` of the apps with random, local-only values for their secrets, if missing:
// apps/admin (staff login, M1.5) and apps/portal (the portal key, M1.6). Staging and production secrets are separate and
// set with `wrangler secret put` (docs/runbooks/access-staging.md).
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const APPS = {
  admin: ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY"],
  portal: ["PORTAL_KEY_PEPPER"],
};

for (const [app, names] of Object.entries(APPS)) {
  const file = new URL(`../apps/${app}/.dev.vars`, import.meta.url);
  if (existsSync(file)) {
    console.log(`apps/${app}/.dev.vars already exists; leaving it alone.`);
  } else {
    writeFileSync(file, `${names.map((n) => `${n}=${randomBytes(32).toString("base64")}`).join("\n")}\n`);
    console.log(`Wrote apps/${app}/.dev.vars with random local values.`);
  }
}
