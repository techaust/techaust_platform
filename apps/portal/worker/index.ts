import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

const app = new Hono<{ Bindings: Env }>().basePath("/api");
app.use(secureHeaders());

app.get("/v1/health", (c) => c.json({ ok: true, service: "portal", env: c.env.ENVIRONMENT }));

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default app satisfies ExportedHandler<Env>;
