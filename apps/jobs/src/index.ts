import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

const app = new Hono<{ Bindings: Env }>();
app.use(secureHeaders());

// Health check: deliberately touches no database (saves D1 reads; docs/05 §13).
app.get("/healthz", (c) => c.json({ ok: true, service: "jobs", env: c.env.ENVIRONMENT }));

// Webhook routes (/razorpay, /stripe, /paypal, /ses) arrive in M6/M7.
app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default {
  fetch: app.fetch,
  // Cron dispatcher: only enqueues work (docs/05 §11.3). Implemented in M5.4.
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
