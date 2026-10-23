// Browser tests of the built public site (M2.5; WEB-G-09, WEB-G-13, NFR-1): axe on every page, the keyboard paths, the
// currency swap, the forms. Chromium only. The server is `wrangler dev` on the built `dist` (so the /api/* Worker and its
// secrets behave as deployed); build first (`pnpm --filter @techaust/web build`) and write the local secrets
// (`pnpm dev:secrets`: random local-only values and Cloudflare's always-pass Turnstile TEST keys). Run with
// `pnpm --filter @techaust/web e2e` (through `bash tools/heavy.sh --log e2e …`, one heavy command at a time).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8799; // not 4321 / 8787 / 5173, so a running `pnpm dev` never collides
const ORIGIN = `http://localhost:${PORT}`;

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
if (!existsSync(here("./dist/index.html")))
  throw new Error("e2e: apps/web/dist is missing: run `pnpm --filter @techaust/web build` first");
if (!existsSync(here("./.dev.vars")))
  throw new Error("e2e: apps/web/.dev.vars is missing: run `pnpm dev:secrets` first");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // One worker: the forms share a rate limit per address (2 a minute) and the machine has little memory.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "./playwright-report", open: "never" }]],
  use: { baseURL: ORIGIN, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // FORMS_ALLOWED_ORIGINS is overridden so the form endpoints accept this port's Origin (FRM-03).
    command: `pnpm exec wrangler dev --port ${PORT} --var FORMS_ALLOWED_ORIGINS:${ORIGIN}`,
    url: `${ORIGIN}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
