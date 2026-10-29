import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { writeQuotable } from "./src/lib/quotable-build.ts";

// The quote form's build-time list of services (src/lib/quotable-build.ts) from the SEED, as every test reads the seed: the Worker
// tests bundle it. (A later `astro build` writes it again from the real snapshot.)
writeQuotable({
  snapshotPath: fileURLToPath(new URL("./test/.no-such-snapshot.json", import.meta.url)),
  out: fileURLToPath(new URL("./src/generated/quotable-services.json", import.meta.url)),
});

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
