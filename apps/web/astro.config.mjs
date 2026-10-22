// @ts-check
import { defineConfig } from "astro/config";

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
      // M2.1: shell, menus, components. M2.2: home, service (the S9 page).
      for (const page of ["shell", "menus", "components", "home", "service"]) {
        injectRoute({ pattern: `/preview/${page}`, entrypoint: `./src/preview/${page}.astro` });
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
  integrations: [devPreviewPages],
  // The dev toolbar overlays the page and would sit in every design screenshot.
  devToolbar: { enabled: false },
  // Fonts, icons and logos stay files (cacheable, and allowed by the CSP's font-src/img-src 'self'), never data: URIs.
  vite: { build: { assetsInlineLimit: 0 } },
});
