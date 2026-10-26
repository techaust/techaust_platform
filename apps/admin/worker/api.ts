// The admin API Worker entry (M5.0): every route of ROUTES not marked `on: "front"`. Reached only through the front Worker's `ADMIN_API`
// binding (no public URL). It runs the same middleware chain and guard as before and re-authenticates from the session cookie.
import { createApp } from "./app.ts";
import { mountApi } from "./routes-api.ts";

export default createApp(mountApi) satisfies ExportedHandler<Env>;
