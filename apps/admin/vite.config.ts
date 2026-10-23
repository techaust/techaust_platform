import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { siteKeyForApp } from "../../scripts/turnstile-site-key.mjs";

// Local D1/R2 state is shared by every app in ../../.wrangler/state, so admin, portal and jobs see one database
// (`pnpm db:migrate:local` applies the migrations there).
//
// The Worker build is minified (M1.5): the plugin leaves it unminified by default, and a smaller script is a
// shorter cold start on the Free plan's 10 ms CPU budget. The environment is named after the Worker.
// __TURNSTILE_SITE_KEY__: the sign-in widget's public key from wrangler.jsonc for CLOUDFLARE_ENV (M2.4b); a staging build with an
// empty key fails here.
export default defineConfig({
  define: { __TURNSTILE_SITE_KEY__: JSON.stringify(siteKeyForApp(new URL("./", import.meta.url))) },
  plugins: [react(), cloudflare({ persistState: { path: "../../.wrangler/state" } })],
  environments: { techaust_platform_admin: { build: { minify: true } } },
});
