// The admin front Worker entry (M5.0): the SPA assets (served by the platform), the rows marked `on: "front"` (health, sign-in, the
// member's own account, staff management) and a forwarder for every other row (docs/13, 2026-10-27): to the finance Worker for the rows
// marked `on: "finance"` (M6.1 stage A), to the API Worker for the rest.
import type { TrieRouter } from "hono/router/trie-router";
import { createApp } from "./app.ts";
import type { RouteDef } from "./context.ts";
import { forwardRoutes, warmForwardTable } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import { mountFront } from "./routes-front.ts";
import { FRONT_WARM } from "./warm-fixtures/front.ts";
import { FRONT_WARM_SECRETS } from "./warm-front.ts";
import { warmRouter } from "./warm-router.ts";
import { warmAtStartup } from "./warm-routes.ts";

// CPU warm-up (b)2: the front's own rows and ONE forwarder catch-all that looks forwarded rows up in a TrieRouter table (forward.ts), in place of 155
// forwarder routes run through the PatternRouter's regular expressions.
let table: TrieRouter<RouteDef> | undefined;
const app = createApp(mountFront, (a) => {
  table = forwardRoutes(a, ROUTES);
});
// M6.2 CPU diagnosis (lead decision 1): the front's own rows matched while the module loads, and every forwarded row looked up in THE forwarder table the
// catch-all uses (early check finding 8: not a second one). (Not exported: a named export of a Worker entry module is read as an entrypoint.)
warmRouter(
  app,
  ROUTES.filter((r) => r.on === "front"),
);
if (table) warmForwardTable(table, ROUTES);
// CPU warm-up (b)1: sign-in, the account and the forwarders dry-run on made-up rows while the module loads (warm-routes.ts); never throws, stores and logs nothing.
void warmAtStartup(
  () => createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
  FRONT_WARM,
  FRONT_WARM_SECRETS,
);
export default app satisfies ExportedHandler<Env>;
