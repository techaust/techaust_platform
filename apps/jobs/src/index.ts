import { expireMessage } from "@techaust/core/expiry";
import { warmSesSigning } from "@techaust/email";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { noteInvocation } from "./log.ts";
import { enqueueDue, PURGE_CRON } from "./purge.ts";
import { handleQueue } from "./queue.ts";
import { enqueueStats } from "./stats.ts";
import { warmConsumers } from "./warm.ts";

warmConsumers();
// Web Crypto is allowed at start-up and finishes before the first event; errors are swallowed inside (CPU tuning)
void warmSesSigning();

const app = new Hono<{ Bindings: Env }>();
app.use(secureHeaders());

// Health check: deliberately touches no database (saves D1 reads; docs/05 §13).
app.get("/healthz", (c) => c.json({ ok: true, service: "jobs", env: c.env.ENVIRONMENT }));

// Webhook routes (/razorpay, /stripe, /paypal, /ses) arrive in M6/M7.
app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default {
  fetch: app.fetch,
  // Cron dispatcher: only enqueues work (docs/05 §11.3). The daily run (22:00 UTC) enqueues the lead clean-up (M3.2), the nightly
  // statistics (M3.5) and the expiry of sent proposals and estimates (M4.3; one message in the statistics batch, no D1 read); the rest arrive in
  // M5.4. One failing does not stop the others; the run still fails so the failure is seen.
  async scheduled(controller, env, _ctx) {
    noteInvocation();
    if (controller.cron !== PURGE_CRON) return;
    const done = await Promise.allSettled([
      enqueueDue(env, controller.scheduledTime),
      enqueueStats(env, controller.scheduledTime, [expireMessage(controller.scheduledTime)]),
    ]);
    const failed = done.find((d) => d.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  },
  // Queue consumers: leads and email, with their dead-letter queues (M2.4).
  queue: handleQueue,
} satisfies ExportedHandler<Env>;
