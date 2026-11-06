import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Worker (API) tests run inside workerd with every D1 migration applied; the SPA's pure modules (src/**/*.test.ts,
// added with the sign-in screens) run in the same pool. The secret below is a fixed test value, used only here.
const TEST_KEY = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // M6.2: wrangler.jsonc binds ADMIN_PAY to the finance Worker's `PortalPayments`, which is not in this pool (workerd refuses a missing service): a stand-in
        // answers 501; the pay tests pass a typed fake through `env`.
        serviceBindings: {
          ADMIN_PAY: async () => new Response("no admin finance in the test pool", { status: 501 }),
        },
        // M7.5 (C2, L2): the Rate Limiting bindings with limits no test reaches (the tests share a few addresses and sessions); the 429 paths are proved with
        // a refusing limiter passed through `env` (worker/rate-limit.test.ts). wrangler.jsonc keeps the real limits.
        ratelimits: {
          RL_SESSION: { namespace_id: "6101", simple: { limit: 1_000_000, period: 60 } },
          RL_SIGNIN: { namespace_id: "6102", simple: { limit: 1_000_000, period: 60 } },
          RL_LINKS: { namespace_id: "6103", simple: { limit: 1_000_000, period: 60 } },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, "../../packages/db/migrations")),
          PORTAL_KEY_PEPPER: TEST_KEY(5),
          TURNSTILE_SECRET: "test-turnstile-secret",
        },
      },
    }),
  ],
  test: { include: ["worker/**/*.test.ts", "src/**/*.test.ts"], setupFiles: ["./worker/test-setup.ts"] },
}));
