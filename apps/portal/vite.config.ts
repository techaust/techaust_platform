import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local D1/R2 state is shared by every app in ../../.wrangler/state, so admin, portal and jobs see one database
// (`pnpm db:migrate:local` applies the migrations there).
//
// The Worker build is minified from the start (M1.6, as the admin's since M1.5): the plugin leaves it unminified by
// default, and a smaller script is a shorter cold start on the Free plan's 10 ms CPU budget. The environment is named
// after the Worker.
export default defineConfig({
  plugins: [react(), cloudflare({ persistState: { path: "../../.wrangler/state" } })],
  environments: { techaust_platform_portal: { build: { minify: true } } },
});
