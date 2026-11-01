// The admin front Worker entry (M5.0): the SPA assets (served by the platform), the rows marked `on: "front"` (health, sign-in, the
// member's own account, staff management) and a forwarder for every other row (docs/13, 2026-10-27): to the finance Worker for the rows
// marked `on: "finance"` (M6.1 stage A), to the API Worker for the rest.
import { createApp } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import { mountFront } from "./routes-front.ts";
import { FRONT_WARM } from "./warm-fixtures/front.ts";
import { FRONT_WARM_SECRETS } from "./warm-front.ts";
import { warmRouter } from "./warm-router.ts";
import { warmStart } from "./warm-routes.ts";

const app = createApp(mountFront, (a) => forwardRoutes(a, ROUTES));
// M6.2 CPU diagnosis (lead decision 1): every row this Worker answers (its own and the forwarders) matched while the module loads.
// (Not exported: a named export of a Worker entry module is read as an entrypoint.)
warmRouter(app, ROUTES);
// CPU warm-up (b)1: sign-in, the account and the forwarders dry-run on made-up rows while the module loads (warm-routes.ts); never throws, stores and logs nothing.
void warmStart(
  createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
  FRONT_WARM,
  FRONT_WARM_SECRETS,
);
export default app satisfies ExportedHandler<Env>;
