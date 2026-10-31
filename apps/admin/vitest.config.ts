import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Worker (API) tests run inside workerd with every D1 migration applied. The SPA's pure modules (password rules,
// API client, user-agent helper: src/**/*.test.ts) run in the same pool; they need no DOM. The secrets below are
// fixed test values, used only here.
const TEST_KEY = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // The pool has no API or finance Worker: each binding is a stub that answers 502. The existing tests call the combined app
        // (worker/test-app.ts) and split.test.ts passes its own stubs through `env`.
        serviceBindings: {
          ADMIN_API: () => new Response("no api worker in the test pool", { status: 502 }),
          ADMIN_FINANCE: () => new Response("no finance worker in the test pool", { status: 502 }),
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, "../../packages/db/migrations")),
          PASSWORD_PEPPER: TEST_KEY(1),
          SALT_PEPPER: TEST_KEY(2),
          TOTP_ENC_KEY: TEST_KEY(3),
          SESSION_HMAC_KEY: TEST_KEY(4),
          TURNSTILE_SECRET: "test-turnstile-secret",
          // Opt-in: run the suite as if it started at this instant (worker/test-setup.ts); empty by default.
          TEST_CLOCK_AT: process.env.TA_TEST_CLOCK ?? "",
        },
      },
    }),
  ],
  test: { include: ["worker/**/*.test.ts", "src/**/*.test.ts"], setupFiles: ["./worker/test-setup.ts"] },
}));
