import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { freeInspectorPort, portOffset, shiftLocalUrl } from "../../scripts/dev-ports.mjs";
import { siteKeyForApp } from "../../scripts/turnstile-site-key.mjs";
import { websiteOriginForApp } from "../../scripts/website-origin.mjs";

// Local D1/R2 state is shared by every app in ../../.wrangler/state, so admin, portal and jobs see one database
// (`pnpm db:migrate:local` applies the migrations there).
//
// The Worker build is minified from the start (M1.6, as the admin's since M1.5): the plugin leaves it unminified by
// default, and a smaller script is a shorter cold start on the Free plan's 10 ms CPU budget. The environment is named
// after the Worker.
// __TURNSTILE_SITE_KEY__: the sign-in widget's public key from wrangler.jsonc for CLOUDFLARE_ENV (M2.4b); a staging build with an
// empty key fails here.
// TECHAUST_PORT_OFFSET (CLOUD-1, scripts/dev-ports.mjs): a non-zero offset moves the local website origin with the other dev ports
// (a staging or production origin never changes). inspectorPort: the dev server's own, so the apps started together never race
// for one; if it is taken, undefined lets the plugin pick a free one as before. Not used by `vite build`.
export default defineConfig(async ({ command }) => ({
  define: {
    __TURNSTILE_SITE_KEY__: JSON.stringify(siteKeyForApp(new URL("./", import.meta.url))),
    // __WEBSITE_ORIGIN__: the website of this environment (vars.WEBSITE_ORIGIN; 07-W 5.5), for the "Privacy notice" link.
    __WEBSITE_ORIGIN__: JSON.stringify(
      shiftLocalUrl(websiteOriginForApp(new URL("./", import.meta.url)), portOffset()),
    ),
  },
  plugins: [
    react(),
    cloudflare({
      persistState: { path: "../../.wrangler/state" },
      inspectorPort: command === "serve" ? await freeInspectorPort("portal", portOffset()) : undefined,
    }),
  ],
  environments: {
    // Fonts and images stay files, never data: URIs (FX-2, audit A1 finding 1): the CSP's font-src is 'self' (public/_headers), so
    // Vite's default inlining of the small rupee-glyph fonts (< 4 KB) would be blocked and ₹ would fall back to a system font.
    client: { build: { assetsInlineLimit: 0 } },
    techaust_platform_portal: { build: { minify: true } },
  },
}));
