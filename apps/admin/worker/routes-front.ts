// The route groups the front Worker answers itself (M5.0): health, sign-in and the member's own account, and staff
// management. Every row is marked `on: "front"` in ROUTES. They hold the sign-in secrets; the API Worker never imports them.
import { account } from "./account.ts";
import type { App } from "./app.ts";
import { auth } from "./auth.ts";
import { users } from "./users.ts";
import "./warm-front.ts"; // start-up warm-up of the step-up path (M3.1)

export function mountFront(app: App) {
  app.get("/v1/health", (c) => c.json({ ok: true, service: "admin", env: c.env.ENVIRONMENT }));
  app.route("/v1/auth", auth);
  app.route("/v1/auth", account);
  app.route("/v1/users", users);
}
