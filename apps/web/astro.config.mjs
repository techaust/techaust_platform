// @ts-check
import { defineConfig } from "astro/config";

// Static output, no adapter (docs/05-architecture.md §2, ADR 0002). Images are processed at build time.
export default defineConfig({
  site: "https://techaust.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  // The dev toolbar overlays the page and would sit in every design screenshot.
  devToolbar: { enabled: false },
});
