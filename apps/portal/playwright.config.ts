// Browser checks of the portal's accept form (FX-3, audit A4 1, 2, 8, 9; POR-05): run on the portal's own `vite` dev server with the
// labelled sample API of /preview (`?sample=on`: sample data only, nothing saved or sent), so no sign-in or database is needed. Chromium only.
// Run with `pnpm --filter @techaust/portal e2e` (through `bash tools/heavy.sh --log e2e-portal …`).
// The port follows TECHAUST_PORT_OFFSET (CLOUD-1, scripts/dev-ports.mjs): the portal's usual dev port by default, 100 higher for
// the second browser agent.
import { defineConfig, devices } from "@playwright/test";
import { localOrigin, portOffset } from "../../scripts/dev-ports.mjs";

const ORIGIN = localOrigin("portal", portOffset()); // the portal's dev server

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
    command: "node ../../scripts/dev.mjs portal",
    url: `${ORIGIN}/preview`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
