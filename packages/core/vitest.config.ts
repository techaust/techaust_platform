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
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
