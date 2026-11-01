// Start-up warm-up of the front Worker (M3.1, CPU tuning; split in M5.0): the step-up path (`/auth/step-up` measured up to 9 ms on staging):
// the AES-GCM engine and key import, the three HOTPs, the schemas of the account routes. Pure of `env` (made-up keys and values), nothing
// stored or logged; errors are swallowed inside the helper. The other warm-ups are in warm-api.ts and warm-finance.ts.
import { warmStepUp } from "@techaust/auth";

export const frontWarm: Promise<number> = warmStepUp();

/** Made-up 32-byte keys (the admin tests' TEST_KEY values, vitest.config.ts): never a real secret. */
const madeUpKey = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
/**
 * CPU warm-up (b)1: the front's made-up sign-in keys for its start-up dry run (warm-routes.ts `warmEnv`), here because only the front bundle may name them
 * (scripts/worker-budget.mjs SIGN_IN_TABLES). The dry run's made-up rows (warm-fixtures/front.ts) were sealed with these same test values.
 */
export const FRONT_WARM_SECRETS: Readonly<Record<string, string>> = {
  PASSWORD_PEPPER: madeUpKey(1),
  SALT_PEPPER: madeUpKey(2),
  TOTP_ENC_KEY: madeUpKey(3),
  SESSION_HMAC_KEY: madeUpKey(4),
  TURNSTILE_SECRET: ["warm", "up", "turnstile"].join("-"),
};
