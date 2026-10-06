import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

// Runs ONLY for /api/* (run_worker_first). Static pages never invoke this Worker.

const app = new Hono<{ Bindings: Env }>().basePath("/api");
app.use(secureHeaders());

// Visitor country for the ₹/$ default (WEB-G-06). Cached privately for a day.
app.get("/geo", (c) => {
  const country = (c.req.raw.cf?.country as string | undefined) ?? "XX";
  return c.json({ country }, 200, { "Cache-Control": "private, max-age=86400" });
});

// Lead forms (FRM-*) are implemented in M2.4.
app.post("/forms/*", (c) => c.json({ ok: false, error: "not_implemented" }, 501));

app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
