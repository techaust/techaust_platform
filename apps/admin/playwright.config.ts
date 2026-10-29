// Browser checks of the admin SPA (FX-3, audit A3 1 and 2): every route is swept at 768 and 1024 px for sideways page
// scroll (`scrollWidth` ≤ `clientWidth`) and with axe (WCAG 2.2 AA), in both themes. Chromium only. The server is the
// admin's own `vite` dev server (the SPA plus both API Workers in workerd, on the shared local D1), so first prepare the
// local database and secrets once:
//   pnpm dev:secrets && pnpm db:migrate:local && pnpm db:seed:local && pnpm portal:sample
// then run `pnpm --filter @techaust/admin e2e` (through `bash tools/heavy.sh --log e2e-admin …`). The global setup enrols a
// throwaway Owner (`e2e-…@example.test`, local database only) over the API, as a browser would, and signs the tests in.
// The port follows TECHAUST_PORT_OFFSET (CLOUD-1, scripts/dev-ports.mjs): the admin's usual dev port by default, 100 higher for the
// second browser agent.
import { defineConfig, devices } from "@playwright/test";
import { localOrigin, portOffset } from "../../scripts/dev-ports.mjs";

// the admin's dev server: the API's CSRF check compares the Origin with it, and the cookie is bound to it
export const ORIGIN = localOrigin("admin", portOffset());

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1, // one browser at a time: the machine has little memory
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: ORIGIN, storageState: "./.e2e/owner-state.json", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../../scripts/dev.mjs admin",
    url: `${ORIGIN}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
