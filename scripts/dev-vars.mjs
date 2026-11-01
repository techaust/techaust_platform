// Writes the git-ignored `.dev.vars` of the apps with random, local-only values for their secrets, if missing:
// apps/admin (staff login, M1.5; Turnstile test secret, M2.4b), apps/portal (the portal key, M1.6; Turnstile test secret,
// M2.4b), apps/web (form spam protection, M2.4) and apps/jobs (email sending, M2.4). Staging and production secrets are
// separate and set with `wrangler secret put` (docs/runbooks/access-staging.md, docs/runbooks/ses-and-turnstile.md).
// An existing file keeps its values; a fixed (non-random) name it lacks is appended, so older setups gain the Turnstile
// test secret without losing their keys.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/** Cloudflare's always-pass Turnstile TEST secret (public, from the Turnstile docs): local use only. */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

const APPS = {
  admin: ["PASSWORD_PEPPER", "SALT_PEPPER", "TOTP_ENC_KEY", "SESSION_HMAC_KEY"],
  portal: ["PORTAL_KEY_PEPPER"],
  web: ["FORMS_IP_PEPPER"],
};
/** Fixed local values written next to the random ones. */
const FIXED = {
  // M6.2 (L16): the finance Worker's Razorpay pair is FAKE locally: GATEWAY_TRANSPORT "stub" answers with the simulator and never calls Razorpay.
  admin: {
    TURNSTILE_SECRET: TURNSTILE_TEST_SECRET,
    RAZORPAY_KEY_ID: "rzp_test_LOCALSTUB0000001",
    RAZORPAY_KEY_SECRET: "local-not-a-real-key-secret",
    // M6.3: a FAKE restricted test key in the shape the client accepts (built here so no key-looking literal is committed); the stub never calls Stripe.
    STRIPE_SECRET_KEY: ["rk", "test", "LOCALSTUBnotreal"].join("_"),
  },
  portal: { TURNSTILE_SECRET: TURNSTILE_TEST_SECRET },
  web: { TURNSTILE_SECRET: TURNSTILE_TEST_SECRET },
  // The `log` email transport sends nothing, so these are placeholders, not credentials.
  // M6.2: a local webhook secret that `scripts/pay-simulate.mjs` reads from this file to sign its fake event (never a real one).
  jobs: {
    SES_ACCESS_KEY_ID: "local-not-used",
    SES_SECRET_ACCESS_KEY: "local-not-used",
    RAZORPAY_WEBHOOK_SECRET: "local-webhook-secret-not-real",
    // M6.3: a FAKE Stripe signing secret that `scripts/pay-simulate.mjs --gateway stripe` reads from this file (never a real one).
    STRIPE_WEBHOOK_SECRET: ["whsec", "LOCALSTUBnotreal"].join("_"),
  },
};

for (const app of new Set([...Object.keys(APPS), ...Object.keys(FIXED)])) {
  const file = new URL(`../apps/${app}/.dev.vars`, import.meta.url);
  const fixed = Object.entries(FIXED[app] ?? {});
  if (existsSync(file)) {
    const have = new Set(
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((l) => l.split("=")[0]?.trim()),
    );
    const missing = fixed.filter(([n]) => !have.has(n));
    if (missing.length) {
      const text = readFileSync(file, "utf8");
      const lead = text === "" || text.endsWith("\n") ? "" : "\n";
      appendFileSync(file, `${lead}${missing.map(([n, v]) => `${n}=${v}`).join("\n")}\n`);
      console.log(`apps/${app}/.dev.vars: added ${missing.map(([n]) => n).join(", ")}.`);
    } else {
      console.log(`apps/${app}/.dev.vars already exists; leaving it alone.`);
    }
  } else {
    const lines = [
      ...(APPS[app] ?? []).map((n) => `${n}=${randomBytes(32).toString("base64")}`),
      ...fixed.map(([n, v]) => `${n}=${v}`),
    ];
    writeFileSync(file, `${lines.join("\n")}\n`);
    console.log(`Wrote apps/${app}/.dev.vars with local values.`);
  }
}
