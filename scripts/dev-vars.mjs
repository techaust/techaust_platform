// Writes apps/admin/.dev.vars with random, local-only values for the login secrets (git-ignored), if missing.
// Staging and production secrets are separate and set with `wrangler secret put` (docs/runbooks/access-staging.md).
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const file = new URL("../apps/admin/.dev.vars", import.meta.url);
if (existsSync(file)) {
  console.log("apps/admin/.dev.vars already exists; leaving it alone.");
} else {
  const names = ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY"];
  writeFileSync(file, `${names.map((n) => `${n}=${randomBytes(32).toString("base64")}`).join("\n")}\n`);
  console.log("Wrote apps/admin/.dev.vars with random local values.");
}
