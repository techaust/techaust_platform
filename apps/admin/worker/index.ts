import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth.ts";

const app = new Hono<{ Bindings: Env }>().basePath("/api");
app.use(secureHeaders());
// Cookies are SameSite=Strict and the API takes JSON only; csrf() also rejects cross-site form posts.
app.use(csrf());

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
