// The admin API Worker entry (M5.0): every route of ROUTES not marked `on: "front"` or `on: "finance"`. Reached only through the front Worker's
// `ADMIN_API` binding (no public URL). It runs the same middleware chain and guard as before and re-authenticates from the session cookie.
// The `BillingJobs` entrypoint moved to the finance Worker with the invoice code in M6.1 stage A (finance.ts).
import { createApp } from "./app.ts";
import { ROUTES } from "./guard.ts";
import { mountApi } from "./routes-api.ts";
import { API_WARM } from "./warm-fixtures/api.ts";
import { warmRouter } from "./warm-router.ts";
import { warmAtStartup } from "./warm-routes.ts";

const app = createApp(mountApi);
// M6.2 CPU diagnosis (lead decision 1): the rows this Worker answers, matched while the module loads.
warmRouter(
  app,
  ROUTES.filter((r) => r.on === undefined),
);
// CPU warm-up (b)1: the hot routes dry-run on made-up rows while the module loads (warm-routes.ts); never throws, stores and logs nothing.
void warmAtStartup(() => createApp(mountApi, undefined, { warm: true }), API_WARM);
export default app satisfies ExportedHandler<Env>;
