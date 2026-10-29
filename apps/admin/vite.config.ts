import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { freeInspectorPort, portOffset } from "../../scripts/dev-ports.mjs";
import { siteKeyForApp } from "../../scripts/turnstile-site-key.mjs";

// Local D1/R2 state is shared by every app in ../../.wrangler/state, so admin, portal and jobs see one database
// (`pnpm db:migrate:local` applies the migrations there).
//
// The Worker build is minified (M1.5): the plugin leaves it unminified by default, and a smaller script is a
// shorter cold start on the Free plan's 10 ms CPU budget. The environment is named after the Worker.
// __TURNSTILE_SITE_KEY__: the sign-in widget's public key from wrangler.jsonc for CLOUDFLARE_ENV (M2.4b); a staging build with an
// empty key fails here.
// inspectorPort (CLOUD-1, scripts/dev-ports.mjs): the dev server's own inspector port for TECHAUST_PORT_OFFSET, so the apps started
// together never race for one; if it is taken, undefined lets the plugin pick a free one as before. Not used by `vite build`.
export default defineConfig(async ({ command }) => ({
  define: { __TURNSTILE_SITE_KEY__: JSON.stringify(siteKeyForApp(new URL("./", import.meta.url))) },
  // M5.0: the API Worker runs next to the front in dev and is built with it (`auxiliaryWorkers`); the front reaches it through ADMIN_API.
  plugins: [
    react(),
    cloudflare({
      persistState: { path: "../../.wrangler/state" },
      auxiliaryWorkers: [{ configPath: "./wrangler.api.jsonc" }],
      inspectorPort: command === "serve" ? await freeInspectorPort("admin", portOffset()) : undefined,
    }),
  ],
  environments: {
    // Fonts and images stay files, never data: URIs (FX-2): the CSP's font-src is 'self' (public/_headers), so Vite's default
    // inlining of the small rupee-glyph fonts (< 4 KB) was blocked and ₹ fell back to a system font.
    client: { build: { assetsInlineLimit: 0 } },
    techaust_platform_admin: { build: { minify: true } },
    techaust_platform_admin_api: { build: { minify: true } },
  },
}));
