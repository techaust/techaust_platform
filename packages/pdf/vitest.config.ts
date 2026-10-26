import { defineConfig } from "vitest/config";

// The pure parts of the PDF engine run in Node. Coverage is held to 90 % over the hand-written source; the generated assets and the
// layout skeleton the designer replaces are measured by their own tests, not by the gate.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**"],
      reporter: ["text-summary"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
