import { hex, randomBytes } from "@techaust/auth";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth.ts";

const app = new Hono<{ Bindings: Env }>().basePath("/api");
app.use(secureHeaders());
// Cookies are SameSite=Strict and the API takes JSON only; csrf() also rejects cross-site form posts.
app.use(csrf());

// One diagnostic line per auth request, to tell cold isolates from busy ones in Workers Logs. Exactly these
// keys: the route name, the status, a random per-isolate ID and this isolate's request count. No email, IP,
// user agent or account ID. (Random values can't be made at module level in Workers, so `iso` is lazy.)
const AUTH_ROUTES = new Set([
  "salt",
  "login",
  "totp",
  "me",
  "logout",
  "invite/start",
  "invite/finish",
  "invite/totp",
]);
let isolateId: string | undefined;
let isolateRequests = 0;
app.use("/v1/auth/*", async (c, next) => {
  await next();
  isolateId ??= hex(randomBytes(3));
  isolateRequests += 1;
  const route = c.req.path.replace(/^\/api\/v1\/auth\//, "");
  console.log(
    JSON.stringify({
      ev: "auth",
      r: AUTH_ROUTES.has(route) ? route : "other",
      s: c.res.status,
      iso: isolateId,
      n: isolateRequests,
    }),
  );
});

app.get("/v1/health", (c) => c.json({ ok: true, service: "admin", env: c.env.ENVIRONMENT }));
app.route("/v1/auth", auth);

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const status = err.status;
    return c.json(
      { error: { code: status === 403 ? "forbidden" : "bad_request", message: "Request refused" } },
      status,
    );
  }
  console.error(JSON.stringify({ level: "error", route: c.req.path, message: err.message }));
  return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
});

export default app satisfies ExportedHandler<Env>;
