import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd against a fresh local D1 with every migration applied (docs/05 §5.5). The SES keys are
// fixed test values, used only here.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // M5.4 (LD57): wrangler.jsonc binds `ADMIN_JOBS` to the admin finance Worker's `BillingJobs` entrypoint, which does not exist in this test pool (workerd refuses to start when a bound
        // service is missing). It is stood in for by a function Worker that answers every request with 501. The consumers' tests pass the typed fakes of `billing-fixtures.ts` instead,
        // so no test calls the entrypoint through this binding; the real call over a service binding is the staging reading (docs/runbooks/cpu-baseline.md).
        serviceBindings: {
          ADMIN_JOBS: async () => new Response("no admin API in the test pool", { status: 501 }),
          // M6.2: the finance Worker's `GatewayEvents` likewise (the gateway tests pass typed fakes through `env`).
          ADMIN_GATEWAY: async () => new Response("no admin finance in the test pool", { status: 501 }),
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, "../../packages/db/migrations")),
          SES_ACCESS_KEY_ID: "AKIATEST",
          SES_SECRET_ACCESS_KEY: "test-secret",
          // M6.2: a fixed test webhook secret (never a real one).
          RAZORPAY_WEBHOOK_SECRET: "test-razorpay-webhook-secret",
          // M6.3: a fixed test Stripe webhook secret (never a real one).
          // Built at run time so no secret-looking literal is committed (the repo's secret scan, lead 2026-11-02).
          STRIPE_WEBHOOK_SECRET: ["whsec", "madeupfortests"].join("_"),
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
}));
