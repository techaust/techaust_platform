// @ts-check
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import { writeQuotable } from "./src/lib/quotable-build.ts";

// The quote form's list of services (audit A2 finding 3), from the same snapshot and rule as the pages: written on every astro
// command (build, dev, check), so `build` and `deploy:staging` bundle the list of the snapshot they build, before wrangler runs.
writeQuotable({
  snapshotPath:
    process.env.CATALOGUE_SNAPSHOT ?? fileURLToPath(new URL("./catalogue-snapshot.json", import.meta.url)),
  out: fileURLToPath(new URL("./src/generated/quotable-services.json", import.meta.url)),
});

/**
 * The M2.1 design-preview pages (src/preview/*.astro) exist in `astro dev` only: they are injected as routes for the
 * dev server and never built, so production has no /preview/* (run file m2.1, phase 2).
 * @type {import("astro").AstroIntegration}
 */
const devPreviewPages = {
  name: "techaust:dev-preview-pages",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command !== "dev") return;
      // M2.1: shell, menus, components. (M2.2's home and service previews became the real / and /services/*.)
      // M2.3: the case-study and blog-post templates with labelled samples (no real entries are published yet).
      for (const page of ["shell", "menus", "components", "work", "blog-post"]) {
        injectRoute({ pattern: `/preview/${page}`, entrypoint: `./src/preview/${page}.astro` });
      }
    },
  },
};

/**
 * The email logos (docs/06 §6) are hosted on the website at a stable path, /brand/<file>, because an email can only
 * show an image by its URL (packages/email/src/templates.ts). They are copied from @techaust/ui's generated brand files
 * at build time, never hand-copied, so they can't drift from the brand.
 * @type {import("astro").AstroIntegration}
 */
const emailLogos = {
  name: "techaust:email-logos",
  hooks: {
    "astro:build:done": ({ dir }) => {
      const out = new URL("brand/", dir);
      mkdirSync(out, { recursive: true });
      for (const file of ["logo-email-badge@2x.png", "logo-email-color@2x.png", "logo-email-dark@2x.png"]) {
        copyFileSync(fileURLToPath(import.meta.resolve(`@techaust/ui/brand/${file}`)), new URL(file, out));
      }
    },
  },
};

// Static output, no adapter (docs/05-architecture.md §2, ADR 0002). Images are processed at build time.
export default defineConfig({
  site: "https://techaust.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [devPreviewPages, emailLogos],
  // The dev toolbar overlays the page and would sit in every design screenshot.
  devToolbar: { enabled: false },
  // Fonts, icons and logos stay files (cacheable, and allowed by the CSP's font-src/img-src 'self'), never data: URIs.
  vite: { build: { assetsInlineLimit: 0 } },
});
