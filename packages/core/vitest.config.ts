import { defineConfig } from "vitest/config";

// core is pure, so its tests run in Node. The coverage gate (≥ 90 %, CLAUDE.md conventions) runs with the
// package's `test` script (`vitest run --coverage`), so it runs with every `pnpm test`, locally and in CI.
// Running a single file with `vitest run <file>` skips coverage.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // The tax engine (M4.2) is held to 100 %: every branch is a rule, so an untested branch is an unchecked rule.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        "src/tax/**": { 100: true },
        // The GST and report core (M5.5a) is held to 100 % as well: every branch is a rule.
        "src/gst/**": { 100: true },
      },
    },
  },
});
