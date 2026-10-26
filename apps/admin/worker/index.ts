// The admin front Worker entry (M5.0): the SPA assets (served by the platform), the rows marked `on: "front"` (health, sign-in, the
// member's own account, staff management) and a forwarder to the API Worker for every other row (docs/13, 2026-10-27).
import { createApp } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import { mountFront } from "./routes-front.ts";

const app = createApp(mountFront, (a) => forwardRoutes(a, ROUTES));
export default app satisfies ExportedHandler<Env>;
