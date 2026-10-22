import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects: the Worker (src/worker.ts) runs in workerd; the build checks read files, so they run in Node.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"] },
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
