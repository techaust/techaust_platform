// The PDF visual suite (M4.4): the document as printed HTML in Chromium, plus checks on the PDF Chromium prints from it. It checks the
// template and the fonts, not Browser Run (which is a different Chromium build; the staging sample PDF is looked at by eye).
// Run: bash tools/heavy.sh --log pdf-visual pnpm --filter @techaust/pdf test:visual
// Baselines are per platform: `visual/__snapshots__/<platform>/`. Only the Linux ones are committed (made by CI, lead decision L8);
// `win32/` is git-ignored. The skeleton layout has no baselines yet: the designer makes the real ones.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./visual",
  outputDir: "./visual/test-results",
  snapshotPathTemplate: "{testDir}/__snapshots__/{platform}/{testFilePath}/{arg}{ext}",
  // One worker: the machine has little memory, and a PDF print is the heaviest step.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" } },
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 794, height: 1123 } } },
  ],
});
