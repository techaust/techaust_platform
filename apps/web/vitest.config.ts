import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects: the Worker (src/worker.ts) runs in workerd; the build checks read files, so they run in Node.
export default defineConfig({
  test: {
    projects: [
      {
        // Fixed test secrets, used only here (the form tests hand-build their own Env; these keep the plugin quiet).
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TURNSTILE_SECRET: "test-secret",
                // base64 of 32 bytes, like the real pepper
                FORMS_IP_PEPPER: "cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA=",
              },
            },
          }),
        ],
        // 20 s: the first request of a file loads the Worker with zod and the shared schemas, which is slow when the whole
        // repository's tests run at once.
        test: { name: "worker", include: ["test/worker/**/*.test.ts"], testTimeout: 20_000 },
      },
      {
        // A path that never exists: tests read the seed, never a developer's own catalogue-snapshot.json.
        test: {
          name: "node",
          include: ["test/*.test.ts"],
          env: { CATALOGUE_SNAPSHOT: "test/.no-such-snapshot.json" },
        },
      },
    ],
  },
});
