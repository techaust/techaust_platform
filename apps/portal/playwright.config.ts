// Browser checks of the portal's accept form (FX-3, audit A4 1, 2, 8, 9; POR-05): run on the portal's own `vite` dev server with the
// labelled sample API of /preview (`?sample=on`: sample data only, nothing saved or sent), so no sign-in or database is needed. Chromium only.
// Run with `pnpm --filter @techaust/portal e2e` (through `bash tools/heavy.sh --log e2e-portal …`).
import { defineConfig, devices } from "@playwright/test";

const PORT = 5174; // the portal's dev port
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: ORIGIN, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `${ORIGIN}/preview`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
