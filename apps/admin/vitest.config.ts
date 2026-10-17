import { join } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Worker (API) tests run inside workerd with every D1 migration applied. SPA component tests come with the UI
// milestones. The secrets below are fixed test values, used only here.
const TEST_KEY = (n: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, "../../packages/db/migrations")),
          PASSWORD_PEPPER: TEST_KEY(1),
          SALT_PEPPER: TEST_KEY(2),
          TOTP_ENC_KEY: TEST_KEY(3),
          SESSION_HMAC_KEY: TEST_KEY(4),
        },
      },
    }),
  ],
  test: { include: ["worker/**/*.test.ts"], setupFiles: ["./worker/test-setup.ts"] },
}));
