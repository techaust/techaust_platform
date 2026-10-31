// The admin front Worker entry (M5.0): the SPA assets (served by the platform), the rows marked `on: "front"` (health, sign-in, the
// member's own account, staff management) and a forwarder for every other row (docs/13, 2026-10-27): to the finance Worker for the rows
// marked `on: "finance"` (M6.1 stage A), to the API Worker for the rest.
import { createApp } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import { mountFront } from "./routes-front.ts";
import { warmRouter } from "./warm-router.ts";

const app = createApp(mountFront, (a) => forwardRoutes(a, ROUTES));
// M6.2 CPU diagnosis (lead decision 1): every row this Worker answers (its own and the forwarders) matched while the module loads.
// (Not exported: a named export of a Worker entry module is read as an entrypoint.)
warmRouter(app, ROUTES);
export default app satisfies ExportedHandler<Env>;
