// Writes the git-ignored `.dev.vars` of the apps with random, local-only values for their secrets, if missing:
// apps/admin (staff login, M1.5), apps/portal (the portal key, M1.6), apps/web (form spam protection, M2.4) and
// apps/jobs (email sending, M2.4). Staging and production secrets are separate and set with `wrangler secret put`
// (docs/runbooks/access-staging.md, docs/runbooks/ses-and-turnstile.md).
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

/** Cloudflare's always-pass Turnstile TEST secret (public, from the Turnstile docs): local use only. */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const APPS = {
  admin: ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY"],
  portal: ["PORTAL_KEY_PEPPER"],
  web: ["FORMS_IP_PEPPER"],
};
/** Fixed local values written next to the random ones. */
const FIXED = {
  web: { TURNSTILE_SECRET: TURNSTILE_TEST_SECRET },
  // The `log` email transport sends nothing, so these are placeholders, not credentials.
  jobs: { SES_ACCESS_KEY_ID: "local-not-used", SES_SECRET_ACCESS_KEY: "local-not-used" },
};

for (const app of new Set([...Object.keys(APPS), ...Object.keys(FIXED)])) {
  const file = new URL(`../apps/${app}/.dev.vars`, import.meta.url);
  if (existsSync(file)) {
    console.log(`apps/${app}/.dev.vars already exists; leaving it alone.`);
  } else {
    const lines = [
      ...(APPS[app] ?? []).map((n) => `${n}=${randomBytes(32).toString("base64")}`),
      ...Object.entries(FIXED[app] ?? {}).map(([n, v]) => `${n}=${v}`),
    ];
    writeFileSync(file, `${lines.join("\n")}\n`);
    console.log(`Wrote apps/${app}/.dev.vars with local values.`);
  }
}
